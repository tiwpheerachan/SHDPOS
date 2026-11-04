-- =====================================================================
-- SHD POS — 0007_rls.sql
-- Row Level Security: บังคับขอบเขตข้อมูลที่ฝั่ง database
-- หลักการ: อย่าเชื่อ frontend — พนักงานสาขาต้องเห็นได้แค่สาขาตัวเอง
--          Brand Admin เห็นเฉพาะแบรนด์ตัวเอง, HQ เห็นทั้งหมด
-- =====================================================================

-- ---------------------------------------------------------------------
-- helper: ดึง employee ของ auth user ปัจจุบัน
-- ---------------------------------------------------------------------
create or replace function current_employee_id() returns uuid
language sql stable security definer as $$
  select id from employees where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_scope() returns data_scope
language sql stable security definer as $$
  select data_scope from employees where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_role_name() returns employee_role
language sql stable security definer as $$
  select role from employees where auth_user_id = auth.uid() limit 1;
$$;

-- สาขาที่มองเห็นได้
create or replace function visible_branch_ids() returns setof uuid
language plpgsql stable security definer as $$
declare v_emp uuid; v_scope data_scope;
begin
  select id, data_scope into v_emp, v_scope from employees where auth_user_id = auth.uid();
  if v_emp is null then return; end if;

  if v_scope = 'company' then
    return query select id from branches;
  elsif v_scope = 'brand' then
    return query
      select distinct b.id from branches b
      where b.brand_id in (select brand_id from employee_brands where employee_id = v_emp)
         or b.id in (select branch_id from branch_brands
                     where brand_id in (select brand_id from employee_brands where employee_id = v_emp));
  else
    -- own / branch → สาขาที่ถูก assign
    return query
      select branch_id from employee_branches where employee_id = v_emp
      union
      select home_branch_id from employees where id = v_emp and home_branch_id is not null;
  end if;
end $$;

create or replace function can_see_branch(p_branch_id uuid) returns boolean
language sql stable security definer as $$
  select p_branch_id in (select visible_branch_ids());
$$;

-- เห็นเฉพาะข้อมูลของตัวเอง (scope = 'own')
create or replace function can_see_employee_data(p_employee_id uuid) returns boolean
language sql stable security definer as $$
  select case
    when current_scope() = 'own' then p_employee_id = current_employee_id()
    else true
  end;
$$;

-- ---------------------------------------------------------------------
-- เปิด RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'brands','branches','branch_brands','terminals','employees','employee_branches',
    'employee_brands','employee_permissions','categories','products','product_barcodes',
    'product_prices','serials','stock_levels','stock_movements','transfers','transfer_items',
    'transfer_serials','transfer_events','stock_counts','stock_count_items','notifications',
    'customers','shifts','shift_members','cash_movements','quotations','quotation_items',
    'orders','order_items','order_item_serials','order_payments','returns','return_items',
    'approvals','audit_logs','tax_documents','settings','sync_batches','sync_conflicts'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ข้อมูล master: ทุกคนที่ login แล้วอ่านได้ (แก้ได้เฉพาะ hq/brand_admin)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['brands','categories','products','product_barcodes','product_prices','permissions'] loop
    execute format($f$
      drop policy if exists %1$s_read on %1$I;
      create policy %1$s_read on %1$I for select to authenticated using (true);
      drop policy if exists %1$s_write on %1$I;
      create policy %1$s_write on %1$I for all to authenticated
        using (current_role_name() in ('hq','brand_admin'))
        with check (current_role_name() in ('hq','brand_admin'));
    $f$, t);
  end loop;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- ตารางที่ scope ด้วย branch_id
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'branches','terminals','stock_levels','stock_movements','stock_counts',
    'notifications','shifts','cash_movements','quotations','orders','returns',
    'approvals','audit_logs','tax_documents'
  ] loop
    execute format($f$
      drop policy if exists %1$s_branch_read on %1$I;
      drop policy if exists %1$s_branch_write on %1$I;
    $f$, t);
  end loop;
end $$;

create policy branches_branch_read on branches for select to authenticated
  using (can_see_branch(id));

create policy terminals_branch_read on terminals for select to authenticated
  using (can_see_branch(branch_id));

create policy stock_levels_read on stock_levels for select to authenticated
  using (can_see_branch(branch_id));

create policy stock_movements_read on stock_movements for select to authenticated
  using (can_see_branch(branch_id));

