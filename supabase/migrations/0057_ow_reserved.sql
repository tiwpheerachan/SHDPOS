-- =====================================================================
-- 0057 — ยอด "จองไว้" ตาม OneWarehouse/JST (สาขาที่ผูกคลังกลาง)
--   ปัญหาที่เจอจริง: /v1/stock = ยอด on-hand ของ JST แต่ JST กันของที่อยู่ในใบโอนขาออกที่ยังไม่ส่ง (picklist)
--   → POS เห็นว่าขายได้ 5 แต่ JST ขายได้จริง 1 → บิลขายถูก JST ปฏิเสธ "库存不足"
--   แก้: ตั้ง stock_levels.qty_reserved = ผลรวมจำนวนในใบโอนขาออกที่ยังไม่ส่งของคลังนั้น (checkout หักค่านี้อยู่แล้ว)
--   p_items: [{product_id, qty}] — สินค้าที่ไม่อยู่ในรายการ = จอง 0 (เฉพาะสาขานี้)
-- =====================================================================
create or replace function pos_ow_set_reserved(p_branch uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n integer := 0;
begin
  -- ล็อกเดียวกับ checkout ของสาขา กันจองชนกับการขายที่กำลังเกิด
  perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
  update stock_levels s set qty_reserved = 0, updated_at = now()
   where s.branch_id = p_branch and s.qty_reserved <> 0
     and not exists (select 1 from jsonb_array_elements(coalesce(p_items,'[]')) i where (i->>'product_id')::uuid = s.product_id);
  insert into stock_levels(branch_id, product_id, qty_on_hand, qty_reserved)
  select p_branch, (i->>'product_id')::uuid, 0, greatest(0, (i->>'qty')::numeric)
    from jsonb_array_elements(coalesce(p_items,'[]')) i
  on conflict (branch_id, product_id) do update set qty_reserved = excluded.qty_reserved, updated_at = now()
   where stock_levels.qty_reserved is distinct from excluded.qty_reserved;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function pos_ow_set_reserved(uuid, jsonb) from public, anon, authenticated;
