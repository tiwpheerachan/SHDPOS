-- =====================================================================
-- 0051 — ปรับยอดสต๊อก POS ให้ตรง OneWarehouse (OW เป็นตัวจริง) + แก้คีย์ใบ OW ย่อย
--   1) pos_ow_transfer_lines: ใบจากคลังกลาง 1 ใบ OW มีได้หลาย SKU → PK เดิม (source, ow_id) เก็บได้แค่ SKU เดียว
--      เปลี่ยนเป็น (source, ow_id, sku)
--   2) pos_ow_reconcile_stock: ตั้ง qty_on_hand = ยอด OW แบบ atomic (ล็อกแถว → คิดส่วนต่าง → บันทึกบัญชีเคลื่อนไหว)
--      idempotent ด้วย move_key (รอบเดิมซ้ำไม่ปรับซ้ำ) · คืนส่วนต่างที่ปรับ (null = รอบนี้เคยปรับแล้ว)
-- =====================================================================
alter table pos_ow_transfer_lines drop constraint pos_ow_transfer_lines_pkey;
alter table pos_ow_transfer_lines add primary key (source, ow_id, sku);

create or replace function pos_ow_reconcile_stock(p_source text, p_key text, p_branch uuid, p_product uuid, p_target numeric, p_ref text)
returns numeric
language plpgsql security definer set search_path = public, pg_temp
as $$
declare cur numeric; d numeric;
begin
  if p_target is null or p_target < 0 then raise exception 'target must be >= 0'; end if;
  if exists (select 1 from pos_ow_movements where source = p_source and move_key = p_key) then return null; end if;
  insert into stock_levels(branch_id, product_id, qty_on_hand) values (p_branch, p_product, 0) on conflict (branch_id, product_id) do nothing;
  select qty_on_hand into cur from stock_levels where branch_id = p_branch and product_id = p_product for update;
  d := p_target - cur;
  insert into pos_ow_movements(source, move_key, branch_id, product_id, qty_on_hand, qty_quarantine, serials, serial_status, ref)
  values (p_source, p_key, p_branch, p_product, d, 0, '{}', null, p_ref);
  if d <> 0 then update stock_levels set qty_on_hand = p_target, updated_at = now() where branch_id = p_branch and product_id = p_product; end if;
  return d;
end $$;
revoke all on function pos_ow_reconcile_stock(text, text, uuid, uuid, numeric, text) from public, anon, authenticated;