create policy stock_counts_rw on stock_counts for all to authenticated
  using (can_see_branch(branch_id)) with check (can_see_branch(branch_id));

create policy notifications_read on notifications for select to authenticated
  using (branch_id is null or can_see_branch(branch_id));

create policy shifts_rw on shifts for all to authenticated
  using (can_see_branch(branch_id)) with check (can_see_branch(branch_id));

create policy cash_rw on cash_movements for all to authenticated
  using (can_see_branch(branch_id)) with check (can_see_branch(branch_id));

create policy quotations_rw on quotations for all to authenticated
  using (can_see_branch(branch_id)) with check (can_see_branch(branch_id));

-- orders: staff ที่ scope='own' เห็นเฉพาะบิลที่ตัวเองขาย
create policy orders_read on orders for select to authenticated
  using (
    can_see_branch(branch_id)
    and (current_scope() <> 'own'
         or salesperson_id = current_employee_id()
         or cashier_id = current_employee_id())
  );

create policy orders_insert on orders for insert to authenticated
  with check (can_see_branch(branch_id));

create policy orders_update on orders for update to authenticated
  using (can_see_branch(branch_id) and current_role_name() in ('supervisor','manager','brand_admin','hq'));

create policy returns_rw on returns for all to authenticated
  using (can_see_branch(branch_id)) with check (can_see_branch(branch_id));

create policy approvals_rw on approvals for all to authenticated
  using (branch_id is null or can_see_branch(branch_id))
  with check (branch_id is null or can_see_branch(branch_id));

create policy audit_read on audit_logs for select to authenticated
  using (
    (branch_id is null or can_see_branch(branch_id))
    and current_role_name() in ('supervisor','manager','brand_admin','hq','auditor')
  );
create policy audit_insert on audit_logs for insert to authenticated with check (true);

create policy taxdoc_rw on tax_documents for all to authenticated
  using (can_see_branch(branch_id)) with check (can_see_branch(branch_id));

-- ---------------------------------------------------------------------
-- ตารางลูกที่ scope ผ่านตารางแม่
-- ---------------------------------------------------------------------
create policy order_items_read on order_items for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id and can_see_branch(o.branch_id)));
create policy order_items_write on order_items for insert to authenticated
  with check (exists (select 1 from orders o where o.id = order_id and can_see_branch(o.branch_id)));

create policy order_payments_read on order_payments for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id and can_see_branch(o.branch_id)));
create policy order_payments_write on order_payments for insert to authenticated
  with check (exists (select 1 from orders o where o.id = order_id and can_see_branch(o.branch_id)));

create policy order_item_serials_read on order_item_serials for select to authenticated
  using (exists (
    select 1 from order_items oi join orders o on o.id = oi.order_id
    where oi.id = order_item_id and can_see_branch(o.branch_id)));

create policy return_items_rw on return_items for all to authenticated
  using (exists (select 1 from returns r where r.id = return_id and can_see_branch(r.branch_id)))
  with check (exists (select 1 from returns r where r.id = return_id and can_see_branch(r.branch_id)));

create policy quotation_items_rw on quotation_items for all to authenticated
  using (exists (select 1 from quotations q where q.id = quotation_id and can_see_branch(q.branch_id)))
  with check (exists (select 1 from quotations q where q.id = quotation_id and can_see_branch(q.branch_id)));

create policy stock_count_items_rw on stock_count_items for all to authenticated
  using (exists (select 1 from stock_counts s where s.id = stock_count_id and can_see_branch(s.branch_id)))
  with check (exists (select 1 from stock_counts s where s.id = stock_count_id and can_see_branch(s.branch_id)));

create policy shift_members_rw on shift_members for all to authenticated
  using (exists (select 1 from shifts s where s.id = shift_id and can_see_branch(s.branch_id)))
  with check (exists (select 1 from shifts s where s.id = shift_id and can_see_branch(s.branch_id)));

-- ---------------------------------------------------------------------
-- serial: เห็นได้ถ้าสาขามองเห็น หรือเป็นของที่ขายไปแล้ว (เช็คประกัน)
-- ---------------------------------------------------------------------
create policy serials_read on serials for select to authenticated
  using (branch_id is null or can_see_branch(branch_id));
create policy serials_write on serials for all to authenticated
  using (branch_id is null or can_see_branch(branch_id))
  with check (branch_id is null or can_see_branch(branch_id));

