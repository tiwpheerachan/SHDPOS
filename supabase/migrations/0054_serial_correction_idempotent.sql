-- 0054 — pos_apply_serial_correction: ส่งซ้ำด้วย SN เดิม = ไม่ทำซ้ำ (ไม่บันทึกประวัติซ้ำ)
create or replace function pos_apply_serial_correction(
  p_order uuid, p_item uuid, p_old jsonb, p_new text[], p_reason text, p_actor uuid, p_ow_sale text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare it record; br uuid; sn text; sid uuid; other uuid; olds text[];
begin
  select oi.id, oi.product_id, oi.sku into it from order_items oi where oi.id = p_item and oi.order_id = p_order for update;
  if not found then raise exception 'order_item_not_in_order'; end if;
  if it.product_id is null then raise exception 'order_item_without_product'; end if;
  select branch_id into br from orders where id = p_order;
  select coalesce(array_agg(serial_no order by serial_no), '{}') into olds from order_item_serials where order_item_id = p_item;
  -- SN ในบิลตรงกับที่ขอแล้ว (ส่งซ้ำ) → ไม่ทำซ้ำ ไม่เพิ่มประวัติซ้ำ
  if olds = coalesce((select array_agg(x order by x) from unnest(p_new) x), '{}') then
    return jsonb_build_object('old', olds, 'new', olds, 'unchanged', true);
  end if;
  -- SN ใหม่ต้องไม่ถูกขายในบิลอื่น
  foreach sn in array coalesce(p_new, '{}') loop
    select sold_order_id into other from serials where product_id = it.product_id and serial_no = sn and status = 'sold' for update;
    if other is not null and other <> p_order then raise exception 'serial_sold_on_other_order:%', sn; end if;
  end loop;
  insert into pos_serial_corrections(order_id, order_item_id, sku, old_serials, new_serials, reason, actor_id, ow_sale_id)
  values (p_order, p_item, it.sku, olds, coalesce(p_new, '{}'), left(p_reason, 500), p_actor, p_ow_sale);
  delete from order_item_serials where order_item_id = p_item;
  update serials s set status = (o->>'status')::serial_status, sold_order_id = null, sold_at = null, note = left(o->>'note', 300), updated_at = now()
    from jsonb_array_elements(coalesce(p_old, '[]')) o
    where s.id = (o->>'serial_id')::uuid and s.sold_order_id = p_order and not (s.serial_no = any(coalesce(p_new, '{}')));
  foreach sn in array coalesce(p_new, '{}') loop
    insert into serials(product_id, serial_no, branch_id, status, sold_order_id, sold_at, note)
    values (it.product_id, sn, br, 'sold', p_order, now(), 'แก้ SN บิล')
    on conflict (product_id, serial_no) do update set status = 'sold', sold_order_id = p_order, sold_at = now(), updated_at = now()
    returning id into sid;
    insert into order_item_serials(order_item_id, serial_id, serial_no) values (p_item, sid, sn);
  end loop;
  return jsonb_build_object('old', olds, 'new', coalesce(p_new, '{}'));
end $$;
revoke all on function pos_apply_serial_correction(uuid, uuid, jsonb, text[], text, uuid, text) from public, anon, authenticated;
