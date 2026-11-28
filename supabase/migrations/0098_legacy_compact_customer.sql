-- 0098 บิลระบบเดิมส่งลูกค้าด้วย (ตำแหน่ง 10–12: customer_id, ชื่อ, เบอร์) — หน้ายอดขายแสดงลูกค้า/สมาชิก + เปิดประวัติลูกค้าได้
drop function if exists legacy_sales_compact(date, date, uuid[]);
drop function if exists legacy_sales_daily(date, date, uuid[]);
drop function if exists legacy_lines_norm(date, date, uuid[]);

create function legacy_lines_norm(p_from date, p_to date, p_branches uuid[])
returns table (line_id text, place_key text, place_name text, branch_id uuid, sale_date date, bill_no text, ret boolean, ev boolean,
               sku_key text, sku_name text, product_id uuid, brand_id uuid, pay text, qty numeric, unit_price numeric, discount numeric, amount numeric,
               person_key text, person_name text, sale_type text, order_source text, payment_bank text, edc_bank text,
               customer_id uuid, customer_name text, customer_phone text)
language sql stable set search_path = public as $$
  select l.line_id, l.place_key, l.place_name, l.branch_id, l.sale_date, coalesce(l.order_no, l.line_id),
         (l.channel <> 'event' and l.status = 'returned'), l.channel = 'event',
         coalesce(l.jst_sku_id, l.sku_code, l.sku_name, '?'), coalesce(l.sku_name, l.sku_code, l.jst_sku_id), l.product_id, l.brand_id, l.payment_method,
         case when l.channel = 'event' then abs(l.qty) else l.qty end,
         l.unit_price,
         case when l.channel = 'event' then abs(l.discount) else l.discount end,
         case when l.channel = 'event' then abs(l.amount) else l.amount end,
         legacy_person_key(l.salesperson_name), btrim(l.salesperson_name), l.sale_type, l.order_source, l.payment_bank, l.edc_bank,
         l.customer_id, l.customer_name, l.customer_phone
  from legacy_sales_lines l left join branches b on b.id = l.branch_id
  where l.sale_date between p_from and p_to
    and (p_branches is null or l.branch_id = any (p_branches))
    and not (coalesce(l.amount, 0) = 0 and l.sku_code is null and l.jst_sku_id is null)
    and (b.pos_go_live_date is null or l.sale_date < b.pos_go_live_date)
$$;

-- รูปแบบ: skus/pays/places เหมือนเดิม + persons:[[key, ชื่อ, employee_id|null]] + stypes:[text]
--   bills:[[branch, date, bill, ret, ev, [[sku_i,qty,unit,disc,amount,pay_i,person_i|-1,stype_i|-1],…], place_key, order_source, edc_bank, payment_bank]]
create function legacy_sales_compact(p_from date, p_to date, p_branches uuid[] default null)
returns json language sql stable set search_path = public as $$
  with n as (select * from legacy_lines_norm(p_from, p_to, p_branches)),
  sk as (select sku_key, min(sku_name) nm, min(product_id::text) pid, min(brand_id::text) bid, row_number() over (order by sku_key) - 1 i from n group by sku_key),
  py as (select pay, row_number() over (order by pay) - 1 i from (select distinct coalesce(pay, '') pay from n) x),
  pe as (select n.person_key, coalesce(m.sample_name, min(n.person_name)) nm, m.employee_id::text eid, row_number() over (order by n.person_key) - 1 i
         from n left join dv_salesperson_map m on m.name_key = n.person_key where n.person_key is not null group by n.person_key, m.sample_name, m.employee_id),
  st as (select sale_type, row_number() over (order by sale_type) - 1 i from (select distinct sale_type from n where sale_type is not null) x),
  li as (
    select n.*, sk.i si, py.i pi, coalesce(pe.i, -1) pei, coalesce(st.i, -1) sti
    from n join sk using (sku_key) join py on py.pay = coalesce(n.pay, '')
    left join pe on pe.person_key = n.person_key left join st on st.sale_type = n.sale_type
  ),
  bl as (
    select coalesce(branch_id::text, 'lark:' || coalesce(place_key, 'unknown')) br, sale_date, bill_no, ret, bool_or(ev) ev, place_key,
           json_agg(json_build_array(si, qty, unit_price, discount, amount, pi, pei, sti) order by line_id) items,
           min(order_source) osrc, min(edc_bank) edc, min(payment_bank) pbank,
           min(customer_id::text) cid, min(customer_name) cname, min(customer_phone) cphone
    from li group by coalesce(branch_id::text, 'lark:' || coalesce(place_key, 'unknown')), place_key, sale_date, bill_no, ret
  )
  select json_build_object(
    'skus', coalesce((select json_agg(json_build_array(sku_key, nm, pid, bid) order by i) from sk), '[]'),
    'pays', coalesce((select json_agg(pay order by i) from py), '[]'),
    'persons', coalesce((select json_agg(json_build_array(person_key, nm, eid) order by i) from pe), '[]'),
    'stypes', coalesce((select json_agg(sale_type order by i) from st), '[]'),
    'places', coalesce((select json_object_agg(place_key, json_build_array(nm, ev)) from (select place_key, min(place_name) nm, bool_or(ev) ev from n where branch_id is null and place_key is not null group by place_key) p), '{}'),
    'bills', coalesce((select json_agg(json_build_array(br, sale_date, bill_no, case when ret then 1 else 0 end, case when ev then 1 else 0 end, items, coalesce(place_key, 'unknown'), osrc, edc, pbank, cid, cname, cphone) order by sale_date desc, bill_no) from bl), '[]')
  )
$$;

create function legacy_sales_daily(p_from date, p_to date, p_branches uuid[] default null)
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
