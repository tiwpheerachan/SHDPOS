-- =====================================================================
-- 0059 — กัน SN ที่ "ขายแล้วใน POS" ถูกรีเซ็ตเป็นพร้อมขาย (เสี่ยงขายซ้ำ)
--   เจอจริง: บิล UAT-33856-261124-0005 ขาย TFSN-1014 แล้ว แต่ JST ปฏิเสธบิล → OW ยังเห็น SN อยู่ในคลัง
--   → "ปรับยอดจาก OW" ตั้ง SN กลับเป็น in_stock (sold_order_id ค้าง) = เครื่องเดียวขายได้ 2 ครั้ง
--   แก้: pos_ow_apply_movement
--     • ไม่เขียนทับ SN ที่ status = sold และผูกบิลที่ยังใช้งาน (completed/partially_refunded) — คืน false ให้ผู้เรียกรายงาน
--       (ยกเว้น p_ref ขึ้นต้น 'force:' สำหรับงานแก้ไขโดยคนที่ตรวจแล้ว)
--     • เปลี่ยนเป็นสถานะที่ไม่ใช่ sold → ล้าง sold_order_id / sold_at / customer_id
--   + แก้ข้อมูล TFSN-1014 กลับเป็น sold (บิล 0005)
-- =====================================================================
create or replace function pos_ow_apply_movement(p_source text, p_key text, p_branch uuid, p_product uuid,
  p_onhand numeric, p_quarantine numeric, p_serials text[], p_serial_status text, p_ref text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare sn text; held text[];
begin
  -- SN ที่ขายแล้วในบิลที่ยังมีผล → ห้ามย้าย/รีเซ็ต (ทั้งรายการ ไม่ให้ยอดกับ SN แยกกัน)
  if p_serial_status is not null and p_serial_status <> 'sold' and coalesce(p_ref,'') not like 'force:%' then
    select array_agg(s.serial_no) into held from serials s join orders o on o.id = s.sold_order_id
     where s.product_id = p_product and s.serial_no = any(coalesce(p_serials,'{}')) and s.status = 'sold'
       and o.status in ('completed','partially_refunded');
    if held is not null then return false; end if;
  end if;
  insert into pos_ow_movements(source, move_key, branch_id, product_id, qty_on_hand, qty_quarantine, serials, serial_status, ref)
  values (p_source, p_key, p_branch, p_product, coalesce(p_onhand,0), coalesce(p_quarantine,0), coalesce(p_serials,'{}'), p_serial_status, p_ref)
  on conflict (source, move_key) do nothing;
  if not found then return false; end if;
  insert into stock_levels(branch_id, product_id, qty_on_hand, qty_quarantine)
  values (p_branch, p_product, coalesce(p_onhand,0), greatest(0, coalesce(p_quarantine,0)))
  on conflict (branch_id, product_id) do update set
    qty_on_hand = stock_levels.qty_on_hand + coalesce(p_onhand,0),
    qty_quarantine = greatest(0, stock_levels.qty_quarantine + coalesce(p_quarantine,0)),
    updated_at = now();
  if p_serial_status is not null then
    foreach sn in array coalesce(p_serials,'{}') loop
      insert into serials(product_id, serial_no, branch_id, status, received_at, note)
      values (p_product, sn, p_branch, p_serial_status::serial_status, case when p_serial_status in ('in_stock','defective') then now() end, p_ref)
      on conflict (product_id, serial_no) do update set branch_id = p_branch, status = p_serial_status::serial_status,
        received_at = case when p_serial_status in ('in_stock','defective') then now() else serials.received_at end,
        sold_order_id = case when p_serial_status = 'sold' then serials.sold_order_id end,
        sold_at = case when p_serial_status = 'sold' then serials.sold_at end,
        customer_id = case when p_serial_status = 'sold' then serials.customer_id end,
        note = p_ref, updated_at = now();
    end loop;
  end if;
  return true;
end $$;

-- แก้ข้อมูล: SN ที่ยังผูกบิลที่มีผล แต่สถานะไม่ใช่ sold (ผลจากบั๊กเดิม) → กลับเป็น sold
update serials s set status = 'sold', note = 'fix 0059: ผูกบิลที่ยังมีผล (ถูกรีเซ็ตโดยปรับยอดจาก OW)', updated_at = now()
  from orders o where o.id = s.sold_order_id and o.status in ('completed','partially_refunded') and s.status <> 'sold';
