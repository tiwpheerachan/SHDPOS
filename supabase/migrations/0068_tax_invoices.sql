-- 0068 · ใบกำกับภาษีเต็มรูป (ออกตามคำขอของลูกค้า) + เลขเอกสารรันต่อเนื่องรายสาขา/รายเดือน (ไม่ข้ามเลข)
--   • 1 บิลมีใบกำกับที่ใช้งานได้ 1 ใบ · แก้ข้อมูลผู้ซื้อ = ยกเลิกใบเดิม (เก็บไว้ ห้ามลบ) แล้วออกใบใหม่ (เลขใหม่ อ้างใบเดิม)
--   • ข้อมูลผู้ซื้อ/ยอดเงินเก็บเป็นภาพ ณ วันออก (ไม่เปลี่ยนตามข้อมูลลูกค้าภายหลัง)
--   • เลข: TI<รหัสสาขา>-<YYMM>-<ลำดับ 4 หลัก> ตามเวลาไทย · ล็อกแถวตัวนับ กันเลขซ้ำ/ข้าม
create table if not exists pos_doc_counters (
  branch_id uuid not null references branches(id),
  doc_type text not null,
  period text not null,
  last_no integer not null default 0,
  primary key (branch_id, doc_type, period)
);
alter table pos_doc_counters enable row level security;
revoke all on pos_doc_counters from anon, authenticated;

create table if not exists tax_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  order_id uuid not null references orders(id),
  branch_id uuid not null references branches(id),
  buyer jsonb not null,
  amount_total numeric not null,
  amount_vat numeric not null,
  amount_before_vat numeric not null,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  replaces_id uuid references tax_invoices(id),
  issued_by uuid references employees(id),
  issued_at timestamptz not null default now(),
  cancelled_by uuid references employees(id),
  cancelled_at timestamptz,
  cancel_reason text
);
create unique index if not exists tax_invoices_one_active on tax_invoices(order_id) where status = 'issued';
create index if not exists tax_invoices_order on tax_invoices(order_id);
alter table tax_invoices enable row level security;
revoke all on tax_invoices from anon, authenticated;

create or replace function pos_next_doc_no(p_branch uuid, p_type text, p_prefix text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_period text := to_char(now() at time zone 'Asia/Bangkok', 'YYMM'); v_no int; v_code text;
begin
  insert into pos_doc_counters(branch_id, doc_type, period, last_no) values (p_branch, p_type, v_period, 1)
  on conflict (branch_id, doc_type, period) do update set last_no = pos_doc_counters.last_no + 1
  returning last_no into v_no;
  select regexp_replace(coalesce(code, 'BR'), '[^A-Za-z0-9]', '', 'g') into v_code from branches where id = p_branch;
  return p_prefix || v_code || '-' || v_period || '-' || lpad(v_no::text, 4, '0');
end $$;

create or replace function pos_issue_tax_invoice(p_order uuid, p_actor uuid, p_buyer jsonb, p_replace_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; cur tax_invoices; v_buyer jsonb; v_tax text; v_branch_no text; v_no text; v_id uuid; v_refunded numeric;
begin
  perform pos_assert_actor_active(p_actor);
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'tax_invoice_order_not_found'; end if;
  if o.status not in ('completed', 'partially_refunded') then raise exception 'tax_invoice_order_not_eligible'; end if;
  if not pos_work_branch_access(p_actor, o.branch_id) then raise exception 'tax_invoice_branch_forbidden'; end if;
  v_tax := regexp_replace(coalesce(p_buyer->>'tax_id', ''), '\D', '', 'g');
  v_branch_no := coalesce(nullif(regexp_replace(coalesce(p_buyer->>'branch_no', ''), '\D', '', 'g'), ''), '00000');
  if length(btrim(coalesce(p_buyer->>'name', ''))) < 2 then raise exception 'tax_invoice_buyer_name'; end if;
  if length(v_tax) <> 13 then raise exception 'tax_invoice_buyer_tax_id'; end if;
  if length(btrim(coalesce(p_buyer->>'address', ''))) < 10 then raise exception 'tax_invoice_buyer_address'; end if;
  v_buyer := jsonb_build_object('name', left(btrim(p_buyer->>'name'), 200), 'tax_id', v_tax, 'branch_no', lpad(v_branch_no, 5, '0'),
    'address', left(btrim(p_buyer->>'address'), 500), 'phone', nullif(left(btrim(coalesce(p_buyer->>'phone', '')), 30), ''));
  select * into cur from tax_invoices where order_id = o.id and status = 'issued' for update;
  if found then
    if cur.buyer = v_buyer then return jsonb_build_object('id', cur.id, 'invoice_no', cur.invoice_no, 'replay', true); end if;
    if coalesce(btrim(p_replace_reason), '') = '' then raise exception 'tax_invoice_exists'; end if;
    update tax_invoices set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancel_reason = left(p_replace_reason, 500) where id = cur.id;
  end if;
  select coalesce(sum(refund_amount), 0) into v_refunded from returns where order_id = o.id and status = 'completed';
  v_no := pos_next_doc_no(o.branch_id, 'tax_invoice', 'TI');
  insert into tax_invoices(invoice_no, order_id, branch_id, buyer, amount_total, amount_vat, amount_before_vat, replaces_id, issued_by)
  values (v_no, o.id, o.branch_id, v_buyer, o.grand_total, o.vat_amount, o.grand_total - o.vat_amount, cur.id, p_actor)
  returning id into v_id;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('tax_invoice_issue', p_actor, o.branch_id, 'tax_invoices', v_id, v_no, o.grand_total,
          jsonb_build_object('order_no', o.order_no, 'replaces', cur.invoice_no, 'reason', p_replace_reason, 'refunded_before', v_refunded));
  return jsonb_build_object('id', v_id, 'invoice_no', v_no, 'replaced', cur.invoice_no);
end $$;

revoke all on function pos_next_doc_no(uuid, text, text), pos_issue_tax_invoice(uuid, uuid, jsonb, text) from public, anon, authenticated;
