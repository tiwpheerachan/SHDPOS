-- 0066 · ระดับสมาชิก + เงื่อนไขลูกค้าในกฎแต้ม (วันเกิด / ซื้อครั้งแรก) + สถิติหน้าแต้มสะสม
--   • loyalty_tiers: รายแบรนด์ (brand_id null = ค่าเริ่มต้นทุกแบรนด์) · ระดับตามยอดซื้อ 12 เดือนย้อนหลัง (ไม่รวมบิลที่กำลังขาย)
--     ได้แต้มเพิ่ม = แต้มฐาน × (ตัวคูณระดับ − 1) — แยกจากตัวคูณของกฎพิเศษ (ทบกันได้ แสดงแยกบรรทัด)
--   • loyalty_rules.customer_condition: none | birthday_day | birthday_month | first_purchase (ใช้ได้กับกฎทุกชนิด)
--   • pos_loyalty_calc เพิ่ม p_sim (ตัวจำลองหลังบ้าน: {tier_code, birthday, first_purchase}) — ใช้แทนข้อมูลลูกค้าจริงเฉพาะตอนจำลอง
--   • ตอนได้แต้มจริง บันทึกระดับปัจจุบันลง customers.tier / brand_wallets.tier (ให้หน้าลูกค้า/หน้าขายแสดง)
create table if not exists loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id),
  code text not null check (code ~ '^[a-z0-9_-]{1,30}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  min_spend numeric not null default 0 check (min_spend >= 0),
  multiplier numeric not null default 1 check (multiplier >= 1 and multiplier <= 10),
  color text not null default '#9CA3AF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  perks text,
  active boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists loyalty_tiers_code_uq on loyalty_tiers ((coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)), code);
alter table loyalty_tiers enable row level security;
revoke all on loyalty_tiers from anon, authenticated;

alter table loyalty_rules add column if not exists customer_condition text not null default 'none';
do $$ begin
  alter table loyalty_rules add constraint loyalty_rules_condition_chk check (customer_condition in ('none','birthday_day','birthday_month','first_purchase'));
exception when duplicate_object then null; end $$;

