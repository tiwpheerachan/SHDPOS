-- =====================================================================
-- 0008 — อนุญาตให้ client (anon key) โหลด "แคตตาล็อก" ที่ไม่อ่อนไหวได้
-- ใช้ชั่วคราวก่อนมี Supabase Auth / Edge Function pos-login เต็มรูปแบบ
-- หมายเหตุความปลอดภัย:
--   * เปิดอ่านเฉพาะข้อมูลแคตตาล็อก (แบรนด์/สาขา/สินค้า/สต๊อก) ที่ไม่ลับ
--   * พนักงานเปิดผ่าน VIEW pos_employees ที่ "ตัด pin_hash/phone/email ออก"
--   * เขียนข้อมูล (ขาย/คืน/ปรับ) ยังต้องเป็น authenticated ตาม 0007 เหมือนเดิม
-- =====================================================================

-- ---- catalog: anon read ----
do $$
declare tbl text;
begin
  foreach tbl in array array['brands','branches','terminals','categories','products','product_barcodes','stock_levels']
  loop
    execute format('grant select on %I to anon', tbl);
    execute format('drop policy if exists %1$s_anon_read on %1$I', tbl);
    execute format('create policy %1$s_anon_read on %1$I for select to anon using (true)', tbl);
  end loop;
end $$;

-- ---- employees: expose only safe columns via view ----
create or replace view pos_employees as
  select
    id, employee_code, first_name, last_name, nickname,
    role, data_scope, home_branch_id,
    max_discount_percent, can_open_drawer, status, photo_url
  from employees;

grant select on pos_employees to anon, authenticated;