-- ---------------------------------------------------------------------
-- transfers: เห็นได้ทั้งต้นทางและปลายทาง
-- ---------------------------------------------------------------------
create policy transfers_read on transfers for select to authenticated
  using (can_see_branch(from_branch_id) or can_see_branch(to_branch_id));
create policy transfers_write on transfers for all to authenticated
  using (can_see_branch(from_branch_id) or can_see_branch(to_branch_id))
  with check (can_see_branch(from_branch_id) or can_see_branch(to_branch_id));

create policy transfer_items_rw on transfer_items for all to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id
                 and (can_see_branch(t.from_branch_id) or can_see_branch(t.to_branch_id))))
  with check (exists (select 1 from transfers t where t.id = transfer_id
                 and (can_see_branch(t.from_branch_id) or can_see_branch(t.to_branch_id))));

create policy transfer_serials_rw on transfer_serials for all to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id
                 and (can_see_branch(t.from_branch_id) or can_see_branch(t.to_branch_id))))
  with check (true);

create policy transfer_events_rw on transfer_events for all to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id
                 and (can_see_branch(t.from_branch_id) or can_see_branch(t.to_branch_id))))
  with check (true);

-- ---------------------------------------------------------------------
-- employees: staff เห็นเฉพาะตัวเอง + เพื่อนร่วมสาขา (ไม่เห็นเงินเดือน/ต้นทุน)
-- ---------------------------------------------------------------------
create policy employees_read on employees for select to authenticated
  using (
    auth_user_id = auth.uid()
    or current_role_name() in ('supervisor','manager','brand_admin','hq','auditor')
    or home_branch_id in (select visible_branch_ids())
  );

create policy employees_write on employees for all to authenticated
  using (current_role_name() in ('manager','brand_admin','hq'))
  with check (current_role_name() in ('manager','brand_admin','hq'));

create policy employee_branches_rw on employee_branches for all to authenticated
  using (current_role_name() in ('manager','brand_admin','hq') or employee_id = current_employee_id())
  with check (current_role_name() in ('manager','brand_admin','hq'));

create policy employee_brands_rw on employee_brands for all to authenticated
  using (current_role_name() in ('brand_admin','hq') or employee_id = current_employee_id())
  with check (current_role_name() in ('brand_admin','hq'));

create policy employee_permissions_rw on employee_permissions for all to authenticated
  using (current_role_name() in ('manager','brand_admin','hq') or employee_id = current_employee_id())
  with check (current_role_name() in ('brand_admin','hq'));

create policy branch_brands_read on branch_brands for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- customers: ทุกสาขาค้นเจอ (ลูกค้าเดินเข้าสาขาไหนก็ได้) แต่แก้ได้เฉพาะ supervisor ขึ้นไป
-- ---------------------------------------------------------------------
create policy customers_read on customers for select to authenticated using (true);
create policy customers_insert on customers for insert to authenticated with check (true);
create policy customers_update on customers for update to authenticated
  using (current_role_name() in ('supervisor','manager','brand_admin','hq'));

-- ---------------------------------------------------------------------
-- settings / sync
-- ---------------------------------------------------------------------
create policy settings_read on settings for select to authenticated
  using (branch_id is null or can_see_branch(branch_id));
create policy settings_write on settings for all to authenticated
  using (current_role_name() in ('brand_admin','hq'))
  with check (current_role_name() in ('brand_admin','hq'));

create policy sync_batches_rw on sync_batches for all to authenticated
  using (branch_id is null or can_see_branch(branch_id)) with check (true);
create policy sync_conflicts_rw on sync_conflicts for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------
-- คอลัมน์ต้นทุน/กำไร: ปิดจาก staff ด้วย view แยก
--   (RLS คุมได้แค่ระดับแถว — ระดับคอลัมน์ใช้ view + grant)
-- ---------------------------------------------------------------------
create or replace view v_orders_staff as
select id, order_no, branch_id, terminal_id, shift_id, cashier_id, salesperson_id,
       customer_id, customer_name, customer_phone, status, channel,
       subtotal, discount_total, discount_percent, vat_amount, grand_total,
       paid_total, change_amount, reference_no, note, created_at
from orders;

comment on view v_orders_staff is 'บิลขายแบบไม่มีต้นทุน/กำไร — ใช้กับ role staff/supervisor';
