// ทดสอบ migration 0062 (คืนสินค้า/ยกเลิกบิลโหมดจริง) บน PostgreSQL จริง (PGlite) — โครงตารางย่อเฉพาะคอลัมน์ที่ฟังก์ชันใช้
import fs from 'node:fs'; import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');const db=new PGlite();
const U=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const BR=U(1),BR_OW=U(2),ACT=U(3),OUT=U(4),P1=U(5),P2=U(6),CUST=U(7),BRAND=U(8),SHIFT=U(9),SHIFT_OLD=U(10);
await db.exec(`create role anon;create role authenticated;
create type order_status as enum('draft','completed','voided','refunded','partially_refunded');
create type payment_method as enum('cash','credit_card','debit_card','qr_promptpay','bank_transfer','edc','gift');
create type return_status as enum('pending_approval','approved','rejected','completed','cancelled');
create type return_type as enum('refund','exchange','claim');
create type serial_status as enum('in_stock','reserved','sold','returned','transferred','defective','scrapped');
create table branches(id uuid primary key, brand_id uuid);
create table employees(id uuid primary key);
create table customers(id uuid primary key, points int not null default 0, updated_at timestamptz);
create table brand_wallets(customer_id uuid, brand_id uuid, points int not null default 0, updated_at timestamptz, primary key(customer_id,brand_id));
create table loyalty_ledger(id serial, customer_id uuid, brand_id uuid, order_id uuid, branch_id uuid, kind text, points_delta int, balance_points int, note text, created_at timestamptz default now());
create table shifts(id uuid primary key, branch_id uuid, status text, opened_at timestamptz default now(), expected_cash numeric default 0, total_sales numeric default 0, total_orders int default 0);
create table cash_movements(id uuid primary key default gen_random_uuid(), shift_id uuid not null, branch_id uuid not null, type text not null, amount numeric not null, reason text, employee_id uuid, approved_by uuid, created_at timestamptz default now());
create table orders(id uuid primary key, client_uuid uuid unique, order_no text, branch_id uuid, shift_id uuid, customer_id uuid, status order_status, grand_total numeric, voided_by uuid, voided_at timestamptz, void_reason text);
create table order_items(id uuid primary key, order_id uuid, product_id uuid, sku text, name text, qty numeric, returned_qty numeric default 0, unit_price numeric, unit_cost numeric default 0, line_total numeric, is_gift boolean default false, sort_order int);
create table order_payments(order_id uuid, method payment_method, amount numeric);
create table order_item_serials(order_item_id uuid, serial_no text);
create table serials(id uuid primary key default gen_random_uuid(), product_id uuid, serial_no text, branch_id uuid, status serial_status, sold_order_id uuid, sold_at timestamptz, customer_id uuid, note text, updated_at timestamptz);
create table stock_levels(branch_id uuid, product_id uuid, qty_on_hand numeric, qty_quarantine numeric default 0, updated_at timestamptz, primary key(branch_id,product_id));
create table stock_log(branch_id uuid, product_id uuid, kind text, qty numeric, ref text, note text);
create function apply_stock_movement(p_branch uuid,p_product uuid,p_type text,p_qty numeric,p_ref_table text,p_ref_id uuid,p_ref_no text,p_emp uuid,p_serial uuid,p_cost numeric,p_note text) returns uuid language plpgsql as $$
begin update stock_levels set qty_on_hand=qty_on_hand+p_qty where branch_id=p_branch and product_id=p_product;
insert into stock_log values(p_branch,p_product,p_type,p_qty,p_ref_no,p_note); return null; end $$;
create table returns(id uuid primary key, return_no text, client_uuid uuid unique, order_id uuid, branch_id uuid, shift_id uuid, type return_type, status return_status, reason_code text, reason_note text, refund_method payment_method, refund_amount numeric default 0, requested_by uuid, approved_by uuid, approved_at timestamptz, completed_at timestamptz, restock boolean, created_at timestamptz default now());
create table return_items(id uuid primary key, return_id uuid references returns(id), order_item_id uuid, product_id uuid, sku text, name text, qty numeric, unit_price numeric, line_total numeric, condition text);
create table pos_warehouse_links(branch_id uuid, warehouse_id text);
create table pos_integration_events(event_type text, aggregate_id text, state text);
create table audit_logs(id serial, action text, actor_id uuid, branch_id uuid, ref_table text, ref_id uuid, ref_no text, amount numeric, after_data jsonb);
create table pos_work_items(id uuid primary key default gen_random_uuid(), branch_id uuid, created_by uuid, assigned_to uuid, title text, description text, priority text, due_at timestamptz, source_kind text, source_id uuid, source_sig text, status text default 'todo', completed_at timestamptz, version int default 1, updated_at timestamptz,
  constraint pos_work_items_source_kind_check check (source_kind in ('manual')));
create table pos_work_activity(task_id uuid, actor_id uuid, action text, body text);
create function pos_assert_actor_active(uuid) returns void language plpgsql as $$ begin if $1 = '${OUT}' then raise exception 'actor_inactive'; end if; end $$;
create function pos_work_branch_access(p_actor uuid, p_branch uuid) returns boolean language sql as $$ select p_actor <> '${OUT}' $$;
create function pos_ow_issue_assignee(uuid, uuid) returns uuid language sql as $$ select '${ACT}'::uuid $$;
insert into branches values('${BR}','${BRAND}'),('${BR_OW}','${BRAND}'); insert into employees values('${ACT}'),('${OUT}');
insert into customers values('${CUST}', 100); insert into brand_wallets values('${CUST}','${BRAND}',100);
insert into shifts(id,branch_id,status,opened_at) values('${SHIFT_OLD}','${BR}','closed',now()-interval '1 day'),('${SHIFT}','${BR}','open',now());
insert into pos_warehouse_links values('${BR_OW}','33856');`);
await db.exec(fs.readFileSync('../supabase/migrations/0062_returns_live.sql','utf8'));

