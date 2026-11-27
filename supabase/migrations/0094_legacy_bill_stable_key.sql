-- 0094 บิลระบบเดิมส่ง place_key (ตำแหน่งที่ 7) — ใช้ทำรหัสบิลที่ไม่เปลี่ยนเมื่อแก้การจับคู่ร้าน→สาขา (ค่าฟิลด์เพิ่มเองผูกกับรหัสนี้)
create or replace function legacy_sales_compact(p_from date, p_to date, p_branches uuid[] default null)
returns json language sql stable set search_path = public as $$
  with n as (select * from legacy_lines_norm(p_from, p_to, p_branches)),
  sk as (select sku_key, min(sku_name) nm, min(product_id::text) pid, min(brand_id::text) bid, row_number() over (order by sku_key) - 1 i from n group by sku_key),
  py as (select pay, row_number() over (order by pay) - 1 i from (select distinct coalesce(pay, '') pay from n) x),
  li as (
    select n.*, sk.i si, py.i pi from n join sk using (sku_key) join py on py.pay = coalesce(n.pay, '')
  ),
  bl as (
    select coalesce(branch_id::text, 'lark:' || coalesce(place_key, 'unknown')) br, sale_date, bill_no, ret, bool_or(ev) ev, place_key,
           json_agg(json_build_array(si, qty, unit_price, discount, amount, pi) order by line_id) items
    from li group by coalesce(branch_id::text, 'lark:' || coalesce(place_key, 'unknown')), place_key, sale_date, bill_no, ret
  )
  select json_build_object(
    'skus', coalesce((select json_agg(json_build_array(sku_key, nm, pid, bid) order by i) from sk), '[]'),
    'pays', coalesce((select json_agg(pay order by i) from py), '[]'),
    'places', coalesce((select json_object_agg(place_key, json_build_array(nm, ev)) from (select place_key, min(place_name) nm, bool_or(ev) ev from n where branch_id is null and place_key is not null group by place_key) p), '{}'),
    'bills', coalesce((select json_agg(json_build_array(br, sale_date, bill_no, case when ret then 1 else 0 end, case when ev then 1 else 0 end, items, coalesce(place_key, 'unknown')) order by sale_date desc, bill_no) from bl), '[]')
  )
$$;

revoke all on function legacy_sales_compact(date, date, uuid[]) from public, anon, authenticated;
grant execute on function legacy_sales_compact(date, date, uuid[]) to service_role;
