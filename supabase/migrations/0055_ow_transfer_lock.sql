-- =====================================================================
-- 0055 — ล็อกรายใบโอน OW (กันสองเครื่องสั่งงานใบเดียวกันพร้อมกัน)
--   ปัญหา: สองเครื่องรับเข้าพร้อมกัน → ทั้งคู่ยิง OW สำเร็จ แต่ POS บันทึกได้เครื่องเดียว (อีกเครื่องชน revision)
--          → ยอด POS ตามหลัง OW · ล็อกให้ทำทีละคำสั่ง และหยุดเครื่องที่สอง "ก่อน" ยิง OW
--   ใช้เวลาของฐานข้อมูล (ไม่พึ่งนาฬิกาเครื่อง) · หมดอายุเองถ้าคำสั่งค้าง/เซิร์ฟเวอร์ล่ม
-- =====================================================================
alter table pos_ow_transfers add column if not exists lock_token uuid, add column if not exists lock_until timestamptz;

create or replace function pos_ow_transfer_lock(p_source text, p_id uuid, p_token uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update pos_ow_transfers set lock_token = p_token, lock_until = now() + make_interval(secs => least(greatest(p_seconds, 5), 600))
   where source = p_source and pos_transfer_id = p_id and (lock_until is null or lock_until < now() or lock_token = p_token);
  return found;
end $$;

create or replace function pos_ow_transfer_unlock(p_source text, p_id uuid, p_token uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update pos_ow_transfers set lock_token = null, lock_until = null where source = p_source and pos_transfer_id = p_id and lock_token = p_token;
$$;

revoke all on function pos_ow_transfer_lock(text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function pos_ow_transfer_unlock(text, uuid, uuid) from public, anon, authenticated;
