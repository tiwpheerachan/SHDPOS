// ภาษีรายบรรทัด (0076 + lib/tax.ts) — เคส UAT T026–T029 + เทียบสูตร TypeScript กับ SQL ด้วยข้อมูลสุ่ม (ต้องตรงทุกสตางค์)
export async function testVatEngine(db) {
  const { computeVat } = await import('../src/lib/tax.ts');
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  const U = (n) => `00000000-0000-4000-8000-${String(9500 + n).padStart(12, '0')}`;
  let n = 0;
  // ── เคส UAT (TypeScript) ──
  let r = computeVat([{ amount: 100, mode: 'exclusive', rate: 7 }], 100);
  eq(r.total, 107, 'T027 แยก VAT: รวม 107'); eq(r.vat, 7, 'T027 VAT 7'); eq(r.base, 100, 'T027 ฐาน 100'); n++;
  r = computeVat([{ amount: 107, mode: 'inclusive', rate: 7 }], 107);
  eq(r.total, 107, 'T028 รวม VAT: ยอดคง 107'); eq(r.base, 100, 'T028 ฐาน 100'); eq(r.vat, 7, 'T028 VAT 7'); n++;
  r = computeVat([0.99, 0.99, 0.99].map((a) => ({ amount: a, mode: 'exempt' })), 2.97);
  eq(r.total, 2.97, 'T029 ยอดรวม 2.97'); eq(r.lines.reduce((s, l) => s + Math.round(l.total * 100), 0), 297, 'T029 รายการรวมตรงหัวบิล'); n++;
  // T026: 2×100 ส่วนลดรายการ 10% (=180) แล้วท้ายบิล 20 → 160 · ส่วนลดหัวบิลกระจายครบไม่เกิน
  r = computeVat([{ amount: 90, mode: 'exempt' }, { amount: 90, mode: 'exempt' }], 160);
  eq(r.total, 160, 'T026 สุทธิ 160'); eq(r.lines[0].alloc + r.lines[1].alloc, 20, 'กระจายส่วนลดท้ายบิลครบ 20'); n++;
  // ส่วนลดหัวบิลหารไม่ลงตัว: 10 บาท กระจาย 3 รายการเท่ากัน → 3.34/3.33/3.33 รวมพอดี
  r = computeVat([{ amount: 100 }, { amount: 100 }, { amount: 100 }], 290);
  eq(r.lines.map((l) => l.alloc).join(), '3.34,3.33,3.33', 'เศษให้รายการแรกที่เศษมากสุด'); eq(r.total, 290, 'รวมพอดี');
  eq(r.vat, r.lines.reduce((s, l) => Math.round((s + l.vat) * 100) / 100, 0), 'VAT หัวบิล = ผลรวมรายบรรทัด'); n++;
  // บิลรวม VAT ล้วน: grand_total ไม่เปลี่ยนจากเดิมทุกสตางค์
  for (const [lines, h] of [[[199, 350.5, 89], 600], [[1234.56], 1234.56], [[0.01, 0.02], 0.03]]) eq(computeVat(lines.map((a) => ({ amount: a })), h).total, h, `รวม VAT ล้วนยอดเท่าเดิม ${h}`);
  n++;
  // ผสม: แยก VAT 100 + ยกเว้น 50 + รวม 107 ส่วนลดท้ายบิล 0 → 107 + 50 + 107 = 264 · VAT 7 + 0 + 7
  r = computeVat([{ amount: 100, mode: 'exclusive' }, { amount: 50, mode: 'exempt' }, { amount: 107, mode: 'inclusive' }], 257);
  eq(r.total, 264, 'ผสม 3 แบบ'); eq(r.vat, 14, 'VAT ผสม'); eq(r.exclusiveVat, 7, 'VAT บวกเพิ่ม'); n++;

  // ── เทียบกับ SQL pos_quote_finalize_vat ──
  const modes = ['inclusive', 'exclusive', 'exempt'];
  const pids = [];
  for (let k = 0; k < 3; k++) { pids.push(U(k)); await db.query("insert into products(id,sku,name_th,price,cost,vat_mode,vat_rate) values($1,$2,'VAT',100,10,$3::vat_mode,7)", [U(k), `VAT-${modes[k]}`, modes[k]]); }
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 300; t++) {
    const cnt = 1 + Math.floor(rnd() * 6);
    const lines = Array.from({ length: cnt }, () => ({ k: Math.floor(rnd() * 3), amount: Math.round(rnd() * 500000) / 100 }));
    const sum = lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
    const header = Math.max(sum - Math.floor(rnd() * Math.min(sum, 300000) * (rnd() < 0.3 ? 0 : 1)), 0) / 100;
    const ts = computeVat(lines.map((l) => ({ amount: l.amount, mode: modes[l.k], rate: 7 })), header);
    const q = { grand_total: header, items: lines.map((l) => ({ product_id: pids[l.k], line_total: l.amount, cost_total: 0 })) };
    const sq = (await db.query('select pos_quote_finalize_vat($1) q', [JSON.stringify(q)])).rows[0].q;
    eq(Math.round(Number(sq.grand_total) * 100), Math.round(ts.total * 100), `ยอดรวม TS=SQL (ชุด ${t})`);
    eq(Math.round(Number(sq.vat_amount) * 100), Math.round(ts.vat * 100), `VAT TS=SQL (ชุด ${t})`);
    sq.items.forEach((it, i) => { eq(Math.round(Number(it.vat_amount) * 100), Math.round(ts.lines[i].vat * 100), `VAT บรรทัด ${i} (ชุด ${t})`); eq(Math.round(Number(it.bill_discount_alloc) * 100), Math.round(ts.lines[i].alloc * 100), `ส่วนลดที่กระจาย ${i} (ชุด ${t})`); });
    eq(Math.round(sq.items.reduce((s, it) => s + Number(it.vat_amount), 0) * 100), Math.round(Number(sq.vat_amount) * 100), 'SQL: VAT หัวบิล = ผลรวมบรรทัด');
  }
  n++;
  const again = (await db.query('select pos_quote_finalize_vat(pos_quote_finalize_vat($1)) q', [JSON.stringify({ grand_total: 100, items: [{ product_id: pids[1], line_total: 100 }] })])).rows[0].q;
  eq(Number(again.grand_total), 107, 'เรียกซ้ำไม่บวก VAT ซ้ำ'); n++;
  console.log(`PASS: ${n} VAT-engine regressions (UAT T026 160 · T027 107 · T028 base 100 · T029 2.97, header=Σlines, 300 random TS↔SQL parity, idempotent)`);
}
