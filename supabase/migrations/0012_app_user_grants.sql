-- =====================================================================
-- SHD POS — 0012_app_user_grants.sql
-- สิทธิ์รายคน (per-person) ของผู้ใช้ที่ล็อกอินผ่าน SSO ระบบกลาง
-- ระบบกลาง (sso.shd-technology.co.th) รับ "grant" จากแอปไม่ได้ (มี API แค่อ่าน)
-- ดังนั้น source of truth ของสิทธิ์ POS จึงเก็บที่ตารางนี้
-- เข้าถึงผ่าน service role ฝั่งเซิร์ฟเวอร์เท่านั้น → เปิด RLS แบบไม่มี policy (ปิดสนิทสำหรับ anon/auth)
-- =====================================================================

create table if not exists app_user_grants (
  email                 text primary key,                 -- อีเมลจากระบบกลาง (เก็บเป็นตัวพิมพ์เล็ก)
  union_id              text,                             -- รหัสคงที่จาก Lark (อ้างอิงระยะยาว)
  display_name          text,
  avatar_url            text,
  role                  employee_role not null default 'staff',
  data_scope            data_scope not null default 'branch',
  branch_ids            uuid[] not null default '{}',
  brand_ids             uuid[] not null default '{}',
  max_discount_percent  numeric(5,2) not null default 0,  -- เพดานส่วนลดของคนนี้
  permission_overrides  jsonb not null default '{}'::jsonb, -- { "pos.void": "allow", "report.cost": "deny", ... }
  is_active             boolean not null default true,
  updated_by            text,                             -- อีเมลแอดมินที่แก้ล่าสุด
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_app_user_grants_union on app_user_grants(union_id);
create index if not exists idx_app_user_grants_active on app_user_grants(is_active);

alter table app_user_grants enable row level security;
-- ไม่มี policy โดยตั้งใจ: anon/auth key เข้าไม่ได้เลย; service role (ฝั่ง server) bypass RLS อยู่แล้ว
