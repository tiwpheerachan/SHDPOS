-- =====================================================================
-- 0086 งานติดฟิล์ม: หน่วยตัดสต๊อก + เปิด/ปิดรุ่น/ความเข้มรายสาขา
--   stock_unit: 'sqft' = ตัดเป็นตารางฟุต (ตามชีท "ยอดตัดสต๊อกทั้งคัน (ตร.ฟุต)" — S รอบคัน 50) · 'ft' = ฟุตความยาว (S 10)
--   feet_per_unit (เดิม) = จำนวนหน่วยข้างบนต่อ 1 ชิ้นในสต๊อก (ปกติ 1)
--   film_branch_off: แถว = ปิดในสาขานั้น (shade 0 = ปิดทั้งรุ่น) · ไม่มีแถว = เปิดทุกอย่าง
-- =====================================================================
alter table film_config add column if not exists stock_unit text not null default 'sqft' check (stock_unit in ('sqft', 'ft'));
update film_config set stock_unit = 'sqft' where id = 1;

create table if not exists film_branch_off (
  branch_id   uuid not null references branches(id) on delete cascade,
  series_code text not null references film_series(code) on delete cascade,
  shade       int not null default 0,          -- 0 = ทั้งรุ่น
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (branch_id, series_code, shade)
);
alter table film_branch_off enable row level security;
