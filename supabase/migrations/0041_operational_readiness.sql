-- Additive operational controls. No stock initialization and no product is activated by migration.
alter table products add column if not exists review_version integer not null default 1;
alter table products add column if not exists serial_policy_confirmed boolean not null default false;
alter table products add column if not exists kind_policy_confirmed boolean not null default false;
alter table products add column if not exists reviewed_by uuid references employees(id);
alter table products add column if not exists reviewed_at timestamptz;
alter table products add column if not exists review_note text;
alter table campaigns add column if not exists version integer not null default 1;
alter table campaigns add column if not exists archived_at timestamptz;

create table if not exists pos_product_reviews (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references products(id),actor_id uuid not null references employees(id),
 before_data jsonb not null,after_data jsonb not null,reason text not null,created_at timestamptz not null default now()
);
create table if not exists pos_integration_events (
 id uuid primary key default gen_random_uuid(),source text not null,event_key text not null,event_type text not null,
 aggregate_id text not null,aggregate_version bigint not null default 1,payload jsonb not null,
 state text not null default 'blocked' check(state in('queued','processing','retry','delivered','blocked','dead')),
 reason text,attempts integer not null default 0,available_at timestamptz not null default now(),
 lease_until timestamptz,lease_token uuid,response jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(source,event_key)
);
create index if not exists pos_integration_events_pending on pos_integration_events(source,state,available_at);
create table if not exists pos_sync_settings (
 source text primary key,enabled boolean not null default false,interval_seconds integer not null default 60 check(interval_seconds between 30 and 3600),
 catalog_interval_seconds integer not null default 900 check(catalog_interval_seconds between 300 and 86400),
 actor_id uuid not null references employees(id),updated_at timestamptz not null default now(),version integer not null default 1,
 worker_seen_at timestamptz,last_started_at timestamptz,last_success_at timestamptz,last_catalog_at timestamptz,last_error text,lease_until timestamptz,lease_token uuid
);
create table if not exists pos_sync_runs (
 id uuid primary key default gen_random_uuid(),source text not null,mode text not null check(mode in('full','operational')),
 state text not null check(state in('running','completed','partial','failed')),started_at timestamptz not null default now(),completed_at timestamptz,
 summary jsonb,error text
);
create table if not exists pos_event_inbox (
 source text not null,event_id text not null,event_type text not null,aggregate_id text not null,aggregate_version bigint not null,
 payload jsonb not null,state text not null default 'received' check(state in('received','applied','rejected')),received_at timestamptz not null default now(),
 primary key(source,event_id)
);
do $$ declare t text;begin
 foreach t in array array['pos_product_reviews','pos_integration_events','pos_sync_settings','pos_sync_runs','pos_event_inbox'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);
 end loop;
end $$;