let seq=100; const id=()=>U(++seq);
// บิล: ของปกติ 2 บรรทัด (100×2 SN, 50×1) + ของแถม · ลดท้ายบิล → grand 225 จาก line รวม 250 (ratio 0.9)
async function bill({branch=BR,shift=SHIFT,customer=CUST,pay='cash',grand=225,delivered=false,earned=20}={}){
  const o=id(),cu=id(),i1=id(),i2=id(),ig=id(),no=`B-${seq}`;
  await db.query(`insert into orders values($1,$2,$3,$4,$5,$6,'completed',$7)`,[o,cu,no,branch,shift,customer,grand]);
  await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total,sort_order) values($1,$2,$3,'P1','P1',2,100,200,1),($4,$2,$5,'P2','P2',1,50,50,2)`,[i1,o,P1,i2,P2]);
  await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total,is_gift,sort_order) values($1,$2,$3,'P2','P2',1,0,0,true,3)`,[ig,o,P2]);
  await db.query(`insert into order_payments values($1,$2,$3)`,[o,pay,grand]);
  const s1=`SN${seq}A`,s2=`SN${seq}B`;
  await db.query(`insert into order_item_serials values($1,$2),($1,$3)`,[i1,s1,s2]);
  await db.query(`insert into serials(product_id,serial_no,branch_id,status,sold_order_id) values($1,$2,$4,'sold',$5),($1,$3,$4,'sold',$5)`,[P1,s1,s2,branch,o]);
  await db.query(`insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,10),($1,$3,10) on conflict do nothing`,[branch,P1,P2]);
  if(customer&&earned) await db.query(`insert into loyalty_ledger(customer_id,order_id,kind,points_delta) values($1,$2,'earn',$3)`,[customer,o,earned]);
  if(delivered) await db.query(`insert into pos_integration_events values('sale.committed',$1,'delivered')`,[cu]);
  return {o,cu,i1,i2,ig,s1,s2,no};
}
const req=(actor,p)=>db.query('select pos_return_request($1,$2) r',[actor,{client_uuid:id(),...p}]).then(x=>x.rows[0].r);
const decide=(rid,ok=true,actor=ACT)=>db.query('select pos_return_decide($1,$2,$3,$4) r',[rid,actor,ok,'t']).then(x=>x.rows[0].r);
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let n=0; const t=async(name,fn)=>{await fn();n++;};

