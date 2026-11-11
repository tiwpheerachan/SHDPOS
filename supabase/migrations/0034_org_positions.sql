-- =====================================================================
-- SHD POS — 0034_org_positions.sql
-- แผนผังองค์กรต่อสาขา: ตำแหน่ง (พิมพ์อิสระ) + สายบังคับบัญชา (reports_to)
--   * 1 พนักงาน มีได้ 1 ตำแหน่งต่อสาขา (unique branch_id+employee_id)
--   * reports_to = หัวหน้า (พนักงานอีกคน ปกติในสาขาเดียวกัน)
--   * จัดการผ่าน admin API (service-role) — RLS เปิดไว้ให้ authenticated อ่านได้
-- =====================================================================
create table if not exists org_positions (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  title       text not null default '',
  reports_to  uuid references employees(id) on delete set null,
  sort_order  int  not null default 0,
  updated_at  timestamptz not null default now(),
  unique (branch_id, employee_id)
);

create index if not exists idx_org_positions_branch on org_positions(branch_id);
create index if not exists idx_org_positions_emp on org_positions(employee_id);

alter table org_positions enable row level security;

-- authenticated อ่านได้ (ไม่ใช่ข้อมูลอ่อนไหว) · เขียนผ่าน service-role เท่านั้น
drop policy if exists org_positions_read on org_positions;
create policy org_positions_read on org_positions for select to authenticated using (true);

grant select on org_positions to authenticated;
