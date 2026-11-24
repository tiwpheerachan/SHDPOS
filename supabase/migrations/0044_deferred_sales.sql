-- Operational sales awaiting missing master data/SN. Money is retained centrally before final posting.
create table pos_deferred_sales(
 id uuid primary key,branch_id uuid not null references branches(id),created_by uuid not null references employees(id),
 state text not null default 'pending' check(state in('pending','posted','cancelled')),version integer not null default 1,
 draft jsonb not null,agreed_total numeric(14,2)not null check(agreed_total>0),occurred_at timestamptz not null,delivered boolean not null,
 reason text not null,issues jsonb not null default '[]',reserved_items jsonb not null default '[]',payments jsonb not null default '[]',
 result jsonb,posted_by uuid references employees(id),posted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index pos_deferred_branch on pos_deferred_sales(branch_id,state,occurred_at);
create table pos_deferred_serial_claims(serial_key text primary key,sale_id uuid not null references pos_deferred_sales(id),product_id uuid not null references products(id));
create table pos_deferred_audit(id uuid primary key default gen_random_uuid(),sale_id uuid not null references pos_deferred_sales(id),actor_id uuid not null references employees(id),action text not null,detail jsonb not null default '{}',created_at timestamptz not null default now());
alter table orders add column if not exists sale_occurred_at timestamptz;
alter table orders add column if not exists deferred_sale_id uuid unique references pos_deferred_sales(id);
do $$declare t text;begin foreach t in array array['pos_deferred_sales','pos_deferred_serial_claims','pos_deferred_audit']loop execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);end loop;end$$;

create function pos_create_deferred_sale(p_id uuid,p_actor uuid,p_branch uuid,p_draft jsonb,p_occurred timestamptz,p_delivered boolean,p_reason text,p_issues jsonb)
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
   if found then
    if st.qty_on_hand+st.qty_otwo-st.qty_reserved-st.qty_reserved_order-st.qty_quarantine<ln.qty then v_issues:=v_issues||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'code','stock_short'));end if;
    update stock_levels set updated_at=now(),qty_reserved_order=qty_reserved_order+ln.qty where branch_id=p_branch and product_id=ln.product_id;
    reserved:=reserved||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'qty',ln.qty));
   else v_issues:=v_issues||jsonb_build_array(jsonb_build_object('product_id',ln.product_id,'code','stock_uninitialized'));end if;
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

create function pos_record_deferred_payment(p_id uuid,p_actor uuid,p_version integer,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d pos_deferred_sales;existing jsonb;paid numeric;
begin
 perform pos_assert_actor_active(p_actor);select * into d from pos_deferred_sales where id=p_id for update;
 if not found or d.state<>'pending'then raise exception 'deferred_not_pending';end if;
 select value into existing from jsonb_array_elements(d.payments)p where p->>'method'=p_payment->>'method'and p->>'reference_no'=p_payment->>'reference_no';
 if found then if existing<>p_payment then raise exception 'payment_reference_conflict';end if;return to_jsonb(d);end if;
 if d.version<>p_version then raise exception 'deferred_version_conflict';end if;
 if p_payment->>'method'not in('credit_card','debit_card','edc','installment','bank_transfer','qr_promptpay')or coalesce((p_payment->>'amount')::numeric,0)<=0 or coalesce(p_payment->>'reference_no','')=''then raise exception 'invalid_payments';end if;
 select coalesce(sum((p->>'amount')::numeric),0)into paid from jsonb_array_elements(d.payments)p;
 if paid+(p_payment->>'amount')::numeric>d.agreed_total then raise exception 'payment_total_mismatch';end if;
 update pos_deferred_sales set payments=payments||jsonb_build_array(p_payment),version=version+1,updated_at=now()where id=p_id returning * into d;
 insert into pos_deferred_audit(sale_id,actor_id,action,detail)values(p_id,p_actor,'payment_recorded',jsonb_build_object('method',p_payment->>'method','reference',p_payment->>'reference_no','amount',p_payment->'amount'));return to_jsonb(d);
end$$;

create function pos_cancel_deferred_sale(p_id uuid,p_actor uuid,p_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d pos_deferred_sales;b uuid;ln jsonb;
begin
 perform pos_assert_actor_active(p_actor);select branch_id into b from pos_deferred_sales where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||b::text,0));select * into d from pos_deferred_sales where id=p_id for update;
 if not found or d.state<>'pending'or d.version<>p_version then raise exception 'deferred_version_conflict';end if;
 if jsonb_array_length(d.payments)>0 then raise exception 'paid_deferred_requires_refund';end if;
 if d.delivered then raise exception 'delivered_deferred_requires_return';end if;
 if length(trim(p_reason))<3 then raise exception 'reason_required';end if;
 for ln in select value from jsonb_array_elements(d.reserved_items)loop update stock_levels set updated_at=now(),qty_reserved_order=qty_reserved_order-(ln->>'qty')::numeric where branch_id=d.branch_id and product_id=(ln->>'product_id')::uuid and qty_reserved_order>=(ln->>'qty')::numeric;if not found then raise exception 'deferred_reservation_changed';end if;end loop;
 delete from pos_deferred_serial_claims where sale_id=p_id;
 update pos_deferred_sales set state='cancelled',version=version+1,updated_at=now()where id=p_id returning * into d;
 insert into pos_deferred_audit(sale_id,actor_id,action,detail)values(p_id,p_actor,'cancelled',jsonb_build_object('reason',p_reason));return to_jsonb(d);
