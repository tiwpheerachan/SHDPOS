// ตัวอ่านไฟล์ราคา — ต้องแม่นยำ (ราคาสำคัญ)
import { parsePriceValue, parseDateCell, parseBranches, parsePriceType, parseRounding, detectHeader } from "../src/lib/pricing/import-parse";
import { ruleValue } from "../src/lib/pricing/rules";
let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); n++; };

eq(parsePriceValue(1490), { mode: "price", value: 1490 }, "ตัวเลข = ตั้งราคา");
eq(parsePriceValue("1,490"), { mode: "price", value: 1490 }, "มีคอมมา");
eq(parsePriceValue("฿1,490.50"), { mode: "price", value: 1490.5 }, "มีสัญลักษณ์บาท");
eq(parsePriceValue(-100), { mode: "amount", value: 100 }, "ติดลบ = ลดบาท");
eq(parsePriceValue("ลด 100"), { mode: "amount", value: 100 }, "ลด 100");
eq(parsePriceValue("ลด 100 บาท"), { mode: "amount", value: 100 }, "ลด 100 บาท");
eq(parsePriceValue("-1,000"), { mode: "amount", value: 1000 }, "-1,000");
eq(parsePriceValue("15%"), { mode: "percent", value: 15 }, "15%");
eq(parsePriceValue("ลด 12.5%"), { mode: "percent", value: 12.5 }, "ลด 12.5%");
eq(parsePriceValue("-10%"), { mode: "percent", value: 10 }, "-10%");
eq(parsePriceValue(0.15, true), { mode: "percent", value: 15 }, "Excel % (0.15) เมื่อหัวคอลัมน์เป็น %");
eq(parsePriceValue(0.15, false), { mode: "price", value: 0.15 }, "ไม่มี % hint = ราคา (จะถูกเตือนที่พรีวิว)");
eq(parsePriceValue(""), null, "ว่าง = ไม่เปลี่ยน");
eq(parsePriceValue("-"), null, "ขีด = ไม่เปลี่ยน");
eq("error" in (parsePriceValue("120%") as object), true, "เกิน 100%");
eq("error" in (parsePriceValue("abc") as object), true, "อ่านไม่ได้");

eq(parseDateCell("2026-12-01"), "2026-12-01", "ISO");
eq(parseDateCell("1/12/2026"), "2026-12-01", "d/m/ค.ศ.");
eq(parseDateCell("1/12/2569"), "2026-12-01", "d/m/พ.ศ.");
eq(parseDateCell("01/12/69"), "2026-12-01", "d/m/พ.ศ. 2 หลัก");
eq(parseDateCell("31/12/26"), "2026-12-31", "d/m/ค.ศ. 2 หลัก");
eq(parseDateCell("1 ธ.ค. 69"), "2026-12-01", "ไทยย่อ");
eq(parseDateCell("15 ธันวาคม 2569"), "2026-12-15", "ไทยเต็ม");
eq(parseDateCell("Dec 1, 2026"), "2026-12-01", "อังกฤษ");
eq(parseDateCell("1 Dec 2026"), "2026-12-01", "อังกฤษ 2");
eq(parseDateCell(new Date(Date.UTC(2026, 11, 1))), "2026-12-01", "Date ของ Excel");
eq(parseDateCell(46357), "2026-12-01", "serial ของ Excel");
eq("error" in (parseDateCell("31/2/2026") as object), true, "วันไม่มีจริง");
eq(parseDateCell(""), null, "ว่าง");

const B = [{ id: "b1", code: "UAT-33856", name: "UAT 33856", name_th: "[UAT] คลังทดสอบ 33856" }, { id: "b2", code: "70MAI-SIAM", name: "70mai Siam", name_th: "70mai สยาม" }];
eq(parseBranches("", B), [], "ว่าง = ทุกสาขา");
eq(parseBranches("ทุกสาขา", B), [], "ทุกสาขา");
eq(parseBranches("uat-33856, 70mai siam", B), ["b1", "b2"], "รหัส + ชื่อ ไม่สนตัวพิมพ์/ช่องว่าง");
eq(parseBranches("สยาม", B), ["b2"], "ชื่อบางส่วน");
eq("error" in (parseBranches("ไม่มีสาขานี้", B) as object), true, "หาไม่เจอ");

eq(parsePriceType("ราคาเคลียร์สต๊อก"), "clearance", "ประเภท"); eq(parsePriceType(""), null, "ประเภทว่าง"); eq(parsePriceType("โปรพิเศษ"), "other", "อื่น ๆ");
eq(parseRounding("ปัดลงหลักสิบ"), "down10", "ปัด 10"); eq(parseRounding("ลงท้าย 9"), "end9", "ลงท้าย 9"); eq(parseRounding(""), null, "ปัดว่าง");

