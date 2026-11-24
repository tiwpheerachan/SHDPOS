-- Preserve reservations when opening stock is loaded after a deferred sale was recorded.
alter table stock_levels add column if not exists opening_pending boolean not null default false;
create function pos_clear_opening_pending()returns trigger language plpgsql set search_path=public,pg_temp as $$begin if new.qty_on_hand is distinct from old.qty_on_hand then new.opening_pending:=false;end if;return new;end$$;
create trigger pos_stock_opening_known before update of qty_on_hand on stock_levels for each row execute function pos_clear_opening_pending();
create or replace function pos_create_deferred_sale(p_id uuid,p_actor uuid,p_branch uuid,p_draft jsonb,p_occurred timestamptz,p_delivered boolean,p_reason text,p_issues jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d pos_deferred_sales;ln record;item jsonb;reserved jsonb:='[]';v_issues jsonb:=p_issues;st stock_levels;sn text;
begin
 perform pos_assert_actor_active(p_actor);perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
 select * into d from pos_deferred_sales where id=p_id for update;
 if found then if d.created_by<>p_actor or d.branch_id<>p_branch or d.draft<>p_draft or d.occurred_at<>p_occurred or d.reason<>p_reason or d.delivered<>p_delivered then raise exception 'deferred_conflict';end if;return to_jsonb(d);end if;
 if length(trim(p_reason))<3 or p_occurred is null or not isfinite(p_occurred)or p_occurred>now()+interval '5 minutes'or p_occurred<'2000-01-01'::timestamptz or p_delivered is null then raise exception 'invalid_deferred_reason_date';end if;
 if jsonb_typeof(p_draft->'items')<>'array'or jsonb_array_length(p_draft->'items')not between 1 and 200 or(p_draft->>'grand_total')::numeric<=0 then raise exception 'invalid_deferred_draft';end if;
 insert into pos_deferred_sales(id,branch_id,created_by,draft,agreed_total,occurred_at,delivered,reason,issues)values(p_id,p_branch,p_actor,p_draft,(p_draft->>'grand_total')::numeric,p_occurred,p_delivered,p_reason,v_issues);
 for ln in select (i->>'product_id')::uuid product_id,sum((i->>'qty')::numeric)qty from jsonb_array_elements(p_draft->'items')i group by 1 order by 1 loop
  if ln.qty<=0 then raise exception 'invalid_quantity';end if;
  if(select is_stocked from products where id=ln.product_id)then
   select * into st from stock_levels where branch_id=p_branch and product_id=ln.product_id for update;
   if not found then
    -- Unknown opening balance stays flagged; only a zero balance and a reservation are created.
    insert into stock_levels(branch_id,product_id,qty_on_hand,opening_pending)values(p_branch,ln.product_id,0,true)returning * into st;
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'code','stock_uninitialized'));
   elsif st.opening_pending then v_issues:=v_issues||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'code','stock_uninitialized'));end if;
   if st.qty_on_hand+st.qty_otwo-st.qty_reserved-st.qty_reserved_order-st.qty_quarantine<ln.qty then v_issues:=v_issues||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'code','stock_short'));end if;
   update stock_levels set updated_at=now(),qty_reserved_order=qty_reserved_order+ln.qty where branch_id=p_branch and product_id=ln.product_id;
   reserved:=reserved||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'qty',ln.qty));
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_draft->'items')loop
  for sn in select upper(trim(value))from jsonb_array_elements_text(coalesce(item->'serials','[]'))loop
   if exists(select 1 from serials where upper(trim(serial_no))=sn and(branch_id is distinct from p_branch or product_id is distinct from (item->>'product_id')::uuid or status<>'in_stock'))then raise exception 'serial_not_available';end if;
   if exists(select 1 from pos_checkout_holds h,lateral jsonb_array_elements(h.quote->'items')i where h.status='active'and(h.expires_at>now()or jsonb_array_length(h.recorded_payments)>0)and i->'serials'?sn)then raise exception 'serial_reserved';end if;
   insert into pos_deferred_serial_claims(serial_key,sale_id,product_id)values(sn,p_id,(item->>'product_id')::uuid);
  end loop;
 end loop;
 update pos_deferred_sales set reserved_items=reserved,issues=v_issues where id=p_id returning * into d;
 insert into pos_deferred_audit(sale_id,actor_id,action,detail)values(p_id,p_actor,'created',jsonb_build_object('occurred_at',p_occurred,'total',d.agreed_total,'issues',v_issues));return to_jsonb(d);
end$$;


-- An unknown SN policy can be reviewed before physical inventory exists; pending quantities alone are not physical inventory.
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
 exists(select 1 from serials where product_id=p_id) or exists(select 1 from stock_levels where product_id=p_id and (qty_on_hand<>0 or qty_otwo<>0 or qty_reserved<>0 or qty_reserved_order<>coalesce((select sum((x->>'qty')::numeric)from pos_deferred_sales ds,lateral jsonb_array_elements(ds.reserved_items)x where ds.state='pending'and ds.branch_id=stock_levels.branch_id and(x->>'product_id')::uuid=p_id),0))) or
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


revoke all on function pos_clear_opening_pending()from public,anon,authenticated;
