-- 0090 ส่งยอดขายระบบเดิม (Lark) แบบบีบอัด — รวมบิลในฐานข้อมูลรอบเดียว (แทนอ่านทีละ 1,000 บรรทัด)
--   ปรับเครื่องหมายอีเวนต์ (ระบบเดิมบันทึกติดลบ/returned) · ข้ามบรรทัดว่าง · ไม่นับตั้งแต่วันเริ่มใช้ POS ของสาขา
--   รูปแบบ: { skus:[[key,name,product_id,brand_id]], pays:[text], places:{place_key:[name,channel]},
--            bills:[[branch|lark:place_key, date, bill_no, returned 0/1, event 0/1, [[sku_i,qty,unit,disc,amount,pay_i],…]]] }
create index if not exists legacy_sales_lines_sale_date_place_idx on legacy_sales_lines (sale_date, place_key);

create or replace function legacy_lines_norm(p_from date, p_to date, p_branches uuid[])
returns table (line_id text, place_key text, place_name text, branch_id uuid, sale_date date, bill_no text, ret boolean, ev boolean,
               sku_key text, sku_name text, product_id uuid, brand_id uuid, pay text, qty numeric, unit_price numeric, discount numeric, amount numeric)
language sql stable set search_path = public as $$
  select l.line_id, l.place_key, l.place_name, l.branch_id, l.sale_date, coalesce(l.order_no, l.line_id),
         (l.channel <> 'event' and l.status = 'returned'), l.channel = 'event',
         coalesce(l.jst_sku_id, l.sku_code, l.sku_name, '?'), coalesce(l.sku_name, l.sku_code, l.jst_sku_id), l.product_id, l.brand_id, l.payment_method,
         case when l.channel = 'event' then abs(l.qty) else l.qty end,
         l.unit_price,
         case when l.channel = 'event' then abs(l.discount) else l.discount end,
         case when l.channel = 'event' then abs(l.amount) else l.amount end
  from legacy_sales_lines l left join branches b on b.id = l.branch_id
  where l.sale_date between p_from and p_to
    and (p_branches is null or l.branch_id = any (p_branches))
    and not (coalesce(l.amount, 0) = 0 and l.sku_code is null and l.jst_sku_id is null)
    and (b.pos_go_live_date is null or l.sale_date < b.pos_go_live_date)
$$;

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
    'bills', coalesce((select json_agg(json_build_array(br, sale_date, bill_no, case when ret then 1 else 0 end, case when ev then 1 else 0 end, items) order by sale_date desc, bill_no) from bl), '[]')
  )
$$;

-- ช่วงก่อนหน้า (เทียบ %): รวมรายสาขา/วัน/ช่องทาง
create or replace function legacy_sales_daily(p_from date, p_to date, p_branches uuid[] default null)
returns json language sql stable set search_path = public as $$
  select coalesce(json_agg(json_build_array(br, sale_date, ev, bills, amt)), '[]') from (
    select coalesce(branch_id::text, 'lark:' || coalesce(place_key, 'unknown')) br, sale_date, case when ev then 1 else 0 end ev,
           count(distinct place_key || '|' || bill_no) bills, sum(amount) amt
    from legacy_lines_norm(p_from, p_to, p_branches) where not ret group by 1, 2, 3) d
$$;

revoke all on function legacy_lines_norm(date, date, uuid[]) from public, anon, authenticated;
revoke all on function legacy_sales_compact(date, date, uuid[]) from public, anon, authenticated;
revoke all on function legacy_sales_daily(date, date, uuid[]) from public, anon, authenticated;
grant execute on function legacy_lines_norm(date, date, uuid[]) to service_role;
grant execute on function legacy_sales_compact(date, date, uuid[]) to service_role;
grant execute on function legacy_sales_daily(date, date, uuid[]) to service_role;
