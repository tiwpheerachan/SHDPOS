-- 0084 · ประวัติราคา (ไทม์ไลน์ทุกการเปลี่ยน) + ชุดนำเข้าราคา (import batch) ที่ย้อนกลับได้
--   • pos_price_events: บันทึกอัตโนมัติด้วย trigger ทุกครั้งที่ราคาหลักเปลี่ยน หรือกฎราคาช่วงเวลาถูกสร้าง/แก้/เปลี่ยนสถานะ
--       เก็บ ก่อน/หลัง + สินค้าที่กระทบ (product_ids) + ผู้ทำ + ชุดนำเข้า → ดูไทม์ไลน์รายสินค้า / นำราคาเดิมกลับมาใช้
--   • pos_price_batches: 1 การนำเข้าไฟล์ = 1 ชุด (ทั้งหมดหรือไม่มีเลย) · ย้อนกลับได้ทั้งชุด
--       ย้อนกลับ: กฎที่ชุดสร้าง → ยกเลิก · ราคาหลักที่ชุดเปลี่ยน → คืนค่าเดิม เฉพาะที่ยังเป็นค่าที่ชุดตั้ง (ถ้ามีคนแก้ต่อแล้ว = แจ้งชนกัน ไม่ทับ)
--   • ผู้ทำ/ชุด ส่งผ่าน set_config('pos.actor'|'pos.batch') ภายในทรานแซกชัน
create table if not exists pos_price_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'import' check (kind in ('import','restore')),
  title text not null,
  file_name text,
  status text not null default 'applied' check (status in ('applied','reverted')),
  summary jsonb not null default '{}',
  created_by uuid references employees(id), created_at timestamptz not null default now(),
  reverted_by uuid references employees(id), reverted_at timestamptz, revert_reason text, revert_result jsonb
);
alter table pos_price_rules add column if not exists batch_id uuid references pos_price_batches(id);

create table if not exists pos_price_events (
  id bigserial primary key,
  kind text not null check (kind in ('list_price','rule_create','rule_update','rule_status')),
  product_ids uuid[] not null default '{}',
  rule_id uuid,
  batch_id uuid references pos_price_batches(id),
  before jsonb, after jsonb,
  actor_id uuid references employees(id),
  at timestamptz not null default now()
);
create index if not exists pos_price_events_products on pos_price_events using gin(product_ids);
create index if not exists pos_price_events_batch on pos_price_events(batch_id);
alter table pos_price_batches enable row level security;
alter table pos_price_events enable row level security;
revoke all on pos_price_batches, pos_price_events from anon, authenticated;

create or replace function pos_price_ctx(p_key text) returns uuid language sql stable set search_path = public, pg_temp as $$
  select nullif(current_setting('pos.' || p_key, true), '')::uuid
$$;

-- ราคาหลักเปลี่ยน → บันทึก
create or replace function pos_price_event_list() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.price is distinct from old.price then
    insert into pos_price_events(kind, product_ids, batch_id, before, after, actor_id)
    values ('list_price', array[new.id], pos_price_ctx('batch'), jsonb_build_object('price', old.price), jsonb_build_object('price', new.price, 'sku', new.sku), pos_price_ctx('actor'));
  end if;
  return new;
end $$;
drop trigger if exists pos_price_event_list on products;
create trigger pos_price_event_list after update of price on products for each row execute function pos_price_event_list();

-- สินค้าที่กฎครอบ (ณ ตอนนี้) — ใช้ผูกเหตุการณ์กับไทม์ไลน์รายสินค้า
create or replace function pos_price_rule_products(r pos_price_rules) returns uuid[] language sql stable set search_path = public, pg_temp as $$
  select case r.scope when 'sku' then r.product_ids
    else coalesce((select array_agg(p.id) from products p where (r.scope = 'category' and p.category_id = r.category_id and (r.brand_id is null or p.brand_id = r.brand_id)) or (r.scope = 'brand' and p.brand_id = r.brand_id)), '{}') end