const h = detectHeader([["รายการราคา ธ.ค."], [], ["SKU", "ชื่อสินค้า", "ราคาหลักปัจจุบัน", "ราคาหลักใหม่", "ราคาพิเศษ / ส่วนลด (%)", "เริ่ม", "ถึง", "สาขา"]]);
eq(h?.row, 2, "หาแถวหัวตาราง"); eq(h?.map.sku, 0, "คอลัมน์ SKU"); eq(h?.map.new_list, 3, "ราคาหลักใหม่ (ไม่สับสนกับราคาหลักปัจจุบัน)"); eq(h?.map.special, 4, "ราคาพิเศษ"); eq(h?.percentHint, true, "% hint");
eq(detectHeader([["a", "b"]]), null, "ไม่มีหัวตาราง");
// สูตรราคาตรงกับ SQL
eq(ruleValue("percent", 15, 1990, "baht"), 1692, "1990 −15% ปัดบาท"); eq(ruleValue("percent", 15, 1990, "end9"), 1689, "ลงท้าย 9"); eq(ruleValue("amount", 9999, 500, "baht"), null, "ติดลบ");
console.log(`PASS: ${n} price-import parsing checks (values/%, Thai/BE/Excel dates, fuzzy branches, header detection, formula parity)`);

// ── ตรวจไฟล์ก่อนนำเข้า (review.ts) ──
import { reviewImport, type ReviewRow } from "../src/lib/pricing/review";
const R = (sku: string, o: Partial<ReviewRow> = {}): ReviewRow => ({ sku, product_id: sku, brand_id: "B", category_id: "C", list: 1000, newList: null, mode: "percent", value: 15, final: 850, from: "2026-12-01", to: "2026-12-31", branchCount: 0, cost: 500, currentRule: null, changed: true, ...o });
const cat = ["A1", "A2", "A3", "A4", "A5", "A6"].map((s) => ({ id: s, sku: s, brand_id: "B", category_id: "C", is_active: true }));
let rv = reviewImport(["A1", "A2", "A3", "A4", "A5", "A6"].map((s) => R(s)), cat, "2026-11-26");
eq(rv.verdict, "ok", "ไฟล์ปกติ = ผ่าน"); eq(rv.findings.length, 0, "ไม่มีข้อสังเกต");
rv = reviewImport([R("A1"), R("A2"), R("A3"), R("A4"), R("A5", { value: 60, final: 400 })], cat, "2026-11-26");
eq(rv.findings.find((x) => x.id === "outlier")?.skus, ["A5"], "จับส่วนลดหลุดกลุ่ม"); eq(rv.verdict, "stop", "หลุด 45 จุด = หยุดตรวจ");
eq(rv.findings.find((x) => x.id === "group_gap")?.skus, ["A6"], "จับสินค้ากลุ่มเดียวกันที่ตกหล่น");
rv = reviewImport([R("A1", { mode: "price", value: 15, final: 15 })], cat, "2026-11-26");
eq(rv.findings.some((x) => x.id === "pct_as_price"), true, "15 กับราคาหลัก 1000 = น่าจะเป็น %"); eq(rv.verdict, "stop", "ต้องหยุดตรวจ");
rv = reviewImport([R("A1"), R("A2"), R("A3"), R("A4", { changed: false, mode: null, value: null, final: null })], cat, "2026-11-26");
eq(rv.findings.find((x) => x.id === "forgotten")?.skus, ["A4"], "จับแถวที่ลืมกรอก");
rv = reviewImport([R("A1"), R("A2"), R("A3"), R("A4", { from: "2026-12-05" })], cat, "2026-11-26");
eq(rv.findings.find((x) => x.id === "odd_dates")?.skus, ["A4"], "จับช่วงวันที่แปลก");
rv = reviewImport([R("A1", { final: 450, value: 55 })], cat, "2026-11-26");
eq(rv.findings.some((x) => x.id === "below_cost"), true, "ต่ำกว่าทุน (450/1.07 < 500)");
rv = reviewImport([R("A1", { from: "2026-11-01" })], cat, "2026-11-26");
eq(rv.findings.find((x) => x.id === "backdated")?.severity, "info", "ย้อนหลัง = แจ้งเฉย ๆ"); eq(rv.verdict, "ok", "แจ้งเฉย ๆ ไม่บล็อก");
console.log(`PASS: review checks (outlier, % typed as price, forgotten rows, group gap, odd dates, below cost, backdated) — total ${n}`);
const cat2 = Array.from({ length: 12 }, (_, i) => ({ id: `G${i}`, sku: `G${i}`, brand_id: "B", category_id: "C", is_active: true }));
rv = reviewImport(cat2.slice(0, 3).map((p) => R(p.sku)), cat2, "2026-11-26");
eq(rv.findings.find((x) => x.id === "group_gap")?.severity, "info", "เลือกมาแค่บางส่วนของกลุ่มใหญ่ = แจ้งเฉย ๆ"); eq(rv.verdict, "ok", "ไม่บังคับติ๊ก");
rv = reviewImport(cat2.slice(0, 11).map((p) => R(p.sku)), cat2, "2026-11-26");
eq(rv.findings.find((x) => x.id === "group_gap")?.severity, "medium", "ขาด 1 จาก 12 = น่าจะลืม");
console.log(`PASS: group-gap severity — total ${n}`);
