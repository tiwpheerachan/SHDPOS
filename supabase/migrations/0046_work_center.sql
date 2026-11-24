-- Shared operational work queue. Browser roles cannot bypass assignment/scope/version checks.
create table pos_work_items(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references branches(id),created_by uuid not null references employees(id),assigned_to uuid not null references employees(id),
 title text not null check(length(title)between 1 and 200),description text not null default '',status text not null default 'todo'check(status in('todo','in_progress','blocked','done','cancelled')),
 priority text not null default 'normal'check(priority in('low','normal','high','urgent')),due_at timestamptz,
 source_kind text not null default 'manual'check(source_kind in('manual','deferred_sale')),source_id uuid,version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,
 unique(source_kind,source_id)
);
create index pos_work_assigned on pos_work_items(assigned_to,status,due_at);
create index pos_work_branch on pos_work_items(branch_id,status);
create table pos_work_pins(task_id uuid not null references pos_work_items(id),employee_id uuid not null references employees(id),created_at timestamptz not null default now(),primary key(task_id,employee_id));
create table pos_work_activity(id uuid primary key default gen_random_uuid(),task_id uuid not null references pos_work_items(id),actor_id uuid references employees(id),action text not null,body text not null default '',detail jsonb not null default '{}',created_at timestamptz not null default now());
create table pos_work_notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid not null references employees(id),task_id uuid not null references pos_work_items(id),event_key text not null,title text not null,read_at timestamptz,created_at timestamptz not null default now(),unique(recipient_id,event_key));
create index pos_work_unread on pos_work_notifications(recipient_id,created_at desc)where read_at is null;
do $$declare t text;begin foreach t in array array['pos_work_items','pos_work_pins','pos_work_activity','pos_work_notifications']loop execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);end loop;end$$;

create function pos_work_branch_access(p_actor uuid,p_branch uuid)returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from employees e where e.id=p_actor and e.status='active'and e.app_access is not false and(
 e.data_scope='company'or e.home_branch_id=p_branch or exists(select 1 from employee_branches eb where eb.employee_id=e.id and eb.branch_id=p_branch)
 or(e.data_scope='brand'and exists(select 1 from employee_brands eb join branches b on b.id=p_branch where eb.employee_id=e.id and(b.brand_id=eb.brand_id or exists(select 1 from branch_brands bb where bb.branch_id=p_branch and bb.brand_id=eb.brand_id))))))
$$;
create function pos_work_team_manager(p_actor uuid)returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from employees where id=p_actor and status='active'and app_access is not false and role::text in('supervisor','manager','brand_admin','hq','owner'))$$;
create function pos_work_visible(p_actor uuid,p_task uuid)returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from pos_work_items t where t.id=p_task and pos_work_branch_access(p_actor,t.branch_id)and(t.created_by=p_actor or t.assigned_to=p_actor or pos_work_team_manager(p_actor)))$$;

create function pos_work_notify()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;heading text;
begin
 heading:=case when tg_op='INSERT'then 'งานใหม่: 'when new.assigned_to is distinct from old.assigned_to then 'ส่งต่องาน: 'when new.status='done'then 'งานเสร็จแล้ว: 'when new.status='blocked'then 'งานติดขัด: 'else 'อัปเดตงาน: 'end||new.title;
 for recipient in select distinct id from unnest(array[new.assigned_to,new.created_by,case when tg_op='UPDATE'then old.assigned_to else null end])id where id is not null loop
  insert into pos_work_notifications(recipient_id,task_id,event_key,title)values(recipient,new.id,new.id::text||':'||new.version,heading)on conflict do nothing;
 end loop;return new;
end$$;
create trigger pos_work_notify_change after insert or update on pos_work_items for each row execute function pos_work_notify();

