-- =====================================================================
-- SHD POS — 0016_pin_login_companywide.sql
-- แก้ pos_login_by_pin: หาคนด้วย PIN "ทั่วทั้งบริษัท" (ไม่กรองด้วยสาขา)
--   เดิมกรองด้วยสาขา → คนที่ data_scope=branch แต่ไม่ได้ผูกสาขา หาไม่เจอทุกสาขา (ล็อกเอาต์)
--   ตอนนี้: ใครมี PIN ตรง + active ก็เจอ, สาขาที่เลือก = ที่ทำงานตอนนั้น
--   (ยังคืนได้หลายคนถ้า PIN ซ้ำ → ฝั่ง client ให้เลือกชื่อ)
-- =====================================================================
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
      e.max_discount_percent, e.can_open_drawer, e.status::text as status, e.photo_url
    from employees e
    where e.status = 'active'
      and e.pin_hash is not null
      and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
    order by e.first_name
  ) x;
$$;

revoke all on function public.pos_login_by_pin(uuid, text) from public;
grant execute on function public.pos_login_by_pin(uuid, text) to anon, authenticated;
