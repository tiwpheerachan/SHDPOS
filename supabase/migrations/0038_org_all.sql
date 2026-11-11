-- =====================================================================
-- SHD POS — 0038_org_all.sql
-- RPC ดึงตำแหน่งในผังทั้งหมด (ข้ามสาขา) สำหรับ dashboard เทียบตามตำแหน่ง
-- =====================================================================
create or replace function public.pos_org_all()
returns setof json language sql security definer set search_path = public as $$
  select to_json(x) from (
    select branch_id, employee_id, title, reports_to from org_positions
  ) x;
$$;
revoke all on function public.pos_org_all() from public;
grant execute on function public.pos_org_all() to anon, authenticated;
