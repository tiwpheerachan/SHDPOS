-- =====================================================================
-- SHD POS — 0032_campaign_cover.sql
-- รูปปกแคมเปญ (cover) — เก็บ URL + สร้าง storage bucket สาธารณะสำหรับอัปโหลด
-- =====================================================================
alter table campaigns add column if not exists cover_url text;

-- bucket สาธารณะ (อ่านได้ทุกคน; เขียนผ่าน service-role เท่านั้น)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-covers', 'campaign-covers', true, 3145728,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 3145728;
