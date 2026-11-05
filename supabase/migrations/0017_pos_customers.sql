-- =====================================================================
-- SHD POS — 0017_pos_customers.sql
-- ค้นหา/สร้างลูกค้าจากหน้าขาย (POS) ผ่าน SECURITY DEFINER RPC
--   รูปแบบเดียวกับ create_order / pos_login_by_pin — anon เรียกได้
--   ลูกค้าเป็นข้อมูลระดับบริษัท (เดินเข้าสาขาไหนก็เจอ)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ค้นหาลูกค้า: ชื่อ / เบอร์โทร / รหัสสมาชิก  (คืนสูงสุด 20 ราย)
-- ---------------------------------------------------------------------
create or replace function public.pos_customer_search(p_q text)
returns setof json
language sql
security definer
set search_path = public, extensions
as $$
  with term as (select btrim(coalesce(p_q, '')) as q)
  select to_json(x) from (
    select
      c.id, c.member_code, c.name, c.phone, c.email,
      c.tax_id, c.tax_name, c.tax_address,
      c.points, c.store_credit, c.tier, c.note
    from customers c, term
    where term.q <> ''
      and (
        c.name ilike '%' || term.q || '%'
        or coalesce(c.phone, '')       ilike '%' || term.q || '%'
        or coalesce(c.member_code, '') ilike '%' || term.q || '%'
        or coalesce(c.email, '')       ilike '%' || term.q || '%'
      )
    order by
      -- เบอร์/ชื่อที่ "ขึ้นต้น" ด้วยคำค้น มาก่อน
      (case when c.phone ilike term.q || '%' or c.name ilike term.q || '%' then 0 else 1 end),
      c.name
    limit 20
  ) x;
$$;

revoke all on function public.pos_customer_search(text) from public;
grant execute on function public.pos_customer_search(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- สร้าง/แก้ไขลูกค้า — idempotent ด้วย id ที่ client ส่งมา (รองรับออฟไลน์)
--   payload: { id?, name, phone?, email?, tax_id?, tax_name?, tax_address?,
--              source?, first_branch_id?, note? }
--   คืนแถวลูกค้าเป็น json
-- ---------------------------------------------------------------------
create or replace function public.pos_customer_upsert(p_payload json)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    uuid := nullif(p_payload->>'id', '')::uuid;
  v_name  text := btrim(coalesce(p_payload->>'name', ''));
  v_row   customers%rowtype;
begin
  if v_name = '' then
    raise exception 'name required';
  end if;

  if v_id is not null then
    -- มี id → upsert (แก้ถ้ามีอยู่, สร้างถ้ายังไม่มี)
    insert into customers (id, name, phone, email, tax_id, tax_name, tax_address,
                           source, first_branch_id, note)
    values (
      v_id, v_name,
      nullif(p_payload->>'phone', ''),
      nullif(p_payload->>'email', ''),
      nullif(p_payload->>'tax_id', ''),
      nullif(p_payload->>'tax_name', ''),
      nullif(p_payload->>'tax_address', ''),
      nullif(p_payload->>'source', ''),
      nullif(p_payload->>'first_branch_id', '')::uuid,
      nullif(p_payload->>'note', '')
    )
    on conflict (id) do update set
      name        = excluded.name,
      phone       = coalesce(excluded.phone, customers.phone),
      email       = coalesce(excluded.email, customers.email),
      tax_id      = coalesce(excluded.tax_id, customers.tax_id),
      tax_name    = coalesce(excluded.tax_name, customers.tax_name),
      tax_address = coalesce(excluded.tax_address, customers.tax_address),
      note        = coalesce(excluded.note, customers.note),
      updated_at  = now()
    returning * into v_row;
  else
    insert into customers (name, phone, email, tax_id, tax_name, tax_address,
                           source, first_branch_id, note)
    values (
      v_name,
      nullif(p_payload->>'phone', ''),
      nullif(p_payload->>'email', ''),
      nullif(p_payload->>'tax_id', ''),
      nullif(p_payload->>'tax_name', ''),
      nullif(p_payload->>'tax_address', ''),
      nullif(p_payload->>'source', ''),
      nullif(p_payload->>'first_branch_id', '')::uuid,
      nullif(p_payload->>'note', '')
    )
    returning * into v_row;
  end if;

  return to_json(v_row);
end;
$$;

revoke all on function public.pos_customer_upsert(json) from public;
grant execute on function public.pos_customer_upsert(json) to anon, authenticated;
