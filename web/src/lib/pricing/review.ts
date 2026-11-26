// ตรวจไฟล์ราคาก่อนนำเข้า (กฎล้วน · ทำงานทันที ไม่ต้องใช้ AI) — หาความผิดปกติ/ตกหล่น แล้วแนะนำว่าควรยืนยันหรือไม่
//   ผลลัพธ์ใช้ทั้งแสดงผล และส่งสรุปให้ AI ให้ความเห็นเพิ่ม (ไม่มีข้อมูลส่วนบุคคล)
import { tr } from "@/lib/i18n/tr";

export type ReviewRow = {
  sku: string; product_id: string; brand_id: string | null; category_id: string | null; list: number; newList: number | null;
  mode: "price" | "amount" | "percent" | null; value: number | null; final: number | null; from: string | null; to: string | null;
  branchCount: number; cost: number | null; currentRule: string | null; changed: boolean;
};
export type CatalogLite = { id: string; sku: string; brand_id: string | null; category_id: string | null; is_active: boolean };
export type Finding = { id: string; severity: "high" | "medium" | "info"; title: string; detail: string; skus: string[] };
export type Verdict = "ok" | "review" | "stop";

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pctOff = (list: number, price: number) => (list > 0 ? Math.round(((list - price) / list) * 1000) / 10 : 0);
const top = (skus: string[], n = 8) => (skus.length > n ? `${skus.slice(0, n).join(", ")} +${skus.length - n}` : skus.join(", "));

