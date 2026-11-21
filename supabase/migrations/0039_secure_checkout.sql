-- Deploy together with /api/pos/checkout and operations. No automatic production application.
alter table public.stock_levels add column if not exists qty_otwo numeric(14,3) not null default 0;
alter table public.stock_levels add column if not exists qty_reserved_order numeric(14,3) not null default 0;
alter table public.stock_levels add column if not exists qty_quarantine numeric(14,3) not null default 0;

-- Recheck employment inside the same database transaction as each critical write.
create or replace function public.pos_assert_actor_active(p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from employees where id=p_actor and status='active' and app_access is not false) then raise exception 'employee_access_revoked';end if;
end $$;
revoke all on function public.pos_assert_actor_active(uuid) from public,anon,authenticated;
grant execute on function public.pos_assert_actor_active(uuid) to service_role;

create table if not exists public.pos_checkout_holds (
 id uuid primary key,
 branch_id uuid not null references public.branches(id),
 actor_id uuid not null references public.employees(id),
 quote jsonb not null,
 recorded_payments jsonb not null default '[]'::jsonb,
 status text not null default 'active' check(status in ('active','committed','released')),
 expires_at timestamptz not null default now() + interval '15 minutes',
 created_at timestamptz not null default now(),
 result jsonb
);
alter table public.pos_checkout_holds enable row level security;
revoke all on public.pos_checkout_holds from public, anon, authenticated;
grant all on public.pos_checkout_holds to service_role;
create index if not exists pos_checkout_holds_active on public.pos_checkout_holds(branch_id,expires_at) where status='active';

