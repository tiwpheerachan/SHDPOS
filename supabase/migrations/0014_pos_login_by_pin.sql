-- =====================================================================
-- SHD POS — 0014_pos_login_by_pin.sql
-- เข้าสู่ระบบด้วย PIN อย่างเดียว: หาพนักงานในสาขาที่ PIN ตรง (bcrypt)
--   * คืนได้ 0 / 1 / หลายคน (ถ้า PIN ซ้ำ) — ฝั่ง client ให้เลือกชื่อเมื่อซ้ำ
--   * รวมพนักงานสาขานั้น + คนที่ data_scope company/brand (เข้าได้ทุกสาขา)
--   * SECURITY DEFINER, คืนเฉพาะ profile ปลอดภัย (ไม่มี pin_hash/phone/email)
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
      and (
        e.home_branch_id = p_branch_id
        or e.data_scope in ('company', 'brand')
        or exists (select 1 from employee_branches eb where eb.employee_id = e.id and eb.branch_id = p_branch_id)
      )
    order by e.first_name
  ) x;
$$;

revoke all on function public.pos_login_by_pin(uuid, text) from public;
grant execute on function public.pos_login_by_pin(uuid, text) to anon, authenticated;
