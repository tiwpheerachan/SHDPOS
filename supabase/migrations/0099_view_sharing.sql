-- 0099 แชร์มุมมองรายคน + ลิงก์สาธารณะ (เห็นเฉพาะตารางของมุมมองนั้น)
--   shared_with = employee ids ที่เห็นมุมมองนี้ (นอกจากเจ้าของ) · shared=true ยังหมายถึงทุกคนที่ดูยอดขายได้
--   link_token = ลิงก์สาธารณะ (สุ่ม 32 ไบต์) · link_branches = สาขาที่เจ้าของเห็นได้ตอนสร้างลิงก์ (null = ทุกสาขา) · หมดอายุ/ยกเลิกได้
alter table pos_report_views
  add column if not exists shared_with uuid[] not null default '{}',
  add column if not exists link_token text unique,
  add column if not exists link_expires_at timestamptz,
  add column if not exists link_branches uuid[],
  add column if not exists link_created_by uuid,
  add column if not exists link_views int not null default 0;
create index if not exists pos_report_views_shared_with_idx on pos_report_views using gin (shared_with);
