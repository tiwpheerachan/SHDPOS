-- 0093 ฟิลด์เพิ่มเองในตารางยอดขาย (แบบ Lark Base): สร้างคอลัมน์ + กรอกค่าต่อบิลได้ — ไม่แตะข้อมูลบิลจริง
--   order_key = id บิล POS (uuid) หรือ id บิลระบบเดิม (lark:…)
create table if not exists sales_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  type text not null check (type in ('text', 'number', 'select', 'checkbox', 'date')),
  options jsonb not null default '[]'::jsonb, -- select: [{ "id": "...", "label": "...", "color": 0..8 }]
  position int not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);
create table if not exists sales_field_values (
  order_key text not null,
  field_id uuid not null references sales_fields(id) on delete cascade,
  value jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (order_key, field_id)
);
create index if not exists sales_field_values_field_idx on sales_field_values (field_id);
alter table sales_fields enable row level security;
alter table sales_field_values enable row level security; -- เข้าถึงผ่าน API ฝั่งเซิร์ฟเวอร์เท่านั้น
