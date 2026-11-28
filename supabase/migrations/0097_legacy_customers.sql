-- 0097 ลูกค้าจากระบบเดิม (Lark ผ่าน Dataverse scope commerce.offline_sales.pii — รออนุมัติ)
--   เก็บชื่อ/เบอร์/อีเมลในบรรทัดยอดขาย → สร้าง/รวมลูกค้าด้วยเบอร์โทร (ไม่มีเบอร์ใช้อีเมล) → ผูก customer_id
--   ประวัติการซื้อลูกค้า = บิล POS + บิล Lark · แบรนด์ที่เคยซื้อมาจากสินค้า/สาขาจริง
alter table legacy_sales_lines
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text,
  add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists legacy_sales_lines_customer_idx on legacy_sales_lines (customer_id) where customer_id is not null;

-- เบอร์โทรมาตรฐาน: เฉพาะตัวเลข · +66/66xxxxxxxxx → 0xxxxxxxxx · สั้นกว่า 9 หลัก = ใช้ไม่ได้
create or replace function pos_phone_norm(p text) returns text language sql immutable as $$
  select case
    when d is null or length(d) < 9 then null
    when d like '66%' and length(d) = 11 then '0' || substr(d, 3)
    else d end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') d) x
$$;
create index if not exists customers_phone_norm_idx on customers (pos_phone_norm(phone));
create index if not exists customers_email_lower_idx on customers (lower(email));

-- สร้าง/ผูกลูกค้าของบรรทัดในช่วงวันที่ (ทำซ้ำได้ ไม่สร้างซ้ำ)
create or replace function legacy_link_customers(p_from date, p_to date) returns json
language plpgsql security definer set search_path = public as $$
declare v_new int := 0; v_linked int := 0;
begin
  -- 1) คีย์ลูกค้าต่อบรรทัด (เรียกซ้ำใน transaction เดียวได้)
  drop table if exists _lc;
  create temp table _lc on commit drop as
    select l.line_id, l.sale_date, l.branch_id,
           pos_phone_norm(l.customer_phone) ph,
           nullif(lower(btrim(l.customer_email)), '') em,
           nullif(btrim(l.customer_name), '') nm, l.customer_phone raw_phone, l.customer_email raw_email
    from legacy_sales_lines l
    where l.sale_date between p_from and p_to and (l.customer_phone is not null or l.customer_email is not null);

  -- 2) ลูกค้าใหม่ (ยังไม่มีเบอร์/อีเมลนี้ในระบบ) — ชื่อล่าสุดที่พิมพ์ · สาขาแรกที่ซื้อ
  with keys as (
    select coalesce(ph, 'em:' || em) k, ph, em,
           (array_agg(nm order by sale_date desc) filter (where nm is not null))[1] nm,
           (array_agg(raw_phone order by sale_date desc) filter (where ph is not null))[1] phone,
           (array_agg(raw_email order by sale_date desc) filter (where em is not null))[1] email,
           (array_agg(branch_id order by sale_date) filter (where branch_id is not null))[1] first_branch
    from _lc where ph is not null or em is not null group by 1, 2, 3
  ), fresh as (
    select k.* from keys k
    where not exists (select 1 from customers c where (k.ph is not null and pos_phone_norm(c.phone) = k.ph) or (k.ph is null and k.em is not null and lower(c.email) = k.em))
  ), ins as (
    insert into customers (name, phone, email, source, first_branch_id, note)
    select coalesce(nm, 'ลูกค้า Lark'), case when ph is not null then ph end, email, 'lark', first_branch, 'นำเข้าจากระบบเดิม (Lark)' from fresh
    returning id
  ) select count(*) into v_new from ins;

  -- 3) ผูกบรรทัด → ลูกค้า (เบอร์ก่อน แล้วอีเมล) · เลือกลูกค้าที่สร้างก่อนถ้ามีซ้ำ
  with m as (
    select lc.line_id, coalesce(
      (select c.id from customers c where lc.ph is not null and pos_phone_norm(c.phone) = lc.ph order by c.created_at limit 1),
      (select c.id from customers c where lc.em is not null and lower(c.email) = lc.em order by c.created_at limit 1)) cid
    from _lc lc
  ), upd as (
    update legacy_sales_lines l set customer_id = m.cid from m
    where l.line_id = m.line_id and m.cid is not null and l.customer_id is distinct from m.cid
    returning 1
  ) select count(*) into v_linked from upd;

  drop table if exists _lc;
  return json_build_object('new_customers', v_new, 'linked_lines', v_linked);
end $$;

-- ประวัติบิล Lark ของลูกค้า (หน้าโปรไฟล์ลูกค้า) — รวมเป็นบิลตาม ร้าน+วัน+เลขบิล · อีเวนต์ใช้ค่าบวก
create or replace function legacy_customer_bills(p_customer uuid) returns json language sql stable set search_path = public as $$
  select coalesce(json_agg(b order by b.sale_date desc), '[]') from (
    select l.place_key, l.sale_date, coalesce(l.order_no, l.line_id) bill_no, min(l.branch_id::text) branch_id, min(l.place_name) place_name, bool_or(l.channel = 'event') ev,
           bool_or(l.channel <> 'event' and l.status = 'returned') ret,
           sum(case when l.channel = 'event' then abs(l.amount) else l.amount end) total,
           json_agg(json_build_object('sku', coalesce(l.jst_sku_id, l.sku_code), 'name', coalesce(l.sku_name, l.sku_code, l.jst_sku_id),
             'qty', case when l.channel = 'event' then abs(l.qty) else l.qty end, 'line_total', case when l.channel = 'event' then abs(l.amount) else l.amount end,
             'brand_id', l.brand_id, 'product_id', l.product_id) order by l.line_id) items
    from legacy_sales_lines l where l.customer_id = p_customer
    group by l.place_key, l.sale_date, coalesce(l.order_no, l.line_id)
  ) b
$$;

-- สรุปต่อคน (หน้ารายชื่อ): จำนวนบิล/ยอด/ครั้งแรก/ล่าสุด/แบรนด์ที่เคยซื้อ
create or replace function legacy_customer_stats(p_ids uuid[]) returns json language sql stable set search_path = public as $$
  select coalesce(json_object_agg(customer_id, json_build_object('count', bills, 'spend', spend, 'first', first, 'last', last, 'brand_ids', brand_ids, 'branch_ids', branch_ids)), '{}') from (
    select customer_id, count(distinct coalesce(place_key, '') || '|' || sale_date || '|' || coalesce(order_no, line_id)) bills,
           sum(case when channel = 'event' then abs(amount) else amount end) spend, min(sale_date) first, max(sale_date) last,
           array_remove(array_agg(distinct brand_id), null) brand_ids, array_remove(array_agg(distinct branch_id), null) branch_ids
    from legacy_sales_lines where customer_id = any (p_ids) and not (channel <> 'event' and status = 'returned') group by customer_id
  ) s
$$;

revoke all on function legacy_link_customers(date, date) from public, anon, authenticated;
revoke all on function legacy_customer_bills(uuid) from public, anon, authenticated;
revoke all on function legacy_customer_stats(uuid[]) from public, anon, authenticated;
grant execute on function legacy_link_customers(date, date) to service_role;
grant execute on function legacy_customer_bills(uuid) to service_role;
grant execute on function legacy_customer_stats(uuid[]) to service_role;
