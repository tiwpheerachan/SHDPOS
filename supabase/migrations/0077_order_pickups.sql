-- 0077 · จ่ายเต็มแล้วมารับของทีหลัง (นโยบายร้าน: ไม่รับมัดจำ — ลูกค้าโอนเต็มจำนวน ออกบิล แล้วค่อยมารับ) · UAT F020/F021
--   • บิลปิดตามปกติ (รับเงินครบ · ส่ง JST ตามปกติ · สต๊อกตัดตอนขาย · SN ระบุตอนขาย = เครื่องของลูกค้าคนนี้)
--   • pos_order_pickups = ของที่ยังอยู่ในร้านรอลูกค้ามารับ · ส่งมอบได้หลายครั้ง (บางส่วน) · สแกน SN ต้องตรงกับบิล · บันทึกผู้รับ/ผู้ส่งมอบ
--   • คืนเงินก่อนมารับ (ใบรับคืน/ยกเลิกบิล) → ยอดรอรับลดอัตโนมัติ (ไม่ส่งมอบของที่คืนเงินไปแล้ว)
create table if not exists pos_order_pickups (
  order_id uuid primary key references orders(id),
  branch_id uuid not null references branches(id),
  status text not null default 'pending' check (status in ('pending','partial','completed','cancelled')),
  due_date date,
  contact_name text, contact_phone text, note text,
  items jsonb not null,            -- [{order_item_id, product_id, sku, name, qty, picked_qty, returned_qty, serials[], picked_serials[]}]
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  version integer not null default 1
);
create index if not exists pos_order_pickups_open on pos_order_pickups(branch_id, status) where status in ('pending','partial');
create table if not exists pos_pickup_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pos_order_pickups(order_id),
  kind text not null check (kind in ('created','handover','returned','cancelled')),
  items jsonb not null default '[]',
  receiver_name text, note text,
  actor_id uuid references employees(id),
  created_at timestamptz not null default now()
);
create index if not exists pos_pickup_events_order on pos_pickup_events(order_id, created_at);
alter table pos_order_pickups enable row level security;
alter table pos_pickup_events enable row level security;
revoke all on pos_order_pickups, pos_pickup_events from anon, authenticated;

-- สร้างรายการรอรับจากบิลที่ขายเสร็จแล้ว (ทำซ้ำได้ — คืนรายการเดิม)
create or replace function pos_pickup_create(p_actor uuid, p_order_client uuid, p_due date, p_contact jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; pk pos_order_pickups; v_items jsonb;
begin
  perform pos_assert_actor_active(p_actor);
  select * into o from orders where client_uuid = p_order_client for update;
  if not found then raise exception 'pickup_order_not_found'; end if;
  if not pos_work_branch_access(p_actor, o.branch_id) then raise exception 'pickup_branch_forbidden'; end if;
  select * into pk from pos_order_pickups where order_id = o.id;
  if found then return jsonb_build_object('order_id', o.id, 'status', pk.status, 'replay', true); end if;
  if o.status not in ('completed','partially_refunded') then raise exception 'pickup_order_not_eligible'; end if;
  if p_due is not null and (p_due < (now() at time zone 'Asia/Bangkok')::date or p_due > (now() at time zone 'Asia/Bangkok')::date + 180) then raise exception 'pickup_due_invalid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id', it.id, 'product_id', it.product_id, 'sku', it.sku, 'name', it.name,
           'qty', it.qty - coalesce(it.returned_qty,0), 'picked_qty', 0, 'returned_qty', 0,
           'serials', coalesce((select jsonb_agg(upper(s.serial_no) order by s.serial_no) from order_item_serials s where s.order_item_id = it.id), '[]'::jsonb),
           'picked_serials', '[]'::jsonb) order by it.sort_order), '[]'::jsonb)
    into v_items
    from order_items it where it.order_id = o.id and it.kind = 'goods' and it.qty - coalesce(it.returned_qty,0) > 0;
  if jsonb_array_length(v_items) = 0 then raise exception 'pickup_no_goods'; end if;
  insert into pos_order_pickups(order_id, branch_id, due_date, contact_name, contact_phone, note, items, created_by)
  values (o.id, o.branch_id, p_due, nullif(left(btrim(coalesce(p_contact->>'name', o.customer_name, '')),120),''),
          nullif(left(regexp_replace(coalesce(p_contact->>'phone', o.customer_phone, ''), '[^0-9+]', '', 'g'),20),''), nullif(left(btrim(coalesce(p_note,'')),500),''), v_items, p_actor);
  insert into pos_pickup_events(order_id, kind, items, actor_id, note) values (o.id, 'created', v_items, p_actor, nullif(btrim(coalesce(p_note,'')),''));
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('pickup_create', p_actor, o.branch_id, 'pos_order_pickups', o.id, o.order_no, o.grand_total, jsonb_build_object('due', p_due, 'lines', jsonb_array_length(v_items)));
  return jsonb_build_object('order_id', o.id, 'status', 'pending');
