export async function testWorkCenter(db,ids){
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)},uid=n=>'00000000-0000-4000-8000-'+String(4000+n).padStart(12,'0');
 const branchB=uid(1),a=uid(2),b=uid(3),supervisor=uid(4),task=uid(5);
 async function rejects(sql,args,msg){try{await db.query(sql,args)}catch(e){if(e.message.includes(msg))return;throw e}throw Error('Expected '+msg)}
 await db.query("insert into branches(id,code,name)values($1,'WORK-B','Branch B')",[branchB]);
 await db.query("insert into employees(id,employee_code,first_name,role,data_scope,home_branch_id)values($1,'WORK-A','Worker A','staff','branch',$4),($2,'WORK-B','Worker B','staff','branch',$5),($3,'WORK-SUP','Supervisor','supervisor','branch',$4)",[a,b,supervisor,ids.branch,branchB]);
 const save='select pos_work_save($1,$2,$3,$4,$5) result';
 let t=(await db.query(save,[task,ids.actor,0,{branch_id:ids.branch,title:'Resolve SN',assigned_to:a,due_at:'2020-01-01T03:00:00Z'},'Initial work'])).rows[0].result;
 assert((await db.query('select pos_work_visible($1,$2)v',[a,task])).rows[0].v,'Assigned worker cannot see task');
 assert(!(await db.query('select pos_work_visible($1,$2)v',[b,task])).rows[0].v,'Unrelated branch saw task');
 await rejects(save,[task,b,t.version,{title:'Intrusion'},''],'work_forbidden');
 await rejects(save,[task,a,t.version,{assigned_to:supervisor},''],'work_handoff_reason_required');
 await rejects(save,[task,ids.actor,t.version,{assigned_to:b},'Send across unauthorized branch'],'work_assignee_scope');
 const original=t.version;t=(await db.query(save,[task,a,original,{assigned_to:supervisor,status:'in_progress'},'Please verify serial documents'])).rows[0].result;
 assert(t.assigned_to===supervisor,'Handoff failed');
 await rejects(save,[task,ids.actor,original,{title:'Overwrite'},''],'work_version_conflict');
 const notices=await db.query('select recipient_id from pos_work_notifications where task_id=$1',[task]);assert(notices.rows.some(r=>r.recipient_id===supervisor),'Supervisor missing notification');assert(notices.rows.some(r=>r.recipient_id===a),'Old assignee missing history notice');
 await db.query('select pos_work_pin($1,$2,true)',[ids.actor,task]);await db.query('select pos_work_pin($1,$2,true)',[supervisor,task]);await db.query('select pos_work_pin($1,$2,false)',[ids.actor,task]);
 assert(Number((await db.query('select count(*)from pos_work_pins where task_id=$1',[task])).rows[0].count)===1,'Personal pins changed another user');
 await db.query('select pos_work_reminders($1)',[supervisor]);await db.query('select pos_work_reminders($1)',[supervisor]);assert(Number((await db.query("select count(*)from pos_work_notifications where recipient_id=$1 and event_key like 'due:%'",[supervisor])).rows[0].count)===1,'Overdue reminders duplicated');
 const p=(await db.query('select pos_work_people($1,$2) result',[ids.actor,ids.branch])).rows[0].result;assert(p.some(x=>x.id===supervisor)&&!p.some(x=>x.id===b),'Assignment picker leaks unauthorized recipients');
 const sale=uid(6),draft={grand_total:107,items:[{product_id:ids.product,qty:1,unit_price:107,serials:[]}]};
 await db.query('select pos_create_deferred_sale($1,$2,$3,$4,now(),false,$5,$6)',[sale,ids.actor,ids.branch,draft,'Work integration test',[]]);
 let linked=(await db.query("select *from pos_work_items where source_kind='deferred_sale'and source_id=$1",[sale])).rows[0];assert(linked?.status==='todo','Pending bill did not create task');
 await rejects(save,[linked.id,ids.actor,linked.version,{status:'done'},''],'work_source_not_closed');
 await db.query('select pos_cancel_deferred_sale($1,$2,1,$3)',[sale,ids.actor,'UAT cancellation']);
 linked=(await db.query('select *from pos_work_items where id=$1',[linked.id])).rows[0];assert(linked.status==='cancelled','Task not synchronized with bill closure');
 await rejects(save,[linked.id,ids.actor,linked.version,{status:'todo'},'Reopen'],'work_source_closed');
 const allowed=(await db.query("select pos_work_sales($1,'2026-11-01','2026-12-01',null,null,false)result",[ids.actor])).rows[0].result;
 assert(allowed.some(d=>d.day==='2026-11-20'&&Number(d.orders)>0),'Calendar lost actual sale date');
 const denied=(await db.query("select pos_work_sales($1,'2026-11-01','2026-12-01',null,'{}'::uuid[],false)result",[ids.actor])).rows[0].result;assert(denied.length===0,'Calendar ignores app branch scope');
 const own=(await db.query("select pos_work_sales($1,'2026-11-01','2026-12-01',null,null,true)result",[a])).rows[0].result;assert(own.length===0,'Own scope exposes other staff sales');
 assert(!(await db.query("select has_function_privilege('anon','pos_work_save(uuid,uuid,integer,jsonb,text)','execute')v")).rows[0].v,'Anonymous task mutation exposed');
 console.log('PASS: work assignment/scope/handoff reason, stale versions, personal pins, persistent notifications/reminder dedupe, eligible people, automatic bill task lifecycle and scoped actual-date sales calendar');
}
