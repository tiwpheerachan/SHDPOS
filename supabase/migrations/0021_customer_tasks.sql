-- =====================================================================
-- SHD POS — 0021_customer_tasks.sql
-- งานติดตามลูกค้า / นัดหมาย (follow-up tasks)
--   • มอบหมายพนักงาน, ตั้งวันนัด/ครบกำหนด, บันทึกผลการติดต่อ
--   • ชนิด: follow_up (ติดตามทั่วไป) | quotation (ตามใบเสนอราคา)
--           | warranty (แจ้งประกัน) | callback (โทรกลับ) | other
--   • เชื่อมอ้างอิงเอกสารได้ (ref_type/ref_id) เช่น quotation/order/serial
--   เข้าถึงผ่าน service-role (แอดมิน API) เท่านั้น
-- =====================================================================
create table if not exists customer_tasks (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  branch_id    uuid references branches(id),
  assigned_to  uuid references employees(id) on delete set null,
  kind         text not null default 'follow_up',
  title        text not null,
  note         text,
  due_date     date,
  status       text not null default 'open',   -- open | done | cancelled
  ref_type     text,                            -- quotation | order | serial | null
  ref_id       uuid,
  result       text,                            -- บันทึกผลเมื่อปิดงาน
  created_by   uuid references employees(id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_tasks_status_due on customer_tasks(status, due_date);
create index if not exists idx_tasks_customer on customer_tasks(customer_id, created_at desc);
create index if not exists idx_tasks_assignee on customer_tasks(assigned_to, status);

alter table customer_tasks enable row level security;
