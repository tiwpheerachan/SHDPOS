-- =====================================================================
-- 0009 — pos_login: ตรวจ PIN ฝั่ง server ด้วย bcrypt (pgcrypto)
--   * ตั้ง pin_hash ให้พนักงานที่ยังไม่มี (โหมดสาธิต PIN = 1234)
--   * RPC SECURITY DEFINER: client (anon) เรียกได้ แต่ pin_hash ไม่หลุด
--   * คืนเฉพาะ profile ที่ปลอดภัย (ไม่มี pin_hash/phone/email)
-- =====================================================================

-- ตั้ง PIN เริ่มต้น 1234 (bcrypt) ให้คนที่ยังไม่มีรหัส
update employees
set pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')), pin_set_at = now()
where pin_hash is null;

create or replace function public.pos_login(p_code text, p_pin text)
returns json
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
    where e.employee_code = p_code
      and e.status = 'active'
      and e.pin_hash is not null
      and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
    limit 1
  ) x;
$$;

revoke all on function public.pos_login(text, text) from public;
grant execute on function public.pos_login(text, text) to anon, authenticated;