await t('คืนบางส่วน: ยอดคืนตามสัดส่วนส่วนลดท้ายบิล + คืนสต๊อก + SN กลับเข้าสต๊อก + หักแต้มตามสัดส่วน + เงินสดออกกะปัจจุบัน', async()=>{
  const b=await bill();
  const r=await req(ACT,{order_client_uuid:b.cu,refund_method:'cash',items:[{order_item_id:b.i1,qty:1,serials:[b.s1.toLowerCase()]}]});
  assert.equal(Number(r.refund_amount),90); // 100 × 0.9
  const d=await decide(r.return_id);
  assert.equal(d.order_status,'partially_refunded'); assert.equal(d.ow_linked,false);
  assert.equal(Number((await one(`select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2`,[BR,P1])).q),11);
  assert.equal((await one(`select status from serials where serial_no=$1`,[b.s1])).status,'in_stock');
  assert.equal((await one(`select status from serials where serial_no=$1`,[b.s2])).status,'sold');
  assert.equal(d.points_reversed,8); // floor(20 × 90/225)
  assert.equal((await one(`select points from customers`)).points,92);
  const cm=await one(`select shift_id,type,amount from cash_movements order by created_at desc limit 1`);
  assert.deepEqual([cm.shift_id,cm.type,Number(cm.amount)],[SHIFT,'cash_out',90]);
});

await t('กันคืนเกิน (รวมคำขอที่รออนุมัติ) + SN ต้องอยู่ในบิล + คืนบางชิ้นต้องระบุ SN', async()=>{
  const b=await bill();
  await req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]});
  await assert.rejects(req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]}),/return_qty_exceeds/);
  await assert.rejects(req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i1,qty:1,serials:['NOPE']}]}),/return_serial_not_in_bill/);
  await assert.rejects(req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i1,qty:1}]}),/return_serials_required/);
  const full=await req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i1,qty:2}]}); // ครบบรรทัด → เติม SN ให้เอง
  assert.deepEqual((await one(`select serials from return_items where return_id=$1`,[full.return_id])).serials.sort(),[b.s1,b.s2].sort());
  await assert.rejects(req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i1,qty:1,condition:'broken'}]}),/return_qty_exceeds|return_invalid_condition/);
});

await t('ทำซ้ำด้วย client_uuid เดิม = ได้ใบเดิม · ตัดสินซ้ำ = ไม่ทำซ้ำ', async()=>{
  const b=await bill(); const cu=id();
  const a=await req(ACT,{client_uuid:cu,order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]});
  const a2=await req(ACT,{client_uuid:cu,order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]});
  assert.equal(a2.return_id,a.return_id); assert.equal(a2.replay,true);
  await decide(a.return_id); const again=await decide(a.return_id); assert.equal(again.replay,true);
  assert.equal(Number((await one(`select returned_qty r from order_items where id=$1`,[b.i2])).r),1);
});

await t('ปฏิเสธ = ไม่แตะบิล/สต๊อก · คนนอกสาขา/ถูกระงับ ทำไม่ได้', async()=>{
  const b=await bill(); const before=Number((await one(`select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2`,[BR,P2])).q);
  const r=await req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]});
  assert.equal((await decide(r.return_id,false)).status,'rejected');
  assert.equal((await one(`select status from orders where id=$1`,[b.o])).status,'completed');
  assert.equal(Number((await one(`select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2`,[BR,P2])).q),before);
  await assert.rejects(req(OUT,{order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]}),/actor_inactive/);
});

await t('ของชำรุดคืนสต๊อกแต่เข้าโซนพักตรวจ · เคลมประกัน = ไม่คืนเงิน', async()=>{
  const b=await bill();
  const r=await req(ACT,{order_client_uuid:b.cu,type:'claim',items:[{order_item_id:b.i2,qty:1,condition:'defective'}]});
  assert.equal(Number(r.refund_amount),45); // ยอดที่คำนวณ (แจ้งกลับ) แต่ไม่บันทึกเป็นเงินคืน
  assert.equal(Number((await one(`select refund_amount a from returns where id=$1`,[r.return_id])).a),0);
  await decide(r.return_id);
  assert.equal(Number((await one(`select qty_quarantine q from stock_levels where branch_id=$1 and product_id=$2`,[BR,P2])).q),1);
});

