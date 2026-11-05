-- =====================================================================
-- SHD POS — 0030_returns_crossdevice.sql
-- คืนสินค้าข้ามเครื่อง + คืนสต๊อกฝั่ง server + กันคืนเกิน
--   • sync_return: resolve บิลต้นทางจาก client_uuid (fallback order_no),
--     คืนสต๊อกสภาพ "ขายต่อได้", idempotent ด้วย return.client_uuid
--   • pos_lookup_order: หาบิลจาก server (ให้เครื่องอื่นเปิดคืนได้) + ยอดคืนแล้วรายสินค้า
-- =====================================================================
create or replace function public.sync_return(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r returns; ins uuid; it jsonb; v_order_id uuid; v_prod uuid;
begin
  r := jsonb_populate_record(null::returns, p_payload);

  -- หาบิลต้นทาง: client_uuid ของบิล → order_no
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

  if ins is not null then
    for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
      v_prod := nullif(it->>'product_id','')::uuid;
      if v_prod is null then select id into v_prod from products where sku = it->>'sku' limit 1; end if;
      insert into return_items(id, return_id, product_id, sku, name, qty, unit_price, line_total, condition)
      values (gen_random_uuid(), ins, v_prod, it->>'sku', it->>'name',
              coalesce((it->>'qty')::numeric,0), coalesce((it->>'unit_price')::numeric,0),
              coalesce((it->>'line_total')::numeric,0), it->>'condition');
      -- คืนสต๊อกเฉพาะสภาพขายต่อได้
      if v_prod is not null and it->>'condition' = 'sellable' and coalesce((it->>'qty')::numeric,0) > 0 then
        perform apply_stock_movement(r.branch_id, v_prod, 'return', coalesce((it->>'qty')::numeric,0),
          'returns', ins, r.return_no, r.requested_by, null, 0, null);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- หาบิลจาก server (เครื่องอื่นเปิดคืนได้) + returned_qty รายสินค้า (กันคืนเกิน)
-- ---------------------------------------------------------------------
create or replace function public.pos_lookup_order(p_order_no text)
returns json language sql security definer set search_path = public, extensions as $$
  select (
    select json_build_object(
      'id', o.id, 'order_no', o.order_no, 'client_uuid', o.client_uuid, 'branch_id', o.branch_id,
      'grand_total', o.grand_total, 'subtotal', o.subtotal, 'discount_total', o.discount_total,
      'customer_id', o.customer_id, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
      'status', o.status, 'channel', o.channel, 'created_at', o.created_at,
      'items', coalesce((
        select json_agg(json_build_object(
          'id', oi.id, 'product_id', oi.product_id, 'sku', oi.sku, 'name', oi.name,
          'kind', oi.kind, 'qty', oi.qty, 'unit_price', oi.unit_price, 'line_total', oi.line_total,
          'unit_cost', oi.unit_cost, 'is_gift', oi.is_gift, 'gift_campaign_id', oi.gift_campaign_id,
          'returned_qty', coalesce((select sum(ri.qty) from return_items ri join returns r on r.id = ri.return_id
                                    where r.order_id = o.id and ri.sku = oi.sku), 0),
          'serials', coalesce((select json_agg(s.serial_no) from order_item_serials s where s.order_item_id = oi.id), '[]'::json)
        )) from order_items oi where oi.order_id = o.id), '[]'::json)
    )
    from orders o where o.order_no = btrim(p_order_no) limit 1
  );
$$;
revoke all on function public.pos_lookup_order(text) from public;
grant execute on function public.pos_lookup_order(text) to anon, authenticated;
