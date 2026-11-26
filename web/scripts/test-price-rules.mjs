// ราคาช่วงเวลา (0081) — ตัวคิดราคากลาง + ลำดับความสำคัญ + ปัดเศษ + ช่วงเวลา/สาขา + บันทึก/ราคาหลัก
export async function testPriceRules(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(9000 + n).padStart(12, '0')}`;
  const BRAND = U(1), CAT = U(2), B1 = U(3), B2 = U(4), P1 = U(10), P2 = U(11), P3 = U(12);
  await db.query("insert into brands(id,code,name) values($1,'PRB','PR Brand')", [BRAND]);
  await db.query("insert into categories(id,name_th) values($1,'หมวดทดสอบราคา')", [CAT]);
  await db.query("insert into branches(id,code,name,name_th) values($1,'PR1','PR1','PR1'),($2,'PR2','PR2','PR2')", [B1, B2]);
  await db.query("insert into products(id,sku,name_th,price,cost,brand_id,category_id) values($1,'PR-A','A',1990,1000,$4,$5),($2,'PR-B','B',990,500,$4,$5),($3,'PR-C','C',500,200,$4,null)", [P1, P2, P3, BRAND, CAT]);
  const save = (rule, actor = ids.actor) => db.query('select pos_save_price_rule($1,$2) r', [actor, JSON.stringify(rule)]).then((x) => x.rows[0].r);
  const eff = async (branch, at = new Date().toISOString()) => Object.fromEntries((await db.query('select * from pos_effective_prices($1,$2,$3)', [branch, [P1, P2, P3], at])).rows.map((r) => [r.product_id, r]));
  const now = Date.now(), day = 86400000;
  const win = (a, b) => ({ starts_at: new Date(now + a * day).toISOString(), ends_at: new Date(now + b * day).toISOString() });
  let n = 0;

  // ไม่มีกฎ = ราคาหลัก
  let e = await eff(B1); eq(Number(e[P1].price), 1990, 'ไม่มีกฎ = ราคาหลัก'); eq(e[P1].rule_id, null, 'ไม่มีกฎ'); n++;

  // ลด % ทั้งหมวด + ปัดเศษแบบต่าง ๆ
  const cat = await save({ name: 'โปรเดือนนี้ หมวด', price_type: 'monthly', scope: 'category', brand_id: BRAND, category_id: CAT, mode: 'percent', value: 15, rounding: 'baht', ...win(-1, 10) });
  e = await eff(B1); eq(Number(e[P1].price), 1692, '1990 −15% ปัดบาท = 1691.5→1692'); eq(Number(e[P2].price), 842, '990 −15% = 841.5→842'); eq(Number(e[P3].price), 500, 'นอกหมวดไม่โดน'); n++;
  await save({ ...cat, rounding: 'end9', version: cat.version }); e = await eff(B1); eq(Number(e[P1].price), 1689, 'ปัดลงท้าย 9'); n++;
  const c2 = (await db.query('select * from pos_price_rules where id=$1', [cat.id])).rows[0];
  await save({ ...c2, product_ids: [], rounding: 'down10', version: c2.version }); e = await eff(B1); eq(Number(e[P1].price), 1690, 'ปัดลงหลักสิบ'); n++;
  await rejects(save({ ...c2, version: c2.version }), 'price_rule_version_conflict'); n++;   // version เก่า

  // SKU ชนะหมวด · ตั้งราคาเลย
  await save({ name: 'ราคาพิเศษ A', price_type: 'event', scope: 'sku', product_ids: [P1], mode: 'price', value: 1499, rounding: 'none', ...win(-1, 5) });
  e = await eff(B1); eq(Number(e[P1].price), 1499, 'SKU ชนะหมวด'); eq(e[P1].price_type, 'event', 'ประเภทราคา'); eq(Number(e[P2].price), 840, 'B ยังใช้กฎหมวด (down10)'); n++;

  // จำกัดสาขา + ลดเป็นบาท
  await save({ name: 'เฉพาะสาขา 2', scope: 'sku', product_ids: [P3], mode: 'amount', value: 100, branch_ids: [B2], ...win(-1, 5) });
  eq(Number((await eff(B1))[P3].price), 500, 'สาขาอื่นไม่โดน'); eq(Number((await eff(B2))[P3].price), 400, 'สาขาที่กำหนด −100'); n++;

  // ช่วงเวลา: หมดอายุ / ยังไม่เริ่ม
  eq(Number((await eff(B1, new Date(now + 20 * day).toISOString()))[P1].price), 1990, 'หลังหมดช่วง = ราคาหลัก');
  await save({ name: 'เดือนหน้า', scope: 'sku', product_ids: [P2], mode: 'price', value: 777, ...win(30, 60) });
  eq(Number((await eff(B1))[P2].price), 840, 'ยังไม่เริ่ม = ไม่ใช้'); eq(Number((await eff(B1, new Date(now + 31 * day).toISOString()))[P2].price), 777, 'ถึงช่วง = ใช้'); n++;

  // ลดจนติดลบ = ไม่ใช้กฎ · หยุดกฎ = กลับราคาหลัก
  await save({ name: 'ลดเกิน', scope: 'sku', product_ids: [P3], mode: 'amount', value: 9999, ...win(-1, 5) });
  eq(Number((await eff(B1))[P3].price), 500, 'ราคาติดลบ = ข้ามกฎ'); n++;
  const sku = (await db.query("select * from pos_price_rules where name='ราคาพิเศษ A'")).rows[0];
  await save({ ...sku, status: 'paused', version: sku.version }); eq(Number((await eff(B1))[P1].price), 1690, 'หยุดกฎ SKU → กลับไปกฎหมวด'); n++;

  // ข้อมูลไม่ถูกต้อง
  await rejects(save({ name: 'x', scope: 'sku', product_ids: [P1], mode: 'percent', value: 10, ...win(0, 1) }), 'check');
  await rejects(save({ name: 'ลด 120%', scope: 'sku', product_ids: [P1], mode: 'percent', value: 120, ...win(0, 1) }), 'check');
  await rejects(save({ name: 'ช่วงกลับหัว', scope: 'sku', product_ids: [P1], mode: 'price', value: 10, ...win(2, 1) }), 'check');
  await rejects(save({ name: 'ไม่มีสินค้า', scope: 'sku', product_ids: [], mode: 'price', value: 10, ...win(0, 1) }), 'price_rule_products_required'); n++;

  // ราคาหลัก: ต้องมีเหตุผล · กฎ % คิดจากราคาหลักใหม่ทันที · audit
  await rejects(db.query('select pos_set_list_price($1,$2,$3,$4)', [ids.actor, P2, 1090, '']), 'list_price_reason_required');
  await db.query('select pos_set_list_price($1,$2,$3,$4)', [ids.actor, P2, 1090, 'ปรับตามราคาตลาด']);
  eq(Number((await eff(B1))[P2].price), 920, '1090 −15% = 926.5 → ปัดลงหลักสิบ 920'); n++;
  eq(Number((await db.query("select count(*) c from audit_logs where action in ('price_rule_create','price_rule_update','list_price_update')")).rows[0].c) >= 8, true, 'audit ครบ'); n++;
  await db.exec('set role anon'); await rejects(eff(B1), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} price-rule regressions (list vs period price, SKU>category>brand, rounding, branch/time window, version, list-price change, private RPC)`);
}
