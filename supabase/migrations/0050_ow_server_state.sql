-- =====================================================================
-- 0050 — ใบโอน/ขายที่ OneWarehouse เป็นตัวจริง: เซิร์ฟเวอร์เป็นเจ้าของสถานะ (IndexedDB = แคชแสดงผล)
--   1) pos_ow_transfers: + revision (เพิ่มทุกครั้งที่เปลี่ยน) · link_state (สถานะการเชื่อม แยกจากสถานะธุรกิจ)
--      · origin (pos | ow = ใบที่คลังกลางเปิดเอง) · from_branch_id เป็น null ได้ (ต้นทาง = คลังกลางที่ไม่ใช่สาขา)
--   2) pos_ow_transfer_lines: ใบ OW 1 ใบ/สินค้า — OW transfer id เป็นรหัสหลัก (กันดึงซ้ำ) + คำสั่ง/ผลล่าสุดต่อใบ
--   3) pos_ow_movements + pos_ow_apply_movement(): ปรับ stock_levels/serials ที่ checkout ใช้ ตามผลจริงจาก OW
--      แบบ idempotent (move_key ซ้ำ = ไม่ปรับซ้ำ) → โหลด/ลองซ้ำไม่บวกลบสต๊อกซ้ำ
--   4) pos_serial_corrections: ประวัติแก้ SN ในบิล (เดิม → ใหม่ · ผู้แก้ · เหตุผล)
--   5) pos_ow_link_branch(): บันทึกการผูกสาขา↔คลัง/สาขาขายใน transaction เดียว
--   6) trigger ขาย: เลือก source ที่มี pos_sync_settings (ใช้งานจริง) ก่อน — ไม่ใช่ order by source limit 1
-- =====================================================================

alter table pos_ow_transfers alter column from_branch_id drop not null;
alter table pos_ow_transfers add column if not exists revision bigint not null default 1;
alter table pos_ow_transfers add column if not exists link_state text not null default 'ok'
  check (link_state in ('ok','creating','partially_created','recovery_required','checking'));
alter table pos_ow_transfers add column if not exists origin text not null default 'pos' check (origin in ('pos','ow'));
alter table pos_ow_transfers add column if not exists last_error text;
create index if not exists pos_ow_transfers_rev on pos_ow_transfers(source, updated_at desc, revision);

create table if not exists pos_ow_transfer_lines (
  source text not null,
  ow_id text not null,
  pos_transfer_id uuid not null,
  product_id uuid references products(id),
  sku text not null,
  qty integer not null check (qty > 0),
  serialized boolean,
  state jsonb not null default '{}'::jsonb,       -- {status,version,syncState,jstAllocationNo,orderNo}
  last_op jsonb,                                  -- {op,opKey,at,ok,code,message}
  updated_at timestamptz not null default now(),
  primary key (source, ow_id)
);
create unique index if not exists pos_ow_transfer_lines_item on pos_ow_transfer_lines(source, pos_transfer_id, sku);

create table if not exists pos_ow_movements (
  source text not null,
  move_key text not null,
  branch_id uuid not null references branches(id),
  product_id uuid not null references products(id),
  qty_on_hand numeric(14,3) not null default 0,
  qty_quarantine numeric(14,3) not null default 0,
  serials text[] not null default '{}',
  serial_status text,
  ref text,
  applied_at timestamptz not null default now(),
  primary key (source, move_key)
);

