// รอบตรวจนับ (0072) — ตรงกับเคส UAT T055–T063 ในไฟล์ POS_ERP_Functions_UAT.xlsx
export async function testStockCount(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(7000 + n).padStart(12, '0')}`;
  const W1 = U(1), W2 = U(2), COUNTER = U(3), CHECKER = U(4), APPROVER = U(5), A = U(10), B = U(11), S = U(12), C = U(13);
  await db.query("insert into branches(id,code,name,name_th) values($1,'W1','W1','W1'),($2,'W2','W2','W2')", [W1, W2]);
  for (const [id, code] of [[COUNTER, 'CNT1'], [CHECKER, 'CNT2'], [APPROVER, 'APR1']]) await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,$2,$2,'manager',$3)", [id, code, W1]);
  await db.query("insert into products(id,sku,name_th,price,cost) values($1,'SKU-A','A',100,50),($2,'SKU-B','B',100,20),($3,'SKU-C','C',100,10)", [A, B, C]);
  await db.query("insert into products(id,sku,name_th,price,cost,track_serial) values($1,'SKU-S','S',1000,700,true)", [S]);
  const setQty = (b, p, q) => db.query('insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,$3) on conflict(branch_id,product_id) do update set qty_on_hand=excluded.qty_on_hand', [b, p, q]);
  const qty = async (b, p) => Number((await db.query('select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2', [b, p])).rows[0]?.q ?? 0);
  const open = (o = {}) => db.query('select pos_count_open($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [o.actor ?? COUNTER, o.branch ?? W1, o.type ?? 'products', o.scope ?? { product_ids: [A] }, o.mode ?? 'freeze', o.blind ?? true, o.thr ?? { qty: 5 }, o.note ?? null, o.assignees ?? []]).then((x) => x.rows[0].r);
  const rec = (s, lines, actor = COUNTER) => db.query('select pos_count_record($1,$2,$3) r', [actor, s, JSON.stringify(lines)]).then((x) => x.rows[0].r);
  const submit = (s, actor = COUNTER) => db.query('select pos_count_submit($1,$2) r', [actor, s]).then((x) => x.rows[0].r);
  const approve = (s, actor = APPROVER) => db.query('select pos_count_approve($1,$2,$3) r', [actor, s, null]).then((x) => x.rows[0].r);
  const cancel = (s, reason = 'ทดสอบยกเลิก', actor = COUNTER) => db.query('select pos_count_cancel($1,$2,$3) r', [actor, s, reason]).then((x) => x.rows[0].r);
  const line = async (s, p) => (await db.query('select * from pos_count_lines where session_id=$1 and product_id=$2', [s, p])).rows[0];
  const sess = async (s) => (await db.query('select * from pos_count_sessions where id=$1', [s])).rows[0];
  const recv = (b, p, d) => db.query("select apply_stock_movement($1,$2,'receive',$3)", [b, p, d]);
  let n = 0;

  // T055 ขอบเขต: นับเฉพาะ W1 · snapshot 100 · W2 ไม่ถูกแก้
  await setQty(W1, A, 100); await setQty(W2, A, 20);
  const s1 = await open();
  eq(Number((await line(s1.id, A)).snapshot_qty), 100, 'T055 snapshot W1'); eq(s1.lines, 1, 'T055 เฉพาะ SKU ในขอบเขต'); eq((await sess(s1.id)).blind, true, 'T055 blind'); n++;
  await rejects(open(), 'count_overlap'); n++;   // ห้ามเปิดรอบซ้อนสินค้าเดียวกัน

  // T060 freeze: ขาย/รับ/โอน ถูกบล็อกระหว่างนับ
  await rejects(db.query("insert into pos_checkout_holds(id,branch_id,actor_id,quote) values($1,$2,$3,$4)", [U(90), W1, ids.actor, { items: [{ product_id: A, qty: 1 }] }]), 'stock_frozen_for_count'); n++;
  await rejects(recv(W1, A, 10), 'stock_frozen_for_count');
  await rejects(db.query("select apply_stock_movement($1,$2,'transfer_out',-1)", [W1, A]), 'stock_frozen_for_count'); n++;
  await recv(W2, A, 1); eq(await qty(W2, A), 21, 'T060 freeze เฉพาะสาขาในรอบ'); await setQty(W2, A, 20); n++;

  // T058 ช่องว่าง ≠ 0
  await rejects(submit(s1.id), 'count_incomplete'); n++;
  // T063 ยกเลิกรอบ → ไม่ปรับสต๊อก + ปลด freeze
  await rec(s1.id, [{ product_id: A, qty: 97 }]);
  await rejects(cancel(s1.id, ''), 'count_cancel_reason_required');
  await cancel(s1.id); eq(await qty(W1, A), 100, 'T063 รอบยกเลิกไม่ปรับ'); await recv(W1, A, 0); n++;
  await rejects(approve(s1.id), 'count_wrong_status'); n++;

  // T056 นับขาด 97 → −3 ปรับครั้งเดียว · ผู้นับอนุมัติเองไม่ได้ · อนุมัติซ้ำไม่ปรับซ้ำ (T063)
  const s2 = await open();
  await rec(s2.id, [{ product_id: A, qty: 97 }]);
  eq((await submit(s2.id)).status, 'review', 'T056 −3 ไม่เกินเกณฑ์ 5 → ตรวจทาน');
  await rejects(approve(s2.id, COUNTER), 'approver_must_differ_from_counter'); n++;
  await approve(s2.id); eq(await qty(W1, A), 97, 'T056 stock 97');
  eq((await approve(s2.id)).duplicate, true, 'T063 Post ซ้ำ'); eq(await qty(W1, A), 97, 'T063 ไม่ปรับซ้ำ');
  eq(Number((await db.query("select count(*) c from stock_movements where ref_id=$1", [s2.id])).rows[0].c), 1, 'ledger 1 รายการ'); n++;
  const l2 = await line(s2.id, A); eq(Number(l2.variance), -3, 'T056 ส่วนต่าง'); eq(Number(l2.variance_value), -150, 'มูลค่า −3×50'); n++;
  await recv(W1, A, 1); eq(await qty(W1, A), 98, 'ปลด freeze หลังอนุมัติ'); await setQty(W1, A, 100); n++;

  // T057 นับเกิน 102 → +2 มูลค่าตามต้นทุน
  const s3 = await open(); await rec(s3.id, [{ product_id: A, qty: 102 }]); await submit(s3.id); await approve(s3.id);
  eq(await qty(W1, A), 102, 'T057 stock 102'); eq(Number((await sess(s3.id)).result.value_plus), 100, 'T057 มูลค่า +2×50'); n++;

  // T058 กรอก 0 = นับจริง → −10
  await setQty(W1, B, 10);
  const s4 = await open({ scope: { product_ids: [B] }, thr: { qty: 100 } });
  await rec(s4.id, [{ product_id: B, qty: null }]); await rejects(submit(s4.id), 'count_incomplete');
  await rec(s4.id, [{ product_id: B, qty: 0 }]); await submit(s4.id); await approve(s4.id); eq(await qty(W1, B), 0, 'T058 ศูนย์ = นับจริง'); n++;

  // T059 เกินเกณฑ์ 2 → นับซ้ำโดยอีกคน · เก็บทั้งสองรอบ · ใช้ยอดสุดท้าย 98
  await setQty(W1, A, 100);
  const s5 = await open({ thr: { qty: 2 } });
  await rec(s5.id, [{ product_id: A, qty: 95 }]);
  eq((await submit(s5.id)).status, 'recount', 'T059 ไม่ Post รอบแรก'); eq(await qty(W1, A), 100, 'T059 ยังไม่ปรับ');
  await rejects(approve(s5.id), 'count_wrong_status');
  await rejects(rec(s5.id, [{ product_id: A, qty: 98 }], COUNTER), 'recount_must_be_other_counter'); n++;
  await rec(s5.id, [{ product_id: A, qty: 98 }], CHECKER); eq((await submit(s5.id, CHECKER)).status, 'review', 'รอบ 2 = ค่าสุดท้าย');
  await rejects(approve(s5.id, CHECKER), 'approver_must_differ_from_counter');
  await approve(s5.id); const l5 = await line(s5.id, A);
  eq(Number(l5.count1), 95, 'เก็บรอบ 1'); eq(Number(l5.count2), 98, 'เก็บรอบ 2'); eq(await qty(W1, A), 98, 'T059 stock 98'); n++;

  // T061 ไม่ freeze: นับ 97 ณ T1 แล้วรับเข้า 10 → หลัง Post 107 (ไม่ทับยอดรับ)
  await setQty(W1, A, 100);
  const s6 = await open({ mode: 'cutoff' });
  await rec(s6.id, [{ product_id: A, qty: 97 }]);
  await recv(W1, A, 10); eq(await qty(W1, A), 110, 'T061 รับเข้าได้ระหว่างนับ');
  await submit(s6.id); await approve(s6.id);
  eq(Number((await line(s6.id, A)).variance), -3, 'T061 ส่วนต่าง ณ T1'); eq(await qty(W1, A), 107, 'T061 stock 107'); n++;

  // T062 SN: สแกนซ้ำ / SN เดียวกันสองสินค้า / SN หาย → missing ตัดสต๊อก / SN เกิน → ไม่เพิ่มเอง
  await setQty(W1, S, 3);
  for (const sn of ['SN-1', 'SN-2', 'SN-3']) await db.query("insert into serials(product_id,serial_no,branch_id,status) values($1,$2,$3,'in_stock')", [S, sn, W1]);
  await setQty(W1, C, 5);
  const s7 = await open({ scope: { product_ids: [S, C] }, thr: { qty: 0 }, assignees: [COUNTER, CHECKER] });
  await rejects(rec(s7.id, [{ product_id: S, qty: 3 }]), 'serial_scan_required');
  await rejects(rec(s7.id, [{ product_id: S, sns: ['SN-1', 'sn-1 '] }]), 'serial_duplicate_scan'); n++;
  await rejects(rec(s7.id, [{ product_id: S, sns: ['SN-1'] }], APPROVER), 'count_not_assignee'); n++;
  await rec(s7.id, [{ product_id: S, sns: ['SN-1', 'SN-2', 'SN-X'] }, { product_id: C, qty: 5 }]);
  eq((await submit(s7.id)).status, 'recount', 'SN ไม่ตรง → นับซ้ำ');
  await rec(s7.id, [{ product_id: S, sns: ['SN-1', 'SN-2', 'SN-X'] }], CHECKER); await submit(s7.id, CHECKER);
  const l7 = await line(s7.id, S);
  eq(l7.missing_sns.join(), 'SN-3', 'SN หาย'); eq(l7.extra_sns.join(), 'SN-X', 'SN เกิน');
  await approve(s7.id);
  eq(await qty(W1, S), 2, 'ตัดเฉพาะ SN หาย (SN เกินไม่เพิ่มเอง)');
  eq((await db.query("select status from serials where serial_no='SN-3'")).rows[0].status, 'missing', 'SN-3 = missing');
  eq(Number((await sess(s7.id)).result.extra_sns), 1, 'รายงาน SN เกิน'); n++;

  // SN: ยอดระบบมากกว่า SN ที่รู้จัก (SN อยู่คลังกลาง) → ส่วนขาดยังถูกรายงาน/ปรับ · SN เกินไม่บวก
  const S2 = U(17);
  await db.query("insert into products(id,sku,name_th,price,cost,track_serial) values($1,'SKU-S2','S2',1000,100,true)", [S2]);
  await setQty(W1, S2, 5);
  await db.query("insert into serials(product_id,serial_no,branch_id,status) values($1,'Q-1',$2,'in_stock')", [S2, W1]);
  const s11 = await open({ scope: { product_ids: [S2] }, thr: { qty: 100 }, mode: 'cutoff' });
  await rec(s11.id, [{ product_id: S2, sns: ['Q-1', 'Q-NEW'] }]);
  await submit(s11.id); await rec(s11.id, [{ product_id: S2, sns: ['Q-1', 'Q-NEW'] }], CHECKER); await submit(s11.id, CHECKER);
  eq(Number((await line(s11.id, S2)).variance), -3, 'นับ 2 จากระบบ 5 → ขาด 3 (ไม่ใช่ 0)');
  await approve(s11.id); eq(await qty(W1, S2), 2, 'ปรับเหลือ 2 ตามที่เห็นจริง'); n++;

  // กระทบยอดราย SN (0073): ขายแล้วแต่ยังอยู่ร้าน / ของสาขาอื่น / สินค้าอื่น / ไม่รู้จัก / หาย / ตรง
  const S3 = U(18), ORD = U(19);
  await db.query("insert into products(id,sku,name_th,price,cost,track_serial) values($1,'SKU-S3','S3',1000,100,true)", [S3]);
  await db.query("insert into orders(id,client_uuid,order_no,branch_id,cashier_id,status,channel,subtotal,grand_total,vat_amount) values($1,$1,'BILL-SOLD-1',$2,$3,'completed','offline',1,1,0)", [ORD, W1, ids.actor]);
  await db.query(`insert into serials(product_id,serial_no,branch_id,status,sold_order_id) values
    ($1,'R-OK',$2,'in_stock',null),($1,'R-LOST',$2,'in_stock',null),($1,'R-SOLD',$2,'sold',$4),($1,'R-W2',$3,'defective',null),($5,'R-OTHER',$2,'in_stock',null)`, [S3, W1, W2, ORD, S]);
  await setQty(W1, S3, 2);
  const s12 = await open({ scope: { product_ids: [S3] }, thr: { qty: 100 } });
  await rec(s12.id, [{ product_id: S3, sns: ['R-OK', 'R-SOLD', 'R-W2', 'R-OTHER', 'R-NOPE'] }]);
  const sub12 = await submit(s12.id);
  const chk = Object.fromEntries((await line(s12.id, S3)).sn_check.map((c) => [c.sn, c]));
  eq(chk['R-OK'].verdict, 'match', 'SN ตรง'); eq(chk['R-LOST'].verdict, 'missing', 'SN หาย');
  eq(chk['R-SOLD'].verdict, 'sold', 'ขายแล้วแต่ยังอยู่ร้าน'); eq(chk['R-SOLD'].ref, 'BILL-SOLD-1', 'อ้างเลขบิลที่ขาย');
  eq(chk['R-W2'].verdict, 'other_branch', 'ของสาขาอื่น'); eq(chk['R-OTHER'].verdict, 'wrong_product', 'SN ของสินค้าอื่น'); eq(chk['R-OTHER'].other_sku, 'SKU-S', 'บอก SKU จริง');
  eq(chk['R-NOPE'].verdict, 'unknown', 'ไม่รู้จัก'); eq(sub12.sn_summary.sold, 1, 'สรุปจำนวน sold'); eq(sub12.status, 'recount', 'SN ไม่ตรง → นับซ้ำ');
  eq(Number((await line(s12.id, S3)).variance), -1, 'ผลต่าง = −SN หาย (SN เกินไม่บวก)'); n++;
  await cancel(s12.id);

  // สาขาผูกคลังกลาง: ต้องมีผลตรวจ SN จาก OW ก่อนส่ง · ขาด = ยอดระบบ − SN ที่ตรง
  const S4 = U(20), W4 = U(21);
  await db.query("insert into branches(id,code,name,name_th) values($1,'W4','W4','W4')", [W4]);
  await db.query("insert into pos_warehouse_links(source,warehouse_id,branch_id,updated_by) values('test','WH-W4',$1,$2)", [W4, ids.actor]);
  await db.query("insert into products(id,sku,name_th,price,cost,track_serial) values($1,'SKU-S4','S4',1000,100,true)", [S4]);
  await setQty(W4, S4, 5);
  const s13 = await open({ branch: W4, scope: { product_ids: [S4] }, thr: { qty: 100 } });
  await rec(s13.id, [{ product_id: S4, sns: ['O-1', 'O-2'] }]);
  await rejects(submit(s13.id), 'count_sn_unverified'); n++;
  await db.query('select pos_count_set_sn_check($1,$2,$3)', [s13.id, S4, JSON.stringify([{ sn: 'O-1', verdict: 'match' }, { sn: 'O-2', verdict: 'sold', ref: 'JST-1' }])]);
  await submit(s13.id); const l13 = await line(s13.id, S4);
  eq(Number(l13.variance), -4, 'OW: ตรง 1 จากระบบ 5 → ขาด 4'); eq(l13.extra_sns.join(), 'O-2', 'OW: SN ผิดปกติ'); n++;
  await cancel(s13.id);

  // ข้ามรายการต้องมีเหตุผล · ข้ามแล้วไม่ปรับ
  await setQty(W1, C, 5);
  const s8 = await open({ scope: { product_ids: [C] } });
  await rejects(rec(s8.id, [{ product_id: C, skip: true, skip_reason: '' }]), 'count_skip_reason_required');
  await rec(s8.id, [{ product_id: C, skip: true, skip_reason: 'ของอยู่ระหว่างซ่อม' }]); await submit(s8.id); await approve(s8.id);
  eq(await qty(W1, C), 5, 'ข้าม = ไม่ปรับ'); n++;

  // สาขาผูก OneWarehouse: อนุมัติเป็นรายงาน ไม่แตะยอด POS
  await db.query("insert into pos_warehouse_links(source,warehouse_id,branch_id,updated_by) values('test','WH-W2',$1,$2)", [W2, ids.actor]);
  const s9 = await open({ branch: W2 }); await rec(s9.id, [{ product_id: A, qty: 15 }]); await submit(s9.id); await approve(s9.id);
  eq(await qty(W2, A), 20, 'OW: ไม่ปรับยอด POS'); eq((await sess(s9.id)).posted, false, 'OW: posted=false'); n++;

  // ทั้งร้าน: สินค้าปิดขายแต่ยังมีของ ต้องอยู่ในรอบ · ปิดขายและไม่มีของ ไม่ต้องนับ
  const D = U(14), E = U(15), W3 = U(16);
  await db.query("insert into branches(id,code,name,name_th) values($1,'W3','W3','W3')", [W3]);
  await db.query("insert into products(id,sku,name_th,price,cost,is_active) values($1,'SKU-D','D',1,1,false),($2,'SKU-E','E',1,1,false)", [D, E]);
  await setQty(W3, D, 4); await setQty(W3, E, 0);
  const s10 = await open({ branch: W3, type: 'full', scope: {} });
  eq(s10.lines, 1, 'ทั้งร้าน = เฉพาะที่มีของ (รวมสินค้าปิดขาย)'); eq(!!(await line(s10.id, D)), true, 'สินค้าปิดขายที่มีของถูกนับ'); n++;
  await cancel(s10.id);

  // ขอบเขต: หมวด/แบรนด์ว่าง → ปฏิเสธ · RPC ปิดจาก anon
  await rejects(open({ type: 'category', scope: { category_id: U(99) } }), 'count_empty_scope');
  await db.exec('set role anon'); await rejects(open({ scope: { product_ids: [C] } }), 'permission denied'); await db.exec('reset role'); n++;
  eq(Number((await db.query("select count(*) c from audit_logs where action='stock_count'")).rows[0].c) > 10, true, 'audit ครบทุกขั้น'); n++;
  console.log(`PASS: ${n} stock-count regressions (UAT T055–T063: scope/blind, freeze, blank≠0, recount by other, cut-off, SN, cancel, idempotent post, approver≠counter, OW report-only)`);
}
