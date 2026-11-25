// ปิดงวด + ล็อกเอกสาร + ยอดขายสุทธิ + สมการสต๊อก (0075) — ตามเคส UAT T009 · T036 · T064 · T068 · T070
export async function testPeriodClose(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(9000 + n).padStart(12, '0')}`;
  const BR = U(1), P = U(2), APR = U(3), SHIFT = U(4);
  await db.query("insert into branches(id,code,name,name_th) values($1,'PC1','PC1','PC1')", [BR]);
  await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,'PCAPR','Apr','manager',$2)", [APR, BR]);
  await db.query("insert into products(id,sku,name_th,price,cost) values($1,'PC-SKU','PC',100,50)", [P]);
  const today = (await db.query("select (now() at time zone 'Asia/Bangkok')::date d, to_char((now() at time zone 'Asia/Bangkok') - interval '1 month','YYYY-MM') prev, to_char(now() at time zone 'Asia/Bangkok','YYYY-MM') cur")).rows[0];
  const lastMonth = (await db.query("select (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '10 days') at time zone 'Asia/Bangkok' t")).rows[0].t;
  const bill = async (n, total, vat = 0, at = null) => {
    const id = U(100 + n);
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,cashier_id,status,channel,subtotal,grand_total,vat_amount,created_at) values($1,$1,$2,$3,$4,'completed','offline',$5,$5,$6,coalesce($7,now()))`, [id, `PCB-${n}`, BR, ids.actor, total, vat, at]);
    await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total) values($1,$2,$3,'PC-SKU','PC',$4,100,$5)`, [U(200 + n), id, P, total / 100, total]);
    await db.query(`insert into order_payments(order_id,method,amount) values($1,'bank_transfer',$2)`, [id, total]);
    return id;
  };
  const summary = (from, to) => db.query('select pos_period_summary($1,$2,$3) s', [BR, from, to]).then((x) => x.rows[0].s);
  let n = 0;

  // ── T009 / T036 ล็อกเอกสารที่ Post แล้ว ──
  const o1 = await bill(1, 1000);
  await rejects(db.query('update orders set grand_total=900 where id=$1', [o1]), 'posted_document_locked'); n++;
  await rejects(db.query('delete from orders where id=$1', [o1]), 'posted_document_delete_forbidden'); n++;
  await rejects(db.query("update order_items set qty=5 where order_id=$1", [o1]), 'posted_document_locked');
  await rejects(db.query("update order_items set returned_qty=-1 where order_id=$1", [o1]), 'posted_document_locked'); n++;
  await rejects(db.query('delete from order_payments where order_id=$1', [o1]), 'posted_document_locked');
  await rejects(db.query('update order_payments set amount=1 where order_id=$1', [o1]), 'posted_document_locked'); n++;
  await db.query("update orders set status='partially_refunded' where id=$1", [o1]);
  await rejects(db.query("update orders set status='completed' where id=$1", [o1]), 'posted_status_backward'); n++;
  await db.query("update orders set gross_profit=1 where id=$1", [o1]); // ฟิลด์ที่ไม่ใช่ยอดเอกสาร ยังอัปเดตได้
  await db.query("select apply_stock_movement($1,$2,'receive',1)", [BR, P]);
  await rejects(db.query('delete from stock_movements where branch_id=$1', [BR]), 'posted_document_locked');
  await rejects(db.query('update stock_movements set qty_delta=5 where branch_id=$1', [BR]), 'posted_document_locked'); n++;
  const o2 = await bill(2, 500);
  const buyer = { name: 'บริษัท ทดสอบ จำกัด', tax_id: '0105512345678', branch_no: '0', address: '99 ถนนทดสอบ เขตทดสอบ กรุงเทพฯ 10110' };
  await db.query('select pos_issue_tax_invoice($1,$2,$3,null)', [o2, ids.actor, buyer]);
  await rejects(db.query(`update tax_invoices set buyer = buyer || '{"name":"แก้เงียบ"}' where order_id=$1`, [o2]), 'posted_document_locked');
  await rejects(db.query("update tax_invoices set status='cancelled' where order_id=$1", [o2]), 'posted_document_locked'); // ยกเลิกต้องมีเหตุผล
  await rejects(db.query('delete from tax_invoices where order_id=$1', [o2]), 'posted_document_delete_forbidden');
  // แก้ที่อยู่ผู้ซื้อผ่านช่องทางที่ถูกต้อง = ยกเลิก+ออกใบใหม่ เก็บประวัติ
  await db.query('select pos_issue_tax_invoice($1,$2,$3,$4)', [o2, ids.actor, { ...buyer, address: '100 ถนนใหม่ เขตทดสอบ กรุงเทพฯ 10110' }, 'ลูกค้าแจ้งที่อยู่ใหม่']);
  eq((await db.query("select string_agg(status,',' order by issued_at) s from tax_invoices where order_id=$1", [o2])).rows[0].s, 'cancelled,issued', 'แก้ผ่านใบแทน เก็บประวัติ'); n++;

  // ── T068 ยอดขายสุทธิ: ขาย 1000 (ไม่มี VAT) คืน 100 ใบลดหนี้ส่วนลด 50 → 850 · CN จากการรับคืนไม่หักซ้ำ ──
  const BR2 = U(5);
  await db.query("insert into branches(id,code,name,name_th) values($1,'PC2','PC2','PC2')", [BR2]);
  await db.query('insert into employee_branches(employee_id,branch_id) values($1,$3),($2,$3),($1,$4),($2,$4) on conflict do nothing', [ids.actor, APR, BR2, BR]);
  await db.query("insert into shifts(id,shift_no,branch_id,opened_by,status,opening_cash) values($1,'SH-PC-1',$2,$3,'open',0)", [SHIFT, BR2, ids.actor]);
  const s68 = U(300);
  await db.query(`insert into orders(id,client_uuid,order_no,branch_id,cashier_id,status,channel,subtotal,grand_total,vat_amount) values($1,$1,'PC68',$2,$3,'completed','offline',1000,1000,0)`, [s68, BR2, ids.actor]);
  await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total) values($1,$2,$3,'PC-SKU','PC',10,100,1000)`, [U(301), s68, P]);
  await db.query(`insert into order_payments(order_id,method,amount) values($1,'cash',1000)`, [s68]);
  await db.query('select pos_issue_tax_invoice($1,$2,$3,null)', [s68, ids.actor, buyer]); // มีใบกำกับ → รับคืนแล้ว CN อัตโนมัติ
  const it = (await db.query('select id from order_items where order_id=$1', [s68])).rows[0].id;
  const rr = (await db.query('select pos_return_request($1,$2) r', [ids.actor, JSON.stringify({ client_uuid: U(302), order_client_uuid: s68, kind: 'return', type: 'refund', refund_method: 'bank_transfer', items: [{ order_item_id: it, qty: 1, condition: 'sellable' }] })])).rows[0].r;
  await db.query('select pos_return_decide($1,$2,true,$3)', [rr.return_id, APR, 'ok']);
  await db.query('select pos_issue_credit_note($1,$2)', [ids.actor, JSON.stringify({ client_uuid: U(303), kind: 'discount', order_id: s68, amount: 50, reason: 'ส่วนลดหลังขาย', refund_method: 'bank_transfer' })]);
  const sm = await db.query('select pos_period_summary($1,$2,$3) s', [BR2, today.d, today.d]).then((x) => x.rows[0].s);
  eq(Number(sm.net_sales), 850, 'T068 ยอดขายสุทธิ 850');
  eq(Number(sm.credit_notes.return_linked_amount), 100, 'CN จากการรับคืนแสดงอ้างอิง'); eq(Number(sm.returns.amount), 100, 'คืน 100 นับครั้งเดียว'); n++;

  // ── T064 สมการสต๊อก: ยกมา 100 รับ 20 ขาย 15 คืนขาย 2 คืนซื้อ 3 เสีย 1 โอนออก 4 → 99 ──
  const BR3 = U(6);
  await db.query("insert into branches(id,code,name,name_th) values($1,'PC3','PC3','PC3')", [BR3]);
  await db.query("insert into stock_movements(branch_id,product_id,type,qty_delta,qty_after,occurred_at) values($1,$2,'opening',100,100,$3)", [BR3, P, lastMonth]);
  await db.query('insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,100)', [BR3, P]);
  for (const [t, q] of [['receive', 20], ['sale', -15], ['return', 2], ['claim_out', -3], ['damage', -1], ['transfer_out', -4]]) await db.query("select apply_stock_movement($1,$2,$3::movement_type,$4)", [BR3, P, t, q]);
  const st = (await db.query('select pos_period_summary($1,$2,$3) s', [BR3, today.d, today.d])).rows[0].s.stock;
  eq(Number(st.opening), 100, 'ยกมา'); eq(Number(st.movement), -1, 'เคลื่อนไหวสุทธิ'); eq(Number(st.closing), 99, 'T064 คงเหลือ 99');
  eq(Number(st.by_type.sale), -15, 'แยกตามประเภท'); eq(Number(st.skus_out_of_balance), 0, 'stock card ตรง on-hand'); n++;

  // ── T070 ปิดงวด ──
  await rejects(db.query('select pos_period_close($1,$2,$3)', [APR, BR, today.cur]), 'period_not_ended'); n++;
  await db.query("insert into shifts(id,shift_no,branch_id,opened_by,status,opening_cash,opened_at) values($1,'SH-PC-OLD',$2,$3,'open',0,$4)", [U(7), BR, ids.actor, lastMonth]);
  await rejects(db.query('select pos_period_close($1,$2,$3)', [APR, BR, today.prev]), 'period_has_open_items'); n++;
  await db.query("update shifts set status='closed' where id=$1", [U(7)]);
  const old = await bill(3, 200, 0, lastMonth); // บิลเดือนก่อน (ก่อนปิด)
  const c1 = (await db.query('select pos_period_close($1,$2,$3,$4) r', [APR, BR, today.prev, 'ปิดงวดทดสอบ'])).rows[0].r;
  eq(c1.version, 1, 'ปิดครั้งแรก = version 1'); eq(Number(c1.summary.net_sales), 200, 'สรุปยอดของงวด'); n++;
  eq((await db.query('select pos_period_close($1,$2,$3) r', [APR, BR, today.prev])).rows[0].r.duplicate, true, 'ปิดซ้ำไม่สร้าง version ใหม่'); n++;
  await rejects(bill(4, 100, 0, lastMonth), 'period_closed'); n++;                                         // ลงบิลย้อนหลัง
  await rejects(db.query("insert into stock_movements(branch_id,product_id,type,qty_delta,qty_after,occurred_at) values($1,$2,'manual_adjust',1,1,$3)", [BR, P, lastMonth]), 'period_closed');
  await rejects(db.query("insert into cash_movements(shift_id,branch_id,type,amount,created_at) values($1,$2,'cash_in',10,$3)", [U(7), BR, lastMonth]), 'period_closed'); n++;
  // บิลค้างส่งที่ตั้งวันขายย้อนเข้างวดที่ปิด → ไม่ได้
  const o5 = await bill(5, 100);
  await rejects(db.query('update orders set sale_occurred_at=$2 where id=$1', [o5, lastMonth]), 'period_closed'); n++;
  // รายการวันนี้ที่อ้างบิลเก่า (ใบลดหนี้) ยังทำได้ — ลงงวดปัจจุบัน
  await db.query("insert into shifts(id,shift_no,branch_id,opened_by,status,opening_cash) values($1,'SH-PC-NOW',$2,$3,'open',0)", [U(8), BR, ids.actor]);
  await db.query('select pos_issue_credit_note($1,$2)', [ids.actor, JSON.stringify({ client_uuid: U(304), kind: 'discount', order_id: old, amount: 20, reason: 'ชดเชย', refund_method: 'bank_transfer' })]); n++;
  // เปิดงวดใหม่ต้องมีเหตุผล → ปิดใหม่ได้ version 2 · เก็บ snapshot ทุก version
  await rejects(db.query('select pos_period_reopen($1,$2,$3,$4)', [APR, BR, today.prev, '']), 'period_reopen_reason_required');
  await db.query('select pos_period_reopen($1,$2,$3,$4)', [APR, BR, today.prev, 'ลงบิลตกหล่น']);
  await bill(6, 300, 0, lastMonth);
  const c2 = (await db.query('select pos_period_close($1,$2,$3) r', [APR, BR, today.prev])).rows[0].r;
  eq(c2.version, 2, 'ปิดใหม่ = version 2'); eq(Number(c2.summary.net_sales), 500, 'version 2 รวมบิลที่ลงเพิ่ม');
  const vs = (await db.query("select string_agg(version||':'||((summary->>'net_sales')::numeric)::int, ',' order by version) v from pos_period_versions where branch_id=$1 and period=$2", [BR, today.prev])).rows[0].v;
  eq(vs, '1:200,2:500', 'เก็บรายงานทุก version'); n++;
  eq(Number((await db.query("select count(*) c from audit_logs where action in ('period_close','period_reopen') and branch_id=$1", [BR])).rows[0].c), 3, 'log ปิด/เปิดครบ'); n++;
  await db.exec('set role anon'); await rejects(db.query('select pos_period_reopen($1,$2,$3,$4)', [ids.actor, BR, today.prev, 'แอบเปิด']), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} period-close / posted-lock regressions (UAT T009 T036 T064 T068 T070: locked amounts/deletes/status, TI replace keeps history, net sales 850, stock equation 99, close/reopen versions, backdate blocked)`);
}
