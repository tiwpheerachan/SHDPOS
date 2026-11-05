-- =====================================================================
-- SHD POS — 0022_pdpa_points_expiry.sql
-- (A) PDPA: ความยินยอมในการติดต่อ (ช่องทาง + สถานะ opt-in/out)
-- (B) แต้มหมดอายุ: แต้มที่ได้จากการซื้อมีอายุ 12 เดือน + หมดอายุอัตโนมัติ (FIFO)
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) PDPA — เพิ่มคอลัมน์ความยินยอมใน customers
-- ---------------------------------------------------------------------
alter table customers add column if not exists contact_consent boolean not null default false;
alter table customers add column if not exists consent_channels text[] not null default '{}'; -- sms|email|line|call
alter table customers add column if not exists consent_at timestamptz;
alter table customers add column if not exists consent_note text;

-- ---------------------------------------------------------------------
-- (B) แต้มหมดอายุ — เพิ่มวันหมดอายุในแต่ละ lot ของแต้มที่ได้
-- ---------------------------------------------------------------------
alter table loyalty_ledger add column if not exists expires_at timestamptz;
create index if not exists idx_loyalty_expiry on loyalty_ledger(customer_id, expires_at)
  where points_delta > 0 and expires_at is not null;

-- recreate trigger ได้แต้ม: ตั้งวันหมดอายุ = วันที่ได้ + 12 เดือน
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
        insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, balance_points, note, expires_at)
          values (NEW.customer_id, NEW.id, NEW.branch_id, 'earn', v_earn, v_bal,
                  'ได้แต้มจากการซื้อ ' || NEW.order_no, now() + interval '12 months');
      end if;
    end if;
    return NEW;
  end if;

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

-- ---------------------------------------------------------------------
-- คำนวณแต้มหมดอายุของลูกค้า 1 คน แบบ FIFO (ใช้ก้อนเก่าก่อน) แล้วหักออก
--   • ประมวลผล ledger ตามเวลา: บวก = เพิ่ม lot, ลบ = ตัดจาก lot เก่าสุด
--   • lot ที่ยังเหลือ + เลยวันหมดอายุ → หมดอายุ
--   • ปลอดภัยเมื่อรันซ้ำ (แถว 'expire' เดิมจะไปตัด lot ที่หมดอายุไปแล้ว)
-- ---------------------------------------------------------------------
create or replace function expire_points_one(p_cust uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  lots_amt  bigint[] := '{}';
  lots_exp  timestamptz[] := '{}';
  head      int := 1;
  need      bigint;
  take      bigint;
  expire_amt bigint := 0;
  i         int;
  v_bal     int;
begin
  for r in
    select points_delta, coalesce(expires_at, 'infinity'::timestamptz) as exp
    from loyalty_ledger
    where customer_id = p_cust and points_delta <> 0
    order by created_at asc, id asc
  loop
    if r.points_delta > 0 then
      lots_amt := array_append(lots_amt, r.points_delta::bigint);
      lots_exp := array_append(lots_exp, r.exp);
    else
      need := -r.points_delta;
      while need > 0 and head <= coalesce(array_length(lots_amt, 1), 0) loop
        take := least(need, lots_amt[head]);
        lots_amt[head] := lots_amt[head] - take;
        need := need - take;
        if lots_amt[head] = 0 then head := head + 1; end if;
      end loop;
    end if;
  end loop;

  i := head;
  while i <= coalesce(array_length(lots_amt, 1), 0) loop
    if lots_amt[i] > 0 and lots_exp[i] < now() then
      expire_amt := expire_amt + lots_amt[i];
    end if;
    i := i + 1;
  end loop;

  if expire_amt > 0 then
    update customers set points = greatest(points - expire_amt, 0), updated_at = now()
      where id = p_cust returning points into v_bal;
    insert into loyalty_ledger(customer_id, kind, points_delta, balance_points, note)
      values (p_cust, 'expire', -expire_amt, v_bal, 'แต้มหมดอายุ');
  end if;
  return expire_amt::int;
end;
$$;

-- รันแต้มหมดอายุทั้งระบบ (หรือเฉพาะคน) — คืนจำนวนแต้มที่หมดอายุรวม
create or replace function expire_points(p_customer_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_cust uuid; v_total int := 0;
begin
  for v_cust in
    select distinct customer_id from loyalty_ledger
    where points_delta > 0 and expires_at is not null and expires_at < now()
      and (p_customer_id is null or customer_id = p_customer_id)
  loop
    v_total := v_total + expire_points_one(v_cust);
  end loop;
  return v_total;
end;
$$;

revoke all on function expire_points(uuid) from public;
grant execute on function expire_points(uuid) to service_role, authenticated;

-- (ตัวเลือก) ตั้งเวลาอัตโนมัติด้วย pg_cron ถ้าเปิดใช้งาน extension แล้ว:
--   select cron.schedule('expire-points-daily', '0 1 * * *', $$select expire_points()$$);
