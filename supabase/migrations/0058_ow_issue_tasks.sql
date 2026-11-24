-- =====================================================================
-- 0058 — ปัญหาเชื่อมคลังกลาง/JST → งานใน "งานของฉัน" + กระดิ่งแจ้งเตือน (อัตโนมัติ)
--   source_kind ใหม่: ow_sale (บิลส่งเข้า JST ไม่ผ่าน/รอแก้ SN) · ow_transfer (ใบโอนไม่ตรงกับ OW/JST)
--   1 ต้นทาง = 1 งาน (unique เดิม) · source_sig = ลายเซ็นปัญหา → ปัญหาเดิมไม่สร้าง/แจ้งซ้ำ, ปัญหาใหม่ = อัปเดต/เปิดงานใหม่ (แจ้งเตือน)
--   ผู้รับงาน: หัวหน้าที่ดูแลสาขา (supervisor/manager) → ไม่มี = ผู้ทำรายการ → ไม่มี = brand_admin/hq/owner ที่เข้าถึงสาขา
--   ต้นทางแก้แล้ว (JST ยืนยัน / กลับมาตรงกัน) → ปิดงานให้เอง
-- =====================================================================
alter table pos_work_items drop constraint if exists pos_work_items_source_kind_check;
alter table pos_work_items add constraint pos_work_items_source_kind_check check (source_kind in ('manual','deferred_sale','ow_sale','ow_transfer'));
alter table pos_work_items add column if not exists source_sig text;

create or replace function pos_ow_issue_assignee(p_branch uuid, p_hint uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from (
    select e.id, case e.role::text when 'manager' then 1 when 'supervisor' then 2 else 9 end r
      from employees e
     where e.role::text in ('manager','supervisor') and pos_work_branch_access(e.id, p_branch)
       and (e.home_branch_id = p_branch or exists (select 1 from employee_branches eb where eb.employee_id = e.id and eb.branch_id = p_branch))
    union all
    select p_hint, 5 where p_hint is not null and pos_work_branch_access(p_hint, p_branch)
    union all
    select e.id, case e.role::text when 'brand_admin' then 6 when 'hq' then 7 else 8 end
      from employees e where e.role::text in ('brand_admin','hq','owner') and pos_work_branch_access(e.id, p_branch)
  ) c order by r, id limit 1
$$;

create or replace function pos_ow_issue_upsert(p_kind text, p_source uuid, p_branch uuid, p_title text, p_desc text, p_priority text, p_sig text, p_hint uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare t pos_work_items; who uuid;
begin
  if p_kind not in ('ow_sale','ow_transfer') then raise exception 'work_invalid_source'; end if;
  select * into t from pos_work_items where source_kind = p_kind and source_id = p_source for update;
  if found then
    if t.source_sig is not distinct from p_sig then return 'same'; end if;
    update pos_work_items set title = left(p_title,200), description = left(coalesce(p_desc,''),10000), priority = p_priority, source_sig = p_sig,
           status = case when status in ('done','cancelled') then 'todo' else status end, completed_at = null,
           version = version + 1, updated_at = now() where id = t.id;
    insert into pos_work_activity(task_id, actor_id, action, body) values (t.id, null, case when t.status in ('done','cancelled') then 'reopened' else 'updated' end, 'ระบบ: ' || left(coalesce(p_desc,''),3000));
    return case when t.status in ('done','cancelled') then 'reopened' else 'updated' end;
  end if;
  who := pos_ow_issue_assignee(p_branch, p_hint);
  if who is null then return 'no_assignee'; end if;
  insert into pos_work_items(branch_id, created_by, assigned_to, title, description, priority, due_at, source_kind, source_id, source_sig)
  values (p_branch, coalesce(case when pos_work_branch_access(p_hint, p_branch) then p_hint end, who), who, left(p_title,200), left(coalesce(p_desc,''),10000), p_priority,
          now() + case p_priority when 'urgent' then interval '2 hours' when 'high' then interval '8 hours' else interval '24 hours' end, p_kind, p_source, p_sig)
  returning * into t;
  insert into pos_work_activity(task_id, actor_id, action, body) values (t.id, null, 'linked', 'ระบบสร้างจากการเชื่อมคลังกลาง/JST');
  return 'created';
end $$;

create or replace function pos_ow_issue_resolve(p_kind text, p_source uuid, p_note text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare tid uuid;
begin
  update pos_work_items set status = 'done', completed_at = now(), updated_at = now(), version = version + 1, source_sig = null
   where source_kind = p_kind and source_id = p_source and status not in ('done','cancelled') returning id into tid;
  if tid is null then return false; end if;
  insert into pos_work_activity(task_id, actor_id, action, body) values (tid, null, 'source_closed', 'ระบบ: ' || coalesce(p_note,'ต้นทางแก้ไขแล้ว'));
  return true;
end $$;

revoke all on function pos_ow_issue_assignee(uuid,uuid) from public, anon, authenticated;
revoke all on function pos_ow_issue_upsert(text,uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function pos_ow_issue_resolve(text,uuid,text) from public, anon, authenticated;