create or replace function public.pos_reserve_checkout(p_id uuid,p_actor uuid,p_branch uuid,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h pos_checkout_holds; line record; st stock_levels; sn text; sr serials; held numeric;
begin
 perform pos_assert_actor_active(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;
 if found then
   if h.actor_id<>p_actor or h.branch_id<>p_branch or h.quote<>p_quote then raise exception 'checkout_conflict'; end if;
   if h.status<>'active' then raise exception 'checkout_not_active'; end if;
 end if;
 if jsonb_typeof(p_quote->'items')<>'array' or jsonb_array_length(p_quote->'items')=0 then raise exception 'empty_checkout'; end if;
 for line in select (x->>'product_id')::uuid product_id,sum((x->>'qty')::numeric) qty
   from jsonb_array_elements(p_quote->'items') x group by 1 order by 1
 loop
   if line.qty<=0 then raise exception 'invalid_quantity'; end if;
   if (select is_stocked from products where id=line.product_id) then
     select * into st from stock_levels where branch_id=p_branch and product_id=line.product_id for update;
     if not found then raise exception 'stock_not_initialized'; end if;
     select coalesce(sum((i->>'qty')::numeric),0) into held from pos_checkout_holds ch,
       lateral jsonb_array_elements(ch.quote->'items') i
       where ch.branch_id=p_branch and ch.id<>p_id and ch.status='active' and (ch.expires_at>now() or jsonb_array_length(ch.recorded_payments)>0)
       and (i->>'product_id')::uuid=line.product_id;
     if st.qty_on_hand+st.qty_otwo-st.qty_reserved-st.qty_reserved_order-st.qty_quarantine-held<line.qty then raise exception 'insufficient_available_stock'; end if;
   end if;
 end loop;
 for sn in select upper(trim(s.value)) from jsonb_array_elements(p_quote->'items') i,
   lateral jsonb_array_elements_text(coalesce(i->'serials','[]'::jsonb)) s order by 1
 loop
   -- Stock reservation and SN ownership are both checked under the branch lock.
   select * into sr from serials where upper(trim(serial_no))=sn for update;
   if not found or sr.branch_id is distinct from p_branch or sr.status<>'in_stock' then raise exception 'serial_not_available: %',sn; end if;
   if (select count(*) from serials where upper(trim(serial_no))=sn)<>1 then raise exception 'ambiguous_serial: %',sn; end if;
   if not exists(select 1 from jsonb_array_elements(p_quote->'items') i where (i->>'product_id')::uuid=sr.product_id and (i->'serials') ? sn) then raise exception 'serial_product_mismatch'; end if;
   if exists(select 1 from pos_checkout_holds ch, lateral jsonb_array_elements(ch.quote->'items') i
      where ch.id<>p_id and ch.status='active' and (ch.expires_at>now() or jsonb_array_length(ch.recorded_payments)>0) and (i->'serials') ? sn) then raise exception 'serial_reserved'; end if;
 end loop;
 insert into pos_checkout_holds(id,branch_id,actor_id,quote) values(p_id,p_branch,p_actor,p_quote)
 on conflict(id) do update set expires_at=now()+interval '15 minutes';
 return jsonb_build_object('id',p_id,'expires_at',(select expires_at from pos_checkout_holds where id=p_id));
end $$;

-- Rename the legacy writer once; keep it inaccessible to browser roles.
do $$ begin
 if to_regprocedure('public.pos_create_order_internal(jsonb)') is null then
   alter function public.create_order(jsonb) rename to pos_create_order_internal;
 end if;
end $$;
revoke all on function public.pos_create_order_internal(jsonb) from public,anon,authenticated;

create or replace function public.pos_commit_checkout(p_id uuid,p_actor uuid,p_payments jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h pos_checkout_holds; payload jsonb; res jsonb; paid numeric;
begin
 perform pos_assert_actor_active(p_actor);
 select * into h from pos_checkout_holds where id=p_id;
 if not found or h.actor_id<>p_actor then raise exception 'checkout_not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||h.branch_id::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;
 if h.status='committed' then return h.result; end if;
 if h.status<>'active' or h.expires_at<=now() then raise exception 'checkout_expired_requires_review'; end if;
 if jsonb_array_length(p_payments)=0 or exists(select 1 from jsonb_array_elements(p_payments) p where p->>'method' not in ('credit_card','debit_card','edc','installment','bank_transfer','qr_promptpay') or (p->>'amount')::numeric<=0) then raise exception 'invalid_payments'; end if;
 select sum((p->>'amount')::numeric) into paid from jsonb_array_elements(p_payments) p;
 if paid<>(h.quote->>'grand_total')::numeric then raise exception 'payment_total_mismatch'; end if;
 if h.recorded_payments<>p_payments then raise exception 'recorded_payment_mismatch';end if;
 -- Revalidate stock and SN at commit; do not trust a stale browser or an expired reservation.
 perform pos_reserve_checkout(h.id,h.actor_id,h.branch_id,h.quote);
 payload:=h.quote||jsonb_build_object('payments',p_payments,'paid_total',paid,'change_amount',0,'cashier_id',p_actor,'client_uuid',h.id,'branch_id',h.branch_id);
 res:=pos_create_order_internal(payload);
 update orders set gross_profit=grand_total-vat_amount-cost_total where client_uuid=h.id;
 update pos_checkout_holds set status='committed',result=res where id=h.id;
 return res;
end $$;

-- Explicitly fail old clients rather than accepting unvalidated public sales.
create or replace function public.create_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'secure_checkout_required'; end $$;
revoke all on function public.create_order(jsonb) from public,anon,authenticated;
revoke all on function public.pos_reserve_checkout(uuid,uuid,uuid,jsonb),public.pos_commit_checkout(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pos_reserve_checkout(uuid,uuid,uuid,jsonb),public.pos_commit_checkout(uuid,uuid,jsonb) to service_role;
-- Direct stock mutation bypasses all reservation checks.
revoke all on function public.apply_stock_movement(uuid,uuid,movement_type,numeric,text,uuid,text,uuid,uuid,numeric,text) from public,anon,authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('void_order','pos_void_order','sync_return','sync_audit','sync_open_shift','close_shift')
 loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create table if not exists public.pos_payment_accounts (
 branch_id uuid primary key references public.branches(id),
 payee_name text not null,
 promptpay_mobile text check(promptpay_mobile ~ '^0[0-9]{9}$'),
 verified boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.pos_payment_accounts enable row level security;
revoke all on public.pos_payment_accounts from public,anon,authenticated;
grant all on public.pos_payment_accounts to service_role;

create table if not exists public.pos_count_approvals (
 id text primary key,branch_id uuid not null references branches(id),actor_id uuid not null references employees(id),
 lines jsonb not null,approved_at timestamptz not null default now()
);
alter table public.pos_count_approvals enable row level security;
revoke all on public.pos_count_approvals from public,anon,authenticated;
grant all on public.pos_count_approvals to service_role;
create or replace function public.pos_approve_count(p_id text,p_branch uuid,p_actor uuid,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous pos_count_approvals; ln jsonb; current_qty numeric; delta numeric; product uuid;
begin
 perform pos_assert_actor_active(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
 select * into previous from pos_count_approvals where id=p_id;
 if found then
  if previous.branch_id<>p_branch or previous.lines<>p_lines then raise exception 'count_conflict';end if;
  return jsonb_build_object('duplicate',true);
 end if;
 for ln in select value from jsonb_array_elements(p_lines) order by value->>'product_id' loop
  product:=(ln->>'product_id')::uuid;
  if (ln->>'counted')::numeric<0 then raise exception 'invalid_count';end if;
  insert into stock_levels(branch_id,product_id,qty_on_hand)values(p_branch,product,0)on conflict do nothing;
  select qty_on_hand into current_qty from stock_levels where branch_id=p_branch and product_id=product for update;
  if current_qty<>(ln->>'expected')::numeric then raise exception 'count_stock_changed';end if;
  delta:=(ln->>'counted')::numeric-current_qty;
  if delta<>0 then
   if (select track_serial from products where id=product) then raise exception 'serialized_count_requires_serial_reconciliation';end if;
   if exists(select 1 from pos_checkout_holds h,lateral jsonb_array_elements(h.quote->'items') i where h.branch_id=p_branch and h.status='active' and (h.expires_at>now() or jsonb_array_length(h.recorded_payments)>0) and (i->>'product_id')::uuid=product) then raise exception 'count_has_active_checkout';end if;
   perform apply_stock_movement(p_branch,product,'count_adjust',delta,'stock_counts',null,p_id,p_actor,null,null,coalesce(ln->>'reason',''));
  end if;
 end loop;
 insert into pos_count_approvals(id,branch_id,actor_id,lines)values(p_id,p_branch,p_actor,p_lines);
 return jsonb_build_object('approved',true);
end $$;
revoke all on function public.pos_approve_count(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pos_approve_count(text,uuid,uuid,jsonb) to service_role;

create or replace function public.pos_release_checkout(p_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h pos_checkout_holds;
begin
 perform pos_assert_actor_active(p_actor);
 select * into h from pos_checkout_holds where id=p_id;
 if not found or h.actor_id<>p_actor then raise exception 'checkout_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||h.branch_id::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;
 if h.status='committed' then raise exception 'checkout_already_committed_do_not_release';end if;
 if jsonb_array_length(h.recorded_payments)>0 then raise exception 'checkout_has_recorded_payment_requires_review';end if;
 update pos_checkout_holds set status='released' where id=p_id;
 return jsonb_build_object('released',true);
end $$;
revoke all on function public.pos_release_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pos_release_checkout(uuid,uuid) to service_role;

create table if not exists public.pos_audit_receipts(operation_id text primary key,created_at timestamptz not null default now());
alter table public.pos_audit_receipts enable row level security;
revoke all on public.pos_audit_receipts from public,anon,authenticated;
create or replace function public.pos_sync_audit_once(p_id text,p_payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into pos_audit_receipts(operation_id)values(p_id)on conflict do nothing;
 if not found then return;end if;
 perform sync_audit(p_payload);
end $$;
revoke all on function public.pos_sync_audit_once(text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_sync_audit_once(text,jsonb) to service_role;
-- Point redemption must become part of a verified sale, never a public standalone mutation.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('pos_redeem_points','pos_redeem_coupon','admin_loyalty_adjust','admin_merge_customers')
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;

create or replace function public.pos_record_checkout_payment(p_id uuid,p_actor uuid,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h pos_checkout_holds; existing jsonb; paid numeric;
begin
 perform pos_assert_actor_active(p_actor);
 select * into h from pos_checkout_holds where id=p_id;
 if not found or h.actor_id<>p_actor then raise exception 'checkout_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||h.branch_id::text,0));
 select * into h from pos_checkout_holds where id=p_id for update;
 if h.status<>'active' then raise exception 'checkout_not_active';end if;
 if p_payment->>'method' not in ('credit_card','debit_card','edc','installment','bank_transfer','qr_promptpay') or coalesce((p_payment->>'amount')::numeric,0)<=0 or coalesce(trim(p_payment->>'reference_no'),'')='' then raise exception 'invalid_payment_record';end if;
 select p into existing from jsonb_array_elements(h.recorded_payments) p where p->>'reference_no'=p_payment->>'reference_no' and p->>'method'=p_payment->>'method';
 if found then
  if existing<>p_payment then raise exception 'payment_reference_conflict';end if;
  return h.recorded_payments;
 end if;
 select coalesce(sum((p->>'amount')::numeric),0)+(p_payment->>'amount')::numeric into paid from jsonb_array_elements(h.recorded_payments) p;
 if paid>(h.quote->>'grand_total')::numeric then raise exception 'payment_exceeds_total';end if;
 update pos_checkout_holds set recorded_payments=recorded_payments||jsonb_build_array(p_payment) where id=p_id returning recorded_payments into existing;
 return existing;
end $$;
revoke all on function public.pos_record_checkout_payment(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pos_record_checkout_payment(uuid,uuid,jsonb) to service_role;
