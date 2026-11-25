-- 0069 · ลูกค้าขอใบกำกับภาษีเต็มรูปเองจากลิงก์/QR บนใบเสร็จ → เป็นคำขอให้สาขาออก (ไม่ออกเลขเองอัตโนมัติ)
--   • บิลละคำขอค้างได้ 1 รายการ (ส่งซ้ำ = แก้ข้อมูลคำขอเดิม) · ตรวจข้อมูลผู้ซื้อแบบเดียวกับ pos_issue_tax_invoice
--   • สร้างงานให้ผู้รับผิดชอบสาขา (งานของฉัน) · ออกใบกำกับแล้วคำขอปิดเอง (เรียกจาก API ตอนออก)
create table if not exists tax_invoice_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer jsonb not null,
  contact text,
  status text not null default 'pending' check (status in ('pending', 'issued', 'rejected')),
  work_item_id uuid,
  tax_invoice_id uuid references tax_invoices(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tax_invoice_requests_one_pending on tax_invoice_requests(order_id) where status = 'pending';
alter table tax_invoice_requests enable row level security;
revoke all on tax_invoice_requests from anon, authenticated;

create or replace function pos_request_tax_invoice(p_order uuid, p_buyer jsonb, p_contact text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; cur tax_invoice_requests; v_buyer jsonb; v_tax text; v_who uuid; v_task uuid; v_id uuid;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'tax_invoice_order_not_found'; end if;
  if o.status not in ('completed', 'partially_refunded') then raise exception 'tax_invoice_order_not_eligible'; end if;
  if exists (select 1 from tax_invoices where order_id = o.id and status = 'issued') then raise exception 'tax_invoice_already_issued'; end if;
  v_tax := regexp_replace(coalesce(p_buyer->>'tax_id', ''), '\D', '', 'g');
  if length(btrim(coalesce(p_buyer->>'name', ''))) < 2 then raise exception 'tax_invoice_buyer_name'; end if;
  if length(v_tax) <> 13 then raise exception 'tax_invoice_buyer_tax_id'; end if;
  if length(btrim(coalesce(p_buyer->>'address', ''))) < 10 then raise exception 'tax_invoice_buyer_address'; end if;
  v_buyer := jsonb_build_object('name', left(btrim(p_buyer->>'name'), 200), 'tax_id', v_tax,
    'branch_no', lpad(coalesce(nullif(regexp_replace(coalesce(p_buyer->>'branch_no', ''), '\D', '', 'g'), ''), '00000'), 5, '0'),
    'address', left(btrim(p_buyer->>'address'), 500), 'phone', nullif(left(btrim(coalesce(p_buyer->>'phone', '')), 30), ''));
  select * into cur from tax_invoice_requests where order_id = o.id and status = 'pending' for update;
  if found then
    update tax_invoice_requests set buyer = v_buyer, contact = nullif(left(btrim(coalesce(p_contact, '')), 200), ''), updated_at = now() where id = cur.id;
    return jsonb_build_object('id', cur.id, 'status', 'pending', 'updated', true);
  end if;
  v_who := pos_ow_issue_assignee(o.branch_id, null);
  if v_who is not null then
    insert into pos_work_items(branch_id, created_by, assigned_to, title, description, priority, due_at, source_kind)
    values (o.branch_id, v_who, v_who, left('ลูกค้าขอใบกำกับภาษีเต็มรูป · บิล ' || o.order_no, 200),
      'ลูกค้าขอผ่านลิงก์/QR บนใบเสร็จ: ' || (v_buyer->>'name') || ' (เลขผู้เสียภาษี ' || v_tax || ')' || chr(10) ||
      'เปิดบิล ' || o.order_no || ' → ที่มาของบิล → เอกสาร → ออกใบกำกับ (ข้อมูลเติมให้แล้ว)', 'normal', now() + interval '24 hours', 'manual')
    returning id into v_task;
    insert into pos_work_activity(task_id, actor_id, action, body) values (v_task, null, 'linked', 'ระบบสร้างจากคำขอใบกำกับภาษีของลูกค้า');
  end if;
  insert into tax_invoice_requests(order_id, buyer, contact, work_item_id) values (o.id, v_buyer, nullif(left(btrim(coalesce(p_contact, '')), 200), ''), v_task)
  returning id into v_id;
  insert into audit_logs(action, branch_id, ref_table, ref_id, ref_no, after_data)
  values ('tax_invoice_request', o.branch_id, 'tax_invoice_requests', v_id, o.order_no, jsonb_build_object('tax_id', v_tax));
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;
revoke all on function pos_request_tax_invoice(uuid, jsonb, text) from public, anon, authenticated;
