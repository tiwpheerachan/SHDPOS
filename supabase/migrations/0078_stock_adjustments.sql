-- 0078 · ใบขอปรับสต๊อก + อนุมัติ (UAT F051 · T051: เสียลด 2 → stock 8 มูลค่าลด 100 มีผู้อนุมัติและเอกสาร)
--   ขอปรับ (ยังไม่แตะสต๊อก) → ผู้อนุมัติ (ต้องไม่ใช่ผู้ขอ) อนุมัติ = ปรับสต๊อกครั้งเดียว + ledger ตามประเภท / ปฏิเสธพร้อมเหตุผล
--   เหตุผลเป็นรหัส: damage ของเสีย · lost สูญหาย · expired หมดอายุ/เสื่อม · internal_use ใช้ภายใน/ตัวโชว์ · found พบเพิ่ม · correction แก้ยอดผิด
--   มูลค่า = จำนวน × ต้นทุนมาตรฐาน · สินค้า SN ลดต้องระบุ SN (เสีย→defective · หาย→missing) · เพิ่มสินค้า SN ใช้การรับเข้าแทน
--   กันติดลบ ทั้งตอนขอและตอนอนุมัติ · สาขาผูกคลังกลางปรับที่ OneWarehouse · freeze ระหว่างตรวจนับมีผลอัตโนมัติ (trigger 0072)
create table if not exists pos_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  adj_no text not null unique,
  client_uuid uuid unique,
  branch_id uuid not null references branches(id),
  reason_code text not null check (reason_code in ('damage','lost','expired','internal_use','found','correction')),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  lines jsonb not null,
  total_value numeric not null default 0,
  requested_by uuid not null references employees(id), requested_at timestamptz not null default now(),
  decided_by uuid references employees(id), decided_at timestamptz, decision_note text,
  version integer not null default 1
);
create index if not exists pos_stock_adjustments_branch on pos_stock_adjustments(branch_id, status, requested_at desc);
alter table pos_stock_adjustments enable row level security;
revoke all on pos_stock_adjustments from anon, authenticated;

