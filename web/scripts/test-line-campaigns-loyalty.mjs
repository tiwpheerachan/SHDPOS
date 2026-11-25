// โปรรายสินค้า (0060 pos_apply_line_campaigns / pos_quote_with_lines) + แต้มสะสม (0061 pos_loyalty_calc) บน schema จริงทั้งหมด
// เรียกจาก test-full-schema.mjs (ต่อจาก migration ครบทุกไฟล์)
export async function testLineCampaignsLoyalty(db) {
  const assert = (ok, msg) => { if (!ok) throw Error(msg); };
  const eq = (a, b, msg) => { if (a !== b) throw Error(`${msg}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, message) { try { await p; } catch (e) { if (e.message.includes(message)) return; throw e; } throw Error('Expected ' + message); }
  const U = (n) => `00000000-0000-4000-8000-${String(3000 + n).padStart(12, '0')}`;
  const BRAND = U(1), BRAND2 = U(2), BR = U(3), BR2 = U(4), PA = U(5), PB = U(6), PC = U(7), CAT = U(8), CUST = U(9);
  await db.query("insert into brands(id,code,name) values($1,'LB1','Brand 1'),($2,'LB2','Brand 2')", [BRAND, BRAND2]);
  await db.query("insert into branches(id,code,name,name_th,brand_id) values($1,'LC1','Line 1','Line 1',$3),($2,'LC2','Line 2','Line 2',$4)", [BR, BR2, BRAND, BRAND2]);
  await db.query("insert into categories(id,name_th) values($1,'หมวดทดสอบ')", [CAT]);
  await db.query("insert into products(id,sku,name_th,price,cost,brand_id,category_id) values($1,'LA','A',100,40,$4,$5),($2,'LB','B',50,20,$4,null),($3,'LC','C',200,80,$6,null)", [PA, PB, PC, BRAND, CAT, BRAND2]);
  await db.query("insert into customers(id,name,points) values($1,'Loyalty UAT',0)", [CUST]);
  let n = 0;
  const line = (product, sku, qty, price, code, manual = 0) => ({ product_id: product, sku, name: sku, kind: 'goods', qty, unit_price: price, discount_amount: manual,
    line_total: qty * price - manual, unit_cost: 0, cost_total: 0, gross_profit: 0, serials: [], ...(code ? { line_campaign_code: code } : {}) });
  const quote = (items, extra = {}) => { const gross = items.reduce((s, i) => s + i.line_total, 0); return { branch_id: BR, client_uuid: U(900 + n), channel: 'offline', subtotal: gross, discount_total: items.reduce((s, i) => s + i.discount_amount, 0), grand_total: gross, vat_amount: 0, items, ...extra }; };
  const apply = async (q, branch = BR) => (await db.query('select pos_apply_line_campaigns($1,$2,$3) r', [q.client_uuid, branch, q])).rows[0].r;
  const camp = async (id, code, f = {}) => {
    const c = { discount_type: 'amount', discount_value: 10, max_discount: null, min_spend: 0, eligible_scope: 'selected', eligible_min_qty: 1, branch_ids: [], channels: [], starts_at: null, ends_at: null, target_segment: 'all', per_customer_limit: null, usage_limit: null, ...f };
    await db.query(`insert into campaigns(id,name,code,discount_type,discount_value,max_discount,min_spend,eligible_scope,eligible_min_qty,branch_ids,channels,starts_at,ends_at,target_segment,per_customer_limit,usage_limit,active,promo_type)
      values($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,'discount')`, [id, code, c.discount_type, c.discount_value, c.max_discount, c.min_spend, c.eligible_scope, c.eligible_min_qty, c.branch_ids, c.channels, c.starts_at, c.ends_at, c.target_segment, c.per_customer_limit, c.usage_limit]);
    for (const p of f.products ?? [PA]) await db.query("insert into campaign_products(campaign_id,product_id,sku,role) values($1,$2,'X','eligible')", [id, p]);
  };
  const t = async (name, fn) => { try { await fn(); n++; } catch (e) { throw Error(`[${name}] ${e.message}`); } };

  // ---------- โปรรายสินค้า ----------
  await camp(U(20), 'LAMT10');                                                       // ลด 10 บาท/ชิ้น
  await camp(U(21), 'LPCT10', { discount_type: 'percent', discount_value: 10, products: [PA, PB] });
  await camp(U(22), 'LCAP', { discount_type: 'percent', discount_value: 50, max_discount: 30 });
  await camp(U(23), 'LOLD', { ends_at: '2020-01-01' });
  await camp(U(24), 'LOTHER', { branch_ids: [BR2] });
  await camp(U(25), 'LONLINE', { channels: ['online_shopee'] });
  await camp(U(26), 'LMIN3', { eligible_min_qty: 3 });
  await camp(U(27), 'LALL', { eligible_scope: 'all' });
  await camp(U(28), 'LHUGE', { discount_value: 1000 });
  await camp(U(29), 'LPERCUST', { per_customer_limit: 1 });

  await t('ลดต่อชิ้น × จำนวน · ยอดบิล/VAT/ส่วนลดรวมคำนวณใหม่ · บันทึกที่มาโปร', async () => {
    const r = await apply(quote([line(PA, 'LA', 2, 100, 'lamt10'), line(PB, 'LB', 1, 50)]));
    eq(Number(r.items[0].campaign_discount), 20, 'ส่วนลดบรรทัด'); eq(Number(r.items[0].line_total), 180, 'ยอดบรรทัด');
    eq(Number(r.grand_total), 230, 'ยอดบิล'); eq(Number(r.discount_total), 20, 'ส่วนลดรวม');
    eq(Number(r.vat_amount), Math.round((230 - 230 / 1.07) * 100) / 100, 'VAT');
    eq(r.line_campaigns.length, 1, 'รายการโปร'); eq(r.line_campaigns[0].line, 0, 'บรรทัดที่ใช้'); eq(r.items[1].campaign_id, undefined, 'บรรทัดไม่มีโค้ดต้องไม่ถูกแตะ');
  });
  await t('% คิดจากยอดหลังส่วนลดที่พนักงานกด · เก็บส่วนลดพนักงานแยก', async () => {
    const r = await apply(quote([line(PA, 'LA', 1, 100, 'LPCT10', 20)]));
    eq(Number(r.items[0].campaign_discount), 8, '10% ของ 80'); eq(Number(r.items[0].manual_discount), 20, 'ส่วนลดพนักงาน');
    eq(Number(r.items[0].discount_amount), 28, 'ส่วนลดรวมบรรทัด'); eq(Number(r.grand_total), 72, 'ยอดบิล');
  });
  await t('เพดานส่วนลด (max_discount) ต่อบรรทัด', async () => {
    eq(Number((await apply(quote([line(PA, 'LA', 1, 100, 'LCAP')]))).items[0].campaign_discount), 30, 'เพดาน 30');
  });
  await t('หลายโปรในบิลเดียว (คนละบรรทัด)', async () => {
    const r = await apply(quote([line(PA, 'LA', 1, 100, 'LAMT10'), line(PB, 'LB', 2, 50, 'LPCT10')]));
    eq(Number(r.grand_total), 180, '200 − 10 − 10'); eq(r.line_campaign_ids.length, 2, 'จำนวนแคมเปญ');
  });
  await t('ไม่มีโค้ด = คืน quote เดิมไม่แตะ', async () => {
    const q = quote([line(PA, 'LA', 1, 100)]); const r = await apply(q);
    eq(Number(r.grand_total), 100, 'ยอดเดิม'); eq(r.line_campaigns, undefined, 'ไม่มีรายการโปร');
  });
  await t('ปฏิเสธ: ไม่พบ/หมดอายุ/สาขาอื่น/ช่องทางอื่น/สินค้าไม่ร่วม/ขอบเขตทั้งบิล/ขั้นต่ำ/ยอดเหลือ 0', async () => {
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'NOPE')])), 'line_campaign_not_found');
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'LOLD')])), 'line_campaign_not_applicable');
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'LOTHER')])), 'line_campaign_not_applicable');
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'LONLINE')])), 'line_campaign_not_applicable');
    await rejects(apply(quote([line(PC, 'LC', 1, 200, 'LAMT10')])), 'line_campaign_product_mismatch');
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'LALL')])), 'line_campaign_product_mismatch');
    await rejects(apply(quote([line(PA, 'LA', 2, 100, 'LMIN3')])), 'line_campaign_minimum_not_met');
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'LHUGE')])), 'promotion_requires_positive_payable');
  });
  await t('LONLINE ใช้ได้เมื่อช่องทางตรง · LOTHER ใช้ได้ที่สาขาที่กำหนด', async () => {
    eq(Number((await apply(quote([line(PA, 'LA', 1, 100, 'LONLINE')], { channel: 'online_shopee' }))).grand_total), 90, 'ช่องทาง');
    eq(Number((await apply(quote([line(PA, 'LA', 1, 100, 'LOTHER')], { branch_id: BR2 }), BR2)).grand_total), 90, 'สาขา');
  });
  await t('จำกัดต่อลูกค้า = ต้องเลือกลูกค้าก่อน', async () => {
    await rejects(apply(quote([line(PA, 'LA', 1, 100, 'LPERCUST')])), 'campaign_customer_required');
    eq(Number((await apply(quote([line(PA, 'LA', 1, 100, 'LPERCUST')], { customer_id: CUST }))).grand_total), 90, 'มีลูกค้า');
  });
  await t('ใช้โค้ดเดียวกันทั้งเป็นโปรสินค้าและคูปองท้ายบิลไม่ได้', async () => {
    const q = quote([line(PA, 'LA', 1, 100, 'LAMT10')]);
    await rejects(db.query('select pos_quote_with_lines($1,$2,$3,$4,0,$5,true)', [q.client_uuid, BR, q, 'LAMT10', []]), 'campaign_used_twice');
    const ok = (await db.query('select pos_quote_with_lines($1,$2,$3,null,0,$4,true) r', [q.client_uuid, BR, q, []])).rows[0].r;
    eq(ok.promo_snapshot.line_campaigns.length, 1, 'snapshot เก็บโปรสินค้า'); assert(ok.promotion_campaign_ids.includes(U(20)), 'นับโควตาแคมเปญ');
  });

  // ---------- แต้มสะสม ----------
  const SAT = '2026-11-28T06:00:00Z'; // เสาร์ 13:00 เวลาไทย
  const calc = async (o = {}) => (await db.query('select pos_loyalty_calc($1,$2,$3,$4,$5,$6,$7,$8) r',
    [o.branch ?? BR, o.channel ?? 'offline', o.customer ?? null, o.at ?? SAT, o.net ?? 1000, o.items ?? [], o.redeemed ?? 0, o.sim ?? null])).rows[0].r;
  const rule = async (f) => {
    const r = { brand_id: null, kind: 'multiplier', multiplier: null, points_per_unit: null, bonus_points: null, min_spend: 0, min_qty: 1, days_of_week: [], time_from: null, time_to: null, branch_ids: [], channels: [], product_ids: [], category_ids: [], starts_at: null, ends_at: null, active: true, customer_condition: 'none', ...f };
    return (await db.query(`insert into loyalty_rules(name,brand_id,kind,multiplier,points_per_unit,bonus_points,min_spend,min_qty,days_of_week,time_from,time_to,branch_ids,channels,product_ids,category_ids,starts_at,ends_at,active,customer_condition)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`, [f.name ?? f.kind, r.brand_id, r.kind, r.multiplier, r.points_per_unit, r.bonus_points, r.min_spend, r.min_qty, r.days_of_week, r.time_from, r.time_to, r.branch_ids, r.channels, r.product_ids, r.category_ids, r.starts_at, r.ends_at, r.active, r.customer_condition])).rows[0].id;
  };
  const off = (id) => db.query('update loyalty_rules set active=false where id=$1', [id]);

  await t('ค่าเริ่มต้น 1 แต้ม/20 บาท · ปัดลง', async () => {
    eq((await calc({ net: 1000 })).points, 50, '1000 บาท'); eq((await calc({ net: 39 })).points, 1, '39 บาท');
  });
  await t('โปรแกรมรายแบรนด์แทนค่าเริ่มต้น · ขั้นต่ำ · ไม่ให้แต้มบิลที่ใช้แต้ม · เพดานต่อบิล', async () => {
    await db.query('insert into loyalty_programs(brand_id,spend_per_unit,points_per_unit,min_spend,max_points_per_bill,earn_on_redeemed_bill) values($1,10,1,100,80,false)', [BRAND]);
    eq((await calc({ net: 500 })).points, 50, 'แบรนด์ 1: 10 บาท/แต้ม');
    eq((await calc({ net: 500, branch: BR2 })).points, 25, 'แบรนด์ 2 ใช้ค่าเริ่มต้น');
    const low = await calc({ net: 99 }); eq([low.points, low.reason].join(), '0,below_min_spend', 'ต่ำกว่าขั้นต่ำ');
    eq((await calc({ net: 500, redeemed: 10 })).reason, 'redeemed_bill', 'บิลใช้แต้ม');
    const cap = await calc({ net: 5000 }); eq([cap.points, cap.capped].join(), '80,true', 'เพดาน');
    await db.query('delete from loyalty_programs where brand_id=$1', [BRAND]);
  });
  await t('ตัวคูณ: ใช้ตัวสูงสุดตัวเดียว (ไม่ทบ) · คูณเฉพาะแต้มฐาน · ตามวัน/เวลา/สาขา', async () => {
    const a = await rule({ kind: 'multiplier', multiplier: 2, days_of_week: [6] });
    const b = await rule({ kind: 'multiplier', multiplier: 3, time_from: '12:00', time_to: '14:00', branch_ids: [BR] });
    eq((await calc({ net: 1000 })).points, 150, 'x3 ชนะ x2');
    eq((await calc({ net: 1000, branch: BR2 })).points, 100, 'สาขาอื่นได้แค่ x2');
    eq((await calc({ net: 1000, at: '2026-11-28T08:00:00Z' })).points, 100, '15:00 นอกช่วง x3');
    eq((await calc({ net: 1000, at: '2026-11-27T06:00:00Z' })).points, 150, 'ศุกร์ 13:00 ได้ x3 (ไม่จำกัดวัน)');
    eq((await calc({ net: 1000, at: '2026-11-27T08:00:00Z' })).points, 50, 'ศุกร์ 15:00 ไม่มีตัวคูณ (x2 เฉพาะเสาร์)');
    await off(a); await off(b);
  });
  await t('ช่วงเวลาข้ามเที่ยงคืน (22:00–02:00)', async () => {
    const a = await rule({ kind: 'multiplier', multiplier: 2, time_from: '22:00', time_to: '02:00' });
    eq((await calc({ net: 1000, at: '2026-11-28T16:30:00Z' })).points, 100, '23:30 ไทย อยู่ในช่วง');
    eq((await calc({ net: 1000, at: '2026-11-28T18:30:00Z' })).points, 100, '01:30 ไทย อยู่ในช่วง');
    eq((await calc({ net: 1000, at: '2026-11-28T06:00:00Z' })).points, 50, '13:00 ไทย นอกช่วง');
    await off(a);
  });
  await t('รายชิ้น: ตามสินค้า/หมวด · ไม่นับของแถม · ผูกแบรนด์ = เฉพาะสินค้าแบรนด์นั้น · จำนวนขั้นต่ำ', async () => {
    const a = await rule({ kind: 'per_item', points_per_unit: 5, category_ids: [CAT] });
    const b = await rule({ kind: 'per_item', points_per_unit: 7, brand_id: BRAND2, min_qty: 2 });
    const items = [{ product_id: PA, qty: 2 }, { product_id: PA, qty: 1, is_gift: true }, { product_id: PB, qty: 3 }, { product_id: PC, qty: 1 }];
    eq((await calc({ net: 0, items })).points, 10, 'หมวด: A 2 ชิ้น (ไม่นับของแถม) · C มีชิ้นเดียวไม่ถึงขั้นต่ำ');
    eq((await calc({ net: 0, items: [...items, { product_id: PC, qty: 1 }] })).points, 24, '+ C 2 ชิ้น × 7');
    await off(a); await off(b);
  });
  await t('โบนัสตามยอดขั้นต่ำ · ช่องทาง · กฎหมดเวลา/ปิด/เก็บถาวรไม่นับ', async () => {
    const a = await rule({ kind: 'bonus', bonus_points: 30, min_spend: 2000, channels: ['offline'] });
    await rule({ kind: 'bonus', bonus_points: 999, ends_at: '2026-01-01T00:00:00Z', starts_at: '2025-01-01T00:00:00Z' });
    const arch = await rule({ kind: 'bonus', bonus_points: 999 }); await db.query('update loyalty_rules set archived_at=now() where id=$1', [arch]);
    eq((await calc({ net: 2000 })).points, 130, '100 + โบนัส 30');
    eq((await calc({ net: 1999 })).points, 99, 'ไม่ถึงขั้นต่ำ');
    eq((await calc({ net: 2000, channel: 'online_shopee' })).points, 100, 'ช่องทางอื่น');
    await off(a);
  });
  await t('แต้มเข้าเมื่อบันทึกบิลจริง (trigger) + ledger เก็บที่มา + กระเป๋าแบรนด์', async () => {
    const o = U(500);
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,customer_id,status,channel,subtotal,grand_total) values($1,$1,'LOY-1',$2,$3,'completed','offline',400,400)`, [o, BR, CUST]);
    const row = (await db.query("select points_delta,detail,brand_id from loyalty_ledger where order_id=$1 and kind='earn'", [o])).rows[0];
    assert(row, 'ไม่ได้แต้มจากบิลจริง'); eq(row.points_delta, 20, 'แต้มบิล 400'); eq(row.brand_id, BRAND, 'แบรนด์');
    assert(Array.isArray(row.detail.parts), 'ledger.detail ต้องเก็บที่มา');
    eq((await db.query('select points from customers where id=$1', [CUST])).rows[0].points, 20, 'แต้มลูกค้า');
    eq((await db.query('select points from brand_wallets where customer_id=$1 and brand_id=$2', [CUST, BRAND])).rows[0].points, 20, 'กระเป๋าแบรนด์');
  });
  await t('แต้มหมดอายุ: FIFO แยกแบรนด์ · ตัดกระเป๋าแบรนด์ตรง · รันซ้ำไม่ตัดซ้ำ · ดูแต้มใกล้หมดอายุ', async () => {
    const X = U(700);
    await db.query("insert into customers(id,name,points) values($1,'Expiry UAT',180)", [X]);
    await db.query('insert into brand_wallets(customer_id,brand_id,points) values($1,$2,120),($1,$3,40)', [X, BRAND, BRAND2]);
    const led = (brand, kind, delta, createdDays, expDays) => db.query(`insert into loyalty_ledger(customer_id,brand_id,kind,points_delta,created_at,expires_at)
      values($1,$2,$3,$4,now()+make_interval(days=>$5),case when $6::int is null then null else now()+make_interval(days=>$6::int) end)`, [X, brand, kind, delta, createdDays, expDays]);
    await led(BRAND, 'earn', 100, -400, -35);   // หมดแล้ว
    await led(BRAND, 'redeem', -30, -300, null); // ใช้จากก้อนเก่าก่อน → เหลือ 70 ที่หมดอายุ
    await led(BRAND, 'earn', 50, -20, 10);       // จะหมดใน 10 วัน
    await led(BRAND2, 'earn', 40, -366, -1);     // หมดแล้ว
    await led(null, 'adjust', 20, -10, null);    // ไม่มีวันหมดอายุ
    const soon = (await db.query('select pos_points_expiring($1,30) r', [X])).rows[0].r;
    eq(Number(soon.total), 160, 'ใกล้/เลยหมดอายุใน 30 วัน (70+50+40)');
    eq(Number((await db.query('select pos_points_expiring($1,5) r', [X])).rows[0].r.total), 110, 'ภายใน 5 วัน = เฉพาะที่เลยแล้ว');
    eq((await db.query('select expire_points_one($1) n', [X])).rows[0].n, 110, 'ตัดหมดอายุ');
    eq((await db.query('select points from customers where id=$1', [X])).rows[0].points, 70, 'ยอดลูกค้า');
    const w = Object.fromEntries((await db.query('select brand_id,points from brand_wallets where customer_id=$1', [X])).rows.map((r) => [r.brand_id, r.points]));
    eq(w[BRAND], 50, 'กระเป๋าแบรนด์ 1'); eq(w[BRAND2], 0, 'กระเป๋าแบรนด์ 2');
    eq(Number((await db.query("select count(*) from loyalty_ledger where customer_id=$1 and kind='expire' and brand_id is not null", [X])).rows[0].count), 2, 'ledger expire แยกแบรนด์');
    eq((await db.query('select expire_points($1) n', [X])).rows[0].n, 0, 'รันซ้ำไม่ตัดซ้ำ');
    eq(Number((await db.query('select pos_points_expiring($1,30) r', [X])).rows[0].r.total), 50, 'เหลือใกล้หมด 50');
  });
  await t('ระดับสมาชิก: ตามยอด 12 เดือน (ไม่รวมบิลปัจจุบัน) · แต้มเพิ่ม = ฐาน × (ตัวคูณ−1) · ชุดระดับรายแบรนด์แทนค่าเริ่มต้น · จำลองได้', async () => {
    await db.query("insert into loyalty_tiers(brand_id,code,name,min_spend,multiplier) values(null,'member','Member',0,1),(null,'gold','Gold',1000,1.5)");
    const Y = U(710), Z = U(711);
    await db.query("insert into customers(id,name,points,birth_date) values($1,'Tier Y',0,'1990-11-28'),($2,'Tier Z',0,'1990-03-03')", [Y, Z]);
    await db.query("update customers set birth_date_set_at = now() - interval '60 days' where id in ($1,$2)", [Y, Z]); // วันเกิดอยู่ในระบบนานแล้ว
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,customer_id,status,channel,subtotal,grand_total,created_at) values($1,$1,'TIER-1',$2,$3,'completed','offline',1200,1200,$4::timestamptz - interval '10 days')`, [U(712), BR, Y, SAT]);
    const y = await calc({ customer: Y, net: 1000 });
    eq(y.tier.code, 'gold', 'Y = Gold'); eq(y.points, 75, '50 + Gold 25');
    const z = await calc({ customer: Z, net: 1000 });
    eq([z.tier.code, z.points, Number(z.tier.next.remaining)].join(), 'member,50,1000', 'Z = Member ขาดอีก 1000');
    eq((await calc({ net: 1000, sim: { tier_code: 'gold' } })).points, 75, 'จำลอง Gold');
    await db.query("insert into loyalty_tiers(brand_id,code,name,min_spend,multiplier) values($1,'b2vip','B2 VIP',0,2)", [BRAND2]);
    eq((await calc({ customer: Z, net: 1000, branch: BR2 })).points, 100, 'แบรนด์ 2 ใช้ชุดระดับของตัวเอง (x2)');
  });
  await t('เงื่อนไขลูกค้า: วันเกิด (วัน/เดือน) · ซื้อครั้งแรก · ใช้กับกฎทุกชนิด', async () => {
    const Y = U(710), Z = U(711);
    const a = await rule({ kind: 'bonus', bonus_points: 100, customer_condition: 'birthday_day' });
    const b = await rule({ kind: 'multiplier', multiplier: 3, customer_condition: 'birthday_month' });
    const c = await rule({ kind: 'bonus', bonus_points: 40, customer_condition: 'first_purchase' });
    eq((await calc({ customer: Y, net: 1000 })).points, 150 + 25 + 100, 'Y วันเกิด: x3 ฐาน + Gold + โบนัสวันเกิด');
    eq((await calc({ customer: Z, net: 1000 })).points, 50 + 40, 'Z ไม่ใช่วันเกิด แต่ซื้อครั้งแรก');
    eq((await calc({ net: 1000, sim: { birthday: true } })).points, 150 + 100, 'จำลองวันเกิด');
    eq((await calc({ net: 1000, sim: { first_purchase: true } })).points, 90, 'จำลองซื้อครั้งแรก');
    eq((await calc({ net: 1000 })).points, 50, 'ไม่มีลูกค้า = ไม่เข้าเงื่อนไข');
    await off(a); await off(b); await off(c);
  });
  await t('กันโกงวันเกิด: ตั้งวันเกิดใหม่ยังไม่นับ 30 วัน · หน้าร้านเติมได้แต่เขียนทับไม่ได้ · วันที่ผิดถูกปฏิเสธ', async () => {
    const a = await rule({ kind: 'bonus', bonus_points: 100, customer_condition: 'birthday_day' });
    const N = U(720);
    const up = (p) => db.query('select pos_customer_upsert($1) r', [p]).then((x) => x.rows[0].r);
    await up({ id: N, name: 'New Bday', birth_date: '1995-11-28' });
    const nb = (await db.query('select birth_date_set_at from customers where id=$1', [N])).rows[0].birth_date_set_at;
    assert(nb, 'ต้องบันทึกเวลาที่ตั้งวันเกิด');
    eq((await calc({ customer: N, net: 1000 })).points, 50 + 40 * 0, 'วันเกิดเพิ่งตั้ง → ยังไม่ได้โบนัส');
    await up({ id: N, name: 'New Bday', birth_date: '1999-01-01' });
    eq(String((await db.query("select to_char(birth_date,'YYYY-MM-DD') d from customers where id=$1", [N])).rows[0].d), '1995-11-28', 'หน้าร้านเขียนทับวันเกิดไม่ได้');
    await rejects(up({ name: 'Future', birth_date: '2999-01-01' }), 'birth_date_invalid');
    await rejects(up({ name: 'Bad', birth_date: 'abc' }), 'birth_date_invalid');
    await off(a);
  });
  await t('บันทึกบิลจริง: ระดับล่าสุดเขียนลง customers.tier', async () => {
    const Z = U(711);
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,customer_id,status,channel,subtotal,grand_total) values($1,$1,'TIER-2',$2,$3,'completed','offline',1500,1500)`, [U(713), BR, Z]);
    eq((await db.query('select tier from customers where id=$1', [Z])).rows[0].tier, 'gold', 'ซื้อครบ 1500 → Gold');
    const st = (await db.query('select pos_loyalty_stats(null,30) r')).rows[0].r;
    assert(Number(st.earned) > 0 && st.tiers.gold >= 1, 'สถิติภาพรวม');
  });
  console.log(`PASS: ${n} line-campaign / loyalty regressions (scope, caps, stacking, windows, per-item, trigger)`);
}
