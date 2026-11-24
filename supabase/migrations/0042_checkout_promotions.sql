-- Coupons, automatic gifts and point redemption are calculated and committed centrally.
create table if not exists pos_campaign_uses (
 campaign_id uuid not null references campaigns(id),checkout_id uuid not null,customer_id uuid references customers(id),order_id uuid references orders(id),
 discount numeric(14,2) not null default 0,reversed_at timestamptz,created_at timestamptz not null default now(),primary key(campaign_id,checkout_id)
);
alter table pos_campaign_uses enable row level security;
revoke all on pos_campaign_uses from public,anon,authenticated;grant all on pos_campaign_uses to service_role;

create or replace function pos_check_campaign_quota(p_campaign uuid,p_checkout uuid,p_customer uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns;used int;held int;
begin
 select * into c from campaigns where id=p_campaign;
 if c.per_customer_limit is not null and p_customer is null then raise exception 'campaign_customer_required';end if;
 select count(*)into used from(select coalesce(client_uuid::text,order_id::text,id::text)k from coupon_redemptions where campaign_id=p_campaign
 union select checkout_id::text from pos_campaign_uses where campaign_id=p_campaign and reversed_at is null)x;
 select count(*)into held from pos_checkout_holds h where h.id<>p_checkout and h.status='active'and(h.expires_at>now()or jsonb_array_length(h.recorded_payments)>0)and(h.quote->'promotion_campaign_ids')?p_campaign::text;
 if c.usage_limit is not null and used+held>=c.usage_limit then raise exception 'campaign_usage_limit';end if;
 if c.per_customer_limit is not null then
  select count(*)into used from(select coalesce(client_uuid::text,order_id::text,id::text)k from coupon_redemptions where campaign_id=p_campaign and customer_id=p_customer
  union select checkout_id::text from pos_campaign_uses where campaign_id=p_campaign and customer_id=p_customer and reversed_at is null)x;
  select count(*)into held from pos_checkout_holds h where h.id<>p_checkout and h.status='active'and(h.expires_at>now()or jsonb_array_length(h.recorded_payments)>0)and(h.quote->'promotion_campaign_ids')?p_campaign::text and(h.quote->>'customer_id')::uuid=p_customer;
  if used+held>=c.per_customer_limit then raise exception 'campaign_customer_limit';end if;
 end if;
end $$;

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
  perform pos_check_campaign_quota(c.id,p_id,customer);
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

create or replace function pos_prepare_promoted_checkout(p_id uuid,p_actor uuid,p_branch uuid,p_base jsonb,p_coupon text,p_points integer,p_gifts jsonb,p_expected numeric,p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb;h pos_checkout_holds;request jsonb;
begin
 perform pos_assert_actor_active(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;
 request:=jsonb_build_object('base',p_base,'coupon',coalesce(upper(trim(p_coupon)),''),'points',p_points,'gifts',p_gifts);
 if found and not p_preview then
  if h.actor_id<>p_actor or h.branch_id<>p_branch or h.status<>'active'or h.quote->'promotion_request' is distinct from request then raise exception 'checkout_conflict';end if;
  q:=h.quote;
 else q:=pos_promoted_quote(p_id,p_branch,p_base,p_coupon,p_points,p_gifts,p_preview);end if;
 if not p_preview then
  if(q->>'grand_total')::numeric<>p_expected then raise exception 'promotion_total_changed_preview_required';end if;
  perform pos_reserve_checkout(p_id,p_actor,p_branch,q);
 end if;
 return jsonb_build_object('id',p_id,'quote',q,'coupon_discount',q->'coupon_discount','grand_total',q->'grand_total','campaign_id',q#>'{promo_snapshot,coupon,campaign_id}');
end $$;

do $$begin if to_regprocedure('public.pos_commit_checkout_financial(uuid,uuid,jsonb)')is null then alter function pos_commit_checkout(uuid,uuid,jsonb)rename to pos_commit_checkout_financial;end if;end$$;
create or replace function pos_commit_checkout(p_id uuid,p_actor uuid,p_payments jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h pos_checkout_holds;result jsonb;campaign text;order_id uuid;redemption json;points integer;
begin
 perform pos_assert_actor_active(p_actor);
 select * into h from pos_checkout_holds where id=p_id;if not found or h.actor_id<>p_actor then raise exception 'checkout_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||h.branch_id::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;if h.status='committed'then return h.result;end if;
 perform 1 from campaigns where id in(select value::uuid from jsonb_array_elements_text(coalesce(h.quote->'promotion_campaign_ids','[]')))order by id for update;
 points:=coalesce((h.quote->>'redeem_points')::integer,0);
 if points>0 then perform pg_advisory_xact_lock(hashtextextended('points:'||(h.quote->>'customer_id'),0));end if;
 result:=pos_commit_checkout_financial(p_id,p_actor,p_payments);
 select id into order_id from orders where client_uuid=p_id;
 for campaign in select value from jsonb_array_elements_text(coalesce(h.quote->'promotion_campaign_ids','[]'))loop
  insert into pos_campaign_uses(campaign_id,checkout_id,customer_id,order_id,discount)values(campaign::uuid,p_id,(h.quote->>'customer_id')::uuid,order_id,case when campaign=h.quote#>>'{promo_snapshot,coupon,campaign_id}'then coalesce((h.quote->>'coupon_discount')::numeric,0)else 0 end)on conflict do nothing;
 end loop;
 if nullif(h.quote->>'coupon_code','')is not null then
  insert into coupon_redemptions(campaign_id,customer_id,order_id,client_uuid,discount_amount,order_total)values((h.quote#>>'{promo_snapshot,coupon,campaign_id}')::uuid,(h.quote->>'customer_id')::uuid,order_id,p_id,(h.quote->>'coupon_discount')::numeric,(h.quote->>'grand_total')::numeric)on conflict do nothing;
 end if;
 if points>0 then
  redemption:=pos_redeem_points((h.quote->>'customer_id')::uuid,points,p_id,'ใช้แต้มผ่าน Checkout กลาง');
  if coalesce((redemption->>'redeemed')::integer,0)<>points then raise exception 'points_redemption_mismatch';end if;
 end if;
 return result;
end $$;
create or replace function pos_reverse_campaign_use()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin if new.status::text in('voided','refunded')and new.status is distinct from old.status then update pos_campaign_uses set reversed_at=now()where order_id=new.id and reversed_at is null;end if;return new;end$$;
drop trigger if exists pos_campaign_use_reverse on orders;
create trigger pos_campaign_use_reverse after update on orders for each row execute function pos_reverse_campaign_use();
revoke all on function pos_check_campaign_quota(uuid,uuid,uuid),pos_promoted_quote(uuid,uuid,jsonb,text,integer,jsonb,boolean),pos_prepare_promoted_checkout(uuid,uuid,uuid,jsonb,text,integer,jsonb,numeric,boolean),pos_commit_checkout(uuid,uuid,jsonb),pos_commit_checkout_financial(uuid,uuid,jsonb),pos_reverse_campaign_use() from public,anon,authenticated;
grant execute on function pos_prepare_promoted_checkout(uuid,uuid,uuid,jsonb,text,integer,jsonb,numeric,boolean),pos_commit_checkout(uuid,uuid,jsonb),pos_commit_checkout_financial(uuid,uuid,jsonb) to service_role;