create function pos_work_save(p_id uuid,p_actor uuid,p_version integer,p_patch jsonb,p_comment text default '')returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t pos_work_items;before_row pos_work_items;assignee uuid;branch uuid;
begin
 perform pos_assert_actor_active(p_actor);select *into t from pos_work_items where id=p_id for update;
 if found then
  if not pos_work_visible(p_actor,p_id)then raise exception 'work_forbidden';end if;
  if t.version<>p_version then raise exception 'work_version_conflict';end if;
  before_row:=t;
  assignee:=case when p_patch?'assigned_to'then(p_patch->>'assigned_to')::uuid else t.assigned_to end;
  if assignee is distinct from t.assigned_to and length(trim(coalesce(p_comment,'')))<3 then raise exception 'work_handoff_reason_required';end if;
  if t.source_kind='deferred_sale'and p_patch->>'status'in('done','cancelled')and exists(select 1 from pos_deferred_sales where id=t.source_id and state='pending')then raise exception 'work_source_not_closed';end if;
  if t.source_kind='deferred_sale'and exists(select 1 from pos_deferred_sales where id=t.source_id and state in('posted','cancelled'))and p_patch?'status'and p_patch->>'status'<>t.status then raise exception 'work_source_closed';end if;
  if not pos_work_branch_access(assignee,t.branch_id)then raise exception 'work_assignee_scope';end if;
  update pos_work_items set title=case when p_patch?'title'then trim(p_patch->>'title')else title end,description=case when p_patch?'description'then p_patch->>'description'else description end,
   status=coalesce(p_patch->>'status',status),priority=coalesce(p_patch->>'priority',priority),due_at=case when p_patch?'due_at'then(p_patch->>'due_at')::timestamptz else due_at end,
   assigned_to=assignee,version=version+1,updated_at=now(),completed_at=case when coalesce(p_patch->>'status',status)in('done','cancelled')then coalesce(completed_at,now())else null end where id=p_id returning *into t;
 else
  if p_version<>0 then raise exception 'work_not_found';end if;
  branch:=(p_patch->>'branch_id')::uuid;assignee:=coalesce((p_patch->>'assigned_to')::uuid,p_actor);
  if not pos_work_branch_access(p_actor,branch)or not pos_work_branch_access(assignee,branch)then raise exception 'work_assignee_scope';end if;
  if p_patch->>'source_kind'='deferred_sale'then
   if not exists(select 1 from pos_deferred_sales where id=(p_patch->>'source_id')::uuid and branch_id=branch and state='pending')then raise exception 'work_invalid_source';end if;
  elsif coalesce(p_patch->>'source_kind','manual')<>'manual'or p_patch?'source_id'then raise exception 'work_invalid_source';end if;
  insert into pos_work_items(id,branch_id,created_by,assigned_to,title,description,priority,due_at,source_kind,source_id)values(p_id,branch,p_actor,assignee,trim(p_patch->>'title'),coalesce(p_patch->>'description',''),coalesce(p_patch->>'priority','normal'),(p_patch->>'due_at')::timestamptz,coalesce(p_patch->>'source_kind','manual'),(p_patch->>'source_id')::uuid)returning *into t;
 end if;
 if length(t.description)>10000 or length(p_comment)>4000 or(t.due_at is not null and not isfinite(t.due_at))then raise exception 'work_invalid_input';end if;
 insert into pos_work_activity(task_id,actor_id,action,body,detail)values(t.id,p_actor,case when before_row.id is null then 'created'when t.assigned_to is distinct from before_row.assigned_to then 'handoff'else 'updated'end,coalesce(p_comment,''),jsonb_build_object('before',to_jsonb(before_row),'after',to_jsonb(t)));
 return to_jsonb(t);
end$$;
create function pos_work_pin(p_actor uuid,p_task uuid,p_pin boolean)returns void language plpgsql security definer set search_path=public,pg_temp as $$begin perform pos_assert_actor_active(p_actor);if not pos_work_visible(p_actor,p_task)then raise exception 'work_forbidden';end if;if p_pin then insert into pos_work_pins(task_id,employee_id)values(p_task,p_actor)on conflict do nothing;else delete from pos_work_pins where task_id=p_task and employee_id=p_actor;end if;end$$;
create function pos_work_reminders(p_actor uuid)returns void language plpgsql security definer set search_path=public,pg_temp as $$begin perform pos_assert_actor_active(p_actor);insert into pos_work_notifications(recipient_id,task_id,event_key,title)select p_actor,id,'due:'||id||':'||version,'งานเกินกำหนด: '||title from pos_work_items where assigned_to=p_actor and pos_work_branch_access(p_actor,branch_id)and status not in('done','cancelled')and due_at<now()on conflict do nothing;end$$;

create function pos_deferred_work_link()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare work_id uuid;
begin
 if tg_op='INSERT'then
  insert into pos_work_items(branch_id,created_by,assigned_to,title,description,priority,due_at,source_kind,source_id)values(new.branch_id,new.created_by,new.created_by,'ปิดบิล PEND-'||upper(left(new.id::text,8)),new.reason,'normal',new.created_at+interval '24 hours','deferred_sale',new.id)on conflict(source_kind,source_id)do nothing returning id into work_id;
  if work_id is not null then insert into pos_work_activity(task_id,actor_id,action,body)values(work_id,new.created_by,'linked','สร้างจากรายการขายก่อนรอปิดบิล');end if;
 elsif new.state is distinct from old.state and new.state in('posted','cancelled')then
  update pos_work_items set status=case when new.state='posted'then 'done'else 'cancelled'end,completed_at=now(),updated_at=now(),version=version+1 where source_kind='deferred_sale'and source_id=new.id returning id into work_id;
  if work_id is not null then insert into pos_work_activity(task_id,actor_id,action,body)values(work_id,coalesce(new.posted_by,new.created_by),'source_closed','สถานะอัปเดตตามรายการต้นทาง');end if;
 end if;return new;
