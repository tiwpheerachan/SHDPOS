-- 0079 · มุมมองรายงาน (บันทึก/แชร์ในทีม) + ภาพนิ่งรายงานสำหรับลิงก์แชร์ (เหมือนลิงก์เอกสาร)
--   pos_report_views     : ตัวกรอง+แท็บที่บันทึกไว้ ของตัวเอง หรือแชร์ให้ทุกคนในองค์กรที่มีสิทธิ์ดูรายงาน
--   pos_report_snapshots : ภาพนิ่งตัวเลขที่สรุปแล้ว (ไม่มีชื่อ/เบอร์ลูกค้า) — เปิดผ่านลิงก์ลงลายเซ็น HMAC มีวันหมดอายุ · ยกเลิกลิงก์ได้
create table if not exists pos_report_views (
  id uuid primary key default gen_random_uuid(),
  report text not null default 'sales',
  name text not null check (length(name) between 1 and 80),
  state jsonb not null,
  shared boolean not null default false,
  owner_id uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pos_report_views_owner on pos_report_views(report, owner_id);
create table if not exists pos_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  report text not null default 'sales',
  title text not null,
  payload jsonb not null,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0
);
create index if not exists pos_report_snapshots_creator on pos_report_snapshots(created_by, created_at desc);
alter table pos_report_views enable row level security;
alter table pos_report_snapshots enable row level security;
revoke all on pos_report_views, pos_report_snapshots from anon, authenticated;
