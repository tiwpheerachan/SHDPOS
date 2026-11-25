// ใบลดหนี้ (0074) — ตามเคส UAT T042–T044
export async function testCreditNotes(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(8000 + n).padStart(12, '0')}`;
  const BR = U(1), P = U(2), SHIFT = U(3), APPROVER = U(4);
  await db.query("insert into branches(id,code,name,name_th) values($1,'CN1','CN1','CN1')", [BR]);
  await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,'CNAPR','Apr','manager',$2)", [APPROVER, BR]);
  await db.query("insert into products(id,sku,name_th,price,cost) values($1,'CN-SKU','CN',100,50)", [P]);
  await db.query("insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,8)", [BR, P]);
  await db.query("insert into shifts(id,shift_no,branch_id,opened_by,status,opening_cash) values($1,'SH-CN-1',$2,$3,'open',1000)", [SHIFT, BR, ids.actor]);
  // บิล: qty × 100 รวม VAT 7%
  const bill = async (n, qty) => {
    const id = U(100 + n), total = 100 * qty, vat = Math.round((total - total / 1.07) * 100) / 100;
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,cashier_id,status,channel,subtotal,grand_total,vat_amount,shift_id) values($1,$1,$2,$3,$4,'completed','offline',$5,$5,$6,$7)`, [id, `CNB-${n}`, BR, ids.actor, total, vat, SHIFT]);
    await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total) values($1,$2,$3,'CN-SKU','CN',$4,100,$5)`, [U(200 + n), id, P, qty, total]);
    await db.query(`insert into order_payments(order_id,method,amount) values($1,'cash',$2)`, [id, total]);
    return id;
  };
  const cn = (payload, actor = ids.actor) => db.query('select pos_issue_credit_note($1,$2) r', [actor, JSON.stringify(payload)]).then((x) => x.rows[0].r);
  const cash = async () => Number((await db.query("select coalesce(sum(amount),0) s from cash_movements where shift_id=$1 and type='cash_out'", [SHIFT])).rows[0].s);
  const qty = async () => Number((await db.query('select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2', [BR, P])).rows[0].q);
  const ret = async (orderId, n, q, approve = true) => {
    const it = (await db.query('select id from order_items where order_id=$1', [orderId])).rows[0].id;
    const r = (await db.query('select pos_return_request($1,$2) r', [ids.actor, JSON.stringify({ client_uuid: U(300 + n), order_client_uuid: orderId, kind: 'return', type: 'refund', refund_method: 'cash', reason_code: 'test', items: [{ order_item_id: it, qty: q, condition: 'sellable' }] })])).rows[0].r;
    if (approve) await db.query('select pos_return_decide($1,$2,true,$3)', [r.return_id, APPROVER, 'ok']);
    return r;
  };
  const period = (await db.query("select to_char(now() at time zone 'Asia/Bangkok','YYMM') p")).rows[0].p;
  let n = 0;

  // T042 ลดหนี้ส่วนลด 100 จากบิล 1000 ไม่คืนสินค้า → เหลือ 900 · สต๊อกไม่ขยับ · ไม่สร้างใบรับคืน
  const b1 = await bill(1, 10);
  const stock0 = await qty(), cash0 = await cash();
  const c1 = await cn({ client_uuid: U(401), kind: 'discount', order_id: b1, amount: 100, reason: 'ชดเชยส่งล่าช้า', refund_method: 'cash' });
  eq(c1.cn_no, `CNCN1-${period}-0001`, 'เลข CN รันต่อเนื่อง'); eq(Number(c1.remaining), 900, 'T042 คงเหลือ 900'); n++;
  eq(await qty(), stock0, 'T042 สต๊อกไม่ขยับ'); eq(Number((await db.query('select count(*) c from returns where order_id=$1', [b1])).rows[0].c), 0, 'ไม่สร้างใบรับคืนปลอม'); n++;
  eq(await cash() - cash0, 100, 'คืนเงินสดออกจากลิ้นชักกะ'); n++;
  const row1 = (await db.query('select amount_vat, amount_before_vat from credit_notes where id=$1', [c1.id])).rows[0];
  eq(Number(row1.amount_vat), 6.54, 'VAT ของส่วนลด'); eq(Number(row1.amount_before_vat), 93.46, 'ก่อน VAT'); n++;
  eq((await cn({ client_uuid: U(401), kind: 'discount', order_id: b1, amount: 100, reason: 'ชดเชยส่งล่าช้า', refund_method: 'cash' })).replay, true, 'ส่งซ้ำ = ใบเดิม ไม่คืนเงินซ้ำ');
  eq(await cash() - cash0, 100, 'ไม่คืนเงินซ้ำ'); n++;

  // T044 ลดหนี้ไปแล้ว 300 → ขอเพิ่ม 800 ต้องถูกบล็อก (เหลือได้ 700)
  const b2 = await bill(2, 10);
  await cn({ client_uuid: U(402), kind: 'discount', order_id: b2, amount: 300, reason: 'ส่วนลดหลังขาย', refund_method: 'bank_transfer' });
  await rejects(cn({ client_uuid: U(403), kind: 'discount', order_id: b2, amount: 800, reason: 'เกิน', refund_method: 'bank_transfer' }), 'credit_note_exceeds: 700'); n++;
  await rejects(cn({ client_uuid: U(404), kind: 'discount', order_id: b2, amount: 50, reason: '', refund_method: 'cash' }), 'credit_note_reason_required');
  await rejects(cn({ client_uuid: U(405), kind: 'discount', order_id: b2, amount: 50, reason: 'ok ok', refund_method: 'gift_card' }), 'credit_note_refund_method'); n++;
  // รับคืนหลังลดหนี้: คืนครบ 10 ชิ้น ได้คืนสูงสุด 700 (ไม่ใช่ 1000)
  const r2 = await ret(b2, 2, 10);
  eq(Number(r2.refund_amount), 700, 'คืนของหลังลดหนี้ หักส่วนที่ลดแล้ว'); n++;
  await rejects(db.query('select pos_return_request($1,$2)', [ids.actor, JSON.stringify({ client_uuid: U(399), order_client_uuid: b1, kind: 'void' })]), 'void_has_credit_notes'); n++;

  // T043 ขายเงินสด 2×100 → รับคืน 1 + ออก CN 100 → stock +1 ครั้งเดียว · คืนเงิน 100 ครั้งเดียว
  const b3 = await bill(3, 2);
  const s3 = await qty(), c3 = await cash();
  const r3 = await ret(b3, 3, 1);
  eq(await qty(), s3 + 1, 'T043 stock +1'); eq(await cash() - c3, 100, 'คืนเงิน 100');
  const c3b = await cn({ client_uuid: U(406), kind: 'return', order_id: b3, return_id: r3.return_id });
  eq(Number(c3b.amount), 100, 'CN = ยอดรับคืน'); eq(Number(c3b.refund), 0, 'CN จากการรับคืนไม่คืนเงินซ้ำ');
  eq(await qty(), s3 + 1, 'ออก CN ไม่ขยับสต๊อกซ้ำ'); eq(await cash() - c3, 100, 'ไม่คืนเงินซ้ำ'); n++;
  eq((await cn({ client_uuid: U(407), kind: 'return', order_id: b3, return_id: r3.return_id })).replay, true, '1 ใบรับคืน = 1 CN'); n++;

  // บิลที่มีใบกำกับเต็มรูป: รับคืนเสร็จ → CN อัตโนมัติ อ้างใบกำกับ
  const b4 = await bill(4, 3);
  const buyer = { name: 'บริษัท ทดสอบ จำกัด', tax_id: '0105512345678', branch_no: '0', address: '99 ถนนทดสอบ เขตทดสอบ กรุงเทพฯ 10110' };
  await db.query('select pos_issue_tax_invoice($1,$2,$3,null)', [b4, ids.actor, buyer]);
  const r4 = await ret(b4, 4, 1);
  const auto = (await db.query('select c.kind, c.amount_total, t.invoice_no from credit_notes c join tax_invoices t on t.id=c.tax_invoice_id where c.return_id=$1', [r4.return_id])).rows[0];
  eq(auto?.kind, 'return', 'CN อัตโนมัติเมื่อบิลมีใบกำกับ'); eq(Number(auto.amount_total), 100, 'ยอด CN อัตโนมัติ'); n++;
  // บิลไม่มีใบกำกับ → ไม่ออก CN อัตโนมัติ (ใช้ใบรับคืน)
  eq(Number((await db.query('select count(*) c from credit_notes where return_id=$1', [r3.return_id])).rows[0].c), 1, 'b3 มี CN เฉพาะที่ออกเอง'); n++;

  // เงินสดต้องมีกะเปิด · RPC ปิดจาก anon
  await db.query("update shifts set status='closed' where id=$1", [SHIFT]);
  const b5 = await bill(5, 1);
  await rejects(cn({ client_uuid: U(408), kind: 'discount', order_id: b5, amount: 10, reason: 'ทดสอบ', refund_method: 'cash' }), 'credit_note_no_open_shift');
  await db.exec('set role anon'); await rejects(cn({ client_uuid: U(409), kind: 'discount', order_id: b5, amount: 10, reason: 'ทดสอบ', refund_method: 'bank_transfer' }), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} credit-note regressions (UAT T042–T044: discount CN no stock, return CN no double refund/stock, cap incl. later returns, auto CN on tax-invoiced returns, idempotent, cash needs shift)`);
}
