-- =====================================================================
-- 0048 — ให้ยอดเรียลไทม์รายสาขาใช้นิยามยอดขายกลางเดียวกับทุกหน้า (web/src/lib/sales-basis.ts)
--   เดิม: นับทุกบิลที่ไม่ใช่ voided (รวม draft + refunded คืนเต็ม) ตามวัน created_at
--   ใหม่: นับเฉพาะ completed / partially_refunded · วันตามเวลาขายจริง coalesce(sale_occurred_at, created_at) เวลาไทย
--   คอลัมน์ผลลัพธ์เท่าเดิม (branch_id, sales, orders, last_sale_at) → หน้าแดชบอร์ดไม่ต้องแก้
-- =====================================================================
create or replace view public.pos_branch_sales_today as
  select
    b.id as branch_id,
    coalesce(sum(o.grand_total), 0)::numeric as sales,
    count(o.id)::int as orders,
    max(coalesce(o.sale_occurred_at, o.created_at)) as last_sale_at
  from branches b
  left join orders o
    on o.branch_id = b.id
   and o.status in ('completed', 'partially_refunded')
   and (coalesce(o.sale_occurred_at, o.created_at) at time zone 'Asia/Bangkok')::date
       = (now() at time zone 'Asia/Bangkok')::date
  group by b.id;
