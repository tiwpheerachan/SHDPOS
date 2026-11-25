-- =====================================================================
-- 0061 — ระบบสะสมแต้มตั้งค่าได้รายแบรนด์ (เดิมฝังตายตัว 1 แต้ม / 20 บาท ใน fn_loyalty_order)
--   loyalty_programs  : ค่าหลักต่อแบรนด์ (brand_id null = ค่าเริ่มต้นทุกแบรนด์)
--                       ทุก spend_per_unit บาท ได้ points_per_unit แต้ม · ยอดขั้นต่ำ · เพดานต่อบิล · อายุแต้ม · บิลที่ใช้แต้มได้แต้มไหม
--   loyalty_rules     : กฎเสริม (ตั้งช่วงวันเวลา/วันในสัปดาห์/ช่วงเวลา/สาขา/ช่องทาง/กลุ่มลูกค้าได้)
--       multiplier : คูณแต้มฐาน (หลายกฎพร้อมกัน = ใช้ตัวคูณสูงสุด ไม่คูณทบ)
--       per_item   : แต้มต่อชิ้น สำหรับสินค้า/หมวดที่เลือก (ว่างทั้งคู่ = ทุกสินค้า; ผูกแบรนด์ = เฉพาะสินค้าแบรนด์นั้น)
--       bonus      : แต้มโบนัสต่อบิล (ตั้งยอดขั้นต่ำได้ เช่น ซื้อครบ 5,000 รับเพิ่ม 100)
--   pos_loyalty_calc : สูตรเดียว ใช้ทั้งตอนบันทึกบิล (trigger) และตอนพรีวิวที่หน้าขาย
--   การได้แต้มย้ายไป constraint trigger แบบ deferred → คิดตอนจบ transaction (เห็นรายการสินค้าครบ)
--   loyalty_ledger.detail เก็บที่มาของแต้ม (ฐาน/คูณ/รายชิ้น/โบนัส/เพดาน)
-- =====================================================================
create table if not exists loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id),
  active boolean not null default true,
  spend_per_unit numeric not null default 20 check (spend_per_unit > 0),
  points_per_unit integer not null default 1 check (points_per_unit >= 0),
  min_spend numeric not null default 0 check (min_spend >= 0),
  max_points_per_bill integer check (max_points_per_bill is null or max_points_per_bill >= 0),
  earn_on_redeemed_bill boolean not null default true,
  expiry_months integer default 12 check (expiry_months is null or expiry_months between 1 and 120),
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists loyalty_programs_brand_uq on loyalty_programs ((coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)));

create table if not exists loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id),
  name text not null check (length(trim(name)) between 1 and 200),
  kind text not null check (kind in ('multiplier','per_item','bonus')),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  days_of_week integer[] not null default '{}',
  time_from time,
  time_to time,
  branch_ids uuid[] not null default '{}',
  channels text[] not null default '{}',
  target_segment text not null default 'all',
  product_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  multiplier numeric check (multiplier is null or multiplier >= 1),
  points_per_unit integer check (points_per_unit is null or points_per_unit >= 0),
  bonus_points integer check (bonus_points is null or bonus_points >= 0),
  min_spend numeric not null default 0,
  min_qty integer not null default 1,
  priority integer not null default 0,
  archived_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check ((kind = 'multiplier' and multiplier is not null) or (kind = 'per_item' and points_per_unit is not null) or (kind = 'bonus' and bonus_points is not null))
);
create index if not exists loyalty_rules_active on loyalty_rules (active, brand_id) where archived_at is null;

alter table loyalty_ledger add column if not exists detail jsonb;
alter table loyalty_programs enable row level security;
alter table loyalty_rules enable row level security;

-- ค่าเริ่มต้นทุกแบรนด์ = พฤติกรรมเดิม (1 แต้ม / 20 บาท · หมดอายุ 12 เดือน)
insert into loyalty_programs (brand_id, spend_per_unit, points_per_unit, expiry_months, note)
select null, 20, 1, 12, 'ค่าเริ่มต้น (ย้ายจากระบบเดิม 1 แต้ม / 20 บาท)'
where not exists (select 1 from loyalty_programs where brand_id is null);

