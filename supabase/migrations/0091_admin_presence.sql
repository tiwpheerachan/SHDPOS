-- 0091 ใครออนไลน์อยู่หน้าไหน (หลังบ้าน) — ส่งสัญญาณทุก ~30 วิ · ถือว่าออนไลน์ถ้าเห็นภายใน 2 นาที
create table if not exists admin_presence (
  email text primary key,
  name text not null,
  avatar_url text,
  path text not null,
  page_label text,
  updated_at timestamptz not null default now()
);
create index if not exists admin_presence_updated_idx on admin_presence (updated_at desc);
alter table admin_presence enable row level security; -- อ่าน/เขียนผ่าน API ฝั่งเซิร์ฟเวอร์ (service role) เท่านั้น
