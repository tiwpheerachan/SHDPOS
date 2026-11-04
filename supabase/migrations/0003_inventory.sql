-- =====================================================================
-- SHD POS — 0003_inventory.sql
-- สต๊อกรายสาขา / ledger การเคลื่อนไหว / โอนย้าย / นับสต๊อก / แจ้งเตือน
-- หลักการ: stock_levels = snapshot ที่อ่านเร็ว, stock_movements = ledger
--          ที่เป็น source of truth (append-only ห้ามแก้ย้อนหลัง)
-- =====================================================================

do $$ begin
  create type movement_type as enum (
    'sale','return','exchange_in','exchange_out',
    'receive','transfer_out','transfer_in',
    'count_adjust','damage','claim_out','claim_in','manual_adjust','opening'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type transfer_status as enum (
    'draft','pending_approval','approved','picking','packed','shipped',
    'in_transit','received','partial_received','completed','cancelled','rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type count_status as enum ('draft','counting','review','approved','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- STOCK LEVELS (snapshot รายสาขา)
-- ---------------------------------------------------------------------
create table if not exists stock_levels (
  branch_id     uuid not null references branches(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  qty_on_hand   numeric(14,3) not null default 0,
  qty_reserved  numeric(14,3) not null default 0,   -- ค้างในใบเสนอราคา/โอนออกที่ยังไม่ส่ง
  qty_incoming  numeric(14,3) not null default 0,   -- กำลังโอนเข้า
  reorder_point int not null default 0,
  max_level     int,
  last_counted_at timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (branch_id, product_id)
);
create index if not exists idx_stock_low
  on stock_levels(branch_id)
  where qty_on_hand <= reorder_point;

-- ---------------------------------------------------------------------
-- STOCK MOVEMENTS (ledger — append only)
-- ---------------------------------------------------------------------
create table if not exists stock_movements (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  serial_id    uuid references serials(id) on delete set null,
  type         movement_type not null,
  qty_delta    numeric(14,3) not null,          -- + เข้า / - ออก
  qty_after    numeric(14,3),                   -- ยอดคงเหลือหลังรายการ (audit)
  unit_cost    numeric(14,2),
  ref_table    text,                            -- 'orders' | 'transfers' | 'stock_counts'
  ref_id       uuid,
  ref_no       text,
  employee_id  uuid references employees(id) on delete set null,
  note         text,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_moves_branch_product on stock_movements(branch_id, product_id, occurred_at desc);
create index if not exists idx_moves_ref on stock_movements(ref_table, ref_id);

-- ---------------------------------------------------------------------
-- TRANSFERS (โอนย้ายระหว่างสาขา)
-- ---------------------------------------------------------------------
create table if not exists transfers (
  id              uuid primary key default gen_random_uuid(),
  transfer_no     text not null unique,            -- 'TF-260916-001'
  from_branch_id  uuid not null references branches(id),
  to_branch_id    uuid not null references branches(id),
  status          transfer_status not null default 'draft',
  requested_by    uuid references employees(id),
  approved_by     uuid references employees(id),
  shipped_by      uuid references employees(id),
  received_by     uuid references employees(id),
  courier         text,
  tracking_no     text,
  note            text,
  requested_at    timestamptz not null default now(),
  approved_at     timestamptz,
  shipped_at      timestamptz,
  received_at     timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (from_branch_id <> to_branch_id)
);
create index if not exists idx_transfers_branches on transfers(from_branch_id, to_branch_id, status);

create table if not exists transfer_items (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references transfers(id) on delete cascade,
  product_id    uuid not null references products(id),
  qty_requested numeric(14,3) not null,
  qty_shipped   numeric(14,3) not null default 0,
  qty_received  numeric(14,3) not null default 0,
  unit_cost     numeric(14,2),
  discrepancy_note text
);
create index if not exists idx_transfer_items on transfer_items(transfer_id);

-- serial ที่ถูกโอน (scan รับทีละชิ้น)
create table if not exists transfer_serials (
  transfer_id uuid not null references transfers(id) on delete cascade,
  serial_id   uuid not null references serials(id) on delete cascade,
  shipped     boolean not null default false,
  received    boolean not null default false,
  primary key (transfer_id, serial_id)
);

-- timeline ของสถานะ (ใครกดอะไรตอนไหน)
create table if not exists transfer_events (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references transfers(id) on delete cascade,
  status      transfer_status not null,
  employee_id uuid references employees(id),
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- STOCK COUNT (Cycle count)
-- ---------------------------------------------------------------------
create table if not exists stock_counts (
  id           uuid primary key default gen_random_uuid(),
  count_no     text not null unique,               -- 'SC-260916-001'
  branch_id    uuid not null references branches(id) on delete cascade,
  zone         text,                               -- 'Display Area' / 'Stock Room'
  status       count_status not null default 'draft',
  counted_by   uuid references employees(id),
  approved_by  uuid references employees(id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  approved_at  timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists stock_count_items (
  id             uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references stock_counts(id) on delete cascade,
  product_id     uuid not null references products(id),
  qty_expected   numeric(14,3) not null default 0,
  qty_counted    numeric(14,3),
  qty_difference numeric(14,3) generated always as (coalesce(qty_counted,0) - qty_expected) stored,
  note           text
);
create index if not exists idx_count_items on stock_count_items(stock_count_id);

-- ---------------------------------------------------------------------
-- NOTIFICATIONS (แจ้งเตือนสต๊อกใกล้หมด / อนุมัติค้าง / กะยังไม่ปิด)
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,       -- 'low_stock','approval_pending','shift_unclosed','transfer_discrepancy','sync_failed'
  severity     text not null default 'info' check (severity in ('info','warn','critical')),
  branch_id    uuid references branches(id) on delete cascade,
  brand_id     uuid references brands(id) on delete cascade,
  employee_id  uuid references employees(id) on delete cascade,  -- null = ทุกคนที่มีสิทธิ์
  title        text not null,
  body         text,
  payload      jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_notif_open on notifications(branch_id, kind) where resolved_at is null;

do $$
declare t text;
begin
  foreach t in array array['transfers'] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