create or replace function pos_loyalty_calc(p_branch uuid, p_channel text, p_customer uuid, p_at timestamptz,
  p_net numeric, p_items jsonb, p_redeemed integer)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_brand uuid; prog loyalty_programs; r loyalty_rules;
  base integer := 0; mult numeric := 1; mult_name text; item_pts integer := 0; bonus integer := 0; total integer; capped boolean := false;
  parts jsonb := '[]'; seg text; q numeric; n integer;
  lt timestamp := coalesce(p_at, now()) at time zone 'Asia/Bangkok'; at_ts timestamptz := coalesce(p_at, now());
begin
  select brand_id into v_brand from branches where id = p_branch;
  select * into prog from loyalty_programs where brand_id = v_brand and active;
  if not found then select * into prog from loyalty_programs where brand_id is null and active; end if;
  if not found then return jsonb_build_object('points', 0, 'reason', 'no_program', 'parts', '[]'::jsonb); end if;
  if coalesce(p_redeemed, 0) > 0 and not prog.earn_on_redeemed_bill then
    return jsonb_build_object('points', 0, 'reason', 'redeemed_bill', 'program_id', prog.id, 'parts', '[]'::jsonb);
  end if;
  if coalesce(p_net, 0) < prog.min_spend then
    return jsonb_build_object('points', 0, 'reason', 'below_min_spend', 'min_spend', prog.min_spend, 'program_id', prog.id, 'parts', '[]'::jsonb);
  end if;
  base := floor(coalesce(p_net, 0) / prog.spend_per_unit)::integer * prog.points_per_unit;
  parts := parts || jsonb_build_array(jsonb_build_object('kind', 'base', 'label', format('ทุก %s บาท ได้ %s แต้ม', prog.spend_per_unit, prog.points_per_unit), 'points', base));
  seg := case when p_customer is null then null else customer_segment(p_customer) end;
  for r in
    select * from loyalty_rules
     where active and archived_at is null
       and (starts_at is null or at_ts >= starts_at) and (ends_at is null or at_ts < ends_at)
       and (cardinality(days_of_week) = 0 or extract(dow from lt)::int = any(days_of_week))
       and (time_from is null or lt::time >= time_from) and (time_to is null or lt::time < time_to)
       and (cardinality(branch_ids) = 0 or p_branch = any(branch_ids))
       and (cardinality(channels) = 0 or p_channel = any(channels))
       and (target_segment = 'all' or seg = target_segment)
       -- กฎผูกแบรนด์: คูณ/โบนัส = สาขาของแบรนด์นั้น · รายชิ้น = สินค้าของแบรนด์นั้น (ตรวจในลูป)
       and (brand_id is null or kind = 'per_item' or brand_id = v_brand)
     order by priority desc, created_at
  loop
    if r.kind = 'multiplier' then
      if coalesce(p_net, 0) >= r.min_spend and r.multiplier > mult then mult := r.multiplier; mult_name := r.name; end if;
    elsif r.kind = 'per_item' then
      select coalesce(sum((i->>'qty')::numeric), 0) into q
        from jsonb_array_elements(coalesce(p_items, '[]')) i join products p on p.id = (i->>'product_id')::uuid
       where not coalesce((i->>'is_gift')::boolean, false)
         and (r.brand_id is null or p.brand_id = r.brand_id)
         and ((cardinality(r.product_ids) = 0 and cardinality(r.category_ids) = 0) or p.id = any(r.product_ids) or p.category_id = any(r.category_ids));
      if q > 0 and q >= greatest(r.min_qty, 1) then
        n := floor(q)::integer * r.points_per_unit;
        item_pts := item_pts + n;
        parts := parts || jsonb_build_array(jsonb_build_object('kind', 'per_item', 'rule_id', r.id, 'label', r.name, 'qty', q, 'points', n));
      end if;
    elsif r.kind = 'bonus' then
      if coalesce(p_net, 0) >= r.min_spend then
        bonus := bonus + r.bonus_points;
        parts := parts || jsonb_build_array(jsonb_build_object('kind', 'bonus', 'rule_id', r.id, 'label', r.name, 'points', r.bonus_points));
      end if;
    end if;
  end loop;
  if mult > 1 then
    parts := parts || jsonb_build_array(jsonb_build_object('kind', 'multiplier', 'label', mult_name, 'multiplier', mult, 'points', floor(base * mult)::integer - base));
  end if;
  total := floor(base * mult)::integer + item_pts + bonus;
  if prog.max_points_per_bill is not null and total > prog.max_points_per_bill then
    parts := parts || jsonb_build_array(jsonb_build_object('kind', 'cap', 'label', format('เพดาน %s แต้มต่อบิล', prog.max_points_per_bill), 'points', prog.max_points_per_bill - total));
    total := prog.max_points_per_bill; capped := true;
  end if;
  return jsonb_build_object('points', greatest(total, 0), 'base', base, 'multiplier', mult, 'capped', capped,
    'program_id', prog.id, 'brand_id', v_brand, 'expiry_months', prog.expiry_months, 'parts', parts);
