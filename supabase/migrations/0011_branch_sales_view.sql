-- =====================================================================
-- 0011 — VIEW ยอดขายรายสาขา "วันนี้" (เขต Asia/Bangkok) สำหรับแผนที่ realtime
--   * เป็น aggregate อย่างเดียว (ไม่เปิดข้อมูลบิลดิบให้ anon)
--   * client (anon) poll view นี้เพื่ออัปเดตแผนที่แบบสด
-- =====================================================================
create or replace view public.pos_branch_sales_today as
  select
    b.id as branch_id,
    coalesce(sum(o.grand_total) filter (where o.status <> 'voided'), 0)::numeric as sales,
    count(o.id) filter (where o.status <> 'voided')::int as orders,
    max(o.created_at) as last_sale_at
  from branches b
  left join orders o
    on o.branch_id = b.id
   and (o.created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
  group by b.id;

grant select on public.pos_branch_sales_today to anon, authenticated;
