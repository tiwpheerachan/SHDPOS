-- =====================================================================
-- SHD POS — 0027_order_gift_snapshot.sql
-- create_order: เก็บธง is_gift/ที่มาของแถม ลง order_items + เก็บ snapshot
-- กติกาโปรโมชันที่ใช้จริง (coupon/redeem/gifts) กับบิล เพื่อให้การแก้แคมเปญ
-- ภายหลังไม่กระทบประวัติเก่า
-- =====================================================================
alter table orders add column if not exists promo_snapshot jsonb;

create or replace function create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_client_uuid uuid := (p_payload->>'client_uuid')::uuid;
  v_branch_id   uuid := (p_payload->>'branch_id')::uuid;
  v_existing    orders%rowtype;
  v_order_id    uuid;
  v_order_no    text;
  v_prefix      text;
  v_item        jsonb;
  v_pay         jsonb;
  v_item_id     uuid;
  v_serial      text;
  v_serial_id   uuid;
  v_cost_total  numeric := 0;
  v_gp_total    numeric := 0;
begin
  if v_client_uuid is not null then
    select * into v_existing from orders where client_uuid = v_client_uuid;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'duplicate', true);
    end if;
  end if;

  select coalesce(t.receipt_prefix, b.code) into v_prefix
  from branches b
  left join terminals t on t.id = (p_payload->>'terminal_id')::uuid
  where b.id = v_branch_id;

  v_order_no := next_document_no(coalesce(v_prefix, 'POS'),
                'order:' || coalesce(v_prefix,'POS') || ':' ||
                to_char(now() at time zone 'Asia/Bangkok', 'YYMM'));

  insert into orders(
    order_no, client_uuid, branch_id, terminal_id, shift_id, cashier_id, salesperson_id,
    customer_id, customer_name, customer_phone, status, channel,
    subtotal, discount_total, discount_percent, vat_amount, grand_total,
    paid_total, change_amount, reference_no, note,
    is_offline_origin, device_created_at, synced_at, discount_approved_by, approval_id,
    promo_snapshot)
  values (
    v_order_no, v_client_uuid, v_branch_id,
    (p_payload->>'terminal_id')::uuid,
    (p_payload->>'shift_id')::uuid,
    (p_payload->>'cashier_id')::uuid,
    (p_payload->>'salesperson_id')::uuid,
    (p_payload->>'customer_id')::uuid,
    p_payload->>'customer_name',
    p_payload->>'customer_phone',
    coalesce((p_payload->>'status')::order_status, 'completed'),
    coalesce((p_payload->>'channel')::sale_channel, 'offline'),
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    coalesce((p_payload->>'discount_percent')::numeric, 0),
    coalesce((p_payload->>'vat_amount')::numeric, 0),
    coalesce((p_payload->>'grand_total')::numeric, 0),
    coalesce((p_payload->>'paid_total')::numeric, 0),
    coalesce((p_payload->>'change_amount')::numeric, 0),
    p_payload->>'reference_no',
    p_payload->>'note',
    coalesce((p_payload->>'is_offline_origin')::boolean, false),
    (p_payload->>'device_created_at')::timestamptz,
    now(),
    (p_payload->>'discount_approved_by')::uuid,
    (p_payload->>'approval_id')::uuid,
    p_payload->'promo_snapshot')
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into order_items(
      order_id, product_id, sku, name, kind, qty, unit_price,
      discount_amount, discount_percent, line_total,
      unit_cost, cost_total, gross_profit, vat_amount, salesperson_id, sort_order,
      is_gift, gift_source, gift_campaign_id, gift_of_sku)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'sku',
      v_item->>'name',
      coalesce((v_item->>'kind')::line_kind, 'goods'),
      coalesce((v_item->>'qty')::numeric, 1),
      coalesce((v_item->>'unit_price')::numeric, 0),
      coalesce((v_item->>'discount_amount')::numeric, 0),
      coalesce((v_item->>'discount_percent')::numeric, 0),
      coalesce((v_item->>'line_total')::numeric, 0),
      coalesce((v_item->>'unit_cost')::numeric, 0),
      coalesce((v_item->>'cost_total')::numeric, 0),
      coalesce((v_item->>'gross_profit')::numeric, 0),
      coalesce((v_item->>'vat_amount')::numeric, 0),
      coalesce((v_item->>'salesperson_id')::uuid, (p_payload->>'salesperson_id')::uuid),
      coalesce((v_item->>'sort_order')::int, 0),
      coalesce((v_item->>'is_gift')::boolean, false),
      v_item->>'gift_source',
      (v_item->>'gift_campaign_id')::uuid,
      v_item->>'gift_of_sku')
    returning id into v_item_id;

    v_cost_total := v_cost_total + coalesce((v_item->>'cost_total')::numeric, 0);
    v_gp_total   := v_gp_total   + coalesce((v_item->>'gross_profit')::numeric, 0);

    if (v_item->>'product_id') is not null then
      perform apply_stock_movement(
        v_branch_id, (v_item->>'product_id')::uuid, 'sale',
        -1 * coalesce((v_item->>'qty')::numeric, 1),
        'orders', v_order_id, v_order_no,
        (p_payload->>'cashier_id')::uuid, null,
        coalesce((v_item->>'unit_cost')::numeric, 0), null);
    end if;

    for v_serial in select jsonb_array_elements_text(coalesce(v_item->'serials', '[]'::jsonb))
    loop
      select id into v_serial_id from serials
       where serial_no = v_serial and product_id = (v_item->>'product_id')::uuid limit 1;
      if v_serial_id is null then
        insert into serials(product_id, serial_no, branch_id, status, sold_at, sold_order_id)
        values ((v_item->>'product_id')::uuid, v_serial, v_branch_id, 'sold', now(), v_order_id)
        returning id into v_serial_id;
      else
        update serials
           set status = 'sold', sold_at = now(), sold_order_id = v_order_id,
               customer_id = (p_payload->>'customer_id')::uuid,
               warranty_start = current_date,
               warranty_end = current_date + (coalesce((select warranty_months from products where id = (v_item->>'product_id')::uuid), 12) || ' months')::interval
         where id = v_serial_id;
      end if;
      insert into order_item_serials(order_item_id, serial_id, serial_no)
      values (v_item_id, v_serial_id, v_serial) on conflict do nothing;
    end loop;
  end loop;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb))
  loop
    insert into order_payments(
      order_id, method, amount, acquirer_bank, card_brand, card_last4,
      approval_code, mid, reference_no, installment_months, fee_amount)
    values (
      v_order_id, (v_pay->>'method')::payment_method, coalesce((v_pay->>'amount')::numeric, 0),
      v_pay->>'acquirer_bank', v_pay->>'card_brand', v_pay->>'card_last4',
      v_pay->>'approval_code', v_pay->>'mid', v_pay->>'reference_no',
      (v_pay->>'installment_months')::int, coalesce((v_pay->>'fee_amount')::numeric, 0));
  end loop;

  update orders
     set cost_total = v_cost_total,
         gross_profit = coalesce((p_payload->>'grand_total')::numeric,0) - v_cost_total
   where id = v_order_id;

  if (p_payload->>'shift_id') is not null then
    update shifts
       set total_sales = total_sales + coalesce((p_payload->>'grand_total')::numeric, 0),
           total_orders = total_orders + 1
     where id = (p_payload->>'shift_id')::uuid;
  end if;

  insert into audit_logs(action, actor_id, branch_id, terminal_id, ref_table, ref_id, ref_no,
                         amount, after_data, is_offline)
  values ('sale', (p_payload->>'cashier_id')::uuid, v_branch_id,
          (p_payload->>'terminal_id')::uuid, 'orders', v_order_id, v_order_no,
          coalesce((p_payload->>'grand_total')::numeric, 0),
          jsonb_build_object('items', jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)),
                             'channel', p_payload->>'channel'),
          coalesce((p_payload->>'is_offline_origin')::boolean, false));

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'duplicate', false);
end $$;
