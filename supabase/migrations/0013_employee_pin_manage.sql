-- =====================================================================
-- SHD POS — 0013_employee_pin_manage.sql
-- จัดการ PIN พนักงานต่อสาขา (ตั้ง/ดู) ตามที่เจ้าของระบบเลือก "เก็บ PIN แบบดูได้"
-- ความปลอดภัย: pin_plain เก็บเลขจริง แต่ไม่อยู่ใน view pos_employees (anon เห็นไม่ได้)
--   เข้าถึงได้เฉพาะ service role ฝั่งเซิร์ฟเวอร์ ผ่าน API ที่ล็อกแอดมินเท่านั้น
-- =====================================================================

alter table employees add column if not exists pin_plain text;

-- backfill: ทุกคนตอนนี้ PIN = 1234 (จาก 0009) จึงเซ็ตค่าที่ดูได้ให้ตรงกัน
update employees set pin_plain = '1234' where pin_plain is null;

-- ตั้ง PIN ใหม่ (อัปเดตทั้งเลขที่ดูได้ + hash สำหรับ pos_login) — service role เท่านั้น
create or replace function public.admin_set_employee_pin(p_id uuid, p_pin text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update employees
     set pin_plain  = p_pin,
         pin_hash   = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_set_at = now()
   where id = p_id;
$$;

revoke all on function public.admin_set_employee_pin(uuid, text) from public;
grant execute on function public.admin_set_employee_pin(uuid, text) to service_role;
