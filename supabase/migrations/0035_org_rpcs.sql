-- =====================================================================
-- SHD POS — 0035_org_rpcs.sql
-- RPC สำหรับผังองค์กร (เรียกผ่าน anon client เหมือน POS — ใช้ได้ทั้ง SSO/PIN)
-- =====================================================================

create or replace function public.pos_org_positions(p_branch_id uuid)
returns setof json language sql security definer set search_path = public as $$
  select to_json(x) from (
    select id, employee_id, title, reports_to, sort_order
    from org_positions where branch_id = p_branch_id
  ) x;
$$;
revoke all on function public.pos_org_positions(uuid) from public;
grant execute on function public.pos_org_positions(uuid) to anon, authenticated;

create or replace function public.pos_org_upsert(
  p_branch_id uuid, p_employee_id uuid, p_title text, p_reports_to uuid, p_sort_order int
) returns void language sql security definer set search_path = public as $$
  insert into org_positions (branch_id, employee_id, title, reports_to, sort_order, updated_at)
  values (
    p_branch_id, p_employee_id, coalesce(p_title, ''),
    case when p_reports_to = p_employee_id then null else p_reports_to end,
    coalesce(p_sort_order, 0), now()
  )
  on conflict (branch_id, employee_id) do update
    set title = excluded.title, reports_to = excluded.reports_to,
        sort_order = excluded.sort_order, updated_at = now();
$$;
revoke all on function public.pos_org_upsert(uuid, uuid, text, uuid, int) from public;
grant execute on function public.pos_org_upsert(uuid, uuid, text, uuid, int) to anon, authenticated;

create or replace function public.pos_org_delete(p_branch_id uuid, p_employee_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from org_positions where branch_id = p_branch_id and employee_id = p_employee_id;
$$;
revoke all on function public.pos_org_delete(uuid, uuid) from public;
grant execute on function public.pos_org_delete(uuid, uuid) to anon, authenticated;
