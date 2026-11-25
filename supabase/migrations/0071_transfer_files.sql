-- 0071 · ไฟล์แนบใบโอน (รูปสินค้า/เอกสาร) เก็บจริงบน Storage แบบส่วนตัว — เดิมเก็บ data URL ในเครื่อง (โหมดจริงใช้ไม่ได้: Failed to fetch)
--   bucket transfer-files (private, ≤ 15MB/ไฟล์) · เปิดดูผ่าน signed URL จาก API ที่ตรวจสิทธิ์สาขาต้นทาง/ปลายทาง
--   ลบ = soft delete (เก็บประวัติว่าใครแนบ/ลบ) แล้วลบไฟล์จริงออกจาก Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transfer-files', 'transfer-files', false, 15728640, array[
  'image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf','text/csv',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists pos_transfer_files (
  id uuid primary key default gen_random_uuid(),
  pos_transfer_id text not null,
  name text not null,
  mime text not null,
  size integer not null,
  path text not null unique,
  stage text,
  note text,
  uploaded_by uuid references employees(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references employees(id)
);
create index if not exists pos_transfer_files_tr on pos_transfer_files(pos_transfer_id) where deleted_at is null;
alter table pos_transfer_files enable row level security;
revoke all on pos_transfer_files from anon, authenticated;