end $$;

-- ส่งมอบ (บางส่วนได้) · p_lines: [{order_item_id, qty, serials:[...]}] · SN ต้องเป็นของบรรทัดนั้นในบิล และยังไม่ถูกส่งมอบ
create or replace function pos_pickup_handover(p_actor uuid, p_order uuid, p_version int, p_lines jsonb, p_receiver text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pk pos_order_pickups; v_list jsonb; ln jsonb; it jsonb; i int; q numeric; rem numeric; sns text[]; sold text[]; done text[]; moved jsonb := '[]'::jsonb; all_done boolean := true;
begin
  perform pos_assert_actor_active(p_actor);
  select * into pk from pos_order_pickups where order_id = p_order for update;
  if not found then raise exception 'pickup_not_found'; end if;
  if not pos_work_branch_access(p_actor, pk.branch_id) then raise exception 'pickup_branch_forbidden'; end if;
  if pk.status not in ('pending','partial') then raise exception 'pickup_not_open: %', pk.status; end if;
  if p_version is not null and p_version <> pk.version then raise exception 'pickup_version_conflict'; end if;
  if length(btrim(coalesce(p_receiver,''))) < 2 then raise exception 'pickup_receiver_required'; end if;
  v_list := pk.items;
  for ln in select value from jsonb_array_elements(coalesce(p_lines,'[]')) loop
    q := coalesce((ln->>'qty')::numeric, 0);
    if q <= 0 then continue; end if;
    i := (select ord - 1 from jsonb_array_elements(v_list) with ordinality e(v, ord) where v->>'order_item_id' = ln->>'order_item_id');
    if i is null then raise exception 'pickup_line_not_found'; end if;
    it := v_list->i;
    rem := (it->>'qty')::numeric - (it->>'picked_qty')::numeric - (it->>'returned_qty')::numeric;
    if q > rem then raise exception 'pickup_qty_exceeds: %', it->>'sku'; end if;
    sold := array(select jsonb_array_elements_text(it->'serials'));
    if cardinality(sold) > 0 then
      sns := array(select distinct upper(btrim(x)) from jsonb_array_elements_text(coalesce(ln->'serials','[]')) x where btrim(x) <> '');
      if cardinality(sns) <> q then raise exception 'pickup_serials_required: %', it->>'sku'; end if;
      done := array(select jsonb_array_elements_text(it->'picked_serials'));
      if exists (select 1 from unnest(sns) s where not s = any(sold)) then raise exception 'pickup_serial_not_in_bill: %', (select s from unnest(sns) s where not s = any(sold) limit 1); end if;
      if exists (select 1 from unnest(sns) s where s = any(done)) then raise exception 'pickup_serial_already_handed: %', (select s from unnest(sns) s where s = any(done) limit 1); end if;
      it := jsonb_set(it, '{picked_serials}', (it->'picked_serials') || to_jsonb(sns));
    else sns := '{}'; end if;
    it := jsonb_set(it, '{picked_qty}', to_jsonb((it->>'picked_qty')::numeric + q));
    v_list := jsonb_set(v_list, array[i::text], it);
    moved := moved || jsonb_build_array(jsonb_build_object('order_item_id', it->>'order_item_id', 'sku', it->>'sku', 'qty', q, 'serials', to_jsonb(sns)));
  end loop;
  if jsonb_array_length(moved) = 0 then raise exception 'pickup_nothing_selected'; end if;
  select bool_and((v->>'qty')::numeric - (v->>'picked_qty')::numeric - (v->>'returned_qty')::numeric <= 0) into all_done from jsonb_array_elements(v_list) v;
  update pos_order_pickups set items = v_list, status = case when all_done then 'completed' else 'partial' end,
         completed_at = case when all_done then now() end, version = version + 1 where order_id = p_order;
  insert into pos_pickup_events(order_id, kind, items, receiver_name, note, actor_id) values (p_order, 'handover', moved, left(btrim(p_receiver),120), nullif(left(btrim(coalesce(p_note,'')),500),''), p_actor);
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, after_data)
  values ('pickup_handover', p_actor, pk.branch_id, 'pos_order_pickups', p_order, (select order_no from orders where id = p_order), jsonb_build_object('items', moved, 'receiver', btrim(p_receiver), 'completed', all_done));
  return jsonb_build_object('status', case when all_done then 'completed' else 'partial' end, 'handed', moved);
