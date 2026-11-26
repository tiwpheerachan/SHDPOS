// ค่าคอมมิชชัน (0082) — ขั้นยอด, บาท/ชิ้น vs %, สาขาที่มีสิทธิ์, หักคืน, ไม่นับของแถม, กฎเจาะจงชนะ (ไม่จ่ายซ้อน), ช่วงเวลา
export async function testCommission(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(9500 + n).padStart(12, '0')}`;
  const BRAND = U(1), CAT = U(2), B1 = U(3), B2 = U(4), PC1 = U(5), PC2 = U(6), PA = U(10), PB = U(11);
  await db.query("insert into brands(id,code,name) values($1,'CMB','CM Brand')", [BRAND]);
  await db.query("insert into categories(id,name_th) values($1,'หมวดคอม')", [CAT]);
  await db.query("insert into branches(id,code,name,name_th) values($1,'CM1','CM1','CM1'),($2,'CM2','CM2','CM2')", [B1, B2]);
  await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,'PC1','PC1','staff',$3),($2,'PC2','PC2','staff',$3)", [PC1, PC2, B1]);
  await db.query("insert into products(id,sku,name_th,price,cost,brand_id,category_id) values($1,'CM-A','A',1000,500,$3,$4),($2,'CM-B','B',200,100,$3,$4)", [PA, PB, BRAND, CAT]);
  let seq = 0;
  // บิล: lines=[{p, qty, price, gift?, returned?, sp?}] · grand = ผลรวม − billDisc
  const bill = async ({ branch = B1, sp = PC1, lines, billDisc = 0, status = 'completed', at = new Date() }) => {
    const id = U(100 + ++seq), sub = lines.filter((l) => !l.gift).reduce((s, l) => s + l.qty * l.price, 0);
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,cashier_id,salesperson_id,status,channel,subtotal,discount_total,grand_total,vat_amount,created_at) values($1,$1,$2,$3,$4,$4,$5,'offline',$6,$7,$8,0,$9)`, [id, `CM-${seq}`, branch, sp, status, sub, billDisc, sub - billDisc, at.toISOString()]);
    let k = 0;
    for (const l of lines) await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total,is_gift,returned_qty,salesperson_id) values($1,$2,$3,'x','x',$4,$5,$6,$7,$8,$9)`, [U(500 + seq * 10 + ++k), id, l.p, l.qty, l.price, l.gift ? 0 : l.qty * l.price, !!l.gift, l.returned ?? 0, l.sp ?? null]);
  };
  const save = (r) => db.query('select pos_save_commission_rule($1,$2) r', [ids.actor, JSON.stringify(r)]).then((x) => x.rows[0].r);
  const from = new Date(Date.now() - 10 * 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
  const report = async (branches = null) => (await db.query('select * from pos_commission_report($1,$2,$3)', [from, to, branches])).rows;
  const win = { starts_at: from, ends_at: to };
  let n = 0;

  // กฎ SKU A: บาท/ชิ้น ขั้น 1→50, 5→80 · เฉพาะสาขา B1
  const ra = await save({ name: 'คอม A', scope: 'sku', product_ids: [PA], branch_ids: [B1], basis: 'units', calc: 'per_unit', tiers: [{ min: 5, rate: 80 }, { min: 1, rate: 50 }], ...win });
  eq(ra.tiers[0].min, 1, 'ขั้นเรียงจากน้อยไปมาก');
  await bill({ lines: [{ p: PA, qty: 3, price: 1000 }] });
  await bill({ lines: [{ p: PA, qty: 2, price: 1000, returned: 1 }, { p: PA, qty: 1, price: 0, gift: true }] });   // คืน 1 · ของแถมไม่นับ
  await bill({ branch: B2, lines: [{ p: PA, qty: 10, price: 1000 }] });                                           // สาขาไม่มีสิทธิ์
  let r = (await report()).find((x) => x.rule_id === ra.id && x.employee_id === PC1);
  eq(Number(r.units), 4, 'ชิ้นสุทธิ = 3 + (2−1) · ไม่นับของแถม/สาขาอื่น'); eq(Number(r.rate), 50, 'ยังไม่ถึงขั้น 5'); eq(Number(r.commission), 200, '4×50'); eq(Number(r.next_min), 5, 'ขั้นถัดไป'); n++;
  await bill({ lines: [{ p: PA, qty: 1, price: 1000 }] });
  r = (await report()).find((x) => x.rule_id === ra.id && x.employee_id === PC1);
  eq(Number(r.units), 5, 'ครบ 5'); eq(Number(r.commission), 400, 'ถึงขั้น 5 → 5×80 ย้อนทั้งหมด'); eq(r.next_min, null, 'ขั้นสูงสุดแล้ว'); n++;

  // กฎหมวด: % ของยอด ขั้นตามยอดเงิน · SKU A ถูกกฎ SKU จับแล้ว (ไม่จ่ายซ้อน) · B ใช้กฎหมวด · ส่วนลดท้ายบิลเฉลี่ย
  const rc = await save({ name: 'คอมหมวด', scope: 'category', brand_id: BRAND, category_id: CAT, basis: 'sales', calc: 'percent', tiers: [{ min: 0, rate: 2 }, { min: 1000, rate: 5 }], ...win });
  await bill({ sp: PC2, lines: [{ p: PB, qty: 5, price: 200 }, { p: PA, qty: 1, price: 1000 }], billDisc: 200 });  // ยอด 2000 − 200 → B ได้ 1000×0.9 = 900
  const all = await report();
  const c2 = all.find((x) => x.rule_id === rc.id && x.employee_id === PC2);
  eq(Number(c2.sales), 900, 'ยอด B หลังเฉลี่ยส่วนลดท้ายบิล'); eq(Number(c2.rate), 2, 'ยังไม่ถึง 1000'); eq(Number(c2.commission), 18, '900×2%'); n++;
  // A ที่ขายสาขา B1 อยู่กฎ SKU (ไม่ซ้อน) · A ที่ขายสาขา B2 (กฎ SKU ไม่ครอบ) ตกไปกฎหมวดที่ครอบทุกสาขา
  eq(Number(all.find((x) => x.rule_id === rc.id && x.employee_id === PC1).sales), 10000, 'A ของ PC1 ในกฎหมวด = เฉพาะบิลสาขา B2');
  eq(Number(all.find((x) => x.rule_id === ra.id && x.employee_id === PC2).units), 1, 'A ของ PC2 อยู่กฎ SKU'); n++;

  // พนักงานขายรายบรรทัดชนะของบิล · บิลยกเลิกไม่นับ · กรองสาขา
  await bill({ sp: PC1, lines: [{ p: PB, qty: 1, price: 200, sp: PC2 }] });
  await bill({ sp: PC2, status: 'voided', lines: [{ p: PB, qty: 50, price: 200 }] });
  eq(Number((await report()).find((x) => x.rule_id === rc.id && x.employee_id === PC2).sales), 1100, 'บรรทัดของ PC2 นับให้ PC2 · บิลยกเลิกไม่นับ'); n++;
  const b2 = await report([B2]); eq(b2.length, 1, 'กรองสาขา B2'); eq(b2[0].rule_id, rc.id, 'B2 ได้เฉพาะกฎหมวด'); eq(Number(b2[0].commission), 500, '10000 ≥ 1000 → 5%'); n++;

  // ขั้นไม่ถูกต้อง · version · ปิดจาก anon
  await rejects(save({ name: 'ขั้นซ้ำ', scope: 'sku', product_ids: [PB], basis: 'units', calc: 'per_unit', tiers: [{ min: 1, rate: 1 }, { min: 1, rate: 2 }], ...win }), 'commission_invalid_tiers');
  await rejects(save({ name: 'เกิน 100%', scope: 'sku', product_ids: [PB], basis: 'units', calc: 'percent', tiers: [{ min: 1, rate: 120 }], ...win }), 'commission_invalid_tiers');
  await rejects(save({ ...ra, version: 999 }), 'commission_version_conflict'); n++;
  await save({ ...ra, status: 'paused' }); eq((await report()).some((x) => x.rule_id === ra.id), false, 'หยุดกฎ = ไม่คิด'); n++;
  await db.exec('set role anon'); await rejects(report(), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} commission regressions (tiers retroactive, per-unit vs %, eligible branches, returns/gifts/voids excluded, bill discount spread, line salesperson, no double rule)`);
}
