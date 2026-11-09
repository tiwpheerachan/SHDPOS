-- =====================================================================
-- SHD POS — 0033_owner_role_login_noscope.sql
-- 1) เพิ่ม role 'owner' (เจ้าของกิจการ) — สิทธิ์เต็ม เห็นทุกแบรนด์ทุกสาขา
-- 2) ให้ view pos_employees + RPC pos_login_by_pin คืน branch_ids / brand_ids
--    (เดิมไม่คืน → คนที่คุมหลายสาขาเห็นแค่สาขาหลักตอนสลับสาขา)
-- หมายเหตุ: การเพิ่มค่า enum ต้อง commit ก่อนใช้ค่า 'owner' ในคำสั่งอื่น
--           จึงแยกเป็น 2 migration (ไฟล์นี้ = ส่วนที่ 2) และรัน
--           `alter type employee_role add value 'owner'` แยกก่อน
-- =====================================================================

-- ---- employees view: เพิ่ม branch_ids / brand_ids (รวมจาก mapping) ----
create or replace view pos_employees as
  select
    e.id, e.employee_code, e.first_name, e.last_name, e.nickname,
    e.role, e.data_scope, e.home_branch_id,
    e.max_discount_percent, e.can_open_drawer, e.status, e.photo_url,
    coalesce(
      (select array_agg(eb.branch_id) from employee_branches eb where eb.employee_id = e.id),
      '{}'
    ) as branch_ids,
    coalesce(
      (select array_agg(ebr.brand_id) from employee_brands ebr where ebr.employee_id = e.id),
      '{}'
    ) as brand_ids
  from employees e;

grant select on pos_employees to anon, authenticated;

-- ---- login by PIN: คืน branch_ids / brand_ids ด้วย ----
create or replace function public.pos_login_by_pin(p_branch_id uuid, p_pin text)
returns setof json
language sql
security definer
set search_path = public, extensions
as $$
  select to_json(x) from (
    select
      e.id, e.employee_code, e.first_name, e.last_name, e.nickname,
      e.role::text as role, e.data_scope::text as data_scope, e.home_branch_id,
      e.max_discount_percent, e.can_open_drawer, e.status::text as status, e.photo_url,
      coalesce(
        (select array_agg(eb.branch_id) from employee_branches eb where eb.employee_id = e.id),
        '{}'
      ) as branch_ids,
      coalesce(
        (select array_agg(ebr.brand_id) from employee_brands ebr where ebr.employee_id = e.id),
        '{}'
      ) as brand_ids
    from employees e
    where e.status = 'active'
      and e.pin_hash is not null
      and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
    order by e.first_name
  ) x;
$$;

revoke all on function public.pos_login_by_pin(uuid, text) from public;
grant execute on function public.pos_login_by_pin(uuid, text) to anon, authenticated;

-- ---- role_permissions: owner = สิทธิ์เต็ม (มิเรอร์จาก hq ถ้ามี) ----
insert into role_permissions (role, permission, effect, limit_value)
  select 'owner'::employee_role, permission, effect, limit_value
  from role_permissions where role = 'hq'
on conflict (role, permission) do nothing;
