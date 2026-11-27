-- 0089 ยอดอีเวนต์ระบบเดิมบันทึกเป็นค่าติดลบ (status returned) → สรุปรายเดือนใช้ค่าสัมบูรณ์สำหรับอีเวนต์
create or replace view legacy_sales_monthly as
select to_char(sale_date, 'YYYY-MM') as ym, count(*)::int as lines,
       count(distinct coalesce(order_no, line_id))::int as bills,
       coalesce(sum(case when channel = 'event' then abs(amount) else amount end)
                filter (where channel = 'event' or coalesce(status, 'normal') <> 'returned'), 0)::numeric(16,2) as amount,
       count(*) filter (where branch_id is null)::int as unmapped_lines,
       max(synced_at) as synced_at
from legacy_sales_lines group by 1;
revoke all on legacy_sales_monthly from anon, authenticated;
