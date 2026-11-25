// ใบกำกับภาษีเต็มรูป (0068) — เลขรันต่อเนื่อง, 1 บิล 1 ใบที่ใช้งาน, แก้ข้อมูล = ยกเลิกแล้วออกใหม่, ตรวจข้อมูลผู้ซื้อ
export async function testDocuments(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw e; } throw Error('Expected ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(5000 + n).padStart(12, '0')}`;
  const mk = async (n, status = 'completed') => { await db.query(`insert into orders(id,client_uuid,order_no,branch_id,cashier_id,status,channel,subtotal,grand_total,vat_amount) values($1,$1,$2,$3,$4,$5,'offline',1070,1070,70)`, [U(n), `DOC-${n}`, ids.branch, ids.actor, status]); return U(n); };
  const issue = (o, buyer, reason = null) => db.query('select pos_issue_tax_invoice($1,$2,$3,$4) r', [o, ids.actor, buyer, reason]).then((x) => x.rows[0].r);
  const buyer = { name: 'บริษัท ทดสอบ จำกัด', tax_id: '0-1055-12345-67-8', branch_no: '0', address: '99 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10110' };
  let n = 0;
  const o1 = await mk(1), o2 = await mk(2), o3 = await mk(3, 'voided');
  const a = await issue(o1, buyer);
  const period = (await db.query("select to_char(now() at time zone 'Asia/Bangkok','YYMM') p")).rows[0].p;
  eq(a.invoice_no, `TITEST-${period}-0001`, 'เลขใบแรก'); n++;
  eq((await issue(o1, buyer)).replay, true, 'ออกซ้ำข้อมูลเดิม = ใบเดิม'); n++;
  eq((await issue(o2, buyer)).invoice_no, `TITEST-${period}-0002`, 'เลขถัดไปไม่ข้าม'); n++;
  await rejects(issue(o1, { ...buyer, name: 'ชื่อใหม่ จำกัด' }), 'tax_invoice_exists'); n++;
  const c = await issue(o1, { ...buyer, name: 'ชื่อใหม่ จำกัด' }, 'ลูกค้าแจ้งชื่อผิด');
  eq(c.replaced, a.invoice_no, 'ใบใหม่อ้างใบเดิม'); eq(c.invoice_no, `TITEST-${period}-0003`, 'ใบแทนได้เลขใหม่');
  const rows = (await db.query('select status, buyer->>\'branch_no\' b, buyer->>\'tax_id\' t, amount_before_vat v from tax_invoices where order_id=$1 order by issued_at', [o1])).rows;
  eq(rows.map((r) => r.status).join(), 'cancelled,issued', 'ใบเดิมยกเลิก (ไม่ลบ)'); eq(rows[1].b, '00000', 'สำนักงานใหญ่ = 00000'); eq(rows[1].t, '0105512345678', 'เลขผู้เสียภาษีเฉพาะตัวเลข'); eq(Number(rows[1].v), 1000, 'ยอดก่อน VAT'); n++;
  await rejects(issue(o3, buyer), 'tax_invoice_order_not_eligible'); n++;
  await rejects(issue(o2, { ...buyer, tax_id: '123' }, 'x'), 'tax_invoice_buyer_tax_id'); n++;
  await rejects(issue(o2, { ...buyer, address: 'สั้น' }, 'x'), 'tax_invoice_buyer_address'); n++;
  await db.exec('set role anon'); await rejects(issue(o2, buyer), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} tax-invoice regressions (running number, one active, replace keeps history, buyer validation, eligibility, private RPC)`);
}
