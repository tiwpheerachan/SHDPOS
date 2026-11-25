-- 0074 · ใบลดหนี้ (Credit Note) — UAT F042–F044
--   • เลขรันต่อเนื่องรายสาขา/เดือน CN<รหัสสาขา>-YYMM-#### (pos_next_doc_no · ไม่ข้าม/ไม่ซ้ำ) · ออกแล้วแก้/ลบไม่ได้ (ภาพ ณ วันออก)
--   • kind=discount  ลดหนี้โดยไม่มีสินค้าคืน (ลดราคาหลังขาย/ชดเชย) → คืนเงินตามช่องทาง · ไม่แตะสต๊อก · ไม่สร้างใบรับคืนปลอม
--   • kind=return    ผูกใบรับคืน/ยกเลิกบิลที่อนุมัติแล้ว → ไม่คืนเงินซ้ำ (คืนไปแล้วตอนรับคืน) · ไม่ขยับสต๊อกซ้ำ · 1 ใบรับคืน = 1 CN
--                    บิลที่ออกใบกำกับเต็มรูปแล้ว → ออก CN ให้อัตโนมัติเมื่อรับคืนเสร็จ (trigger)
--   • เพดาน: ลดหนี้ส่วนลด + คืนเงินจากการรับคืน รวมต้องไม่เกินยอดบิล (T044) · รับคืนหลังลดหนี้ หักส่วนที่ลดไปแล้ว · ยกเลิกบิลที่มี CN ส่วนลดไม่ได้
create table if not exists credit_notes (
  id uuid primary key default gen_random_uuid(),
  cn_no text not null unique,
  client_uuid uuid unique,
  order_id uuid not null references orders(id),
  branch_id uuid not null references branches(id),
  tax_invoice_id uuid references tax_invoices(id),
  return_id uuid references returns(id),
  kind text not null check (kind in ('discount','return')),
  reason text not null,
  original_total numeric not null,
  amount_total numeric not null check (amount_total > 0),
  amount_vat numeric not null,
  amount_before_vat numeric not null,
  refund_method payment_method,
  refund_amount numeric not null default 0,
  status text not null default 'issued' check (status in ('issued')),
  issued_by uuid references employees(id),
  issued_at timestamptz not null default now()
);
create unique index if not exists credit_notes_return_once on credit_notes(return_id) where return_id is not null;
create index if not exists credit_notes_order on credit_notes(order_id);
alter table credit_notes enable row level security;
revoke all on credit_notes from anon, authenticated;

