-- Durable OW catalog staging. No imported quantity is posted to stock_levels.
create table if not exists pos_catalog_runs (
 id uuid primary key default gen_random_uuid(),source text not null,environment text not null,
 created_by uuid not null references employees(id),warehouse_id text,
 phase text not null default 'enumerating' check(phase in('enumerating','hydrating','review','completed')),
 cursor text,seen_cursors text[] not null default '{}',page_count int not null default 0,
 version int not null default 1,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists pos_catalog_items (
 run_id uuid not null references pos_catalog_runs(id) on delete cascade,sku_key text not null,sku text not null,
 summary jsonb not null,detail jsonb,detail_status text not null default 'pending' check(detail_status in('pending','ok','error','missing')),
 detail_error text,stage_error text,stock_qty numeric,stock_error text,bom_status text not null default 'unknown' check(bom_status in('unknown','ok','unavailable')),bom jsonb,
 attempts int not null default 0,match_kind text,imported_product_id uuid references products(id),import_kind text,import_error text,
 updated_at timestamptz not null default now(),primary key(run_id,sku_key)
);
create table if not exists pos_catalog_links (
 source text not null,sku_key text not null,product_id uuid not null references products(id),source_detail jsonb not null,
 readiness jsonb not null default '[]',last_run_id uuid references pos_catalog_runs(id),updated_at timestamptz not null default now(),primary key(source,sku_key),unique(source,product_id)
);
create table if not exists pos_warehouse_links (
 source text not null,warehouse_id text not null,branch_id uuid not null references branches(id),updated_by uuid not null references employees(id),updated_at timestamptz not null default now(),primary key(source,warehouse_id)
);
create table if not exists pos_catalog_import_events (
 id bigint generated always as identity primary key,run_id uuid not null references pos_catalog_runs(id),sku_key text not null,
 product_id uuid not null references products(id),actor_id uuid not null references employees(id),before_data jsonb,after_data jsonb not null,
 updated_prices boolean not null,created_at timestamptz not null default now()
);
do $$ declare t text;begin
 foreach t in array array['pos_catalog_runs','pos_catalog_items','pos_catalog_links','pos_warehouse_links','pos_catalog_import_events'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated',t);
 execute format('grant all on %I to service_role',t);
 end loop;
end $$;
create index if not exists pos_catalog_items_pending on pos_catalog_items(run_id,detail_status,sku_key);

create or replace function pos_catalog_checkpoint(p_id uuid,p_actor uuid,p_version int,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r pos_catalog_runs;i jsonb;token text;v_count int;
begin
 perform pos_assert_actor_active(p_actor);
 select * into r from pos_catalog_runs where id=p_id for update;
 if not found then raise exception 'run_not_found';end if;
 if r.version<>p_version then raise exception 'run_version_conflict';end if;
 if p_action='page' then
  if r.phase<>'enumerating' or (p_data->>'cursor') is distinct from r.cursor then raise exception 'cursor_conflict';end if;
  token:=case when r.cursor is null then 'initial' else 'cursor:'||r.cursor end;
  if token=any(r.seen_cursors) then raise exception 'cursor_loop';end if;
  if (p_data->>'has_more')::boolean and ('cursor:'||(p_data->>'next_cursor'))=any(r.seen_cursors||token) then raise exception 'cursor_loop';end if;
  for i in select value from jsonb_array_elements(p_data->'items') loop
   insert into pos_catalog_items(run_id,sku_key,sku,summary)values(p_id,upper(trim(i->>'sku')),trim(i->>'sku'),i)
   on conflict(run_id,sku_key)do update set stage_error=case when pos_catalog_items.sku<>excluded.sku then 'ต้นทางมี SKU ต่างรูปแบบแต่รหัสตรงกัน ต้องตรวจสอบ' else pos_catalog_items.stage_error end;
  end loop;
  update pos_catalog_runs set cursor=p_data->>'next_cursor',seen_cursors=seen_cursors||token,page_count=page_count+1,
   phase=case when (p_data->>'has_more')::boolean then 'enumerating' else 'hydrating' end where id=p_id;
 elsif p_action='hydrate' then
  if r.phase not in('hydrating','review') then raise exception 'run_wrong_phase';end if;
  for i in select value from jsonb_array_elements(p_data->'items') loop
   update pos_catalog_items set detail=i->'detail',detail_status=i->>'detail_status',detail_error=i->>'detail_error',
    stock_qty=(i->>'stock_qty')::numeric,stock_error=i->>'stock_error',bom_status=coalesce(i->>'bom_status','unknown'),bom=i->'bom',match_kind=pos_catalog_match_kind(p_id,i->>'sku_key',i->'detail'),attempts=attempts+1,updated_at=now()
    where run_id=p_id and sku_key=i->>'sku_key' and detail_status='pending';
  end loop;
  if not exists(select 1 from pos_catalog_items where run_id=p_id and detail_status='pending')then update pos_catalog_runs set phase='review' where id=p_id;end if;
 elsif p_action='retry' then
  if r.phase not in('review','hydrating','completed') then raise exception 'run_wrong_phase';end if;
  update pos_catalog_items set detail_status='pending',detail_error=null,import_error=null where run_id=p_id and import_kind is null
   and (detail_status in('error','missing')or stock_error is not null or bom_status='unavailable')
   and (p_data->'keys' is null or (p_data->'keys') ? sku_key);
  get diagnostics v_count=row_count;
  if v_count>0 then update pos_catalog_runs set phase='hydrating' where id=p_id;end if;
 else raise exception 'unknown_checkpoint_action';end if;
 update pos_catalog_runs set version=version+1,last_error=null,updated_at=now()where id=p_id returning * into r;
 return to_jsonb(r);
end $$;

create or replace function pos_catalog_stats(p_id uuid)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('found',count(*),'pending',count(*)filter(where detail_status='pending'),'hydrated',count(*)filter(where detail_status='ok'),
 'errors',count(*)filter(where detail_status in('error','missing')or stock_error is not null),'conflicts',count(*)filter(where match_kind='conflict' or stage_error is not null or import_error is not null),
 'created',count(*)filter(where import_kind='created'),'updated',count(*)filter(where import_kind='updated'),'imported',count(*)filter(where import_kind is not null)) from pos_catalog_items where run_id=p_id;
$$;

create or replace function pos_catalog_import(p_id uuid,p_actor uuid,p_version int,p_keys jsonb,p_expected jsonb,p_update_prices boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r pos_catalog_runs;it pos_catalog_items;d jsonb;p products;linked uuid;n int;v_barcode text;brand uuid;category uuid;issues jsonb;created boolean;expected jsonb;key text;before_product jsonb;
begin
 perform pos_assert_actor_active(p_actor);
 -- Serialize catalog writers before taking run/SKU/barcode locks; stock/sales remain independent.
 perform pg_advisory_xact_lock(hashtextextended('pos-catalog-import',0));
 select * into r from pos_catalog_runs where id=p_id for update;
 if not found or r.phase not in('review','completed')then raise exception 'run_not_reviewable';end if;
 if r.version<>p_version then raise exception 'run_version_conflict';end if;
 if jsonb_array_length(p_keys)>50 then raise exception 'import_batch_too_large';end if;
 for key in select jsonb_array_elements_text(p_keys) order by 1 loop
  select * into it from pos_catalog_items where run_id=p_id and sku_key=key for update;
  if not found or it.import_kind is not null then continue;end if;
  begin
   if it.detail_status<>'ok' or it.detail is null or it.stage_error is not null then raise exception 'ยังไม่มีรายละเอียดที่ตรวจสอบแล้ว';end if;
   d:=it.detail;
   perform pg_advisory_xact_lock(hashtextextended('catalog:'||key,0));
   select product_id into linked from pos_catalog_links where source=r.source and sku_key=key;
   select count(*) into n from products where upper(trim(sku))=key;
   if n>1 then raise exception 'SKU ซ้ำใน POS';end if;
   select * into p from products where upper(trim(sku))=key for update;
   if linked is not null and (p.id is null or p.id<>linked)then raise exception 'รหัสที่ผูกไว้ไม่ตรง SKU ปัจจุบัน';end if;
   expected:=p_expected->key;
   if expected is null then raise exception 'กรุณาตรวจตัวอย่างก่อนนำเข้า';end if;
   if (expected->>'id')is distinct from p.id::text or (p.id is not null and (expected->>'updated_at')::timestamptz is distinct from p.updated_at)then raise exception 'ข้อมูล POS เปลี่ยนหลังตรวจตัวอย่าง กรุณาโหลดใหม่';end if;
   if p.id is not null and jsonb_typeof(d->'serial_tracking')='boolean' and p.track_serial<>(d->>'serial_tracking')::boolean then raise exception 'นโยบาย SN ไม่ตรง ต้องตรวจด้วยผู้ดูแล';end if;
   if p.id is not null and jsonb_typeof(d->'is_combined')='boolean' and (p.kind='bundle')<>(d->>'is_combined')::boolean then raise exception 'ประเภทสินค้าชุดไม่ตรง ต้องตรวจด้วยผู้ดูแล';end if;
   v_barcode:=nullif(trim(d->>'barcode'),'');
   if v_barcode is not null then
    perform pg_advisory_xact_lock(hashtextextended('barcode:'||v_barcode,0));
    if exists(select 1 from product_barcodes where product_barcodes.barcode=v_barcode and product_id is distinct from p.id)then raise exception 'บาร์โค้ดถูกใช้กับสินค้าอีกตัว';end if;
   end if;
   select case when count(*)=1 then (array_agg(id))[1]end into brand from brands where lower(trim(code))=lower(trim(d->>'brand'))or lower(trim(name))=lower(trim(d->>'brand'));
   select case when count(*)=1 then (array_agg(id))[1]end into category from categories where lower(trim(code))=lower(trim(d->>'category'))or lower(trim(name_th))=lower(trim(d->>'category'))or lower(trim(name_en))=lower(trim(d->>'category'));
   before_product:=case when p.id is null then null else to_jsonb(p)end;
   created:=p.id is null;
   if created then
    insert into products(sku,name_th,short_name,brand_id,category_id,price,cost,kind,track_serial,image_url,is_active)
    values(it.sku,coalesce(nullif(d->>'name',''),it.sku),nullif(d->>'short_name',''),brand,category,
     coalesce((d->>'sale_price')::numeric,0),coalesce((d->>'cost_price')::numeric,0),
     case when (d->>'is_combined')::boolean then 'bundle'::product_kind else 'goods'::product_kind end,
     coalesce((d->>'serial_tracking')::boolean,false),nullif(d->>'image_url',''),false)returning * into p;
   else
    update products set name_th=coalesce(nullif(name_th,''),nullif(d->>'name',''),sku),short_name=coalesce(nullif(short_name,''),nullif(d->>'short_name','')),
     brand_id=coalesce(brand_id,brand),category_id=coalesce(category_id,category),image_url=coalesce(nullif(image_url,''),nullif(d->>'image_url','')),
     price=case when p_update_prices and d->>'sale_price' is not null then (d->>'sale_price')::numeric else price end,
     updated_at=now()where id=p.id returning * into p;
   end if;
   if v_barcode is not null then insert into product_barcodes(product_id,barcode)values(p.id,v_barcode)on conflict do nothing;end if;
   issues:='[]'::jsonb;
   if created and d->>'cost_price' is null then issues:=issues||'"ยังไม่มีต้นทุนที่ยืนยัน"'::jsonb;end if;
   if p.brand_id is null or p.category_id is null then issues:=issues||'"รอตรวจแบรนด์และหมวดหมู่ใน POS"'::jsonb;end if;
   if p.kind='bundle' and it.bom_status='ok' then issues:=issues||'"รอตั้งค่าการขายสินค้าชุดใน POS"'::jsonb;end if;
   if p.price<=0 then issues:=issues||'"ยังไม่มีราคาขายที่อนุมัติ"'::jsonb;end if;
   if created and d->>'serial_tracking' is null then issues:=issues||'"ยังไม่ทราบว่าต้องใช้ SN หรือไม่"'::jsonb;end if;
   if d->>'is_combined' is null then issues:=issues||'"ยังไม่ทราบว่าเป็นสินค้าชุดหรือไม่"'::jsonb;end if;
   if p.kind='bundle' and it.bom_status<>'ok' then issues:=issues||'"รอส่วนประกอบ BOM"'::jsonb;end if;
   if not exists(select 1 from pos_warehouse_links where source=r.source and warehouse_id=r.warehouse_id)then issues:=issues||'"ยังไม่ผูกคลังกับสาขา"'::jsonb;end if;
   if it.stock_qty is null then issues:=issues||'"ยังไม่ตรวจสต๊อก"'::jsonb;end if;
   insert into pos_catalog_links(source,sku_key,product_id,source_detail,readiness,last_run_id)values(r.source,key,p.id,d,issues,p_id)
    on conflict(source,sku_key)do update set source_detail=excluded.source_detail,readiness=excluded.readiness,last_run_id=p_id,updated_at=now();
   insert into pos_catalog_import_events(run_id,sku_key,product_id,actor_id,before_data,after_data,updated_prices)values(p_id,key,p.id,p_actor,before_product,to_jsonb(p),p_update_prices);
   update pos_catalog_items set imported_product_id=p.id,import_kind=case when created then 'created'else 'updated'end,import_error=null,updated_at=now()where run_id=p_id and sku_key=key;
  exception when others then
   update pos_catalog_items set import_error=sqlerrm,updated_at=now()where run_id=p_id and sku_key=key;
  end;
 end loop;
 update pos_catalog_runs set version=version+1,phase=case when exists(select 1 from pos_catalog_items where run_id=p_id and import_kind is null)then 'review'else 'completed'end,last_error=null,updated_at=now()where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function pos_catalog_checkpoint(uuid,uuid,int,text,jsonb),pos_catalog_stats(uuid),pos_catalog_import(uuid,uuid,int,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function pos_catalog_checkpoint(uuid,uuid,int,text,jsonb),pos_catalog_stats(uuid),pos_catalog_import(uuid,uuid,int,jsonb,jsonb,boolean) to service_role;

create or replace function pos_catalog_match_kind(p_run uuid,p_key text,p_detail jsonb)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p products;n int;linked uuid;src text;bc text;
begin
 select source into src from pos_catalog_runs where id=p_run;
 select count(*)into n from products where upper(trim(sku))=p_key;
 if n>1 then return 'conflict';end if;
 select * into p from products where upper(trim(sku))=p_key;
 select product_id into linked from pos_catalog_links where source=src and sku_key=p_key;
 if linked is not null and linked is distinct from p.id then return 'conflict';end if;
 bc:=nullif(trim(p_detail->>'barcode'),'');
 if bc is not null and exists(select 1 from product_barcodes where barcode=bc and product_id is distinct from p.id)then return 'conflict';end if;
 if p.id is not null then
  if jsonb_typeof(p_detail->'serial_tracking')='boolean' and p.track_serial<>(p_detail->>'serial_tracking')::boolean then return 'conflict';end if;
  if jsonb_typeof(p_detail->'is_combined')='boolean' and (p.kind='bundle')<>(p_detail->>'is_combined')::boolean then return 'conflict';end if;
  return 'existing';
 end if;
 return 'new';
end $$;
revoke all on function pos_catalog_match_kind(uuid,text,jsonb)from public,anon,authenticated;
grant execute on function pos_catalog_match_kind(uuid,text,jsonb)to service_role;