$$;
create or replace function pos_price_event_rule() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare k text;
begin
  k := case when tg_op = 'INSERT' then 'rule_create'
            when old.status is distinct from new.status and (to_jsonb(old) - 'status' - 'version' - 'updated_at' - 'updated_by') = (to_jsonb(new) - 'status' - 'version' - 'updated_at' - 'updated_by') then 'rule_status'
            else 'rule_update' end;
  insert into pos_price_events(kind, product_ids, rule_id, batch_id, before, after, actor_id)
  values (k, pos_price_rule_products(new), new.id, coalesce(pos_price_ctx('batch'), case when tg_op = 'INSERT' then new.batch_id end),
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), coalesce(pos_price_ctx('actor'), new.updated_by, new.created_by));
  return new;
end $$;
drop trigger if exists pos_price_event_rule on pos_price_rules;
create trigger pos_price_event_rule after insert or update on pos_price_rules for each row execute function pos_price_event_rule();

-- ตั้งราคาหลัก: ส่งผู้ทำให้ trigger
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
  perform set_config('pos.actor', p_actor::text, true);
  update products set price = round(p_price, 2), updated_at = now() where id = p.id;
  insert into audit_logs(action, actor_id, ref_table, ref_id, ref_no, before_data, after_data)
  values ('list_price_update', p_actor, 'products', p.id, p.sku, jsonb_build_object('price', v_old), jsonb_build_object('price', round(p_price, 2), 'reason', btrim(p_reason)));
  return jsonb_build_object('id', p.id, 'price', round(p_price, 2), 'before', v_old);
end $$;

