// เทมเพลตราคา: สร้างไฟล์แบบเดียวกับปุ่มดาวน์โหลด (ทุกภาษา) → อ่านกลับแบบเดียวกับปุ่มนำเข้า → ต้องได้ค่าเดิมทุกช่อง
import ExcelJS from "exceljs";
import { detectHeader, templateHeads, shortLabel, parsePriceValue, parseDateCell, parseBranches, parsePriceType, parseRounding, type Pick3, type ColKey } from "../src/lib/pricing/import-parse";
let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); n++; };
const B = [{ id: "b1", code: "UAT-33856", name: "UAT 33856", name_th: "[UAT] คลังทดสอบ 33856" }, { id: "b2", code: "UAT-33857", name: "UAT 33857", name_th: null }];
const TYPES: Record<string, [string, string, string]> = { monthly: ["ราคาประจำเดือน", "Monthly price", "月度价格"], launch: ["ราคาเปิดตัว", "Launch price", "上市价"], clearance: ["ราคาเคลียร์สต๊อก", "Clearance", "清仓价"], event: ["ราคาอีเวนต์", "Event price", "活动价"], member: ["ราคาสมาชิก", "Member price", "会员价"] };
const ROUNDS: Record<string, [string, string, string]> = { baht: ["ปัดเป็นบาท (1,691.50 → 1,692)", "Round to baht (1,691.50 → 1,692)", "取整到元（1,691.50 → 1,692）"], down10: ["ปัดลงหลักสิบ (1,692 → 1,690)", "Round down to 10 (1,692 → 1,690)", "向下取整到十（1,692 → 1,690）"], end9: ["ลงท้ายด้วย 9 (1,692 → 1,689)", "End with 9 (1,692 → 1,689)", "尾数为9（1,692 → 1,689）"], none: ["ไม่ปัด (ทศนิยม 2 ตำแหน่ง)", "No rounding (2 decimals)", "不取整（2位小数）"] };
function grid(ws: ExcelJS.Worksheet) { // เหมือน sheetGrid ในหน้านำเข้า
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => { const v: unknown[] = []; row.eachCell({ includeEmpty: true }, (c, i) => { let x: unknown = c.value; if (x && typeof x === "object" && !(x instanceof Date)) { const o = x as { result?: unknown; text?: string }; x = o.result ?? o.text ?? ""; } v[i - 1] = x; }); out[r - 1] = v; });
  return out.map((r) => r ?? []);
}
(async () => {
  for (const [li, lang] of (["th", "en", "zh"] as const).entries()) {
    const L: Pick3 = (...a) => a[li];
    const { head, editFrom } = templateHeads(L, [`${L("สต๊อก", "Stock", "库存")} UAT-33856`, `${L("สต๊อก", "Stock", "库存")} UAT-33857`]);
    const types = Object.keys(TYPES), rounds = Object.keys(ROUNDS);
    for (const [ti, t] of types.entries()) {
      const r = rounds[ti % rounds.length];
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(`ราคา Mova ธ.ค. 69`);
      ws.addRow([`${L("เทมเพลตราคา", "Price template", "价格模板")} · Mova · ${L("สาขา", "Branches", "门店")}: ${L("ทุกสาขา", "All", "所有门店")} — SKU`]);
      ws.mergeCells(1, 1, 1, head.length);
      ws.addRow(head);
      ws.addRow(["MOVA-Z200", "V2601", "Mova", "", 12, 5, 7, 1990, 1990, "", "15%", new Date("2026-12-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"), "UAT-33856, UAT-33857", TYPES[t][li], "โปร test", shortLabel(ROUNDS[r][li])]);
      ws.addRow(["MOVA-Z70", "", "Mova", "", 3, 3, 0, 2490, 2490, 2290, "", "", "", "", "", "", ""]);
      const buf = await wb.xlsx.writeBuffer();
      const back = new ExcelJS.Workbook(); await back.xlsx.load(buf as ArrayBuffer);
      const g = grid(back.worksheets[0]); const h = detectHeader(g);
      const tag = `[${lang}/${t}]`;
      if (!h) throw Error(`${tag} ไม่พบหัวตาราง`);
      eq(h.row, 1, `${tag} หัวตารางแถว 2`);
      const want: Partial<Record<ColKey, number>> = { sku: 0, name: 1, new_list: editFrom - 1, special: editFrom, start: editFrom + 1, end: editFrom + 2, branches: editFrom + 3, type: editFrom + 4, promo: editFrom + 5, rounding: editFrom + 6 };
      eq(h.map, want, `${tag} จับคอลัมน์ครบและตรง`);
      const c = (k: ColKey, row: unknown[]) => row[h.map[k]!];
      const r1 = g[2], r2 = g[3];
      eq(parsePriceValue(c("special", r1), h.percentHint), { mode: "percent", value: 15 }, `${tag} ส่วนลด`);
      eq(parseDateCell(c("start", r1)), "2026-12-01", `${tag} วันเริ่ม`); eq(parseDateCell(c("end", r1)), "2026-12-31", `${tag} วันสิ้นสุด`);
      eq(parseBranches(c("branches", r1), B), ["b1", "b2"], `${tag} สาขา`);
      eq(parsePriceType(c("type", r1)), t, `${tag} ประเภทราคา`);
      eq(parseRounding(c("rounding", r1)), r, `${tag} ปัดเศษ ${shortLabel(ROUNDS[r][li])}`);
      eq(c("new_list", r2), 2290, `${tag} ราคาหลักใหม่แถว 2`); eq(parsePriceValue(c("special", r2), h.percentHint), null, `${tag} แถวไม่มีราคาพิเศษ`);
    }
    for (const r of rounds) eq(parseRounding(shortLabel(ROUNDS[r][li])), r, `[${lang}] ปัดเศษ ${r}`);
    for (const t of types) eq(parsePriceType(TYPES[t][li]), t, `[${lang}] ประเภท ${t}`);
  }
  console.log(`PASS: ${n} template round-trip checks (th/en/zh headers, merged title row, stock columns, dates, branches, type, rounding)`);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
