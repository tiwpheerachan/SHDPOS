-- =====================================================================
-- 0049 — เขียนข้อมูลไป OneWarehouse (UAT handoff 24 พ.ย. 2569)
--   1) pos_ow_sale_branches : สาขา POS ↔ "สาขาขาย" ของ OW (เช่น UAT-TEST) — ใช้กับ POST /v1/sales
--   2) pos_ow_transfers     : สำเนาใบโอนที่ OW เป็นตัวจริง (POS 1 ใบ = OW หลายใบ เพราะ JST รับ 1 SKU/ใบ)
--                             ให้เครื่องปลายทาง (คนละเครื่อง) ดึงใบเข้ามาสแกนรับได้
--   3) pos_claim_integration_events : จองงานในคิวส่ง (lease + SKIP LOCKED) ให้ worker หลายตัวไม่ชนกัน
--   4) trigger ขาย: สาขาที่ผูกสาขาขาย OW แล้ว → เข้าคิว 'queued' ทันที · ยังไม่ผูก → 'blocked' พร้อมเหตุผล
--   ไม่ลบข้อมูลใด ๆ · ทุกตารางเข้าถึงได้เฉพาะ service_role
-- =====================================================================

create table if not exists pos_ow_sale_branches (
  source text not null,
  branch_id uuid not null references branches(id),
  ow_branch_id text not null check (length(ow_branch_id) between 1 and 80),
  updated_by uuid not null references employees(id),
  updated_at timestamptz not null default now(),
  primary key (source, branch_id)
);

create table if not exists pos_ow_transfers (
  source text not null,
  pos_transfer_id uuid not null,
  transfer_no text not null,
  from_branch_id uuid not null references branches(id),
  to_branch_id uuid not null references branches(id),
  from_warehouse_id text not null,
  to_warehouse_id text not null,
  ow_ids jsonb not null default '{}'::jsonb,          -- { product_id: ow_transfer_id }
  ow_state jsonb not null default '{}'::jsonb,        -- { ow_transfer_id: {status,version,syncState,jstAllocationNo} }
  pos_snapshot jsonb not null,                        -- ใบโอนรูปแบบ POS ล่าสุด (สำหรับเครื่องอื่น)
  status text not null,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (source, pos_transfer_id)
);
create index if not exists pos_ow_transfers_to on pos_ow_transfers(source, to_branch_id, updated_at desc);
create index if not exists pos_ow_transfers_from on pos_ow_transfers(source, from_branch_id, updated_at desc);

do $$ declare t text; begin
  foreach t in array array['pos_ow_sale_branches','pos_ow_transfers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- จองงานในคิว (queued/retry ที่ถึงเวลา หรือ processing ที่ lease หมดอายุ)
create or replace function pos_claim_integration_events(p_source text, p_token uuid, p_limit integer default 10, p_types text[] default null)
returns setof pos_integration_events language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query
  update pos_integration_events e set state='processing', lease_token=p_token, lease_until=now()+interval '2 minutes',
    attempts=e.attempts+1, updated_at=now()
  where e.id in (
    select id from pos_integration_events
    where source=p_source
      and (p_types is null or event_type=any(p_types))
      and ((state in ('queued','retry') and available_at<=now()) or (state='processing' and lease_until<now()))
    order by available_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning e.*;
end $$;

-- trigger ขาย: ใช้ทะเบียนสาขาขาย OW (มาก่อนการผูกคลัง)
create or replace function pos_queue_sale_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare src text; owb text; payload jsonb;
begin
  if new.status='committed' and old.status is distinct from new.status then
    select source, ow_branch_id into src, owb from pos_ow_sale_branches where branch_id=new.branch_id order by source limit 1;
    if src is null then
      select source into src from pos_warehouse_links where branch_id=new.branch_id order by source limit 1;
    end if;
    src := coalesce(src, 'onewarehouse:unmapped');
    payload := jsonb_build_object('schema_version', 2, 'hold_id', new.id, 'branch_id', new.branch_id, 'ow_branch_id', owb,
      'grand_total', new.quote->'grand_total', 'currency', 'THB');
    insert into pos_integration_events(source, event_key, event_type, aggregate_id, payload, state, reason)
    values (src, 'sale:'||new.id::text, 'sale.committed', new.id::text, payload,
      case when owb is not null then 'queued' else 'blocked' end,
      case when owb is not null then null else 'สาขานี้ยังไม่ผูกสาขาขาย OneWarehouse' end)
    on conflict (source, event_key) do nothing;
  end if;
  return new;
end $$;

revoke all on function pos_claim_integration_events(text, uuid, integer, text[]), pos_queue_sale_event() from public, anon, authenticated;
grant execute on function pos_claim_integration_events(text, uuid, integer, text[]) to service_role;
