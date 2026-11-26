-- 0081 · ราคาช่วงเวลา (Period price) ทับราคาหลัก (List price) ตามช่วงวันที่/สาขา
--   • ราคาหลัก = products.price (ดึงจากคลังกลาง/ตั้งโดยหัวหน้าแบรนด์) — เป็นฐานเสมอ
--   • ราคาช่วงเวลา = กฎ 1 ข้อ: ขอบเขต (SKU / หมวดในแบรนด์ / ทั้งแบรนด์) × ช่วงเวลา × สาขา
--       ตั้งแบบ ราคาเลย / ลดเป็นบาท / ลดเป็น % → ระบบคิดราคาจริงจากราคาหลักของแต่ละ SKU + ปัดเศษตามที่เลือก
--   • หลายกฎทับกัน: SKU > หมวด > แบรนด์ → เริ่มล่าสุด → สร้างล่าสุด (กฎที่เจาะจงกว่าชนะ)
--   • ตัวคิดราคากลางตัวเดียว pos_effective_prices() ใช้ทั้งหน้าร้าน (แสดง/ใส่ตะกร้า) และเซิร์ฟเวอร์ (ตรวจราคาตอนชำระ)
--   • สิทธิ์ตรวจที่ API (price.period + ขอบเขตแบรนด์) · ทุกการแก้มี audit + version กันเขียนทับกัน
create table if not exists pos_price_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  price_type text not null default 'monthly' check (price_type in ('monthly','launch','clearance','event','member','other')),
  scope text not null check (scope in ('sku','category','brand')),
  brand_id uuid references brands(id),
  category_id uuid references categories(id),
  product_ids uuid[] not null default '{}',
  mode text not null check (mode in ('price','amount','percent')),
  value numeric not null check (value > 0),
  rounding text not null default 'baht' check (rounding in ('none','baht','down10','end9')),
  branch_ids uuid[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (ends_at > starts_at),
  check (mode <> 'percent' or value < 100),
  check ((scope = 'sku' and cardinality(product_ids) > 0) or (scope = 'category' and category_id is not null) or (scope = 'brand' and brand_id is not null))
);
create index if not exists pos_price_rules_window on pos_price_rules(starts_at, ends_at) where status = 'active';
create index if not exists pos_price_rules_products on pos_price_rules using gin(product_ids);
alter table pos_price_rules enable row level security;
revoke all on pos_price_rules from anon, authenticated;

-- ราคาจริงจากกฎ 1 ข้อ
create or replace function pos_price_rule_value(p_mode text, p_value numeric, p_list numeric, p_rounding text)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case
    when raw is null or raw <= 0 then null
    when p_mode = 'price' then round(raw, 2)                       -- ตั้งราคาเอง = ตามที่ตั้ง ไม่ปัด
    when p_rounding = 'baht' then round(raw)
    when p_rounding = 'down10' then greatest(floor(raw / 10) * 10, 1)
    when p_rounding = 'end9' then greatest(floor((raw + 1) / 10) * 10 - 1, 1)
    else round(raw, 2) end
  from (select case p_mode when 'price' then p_value when 'amount' then p_list - p_value when 'percent' then p_list * (1 - p_value / 100) end as raw) x
$$;

