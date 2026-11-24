-- Reject missing payable totals and reacquire expired promotion allocations before renewing stock.
create or replace function pos_prepare_promoted_checkout(p_id uuid,p_actor uuid,p_branch uuid,p_base jsonb,p_coupon text,p_points integer,p_gifts jsonb,p_expected numeric,p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb;h pos_checkout_holds;request jsonb;
begin
 if not p_preview and (p_expected is null or p_expected<=0 or p_expected::text in('NaN','Infinity','-Infinity'))then raise exception 'invalid_expected_payable';end if;
 perform pos_assert_actor_active(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;
 request:=jsonb_build_object('base',p_base,'coupon',coalesce(upper(trim(p_coupon)),''),'points',p_points,'gifts',p_gifts);
 if found and not p_preview then
  if h.actor_id<>p_actor or h.branch_id<>p_branch or h.status<>'active'or h.quote->'promotion_request' is distinct from request then raise exception 'checkout_conflict';end if;
  if h.expires_at<=now()and jsonb_array_length(h.recorded_payments)=0 then
   q:=pos_promoted_quote(p_id,p_branch,p_base,p_coupon,p_points,p_gifts,false);
  else q:=h.quote;end if;
 else q:=pos_promoted_quote(p_id,p_branch,p_base,p_coupon,p_points,p_gifts,p_preview);end if;
 if not p_preview then
  if(q->>'grand_total')::numeric<>p_expected then raise exception 'promotion_total_changed_preview_required';end if;
  perform pos_reserve_checkout(p_id,p_actor,p_branch,q);
 end if;
 return jsonb_build_object('id',p_id,'quote',q,'coupon_discount',q->'coupon_discount','grand_total',q->'grand_total','campaign_id',q#>'{promo_snapshot,coupon,campaign_id}');
end $$;

revoke all on function pos_prepare_promoted_checkout(uuid,uuid,uuid,jsonb,text,integer,jsonb,numeric,boolean)from public,anon,authenticated;
grant execute on function pos_prepare_promoted_checkout(uuid,uuid,uuid,jsonb,text,integer,jsonb,numeric,boolean)to service_role;

-- Exhausted automatic gifts must stop awarding, rather than blocking unrelated sales.
create or replace function pos_promoted_quote(p_id uuid,p_branch uuid,p_quote jsonb,p_coupon text,p_points integer,p_gifts jsonb,p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns;customer uuid;today date:=(now()at time zone 'Asia/Bangkok')::date;
 eligible numeric;eligible_net numeric;qty numeric;coupon_discount numeric:=0;total numeric;campaign_ids jsonb:='[]';gift_specs jsonb:='[]';gift_items jsonb:='[]';
 sets int;ref record;gift jsonb;pr products;expected int;serials jsonb;wallet int;global_points int;held numeric;brand uuid;discount numeric;request jsonb;
begin
 if p_points is null or p_points<0 then raise exception 'invalid_points';end if;
 if jsonb_typeof(p_gifts)<>'array'then raise exception 'invalid_gift_lines';end if;
 customer:=nullif(p_quote->>'customer_id','')::uuid;
 if customer is not null and not exists(select 1 from customers where id=customer)then raise exception 'customer_not_synced';end if;
 -- Lock every applicable campaign in a deterministic order across branches.
 perform 1 from campaigns where (id in(select id from campaigns where upper(code)=upper(trim(coalesce(p_coupon,''))))or(active and is_automatic and promo_type='gift'))order by id for update;
 for c in select * from campaigns where (upper(code)=upper(trim(coalesce(p_coupon,'')))and nullif(trim(p_coupon),'')is not null)or(active and is_automatic and promo_type='gift')order by id loop
  if not c.active or c.archived_at is not null or(c.starts_at is not null and today<c.starts_at)or(c.ends_at is not null and today>c.ends_at)or(cardinality(c.branch_ids)>0 and not p_branch=any(c.branch_ids))or(cardinality(c.channels)>0 and not(p_quote->>'channel')=any(c.channels))then
   if upper(c.code)=upper(trim(coalesce(p_coupon,'')))then raise exception 'coupon_not_applicable';end if;continue;
  end if;
  select coalesce(sum(gross),0),coalesce(sum(net),0),case when c.eligible_across_sku then coalesce(sum(n),0)else coalesce(max(n),0)end into eligible,eligible_net,qty from(
   select(i->>'product_id')::uuid id,sum((i->>'unit_price')::numeric*(i->>'qty')::numeric)gross,sum((i->>'line_total')::numeric)net,sum((i->>'qty')::numeric)n
   from jsonb_array_elements(p_quote->'items')i join products p on p.id=(i->>'product_id')::uuid
   where(cardinality(c.brand_ids)=0 or p.brand_id=any(c.brand_ids))and(c.eligible_scope='all'or exists(select 1 from campaign_products cp where cp.campaign_id=c.id and cp.role='eligible'and cp.product_id=p.id))group by 1)x;
  if eligible<c.min_spend or qty<coalesce(c.eligible_min_qty,1)or qty<=0 then
   if upper(c.code)=upper(trim(coalesce(p_coupon,'')))then raise exception 'coupon_minimum_not_met';end if;continue;
  end if;
  if c.target_segment<>'all'and(customer is null or customer_segment(customer)<>c.target_segment)then
   if upper(c.code)=upper(trim(coalesce(p_coupon,'')))then raise exception 'coupon_customer_segment';end if;continue;
  end if;
  begin
   perform pos_check_campaign_quota(c.id,p_id,customer);
  exception when raise_exception then
   if c.promo_type='gift'and c.is_automatic and sqlerrm in('campaign_usage_limit','campaign_customer_limit','campaign_customer_required')then continue;end if;
   raise;
  end;
  if c.promo_type='gift'and c.is_automatic then
   sets:=case when c.gift_mode='per_item'then floor(qty/greatest(c.gift_per_qty,1))::int else 1 end;if c.gift_cap is not null then sets:=least(sets,c.gift_cap);end if;
   if sets<=0 then continue;end if;
   for ref in select * from campaign_products where campaign_id=c.id and role='gift'order by product_id loop
    gift_specs:=gift_specs||jsonb_build_array(jsonb_build_object('campaign_id',c.id,'product_id',ref.product_id,'qty',sets*ref.gift_qty));
   end loop;
   campaign_ids:=campaign_ids||jsonb_build_array(c.id::text);
  elsif c.promo_type='discount'and upper(c.code)=upper(trim(coalesce(p_coupon,'')))then
   -- Apply to the eligible share of the net bill after employee discounts.
   eligible:=round(eligible_net*(p_quote->>'grand_total')::numeric/nullif((select sum((i->>'line_total')::numeric)from jsonb_array_elements(p_quote->'items')i),0),2);
   coupon_discount:=case when c.discount_type='percent'then round(eligible*c.discount_value/100,2)else least(c.discount_value,eligible)end;
   if c.max_discount is not null then coupon_discount:=least(coupon_discount,c.max_discount);end if;
   if coupon_discount<0 or coupon_discount::text in('NaN','Infinity')then raise exception 'invalid_coupon_discount';end if;
   campaign_ids:=campaign_ids||jsonb_build_array(c.id::text);
  end if;
 end loop;
 if nullif(trim(p_coupon),'')is not null and not exists(select 1 from campaigns where upper(code)=upper(trim(p_coupon))and promo_type='discount'and campaign_ids?id::text)then raise exception 'coupon_not_found';end if;
 if jsonb_array_length(p_gifts)<>jsonb_array_length(gift_specs)then raise exception 'campaign_gifts_changed_reload';end if;
 for gift in select value from jsonb_array_elements(gift_specs)loop
  select * into pr from products where id=(gift->>'product_id')::uuid for share;
  if not found or not pr.is_active or pr.kind='bundle'or pr.vat_rate<>7 then raise exception 'gift_product_not_ready';end if;
  select value into request from jsonb_array_elements(p_gifts)x where x->>'product_id'=pr.id::text and x->>'gift_campaign_id'=gift->>'campaign_id'and x->>'gift_source'='campaign';
  if not found or(request->>'qty')::numeric<>(gift->>'qty')::int or(request->>'unit_price')::numeric<>0 then raise exception 'campaign_gift_mismatch';end if;
  serials:=coalesce(request->'serials','[]');
  if not p_preview and ((pr.track_serial and jsonb_array_length(serials)<>(gift->>'qty')::int)or(not pr.track_serial and jsonb_array_length(serials)<>0))then raise exception 'gift_serial_count_mismatch';end if;
  gift_items:=gift_items||jsonb_build_array(jsonb_build_object('product_id',pr.id,'sku',pr.sku,'name',pr.name_th,'kind','goods','qty',(gift->>'qty')::int,'unit_price',0,'list_price',pr.price,'discount_amount',0,'discount_percent',0,'line_total',0,'unit_cost',pr.cost,'cost_total',pr.cost*(gift->>'qty')::int,'gross_profit',-pr.cost*(gift->>'qty')::int,'serials',serials,'is_gift',true,'gift_source','campaign','gift_campaign_id',gift->>'campaign_id'));
 end loop;
 select count(*)-count(distinct upper(trim(sn)))into held from jsonb_array_elements((p_quote->'items')||gift_items)i,lateral jsonb_array_elements_text(coalesce(i->'serials','[]'))sn;
 if held<>0 then raise exception 'duplicate_serial_in_checkout';end if;
 total:=(p_quote->>'grand_total')::numeric-coupon_discount-p_points;
 if total<=0 then raise exception 'promotion_requires_positive_payable';end if;
 if p_points>0 then
  if customer is null then raise exception 'points_customer_required';end if;
  perform pg_advisory_xact_lock(hashtextextended('points:'||customer::text,0));
  select points into global_points from customers where id=customer for update;
  select brand_id into brand from branches where id=p_branch;
  if brand is not null then select points into wallet from brand_wallets where customer_id=customer and brand_id=brand for update;else wallet:=global_points;end if;
  select coalesce(sum((h.quote->>'redeem_points')::numeric),0)into held from pos_checkout_holds h where h.id<>p_id and h.status='active'and(h.expires_at>now()or jsonb_array_length(h.recorded_payments)>0)and(h.quote->>'customer_id')::uuid=customer;
  if p_points>greatest(coalesce(global_points,0)-held,0)then raise exception 'insufficient_available_points';end if;
  if brand is not null then select coalesce(sum((h.quote->>'redeem_points')::numeric),0)into held from pos_checkout_holds h join branches b on b.id=h.branch_id where b.brand_id=brand and h.id<>p_id and h.status='active'and(h.expires_at>now()or jsonb_array_length(h.recorded_payments)>0)and(h.quote->>'customer_id')::uuid=customer;end if;
  if p_points>greatest(coalesce(wallet,0)-held,0)then raise exception 'insufficient_brand_points';end if;
 end if;
 return p_quote||jsonb_build_object('items',(p_quote->'items')||gift_items,'grand_total',total,'vat_amount',round(total-total/1.07,2),'discount_total',(p_quote->>'discount_total')::numeric+coupon_discount+p_points,'discount_percent',round(((p_quote->>'discount_total')::numeric+coupon_discount+p_points)/nullif((p_quote->>'subtotal')::numeric,0)*100,2),'coupon_code',nullif(upper(trim(p_coupon)),''),'coupon_discount',coupon_discount,'redeem_points',p_points,'promotion_campaign_ids',campaign_ids,'promotion_request',jsonb_build_object('base',p_quote,'coupon',coalesce(upper(trim(p_coupon)),''),'points',p_points,'gifts',p_gifts),'promo_snapshot',jsonb_build_object('coupon',jsonb_build_object('code',p_coupon,'discount',coupon_discount,'campaign_id',(select id from campaigns where upper(code)=upper(trim(p_coupon))limit 1)),'redeem_points',p_points,'gifts',gift_specs));
end $$;


create or replace function pos_available_gift_campaigns(p_branch uuid,p_customer uuid,p_channel text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns;result jsonb:='[]';today date:=(now()at time zone 'Asia/Bangkok')::date;
begin
 for c in select * from campaigns where active and archived_at is null and is_automatic and promo_type='gift'
 and(starts_at is null or starts_at<=today)and(ends_at is null or ends_at>=today)
 and(cardinality(branch_ids)=0 or p_branch=any(branch_ids))and(cardinality(channels)=0 or p_channel=any(channels))order by id loop
  if c.target_segment<>'all'and(p_customer is null or customer_segment(p_customer)<>c.target_segment)then continue;end if;
  begin
   perform pos_check_campaign_quota(c.id,'00000000-0000-4000-8000-000000000000'::uuid,p_customer);
  exception when raise_exception then
   if sqlerrm in('campaign_usage_limit','campaign_customer_limit','campaign_customer_required')then continue;end if;raise;
  end;
  result:=result||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'brand_ids',c.brand_ids,'eligible_scope',c.eligible_scope,'eligible_min_qty',c.eligible_min_qty,'eligible_across_sku',c.eligible_across_sku,'min_spend',c.min_spend,'gift_mode',c.gift_mode,'gift_per_qty',c.gift_per_qty,'gift_cap',c.gift_cap,
  'eligible_skus',coalesce((select jsonb_agg(sku)from campaign_products where campaign_id=c.id and role='eligible'),'[]'),
  'gift_skus',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'gift_qty',gift_qty))from campaign_products where campaign_id=c.id and role='gift'),'[]')));
 end loop;
 return result;
end $$;
revoke all on function pos_available_gift_campaigns(uuid,uuid,text),pos_promoted_quote(uuid,uuid,jsonb,text,integer,jsonb,boolean)from public,anon,authenticated;
grant execute on function pos_available_gift_campaigns(uuid,uuid,text),pos_promoted_quote(uuid,uuid,jsonb,text,integer,jsonb,boolean)to service_role;
