-- 0092 สรุปรายเดือน (หน้ายอดขายระบบเดิม) นับบิลแบบเดียวกับหน้ายอดขาย: ร้าน + วัน + เลขบิล · ไม่นับบิลที่มีแต่บรรทัดว่าง
--   (เดิมนับเลขบิลไม่ซ้ำทั้งเดือน + รวมบรรทัดว่าง → ตัวเลขต่างจากหน้ายอดขาย)
drop view if exists legacy_sales_monthly;
create view legacy_sales_monthly as
with l as (
  select l.*, not (coalesce(l.amount, 0) = 0 and l.sku_code is null and l.jst_sku_id is null) as real_line
  from legacy_sales_lines l
)
select to_char(sale_date, 'YYYY-MM') as ym,
       count(*) filter (where real_line)::int as lines,
       count(distinct (coalesce(place_key, ''), sale_date, coalesce(order_no, line_id))) filter (where real_line)::int as bills,
       coalesce(sum(case when channel = 'event' then abs(amount) else amount end)
                filter (where channel = 'event' or coalesce(status, 'normal') <> 'returned'), 0)::numeric(16,2) as amount,
       count(*) filter (where branch_id is null and real_line)::int as unmapped_lines,
       count(*) filter (where not real_line)::int as empty_lines,
       max(synced_at) as synced_at
from l group by 1;
revoke all on legacy_sales_monthly from anon, authenticated;
