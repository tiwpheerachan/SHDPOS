-- =====================================================================
-- SHD POS — 0036_employee_sso_fields.sql
-- เก็บข้อมูลจากระบบกลาง (SSO/Lark/GoodHR) บน employees เพื่อเชื่อม
--   สาขา/ตำแหน่ง/สายบังคับบัญชา
-- =====================================================================
alter table employees
  add column if not exists union_id text,
  add column if not exists job_title text,
  add column if not exists manager_union_id text,
  add column if not exists central_branch text,
  add column if not exists central_department text,
  add column if not exists sso_synced_at timestamptz;

create index if not exists idx_employees_union on employees(union_id);
create index if not exists idx_employees_manager_union on employees(manager_union_id);
