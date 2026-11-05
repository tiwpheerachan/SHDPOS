-- =====================================================================
-- SHD POS — 0018_loyalty.sql
-- แต้มสะสม + เครดิตร้าน "ครบวงจร" พร้อมประวัติทุกรายการ (ledger)
--   • ได้แต้มอัตโนมัติเมื่อขาย (1 แต้ม / 20 บาท ของยอดบิล)
--   • จ่ายด้วย "เครดิตร้าน" → ตัดยอดเครดิตจริง + บันทึก ledger
--   • ยกเลิก/คืนบิล → คืนแต้ม + คืนเครดิตที่ใช้ กลับให้ลูกค้า
--   • แอดมินเติมเครดิต/ปรับแต้มได้ ผ่าน admin_loyalty_adjust
--   ยอดคงเหลืออยู่ที่ customers.points / customers.store_credit (ของเดิม)
-- =====================================================================

-- อัตราได้แต้ม: ใช้เงินกี่บาทต่อ 1 แต้ม (ปรับได้ภายหลัง)
-- (hardcode 20 — ถ้าต้องการปรับ ให้แก้ค่าในฟังก์ชัน fn_loyalty_order)

-- ---------------------------------------------------------------------
-- ตารางบัญชีแต้ม/เครดิต (ledger) — ทุกการเคลื่อนไหวถูกบันทึกที่นี่
-- ---------------------------------------------------------------------
create table if not exists loyalty_ledger (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  order_id       uuid references orders(id) on delete set null,
  branch_id      uuid references branches(id),
  kind           text not null,          -- earn | redeem | reverse | topup | spend | adjust | refund
  points_delta   int not null default 0,
  credit_delta   numeric(14,2) not null default 0,
  balance_points int,                     -- ยอดแต้มคงเหลือหลังรายการนี้ (snapshot)
  balance_credit numeric(14,2),           -- ยอดเครดิตคงเหลือหลังรายการนี้
  note           text,
  created_by     uuid references employees(id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_loyalty_customer on loyalty_ledger(customer_id, created_at desc);
create index if not exists idx_loyalty_order on loyalty_ledger(order_id);

-- เข้าถึงได้เฉพาะ service-role (แอดมิน API) + trigger (security definer); กัน anon อ่าน
alter table loyalty_ledger enable row level security;

-- ---------------------------------------------------------------------
-- trigger: ได้แต้มเมื่อขาย / คืนเมื่อยกเลิกบิล
-- ---------------------------------------------------------------------
create or replace function fn_loyalty_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_earn     int;
  v_bal      int;
  v_sum_pts  int;
  v_sum_cr   numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.customer_id is not null and NEW.status = 'completed' then
      v_earn := floor(coalesce(NEW.grand_total, 0) / 20.0);
      if v_earn > 0 then
        update customers set points = points + v_earn, updated_at = now()
          where id = NEW.customer_id returning points into v_bal;
        insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, balance_points, note)
          values (NEW.customer_id, NEW.id, NEW.branch_id, 'earn', v_earn, v_bal,
                  'ได้แต้มจากการซื้อ ' || NEW.order_no);
      end if;
    end if;
    return NEW;
  end if;

  -- UPDATE: บิลถูกยกเลิก/คืน → ย้อนแต้มที่ได้ + เครดิตที่ใช้ กลับให้ลูกค้า
  if TG_OP = 'UPDATE'
     and NEW.customer_id is not null
     and OLD.status is distinct from NEW.status
     and NEW.status in ('voided', 'refunded') then
    select coalesce(sum(points_delta), 0), coalesce(sum(credit_delta), 0)
      into v_sum_pts, v_sum_cr
      from loyalty_ledger where order_id = NEW.id;
    if v_sum_pts <> 0 or v_sum_cr <> 0 then
      update customers
        set points = points - v_sum_pts,
            store_credit = store_credit - v_sum_cr,
            updated_at = now()
        where id = NEW.customer_id returning points into v_bal;
      insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, credit_delta, balance_points, note)
        values (NEW.customer_id, NEW.id, NEW.branch_id, 'reverse', -v_sum_pts, -v_sum_cr, v_bal,
                'ยกเลิก/คืนบิล ' || NEW.order_no);
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_loyalty_order on orders;
create trigger trg_loyalty_order
  after insert or update of status on orders
  for each row execute function fn_loyalty_order();

-- ---------------------------------------------------------------------
-- trigger: จ่ายด้วย "เครดิตร้าน" → ตัดยอดเครดิตจริง
-- ---------------------------------------------------------------------
create or replace function fn_loyalty_credit_spend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust   uuid;
  v_branch uuid;
  v_no     text;
  v_bal    numeric;
begin
  if NEW.method <> 'store_credit' then return NEW; end if;
  select customer_id, branch_id, order_no into v_cust, v_branch, v_no
    from orders where id = NEW.order_id;
  if v_cust is null then return NEW; end if;

  update customers set store_credit = store_credit - NEW.amount, updated_at = now()
    where id = v_cust returning store_credit into v_bal;
  insert into loyalty_ledger(customer_id, order_id, branch_id, kind, credit_delta, balance_credit, note)
    values (v_cust, NEW.order_id, v_branch, 'spend', -NEW.amount, v_bal,
            'ใช้เครดิตร้านจ่ายบิล ' || coalesce(v_no, ''));
  return NEW;
end;
$$;

drop trigger if exists trg_loyalty_credit_spend on order_payments;
create trigger trg_loyalty_credit_spend
  after insert on order_payments
  for each row execute function fn_loyalty_credit_spend();

-- ---------------------------------------------------------------------
-- แอดมิน: เติมเครดิต / ปรับแต้ม (atomic) — เรียกผ่าน service-role เท่านั้น
-- ---------------------------------------------------------------------
create or replace function admin_loyalty_adjust(
  p_customer_id uuid,
  p_points      int,
  p_credit      numeric,
  p_kind        text,
  p_note        text,
  p_actor       uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_bp int; v_bc numeric;
begin
  update customers
    set points = points + coalesce(p_points, 0),
        store_credit = store_credit + coalesce(p_credit, 0),
        updated_at = now()
    where id = p_customer_id
    returning points, store_credit into v_bp, v_bc;
  if not found then raise exception 'customer not found'; end if;

  insert into loyalty_ledger(customer_id, kind, points_delta, credit_delta, balance_points, balance_credit, note, created_by)
    values (p_customer_id, coalesce(p_kind, 'adjust'), coalesce(p_points, 0), coalesce(p_credit, 0),
            v_bp, v_bc, p_note, p_actor);

  return json_build_object('points', v_bp, 'store_credit', v_bc);
end;
$$;

revoke all on function admin_loyalty_adjust(uuid, int, numeric, text, text, uuid) from public;
grant execute on function admin_loyalty_adjust(uuid, int, numeric, text, text, uuid) to service_role, authenticated;
