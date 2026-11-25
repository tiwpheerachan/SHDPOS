-- =====================================================================
-- 0062 — คืนสินค้า / ยกเลิกบิล ในโหมดจริง (เดิมปิดทั้งหมด) — เซิร์ฟเวอร์คิดยอดและตัดสินทุกอย่าง
--   pos_return_request : พนักงานขอคืน → returns (pending_approval) · ยอดคืนเงินคิดจากบิลจริงใน DB (ไม่เชื่อเครื่อง)
--                        กันคืนเกิน (ขาย − คืนแล้ว − คำขอที่ค้าง) · SN ต้องระบุถ้าคืนไม่ครบทั้งบรรทัด · idempotent ด้วย client_uuid
--   pos_return_decide  : ผู้มีสิทธิ์ return.approve อนุมัติ/ปฏิเสธ → อนุมัติ = ทำทั้งชุดใน transaction เดียว
--       • สาขาไม่ผูกคลังกลาง : คืนสต๊อก (ขายได้ → on hand · ชำรุด → พักตรวจ) · SN กลับ in_stock / defective
--       • สาขาผูกคลังกลาง   : ไม่แตะสต๊อก POS (OW/JST เป็นเจ้าของ) · SN = returned (ขายไม่ได้) · jst_state = pending
--                              → งาน "ทำรับคืนใน JST" (OW ยังไม่มี API ยกเลิก/คืนบิล) แล้ว "ปรับยอดจาก OW" ดึงสต๊อกกลับ
--       • แต้ม: คืนบางส่วน = หักตามสัดส่วนแต้มที่บิลนี้ได้จริง (ไม่ใช้ /20 ตายตัว) · คืนครบ/ยกเลิก = trigger เดิมคืนทั้งหมด
--       • บิล: refunded / partially_refunded / voided (trigger เดิมคืนสิทธิ์คูปอง/แคมเปญ) · เงินสดคืน = หัก expected_cash ของกะ
-- =====================================================================
alter table returns add column if not exists kind text not null default 'return';
alter table returns add column if not exists ow_linked boolean not null default false;
alter table returns add column if not exists jst_state text not null default 'not_needed';
alter table returns add column if not exists decided_note text;
alter table returns add column if not exists points_reversed integer not null default 0;
do $$ begin
  alter table returns add constraint returns_kind_chk check (kind in ('return','void'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table returns add constraint returns_jst_state_chk check (jst_state in ('not_needed','pending','done'));
exception when duplicate_object then null; end $$;
alter table return_items add column if not exists serials text[] not null default '{}';

alter table pos_work_items drop constraint if exists pos_work_items_source_kind_check;
alter table pos_work_items add constraint pos_work_items_source_kind_check
  check (source_kind in ('manual','deferred_sale','ow_sale','ow_transfer','ow_return'));
create or replace function pos_ow_issue_upsert(p_kind text, p_source uuid, p_branch uuid, p_title text, p_desc text, p_priority text, p_sig text, p_hint uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare t pos_work_items; who uuid;
begin
  if p_kind not in ('ow_sale','ow_transfer','ow_return') then raise exception 'work_invalid_source'; end if;
  select * into t from pos_work_items where source_kind = p_kind and source_id = p_source for update;
  if found then
    if t.source_sig is not distinct from p_sig then return 'same'; end if;
    update pos_work_items set title = left(p_title,200), description = left(coalesce(p_desc,''),10000), priority = p_priority, source_sig = p_sig,
           status = case when status in ('done','cancelled') then 'todo' else status end, completed_at = null,
           version = version + 1, updated_at = now() where id = t.id;
    insert into pos_work_activity(task_id, actor_id, action, body) values (t.id, null, case when t.status in ('done','cancelled') then 'reopened' else 'updated' end, 'ระบบ: ' || left(coalesce(p_desc,''),3000));
    return case when t.status in ('done','cancelled') then 'reopened' else 'updated' end;
  end if;
  who := pos_ow_issue_assignee(p_branch, p_hint);
  if who is null then return 'no_assignee'; end if;
  insert into pos_work_items(branch_id, created_by, assigned_to, title, description, priority, due_at, source_kind, source_id, source_sig)
  values (p_branch, coalesce(case when pos_work_branch_access(p_hint, p_branch) then p_hint end, who), who, left(p_title,200), left(coalesce(p_desc,''),10000), p_priority,
          now() + case p_priority when 'urgent' then interval '2 hours' when 'high' then interval '8 hours' else interval '24 hours' end, p_kind, p_source, p_sig)
  returning * into t;
  insert into pos_work_activity(task_id, actor_id, action, body) values (t.id, null, 'linked', 'ระบบสร้างจากการเชื่อมคลังกลาง/JST');
  return 'created';
end $$;

-- ---------------------------------------------------------------------
-- คำขอคืน/ยกเลิก
--   p: {client_uuid, order_client_uuid, kind: return|void, type: refund|exchange, refund_method,
--       reason_code, reason_note, shift_id, items:[{order_item_id, qty, condition: sellable|defective, serials:[]}]}
-- ---------------------------------------------------------------------
create or replace function pos_return_request(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o orders; it order_items; r returns; rid uuid; v_kind text := coalesce(p_payload->>'kind','return');
  v_type return_type := coalesce(nullif(p_payload->>'type',''),'refund')::return_type;
  x jsonb; q numeric; pend numeric; ratio numeric; lines_total numeric; refund numeric := 0; line_refund numeric;
  sns text[]; sold_sns text[]; cond text; n int := 0;
begin
  perform pos_assert_actor_active(p_actor);
  if v_kind not in ('return','void') then raise exception 'return_invalid_kind'; end if;
  select * into r from returns where client_uuid = (p_payload->>'client_uuid')::uuid;
  if found then return jsonb_build_object('return_id', r.id, 'return_no', r.return_no, 'status', r.status, 'refund_amount', r.refund_amount, 'replay', true); end if;
  select * into o from orders where client_uuid = (p_payload->>'order_client_uuid')::uuid for update;
  if not found then raise exception 'return_order_not_found'; end if;
  if o.status not in ('completed','partially_refunded') then raise exception 'return_order_not_returnable'; end if;
  if not pos_work_branch_access(p_actor, o.branch_id) then raise exception 'return_branch_forbidden'; end if;
  if v_kind = 'void' and (o.status <> 'completed' or exists (select 1 from returns where order_id = o.id and status in ('pending_approval','completed'))) then
    raise exception 'void_has_returns';
  end if;
  select coalesce(sum(line_total),0) into lines_total from order_items where order_id = o.id and not coalesce(is_gift,false);
  ratio := case when lines_total > 0 then o.grand_total / lines_total else 1 end; -- เฉลี่ยส่วนลดท้ายบิล/คูปอง/แต้มลงแต่ละรายการ
  rid := gen_random_uuid();
  insert into returns(id, return_no, client_uuid, order_id, branch_id, shift_id, type, status, reason_code, reason_note, refund_method, refund_amount,
                      requested_by, kind, ow_linked, restock, created_at)
  values (rid, 'RT-' || to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || '-' || upper(substr(replace(rid::text,'-',''),1,5)),
          (p_payload->>'client_uuid')::uuid, o.id, o.branch_id, nullif(p_payload->>'shift_id','')::uuid, v_type, 'pending_approval',
          left(p_payload->>'reason_code',100), left(p_payload->>'reason_note',1000), nullif(p_payload->>'refund_method','')::payment_method, 0,
          p_actor, v_kind, exists (select 1 from pos_warehouse_links w where w.branch_id = o.branch_id), true, now());
  for it in select * from order_items where order_id = o.id order by sort_order loop
    if v_kind = 'void' then
      q := it.qty; cond := 'sellable'; sns := null;
    else
      select value into x from jsonb_array_elements(coalesce(p_payload->'items','[]')) where value->>'order_item_id' = it.id::text;
      if x is null then continue; end if;
      q := coalesce((x->>'qty')::numeric, 0); cond := coalesce(x->>'condition','sellable');
      sns := array(select upper(trim(jsonb_array_elements_text(coalesce(x->'serials','[]')))));
      x := null;
    end if;
    if q <= 0 then continue; end if;
    if cond not in ('sellable','defective') then raise exception 'return_invalid_condition'; end if;
    select coalesce(sum(ri.qty),0) into pend from return_items ri join returns rr on rr.id = ri.return_id
     where ri.order_item_id = it.id and rr.status = 'pending_approval' and rr.id <> rid;
    if q > it.qty - coalesce(it.returned_qty,0) - pend then raise exception 'return_qty_exceeds'; end if;
    -- SN: ครบทั้งบรรทัด = ทุก SN ของบรรทัด · ไม่ครบ = ต้องระบุ และต้องเป็น SN ของบรรทัดนี้
    select array_agg(upper(serial_no)) into sold_sns from order_item_serials where order_item_id = it.id;
    if coalesce(array_length(sold_sns,1),0) > 0 then
      if coalesce(array_length(sns,1),0) = 0 and q = it.qty - coalesce(it.returned_qty,0) then
        sns := array(select s from unnest(sold_sns) s where not exists (select 1 from return_items ri join returns rr on rr.id = ri.return_id
                where ri.order_item_id = it.id and rr.status in ('pending_approval','completed') and s = any(ri.serials)));
      end if;
      if coalesce(array_length(sns,1),0) <> q then raise exception 'return_serials_required'; end if;
      if exists (select 1 from unnest(sns) s where not s = any(sold_sns)) then raise exception 'return_serial_not_in_bill'; end if;
    else
      sns := '{}';
    end if;
    line_refund := case when coalesce(it.is_gift,false) then 0 else round(it.line_total / nullif(it.qty,0) * q * ratio, 2) end;
    refund := refund + line_refund;
    insert into return_items(id, return_id, order_item_id, product_id, sku, name, qty, unit_price, line_total, condition, serials)
    values (gen_random_uuid(), rid, it.id, it.product_id, it.sku, it.name, q, it.unit_price, line_refund, cond, coalesce(sns,'{}'));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'return_no_items'; end if;
  if v_kind = 'void' then refund := o.grand_total; end if;
  refund := least(refund, o.grand_total - coalesce((select sum(refund_amount) from returns where order_id = o.id and status = 'completed'), 0));
  update returns set refund_amount = case when v_type = 'claim' and v_kind <> 'void' then 0 else refund end where id = rid; -- เปลี่ยนสินค้า = คืนเงินเต็มมูลค่าแล้วขายของใหม่เป็นบิลใหม่ · เคลมประกัน = ไม่คืนเงิน
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('return_request', p_actor, o.branch_id, 'returns', rid, o.order_no, refund, jsonb_build_object('kind', v_kind, 'type', v_type));
  return jsonb_build_object('return_id', rid, 'status', 'pending_approval', 'refund_amount', refund, 'items', n);
end $$;

-- ---------------------------------------------------------------------
-- อนุมัติ/ปฏิเสธ (ผู้เรียกต้องตรวจสิทธิ์ return.approve มาก่อน — API)
-- ---------------------------------------------------------------------
create or replace function pos_return_decide(p_return uuid, p_actor uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r returns; o orders; ri return_items; s text; v_full boolean; earned int; reversed int; v_rev int := 0;
  v_cust uuid; v_brand uuid; v_bal int; v_bw int; v_shift uuid; v_jst boolean;
begin
  perform pos_assert_actor_active(p_actor);
  select * into r from returns where id = p_return for update;
  if not found then raise exception 'return_not_found'; end if;
  if r.status <> 'pending_approval' then return jsonb_build_object('return_id', r.id, 'status', r.status, 'replay', true); end if;
  if not pos_work_branch_access(p_actor, r.branch_id) then raise exception 'return_branch_forbidden'; end if;
  if not p_approve then
    update returns set status = 'rejected', approved_by = p_actor, approved_at = now(), decided_note = left(p_note,1000) where id = r.id;
    insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
    values ('return_reject', p_actor, r.branch_id, 'returns', r.id, r.return_no, r.refund_amount, jsonb_build_object('note', p_note));
    return jsonb_build_object('return_id', r.id, 'status', 'rejected');
  end if;
  select * into o from orders where id = r.order_id for update;
  if o.status not in ('completed','partially_refunded') then raise exception 'return_order_not_returnable'; end if;
  -- JST ตัดสต๊อกบิลนี้ไปแล้วจริงไหม: สาขาผูกคลังกลาง + บิลส่งเข้า JST สำเร็จ
  --   ยังไม่ถึง JST (คิว/JST ปฏิเสธ) = สต๊อก JST ไม่เคยถูกตัด → คืนสต๊อก POS ตามปกติ และบิลจะไม่ถูกส่งเข้า JST อีก
  v_jst := r.ow_linked and exists (select 1 from pos_integration_events e where e.event_type = 'sale.committed'
             and e.aggregate_id::text = o.client_uuid::text and e.state = 'delivered');

  for ri in select * from return_items where return_id = r.id loop
    -- กันอนุมัติเกิน (คำขอสองใบอนุมัติพร้อมกัน)
    if ri.qty > (select qty - coalesce(returned_qty,0) from order_items where id = ri.order_item_id) then raise exception 'return_qty_exceeds'; end if;
    update order_items set returned_qty = coalesce(returned_qty,0) + ri.qty where id = ri.order_item_id;
    if not v_jst and ri.product_id is not null then
      perform apply_stock_movement(r.branch_id, ri.product_id, 'return', ri.qty, 'returns', r.id, r.return_no, p_actor, null,
        (select unit_cost from order_items where id = ri.order_item_id), case when r.kind = 'void' then 'void' else 'return' end);
      if ri.condition = 'defective' then
        update stock_levels set qty_quarantine = qty_quarantine + ri.qty, updated_at = now() where branch_id = r.branch_id and product_id = ri.product_id;
      end if;
    end if;
    foreach s in array ri.serials loop
      update serials set status = (case when v_jst then 'returned' when ri.condition = 'defective' then 'defective' else 'in_stock' end)::serial_status,
             branch_id = r.branch_id, sold_order_id = null, sold_at = null, customer_id = null,
             note = 'คืนจากบิล ' || o.order_no || ' (' || r.return_no || ')' || case when v_jst then ' · รอรับคืนใน JST' else '' end, updated_at = now()
       where product_id = ri.product_id and upper(serial_no) = s;
    end loop;
  end loop;

  v_full := not exists (select 1 from order_items where order_id = o.id and qty > coalesce(returned_qty,0));
  -- แต้ม: คืนบางส่วน = ตามสัดส่วนแต้มที่บิลนี้ได้จริง · คืนครบ/ยกเลิก = trigger fn_loyalty_order คืนส่วนที่เหลือทั้งหมด
  if not v_full and r.kind = 'return' and o.customer_id is not null and r.refund_amount > 0 and o.grand_total > 0 then
    select coalesce(sum(points_delta) filter (where kind = 'earn'),0), coalesce(-sum(points_delta) filter (where kind = 'return'),0)
      into earned, reversed from loyalty_ledger where order_id = o.id;
    v_rev := least(floor(earned * r.refund_amount / o.grand_total)::int, greatest(earned - reversed, 0));
    if v_rev > 0 then
      v_brand := (select brand_id from branches where id = o.branch_id);
      update customers set points = points - v_rev, updated_at = now() where id = o.customer_id returning points into v_bal;
      if v_brand is not null then
        insert into brand_wallets(customer_id, brand_id, points) values (o.customer_id, v_brand, -v_rev)
        on conflict (customer_id, brand_id) do update set points = brand_wallets.points - v_rev, updated_at = now() returning points into v_bw;
      end if;
      insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, balance_points, note)
      values (o.customer_id, v_brand, o.id, o.branch_id, 'return', -v_rev, coalesce(v_bw, v_bal), 'หักแต้มจากการคืนสินค้า ' || r.return_no);
    end if;
  end if;

  if r.kind = 'void' then
    update orders set status = 'voided', voided_by = p_actor, voided_at = now(), void_reason = coalesce(r.reason_note, r.reason_code) where id = o.id;
  else
    update orders set status = (case when v_full then 'refunded' else 'partially_refunded' end)::order_status where id = o.id;
  end if;
  -- เงินสดคืนออกจากลิ้นชัก → กะที่เปิดอยู่ของสาขา (ระบุมา หรือกะเปิดล่าสุด)
  if r.refund_method = 'cash' and r.refund_amount > 0 then
    v_shift := coalesce(r.shift_id, (select id from shifts where branch_id = r.branch_id and status = 'open' order by opened_at desc limit 1));
    -- เงินสดออกจากลิ้นชักกะปัจจุบัน → cash_out (close_shift คิดยอดคาดจาก cash_movements) · ยกเลิกบิลของกะเดียวกันไม่ต้อง (close_shift ไม่นับบิล voided อยู่แล้ว)
    if v_shift is not null and exists (select 1 from shifts where id = v_shift and status = 'open')
       and not (r.kind = 'void' and o.shift_id is not distinct from v_shift) then
      insert into cash_movements(shift_id, branch_id, type, amount, reason, employee_id, approved_by)
      values (v_shift, r.branch_id, 'cash_out', r.refund_amount, 'คืนเงินลูกค้า ' || r.return_no || ' (บิล ' || o.order_no || ')', r.requested_by, p_actor);
    end if;
  end if;
  if r.kind = 'void' then
    update shifts set total_sales = total_sales - o.grand_total, total_orders = greatest(total_orders - 1, 0) where id = o.shift_id;
  end if;

  update returns set status = 'completed', approved_by = p_actor, approved_at = now(), completed_at = now(), decided_note = left(p_note,1000),
         ow_linked = v_jst, jst_state = case when v_jst then 'pending' else 'not_needed' end, points_reversed = v_rev
   where id = r.id;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values (case when r.kind = 'void' then 'void' else 'return_complete' end, p_actor, r.branch_id, 'returns', r.id, r.return_no, r.refund_amount,
          jsonb_build_object('order_no', o.order_no, 'ow_linked', v_jst, 'points_reversed', v_rev, 'note', p_note));
  return jsonb_build_object('return_id', r.id, 'status', 'completed', 'ow_linked', v_jst, 'refund_amount', r.refund_amount,
                            'order_status', case when r.kind = 'void' then 'voided' when v_full then 'refunded' else 'partially_refunded' end, 'points_reversed', v_rev);
end $$;

revoke all on function pos_return_request(uuid, jsonb) from public, anon, authenticated;
revoke all on function pos_return_decide(uuid, uuid, boolean, text) from public, anon, authenticated;
