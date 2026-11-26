// ทะเบียน EDC + อัตรา MDR (0080) — เลือกอัตราตามวันมีผล/ประเภทบัตร/แผนผ่อน · บิลบันทึกเครื่อง/TID/MID/ค่าธรรมเนียม · ข้อจำกัดข้อมูล · anon ปิด
export async function testEdc(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(9900 + n).padStart(12, '0')}`;
  const BR = U(1), P = U(2), T1 = U(3), SALE = U(4);
  let n = 0;
  await db.query("insert into branches(id,code,name,name_th) values($1,'EDC1','EDC1','EDC1')", [BR]);
  await db.query('insert into employee_branches(employee_id,branch_id) values($1,$2) on conflict do nothing', [ids.actor, BR]);
  await db.query("insert into products(id,sku,name_th,price,cost) values($1,'EDC-A','A',1000,600)", [P]);
  await db.query('insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,5)', [BR, P]);

  // ทะเบียน: เครื่อง + MID ตามบริการ + แผนผ่อนแยก TID
  await db.query("insert into pos_edc_terminals(id,acquirer,branch_id,label,tid,source) values($1,'UOB',$2,'test UOB','12345678','test')", [T1, BR]);
  await db.query("insert into pos_edc_mids(terminal_id,service,installment_months,mid,tid) values($1,'card',0,'100000000001',null),($1,'installment',6,'200000000006','87654321')", [T1]);
  await rejects(db.query("insert into pos_edc_terminals(acquirer,branch_id,tid) values('UOB',$1,'12345678')", [BR]), 'duplicate key'); n++;
  await rejects(db.query("insert into pos_edc_mids(terminal_id,service,installment_months,mid) values($1,'installment',0,'300000000000')", [T1]), 'check'); // ผ่อนต้องระบุเดือน
  await rejects(db.query("insert into pos_edc_mids(terminal_id,service,installment_months,mid) values($1,'card',5,'300000000000')", [T1]), 'check');  // เดือนไม่ถูกต้อง
  await rejects(db.query("insert into pos_edc_terminals(acquirer,tid) values('XYZ','11112222')"), 'check'); n++;

  // อัตรา MDR: เลือกตามวันมีผล · ประเภทบัตรเฉพาะก่อน 'all' · แผนผ่อนตามเดือน
  await db.query(`insert into pos_mdr_rates(acquirer,service,card_type,installment_months,rate_pct,fixed_fee,vat_on_fee,effective_from,effective_to) values
    ('UOB','card','all',0,1.50,0,true,'2026-01-01','2026-06-30'),
    ('UOB','card','all',0,1.60,0,true,'2026-07-01',null),
    ('UOB','card','jcb',0,2.20,0,true,'2026-07-01',null),
    ('UOB','installment','all',6,3.00,5,false,'2026-01-01',null)`);
  const rate = async (svc, m, card, on) => (await db.query('select (pos_mdr_rate_for($1,$2,$3,$4,$5)).*', ['UOB', svc, m, card, on])).rows[0];
  eq(Number((await rate('card', 0, null, '2026-03-01')).rate_pct), 1.5, 'อัตราช่วงแรก'); eq(Number((await rate('card', 0, null, '2026-08-01')).rate_pct), 1.6, 'อัตราใหม่หลัง 1 ก.ค.'); n++;
  eq(Number((await rate('card', 0, 'jcb', '2026-08-01')).rate_pct), 2.2, 'บัตร JCB ใช้อัตราเฉพาะ'); eq(Number((await rate('card', 0, 'visa', '2026-08-01')).rate_pct), 1.6, 'Visa ไม่มีอัตราเฉพาะ → all'); n++;
  eq(Number((await rate('installment', 6, null, '2026-08-01')).fixed_fee), 5, 'แผนผ่อน 6 เดือน'); eq((await rate('installment', 10, null, '2026-08-01')).id, null, 'แผนที่ไม่มีอัตรา = ไม่พบ'); n++;
  await rejects(db.query("insert into pos_mdr_rates(acquirer,service,rate_pct) values('UOB','card',25)"), 'check');
  await rejects(db.query("insert into pos_mdr_rates(acquirer,service,rate_pct,effective_from,effective_to) values('UOB','card',1,'2026-05-01','2026-04-01')"), 'check'); n++;

  // ปิดบิล: การรับชำระบันทึกเครื่อง + TID แผนผ่อน + MID + ค่าธรรมเนียม (ฟังก์ชันสร้างบิลที่แพตช์ใน 0080)
  const quote = { branch_id: BR, client_uuid: SALE, channel: 'offline', cashier_id: ids.actor, subtotal: 1000, discount_total: 0, grand_total: 1000, vat_amount: 65.42,
    items: [{ product_id: P, sku: 'EDC-A', name: 'A', kind: 'goods', qty: 1, unit_price: 1000, line_total: 1000, unit_cost: 600, cost_total: 600, gross_profit: 334.58, serials: [] }] };
  const pay = [{ method: 'installment', amount: 1000, reference_no: 'APR1', approval_code: 'APR1', installment_months: 6, acquirer_bank: 'UOB', mid: '200000000006', tid: '87654321', edc_terminal_id: T1, fee_amount: 35 }];
  await db.query('select pos_reserve_checkout($1,$2,$3,$4)', [SALE, ids.actor, BR, quote]);
  await db.query('select pos_record_checkout_payment($1,$2,$3)', [SALE, ids.actor, pay[0]]);
  await db.query('select pos_commit_checkout($1,$2,$3)', [SALE, ids.actor, JSON.stringify(pay)]);
  const op = (await db.query('select p.* from order_payments p join orders o on o.id=p.order_id where o.client_uuid=$1', [SALE])).rows[0];
  eq(op.edc_terminal_id, T1, 'บิลผูกเครื่อง'); eq(op.tid, '87654321', 'TID ของแผนผ่อน'); eq(op.mid, '200000000006', 'MID ของแผน'); eq(Number(op.fee_amount), 35, 'ค่าธรรมเนียม'); eq(op.installment_months, 6, 'จำนวนงวด'); n++;
  // บิลที่ไม่ส่งเครื่อง (สาขาที่ยังไม่มีทะเบียน) = ว่าง ไม่พัง
  const SALE2 = U(5);
  await db.query('select pos_reserve_checkout($1,$2,$3,$4)', [SALE2, ids.actor, BR, { ...quote, client_uuid: SALE2 }]);
  const pay2 = [{ method: 'edc', amount: 1000, reference_no: 'APR2', approval_code: 'APR2' }];
  await db.query('select pos_record_checkout_payment($1,$2,$3)', [SALE2, ids.actor, pay2[0]]);
  await db.query('select pos_commit_checkout($1,$2,$3)', [SALE2, ids.actor, JSON.stringify(pay2)]);
  const op2 = (await db.query('select p.edc_terminal_id, p.tid from order_payments p join orders o on o.id=p.order_id where o.client_uuid=$1', [SALE2])).rows[0];
  eq(op2.edc_terminal_id, null, 'ไม่มีเครื่อง = null'); eq(op2.tid, null, 'ไม่มี TID = null'); n++;
  // เลิกใช้เครื่องที่มีบิลอ้างอิงได้ (ไม่ลบ) · ลบเครื่องที่ถูกอ้างอิงไม่ได้
  await db.query("update pos_edc_terminals set status='retired' where id=$1", [T1]);
  await rejects(db.query('delete from pos_edc_terminals where id=$1', [T1]), 'foreign key'); n++;
  // anon/authenticated อ่านทะเบียน/อัตราไม่ได้
  await db.exec('set role anon');
  await rejects(db.query('select * from pos_edc_terminals'), 'permission denied');
  await rejects(db.query('select * from pos_mdr_rates'), 'permission denied');
  await db.exec('reset role'); n++;
  console.log(`PASS: ${n} EDC/MDR regressions (unique acquirer+TID, plan months checks, MDR by effective date/card type/plan, bill stores terminal+plan TID+MID+fee, legacy no-terminal ok, retire not delete, anon denied)`);
}
