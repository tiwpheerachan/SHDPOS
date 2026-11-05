-- =====================================================================
-- SHD POS — 0019_pos_redeem_points.sql
-- ใช้แต้มลูกค้าเป็นส่วนลดตอนขาย (redeem) — เรียกจาก POS หลังบันทึกบิล
--   • หักแต้มออกจาก customers.points
--   • บันทึก ledger 'redeem' (points_delta ติดลบ) ผูกกับบิล (หาเลขบิลจาก client_uuid)
--   • idempotent: ถ้าเคย redeem บิลนี้แล้ว จะไม่หักซ้ำ
--   มูลค่า 1 แต้ม = 1 บาท (ตรงกับ POINT_VALUE_THB ฝั่ง client)
-- =====================================================================
create or replace function public.pos_redeem_points(
  p_customer_id uuid,
  p_points      int,
  p_client_uuid uuid,
  p_note        text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order_id uuid;
  v_order_no text;
  v_branch   uuid;
  v_bal      int;
begin
  if p_customer_id is null or coalesce(p_points, 0) <= 0 then
    return json_build_object('ok', false, 'reason', 'noop');
  end if;

  -- หาบิลจาก client_uuid (อาจยังไม่ sync → order_id = null ได้)
  select id, order_no, branch_id into v_order_id, v_order_no, v_branch
    from orders where client_uuid = p_client_uuid;

  -- idempotent: ถ้าบิลนี้เคยมีรายการ redeem แล้ว ไม่ทำซ้ำ
  if v_order_id is not null and exists (
    select 1 from loyalty_ledger where order_id = v_order_id and kind = 'redeem'
  ) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  update customers set points = points - p_points, updated_at = now()
    where id = p_customer_id returning points into v_bal;
  if not found then raise exception 'customer not found'; end if;

  insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, balance_points, note)
    values (p_customer_id, v_order_id, v_branch, 'redeem', -p_points, v_bal,
            coalesce(p_note, 'ใช้แต้มเป็นส่วนลดบิล ' || coalesce(v_order_no, '')));

  return json_build_object('ok', true, 'balance_points', v_bal);
end;
$$;

revoke all on function public.pos_redeem_points(uuid, int, uuid, text) from public;
grant execute on function public.pos_redeem_points(uuid, int, uuid, text) to anon, authenticated;
