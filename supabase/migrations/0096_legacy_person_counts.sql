-- 0096 นับจำนวนบรรทัด/วันขายล่าสุดของชื่อพนักงานขาย (ทุกเดือน) หลังดึงข้อมูล
create or replace function legacy_refresh_person_counts() returns void language sql set search_path = public as $$
  update dv_salesperson_map m set lines = s.n, last_sale = s.last
  from (select legacy_person_key(salesperson_name) k, count(*)::int n, max(sale_date) last from legacy_sales_lines where salesperson_name is not null group by 1) s
  where s.k = m.name_key and (m.lines is distinct from s.n or m.last_sale is distinct from s.last);
$$;
revoke all on function legacy_refresh_person_counts() from public, anon, authenticated;
grant execute on function legacy_refresh_person_counts() to service_role;