export function reviewImport(rows: ReviewRow[], catalog: CatalogLite[], today: string): { verdict: Verdict; findings: Finding[]; stats: Record<string, number> } {
  const f: Finding[] = [];
  const priced = rows.filter((r) => r.final != null);
  const offs = priced.map((r) => ({ r, off: pctOff(r.newList ?? r.list, r.final!) }));

  // 1) ส่วนลดหลุดกลุ่ม: ห่างจากค่ากลางของไฟล์มาก (≥ 4 แถว)
  if (offs.length >= 4) {
    const med = median(offs.map((x) => x.off));
    const out = offs.filter((x) => Math.abs(x.off - med) >= 20);
    if (out.length && out.length <= offs.length / 3) f.push({ id: "outlier", severity: out.some((x) => Math.abs(x.off - med) >= 35) ? "high" : "medium",
      title: tr(`${out.length} สินค้าส่วนลดต่างจากรายการอื่นมาก`, `${out.length} product(s) far from the typical discount`, `${out.length} 个商品折扣明显偏离`),
      detail: tr(`ส่วนใหญ่ลดราว ${med}% แต่รายการนี้ลด ${out.map((x) => `${x.r.sku} ${x.off}%`).slice(0, 5).join(", ")}`, `Most are ~${med}% off but these differ`, `大多约减 ${med}%，这些差异较大`), skus: out.map((x) => x.r.sku) });
  }
  // 2) น่าจะตั้งใจใส่ % แต่ได้เป็นราคา (เช่น 15 กับสินค้าราคาหลักพัน)
  const pctLike = priced.filter((r) => r.mode === "price" && r.value != null && r.value < 100 && (r.newList ?? r.list) >= 500);
  if (pctLike.length) f.push({ id: "pct_as_price", severity: "high", title: tr(`${pctLike.length} แถวน่าจะตั้งใจใส่เป็น %`, `${pctLike.length} row(s) look like a % typed as a price`, `${pctLike.length} 行疑似应为百分比`),
    detail: tr(`เช่น ${pctLike[0].sku} ใส่ ${pctLike[0].value} แต่ราคาหลัก ${pctLike[0].newList ?? pctLike[0].list} — ถ้าตั้งใจลด % ให้พิมพ์ ${pctLike[0].value}%`, `e.g. ${pctLike[0].sku}: ${pctLike[0].value} vs list ${pctLike[0].newList ?? pctLike[0].list} — type ${pctLike[0].value}% for a percent`, `如 ${pctLike[0].sku} 填 ${pctLike[0].value}，若为折扣请填 ${pctLike[0].value}%`), skus: pctLike.map((r) => r.sku) });
  // 3) ลดหนักมาก / ต่ำกว่าทุน
  const deep = offs.filter((x) => x.off > 50);
  if (deep.length) f.push({ id: "deep", severity: deep.length > rows.length / 2 ? "high" : "medium", title: tr(`${deep.length} สินค้าลดเกิน 50%`, `${deep.length} product(s) over 50% off`, `${deep.length} 个商品折扣超50%`), detail: top(deep.map((x) => `${x.r.sku} −${x.off}%`), 5), skus: deep.map((x) => x.r.sku) });
  const below = priced.filter((r) => r.cost != null && r.cost > 0 && r.final! / 1.07 < r.cost);
  if (below.length) f.push({ id: "below_cost", severity: below.length >= 3 ? "high" : "medium", title: tr(`${below.length} สินค้าขายต่ำกว่าต้นทุน`, `${below.length} product(s) below cost`, `${below.length} 个商品低于成本`), detail: top(below.map((r) => r.sku)), skus: below.map((r) => r.sku) });
  // 4) ราคาหลักเปลี่ยนแรง (±30%)
  const jump = rows.filter((r) => r.newList != null && r.list > 0 && Math.abs(r.newList - r.list) / r.list >= 0.3);
  if (jump.length) f.push({ id: "list_jump", severity: "medium", title: tr(`${jump.length} สินค้าราคาหลักเปลี่ยนเกิน 30%`, `${jump.length} list price change(s) over 30%`, `${jump.length} 个标价变动超30%`), detail: top(jump.map((r) => `${r.sku} ${r.list}→${r.newList}`), 5), skus: jump.map((r) => r.sku) });
  // 5) ช่วงวันที่ไม่เหมือนรายการอื่น
  const ranges = priced.filter((r) => r.from && r.to).map((r) => `${r.from}→${r.to}`);
  if (ranges.length >= 3) {
    const cnt = new Map<string, number>(); ranges.forEach((x) => cnt.set(x, (cnt.get(x) ?? 0) + 1));
    const [main, mainN] = [...cnt].sort((a, b) => b[1] - a[1])[0];
    const odd = priced.filter((r) => r.from && `${r.from}→${r.to}` !== main);
    if (mainN >= ranges.length * 0.6 && odd.length) f.push({ id: "odd_dates", severity: "medium", title: tr(`${odd.length} แถวช่วงวันที่ต่างจากส่วนใหญ่`, `${odd.length} row(s) with a different period`, `${odd.length} 行时段与多数不同`), detail: tr(`ส่วนใหญ่ ${main}`, `Most use ${main}`, `多数为 ${main}`), skus: odd.map((r) => r.sku) });
  }
  const past = priced.filter((r) => r.from && r.from < today);
  if (past.length) f.push({ id: "backdated", severity: "info", title: tr(`${past.length} แถวเริ่มย้อนหลัง — มีผลทันทีที่ยืนยัน`, `${past.length} row(s) start in the past — effective immediately`, `${past.length} 行开始日期已过 — 确认后立即生效`), detail: top(past.map((r) => r.sku)), skus: past.map((r) => r.sku) });
  // 6) แถวว่างท่ามกลางแถวที่กรอก (อาจลืม)
  const blank = rows.filter((r) => !r.changed);
  const filled = rows.length - blank.length;
  if (filled >= 3 && blank.length && blank.length <= rows.length * 0.3) f.push({ id: "forgotten", severity: "medium", title: tr(`${blank.length} สินค้าในไฟล์ยังไม่ได้กรอก — ลืมหรือตั้งใจ?`, `${blank.length} product(s) in the file left blank — forgotten?`, `${blank.length} 个商品未填写 — 是否遗漏？`), detail: top(blank.map((r) => r.sku)), skus: blank.map((r) => r.sku) });
  // 7) ตกหล่นจากกลุ่ม: แบรนด์+หมวดที่เกือบทั้งกลุ่มลดเท่ากัน แต่มีสินค้าเปิดขายในกลุ่มเดียวกันที่ไม่อยู่ในไฟล์
  const inFile = new Set(rows.map((r) => r.product_id));
  const groups = new Map<string, ReviewRow[]>();
  for (const r of priced) { const k = `${r.brand_id}|${r.category_id}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const missing: string[] = [];
  for (const [k, g] of groups) {
    if (g.length < 3) continue;
    const sig = new Map<string, number>(); g.forEach((r) => sig.set(`${r.mode}:${r.value}`, (sig.get(`${r.mode}:${r.value}`) ?? 0) + 1));
    if (Math.max(...sig.values()) < g.length * 0.8) continue;
    const [b, c] = k.split("|");
    catalog.filter((p) => p.is_active && String(p.brand_id) === b && String(p.category_id) === c && !inFile.has(p.id)).forEach((p) => missing.push(p.sku));
  }
  if (missing.length) f.push({ id: "group_gap", severity: "medium", title: tr(`${missing.length} สินค้ากลุ่มเดียวกันไม่อยู่ในไฟล์`, `${missing.length} product(s) of the same group not in the file`, `${missing.length} 个同组商品不在文件中`), detail: tr(`สินค้าแบรนด์/หมวดเดียวกันลดเท่ากันเกือบทั้งกลุ่ม แต่ไม่มี: ${top(missing)}`, `Same brand/category got the same discount but these are missing: ${top(missing)}`, `同品牌/类别大多同折扣，但缺少：${top(missing)}`), skus: missing });
  // 8) ทับราคาช่วงเวลาเดิมที่ใช้อยู่
  const over = priced.filter((r) => r.currentRule);
  if (over.length) f.push({ id: "override", severity: "info", title: tr(`${over.length} สินค้ามีราคาช่วงเวลาใช้อยู่ — กฎใหม่ (ระดับ SKU ล่าสุด) จะมีผลแทน`, `${over.length} product(s) already on a period price — the new SKU rule takes over`, `${over.length} 个商品已有时段价 — 新规则将覆盖`), detail: top(over.map((r) => `${r.sku} (${r.currentRule})`), 4), skus: over.map((r) => r.sku) });
  // 9) ราคาพิเศษสูงกว่าราคาหลัก
  const up = priced.filter((r) => r.final! > (r.newList ?? r.list));
  if (up.length) f.push({ id: "above_list", severity: "medium", title: tr(`${up.length} สินค้าราคาพิเศษแพงกว่าราคาหลัก`, `${up.length} special price(s) above list`, `${up.length} 个特价高于标价`), detail: top(up.map((r) => r.sku)), skus: up.map((r) => r.sku) });

  const verdict: Verdict = f.some((x) => x.severity === "high") ? "stop" : f.some((x) => x.severity === "medium") ? "review" : "ok";
  return { verdict, findings: f, stats: { rows: rows.length, changed: filled, priced: priced.length, median_off: offs.length ? median(offs.map((x) => x.off)) : 0, max_off: offs.length ? Math.max(...offs.map((x) => x.off)) : 0, list_changes: rows.filter((r) => r.newList != null).length } };
}
