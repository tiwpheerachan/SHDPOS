-- =====================================================================
-- SHD POS — 0028_brand_wallets.sql
-- กระเป๋าสิทธิ์แยกตามแบรนด์ (แต้ม + เครดิต + ระดับสมาชิก ต่อ ลูกค้า×แบรนด์)
--   สมมติฐาน (ยืนยันโดยเจ้าของ): 1 บิล = 1 แบรนด์เสมอ → ใช้ brand ของสาขาเป็น
--   brand ของบิล (branches.brand_id). customers.points/store_credit = ยอดรวมทุกแบรนด์
--   (ไว้ดูภาพรวม/ความเข้ากันได้เดิม), ยอดจริงรายแบรนด์อยู่ที่ brand_wallets.
-- =====================================================================
create table if not exists brand_wallets (
  customer_id  uuid not null references customers(id) on delete cascade,
  brand_id     uuid not null references brands(id) on delete cascade,
  points       int not null default 0,
  store_credit numeric(14,2) not null default 0,
  tier         text not null default 'normal',
  updated_at   timestamptz not null default now(),
  primary key (customer_id, brand_id)
);
alter table brand_wallets enable row level security;

alter table loyalty_ledger add column if not exists brand_id uuid references brands(id) on delete set null;
create index if not exists idx_loyalty_brand on loyalty_ledger(customer_id, brand_id);

-- ---------------------------------------------------------------------
-- earn / void-reverse — ผูกแบรนด์ของสาขา
-- ---------------------------------------------------------------------
create or replace function fn_loyalty_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_earn int; v_bal int; v_bw int; v_brand uuid; r record;
begin
  if TG_OP = 'INSERT' then
    if NEW.customer_id is not null and NEW.status = 'completed' then
      v_earn := floor(coalesce(NEW.grand_total, 0) / 20.0);
      if v_earn > 0 then
        v_brand := (select brand_id from branches where id = NEW.branch_id);
        update customers set points = points + v_earn, updated_at = now()
          where id = NEW.customer_id returning points into v_bal;
        if v_brand is not null then
          insert into brand_wallets(customer_id, brand_id, points)
            values (NEW.customer_id, v_brand, v_earn)
          on conflict (customer_id, brand_id) do update set points = brand_wallets.points + v_earn, updated_at = now()
          returning points into v_bw;
        end if;
        insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, balance_points, note, expires_at)
          values (NEW.customer_id, v_brand, NEW.id, NEW.branch_id, 'earn', v_earn, coalesce(v_bw, v_bal),
                  'ได้แต้มจากการซื้อ ' || NEW.order_no, now() + interval '12 months');
      end if;
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status in ('voided','refunded') then
    if NEW.customer_id is not null then
      -- ย้อนทุกแบรนด์ที่บิลนี้เคยกระทบ
      for r in
        select coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid) as bkey, brand_id,
               coalesce(sum(points_delta),0) as dpts, coalesce(sum(credit_delta),0) as dcr
        from loyalty_ledger where order_id = NEW.id group by brand_id
      loop
        if r.dpts <> 0 or r.dcr <> 0 then
          update customers set points = points - r.dpts, store_credit = store_credit - r.dcr, updated_at = now()
            where id = NEW.customer_id returning points into v_bal;
          if r.brand_id is not null then
            insert into brand_wallets(customer_id, brand_id, points, store_credit)
              values (NEW.customer_id, r.brand_id, -r.dpts, -r.dcr)
            on conflict (customer_id, brand_id) do update
              set points = brand_wallets.points - r.dpts, store_credit = brand_wallets.store_credit - r.dcr, updated_at = now()
            returning points into v_bw;
          end if;
          insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, credit_delta, balance_points, note)
            values (NEW.customer_id, r.brand_id, NEW.id, NEW.branch_id, 'reverse', -r.dpts, -r.dcr, coalesce(v_bw, v_bal),
                    'ยกเลิก/คืนบิล ' || NEW.order_no);
        end if;
      end loop;
    end if;
    delete from coupon_redemptions where order_id = NEW.id;
  end if;
  return NEW;
end; $$;

-- ---------------------------------------------------------------------
-- store_credit spend — หักกระเป๋าแบรนด์ของสาขาที่ขาย
-- ---------------------------------------------------------------------
create or replace function fn_loyalty_credit_spend()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cust uuid; v_branch uuid; v_no text; v_brand uuid; v_bal numeric; v_bw numeric;
begin
  if NEW.method <> 'store_credit' then return NEW; end if;
  select customer_id, branch_id, order_no into v_cust, v_branch, v_no from orders where id = NEW.order_id;
  if v_cust is null then return NEW; end if;
  v_brand := (select brand_id from branches where id = v_branch);
  update customers set store_credit = store_credit - NEW.amount, updated_at = now()
    where id = v_cust returning store_credit into v_bal;
  if v_brand is not null then
    insert into brand_wallets(customer_id, brand_id, store_credit) values (v_cust, v_brand, -NEW.amount)
    on conflict (customer_id, brand_id) do update set store_credit = brand_wallets.store_credit - NEW.amount, updated_at = now()
    returning store_credit into v_bw;
  end if;
  insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, credit_delta, balance_credit, note)
    values (v_cust, v_brand, NEW.order_id, v_branch, 'spend', -NEW.amount, coalesce(v_bw, v_bal),
            'ใช้เครดิตร้านจ่ายบิล ' || coalesce(v_no, ''));
  return NEW;