-- ระดับของลูกค้า ณ เวลา p_at (ยอด 12 เดือนก่อนหน้า หักยอดคืนเงิน) · ชุดระดับของแบรนด์ ถ้าไม่มีใช้ชุดค่าเริ่มต้น
create or replace function loyalty_customer_tier(p_customer uuid, p_brand uuid, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_set uuid; v_spend numeric := 0; cur loyalty_tiers; nxt loyalty_tiers; has_brand boolean;
begin
  has_brand := p_brand is not null and exists (select 1 from loyalty_tiers where brand_id = p_brand and active);
  if not has_brand and not exists (select 1 from loyalty_tiers where brand_id is null and active) then return null; end if;
  v_set := case when has_brand then p_brand else null end;
  if p_customer is not null then
    select coalesce(sum(o.grand_total), 0) - coalesce(sum((select coalesce(sum(r.refund_amount), 0) from returns r where r.order_id = o.id and r.status = 'completed')), 0)
      into v_spend
      from orders o join branches b on b.id = o.branch_id
     where o.customer_id = p_customer and o.status in ('completed', 'partially_refunded', 'refunded')
       and coalesce(o.sale_occurred_at, o.created_at) >= coalesce(p_at, now()) - interval '12 months'
       and coalesce(o.sale_occurred_at, o.created_at) < coalesce(p_at, now())
       and (v_set is null or b.brand_id = v_set);
  end if;
  select * into cur from loyalty_tiers where brand_id is not distinct from v_set and active and min_spend <= greatest(v_spend, 0) order by min_spend desc limit 1;
  select * into nxt from loyalty_tiers where brand_id is not distinct from v_set and active and min_spend > greatest(v_spend, 0) order by min_spend limit 1;
  if cur.id is null then return jsonb_build_object('code', null, 'spend', v_spend, 'multiplier', 1,
    'next', case when nxt.id is null then null else jsonb_build_object('code', nxt.code, 'name', nxt.name, 'min_spend', nxt.min_spend, 'remaining', nxt.min_spend - greatest(v_spend, 0)) end); end if;
  return jsonb_build_object('code', cur.code, 'name', cur.name, 'color', cur.color, 'multiplier', cur.multiplier, 'spend', v_spend, 'brand_id', v_set,
    'next', case when nxt.id is null then null else jsonb_build_object('code', nxt.code, 'name', nxt.name, 'min_spend', nxt.min_spend, 'remaining', nxt.min_spend - greatest(v_spend, 0)) end);
end $$;

drop function if exists pos_loyalty_calc(uuid, text, uuid, timestamptz, numeric, jsonb, integer);
create or replace function pos_loyalty_calc(p_branch uuid, p_channel text, p_customer uuid, p_at timestamptz,
  p_net numeric, p_items jsonb, p_redeemed integer, p_sim jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_brand uuid; prog loyalty_programs; r loyalty_rules;
  base integer := 0; mult numeric := 1; mult_name text; item_pts integer := 0; bonus integer := 0; tier_pts integer := 0; total integer; capped boolean := false;
  parts jsonb := '[]'; seg text; q numeric; n integer; tier jsonb; t loyalty_tiers;
  lt timestamp := coalesce(p_at, now()) at time zone 'Asia/Bangkok'; at_ts timestamptz := coalesce(p_at, now());
  v_birth date; is_bday_day boolean := false; is_bday_month boolean := false; is_first boolean := false;
begin
  select brand_id into v_brand from branches where id = p_branch;
  select * into prog from loyalty_programs where brand_id = v_brand and active;
  if not found then select * into prog from loyalty_programs where brand_id is null and active; end if;
  if not found then return jsonb_build_object('points', 0, 'reason', 'no_program', 'parts', '[]'::jsonb); end if;
  -- ระดับสมาชิก (จำลองได้)
  if p_sim ? 'tier_code' and nullif(p_sim->>'tier_code', '') is not null then
    select * into t from loyalty_tiers where code = p_sim->>'tier_code' and active
      and brand_id is not distinct from (case when exists (select 1 from loyalty_tiers where brand_id = v_brand and active) then v_brand end) limit 1;
    if found then tier := jsonb_build_object('code', t.code, 'name', t.name, 'color', t.color, 'multiplier', t.multiplier, 'simulated', true); end if;
  elsif p_customer is not null then
    tier := loyalty_customer_tier(p_customer, v_brand, at_ts);
  end if;
  if coalesce(p_redeemed, 0) > 0 and not prog.earn_on_redeemed_bill then
    return jsonb_build_object('points', 0, 'reason', 'redeemed_bill', 'program_id', prog.id, 'tier', tier, 'parts', '[]'::jsonb);
  end if;
  if coalesce(p_net, 0) < prog.min_spend then
    return jsonb_build_object('points', 0, 'reason', 'below_min_spend', 'min_spend', prog.min_spend, 'program_id', prog.id, 'tier', tier, 'parts', '[]'::jsonb);
  end if;
  base := floor(coalesce(p_net, 0) / prog.spend_per_unit)::integer * prog.points_per_unit;
  parts := parts || jsonb_build_array(jsonb_build_object('kind', 'base', 'label', format('ทุก %s บาท ได้ %s แต้ม', prog.spend_per_unit, prog.points_per_unit), 'points', base));
  -- เงื่อนไขลูกค้า (จริง หรือจำลอง)
  if p_sim is not null then
    is_bday_day := coalesce((p_sim->>'birthday')::boolean, false); is_bday_month := is_bday_day or coalesce((p_sim->>'birthday_month')::boolean, false);
    is_first := coalesce((p_sim->>'first_purchase')::boolean, false);
  elsif p_customer is not null then
    select birth_date into v_birth from customers where id = p_customer;
    if v_birth is not null then
      is_bday_month := extract(month from v_birth) = extract(month from lt);
      is_bday_day := is_bday_month and extract(day from v_birth) = extract(day from lt);
    end if;
    is_first := not exists (select 1 from orders o where o.customer_id = p_customer and o.status <> 'voided'
                             and coalesce(o.sale_occurred_at, o.created_at) < at_ts - interval '1 second');
  end if;
  seg := case when p_customer is null then null else customer_segment(p_customer) end;
  for r in
    select * from loyalty_rules
     where active and archived_at is null
       and (starts_at is null or at_ts >= starts_at) and (ends_at is null or at_ts < ends_at)
       and (cardinality(days_of_week) = 0 or extract(dow from lt)::int = any(days_of_week))
       and (case when time_from is not null and time_to is not null and time_from > time_to
                 then lt::time >= time_from or lt::time < time_to
                 else (time_from is null or lt::time >= time_from) and (time_to is null or lt::time < time_to) end)
       and (cardinality(branch_ids) = 0 or p_branch = any(branch_ids))
       and (cardinality(channels) = 0 or p_channel = any(channels))
       and (target_segment = 'all' or seg = target_segment)
       and (brand_id is null or kind = 'per_item' or brand_id = v_brand)
       and (customer_condition = 'none'
            or (customer_condition = 'birthday_day' and is_bday_day)
            or (customer_condition = 'birthday_month' and is_bday_month)
            or (customer_condition = 'first_purchase' and is_first))
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
  if coalesce((tier->>'multiplier')::numeric, 1) > 1 then
    tier_pts := floor(base * ((tier->>'multiplier')::numeric - 1))::integer;
    parts := parts || jsonb_build_array(jsonb_build_object('kind', 'tier', 'label', 'สมาชิก ' || (tier->>'name'), 'multiplier', (tier->>'multiplier')::numeric, 'points', tier_pts));
  end if;
  total := floor(base * mult)::integer + tier_pts + item_pts + bonus;
  if prog.max_points_per_bill is not null and total > prog.max_points_per_bill then
    parts := parts || jsonb_build_array(jsonb_build_object('kind', 'cap', 'label', format('เพดาน %s แต้มต่อบิล', prog.max_points_per_bill), 'points', prog.max_points_per_bill - total));
    total := prog.max_points_per_bill; capped := true;
  end if;
  return jsonb_build_object('points', greatest(total, 0), 'base', base, 'multiplier', mult, 'capped', capped, 'tier', tier,
    'program_id', prog.id, 'brand_id', v_brand, 'expiry_months', prog.expiry_months, 'parts', parts);
end $$;
revoke all on function pos_loyalty_calc(uuid,text,uuid,timestamptz,numeric,jsonb,integer,jsonb) from public, anon, authenticated;
revoke all on function loyalty_customer_tier(uuid,uuid,timestamptz) from public, anon, authenticated;

-- ได้แต้มตอนจบ transaction + บันทึกระดับปัจจุบันของลูกค้า
create or replace function fn_loyalty_order_earn()
returns trigger language plpgsql security definer set search_path = public as $$
declare o orders; calc jsonb; v_earn int; v_bal int; v_bw int; v_items jsonb; v_tier text;
begin
  select * into o from orders where id = NEW.id;
  if not found or o.customer_id is null or o.status <> 'completed' then return null; end if;
  if exists (select 1 from loyalty_ledger where order_id = o.id and kind = 'earn') then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'is_gift', is_gift)), '[]') into v_items from order_items where order_id = o.id;
  calc := pos_loyalty_calc(o.branch_id, o.channel::text, o.customer_id, coalesce(o.sale_occurred_at, o.created_at), o.grand_total, v_items,
    coalesce((o.promo_snapshot->>'redeem_points')::int, 0));
  -- ระดับหลังบิลนี้ (รวมบิลนี้) สำหรับแสดงผล
  v_tier := loyalty_customer_tier(o.customer_id, (calc->>'brand_id')::uuid, now() + interval '1 second')->>'code';
  if v_tier is not null then
    update customers set tier = v_tier where id = o.customer_id and tier is distinct from v_tier;
    if (calc->>'brand_id') is not null then
      update brand_wallets set tier = v_tier where customer_id = o.customer_id and brand_id = (calc->>'brand_id')::uuid and tier is distinct from v_tier;
    end if;
  end if;
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

