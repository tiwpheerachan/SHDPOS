-- =====================================================================
-- SHD POS — 0005_governance.sql
-- คำขออนุมัติ / Audit log / ใบกำกับภาษี e-Tax / ตั้งค่าระบบ / sync log
-- =====================================================================

do $$ begin
  create type approval_kind as enum (
    'discount','price_override','return','void','cash_adjust','stock_adjust',
    'transfer','reprint','shift_force_close','permission_change'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_status as enum ('pending','approved','rejected','expired','auto_approved');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- APPROVALS (Manager PIN approval)
-- ---------------------------------------------------------------------
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  kind          approval_kind not null,
  status        approval_status not null default 'pending',
  branch_id     uuid references branches(id) on delete cascade,
  requested_by  uuid references employees(id),
  approved_by   uuid references employees(id),
  -- ข้อมูลของสิ่งที่ขออนุมัติ เช่น {"order_total":15000,"discount_percent":15}
  payload       jsonb not null default '{}'::jsonb,
  requested_amount numeric(14,2),
  ref_table     text,
  ref_id        uuid,
  reason        text,
  decided_at    timestamptz,
  expires_at    timestamptz default (now() + interval '15 minutes'),
  created_at    timestamptz not null default now()
);
create index if not exists idx_approvals_pending on approvals(branch_id, status) where status = 'pending';

do $$ begin
  alter table orders add constraint orders_approval_fk
    foreign key (approval_id) references approvals(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- AUDIT LOG (ทุก action สำคัญต้อง log — append only)
-- ---------------------------------------------------------------------
create table if not exists audit_logs (
  id           bigserial primary key,
  action       text not null,      -- 'login','logout','sale','void','refund','exchange','discount',
                                   -- 'price_override','cash_drawer','cash_adjust','stock_adjust',
                                   -- 'transfer','user_permission','reprint','shift_open','shift_close','stock_count'
  actor_id     uuid references employees(id) on delete set null,
  actor_code   text,
  actor_name   text,
  branch_id    uuid references branches(id) on delete set null,
  terminal_id  uuid references terminals(id) on delete set null,
  ref_table    text,
  ref_id       uuid,
  ref_no       text,
  amount       numeric(14,2),
  before_data  jsonb,
  after_data   jsonb,
  ip_address   inet,
  user_agent   text,
  app_version  text,
  is_offline   boolean not null default false,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_branch_time on audit_logs(branch_id, occurred_at desc);
create index if not exists idx_audit_actor_time on audit_logs(actor_id, occurred_at desc);
create index if not exists idx_audit_action on audit_logs(action, occurred_at desc);
create index if not exists idx_audit_ref on audit_logs(ref_table, ref_id);

-- ห้าม update/delete audit log
create or replace function audit_immutable() returns trigger as $$
begin
  raise exception 'audit_logs is append-only';
end $$ language plpgsql;

drop trigger if exists trg_audit_immutable on audit_logs;
create trigger trg_audit_immutable before update or delete on audit_logs
for each row execute function audit_immutable();

-- ---------------------------------------------------------------------
-- TAX DOCUMENTS (ใบกำกับภาษี / e-Tax Invoice by Email / RD)
-- ---------------------------------------------------------------------
do $$ begin
  create type tax_doc_type as enum (
    'abb_tax_invoice',      -- ใบกำกับภาษีอย่างย่อ (สลิปหน้าร้าน)
    'full_tax_invoice',     -- ใบกำกับภาษีเต็มรูป
    'credit_note',          -- ใบลดหนี้ (คืนสินค้า)
    'debit_note',
    'receipt'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type etax_status as enum ('not_required','draft','queued','signed','submitted','delivered','failed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists tax_documents (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,              -- 'IV6909160042'
  doc_type      tax_doc_type not null,
  order_id      uuid references orders(id) on delete set null,
  return_id     uuid references returns(id) on delete set null,
  branch_id     uuid not null references branches(id),
  issue_date    date not null default current_date,
  -- ผู้ขาย
  seller_tax_id text,
  seller_branch_no text default '00000',
  -- ผู้ซื้อ
  buyer_name    text,
  buyer_tax_id  text,
  buyer_branch_no text,
  buyer_address text,
  buyer_email   text,
  -- ยอด
  amount_before_vat numeric(14,2) not null default 0,
  vat_rate      numeric(5,2) not null default 7.00,
  vat_amount    numeric(14,2) not null default 0,
  amount_total  numeric(14,2) not null default 0,
  -- e-Tax
  etax_status   etax_status not null default 'not_required',
  etax_provider text,                              -- 'inet','frank','ksher','manual'
  etax_ref      text,
  etax_xml_url  text,
  etax_pdf_url  text,
  etax_error    text,
  replaces_doc_no text,                            -- กรณีออกใหม่แทนใบเดิม
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_taxdoc_order on tax_documents(order_id);
create index if not exists idx_taxdoc_branch_date on tax_documents(branch_id, issue_date desc);

-- running number ต่อสาขา/ต่อเดือน/ต่อเครื่อง
create table if not exists document_sequences (
  scope_key   text primary key,                    -- 'order:R9A:2609' / 'tax:BR001:2609'
  last_value  int not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SETTINGS
-- ---------------------------------------------------------------------
create table if not exists settings (
  key         text primary key,
  scope       text not null default 'global' check (scope in ('global','branch','terminal')),
  branch_id   uuid references branches(id) on delete cascade,
  value       jsonb not null default '{}'::jsonb,
  description text,
  updated_by  uuid references employees(id),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SYNC LOG (offline → online)
-- ---------------------------------------------------------------------
create table if not exists sync_batches (
  id            uuid primary key default gen_random_uuid(),
  terminal_id   uuid references terminals(id) on delete set null,
  branch_id     uuid references branches(id) on delete set null,
  employee_id   uuid references employees(id) on delete set null,
  item_count    int not null default 0,
  success_count int not null default 0,
  failed_count  int not null default 0,
  duplicate_count int not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error         text
);

create table if not exists sync_conflicts (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid references sync_batches(id) on delete cascade,
  entity        text not null,                     -- 'order','return','cash_movement'
  client_uuid   uuid,
  reason        text not null,                     -- 'duplicate','stock_negative','invalid_shift','price_changed'
  payload       jsonb,
  resolved_by   uuid references employees(id),
  resolved_at   timestamptz,
  resolution    text,
  created_at    timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['tax_documents'] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
