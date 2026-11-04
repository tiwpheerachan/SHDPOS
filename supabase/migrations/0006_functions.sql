-- =====================================================================
-- SHD POS — 0006_functions.sql
-- RPC หลัก: ออกเลขเอกสาร, บันทึกบิล (idempotent สำหรับ offline sync),
--           ตัดสต๊อก, ปิดกะ, view สำหรับ dashboard
-- =====================================================================

-- ---------------------------------------------------------------------
-- next_document_no — ออกเลขรันนิ่งแบบ atomic
-- ---------------------------------------------------------------------
create or replace function next_document_no(p_prefix text, p_scope text)
returns text
language plpgsql
security definer
as $$
declare
  v_key text := p_scope;
  v_val int;
begin
  insert into document_sequences(scope_key, last_value)
  values (v_key, 1)
  on conflict (scope_key)
  do update set last_value = document_sequences.last_value + 1, updated_at = now()
  returning last_value into v_val;

  return p_prefix || '-' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD') || '-' || lpad(v_val::text, 4, '0');
end $$;

-- ---------------------------------------------------------------------
-- apply_stock_movement — เขียน ledger + อัปเดต snapshot ในทรานแซกชันเดียว
-- ---------------------------------------------------------------------
create or replace function apply_stock_movement(
  p_branch_id  uuid,
  p_product_id uuid,
  p_type       movement_type,
  p_qty_delta  numeric,
  p_ref_table  text default null,
  p_ref_id     uuid default null,
  p_ref_no     text default null,
  p_employee_id uuid default null,
  p_serial_id  uuid default null,
  p_unit_cost  numeric default null,
  p_note       text default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_after numeric;
  v_id uuid;
  v_stocked boolean;
begin
  select is_stocked into v_stocked from products where id = p_product_id;
  if coalesce(v_stocked, false) = false then
    return null;   -- สินค้าบริการ ไม่ตัดสต๊อก
  end if;

  insert into stock_levels(branch_id, product_id, qty_on_hand)
  values (p_branch_id, p_product_id, 0)
  on conflict (branch_id, product_id) do nothing;

  update stock_levels
     set qty_on_hand = qty_on_hand + p_qty_delta,
         updated_at = now()
   where branch_id = p_branch_id and product_id = p_product_id
  returning qty_on_hand into v_after;

  insert into stock_movements(
    branch_id, product_id, serial_id, type, qty_delta, qty_after,
    unit_cost, ref_table, ref_id, ref_no, employee_id, note)
  values (
    p_branch_id, p_product_id, p_serial_id, p_type, p_qty_delta, v_after,
    p_unit_cost, p_ref_table, p_ref_id, p_ref_no, p_employee_id, p_note)
  returning id into v_id;

  -- แจ้งเตือนสต๊อกใกล้หมด
  perform check_low_stock(p_branch_id, p_product_id);

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- check_low_stock — สร้าง notification เมื่อต่ำกว่าจุดสั่งซื้อ
-- ---------------------------------------------------------------------
create or replace function check_low_stock(p_branch_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_qty numeric; v_rp int; v_name text; v_sku text; v_brand uuid;
begin
  select sl.qty_on_hand, greatest(sl.reorder_point, p.reorder_point), p.name_th, p.sku, p.brand_id
    into v_qty, v_rp, v_name, v_sku, v_brand
  from stock_levels sl join products p on p.id = sl.product_id
  where sl.branch_id = p_branch_id and sl.product_id = p_product_id;

  if v_rp is null or v_rp <= 0 then return; end if;

  if v_qty <= v_rp then
    -- กันสร้างซ้ำ: ถ้ายังมีใบเปิดค้างอยู่ ไม่ต้องสร้างใหม่
    if not exists (
      select 1 from notifications
      where kind = 'low_stock' and branch_id = p_branch_id
        and payload->>'product_id' = p_product_id::text
        and resolved_at is null
    ) then
      insert into notifications(kind, severity, branch_id, brand_id, title, body, payload)
      values ('low_stock',
              case when v_qty <= 0 then 'critical' else 'warn' end,
              p_branch_id, v_brand,
              'สต๊อกใกล้หมด: ' || v_name,
              v_sku || ' เหลือ ' || v_qty || ' (จุดสั่งซื้อ ' || v_rp || ')',
              jsonb_build_object('product_id', p_product_id, 'sku', v_sku,
                                 'qty', v_qty, 'reorder_point', v_rp));
    end if;
  else
    update notifications set resolved_at = now()
    where kind = 'low_stock' and branch_id = p_branch_id
      and payload->>'product_id' = p_product_id::text
      and resolved_at is null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- create_order — บันทึกบิลแบบ atomic + idempotent
--   ใช้ได้ทั้งขายสด online และตอน sync บิล offline กลับเข้ามา
--   ถ้า client_uuid ซ้ำ → คืนบิลเดิม ไม่สร้างใหม่ (กันบิลซ้ำจากการ retry)
-- ---------------------------------------------------------------------
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
  -- idempotency
  if v_client_uuid is not null then
    select * into v_existing from orders where client_uuid = v_client_uuid;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'duplicate', true);
    end if;
  end if;

  select coalesce(t.receipt_prefix, b.code)
    into v_prefix
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
    is_offline_origin, device_created_at, synced_at, discount_approved_by, approval_id)
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
    (p_payload->>'approval_id')::uuid)
  returning id into v_order_id;

  -- บรรทัดสินค้า
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into order_items(
      order_id, product_id, sku, name, kind, qty, unit_price,
      discount_amount, discount_percent, line_total,
      unit_cost, cost_total, gross_profit, vat_amount, salesperson_id, sort_order)
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
      coalesce((v_item->>'sort_order')::int, 0))
    returning id into v_item_id;

    v_cost_total := v_cost_total + coalesce((v_item->>'cost_total')::numeric, 0);
    v_gp_total   := v_gp_total   + coalesce((v_item->>'gross_profit')::numeric, 0);

    -- ตัดสต๊อก
    if (v_item->>'product_id') is not null then
      perform apply_stock_movement(
        v_branch_id, (v_item->>'product_id')::uuid, 'sale',
        -1 * coalesce((v_item->>'qty')::numeric, 1),
        'orders', v_order_id, v_order_no,
        (p_payload->>'cashier_id')::uuid, null,
        coalesce((v_item->>'unit_cost')::numeric, 0), null);
    end if;

    -- serial
    for v_serial in select jsonb_array_elements_text(coalesce(v_item->'serials', '[]'::jsonb))
    loop
      select id into v_serial_id from serials
       where serial_no = v_serial and product_id = (v_item->>'product_id')::uuid
       limit 1;
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
      values (v_item_id, v_serial_id, v_serial)
      on conflict do nothing;
    end loop;
  end loop;

  -- การชำระเงิน
  for v_pay in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb))
  loop
    insert into order_payments(
      order_id, method, amount, acquirer_bank, card_brand, card_last4,
      approval_code, mid, reference_no, installment_months, fee_amount)
    values (
      v_order_id,
      (v_pay->>'method')::payment_method,
      coalesce((v_pay->>'amount')::numeric, 0),
      v_pay->>'acquirer_bank', v_pay->>'card_brand', v_pay->>'card_last4',
      v_pay->>'approval_code', v_pay->>'mid', v_pay->>'reference_no',
      (v_pay->>'installment_months')::int,
      coalesce((v_pay->>'fee_amount')::numeric, 0));
  end loop;

  update orders
     set cost_total = v_cost_total,
         gross_profit = coalesce((p_payload->>'grand_total')::numeric,0) - v_cost_total
   where id = v_order_id;

  -- อัปเดตยอดกะ
  if (p_payload->>'shift_id') is not null then
    update shifts
       set total_sales = total_sales + coalesce((p_payload->>'grand_total')::numeric, 0),
           total_orders = total_orders + 1
     where id = (p_payload->>'shift_id')::uuid;
  end if;

  -- audit
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