end$$;

-- Existing strict checkout checks known SN claims as well as quantity reserved by deferred sales.
alter function pos_reserve_checkout(uuid,uuid,uuid,jsonb)rename to pos_reserve_checkout_ready;
create function pos_reserve_checkout(p_id uuid,p_actor uuid,p_branch uuid,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
 if exists(select 1 from pos_deferred_serial_claims c join lateral jsonb_array_elements(p_quote->'items')i on true join lateral jsonb_array_elements_text(coalesce(i->'serials','[]'))sn on upper(trim(sn))=c.serial_key)then raise exception 'serial_reserved_by_deferred_sale';end if;
 return pos_reserve_checkout_ready(p_id,p_actor,p_branch,p_quote);
end$$;

create function pos_post_deferred_sale(p_id uuid,p_actor uuid,p_version integer,p_quote jsonb,p_delivered boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d pos_deferred_sales;b uuid;ln jsonb;res jsonb;paid numeric;
begin
 perform pos_assert_actor_active(p_actor);select branch_id into b from pos_deferred_sales where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||b::text,0));select * into d from pos_deferred_sales where id=p_id for update;
 if not found then raise exception 'deferred_not_found';end if;
 if d.state='posted'then return d.result;end if;
 if d.state<>'pending'or d.version<>p_version then raise exception 'deferred_version_conflict';end if;
 if not p_delivered then raise exception 'delivery_confirmation_required';end if;
 select coalesce(sum((p->>'amount')::numeric),0)into paid from jsonb_array_elements(d.payments)p;
 if paid<>d.agreed_total or(p_quote->>'grand_total')::numeric is distinct from d.agreed_total then raise exception 'payment_total_mismatch';end if;
 if(select jsonb_agg(jsonb_build_array(i->>'product_id',i->'qty',i->'unit_price')order by i->>'product_id',i->>'unit_price')from jsonb_array_elements(d.draft->'items')i)is distinct from(select jsonb_agg(jsonb_build_array(i->>'product_id',i->'qty',i->'unit_price')order by i->>'product_id',i->>'unit_price')from jsonb_array_elements(p_quote->'items')i)then raise exception 'deferred_items_changed';end if;
 for ln in select value from jsonb_array_elements(d.reserved_items)loop update stock_levels set updated_at=now(),qty_reserved_order=qty_reserved_order-(ln->>'qty')::numeric where branch_id=d.branch_id and product_id=(ln->>'product_id')::uuid and qty_reserved_order>=(ln->>'qty')::numeric;if not found then raise exception 'deferred_reservation_changed';end if;end loop;
 delete from pos_deferred_serial_claims where sale_id=p_id;
 perform pos_reserve_checkout(p_id,p_actor,b,p_quote);
 update pos_checkout_holds set recorded_payments=d.payments where id=p_id;
 res:=pos_commit_checkout(p_id,p_actor,d.payments);
 update orders set sale_occurred_at=d.occurred_at,deferred_sale_id=d.id where client_uuid=p_id;
 update serials set sold_at=d.occurred_at where sold_order_id=(select id from orders where client_uuid=p_id);
 update pos_integration_events set payload=payload||jsonb_build_object('sale_occurred_at',d.occurred_at,'deferred_sale_id',d.id)where event_key='sale:'||p_id::text;
 update pos_deferred_sales set state='posted',delivered=true,version=version+1,result=res,posted_by=p_actor,posted_at=now(),updated_at=now()where id=p_id;
 insert into pos_deferred_audit(sale_id,actor_id,action,detail)values(p_id,p_actor,'posted',jsonb_build_object('original_actor',d.created_by,'occurred_at',d.occurred_at,'order',res));return res;