create table if not exists pos_serial_corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  order_item_id uuid references order_items(id),
  sku text not null,
  old_serials text[] not null,
  new_serials text[] not null,
  reason text not null,
  actor_id uuid not null references employees(id),
  ow_sale_id text,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['pos_ow_transfer_lines','pos_ow_movements','pos_serial_corrections'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- ปรับสต๊อก/SN ตามผลจริงจาก OW แบบ idempotent
create or replace function pos_ow_apply_movement(p_source text, p_key text, p_branch uuid, p_product uuid,
  p_onhand numeric, p_quarantine numeric, p_serials text[], p_serial_status text, p_ref text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare sn text;
begin
  insert into pos_ow_movements(source, move_key, branch_id, product_id, qty_on_hand, qty_quarantine, serials, serial_status, ref)
  values (p_source, p_key, p_branch, p_product, coalesce(p_onhand,0), coalesce(p_quarantine,0), coalesce(p_serials,'{}'), p_serial_status, p_ref)
  on conflict (source, move_key) do nothing;
  if not found then return false; end if;
  insert into stock_levels(branch_id, product_id, qty_on_hand, qty_quarantine)
  values (p_branch, p_product, coalesce(p_onhand,0), greatest(0, coalesce(p_quarantine,0)))
  on conflict (branch_id, product_id) do update set
    qty_on_hand = stock_levels.qty_on_hand + coalesce(p_onhand,0),
    qty_quarantine = greatest(0, stock_levels.qty_quarantine + coalesce(p_quarantine,0)),
    updated_at = now();
  if p_serial_status is not null then
    foreach sn in array coalesce(p_serials,'{}') loop
      insert into serials(product_id, serial_no, branch_id, status, received_at, note)
      values (p_product, sn, p_branch, p_serial_status::serial_status, case when p_serial_status in ('in_stock','defective') then now() end, p_ref)
      on conflict (product_id, serial_no) do update set branch_id = p_branch, status = p_serial_status::serial_status,
        received_at = case when p_serial_status in ('in_stock','defective') then now() else serials.received_at end,
        note = p_ref, updated_at = now();
    end loop;
  end if;
  return true;
end $$;

-- ผูกสาขาใน transaction เดียว (ลบของเดิม + ใส่ใหม่ ล้มทั้งชุดถ้ามีจุดใดล้ม)
create or replace function pos_ow_link_branch(p_source text, p_branch uuid, p_warehouse text, p_ow_branch text, p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from pos_warehouse_links where source = p_source and branch_id = p_branch;
  if coalesce(p_warehouse,'') <> '' then
    insert into pos_warehouse_links(source, warehouse_id, branch_id, updated_by, updated_at)
    values (p_source, p_warehouse, p_branch, p_actor, now())
    on conflict (source, warehouse_id) do update set branch_id = excluded.branch_id, updated_by = excluded.updated_by, updated_at = now();
  end if;
  if coalesce(p_ow_branch,'') <> '' then
    insert into pos_ow_sale_branches(source, branch_id, ow_branch_id, updated_by, updated_at)
    values (p_source, p_branch, p_ow_branch, p_actor, now())
    on conflict (source, branch_id) do update set ow_branch_id = excluded.ow_branch_id, updated_by = excluded.updated_by, updated_at = now();
  else
    delete from pos_ow_sale_branches where source = p_source and branch_id = p_branch;
  end if;
end $$;

-- คิวจองงาน: lease 5 นาที (ชุดเล็ก) — worker ต้องถือ lease_token เดิมตอนบันทึกผล
create or replace function pos_claim_integration_events(p_source text, p_token uuid, p_limit integer default 5, p_types text[] default null)
returns setof pos_integration_events language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query
  update pos_integration_events e set state='processing', lease_token=p_token, lease_until=now()+interval '5 minutes',
    attempts=e.attempts+1, updated_at=now()
  where e.id in (
    select id from pos_integration_events
    where source=p_source
      and (p_types is null or event_type=any(p_types))
      and ((state in ('queued','retry') and available_at<=now()) or (state='processing' and lease_until<now()))
    order by available_at
    limit greatest(1, least(p_limit, 20))
    for update skip locked
  )
  returning e.*;
end $$;

-- trigger ขาย: source ที่ใช้งานจริง (มี pos_sync_settings) มาก่อน
create or replace function pos_queue_sale_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare src text; owb text; payload jsonb;
begin
  if new.status='committed' and old.status is distinct from new.status then
    select s.source, s.ow_branch_id into src, owb from pos_ow_sale_branches s
      left join pos_sync_settings c on c.source = s.source
      where s.branch_id = new.branch_id
      order by (c.source is null), s.source limit 1;
    if src is null then
      select l.source into src from pos_warehouse_links l left join pos_sync_settings c on c.source = l.source
        where l.branch_id = new.branch_id order by (c.source is null), l.source limit 1;
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

revoke all on function pos_ow_apply_movement(text,text,uuid,uuid,numeric,numeric,text[],text,text), pos_ow_link_branch(text,uuid,text,text,uuid),
  pos_claim_integration_events(text,uuid,integer,text[]), pos_queue_sale_event() from public, anon, authenticated;
grant execute on function pos_ow_apply_movement(text,text,uuid,uuid,numeric,numeric,text[],text,text), pos_ow_link_branch(text,uuid,text,text,uuid),
  pos_claim_integration_events(text,uuid,integer,text[]) to service_role;