-- สถิติภาพรวมหน้าแต้มสะสม (N วันล่าสุด · แบรนด์เดียวหรือทั้งหมด)
create or replace function pos_loyalty_stats(p_brand uuid default null, p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with l as (select * from loyalty_ledger where created_at >= now() - make_interval(days => greatest(p_days, 1)) and (p_brand is null or brand_id = p_brand))
  select jsonb_build_object(
    'days', p_days,
    'earned', coalesce((select sum(points_delta) from l where kind = 'earn'), 0),
    'redeemed', coalesce((select -sum(points_delta) from l where kind = 'redeem'), 0),
    'expired', coalesce((select -sum(points_delta) from l where kind = 'expire'), 0),
    'earning_bills', (select count(distinct order_id) from l where kind = 'earn'),
    'members_active', (select count(distinct customer_id) from l),
    'outstanding', case when p_brand is null then (select coalesce(sum(points), 0) from customers) else (select coalesce(sum(points), 0) from brand_wallets where brand_id = p_brand) end,
    'tiers', coalesce((select jsonb_object_agg(coalesce(t, 'none'), n) from (
        select case when p_brand is null then c.tier else w.tier end t, count(*) n
          from customers c left join brand_wallets w on w.customer_id = c.id and w.brand_id = p_brand
         where p_brand is null or w.customer_id is not null group by 1) s), '{}'::jsonb))
$$;
revoke all on function pos_loyalty_stats(uuid, integer) from public, anon, authenticated;