-- ---------------------------------------------------------------------
-- void_order — ยกเลิกบิล + คืนสต๊อก
-- ---------------------------------------------------------------------
create or replace function void_order(p_order_id uuid, p_employee_id uuid, p_reason text)
returns void
language plpgsql
security definer
as $$
declare v_o orders%rowtype; v_it order_items%rowtype;
begin
  select * into v_o from orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if v_o.status = 'voided' then return; end if;

  for v_it in select * from order_items where order_id = p_order_id loop
    if v_it.product_id is not null then
      perform apply_stock_movement(v_o.branch_id, v_it.product_id, 'return', v_it.qty,
        'orders', p_order_id, v_o.order_no, p_employee_id, null, v_it.unit_cost, 'void');
    end if;
  end loop;

  update serials set status = 'in_stock', sold_order_id = null, sold_at = null
   where sold_order_id = p_order_id;

  update orders set status = 'voided', voided_by = p_employee_id,
                    voided_at = now(), void_reason = p_reason
   where id = p_order_id;

  update shifts set total_sales = total_sales - v_o.grand_total,
                    total_orders = greatest(total_orders - 1, 0)
   where id = v_o.shift_id;

  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, before_data)
  values ('void', p_employee_id, v_o.branch_id, 'orders', p_order_id, v_o.order_no,
          v_o.grand_total, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------
-- close_shift — ปิดกะ + คำนวณเงินสดที่ควรมี
-- ---------------------------------------------------------------------
create or replace function close_shift(p_shift_id uuid, p_counted_cash numeric, p_employee_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_open numeric; v_cash_sales numeric; v_in numeric; v_out numeric; v_expected numeric; v_branch uuid;
begin
  select opening_cash, branch_id into v_open, v_branch from shifts where id = p_shift_id;

  select coalesce(sum(p.amount),0) into v_cash_sales
  from order_payments p join orders o on o.id = p.order_id
  where o.shift_id = p_shift_id and p.method = 'cash' and o.status <> 'voided';

  select coalesce(sum(case when type in ('cash_in') then amount else 0 end),0),
         coalesce(sum(case when type in ('cash_out','drop','pickup') then amount else 0 end),0)
    into v_in, v_out
  from cash_movements where shift_id = p_shift_id;

  v_expected := coalesce(v_open,0) + v_cash_sales + v_in - v_out;

  update shifts
     set status = 'closed', closed_by = p_employee_id, closed_at = now(),
         expected_cash = v_expected, counted_cash = p_counted_cash,
         cash_variance = p_counted_cash - v_expected, note = p_note
   where id = p_shift_id;

  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, amount, after_data)
  values ('shift_close', p_employee_id, v_branch, 'shifts', p_shift_id, p_counted_cash,
          jsonb_build_object('expected', v_expected, 'counted', p_counted_cash,
                             'variance', p_counted_cash - v_expected));

  return jsonb_build_object('expected_cash', v_expected, 'counted_cash', p_counted_cash,
                            'variance', p_counted_cash - v_expected, 'cash_sales', v_cash_sales);
end $$;

-- =====================================================================
-- VIEWS สำหรับ Dashboard / Analytics
-- =====================================================================

-- ยอดขายรายวัน x สาขา x แบรนด์
create or replace view v_daily_sales as
select
  (o.created_at at time zone 'Asia/Bangkok')::date as sale_date,
  o.branch_id,
  b.name          as branch_name,
  b.brand_id,
  br.name         as brand_name,
  count(distinct o.id)                          as order_count,
  sum(o.grand_total)                            as gross_sales,
  sum(o.discount_total)                         as discount_total,
  sum(o.cost_total)                             as cost_total,
  sum(o.gross_profit)                           as gross_profit,
  case when sum(o.grand_total) > 0
       then sum(o.gross_profit) / sum(o.grand_total) * 100 else 0 end as gp_percent,
  sum(o.grand_total) / nullif(count(distinct o.id),0) as avg_basket
from orders o
join branches b on b.id = o.branch_id
left join brands br on br.id = b.brand_id
where o.status in ('completed','partially_refunded')
group by 1,2,3,4,5;

-- performance รายพนักงาน
create or replace view v_employee_performance as
select
  (o.created_at at time zone 'Asia/Bangkok')::date as sale_date,
  o.branch_id,
  b.name as branch_name,
  coalesce(oi.salesperson_id, o.salesperson_id, o.cashier_id) as employee_id,
  e.employee_code,
  coalesce(e.nickname, e.first_name) as employee_name,
  count(distinct o.id)          as order_count,
  sum(oi.line_total)            as sales_amount,
  sum(oi.gross_profit)          as gross_profit,
  sum(oi.qty)                   as units_sold,
  sum(oi.line_total) / nullif(count(distinct o.id),0) as avg_basket
from order_items oi
join orders o on o.id = oi.order_id
join branches b on b.id = o.branch_id
left join employees e on e.id = coalesce(oi.salesperson_id, o.salesperson_id, o.cashier_id)
where o.status in ('completed','partially_refunded')
group by 1,2,3,4,5,6;

-- สต๊อกใกล้หมด
create or replace view v_low_stock as
select
  sl.branch_id, b.name as branch_name, b.brand_id,
  sl.product_id, p.sku, p.name_th, p.brand_id as product_brand_id,
  sl.qty_on_hand,
  greatest(sl.reorder_point, p.reorder_point) as reorder_point,
  case when sl.qty_on_hand <= 0 then 'out_of_stock' else 'low' end as level
from stock_levels sl
join products p on p.id = sl.product_id
join branches b on b.id = sl.branch_id
where p.is_stocked
  and greatest(sl.reorder_point, p.reorder_point) > 0
  and sl.qty_on_hand <= greatest(sl.reorder_point, p.reorder_point);

-- สรุปวิธีชำระเงิน
create or replace view v_payment_mix as
select
  (o.created_at at time zone 'Asia/Bangkok')::date as sale_date,
  o.branch_id,
  pm.method,
  count(*)        as txn_count,
  sum(pm.amount)  as amount,
  sum(pm.fee_amount) as fee_amount
from order_payments pm
join orders o on o.id = pm.order_id
where o.status <> 'voided'
group by 1,2,3;
