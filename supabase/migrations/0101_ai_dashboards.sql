-- 0101 แดชบอร์ด AI Studio (บันทึกบนเซิร์ฟเวอร์) — สเปกการ์ด + แหล่งข้อมูล (เปิดใหม่ = คำนวณจากข้อมูลสด)
--   แชร์: shared (ทุกคนที่ใช้ผู้ช่วย AI ได้) / shared_with (รายคน)
create table if not exists ai_dashboards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  spec jsonb not null,
  sources jsonb not null default '{}'::jsonb,
  shared boolean not null default false,
  shared_with uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_dashboards_owner_idx on ai_dashboards (owner_id, updated_at desc);
create index if not exists ai_dashboards_shared_with_idx on ai_dashboards using gin (shared_with);
alter table ai_dashboards enable row level security; -- ผ่าน API ฝั่งเซิร์ฟเวอร์เท่านั้น