-- นำเข้าราคา (ทั้งชุดหรือไม่มีเลย)
--   p_rows: [{product_id, list_price?, rule?: {name, price_type, mode, value, rounding, starts_at, ends_at, branch_ids[]}}]
create or replace function pos_import_prices(p_actor uuid, p_meta jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b pos_price_batches; x jsonb; r jsonb; p products; n_list int := 0; n_rule int := 0; v_list numeric;
begin
  perform pos_assert_actor_active(p_actor);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'price_import_empty'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'price_import_too_large'; end if;
  insert into pos_price_batches(kind, title, file_name, created_by)
  values ('import', left(coalesce(nullif(btrim(p_meta->>'title'),''), 'นำเข้าราคา'), 200), left(p_meta->>'file_name', 200), p_actor) returning * into b;
  perform set_config('pos.actor', p_actor::text, true);
  perform set_config('pos.batch', b.id::text, true);
  for x in select value from jsonb_array_elements(p_rows) loop
    select * into p from products where id = (x->>'product_id')::uuid for update;
    if not found then raise exception 'price_import_product_not_found: %', x->>'product_id'; end if;
    if x ? 'list_price' and jsonb_typeof(x->'list_price') = 'number' then
      v_list := round((x->>'list_price')::numeric, 2);
      if v_list <= 0 or v_list > 10000000 then raise exception 'price_import_invalid_list: %', p.sku; end if;
      if v_list <> p.price then update products set price = v_list, updated_at = now() where id = p.id; n_list := n_list + 1; end if;
    end if;
    r := x->'rule';
    if r is not null and jsonb_typeof(r) = 'object' then
      insert into pos_price_rules(name, price_type, scope, brand_id, product_ids, mode, value, rounding, branch_ids, starts_at, ends_at, note, created_by, updated_by, batch_id)
      values (left(coalesce(nullif(btrim(r->>'name'),''), b.title), 120), coalesce(r->>'price_type','monthly'), 'sku', p.brand_id, array[p.id],
        r->>'mode', (r->>'value')::numeric, coalesce(r->>'rounding','baht'),
        coalesce(array(select (y)::uuid from jsonb_array_elements_text(coalesce(r->'branch_ids','[]')) y), '{}'),
        (r->>'starts_at')::timestamptz, (r->>'ends_at')::timestamptz, 'นำเข้าจากไฟล์: ' || coalesce(b.file_name, b.title), p_actor, p_actor, b.id);
      n_rule := n_rule + 1;
    end if;
  end loop;
  update pos_price_batches set summary = jsonb_build_object('rows', jsonb_array_length(p_rows), 'list_changed', n_list, 'rules_created', n_rule) where id = b.id;
  insert into audit_logs(action, actor_id, ref_table, ref_id, ref_no, after_data)
  values ('price_import', p_actor, 'pos_price_batches', b.id, b.title, jsonb_build_object('file', b.file_name, 'rows', jsonb_array_length(p_rows), 'list_changed', n_list, 'rules_created', n_rule));
  return jsonb_build_object('batch_id', b.id, 'rows', jsonb_array_length(p_rows), 'list_changed', n_list, 'rules_created', n_rule);
end $$;

-- ย้อนกลับทั้งชุด
create or replace function pos_revert_price_batch(p_actor uuid, p_batch uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b pos_price_batches; e pos_price_events; cur numeric; n_list int := 0; n_rule int := 0; conflicts jsonb := '[]'; res jsonb;
begin
  perform pos_assert_actor_active(p_actor);
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'price_revert_reason_required'; end if;
  select * into b from pos_price_batches where id = p_batch for update;
  if not found then raise exception 'price_batch_not_found'; end if;
  if b.status = 'reverted' then return jsonb_build_object('duplicate', true, 'result', b.revert_result); end if;
  perform set_config('pos.actor', p_actor::text, true);
  -- ราคาหลัก: ย้อนจากเหตุการณ์ล่าสุดไปเก่า · คืนเฉพาะที่ยังเป็นค่าที่ชุดนี้ตั้ง
  for e in select * from pos_price_events where batch_id = b.id and kind = 'list_price' order by id desc loop
    select price into cur from products where id = e.product_ids[1] for update;
    if cur = (e.after->>'price')::numeric then
      update products set price = (e.before->>'price')::numeric, updated_at = now() where id = e.product_ids[1];
      n_list := n_list + 1;
    else
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('sku', e.after->>'sku', 'batch_price', (e.after->>'price')::numeric, 'current', cur));
    end if;
  end loop;
  update pos_price_rules set status = 'cancelled', updated_by = p_actor, updated_at = now(), version = version + 1 where batch_id = b.id and status <> 'cancelled';
  get diagnostics n_rule = row_count;
  res := jsonb_build_object('list_restored', n_list, 'rules_cancelled', n_rule, 'conflicts', conflicts);
  update pos_price_batches set status = 'reverted', reverted_by = p_actor, reverted_at = now(), revert_reason = btrim(p_reason), revert_result = res where id = b.id;
  insert into audit_logs(action, actor_id, ref_table, ref_id, ref_no, after_data) values ('price_import_revert', p_actor, 'pos_price_batches', b.id, b.title, res || jsonb_build_object('reason', btrim(p_reason)));
  return res;
end $$;

-- บันทึกกฎแบบเดิม + ส่งผู้ทำให้ trigger (คงสัญญาเดิมของ 0081)
create or replace function pos_save_price_rule(p_actor uuid, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r pos_price_rules; v_id uuid := nullif(p_rule->>'id','')::uuid; v_scope text := p_rule->>'scope'; v_ids uuid[]; v_before jsonb;
begin
  perform pos_assert_actor_active(p_actor);
  perform set_config('pos.actor', p_actor::text, true);
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

revoke all on function pos_price_ctx(text), pos_price_event_list(), pos_price_rule_products(pos_price_rules), pos_price_event_rule(),
  pos_import_prices(uuid, jsonb, jsonb), pos_revert_price_batch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function pos_import_prices(uuid, jsonb, jsonb), pos_revert_price_batch(uuid, uuid, text), pos_set_list_price(uuid, uuid, numeric, text), pos_save_price_rule(uuid, jsonb) to service_role;