end $$;

-- รับคืน/ยกเลิกบิลเสร็จ → หักจากยอดที่ยังไม่ส่งมอบ (SN ที่คืน ออกจากรายการรอรับ)
create or replace function pos_pickup_on_return()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare pk pos_order_pickups; v_list jsonb; ri record; i int; it jsonb; take numeric; open_left numeric; moved jsonb := '[]'::jsonb;
begin
  if not (new.status = 'completed' and old.status is distinct from 'completed') then return new; end if;
  select * into pk from pos_order_pickups where order_id = new.order_id and status in ('pending','partial') for update;
  if not found then return new; end if;
  v_list := pk.items;
  for ri in select order_item_id, qty, serials from return_items where return_id = new.id loop
    i := (select ord - 1 from jsonb_array_elements(v_list) with ordinality e(v, ord) where v->>'order_item_id' = ri.order_item_id::text);
    if i is null then continue; end if;
    it := v_list->i;
    open_left := (it->>'qty')::numeric - (it->>'picked_qty')::numeric - (it->>'returned_qty')::numeric;
    take := least(ri.qty, open_left);
    if take <= 0 then continue; end if;
    it := jsonb_set(it, '{returned_qty}', to_jsonb((it->>'returned_qty')::numeric + take));
    if coalesce(cardinality(ri.serials),0) > 0 then
      it := jsonb_set(it, '{serials}', coalesce((select jsonb_agg(s) from jsonb_array_elements_text(it->'serials') s where not upper(s) = any(select upper(x) from unnest(ri.serials) x)), '[]'::jsonb));
    end if;
    v_list := jsonb_set(v_list, array[i::text], it);
    moved := moved || jsonb_build_array(jsonb_build_object('sku', it->>'sku', 'qty', take));
  end loop;
  if jsonb_array_length(moved) = 0 then return new; end if;
  update pos_order_pickups set items = v_list, version = version + 1,
    status = case when (select bool_and((v->>'qty')::numeric - (v->>'picked_qty')::numeric - (v->>'returned_qty')::numeric <= 0) from jsonb_array_elements(v_list) v)
                  then (case when (select sum((v->>'picked_qty')::numeric) from jsonb_array_elements(v_list) v) > 0 then 'completed' else 'cancelled' end) else status end,
    completed_at = case when (select bool_and((v->>'qty')::numeric - (v->>'picked_qty')::numeric - (v->>'returned_qty')::numeric <= 0) from jsonb_array_elements(v_list) v) then now() end
   where order_id = pk.order_id;
  insert into pos_pickup_events(order_id, kind, items, actor_id, note) values (pk.order_id, 'returned', moved, coalesce(new.approved_by, new.requested_by), 'คืนเงินแล้ว ' || new.return_no);
  return new;
end $$;
drop trigger if exists pos_pickup_on_return on returns;
create trigger pos_pickup_on_return after update of status on returns for each row execute function pos_pickup_on_return();

revoke all on function pos_pickup_create(uuid,uuid,date,jsonb,text), pos_pickup_handover(uuid,uuid,int,jsonb,text,text), pos_pickup_on_return() from public, anon, authenticated;
grant execute on function pos_pickup_create(uuid,uuid,date,jsonb,text), pos_pickup_handover(uuid,uuid,int,jsonb,text,text) to service_role;
