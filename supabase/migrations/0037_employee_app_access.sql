-- =====================================================================
-- SHD POS — 0037_employee_app_access.sql
-- แยก "สิทธิ์ login เข้าแอป" ออกจาก "การมีอยู่ในระบบ/ผังองค์กร"
--   พนักงานที่ดึงจาก Lark directory (org-only) จะตั้ง app_access=false → login ไม่ได้
--   (resolveAuthz เช็ก: status='active' AND app_access)
-- =====================================================================
alter table employees add column if not exists app_access boolean not null default true;