-- ยอดที่ยังลดหนี้/คืนเงินได้ = ยอดบิล − คืนเงินจากการรับคืน (เสร็จ+รออนุมัติ กันอนุมัติทีหลังแล้วเกิน) − ลดหนี้ส่วนลด
create or replace function pos_cn_capacity(p_order uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select o.grand_total
    - coalesce((select sum(refund_amount) from returns where order_id = o.id and status in ('completed','pending_approval')), 0)
    - coalesce((select sum(amount_total) from credit_notes where order_id = o.id and kind = 'discount'), 0)
  from orders o where o.id = p_order
$$;

create or replace function pos_issue_credit_note(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; r returns; cn credit_notes; ti tax_invoices; v_kind text := p_payload->>'kind'; v_amt numeric; v_cap numeric;
  v_method payment_method; v_refund numeric := 0; v_reason text; v_no text; v_vat numeric; v_shift uuid; v_id uuid;
begin
  perform pos_assert_actor_active(p_actor);
  if v_kind not in ('discount','return') then raise exception 'credit_note_invalid_kind'; end if;
  select * into cn from credit_notes where client_uuid = nullif(p_payload->>'client_uuid','')::uuid;
  if found then return jsonb_build_object('id', cn.id, 'cn_no', cn.cn_no, 'amount', cn.amount_total, 'replay', true); end if;
  select * into o from orders where id = (p_payload->>'order_id')::uuid for update;
  if not found then raise exception 'credit_note_order_not_found'; end if;
  if not pos_work_branch_access(p_actor, o.branch_id) then raise exception 'credit_note_branch_forbidden'; end if;
  select * into ti from tax_invoices where order_id = o.id and status = 'issued';

  if v_kind = 'return' then
    select * into r from returns where id = (p_payload->>'return_id')::uuid for update;
    if not found or r.order_id <> o.id then raise exception 'credit_note_return_not_found'; end if;
    if r.status <> 'completed' or coalesce(r.refund_amount,0) <= 0 then raise exception 'credit_note_return_not_eligible'; end if;
    if exists (select 1 from credit_notes where return_id = r.id) then
      select * into cn from credit_notes where return_id = r.id;
      return jsonb_build_object('id', cn.id, 'cn_no', cn.cn_no, 'amount', cn.amount_total, 'replay', true);
    end if;
    v_amt := r.refund_amount; v_method := r.refund_method; v_refund := 0;  -- เงินคืนไปแล้วตอนรับคืน — CN เป็นเอกสารภาษีอย่างเดียว
    v_reason := coalesce(nullif(btrim(p_payload->>'reason'),''), case when r.kind = 'void' then 'ยกเลิกบิล ' else 'รับคืนสินค้า ' end || r.return_no);
  else
    if o.status not in ('completed','partially_refunded') then raise exception 'credit_note_order_not_eligible'; end if;
    v_amt := round((p_payload->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'credit_note_invalid_amount'; end if;
    v_reason := btrim(coalesce(p_payload->>'reason',''));
    if length(v_reason) < 3 then raise exception 'credit_note_reason_required'; end if;
    v_cap := pos_cn_capacity(o.id);
    if v_amt > v_cap then raise exception 'credit_note_exceeds: %', v_cap; end if;
    v_method := nullif(p_payload->>'refund_method','')::payment_method;
    if v_method is null or v_method not in ('cash','bank_transfer','qr_promptpay','credit_card','debit_card') then raise exception 'credit_note_refund_method'; end if;
    v_refund := v_amt;
    if v_method = 'cash' then
      v_shift := (select id from shifts where branch_id = o.branch_id and status = 'open' order by opened_at desc limit 1);
      if v_shift is null then raise exception 'credit_note_no_open_shift'; end if;
    end if;
  end if;

  v_vat := round(v_amt * o.vat_amount / nullif(o.grand_total, 0), 2);
  v_no := pos_next_doc_no(o.branch_id, 'credit_note', 'CN');
  insert into credit_notes(cn_no, client_uuid, order_id, branch_id, tax_invoice_id, return_id, kind, reason, original_total, amount_total, amount_vat, amount_before_vat,
                           refund_method, refund_amount, issued_by)
  values (v_no, nullif(p_payload->>'client_uuid','')::uuid, o.id, o.branch_id, ti.id, r.id, v_kind, left(v_reason, 500), o.grand_total, v_amt, coalesce(v_vat,0), v_amt - coalesce(v_vat,0),
          v_method, v_refund, p_actor)
  returning id into v_id;
  if v_shift is not null then
    insert into cash_movements(shift_id, branch_id, type, amount, reason, employee_id, approved_by)
    values (v_shift, o.branch_id, 'cash_out', v_refund, 'คืนเงินตามใบลดหนี้ ' || v_no || ' (บิล ' || o.order_no || ')', p_actor, p_actor);
  end if;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('credit_note_issue', p_actor, o.branch_id, 'credit_notes', v_id, v_no, v_amt,
          jsonb_build_object('order_no', o.order_no, 'kind', v_kind, 'reason', v_reason, 'refund_method', v_method, 'refund', v_refund,
                             'tax_invoice', ti.invoice_no, 'return_no', r.return_no, 'capacity_before', v_cap));
  return jsonb_build_object('id', v_id, 'cn_no', v_no, 'amount', v_amt, 'refund', v_refund, 'remaining', pos_cn_capacity(o.id));
end $$;

-- รับคืน/ยกเลิกบิลเสร็จ บนบิลที่มีใบกำกับเต็มรูป → ออก CN ให้อัตโนมัติ (ภาษีขายต้องลดตามเอกสาร)
create or replace function pos_cn_from_return()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and coalesce(new.refund_amount,0) > 0
     and exists (select 1 from tax_invoices where order_id = new.order_id and status = 'issued') then
    perform pos_issue_credit_note(coalesce(new.approved_by, new.requested_by),
      jsonb_build_object('kind','return','order_id',new.order_id,'return_id',new.id));
  end if;
  return new;
end $$;
drop trigger if exists pos_cn_from_return on returns;
create trigger pos_cn_from_return after update of status on returns for each row execute function pos_cn_from_return();

-- รับคืน: เพดานคืนเงินหักลดหนี้ส่วนลด · ยกเลิกบิลที่มี CN ส่วนลดไม่ได้ (แก้จาก 0062)
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
  if v_kind = 'void' and exists (select 1 from credit_notes where order_id = o.id and kind = 'discount') then
    raise exception 'void_has_credit_notes';
  end if;
  select coalesce(sum(line_total),0) into lines_total from order_items where order_id = o.id and not coalesce(is_gift,false);
  ratio := case when lines_total > 0 then o.grand_total / lines_total else 1 end;
  rid := gen_random_uuid();
  insert into returns(id, return_no, client_uuid, order_id, branch_id, shift_id, type, status, reason_code, reason_note, refund_method, refund_amount,
                      requested_by, kind, ow_linked, restock, created_at)
  values (rid, 'RT-' || to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || '-' || upper(substr(replace(rid::text,'-',''),1,5)),
          (p_payload->>'client_uuid')::uuid, o.id, o.branch_id, nullif(p_payload->>'shift_id','')::uuid, v_type, 'pending_approval',
          left(p_payload->>'reason_code',100), left(p_payload->>'reason_note',1000),
          case when v_kind = 'void' then (select p.method from order_payments p where p.order_id = o.id order by p.amount desc limit 1)
               else nullif(p_payload->>'refund_method','')::payment_method end, 0,
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
  -- เพดาน = ยอดบิล − คืนเงินที่เสร็จแล้ว − ลดหนี้ส่วนลด (ลูกค้าได้ส่วนลดไปแล้ว คืนของต้องหักส่วนนั้น)
  refund := greatest(least(refund, pos_cn_capacity(o.id)), 0);
  update returns set refund_amount = case when v_type = 'claim' and v_kind <> 'void' then 0 else refund end where id = rid;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('return_request', p_actor, o.branch_id, 'returns', rid, o.order_no, refund, jsonb_build_object('kind', v_kind, 'type', v_type));
  return jsonb_build_object('return_id', rid, 'status', 'pending_approval', 'refund_amount', refund, 'items', n);
end $$;

revoke all on function pos_cn_capacity(uuid), pos_issue_credit_note(uuid, jsonb), pos_cn_from_return() from public, anon, authenticated;
grant execute on function pos_cn_capacity(uuid), pos_issue_credit_note(uuid, jsonb) to service_role;
