-- =====================================================================
-- SHD POS — 0015_unify_users.sql
-- รวมผู้ใช้เป็นชุดเดียว: ใช้ตาราง employees เป็น "คน" หลัก (มี uuid จริง)
--   * เพิ่ม permission_overrides (สิทธิ์ละเอียดต่อคน) เข้า employees
--   * email ใช้ผูกกับบัญชี SSO (ระบบกลาง) — login SSO หา employee ด้วย email
--   * pin_plain / admin_set_employee_pin มีแล้วจาก 0013
-- app_user_grants (0012) เลิกใช้ — สิทธิ์ย้ายมาอยู่ที่ employees แทน
-- =====================================================================

alter table employees add column if not exists permission_overrides jsonb not null default '{}'::jsonb;

-- ค้นหา/ผูกด้วย email (SSO) ได้เร็วขึ้น
create index if not exists idx_employees_email_lower on employees (lower(email));