-- ราคาที่ใช้ขาย ณ เวลา/สาขา (ทุกสินค้า หรือเฉพาะ p_ids)
create or replace function pos_effective_prices(p_branch uuid, p_ids uuid[] default null, p_at timestamptz default now())
returns table(product_id uuid, list_price numeric, price numeric, rule_id uuid, rule_name text, price_type text, ends_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.price, coalesce(r.v, p.price), r.id, r.name, r.price_type, r.ends_at
  from products p
  left join lateral (
    select x.id, x.name, x.price_type, x.ends_at, pos_price_rule_value(x.mode, x.value, p.price, x.rounding) as v
    from pos_price_rules x
    where x.status = 'active' and x.starts_at <= p_at and x.ends_at > p_at
      and (cardinality(x.branch_ids) = 0 or p_branch = any(x.branch_ids))
      and ((x.scope = 'sku' and p.id = any(x.product_ids))
        or (x.scope = 'category' and x.category_id = p.category_id and (x.brand_id is null or x.brand_id = p.brand_id))
        or (x.scope = 'brand' and x.brand_id = p.brand_id))
      and p.price > 0
      and pos_price_rule_value(x.mode, x.value, p.price, x.rounding) is not null
    order by case x.scope when 'sku' then 0 when 'category' then 1 else 2 end, x.starts_at desc, x.created_at desc
    limit 1
  ) r on true
  where p_ids is null or p.id = any(p_ids)
$$;

-- บันทึกกฎ (สร้าง/แก้) — API ตรวจสิทธิ์+ขอบเขตแบรนด์มาก่อน · ฟังก์ชันนี้ตรวจความถูกต้องของข้อมูล + version + audit
create or replace function pos_save_price_rule(p_actor uuid, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r pos_price_rules; v_id uuid := nullif(p_rule->>'id','')::uuid; v_scope text := p_rule->>'scope'; v_ids uuid[]; v_before jsonb;
begin
  perform pos_assert_actor_active(p_actor);
  v_ids := coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'product_ids','[]')) x), '{}');
  if v_scope = 'sku' and (cardinality(v_ids) = 0 or cardinality(v_ids) > 2000) then raise exception 'price_rule_products_required'; end if;
  if v_scope = 'sku' and exists (select 1 from unnest(v_ids) i where not exists (select 1 from products where id = i)) then raise exception 'price_rule_product_not_found'; end if;
  if v_id is not null then
    select * into r from pos_price_rules where id = v_id for update;
    if not found then raise exception 'price_rule_not_found'; end if;
    if r.version <> coalesce((p_rule->>'version')::int, -1) then raise exception 'price_rule_version_conflict'; end if;
    v_before := to_jsonb(r);
    update pos_price_rules set
      name = btrim(p_rule->>'name'), price_type = coalesce(p_rule->>'price_type','monthly'), scope = v_scope,
      brand_id = nullif(p_rule->>'brand_id','')::uuid, category_id = nullif(p_rule->>'category_id','')::uuid, product_ids = case when v_scope = 'sku' then v_ids else '{}' end,
      mode = p_rule->>'mode', value = (p_rule->>'value')::numeric, rounding = coalesce(p_rule->>'rounding','baht'),
      branch_ids = coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'branch_ids','[]')) x), '{}'),
      starts_at = (p_rule->>'starts_at')::timestamptz, ends_at = (p_rule->>'ends_at')::timestamptz,
      status = coalesce(p_rule->>'status', r.status), note = nullif(btrim(coalesce(p_rule->>'note','')),''),
      updated_by = p_actor, updated_at = now(), version = version + 1
    where id = v_id returning * into r;
  else
    insert into pos_price_rules(name, price_type, scope, brand_id, category_id, product_ids, mode, value, rounding, branch_ids, starts_at, ends_at, note, created_by, updated_by)
    values (btrim(p_rule->>'name'), coalesce(p_rule->>'price_type','monthly'), v_scope, nullif(p_rule->>'brand_id','')::uuid, nullif(p_rule->>'category_id','')::uuid,
      case when v_scope = 'sku' then v_ids else '{}' end, p_rule->>'mode', (p_rule->>'value')::numeric, coalesce(p_rule->>'rounding','baht'),
      coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'branch_ids','[]')) x), '{}'),
      (p_rule->>'starts_at')::timestamptz, (p_rule->>'ends_at')::timestamptz, nullif(btrim(coalesce(p_rule->>'note','')),''), p_actor, p_actor)
    returning * into r;
  end if;
  insert into audit_logs(action, actor_id, ref_table, ref_id, ref_no, before_data, after_data)
  values (case when v_id is null then 'price_rule_create' else 'price_rule_update' end, p_actor, 'pos_price_rules', r.id, r.name, v_before, to_jsonb(r));
  return to_jsonb(r);
end $$;

-- ตั้งราคาหลัก (หัวหน้าแบรนด์/เจ้าของ) — แยกจากการตรวจเปิดขาย (pos_review_product) · บันทึกก่อน/หลัง + เหตุผล
create or replace function pos_set_list_price(p_actor uuid, p_product uuid, p_price numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p products; v_old numeric;
begin
  perform pos_assert_actor_active(p_actor);
  if p_price is null or p_price <= 0 or p_price > 10000000 then raise exception 'list_price_invalid'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'list_price_reason_required'; end if;
  select * into p from products where id = p_product for update;
  if not found then raise exception 'list_price_product_not_found'; end if;
  v_old := p.price;
  if v_old = round(p_price, 2) then return jsonb_build_object('id', p.id, 'price', v_old, 'unchanged', true); end if;
  update products set price = round(p_price, 2), updated_at = now() where id = p.id;
  insert into audit_logs(action, actor_id, ref_table, ref_id, ref_no, before_data, after_data)
  values ('list_price_update', p_actor, 'products', p.id, p.sku, jsonb_build_object('price', v_old), jsonb_build_object('price', round(p_price, 2), 'reason', btrim(p_reason)));
  return jsonb_build_object('id', p.id, 'price', round(p_price, 2), 'before', v_old);
end $$;

revoke all on function pos_price_rule_value(text, numeric, numeric, text), pos_effective_prices(uuid, uuid[], timestamptz),
  pos_save_price_rule(uuid, jsonb), pos_set_list_price(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function pos_price_rule_value(text, numeric, numeric, text), pos_effective_prices(uuid, uuid[], timestamptz),
  pos_save_price_rule(uuid, jsonb), pos_set_list_price(uuid, uuid, numeric, text) to service_role;
