-- =====================================================================
-- SHD POS — 0020_merge_customers.sql
-- รวมลูกค้าซ้ำเป็นคนเดียว (merge) — เรียกจากหลังบ้านโดยแอดมินเท่านั้น
--   • ย้าย orders / quotations / serials / loyalty_ledger จาก losers → primary
--   • รวมแต้ม + เครดิต เข้า primary, เติมข้อมูลช่องที่ว่างจาก losers
--   • ลบ losers (ย้าย FK หมดแล้วจึงลบได้ และปลด member_code ซ้ำ)
--   • บันทึก ledger 'adjust' บอกว่ารวมมาจากกี่ราย
-- =====================================================================
create or replace function admin_merge_customers(p_primary uuid, p_losers uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone    text; v_email   text; v_line  text; v_birth date;
  v_taxid    text; v_taxname text; v_taxaddr text; v_member text; v_note text;
  v_add_pts  int;  v_add_cr  numeric; v_cnt int;
  v_row      customers%rowtype;
begin
  if p_primary is null or p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'primary and losers required';
  end if;
  if p_primary = any(p_losers) then
    raise exception 'primary cannot be in losers';
  end if;
  perform 1 from customers where id = p_primary;
  if not found then raise exception 'primary not found'; end if;

  -- 1) ย้ายการอ้างอิงทั้งหมดไป primary
  update orders         set customer_id = p_primary where customer_id = any(p_losers);
  update quotations     set customer_id = p_primary where customer_id = any(p_losers);
  update serials        set customer_id = p_primary where customer_id = any(p_losers);
  update loyalty_ledger set customer_id = p_primary where customer_id = any(p_losers);

  -- 2) รวมยอด + เลือกค่าช่องที่จะเติม (จาก losers)
  select coalesce(sum(points), 0), coalesce(sum(store_credit), 0), count(*)
    into v_add_pts, v_add_cr, v_cnt
    from customers where id = any(p_losers);

  select max(phone), max(email), max(line_id), max(birth_date), max(tax_id),
         max(tax_name), max(tax_address), max(member_code), max(note)
    into v_phone, v_email, v_line, v_birth, v_taxid, v_taxname, v_taxaddr, v_member, v_note
    from customers where id = any(p_losers);

  -- 3) ลบ losers ก่อน (ปลด member_code ซ้ำ; FK ย้ายไปหมดแล้ว)
  delete from customers where id = any(p_losers);

  -- 4) อัปเดต primary: บวกยอด + เติมช่องที่ว่าง
  update customers c set
    points       = c.points + v_add_pts,
    store_credit = c.store_credit + v_add_cr,
    phone        = coalesce(c.phone, v_phone),
    email        = coalesce(c.email, v_email),
    line_id      = coalesce(c.line_id, v_line),
    birth_date   = coalesce(c.birth_date, v_birth),
    tax_id       = coalesce(c.tax_id, v_taxid),
    tax_name     = coalesce(c.tax_name, v_taxname),
    tax_address  = coalesce(c.tax_address, v_taxaddr),
    member_code  = coalesce(c.member_code, v_member),
    note         = coalesce(c.note, v_note),
    updated_at   = now()
    where c.id = p_primary
    returning * into v_row;

  -- 5) บันทึกประวัติการรวม
  insert into loyalty_ledger(customer_id, kind, points_delta, credit_delta, balance_points, balance_credit, note)
    values (p_primary, 'adjust', v_add_pts, v_add_cr, v_row.points, v_row.store_credit,
            'รวมจากลูกค้าซ้ำ ' || v_cnt || ' ราย');

  return to_json(v_row);
end;
$$;

revoke all on function admin_merge_customers(uuid, uuid[]) from public;
grant execute on function admin_merge_customers(uuid, uuid[]) to service_role, authenticated;
