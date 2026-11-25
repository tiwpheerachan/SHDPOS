-- 0070 · กล่องรับเหตุการณ์จาก OneWarehouse (Pub/Sub push: transfer.created|shipped|inbound|closed|voided, warehouse.upserted)
--   at-least-once → กันทำซ้ำด้วย envelope id · เก็บผลการประมวลผลไว้ตรวจย้อนหลัง
create table if not exists pos_ow_event_inbox (
  id text primary key,
  event_type text not null,
  aggregate_id text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  payload jsonb
);
create index if not exists pos_ow_event_inbox_received on pos_ow_event_inbox(received_at desc);
alter table pos_ow_event_inbox enable row level security;
revoke all on pos_ow_event_inbox from anon, authenticated;
