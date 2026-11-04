-- =====================================================================
-- SHD POS — 0002_catalog.sql
-- สินค้า / บาร์โค้ด / ราคา / Serial-IMEI / ประกัน
-- อ้างอิงฟิลด์จากระบบเดิม: SKU, ราคาขาย IV, ส่วนลด, ต้นทุน, SN NO.,
-- ประเภทของ (ขายสินค้า / บริการติดตั้ง / ค่าเดินทาง / เคลมสินค้า / B2B)
-- =====================================================================

do $$ begin
  create type product_kind as enum ('goods','service','bundle','fee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vat_mode as enum ('inclusive','exclusive','exempt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type serial_status as enum ('in_stock','reserved','sold','returned','transferred','defective','scrapped');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- CATEGORIES
-- ---------------------------------------------------------------------
create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references categories(id) on delete set null,
  code       text unique,
  name_th    text not null,
  name_en    text,
  name_zh    text,
  sort_order int not null default 0,
  icon       text,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  brand_id        uuid references brands(id) on delete set null,
  category_id     uuid references categories(id) on delete set null,
  kind            product_kind not null default 'goods',
  name_th         text not null,
  name_en         text,
  name_zh         text,
  short_name      text,                       -- ชื่อสั้นสำหรับพิมพ์สลิป 32 ตัวอักษร
  unit            text not null default 'ชิ้น',
  -- ราคา
  price           numeric(14,2) not null default 0,   -- ราคาขายมาตรฐาน (รวม VAT)
  cost            numeric(14,2) not null default 0,   -- ต้นทุนมาตรฐาน (ไม่รวม VAT)
  vat_mode        vat_mode not null default 'inclusive',
  vat_rate        numeric(5,2) not null default 7.00,
  -- คุมส่วนลด
  max_discount_percent numeric(5,2),
  is_discountable boolean not null default true,
  -- Serial / ประกัน
  track_serial    boolean not null default false,
  track_imei      boolean not null default false,
  warranty_months int not null default 12,
  -- คลัง
  is_stocked      boolean not null default true,
  reorder_point   int not null default 0,
  -- อื่น ๆ
  image_url       text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_products_brand on products(brand_id);
create index if not exists idx_products_active on products(is_active);
create index if not exists idx_products_name_trgm on products using gin (to_tsvector('simple', coalesce(name_th,'') || ' ' || coalesce(name_en,'') || ' ' || sku));

-- บาร์โค้ดได้หลายตัวต่อสินค้า (EAN, กล่อง, บาร์โค้ดร้าน)
create table if not exists product_barcodes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  barcode    text not null unique,
  pack_size  int not null default 1,
  label      text
);
create index if not exists idx_barcodes_product on product_barcodes(product_id);

-- ราคาเฉพาะสาขา / ช่วงโปรโมชัน
create table if not exists product_prices (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  branch_id   uuid references branches(id) on delete cascade,  -- null = ทุกสาขา
  price       numeric(14,2) not null,
  starts_at   timestamptz,
  ends_at     timestamptz,
  label       text,                                   -- 'Mega Sale 9.9'
  priority    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_prices_lookup on product_prices(product_id, branch_id, starts_at, ends_at);

-- สินค้าชุด (bundle) เช่น กล้องหน้า+หลัง+ติดตั้ง
create table if not exists product_bundle_items (
  bundle_id   uuid not null references products(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  qty         numeric(12,3) not null default 1,
  primary key (bundle_id, product_id)
);

-- ---------------------------------------------------------------------
-- SERIALS / IMEI / MAC  (สำคัญมากกับสินค้า electronics)
-- ---------------------------------------------------------------------
create table if not exists serials (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  serial_no      text not null,
  imei           text,
  mac_address    text,
  branch_id      uuid references branches(id) on delete set null,
  status         serial_status not null default 'in_stock',
  received_at    timestamptz,
  sold_at        timestamptz,
  sold_order_id  uuid,                        -- FK เพิ่มใน 0004
  customer_id    uuid,
  warranty_start date,
  warranty_end   date,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (product_id, serial_no)
);
create index if not exists idx_serials_serial on serials(serial_no);
create index if not exists idx_serials_imei on serials(imei);
create index if not exists idx_serials_branch_status on serials(branch_id, status);

do $$
declare t text;
begin
  foreach t in array array['products','serials'] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