end; $$;

-- ---------------------------------------------------------------------
-- redeem points — หักกระเป๋าแบรนด์ของบิล, กันซ้ำ+ไม่หักเกิน
-- ---------------------------------------------------------------------
create or replace function public.pos_redeem_points(
  p_customer_id uuid, p_points int, p_client_uuid uuid, p_note text default null
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_order_id uuid; v_order_no text; v_branch uuid; v_brand uuid; v_avail int; v_take int; v_bal int; v_bw int;
begin
  if p_customer_id is null or coalesce(p_points, 0) <= 0 then return json_build_object('ok', false, 'reason', 'noop'); end if;
  select id, order_no, branch_id into v_order_id, v_order_no, v_branch from orders where client_uuid = p_client_uuid;
  if v_order_id is null then raise exception 'order % not synced yet', p_client_uuid; end if;
  if exists (select 1 from loyalty_ledger where order_id = v_order_id and kind = 'redeem') then
    return json_build_object('ok', true, 'duplicate', true);
  end if;
  v_brand := (select brand_id from branches where id = v_branch);
  -- ยอดคงเหลือที่หักได้ = ของกระเป๋าแบรนด์ (ถ้ามีแบรนด์) ไม่งั้นยอดรวม
  if v_brand is not null then
    select points into v_avail from brand_wallets where customer_id = p_customer_id and brand_id = v_brand for update;
  else
    select points into v_avail from customers where id = p_customer_id for update;
  end if;
  v_take := least(p_points, greatest(coalesce(v_avail, 0), 0));
  if v_take <= 0 then return json_build_object('ok', true, 'redeemed', 0); end if;
  update customers set points = points - v_take, updated_at = now() where id = p_customer_id returning points into v_bal;
  if v_brand is not null then
    insert into brand_wallets(customer_id, brand_id, points) values (p_customer_id, v_brand, -v_take)
    on conflict (customer_id, brand_id) do update set points = brand_wallets.points - v_take, updated_at = now()
    returning points into v_bw;
  end if;
  insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, balance_points, note)
    values (p_customer_id, v_brand, v_order_id, v_branch, 'redeem', -v_take, coalesce(v_bw, v_bal),
            coalesce(p_note, 'ใช้แต้มเป็นส่วนลดบิล ' || coalesce(v_order_no, '')));
  return json_build_object('ok', true, 'redeemed', v_take, 'balance_points', coalesce(v_bw, v_bal));
end; $$;
grant execute on function public.pos_redeem_points(uuid, int, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- admin เติม/ปรับ — ระบุแบรนด์ (null = ปรับยอดรวมบริษัทอย่างเดียว)
-- ---------------------------------------------------------------------
create or replace function admin_loyalty_adjust(
  p_customer_id uuid, p_points int, p_credit numeric, p_kind text, p_note text,
  p_actor uuid default null, p_brand_id uuid default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_bp int; v_bc numeric; v_bwp int; v_bwc numeric;
begin
  update customers set points = points + coalesce(p_points,0), store_credit = store_credit + coalesce(p_credit,0), updated_at = now()
    where id = p_customer_id returning points, store_credit into v_bp, v_bc;
  if not found then raise exception 'customer not found'; end if;
  if p_brand_id is not null then
    insert into brand_wallets(customer_id, brand_id, points, store_credit)
      values (p_customer_id, p_brand_id, coalesce(p_points,0), coalesce(p_credit,0))
    on conflict (customer_id, brand_id) do update
      set points = brand_wallets.points + coalesce(p_points,0), store_credit = brand_wallets.store_credit + coalesce(p_credit,0), updated_at = now()
    returning points, store_credit into v_bwp, v_bwc;
  end if;
  insert into loyalty_ledger(customer_id, brand_id, kind, points_delta, credit_delta, balance_points, balance_credit, note, created_by)
    values (p_customer_id, p_brand_id, coalesce(p_kind,'adjust'), coalesce(p_points,0), coalesce(p_credit,0),
            coalesce(v_bwp, v_bp), coalesce(v_bwc, v_bc), p_note, p_actor);
  return json_build_object('points', v_bp, 'store_credit', v_bc, 'brand_points', v_bwp, 'brand_credit', v_bwc);
end; $$;
grant execute on function admin_loyalty_adjust(uuid, int, numeric, text, text, uuid, uuid) to service_role, authenticated;

-- ดึงกระเป๋าแบรนด์ (ให้ POS ใช้โชว์ยอด/ใช้แต้มตามแบรนด์ของสาขา)
create or replace function public.pos_brand_wallet(p_customer_id uuid, p_brand_id uuid)
returns json language sql security definer set search_path = public, extensions as $$
  select coalesce(
    (select to_json(w) from (
       select points, store_credit, tier from brand_wallets
       where customer_id = p_customer_id and brand_id = p_brand_id) w),
    json_build_object('points', 0, 'store_credit', 0, 'tier', 'normal'));
$$;
revoke all on function public.pos_brand_wallet(uuid, uuid) from public;
grant execute on function public.pos_brand_wallet(uuid, uuid) to anon, authenticated;
