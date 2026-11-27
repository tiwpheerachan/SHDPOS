-- =====================================================================
-- 0087 ยอดขายระบบเดิม (Lark) จาก Dataverse API — หน้าร้าน + อีเวนต์ รายบรรทัด
--   source 'lark' = ระบบเดิม (Lark/Feishu) · บิลในระบบเราเป็น 'pos'
--   ระบบเดิมยังใช้คู่กัน → ดึงซ้ำช่วงล่าสุดเป็นระยะ (upsert ตาม line_id + ลบบรรทัดที่หายไปในช่วงนั้น)
--   branches.pos_go_live_date: ตั้งแต่วันนี้นับยอดจาก POS แทน (กันยอดซ้ำตอนใช้สองระบบ)
-- =====================================================================
alter table branches add column if not exists pos_go_live_date date;

-- ร้าน/อีเวนต์ใน Dataverse → สาขาเรา (จับคู่อัตโนมัติ แก้มือได้)
create table if not exists dv_place_map (
  place_key   text primary key,          -- dv_place_id หรือ 'name:<ชื่อ>' (อีเวนต์/ร้านที่ไม่มี id)
  dv_place_id text,
  place_name  text,
  channel     text,                       -- store | event
  brand_ids   text[] not null default '{}',
  branch_id   uuid references branches(id) on delete set null,
  matched_by  text not null default 'none' check (matched_by in ('none', 'auto', 'manual')),
  score       numeric(4,3),
  lines       int not null default 0,
  last_sale   date,
  updated_at  timestamptz not null default now()
);

create table if not exists legacy_sales_lines (
  line_id        text primary key,
  source         text not null default 'lark',
  channel        text not null,           -- store | event
  order_no       text,
  sale_date      date not null,
  place_key      text,
  place_id       text,
  place_name     text,
  branch_id      uuid references branches(id) on delete set null,
  sku_id         text,
  sku_code       text,
  jst_sku_id     text,
  sku_name       text,
  product_id     uuid references products(id) on delete set null,
  dv_brand_id    text,
  brand_id       uuid references brands(id) on delete set null,
  category_l1    text,
  category_l2    text,
  category_l3    text,
  qty            numeric(14,3),
  unit_price     numeric(14,2),
  discount       numeric(14,2),
  amount         numeric(14,2) not null default 0,
  vat            numeric(14,2),
  payment_method text,
  status         text,
  is_sellout     boolean,
  is_demo        boolean,
  is_sku_unmapped   boolean,
  is_place_unmapped boolean,
  dv_source      text,
  dv_updated_at  timestamptz,
  synced_at      timestamptz not null default now()
);
create index if not exists legacy_sales_lines_date on legacy_sales_lines (sale_date);
create index if not exists legacy_sales_lines_branch_date on legacy_sales_lines (branch_id, sale_date);
create index if not exists legacy_sales_lines_place on legacy_sales_lines (place_key);

create table if not exists legacy_sync_runs (
  id          bigserial primary key,
  kind        text not null,              -- backfill | auto | manual
  date_from   date not null,
  date_to     date not null,
  fetched     int not null default 0,
  upserted    int not null default 0,
  removed     int not null default 0,
  status      text not null default 'running' check (status in ('running', 'ok', 'error')),
  error       text,
  actor       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

alter table dv_place_map enable row level security;
alter table legacy_sales_lines enable row level security;
alter table legacy_sync_runs enable row level security;
