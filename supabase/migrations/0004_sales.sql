-- =====================================================================
-- SHD POS — 0004_sales.sql
-- ลูกค้า / กะ-ลิ้นชักเงินสด / ใบเสนอราคา / บิลขาย / การชำระ / คืน-เปลี่ยน
-- =====================================================================

do $$ begin
  create type order_status as enum ('draft','completed','voided','refunded','partially_refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_channel as enum ('offline','online_shopee','online_lazada','online_tiktok','online_website','event','b2b','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type line_kind as enum ('goods','service','fee','travel','claim','b2b');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum (
    'cash','credit_card','debit_card','qr_promptpay','bank_transfer','edc',
    'gift_card','store_credit','installment','online_marketplace','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type shift_status as enum ('open','closed','force_closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type return_type as enum ('refund','exchange','claim');
exception when duplicate_object then null; end $$;

do $$ begin
  create type return_status as enum ('pending_approval','approved','rejected','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quotation_status as enum ('draft','sent','accepted','converted','expired','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- CUSTOMERS / MEMBERS
-- ---------------------------------------------------------------------
create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  member_code   text unique,
  name          text not null,
  phone         text,
  email         text,
  line_id       text,
  birth_date    date,
  -- ข้อมูลออกใบกำกับภาษี
  tax_id        text,
  tax_name      text,
  tax_branch_no text default '00000',
  tax_address   text,
  -- แต้ม/เครดิต
  points        int not null default 0,
  store_credit  numeric(14,2) not null default 0,
  tier          text default 'normal',
  source        text,                              -- 'walk_in','facebook','shopee','referral'
  first_branch_id uuid references branches(id),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_customers_phone on customers(phone);
create index if not exists idx_customers_taxid on customers(tax_id);

-- ---------------------------------------------------------------------
-- SHIFTS (เปิด-ปิดกะ + ลิ้นชักเงินสด)
-- ---------------------------------------------------------------------
create table if not exists shifts (
  id              uuid primary key default gen_random_uuid(),
  shift_no        text not null unique,            -- 'SH-260916-R9A-01'
  branch_id       uuid not null references branches(id) on delete cascade,
  terminal_id     uuid references terminals(id) on delete set null,
  opened_by       uuid not null references employees(id),
  closed_by       uuid references employees(id),
  status          shift_status not null default 'open',
  opening_cash    numeric(14,2) not null default 0,
  -- ยอดที่ระบบคำนวณได้
  expected_cash   numeric(14,2),
  counted_cash    numeric(14,2),
  cash_variance   numeric(14,2),
  total_sales     numeric(14,2) not null default 0,
  total_orders    int not null default 0,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_shifts_branch_open on shifts(branch_id, status);

-- พนักงานที่เข้ากะพร้อมกัน (บางสาขามี 2 คน) — ใช้เก็บ performance รายคน
create table if not exists shift_members (
  shift_id    uuid not null references shifts(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  primary key (shift_id, employee_id)
);

-- การเคลื่อนไหวเงินสดในลิ้นชัก (เติมเงินทอน / ถอนเงิน / เปิดลิ้นชักเปล่า)
create table if not exists cash_movements (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references shifts(id) on delete cascade,
  branch_id    uuid not null references branches(id) on delete cascade,
  type         text not null check (type in ('cash_in','cash_out','drop','pickup','open_no_sale','adjust')),
  amount       numeric(14,2) not null default 0,
  reason       text,
  employee_id  uuid references employees(id),
  approved_by  uuid references employees(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_cash_shift on cash_movements(shift_id);

-- ---------------------------------------------------------------------
-- QUOTATIONS (ใบเสนอราคาสินค้ามูลค่าสูง)
-- ---------------------------------------------------------------------
create table if not exists quotations (
  id            uuid primary key default gen_random_uuid(),
  quotation_no  text not null unique,              -- 'QT-260916-001'
  branch_id     uuid not null references branches(id),
  customer_id   uuid references customers(id),
  customer_name text,
  customer_phone text,
  salesperson_id uuid references employees(id),
  status        quotation_status not null default 'draft',
  subtotal      numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  vat_amount    numeric(14,2) not null default 0,
  grand_total   numeric(14,2) not null default 0,
  valid_until   date,
  note          text,
  converted_order_id uuid,
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists quotation_items (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references quotations(id) on delete cascade,
  product_id    uuid references products(id),
  sku           text,
  name          text not null,
  qty           numeric(12,3) not null default 1,
  unit_price    numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  line_total    numeric(14,2) not null default 0,
  sort_order    int not null default 0
);

-- ---------------------------------------------------------------------
-- ORDERS (บิลขาย)
-- ---------------------------------------------------------------------
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text not null unique,           -- 'R9A-260916-0042'
  -- กันบิลซ้ำตอน offline sync: client สร้าง uuid มาเอง
  client_uuid      uuid unique,
  branch_id        uuid not null references branches(id),
  terminal_id      uuid references terminals(id),
  shift_id         uuid references shifts(id),
  cashier_id       uuid references employees(id),          -- คนกดเครื่อง
  salesperson_id   uuid references employees(id),          -- คนได้ยอด (KPI)
  customer_id      uuid references customers(id),
  customer_name    text,
  customer_phone   text,
  status           order_status not null default 'completed',
  channel          sale_channel not null default 'offline',
  -- ยอดเงิน
  subtotal         numeric(14,2) not null default 0,       -- ก่อนส่วนลด (รวม VAT ตาม vat_mode)
  discount_total   numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  vat_amount       numeric(14,2) not null default 0,
  grand_total      numeric(14,2) not null default 0,
  paid_total       numeric(14,2) not null default 0,
  change_amount    numeric(14,2) not null default 0,
  -- ต้นทุน/กำไร (snapshot ณ เวลาขาย — ห้ามคำนวณย้อนหลังจาก master)
  cost_total       numeric(14,2) not null default 0,
  gross_profit     numeric(14,2) not null default 0,
  -- ส่วนลดที่ต้องอนุมัติ
  discount_approved_by uuid references employees(id),
  approval_id      uuid,
  -- อ้างอิงเอกสาร
  reference_no     text,                                   -- เลขออเดอร์จาก marketplace
  quotation_id     uuid references quotations(id),
  note             text,
  -- offline / sync
  is_offline_origin boolean not null default false,
  device_created_at timestamptz,
  synced_at        timestamptz,
  -- void
  voided_by        uuid references employees(id),
  voided_at        timestamptz,
  void_reason      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_orders_branch_date on orders(branch_id, created_at desc);
create index if not exists idx_orders_salesperson on orders(salesperson_id, created_at desc);
create index if not exists idx_orders_shift on orders(shift_id);
create index if not exists idx_orders_status on orders(status);

create table if not exists order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid references products(id),
  sku            text not null,
  name           text not null,                    -- snapshot ชื่อ ณ เวลาขาย
  kind           line_kind not null default 'goods',
  qty            numeric(12,3) not null default 1,
  unit_price     numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  unit_cost      numeric(14,2) not null default 0,
  cost_total     numeric(14,2) not null default 0,
  gross_profit   numeric(14,2) not null default 0,
  vat_amount     numeric(14,2) not null default 0,
  -- KPI รายคน: บางสาขาแบ่งยอดตามคนขายรายบรรทัด
  salesperson_id uuid references employees(id),
  returned_qty   numeric(12,3) not null default 0,
  sort_order     int not null default 0
);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

create table if not exists order_item_serials (
  order_item_id uuid not null references order_items(id) on delete cascade,
  serial_id     uuid not null references serials(id),
  serial_no     text not null,
  primary key (order_item_id, serial_id)
);

create table if not exists order_payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  method        payment_method not null,
  amount        numeric(14,2) not null,
  -- รายละเอียดบัตร/โอน (ตรงกับข้อมูลเดิม: ธนาคาร, MID, เลขอนุมัติ)
  acquirer_bank text,
  card_brand    text,                              -- VISA / MASTER / JCB
  card_last4    text,
  approval_code text,
  mid           text,
  terminal_ref  text,
  reference_no  text,
  installment_months int,
  fee_amount    numeric(14,2) not null default 0,  -- ค่าธรรมเนียมธนาคาร
  received_at   timestamptz not null default now()
);
create index if not exists idx_payments_order on order_payments(order_id);

-- ผูก serial กลับไปที่บิล (FK ที่ค้างจาก 0002)
do $$ begin
  alter table serials
    add constraint serials_sold_order_fk
    foreign key (sold_order_id) references orders(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table serials
    add constraint serials_customer_fk
    foreign key (customer_id) references customers(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table quotations
    add constraint quotations_converted_order_fk
    foreign key (converted_order_id) references orders(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- RETURNS / EXCHANGE / CLAIM
-- ---------------------------------------------------------------------
create table if not exists returns (
  id             uuid primary key default gen_random_uuid(),
  return_no      text not null unique,             -- 'RT-260916-001'
  client_uuid    uuid unique,
  order_id       uuid references orders(id),
  branch_id      uuid not null references branches(id),
  shift_id       uuid references shifts(id),
  type           return_type not null default 'refund',
  status         return_status not null default 'pending_approval',
  reason_code    text,                             -- 'defective','wrong_item','customer_change','warranty'
  reason_note    text,
  refund_method  payment_method,
  refund_amount  numeric(14,2) not null default 0,
  exchange_order_id uuid references orders(id),
  restock        boolean not null default true,
  requested_by   uuid references employees(id),
  approved_by    uuid references employees(id),
  approved_at    timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_returns_order on returns(order_id);
create index if not exists idx_returns_branch on returns(branch_id, created_at desc);

create table if not exists return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references returns(id) on delete cascade,
  order_item_id uuid references order_items(id),
  product_id    uuid references products(id),
  sku           text not null,
  name          text not null,
  qty           numeric(12,3) not null default 1,
  unit_price    numeric(14,2) not null default 0,
  line_total    numeric(14,2) not null default 0,
  serial_id     uuid references serials(id),
  condition     text default 'sellable' check (condition in ('sellable','defective','opened_box','scrap'))
);
create index if not exists idx_return_items on return_items(return_id);

do $$
declare t text;
begin
  foreach t in array array['customers','orders','quotations'] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