end $$;

-- ได้แต้มตอนจบ transaction (เห็น order_items ครบ) · idempotent (มี earn ของบิลนี้แล้ว = ข้าม)
create or replace function fn_loyalty_order_earn()
returns trigger language plpgsql security definer set search_path = public as $$
declare o orders; calc jsonb; v_earn int; v_bal int; v_bw int; v_items jsonb;
begin
  select * into o from orders where id = NEW.id;
  if not found or o.customer_id is null or o.status <> 'completed' then return null; end if;
  if exists (select 1 from loyalty_ledger where order_id = o.id and kind = 'earn') then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'is_gift', is_gift)), '[]') into v_items from order_items where order_id = o.id;
  calc := pos_loyalty_calc(o.branch_id, o.channel::text, o.customer_id, coalesce(o.sale_occurred_at, o.created_at), o.grand_total, v_items,
    coalesce((o.promo_snapshot->>'redeem_points')::int, 0));
  v_earn := coalesce((calc->>'points')::int, 0);
  if v_earn <= 0 then return null; end if;
  update customers set points = points + v_earn, updated_at = now() where id = o.customer_id returning points into v_bal;
  if (calc->>'brand_id') is not null then
    insert into brand_wallets(customer_id, brand_id, points) values (o.customer_id, (calc->>'brand_id')::uuid, v_earn)
    on conflict (customer_id, brand_id) do update set points = brand_wallets.points + v_earn, updated_at = now() returning points into v_bw;
  end if;
  insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, balance_points, note, expires_at, detail)
  values (o.customer_id, (calc->>'brand_id')::uuid, o.id, o.branch_id, 'earn', v_earn, coalesce(v_bw, v_bal),
    'ได้แต้มจากการซื้อ ' || o.order_no,
    case when (calc->>'expiry_months') is null then null else now() + make_interval(months => (calc->>'expiry_months')::int) end, calc);
  return null;
end $$;

-- ตัดส่วน "ได้แต้มตอน INSERT" ออกจาก trigger เดิม (คงส่วนคืนแต้มตอนยกเลิก/คืนบิลไว้)
create or replace function fn_loyalty_order()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_bal int; v_bw int; r record;
begin
  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status in ('voided','refunded') then
    if NEW.customer_id is not null then
      for r in select brand_id, coalesce(sum(points_delta),0) as dpts, coalesce(sum(credit_delta),0) as dcr
               from loyalty_ledger where order_id = NEW.id group by brand_id loop
        if r.dpts <> 0 or r.dcr <> 0 then
          update customers set points = points - r.dpts, store_credit = store_credit - r.dcr, updated_at = now()
            where id = NEW.customer_id returning points into v_bal;
          if r.brand_id is not null then
            insert into brand_wallets(customer_id, brand_id, points, store_credit) values (NEW.customer_id, r.brand_id, -r.dpts, -r.dcr)
            on conflict (customer_id, brand_id) do update set points = brand_wallets.points - r.dpts, store_credit = brand_wallets.store_credit - r.dcr, updated_at = now() returning points into v_bw;
          end if;
          insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, credit_delta, balance_points, note)
            values (NEW.customer_id, r.brand_id, NEW.id, NEW.branch_id, 'reverse', -r.dpts, -r.dcr, coalesce(v_bw, v_bal), 'ยกเลิก/คืนบิล ' || NEW.order_no);
        end if;
      end loop;
    end if;
    delete from coupon_redemptions where order_id = NEW.id;
  end if;
  return NEW;
end; $function$;

drop trigger if exists trg_loyalty_earn on orders;
create constraint trigger trg_loyalty_earn after insert on orders
  deferrable initially deferred for each row execute function fn_loyalty_order_earn();

revoke all on function pos_loyalty_calc(uuid,text,uuid,timestamptz,numeric,jsonb,integer) from public, anon, authenticated;
