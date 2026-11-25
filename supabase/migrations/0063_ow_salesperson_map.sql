-- 0063 · ผูกพนักงาน POS ↔ พนักงานขาย JST (UserId) รายสาขา (ERIS-254: OW GET /v1/sales/salesmen → ส่ง salespersonId ใน POST/PATCH /sales)
-- บิลที่ผูกได้จะส่ง salespersonId (พนักงานขาย ถ้าไม่ระบุใช้แคชเชียร์) · ไม่ผูก = ไม่ส่ง (JST ใช้ค่าเริ่มต้นของร้าน)
create table if not exists pos_ow_salesperson_map (
  source text not null,
  branch_id uuid not null references branches(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  jst_user_id text not null check (length(jst_user_id) between 1 and 64),
  jst_name text,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  primary key (source, branch_id, employee_id)
);
alter table pos_ow_salesperson_map enable row level security;
revoke all on pos_ow_salesperson_map from anon, authenticated;