create or replace function pos_adjust_request(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a pos_stock_adjustments; v_branch uuid := (p_payload->>'branch_id')::uuid; v_reason text := p_payload->>'reason_code';
  ln jsonb; p products; d numeric; st stock_levels; avail numeric; sns text[]; out jsonb := '[]'::jsonb; total numeric := 0; seen uuid[] := '{}'; v_no text; v_id uuid;
begin
  perform pos_assert_actor_active(p_actor);
  select * into a from pos_stock_adjustments where client_uuid = nullif(p_payload->>'client_uuid','')::uuid;
  if found then return jsonb_build_object('id', a.id, 'adj_no', a.adj_no, 'status', a.status, 'replay', true); end if;
  if not pos_work_branch_access(p_actor, v_branch) then raise exception 'adjust_branch_forbidden'; end if;
  if exists (select 1 from pos_warehouse_links w where w.branch_id = v_branch) then raise exception 'adjust_ow_branch'; end if;
  if v_reason is null or v_reason not in ('damage','lost','expired','internal_use','found','correction') then raise exception 'adjust_reason_invalid'; end if;
  -- แก้ยอดผิด/ใช้ภายใน ต้องอธิบายเพิ่ม
  if v_reason in ('correction','internal_use') and length(btrim(coalesce(p_payload->>'note',''))) < 3 then raise exception 'adjust_note_required'; end if;
  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') = 0 or jsonb_array_length(p_payload->'lines') > 200 then raise exception 'adjust_no_lines'; end if;
  for ln in select value from jsonb_array_elements(p_payload->'lines') loop
    select * into p from products where id = (ln->>'product_id')::uuid;
    if not found or not p.is_stocked then raise exception 'adjust_product_invalid'; end if;
    if p.id = any(seen) then raise exception 'adjust_duplicate_line: %', p.sku; end if;
    seen := seen || p.id;
    d := round((ln->>'delta')::numeric, 3);
    if d is null or d = 0 then raise exception 'adjust_zero_delta: %', p.sku; end if;
    -- ทิศทางต้องตรงเหตุผล
    if v_reason in ('damage','lost','expired','internal_use') and d > 0 then raise exception 'adjust_direction: %', p.sku; end if;
    if v_reason = 'found' and d < 0 then raise exception 'adjust_direction: %', p.sku; end if;
    sns := '{}';
    if p.track_serial then
      if d > 0 then raise exception 'adjust_serial_increase_use_receive: %', p.sku; end if;
      sns := array(select distinct upper(btrim(x)) from jsonb_array_elements_text(coalesce(ln->'serials','[]')) x where btrim(x) <> '');
      if cardinality(sns) <> abs(d) then raise exception 'adjust_serials_required: %', p.sku; end if;
      if exists (select 1 from unnest(sns) s where not exists (select 1 from serials sr where upper(btrim(sr.serial_no)) = s and sr.product_id = p.id and sr.branch_id = v_branch and sr.status = 'in_stock')) then
        raise exception 'adjust_serial_not_in_stock: %', (select s from unnest(sns) s where not exists (select 1 from serials sr where upper(btrim(sr.serial_no)) = s and sr.product_id = p.id and sr.branch_id = v_branch and sr.status = 'in_stock') limit 1);
      end if;
    end if;
    if d < 0 then
      select * into st from stock_levels where branch_id = v_branch and product_id = p.id;
      avail := coalesce(st.qty_on_hand,0) - coalesce(st.qty_reserved,0) - coalesce(st.qty_reserved_order,0);
      if avail + d < 0 then raise exception 'adjust_negative: % (ขายได้ %)', p.sku, avail; end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', p.name_th, 'delta', d, 'unit_cost', coalesce(p.cost,0),
      'value', round(d * coalesce(p.cost,0), 2), 'serials', to_jsonb(sns)));
    total := total + round(d * coalesce(p.cost,0), 2);
  end loop;
  v_no := pos_next_doc_no(v_branch, 'stock_adjustment', 'ADJ');
  insert into pos_stock_adjustments(adj_no, client_uuid, branch_id, reason_code, note, lines, total_value, requested_by)
  values (v_no, nullif(p_payload->>'client_uuid','')::uuid, v_branch, v_reason, nullif(left(btrim(coalesce(p_payload->>'note','')),500),''), out, total, p_actor)
  returning id into v_id;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('stock_adjust_request', p_actor, v_branch, 'pos_stock_adjustments', v_id, v_no, total, jsonb_build_object('reason', v_reason, 'lines', out));
  return jsonb_build_object('id', v_id, 'adj_no', v_no, 'status', 'pending', 'total_value', total);
end $$;