end$$;
revoke all on function pos_create_deferred_sale(uuid,uuid,uuid,jsonb,timestamptz,boolean,text,jsonb),pos_record_deferred_payment(uuid,uuid,integer,jsonb),pos_cancel_deferred_sale(uuid,uuid,integer,text),pos_post_deferred_sale(uuid,uuid,integer,jsonb,boolean),pos_reserve_checkout(uuid,uuid,uuid,jsonb),pos_reserve_checkout_ready(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function pos_create_deferred_sale(uuid,uuid,uuid,jsonb,timestamptz,boolean,text,jsonb),pos_record_deferred_payment(uuid,uuid,integer,jsonb),pos_cancel_deferred_sale(uuid,uuid,integer,text),pos_post_deferred_sale(uuid,uuid,integer,jsonb,boolean),pos_reserve_checkout(uuid,uuid,uuid,jsonb),pos_reserve_checkout_ready(uuid,uuid,uuid,jsonb)to service_role;

create function pos_update_deferred_serials(p_id uuid,p_actor uuid,p_version integer,p_serials jsonb,p_delivered boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d pos_deferred_sales;b uuid;items jsonb:='[]';item jsonb;sn text;n integer:=0;
begin
 perform pos_assert_actor_active(p_actor);select branch_id into b from pos_deferred_sales where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||b::text,0));select * into d from pos_deferred_sales where id=p_id for update;
 if not found or d.state<>'pending'or d.version<>p_version then raise exception 'deferred_version_conflict';end if;
 if p_delivered is null or(d.delivered and not p_delivered)then raise exception 'delivery_status_requires_review';end if;
 if jsonb_typeof(p_serials)<>'array'or jsonb_array_length(p_serials)<>jsonb_array_length(d.draft->'items')then raise exception 'invalid_serial_lines';end if;
 delete from pos_deferred_serial_claims where sale_id=p_id;
 for item in select value from jsonb_array_elements(d.draft->'items')loop
  if jsonb_typeof(p_serials->n)<>'array'or jsonb_array_length(p_serials->n)>(item->>'qty')::int then raise exception 'serial_count_mismatch';end if;
  for sn in select upper(trim(value))from jsonb_array_elements_text(p_serials->n)loop
   if length(sn)not between 1 and 200 then raise exception 'invalid_serial';end if;
   if exists(select 1 from serials where upper(trim(serial_no))=sn and(branch_id is distinct from b or product_id is distinct from (item->>'product_id')::uuid or status<>'in_stock'))then raise exception 'serial_not_available';end if;
   if exists(select 1 from pos_checkout_holds h,lateral jsonb_array_elements(h.quote->'items')i where h.status='active'and(h.expires_at>now()or jsonb_array_length(h.recorded_payments)>0)and i->'serials'?sn)then raise exception 'serial_reserved';end if;
   insert into pos_deferred_serial_claims(serial_key,sale_id,product_id)values(sn,p_id,(item->>'product_id')::uuid);
  end loop;
  items:=items||jsonb_build_array(item||jsonb_build_object('serials',coalesce((select jsonb_agg(upper(trim(value)))from jsonb_array_elements_text(p_serials->n)),'[]')));n:=n+1;
 end loop;
 insert into pos_deferred_audit(sale_id,actor_id,action,detail)values(p_id,p_actor,'serials_updated',jsonb_build_object('before',d.draft->'items','after',items,'delivered',p_delivered));
 update pos_deferred_sales set draft=jsonb_set(draft,'{items}',items),delivered=p_delivered,version=version+1,updated_at=now()where id=p_id returning * into d;return to_jsonb(d);
end$$;
revoke all on function pos_update_deferred_serials(uuid,uuid,integer,jsonb,boolean)from public,anon,authenticated;
grant execute on function pos_update_deferred_serials(uuid,uuid,integer,jsonb,boolean)to service_role;
