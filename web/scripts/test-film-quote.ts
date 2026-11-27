// งานติดฟิล์ม — ราคา/ตัดสต๊อก/แบ่งราคา ต้องถูกต้องทุกกรณี
import { quoteFilmJob, sameFilmLines, FilmError, type FilmConfigData } from "../src/lib/film/quote";
let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); n++; };
const throws = (f: () => unknown, m: string) => { try { f(); } catch (e) { if (e instanceof FilmError) { n++; return; } throw e; } throw Error(`${m}: ต้อง error`); };
const pos = ["FW", "RW", "FSW", "RSW"].map((code, i) => ({ code, name_th: code, name_en: code, name_zh: code, sort: i }));
const cfg: FilmConfigData = {
  rules: { one_series_per_car: true, full_car_only: true, mixed_shades: true, roll_width_ft: 5, round_up_feet: true },
  sizes: [{ code: "S", name_th: "S", name_en: "S", name_zh: "S", sort: 0 }, { code: "L", name_th: "L", name_en: "L", name_zh: "L", sort: 1 }],
  positions: pos,
  areas: { S: { FW: 15, RW: 12.5, FSW: 10, RSW: 12.5 }, L: { FW: 17.5, RW: 15, FSW: 12.5, RSW: 20 } },
  series: [{ code: "E", name: "Essential Guard", sort: 0, active: true }, { code: "P", name: "Pro Guard", sort: 1, active: true }],
  shades: [
    { series_code: "E", shade: 40, model_code: "E40", stock_product_id: "e35", sku: "70mai essential-35%", feet_per_unit: 1, active: true },
    { series_code: "E", shade: 60, model_code: "E60", stock_product_id: "e15", sku: "70mai essential-15%", feet_per_unit: 1, active: true },
    { series_code: "E", shade: 80, model_code: "E80", stock_product_id: "e5", sku: "70mai essential-5%", feet_per_unit: 1, active: true },
    { series_code: "P", shade: 80, model_code: "P80", stock_product_id: "p8", sku: "70mai pro-8%", feet_per_unit: 1, active: true },
  ],
  prices: { "E|S|ALL": 4900, "E|L|ALL": 5500, "P|S|ALL": 8900 },
};
const full = (shade: number | number[]) => ["FW", "RW", "FSW", "RSW"].map((code, i) => ({ code, shade: Array.isArray(shade) ? shade[i] : shade }));
const sum = (q: { lines: { qty: number; unit_price: number }[] }) => Math.round(q.lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100;

// Size S รอบคัน E80 → 10 ฟุต @ 490 = 4,900
let q = quoteFilmJob(cfg, { size: "S", series: "E", positions: full(80) });
eq(q.price, 4900, "ราคารอบคัน S"); eq(q.feet, 10, "S ใช้ 10 ฟุต"); eq(q.lines.map((l) => [l.product_id, l.qty, l.unit_price]), [["e5", 10, 490]], "บรรทัดเดียว 10×490");
// ผสมความเข้ม: หน้า E40 (3 ฟุต) หลัง E80 (2.5) ข้าง E60 (2+2.5=4.5) → ปัดขึ้น 3, 3, 5 ฟุต · ราคารวมยังเท่า 4,900
q = quoteFilmJob(cfg, { size: "S", series: "E", positions: full([40, 80, 60, 60]) });
const byPid = q.lines.reduce((m, l) => ({ ...m, [l.product_id]: (m[l.product_id] ?? 0) + l.qty }), {} as Record<string, number>);
eq([byPid.e35, byPid.e5, byPid.e15], [3, 3, 5], "ปัดฟุตขึ้นต่อม้วน (หน้า 3 · หลัง 2.5→3 · ข้าง 4.5→5)");
eq(sum(q), 4900, "แบ่งราคาแล้วรวมเท่าราคางานพอดี"); eq(q.lines.every((l) => Number.isInteger(l.qty)), true, "จำนวนเต็มทุกบรรทัด (JST)");
// Size L 13 ฟุต @ 5,500 → 5500/13 ไม่ลงตัว → แตกบรรทัด 12×423.07 + 1×423.16
q = quoteFilmJob(cfg, { size: "L", series: "E", positions: full(80) });
eq(q.feet, 13, "L 13 ฟุต"); eq(sum(q), 5500, "L รวม 5,500 พอดี"); eq(q.lines.length, 2, "แตก 2 บรรทัดเมื่อไม่ลงตัว");
eq(q.lines.every((l) => Math.round(l.unit_price * 100) === l.unit_price * 100), true, "ราคา 2 ตำแหน่ง");
// กฎ
throws(() => quoteFilmJob(cfg, { size: "S", series: "E", positions: [{ code: "FW", shade: 80 }] }), "ขายเฉพาะรอบคัน");
throws(() => quoteFilmJob(cfg, { size: "S", series: "E", positions: full(70) }), "ความเข้มไม่มี");
throws(() => quoteFilmJob(cfg, { size: "S", series: "X", positions: full(80) }), "รุ่นไม่มี");
throws(() => quoteFilmJob({ ...cfg, rules: { ...cfg.rules, mixed_shades: false } }, { size: "S", series: "E", positions: full([40, 80, 60, 60]) }), "ห้ามผสมความเข้ม");
throws(() => quoteFilmJob({ ...cfg, rules: { ...cfg.rules, full_car_only: false } }, { size: "S", series: "E", positions: [{ code: "FW", shade: 80 }] }), "รายตำแหน่งไม่มีราคา");
q = quoteFilmJob({ ...cfg, rules: { ...cfg.rules, full_car_only: false }, prices: { ...cfg.prices, "E|S|FW": 1500 } }, { size: "S", series: "E", positions: [{ code: "FW", shade: 80 }] });
eq([q.price, q.lines[0].qty, sum(q)], [1500, 3, 1500], "รายตำแหน่ง: บานหน้า 3 ฟุต 1,500");
// ไม่ปัดขึ้น: 1 ชิ้น = 50 ฟุต → 10/50 = 0.2 ชิ้น
q = quoteFilmJob({ ...cfg, rules: { ...cfg.rules, round_up_feet: false }, shades: cfg.shades.map((s) => ({ ...s, feet_per_unit: 50 })) }, { size: "S", series: "E", positions: full(80) });
eq(q.lines[0].qty, 0.2, "เศษชิ้นเมื่อไม่ปัด"); eq(sum(q), 4900, "ราคารวมยังตรง");
// ตรวจบรรทัดฝั่งเซิร์ฟเวอร์
const good = quoteFilmJob(cfg, { size: "S", series: "E", positions: full(80) });
eq(sameFilmLines(good.lines, good.lines), true, "บรรทัดตรง"); eq(sameFilmLines([{ ...good.lines[0], unit_price: 400 }], good.lines), false, "แก้ราคาที่เครื่อง = ไม่ผ่าน");
eq(sameFilmLines([{ ...good.lines[0], qty: 5 }], good.lines), false, "แก้จำนวน = ไม่ผ่าน");
console.log(`PASS: ${n} film job checks (full car price, feet per size, mixed shades round-up, exact price split, rules, per-position, fractional units, tamper detection)`);
