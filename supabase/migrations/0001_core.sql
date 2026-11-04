-- =====================================================================
-- SHD POS — 0001_core.sql
-- องค์กร / แบรนด์ / สาขา / เครื่อง POS / พนักงาน / สิทธิ์
-- =====================================================================
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------
do $$ begin
  create type employee_role as enum ('staff','supervisor','manager','brand_admin','hq','auditor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type data_scope as enum ('own','branch','brand','company');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employee_status as enum ('active','suspended','resigned');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- BRANDS  (70mai / Anker / Soundcore / Dreame / DDPAI / Mova / ...)
-- ---------------------------------------------------------------------
create table if not exists brands (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,              -- '70MAI'
  name          text not null,                     -- '70mai'
  name_th       text,
  name_zh       text,
  logo_url      text,
  color         text default '#2563eb',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- BRANCHES (สาขา / หน้าร้าน)  — อ้างอิงจากข้อมูลจริง 29 สาขา
-- ---------------------------------------------------------------------
create table if not exists branches (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,             -- '70MAI-RAMINTRA'
  name           text not null,                    -- '70mai Ramintra'
  name_th        text,
  name_zh        text,
  -- ชื่อบัญชีร้านใน ERP เดิม เช่น '[Brand Shop] 70mai - Ramindra'
  erp_store_code text,
  brand_id       uuid references brands(id) on delete set null,  -- แบรนด์หลักของสาขา
  branch_type    text not null default 'brand_shop'
                 check (branch_type in ('brand_shop','shop_in_shop','vending','popup','warehouse','service_center')),
  address        text,
  district       text,
  province       text,
  postcode       text,
  phone          text,
  tax_branch_no  text default '00000',             -- รหัสสาขาสำหรับใบกำกับภาษี
  timezone       text not null default 'Asia/Bangkok',
  opened_at      date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_branches_brand on branches(brand_id);

-- สาขาหนึ่งขายได้หลายแบรนด์ (เช่น Hashtag ขายหลายแบรนด์)
create table if not exists branch_brands (
  branch_id  uuid not null references branches(id) on delete cascade,
  brand_id   uuid not null references brands(id) on delete cascade,
  primary key (branch_id, brand_id)
);

-- ---------------------------------------------------------------------
-- TERMINALS (เครื่อง POS แต่ละเครื่อง / iPad / PC)
-- ---------------------------------------------------------------------
create table if not exists terminals (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references branches(id) on delete cascade,
  code              text not null,                 -- 'POS-01'
  name              text,
  device_fingerprint text,
  -- เลขที่ใบเสร็จจะใช้ prefix ของเครื่องกันชนกันตอน offline
  receipt_prefix    text not null,                 -- 'R9A'
  printer_profile   jsonb not null default '{}'::jsonb,
  cash_drawer_kick  jsonb not null default '{"pin":0,"on":50,"off":200}'::jsonb,
  customer_display  boolean not null default false,
  last_seen_at      timestamptz,
  app_version       text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (branch_id, code)
);

-- ---------------------------------------------------------------------
-- EMPLOYEES (พนักงาน — มีรหัสพนักงาน + PIN สำหรับเข้า POS)
-- ---------------------------------------------------------------------
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique,                      -- map กับ auth.users (สำหรับ admin web)
  employee_code  text not null unique,             -- 'EMP-00123'
  first_name     text not null,
  last_name      text,
  nickname       text,                             -- ชื่อเล่นที่ใช้ในรายงานยอดขาย เช่น 'nattasak'
  phone          text,
  email          text,
  role           employee_role not null default 'staff',
  -- ขอบเขตการเห็นข้อมูล
  data_scope     data_scope not null default 'own',
  home_branch_id uuid references branches(id) on delete set null,
  pin_hash       text,                             -- bcrypt/argon2 ของ PIN 6 หลัก
  pin_set_at     timestamptz,
  max_discount_percent numeric(5,2) not null default 0,   -- เพดานส่วนลดของคนนี้ (override role)
  can_open_drawer boolean not null default false,
  status         employee_status not null default 'active',
  hired_at       date,
  photo_url      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_employees_home_branch on employees(home_branch_id);
create index if not exists idx_employees_role on employees(role);

-- พนักงานเข้าได้หลายสาขา (คนคุมหลายสาขา / ย้ายสาขาชั่วคราว)
create table if not exists employee_branches (
  employee_id uuid not null references employees(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete cascade,
  is_primary  boolean not null default false,
  primary key (employee_id, branch_id)
);

-- สิทธิ์รายแบรนด์ (Brand Admin เห็นเฉพาะแบรนด์ตัวเอง)
create table if not exists employee_brands (
  employee_id uuid not null references employees(id) on delete cascade,
  brand_id    uuid not null references brands(id) on delete cascade,
  primary key (employee_id, brand_id)
);

-- ---------------------------------------------------------------------
-- PERMISSIONS — matrix ตาม role + override รายคน
-- ---------------------------------------------------------------------
create table if not exists permissions (
  key         text primary key,                    -- 'pos.sell', 'pos.discount', ...
  module      text not null,                       -- 'pos','inventory','admin',...
  label_th    text not null,
  label_en    text not null,
  label_zh    text,
  is_sensitive boolean not null default false
);

create table if not exists role_permissions (
  role        employee_role not null,
  permission  text not null references permissions(key) on delete cascade,
  -- 'allow' | 'deny' | 'approval'  (approval = ทำได้แต่ต้องขออนุมัติ)
  effect      text not null default 'allow' check (effect in ('allow','deny','approval')),
  limit_value numeric(14,2),                       -- เช่น เพดานส่วนลด %
  primary key (role, permission)
);

create table if not exists employee_permissions (
  employee_id uuid not null references employees(id) on delete cascade,
  permission  text not null references permissions(key) on delete cascade,
  effect      text not null check (effect in ('allow','deny','approval')),
  limit_value numeric(14,2),
  granted_by  uuid references employees(id),
  granted_at  timestamptz not null default now(),
  primary key (employee_id, permission)
);

-- ---------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['brands','branches','employees'] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
