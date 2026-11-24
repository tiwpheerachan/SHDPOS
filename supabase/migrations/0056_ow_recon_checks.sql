-- =====================================================================
-- 0056 — บันทึกผล "ตรวจความตรงกัน" POS ↔ OneWarehouse ↔ JST (เก็บทุกรอบเป็นประวัติ)
--   kind: sale | transfer | stock · status: match | mismatch | pending | info
--   diffs: [{field, pos, ow, jst, ok, note}] · pos_data / ow_data = ภาพข้อมูลจริง ณ เวลาตรวจ (หลักฐานย้อนหลัง)
--   อ่าน/เขียนผ่าน service role เท่านั้น (เปิด RLS ไม่มี policy)
-- =====================================================================
create table if not exists pos_ow_recon_checks (
  id bigint generated always as identity primary key,
  source text not null,
  run_id uuid not null,
  kind text not null check (kind in ('sale','transfer','stock')),
  ref text not null,
  branch_id uuid,
  status text not null check (status in ('match','mismatch','pending','info')),
  summary text,
  diffs jsonb not null default '[]',
  times jsonb not null default '{}',
  pos_data jsonb,
  ow_data jsonb,
  actor_id uuid,
  checked_at timestamptz not null default now()
);
create index if not exists pos_ow_recon_checks_run on pos_ow_recon_checks (source, checked_at desc);
create index if not exists pos_ow_recon_checks_ref on pos_ow_recon_checks (source, kind, ref, checked_at desc);
alter table pos_ow_recon_checks enable row level security;
