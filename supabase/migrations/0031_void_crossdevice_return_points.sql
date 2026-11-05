-- =====================================================================
-- SHD POS — 0031_void_crossdevice_return_points.sql
-- (A) void บิลข้ามเครื่อง: pos_void_order(client_uuid) → resolve บิลแล้ว void
-- (B) คืนแต้มเมื่อคืนบางรายการ: sync_return หักแต้มที่ได้รับตามสัดส่วนเงินคืน
--     (เรทเดียวกับตอนได้ /20) เข้ากระเป๋าแบรนด์ ไม่หักเกินแต้มที่บิลนี้ได้
-- =====================================================================

-- (A) void ข้ามเครื่อง
create or replace function public.pos_void_order(p_client_uuid uuid, p_employee_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  select id into v_id from orders where client_uuid = p_client_uuid;
  if v_id is null then raise exception 'order % not synced yet', p_client_uuid; end if;
  perform void_order(v_id, p_employee_id, p_reason);
end $$;
revoke all on function public.pos_void_order(uuid, uuid, text) from public;
grant execute on function public.pos_void_order(uuid, uuid, text) to anon, authenticated;

-- (B) sync_return + คืนแต้มบางส่วน
create or replace function public.sync_return(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r returns; ins uuid; it jsonb; v_order_id uuid; v_prod uuid;
  v_cust uuid; v_obranch uuid; v_brand uuid;
  v_reverse int; v_earned int; v_reversed int; v_bal int; v_bw int;
begin
  r := jsonb_populate_record(null::returns, p_payload);

  v_order_id := null;
  if nullif(p_payload->>'order_client_uuid','') is not null then
    select id into v_order_id from orders where client_uuid = (p_payload->>'order_client_uuid')::uuid;
  end if;
  if v_order_id is null and nullif(p_payload->>'order_no','') is not null then
    select id into v_order_id from orders where order_no = p_payload->>'order_no';
  end if;

  insert into returns(id, return_no, client_uuid, order_id, branch_id, type, status, reason_code, reason_note,
                      refund_method, refund_amount, requested_by, approved_by, created_at)
  values (coalesce(r.id, gen_random_uuid()), r.return_no, nullif(p_payload->>'client_uuid','')::uuid, v_order_id, r.branch_id,
          r.type, coalesce(r.status,'completed'), r.reason_code, r.reason_note,
          r.refund_method, coalesce(r.refund_amount,0), r.requested_by, r.approved_by, coalesce(r.created_at, now()))
  on conflict (client_uuid) do nothing
  returning id into ins;

  if ins is null then return; end if;  -- ซ้ำ → ไม่ทำต่อ

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_prod := nullif(it->>'product_id','')::uuid;
    if v_prod is null then select id into v_prod from products where sku = it->>'sku' limit 1; end if;
    insert into return_items(id, return_id, product_id, sku, name, qty, unit_price, line_total, condition)
    values (gen_random_uuid(), ins, v_prod, it->>'sku', it->>'name',
            coalesce((it->>'qty')::numeric,0), coalesce((it->>'unit_price')::numeric,0),
            coalesce((it->>'line_total')::numeric,0), it->>'condition');
    if v_prod is not null and it->>'condition' = 'sellable' and coalesce((it->>'qty')::numeric,0) > 0 then
      perform apply_stock_movement(r.branch_id, v_prod, 'return', coalesce((it->>'qty')::numeric,0),
        'returns', ins, r.return_no, r.requested_by, null, 0, null);
    end if;
  end loop;

  -- คืนแต้มที่ได้รับ ตามสัดส่วนเงินคืน (เข้ากระเป๋าแบรนด์ของบิล)
  if v_order_id is not null and coalesce(r.refund_amount,0) > 0 then
    select customer_id, branch_id into v_cust, v_obranch from orders where id = v_order_id;
    if v_cust is not null then
      v_brand := (select brand_id from branches where id = v_obranch);
      select coalesce(sum(points_delta) filter (where kind = 'earn'), 0),
             coalesce(-sum(points_delta) filter (where kind = 'return'), 0)
        into v_earned, v_reversed
        from loyalty_ledger where order_id = v_order_id;
      v_reverse := least(floor(r.refund_amount / 20.0)::int, greatest(v_earned - v_reversed, 0));
      if v_reverse > 0 then
        update customers set points = points - v_reverse, updated_at = now() where id = v_cust returning points into v_bal;
        if v_brand is not null then
          insert into brand_wallets(customer_id, brand_id, points) values (v_cust, v_brand, -v_reverse)
          on conflict (customer_id, brand_id) do update set points = brand_wallets.points - v_reverse, updated_at = now()
          returning points into v_bw;
        end if;
        insert into loyalty_ledger(customer_id, brand_id, order_id, branch_id, kind, points_delta, balance_points, note)
          values (v_cust, v_brand, v_order_id, v_obranch, 'return', -v_reverse, coalesce(v_bw, v_bal),
                  'คืนแต้มจากการคืนสินค้า ' || r.return_no);
      end if;
    end if;
  end if;
end $$;
