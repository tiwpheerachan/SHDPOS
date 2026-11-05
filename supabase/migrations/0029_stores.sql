-- =====================================================================
-- SHD POS — 0029_stores.sql
-- entity "ร้าน" (stores) จัดกลุ่มหลายสาขา (branches)
--   บริษัท → แบรนด์ → ร้าน → สาขา → เครื่อง POS
--   ร้าน = หน่วยร้านค้า/รูปแบบร้าน (ร้านแบรนด์เดียว / ร้านรวมหลายแบรนด์)
-- =====================================================================
create table if not exists stores (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  name_th     text,
  brand_id    uuid references brands(id) on delete set null,   -- แบรนด์หลัก (ถ้าร้านแบรนด์เดียว)
  store_type  text not null default 'brand_shop',              -- brand_shop | multi_brand | franchise | online
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table stores enable row level security;

alter table branches add column if not exists store_id uuid references stores(id) on delete set null;
create index if not exists idx_branches_store on branches(store_id);