create or replace function pos_assert_admin_actor(p_actor uuid,p_permission text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e employees; effect text;
begin
 perform pos_assert_actor_active(p_actor);select * into e from employees where id=p_actor;
 effect:=e.permission_overrides->>p_permission;
 if effect in('deny','approval')then raise exception 'permission_denied';end if;
 if effect='allow' then return;end if;
 if e.role::text in('owner','hq')then return;end if;
 if not exists(select 1 from role_permissions where role=e.role and permission=p_permission and role_permissions.effect='allow')then raise exception 'permission_denied';end if;
end $$;

create or replace function pos_review_product(p_id uuid,p_actor uuid,p_version integer,p_patch jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare before_row products; after_row products; activate boolean;issues jsonb; link record;
begin
 perform pos_assert_admin_actor(p_actor,'admin.product_manage');perform pos_assert_admin_actor(p_actor,'report.cost');
 if not exists(select 1 from employees where id=p_actor and data_scope='company')then raise exception 'company_scope_required';end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'review_reason_required';end if;
 select * into before_row from products where id=p_id for update;if not found then raise exception 'product_not_found';end if;
 if before_row.review_version<>p_version then raise exception 'product_version_conflict';end if;
 if p_patch ? 'track_serial' and (p_patch->>'track_serial')::boolean<>before_row.track_serial and (
 exists(select 1 from serials where product_id=p_id) or exists(select 1 from stock_levels where product_id=p_id and (qty_on_hand<>0 or qty_otwo<>0 or qty_reserved<>0 or qty_reserved_order<>0)) or
 exists(select 1 from pos_checkout_holds h,lateral jsonb_array_elements(h.quote->'items') i where (i->>'product_id')::uuid=p_id and h.status='active' and (h.expires_at>now() or jsonb_array_length(h.recorded_payments)>0)))then raise exception 'serial_policy_has_existing_inventory';end if;
 activate:=case when p_patch?'is_active' then (p_patch->>'is_active')::boolean else before_row.is_active end;
 update products set name_th=case when p_patch?'name_th' then trim(p_patch->>'name_th')else name_th end,
 price=case when p_patch?'price' then (p_patch->>'price')::numeric else price end,
 cost=case when p_patch?'cost' then (p_patch->>'cost')::numeric else cost end,
 brand_id=case when p_patch?'brand_id' then nullif(p_patch->>'brand_id','')::uuid else brand_id end,
 category_id=case when p_patch?'category_id' then nullif(p_patch->>'category_id','')::uuid else category_id end,
 unit=case when p_patch?'unit' then trim(p_patch->>'unit')else unit end,
 track_serial=case when p_patch?'track_serial' then (p_patch->>'track_serial')::boolean else track_serial end,
 serial_policy_confirmed=case when p_patch?'serial_policy_confirmed' then (p_patch->>'serial_policy_confirmed')::boolean else serial_policy_confirmed end,
 kind_policy_confirmed=case when p_patch?'kind_policy_confirmed' then (p_patch->>'kind_policy_confirmed')::boolean else kind_policy_confirmed end,
 is_active=activate,reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_reason),review_version=review_version+1,updated_at=now()
 where id=p_id returning * into after_row;
 if after_row.price<0 or after_row.cost<0 or after_row.price::text in('NaN','Infinity') or after_row.cost::text in('NaN','Infinity')or trim(after_row.name_th)=''or trim(after_row.unit)=''then raise exception 'invalid_product_values';end if;
 if activate and (after_row.price<=0 or after_row.brand_id is null or after_row.category_id is null or not after_row.serial_policy_confirmed)then raise exception 'product_not_ready_price_brand_category_serial';end if;
 if activate and (after_row.kind='bundle' or exists(select 1 from pos_catalog_links where product_id=p_id and (source_detail->>'is_combined')::boolean is true))then raise exception 'bundle_requires_approved_bom_checkout';end if;
 if activate and exists(select 1 from pos_catalog_links where product_id=p_id and source_detail->>'is_combined' is null)and not after_row.kind_policy_confirmed then raise exception 'product_kind_not_confirmed';end if;
 if activate and after_row.vat_rate<>7 then raise exception 'unsupported_checkout_vat';end if;
 if not activate and exists(select 1 from pos_checkout_holds h,lateral jsonb_array_elements(h.quote->'items') i where (i->>'product_id')::uuid=p_id and h.status='active' and jsonb_array_length(h.recorded_payments)>0)then raise exception 'product_has_paid_checkout_review_required';end if;
 for link in select * from pos_catalog_links where product_id=p_id for update loop
  select coalesce(jsonb_agg(value),'[]'::jsonb)into issues from jsonb_array_elements_text(link.readiness)where value in('ยังไม่ผูกคลังกับสาขา','ยังไม่ตรวจสต๊อก');
  if after_row.price<=0 then issues:=issues||'"ยังไม่มีราคาขายที่อนุมัติ"'::jsonb;end if;
  if after_row.brand_id is null or after_row.category_id is null then issues:=issues||'"รอตรวจแบรนด์และหมวดหมู่ใน POS"'::jsonb;end if;
  if not after_row.serial_policy_confirmed then issues:=issues||'"ยังไม่ยืนยันนโยบาย SN"'::jsonb;end if;
  if after_row.kind='bundle'then issues:=issues||'"รอส่วนประกอบและการขายสินค้าชุด"'::jsonb;end if;
  update pos_catalog_links set readiness=issues,updated_at=now()where source=link.source and sku_key=link.sku_key;
 end loop;
 insert into pos_product_reviews(product_id,actor_id,before_data,after_data,reason)values(p_id,p_actor,to_jsonb(before_row),to_jsonb(after_row),trim(p_reason));
 insert into audit_logs(action,actor_id,ref_table,ref_id,ref_no,after_data)values('product_review',p_actor,'products',p_id,after_row.sku,jsonb_build_object('review_version',after_row.review_version,'is_active',after_row.is_active,'serial_policy_confirmed',after_row.serial_policy_confirmed));
 return to_jsonb(after_row);
end $$;

create or replace function pos_save_campaign(p_id uuid,p_actor uuid,p_expected_version integer,p_row jsonb,p_refs jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns; previous campaigns; pr products; ref jsonb; product_ids uuid[]; existing_count integer;
begin
 perform pos_assert_admin_actor(p_actor,'admin.permission_manage');
 if not exists(select 1 from employees where id=p_actor and data_scope='company')then raise exception 'company_scope_required';end if;
 if p_id is not null then select * into previous from campaigns where id=p_id for update;if not found then raise exception 'campaign_not_found';end if;if previous.version<>p_expected_version then raise exception 'campaign_version_conflict';end if;if previous.archived_at is not null then raise exception 'campaign_archived';end if;end if;
 if jsonb_typeof(p_refs)<>'array'or jsonb_array_length(p_refs)>400 then raise exception 'invalid_campaign_products';end if;
 if nullif(trim(p_row->>'name'),'')is null then raise exception 'campaign_name_required';end if;
 if (p_row->>'discount_type')not in('amount','percent')or(p_row->>'promo_type')not in('discount','gift')or(p_row->>'eligible_scope')not in('all','selected')then raise exception 'invalid_campaign_type';end if;
 if (p_row->>'min_spend')::numeric<0 or (p_row->>'discount_value')::numeric<0 or ((p_row->>'discount_type')='percent'and(p_row->>'discount_value')::numeric>100)then raise exception 'invalid_campaign_discount';end if;
 if (p_row->>'starts_at')::date>(p_row->>'ends_at')::date then raise exception 'invalid_campaign_dates';end if;
 if exists(select 1 from jsonb_array_elements(p_refs) x group by x->>'role',x->>'product_id' having count(*)>1)then raise exception 'duplicate_campaign_product';end if;
 -- Stable lock order prevents concurrent product edits/deactivation while activation is validated.
 perform 1 from products where id in(select(x->>'product_id')::uuid from jsonb_array_elements(p_refs)x)order by id for share;
 for ref in select value from jsonb_array_elements(p_refs) loop
  select * into pr from products where id=(ref->>'product_id')::uuid;
  if not found or pr.sku<>ref->>'sku' or ref->>'role' not in('eligible','gift')then raise exception 'campaign_product_mismatch';end if;
  if (p_row->>'active')::boolean and not pr.is_active then raise exception 'campaign_product_inactive';end if;
  if (ref->>'gift_qty')::integer<1 then raise exception 'invalid_gift_quantity';end if;
 end loop;
 if p_row->>'eligible_scope'='selected'and not exists(select 1 from jsonb_array_elements(p_refs)x where x->>'role'='eligible')then raise exception 'eligible_products_required';end if;
 if p_row->>'promo_type'='gift'and not exists(select 1 from jsonb_array_elements(p_refs)x where x->>'role'='gift')then raise exception 'gift_products_required';end if;
 c:=jsonb_populate_record(null::campaigns,p_row);
 c.id:=coalesce(p_id,gen_random_uuid());c.created_by:=coalesce(previous.created_by,p_actor);c.created_at:=coalesce(previous.created_at,now());c.updated_at:=now();c.version:=coalesce(previous.version,0)+1;
 if p_id is null then insert into campaigns select c.*;else
 update campaigns set name=c.name,description=c.description,code=c.code,discount_type=c.discount_type,discount_value=c.discount_value,max_discount=c.max_discount,min_spend=c.min_spend,target_segment=c.target_segment,starts_at=c.starts_at,ends_at=c.ends_at,usage_limit=c.usage_limit,per_customer_limit=c.per_customer_limit,active=c.active,brand_ids=coalesce(c.brand_ids,'{}'),branch_ids=coalesce(c.branch_ids,'{}'),channels=coalesce(c.channels,'{}'),is_automatic=coalesce(c.is_automatic,false),promo_type=c.promo_type,eligible_scope=c.eligible_scope,eligible_min_qty=c.eligible_min_qty,eligible_across_sku=coalesce(c.eligible_across_sku,true),gift_mode=c.gift_mode,gift_per_qty=c.gift_per_qty,gift_cap=c.gift_cap,cover_url=c.cover_url,version=c.version,updated_at=c.updated_at where id=p_id;
 end if;
 delete from campaign_products where campaign_id=c.id;
 insert into campaign_products(campaign_id,product_id,sku,name,role,gift_qty)select c.id,(x->>'product_id')::uuid,x->>'sku',(select name_th from products where id=(x->>'product_id')::uuid),x->>'role',(x->>'gift_qty')::integer from jsonb_array_elements(p_refs)x;
 insert into audit_logs(action,actor_id,ref_table,ref_id,ref_no,after_data)values('campaign_save',p_actor,'campaigns',c.id,c.name,jsonb_build_object('version',c.version,'active',c.active));
 return jsonb_build_object('id',c.id,'version',c.version);
end $$;

create or replace function pos_claim_sync(p_source text,p_token uuid,p_force boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_sync_settings; mode text;run uuid;
begin
 select * into s from pos_sync_settings where source=p_source for update;
 if not found or s.lease_until>now() or (not p_force and (not s.enabled or s.last_started_at>now()-make_interval(secs=>s.interval_seconds)))then return null;end if;
 if not exists(select 1 from employees where id=s.actor_id and data_scope='company')then raise exception 'company_scope_required';end if;
 update pos_sync_runs set state='failed',completed_at=now(),error='Worker lease expired before completion'where source=p_source and state='running';
 perform pos_assert_admin_actor(s.actor_id,'admin.product_manage');perform pos_assert_admin_actor(s.actor_id,'report.cost');
 mode:=case when p_force or s.last_catalog_at is null or s.last_catalog_at<now()-make_interval(secs=>s.catalog_interval_seconds)then 'full'else 'operational'end;
 update pos_sync_settings set lease_token=p_token,lease_until=now()+interval '5 minutes',last_started_at=now()where source=p_source;
 insert into pos_sync_runs(source,mode,state)values(p_source,mode,'running')returning id into run;
 return jsonb_build_object('id',run,'mode',mode,'actor_id',s.actor_id,'token',p_token);
end $$;
create or replace function pos_finish_sync(p_source text,p_token uuid,p_run uuid,p_summary jsonb,p_error text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from pos_sync_settings where source=p_source and lease_token=p_token for update)then raise exception 'sync_lease_lost';end if;
 update pos_sync_runs set state=case when p_error is not null then 'failed'when coalesce((p_summary->>'errors')::int,0)>0 then 'partial'else 'completed'end,summary=p_summary,error=p_error,completed_at=now()where id=p_run and source=p_source;
 update pos_sync_settings set lease_until=null,lease_token=null,last_error=p_error,last_success_at=case when p_error is null and coalesce((p_summary->>'errors')::int,0)=0 then now()else last_success_at end,last_catalog_at=case when p_error is null and coalesce((p_summary->>'errors')::int,0)=0 and exists(select 1 from pos_sync_runs where id=p_run and mode='full')then now()else last_catalog_at end where source=p_source;
end $$;

create or replace function pos_queue_sale_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare src text;payload jsonb;
begin
 if new.status='committed'and old.status is distinct from new.status then
  select source into src from pos_warehouse_links where branch_id=new.branch_id order by source limit 1;
  src:=coalesce(src,'onewarehouse:unmapped');
  select jsonb_build_object('schema_version',1,'sale_id',new.id,'branch_id',new.branch_id,'warehouse_id',(select warehouse_id from pos_warehouse_links where branch_id=new.branch_id and source=src limit 1),'grand_total',new.quote->'grand_total','currency','THB','items',coalesce(jsonb_agg(jsonb_build_object('product_id',i->>'product_id','sku',i->>'sku','qty',i->'qty','serials',i->'serials','unit_price',i->'unit_price')),'[]'))into payload from jsonb_array_elements(new.quote->'items')i;
  insert into pos_integration_events(source,event_key,event_type,aggregate_id,payload,state,reason)values(src,'sale:'||new.id::text,'sale.committed',new.id::text,payload,'blocked','OW sale write contract and warehouse mapping must be confirmed')on conflict(source,event_key)do nothing;
 end if;return new;
end $$;
drop trigger if exists pos_checkout_outbox on pos_checkout_holds;
create trigger pos_checkout_outbox after update on pos_checkout_holds for each row execute function pos_queue_sale_event();

-- Keep browser roles away from financial/admin mutation RPCs.
revoke all on function pos_assert_admin_actor(uuid,text),pos_review_product(uuid,uuid,integer,jsonb,text),pos_save_campaign(uuid,uuid,integer,jsonb,jsonb),pos_claim_sync(text,uuid,boolean),pos_finish_sync(text,uuid,uuid,jsonb,text),pos_queue_sale_event() from public,anon,authenticated;
grant execute on function pos_assert_admin_actor(uuid,text),pos_review_product(uuid,uuid,integer,jsonb,text),pos_save_campaign(uuid,uuid,integer,jsonb,jsonb),pos_claim_sync(text,uuid,boolean),pos_finish_sync(text,uuid,uuid,jsonb,text) to service_role;

-- Recheck activation/SN rules at reservation and commit, while allowing a held price to remain frozen.
do $$ begin
 if to_regprocedure('public.pos_reserve_checkout_inventory(uuid,uuid,uuid,jsonb)') is null then alter function public.pos_reserve_checkout(uuid,uuid,uuid,jsonb) rename to pos_reserve_checkout_inventory;end if;
end $$;
create or replace function pos_reserve_checkout(p_id uuid,p_actor uuid,p_branch uuid,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare line jsonb;pr products;
begin
 perform pos_assert_actor_active(p_actor);
 perform 1 from products where id in(select (i->>'product_id')::uuid from jsonb_array_elements(p_quote->'items')i)order by id for share;
 for line in select value from jsonb_array_elements(p_quote->'items')loop
  select * into pr from products where id=(line->>'product_id')::uuid;
  if not found or not pr.is_active then raise exception 'product_inactive';end if;
  if pr.kind='bundle'then raise exception 'bundle_checkout_not_ready';end if;
  if pr.track_serial and (jsonb_array_length(coalesce(line->'serials','[]'))<>(line->>'qty')::numeric)then raise exception 'serial_count_mismatch';end if;
  if not pr.track_serial and jsonb_array_length(coalesce(line->'serials','[]'))<>0 then raise exception 'unexpected_serial';end if;
 end loop;
 return pos_reserve_checkout_inventory(p_id,p_actor,p_branch,p_quote);
end $$;
revoke all on function pos_reserve_checkout_inventory(uuid,uuid,uuid,jsonb),pos_reserve_checkout(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function pos_reserve_checkout_inventory(uuid,uuid,uuid,jsonb),pos_reserve_checkout(uuid,uuid,uuid,jsonb) to service_role;

create or replace function pos_archive_campaign(p_id uuid,p_actor uuid,p_version integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns;
begin
 perform pos_assert_admin_actor(p_actor,'admin.permission_manage');
 if not exists(select 1 from employees where id=p_actor and data_scope='company')then raise exception 'company_scope_required';end if;
 select * into c from campaigns where id=p_id for update;if not found then raise exception 'campaign_not_found';end if;
 if c.version<>p_version then raise exception 'campaign_version_conflict';end if;
 update campaigns set active=false,archived_at=now(),version=version+1,updated_at=now()where id=p_id;
 insert into audit_logs(action,actor_id,ref_table,ref_id,ref_no,after_data)values('campaign_archive',p_actor,'campaigns',p_id,c.name,jsonb_build_object('version',p_version+1));
end $$;
revoke all on function pos_archive_campaign(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function pos_archive_campaign(uuid,uuid,integer) to service_role;