create or replace function pos_adjust_decide(p_actor uuid, p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a pos_stock_adjustments; ln jsonb; st stock_levels; avail numeric; d numeric; sn text; sid uuid; mt movement_type;
begin
  perform pos_assert_actor_active(p_actor);
  select * into a from pos_stock_adjustments where id = p_id for update;
  if not found then raise exception 'adjust_not_found'; end if;
  if a.status in ('approved','rejected') then return jsonb_build_object('status', a.status, 'replay', true); end if;
  if a.status <> 'pending' then raise exception 'adjust_wrong_status: %', a.status; end if;
  if not pos_work_branch_access(p_actor, a.branch_id) then raise exception 'adjust_branch_forbidden'; end if;
  if p_actor = a.requested_by then raise exception 'adjust_self_approval'; end if;
  if not p_approve then
    if length(btrim(coalesce(p_note,''))) < 3 then raise exception 'adjust_reject_reason_required'; end if;
    update pos_stock_adjustments set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = btrim(p_note), version = version + 1 where id = p_id;
    insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, after_data)
    values ('stock_adjust_reject', p_actor, a.branch_id, 'pos_stock_adjustments', a.id, a.adj_no, jsonb_build_object('reason', btrim(p_note)));
    return jsonb_build_object('status', 'rejected');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('checkout:'||a.branch_id::text,0));
  mt := case a.reason_code when 'damage' then 'damage' when 'expired' then 'damage' else 'manual_adjust' end;
  for ln in select value from jsonb_array_elements(a.lines) loop
    d := (ln->>'delta')::numeric;
    if d < 0 then
      select * into st from stock_levels where branch_id = a.branch_id and product_id = (ln->>'product_id')::uuid for update;
      avail := coalesce(st.qty_on_hand,0) - coalesce(st.qty_reserved,0) - coalesce(st.qty_reserved_order,0);
      if avail + d < 0 then raise exception 'adjust_negative: % (ขายได้ %)', ln->>'sku', avail; end if;
    end if;
    if jsonb_array_length(coalesce(ln->'serials','[]')) > 0 then
      for sn in select jsonb_array_elements_text(ln->'serials') loop
        select id into sid from serials where upper(btrim(serial_no)) = sn and product_id = (ln->>'product_id')::uuid and branch_id = a.branch_id and status = 'in_stock' for update;
        if sid is null then raise exception 'adjust_serial_not_in_stock: %', sn; end if;
        update serials set status = (case when a.reason_code in ('damage','expired') then 'defective' when a.reason_code = 'lost' then 'missing' else 'scrapped' end)::serial_status,
               note = concat_ws(' · ', nullif(note,''), a.adj_no), updated_at = now() where id = sid;
        perform apply_stock_movement(a.branch_id, (ln->>'product_id')::uuid, mt, -1, 'pos_stock_adjustments', a.id, a.adj_no, p_actor, sid, (ln->>'unit_cost')::numeric, a.reason_code || ': ' || coalesce(a.note,''));
      end loop;
    else
      perform apply_stock_movement(a.branch_id, (ln->>'product_id')::uuid, mt, d, 'pos_stock_adjustments', a.id, a.adj_no, p_actor, null, (ln->>'unit_cost')::numeric, a.reason_code || ': ' || coalesce(a.note,''));
    end if;
  end loop;
  update pos_stock_adjustments set status = 'approved', decided_by = p_actor, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note,'')),''), version = version + 1 where id = p_id;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('stock_adjust_approve', p_actor, a.branch_id, 'pos_stock_adjustments', a.id, a.adj_no, a.total_value, jsonb_build_object('reason', a.reason_code, 'requested_by', a.requested_by, 'lines', a.lines));
  return jsonb_build_object('status', 'approved', 'total_value', a.total_value);
end $$;

create or replace function pos_adjust_cancel(p_actor uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a pos_stock_adjustments;
begin
  perform pos_assert_actor_active(p_actor);
  select * into a from pos_stock_adjustments where id = p_id for update;
  if not found then raise exception 'adjust_not_found'; end if;
  if a.status = 'cancelled' then return jsonb_build_object('status', 'cancelled', 'replay', true); end if;
  if a.status <> 'pending' then raise exception 'adjust_wrong_status: %', a.status; end if;
  if a.requested_by <> p_actor then raise exception 'adjust_cancel_owner_only'; end if;
  update pos_stock_adjustments set status = 'cancelled', decided_by = p_actor, decided_at = now(), version = version + 1 where id = p_id;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no) values ('stock_adjust_cancel', p_actor, a.branch_id, 'pos_stock_adjustments', a.id, a.adj_no);
  return jsonb_build_object('status', 'cancelled');
end $$;

revoke all on function pos_adjust_request(uuid,jsonb), pos_adjust_decide(uuid,uuid,boolean,text), pos_adjust_cancel(uuid,uuid) from public, anon, authenticated;
grant execute on function pos_adjust_request(uuid,jsonb), pos_adjust_decide(uuid,uuid,boolean,text), pos_adjust_cancel(uuid,uuid) to service_role;