end$$;
create trigger pos_deferred_work after insert or update of state on pos_deferred_sales for each row execute function pos_deferred_work_link();
insert into pos_work_items(branch_id,created_by,assigned_to,title,description,due_at,source_kind,source_id)select branch_id,created_by,created_by,'ปิดบิล PEND-'||upper(left(id::text,8)),reason,created_at+interval '24 hours','deferred_sale',id from pos_deferred_sales where state='pending'on conflict(source_kind,source_id)do nothing;
revoke all on function pos_work_branch_access(uuid,uuid),pos_work_team_manager(uuid),pos_work_visible(uuid,uuid),pos_work_notify(),pos_work_save(uuid,uuid,integer,jsonb,text),pos_work_pin(uuid,uuid,boolean),pos_work_reminders(uuid),pos_deferred_work_link()from public,anon,authenticated;
grant execute on function pos_work_branch_access(uuid,uuid),pos_work_team_manager(uuid),pos_work_visible(uuid,uuid),pos_work_save(uuid,uuid,integer,jsonb,text),pos_work_pin(uuid,uuid,boolean),pos_work_reminders(uuid)to service_role;

create function pos_work_people(p_actor uuid,p_branch uuid)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(e.nickname,''),concat_ws(' ',e.first_name,e.last_name)),'role',e.role,'photo_url',e.photo_url)order by e.first_name),'[]')from employees e where pos_work_branch_access(p_actor,p_branch)and pos_work_branch_access(e.id,p_branch)
$$;
create function pos_work_sales(p_actor uuid,p_from timestamptz,p_to timestamptz,p_branch uuid,p_allowed uuid[],p_own boolean)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_to<=p_from or p_to-p_from>interval '42 days'then raise exception 'calendar_range_invalid';end if;
 with o as materialized(
  select *,coalesce(sale_occurred_at,created_at)at time zone 'Asia/Bangkok'as local_at from orders
  where status in('completed','partially_refunded')and coalesce(sale_occurred_at,created_at)>=p_from and coalesce(sale_occurred_at,created_at)<p_to
  and(p_branch is null or branch_id=p_branch)and(p_allowed is null or branch_id=any(p_allowed))and pos_work_branch_access(p_actor,branch_id)
  and(not p_own or cashier_id=p_actor or salesperson_id=p_actor)
 ),d as(select local_at::date day_key,sum(grand_total)total,count(*)orders from o group by 1),
 h as(select local_at::date day_key,extract(hour from local_at)::int hour_key,sum(grand_total)total,count(*)orders from o group by 1,2),
 products as(select o.local_at::date day_key,i.sku,max(i.name)name,sum(i.qty)qty,sum(i.line_total)line_total from o join order_items i on i.order_id=o.id group by 1,2),
 p as(select(occurred_at at time zone 'Asia/Bangkok')::date day_key,count(*)pending_count,sum(coalesce((select sum((x->>'amount')::numeric)from jsonb_array_elements(payments)x),0))pending_received from pos_deferred_sales
 where state='pending'and occurred_at>=p_from and occurred_at<p_to and(p_branch is null or branch_id=p_branch)and(p_allowed is null or branch_id=any(p_allowed))and pos_work_branch_access(p_actor,branch_id)and(not p_own or created_by=p_actor)group by 1),
 days as(select day_key from d union select day_key from p)
 select coalesce(jsonb_agg(jsonb_build_object('day',days.day_key,'total',coalesce(d.total,0),'orders',coalesce(d.orders,0),'pending_count',coalesce(p.pending_count,0),'pending_received',coalesce(p.pending_received,0),
 'hours',coalesce((select jsonb_agg(jsonb_build_object('hour',hour_key,'total',total,'orders',orders)order by hour_key)from h where h.day_key=days.day_key),'[]'),
 'products',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',name,'qty',qty,'line_total',line_total)order by line_total desc)from products where products.day_key=days.day_key),'[]'))order by days.day_key),'[]')into result from days left join d using(day_key)left join p using(day_key);
 return result;
end$$;
revoke all on function pos_work_people(uuid,uuid),pos_work_sales(uuid,timestamptz,timestamptz,uuid,uuid[],boolean)from public,anon,authenticated;
grant execute on function pos_work_people(uuid,uuid),pos_work_sales(uuid,timestamptz,timestamptz,uuid,uuid[],boolean)to service_role;