await t('ยกเลิกบิล: คืนเงินเต็ม grand_total ด้วยวิธีชำระเดิม · กะเดียวกันไม่ลงเงินออกซ้ำ · กะเก่าลงเงินออกกะปัจจุบัน', async()=>{
  const b=await bill({pay:'qr_promptpay'});
  const r=await req(ACT,{order_client_uuid:b.cu,kind:'void',refund_method:'cash'});
  assert.equal(Number(r.refund_amount),225);
  assert.equal((await one(`select refund_method m from returns where id=$1`,[r.return_id])).m,'qr_promptpay');
  const d=await decide(r.return_id); assert.equal(d.order_status,'voided');
  assert.equal((await one(`select status from orders where id=$1`,[b.o])).status,'voided');
  const c=await bill({pay:'cash'}); const before=Number((await one(`select count(*) n from cash_movements`)).n);
  await decide((await req(ACT,{order_client_uuid:c.cu,kind:'void'})).return_id);
  assert.equal(Number((await one(`select count(*) n from cash_movements`)).n),before); // บิลกะเดียวกัน: close_shift ไม่นับบิล voided อยู่แล้ว
  const old=await bill({pay:'cash',shift:SHIFT_OLD});
  await decide((await req(ACT,{order_client_uuid:old.cu,kind:'void'})).return_id);
  assert.equal(Number((await one(`select count(*) n from cash_movements`)).n),before+1);
});

await t('ยกเลิกบิลไม่ได้เมื่อมีการคืนแล้ว · บิลยกเลิกแล้วคืนซ้ำไม่ได้', async()=>{
  const b=await bill();
  await decide((await req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i2,qty:1}]})).return_id);
  await assert.rejects(req(ACT,{order_client_uuid:b.cu,kind:'void'}),/void_has_returns/);
  const c=await bill(); await decide((await req(ACT,{order_client_uuid:c.cu,kind:'void'})).return_id);
  await assert.rejects(req(ACT,{order_client_uuid:c.cu,items:[{order_item_id:c.i2,qty:1}]}),/return_order_not_returnable/);
});

await t('สาขาผูกคลังกลาง + บิลถึง JST แล้ว: ไม่คืนสต๊อก POS · SN=returned · รอทำใน JST', async()=>{
  const b=await bill({branch:BR_OW,delivered:true});
  const d=await decide((await req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i1,qty:2}]})).return_id);
  assert.equal(d.ow_linked,true);
  assert.equal(Number((await one(`select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2`,[BR_OW,P1])).q),10);
  assert.equal((await one(`select status from serials where serial_no=$1`,[b.s1])).status,'returned');
  assert.equal((await one(`select jst_state from returns where id=$1`,[d.return_id])).jst_state,'pending');
  // ผูกคลังแต่บิลยังไม่ถึง JST → คืนสต๊อก POS ตามปกติ
  const c=await bill({branch:BR_OW});
  const e=await decide((await req(ACT,{order_client_uuid:c.cu,items:[{order_item_id:c.i2,qty:1}]})).return_id);
  assert.equal(e.ow_linked,false);
  assert.equal(Number((await one(`select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2`,[BR_OW,P2])).q),11);
});

await t('ของแถมคืนได้ยอด 0 · คืนครบทุกชิ้น = refunded · ยอดคืนรวมไม่เกินยอดบิล', async()=>{
  const b=await bill({customer:null});
  const r=await req(ACT,{order_client_uuid:b.cu,items:[{order_item_id:b.i1,qty:2},{order_item_id:b.i2,qty:1},{order_item_id:b.ig,qty:1}]});
  assert.equal(Number(r.refund_amount),225);
  assert.equal(Number((await one(`select line_total from return_items where order_item_id=$1`,[b.ig])).line_total),0);
  assert.equal((await decide(r.return_id)).order_status,'refunded');
});

await t('ฟังก์ชันคืน/อนุมัติ เรียกจาก anon/authenticated ไม่ได้ (เรียกผ่าน API ฝั่งเซิร์ฟเวอร์เท่านั้น)', async()=>{
  await db.exec('set role anon'); await assert.rejects(db.query('select pos_return_decide($1,$2,true,null)',[U(999),ACT]),/permission denied/); await db.exec('reset role');
});

console.log(`PASS: migration 0062 + ${n} return/void regressions`); await db.close();
