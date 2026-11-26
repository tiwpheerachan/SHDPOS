// แปลงข้อมูลจากไฟล์ราคา (Excel/CSV) ให้ฉลาดที่สุด — กรอกน้อย เดาให้ถูก แจ้งให้ชัดเมื่อไม่แน่ใจ
//   ราคาพิเศษ/ส่วนลด: "1490" = ตั้งราคา · "-100" / "ลด 100" / "100 บาท" = ลดเป็นบาท · "15%" / "ลด15%" / "0.15" (เมื่อหัวคอลัมน์มี %) = ลดเป็น %
//   วันที่: Date ของ Excel · 2026-12-01 · 1/12/2026 · 1/12/2569 (พ.ศ.) · 1/12/69 · "1 ธ.ค. 69" · "Dec 1 2026"
//   สาขา: ว่าง/ทุกสาขา/all = ทุกสาขา · รหัสหรือชื่อ คั่นด้วย , ; / ขึ้นบรรทัด
import type { PriceMode, PriceType, Rounding } from "./rules";

export type ParsedValue = { mode: PriceMode; value: number } | { error: string } | null;

const num = (s: string) => Number(s.replace(/[,\s฿]|บาท|thb/gi, ""));

export function parsePriceValue(raw: unknown, percentHint = false): ParsedValue {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw === 0) return null;
    if (raw < 0) return { mode: "amount", value: Math.abs(raw) };
    if (percentHint && raw > 0 && raw < 1) return { mode: "percent", value: Math.round(raw * 10000) / 100 };
    return { mode: "price", value: raw };
  }
  let s = String(raw).trim().toLowerCase();
  if (!s || s === "-" || s === "—") return null;
  const isDiscount = /^(ลด|-|−|off|discount|ส่วนลด)/.test(s) || /off$/.test(s);
  s = s.replace(/^(ส่วนลด|ลด|discount|off)\s*/, "").replace(/\s*off$/, "").replace(/^[-−]\s*/, "");
  if (/%|เปอร์เซ็นต์|percent/.test(s)) {
    const v = num(s.replace(/%|เปอร์เซ็นต์|percent/g, ""));
    if (!Number.isFinite(v) || v <= 0 || v >= 100) return { error: "เปอร์เซ็นต์ต้องอยู่ระหว่าง 0–100" };
    return { mode: "percent", value: v };
  }
  const v = num(s);
  if (!Number.isFinite(v) || v <= 0) return { error: `อ่านค่า “${String(raw)}” ไม่ได้` };
  if (isDiscount || /บาท|฿/.test(String(raw)) && /ลด/.test(String(raw))) return { mode: "amount", value: v };
  if (percentHint && v < 100 && !/\./.test(s) && isDiscount) return { mode: "percent", value: v };
  return { mode: "price", value: v };
}

const TH_MONTH: Record<string, number> = { "ม.ค": 1, "ก.พ": 2, "มี.ค": 3, "เม.ย": 4, "พ.ค": 5, "มิ.ย": 6, "ก.ค": 7, "ส.ค": 8, "ก.ย": 9, "ต.ค": 10, "พ.ย": 11, "ธ.ค": 12,
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4, "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8, "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12 };
const EN_MONTH = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const fixYear = (y: number) => (y < 100 ? (y >= 50 ? 2500 + y - 543 : 2000 + y) : y > 2400 ? y - 543 : y);
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** คืน YYYY-MM-DD (ตามปฏิทินไทย) หรือ null ถ้าว่าง หรือ {error} */
export function parseDateCell(raw: unknown): string | null | { error: string } {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // exceljs ให้วันที่เป็นเวลา UTC เที่ยงคืนของวันในเซลล์
    return ymd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === "number" && raw > 20000 && raw < 80000) { // serial date ของ Excel
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(raw).trim().replace(/\s+/g, " ");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ymd(fixYear(+m[1]), +m[2], +m[3]) ?? { error: `วันที่ “${s}” ไม่มีจริง` };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) return ymd(fixYear(+m[3]), +m[2], +m[1]) ?? { error: `วันที่ “${s}” ไม่มีจริง` };
  m = /^(\d{1,2})\s*([ก-๙.]+?)\.?\s*(\d{2,4})$/.exec(s);
  if (m) { const mon = TH_MONTH[m[2].replace(/\.$/, "")] ?? TH_MONTH[m[2]]; if (mon) return ymd(fixYear(+m[3]), mon, +m[1]) ?? { error: `วันที่ “${s}” ไม่มีจริง` }; }
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/i.exec(s) ?? null;
  if (m) { const mon = EN_MONTH.indexOf(m[1].toLowerCase()) + 1; if (mon) return ymd(+m[3], mon, +m[2]) ?? { error: `วันที่ “${s}” ไม่มีจริง` }; }
  m = /^(\d{1,2}) ([a-z]{3})[a-z]*\.? (\d{4})$/i.exec(s);
  if (m) { const mon = EN_MONTH.indexOf(m[2].toLowerCase()) + 1; if (mon) return ymd(+m[3], mon, +m[1]) ?? { error: `วันที่ “${s}” ไม่มีจริง` }; }
  return { error: `อ่านวันที่ “${s}” ไม่ได้ (ใช้ 2026-12-01 หรือ 1/12/2569)` };
}

export type BranchLite = { id: string; code: string; name: string; name_th: string | null };
/** [] = ทุกสาขา · {error} = มีชื่อที่หาไม่เจอ */
export function parseBranches(raw: unknown, branches: BranchLite[]): string[] | { error: string } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s || /^(ทุกสาขา|all|ทั้งหมด|\*)$/i.test(s)) return [];
  const norm = (x: string) => x.toLowerCase().replace(/[\s\[\]()_-]/g, "");
  const out: string[] = [], miss: string[] = [];
  for (const part of s.split(/[,;/\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const k = norm(part);
    const b = branches.find((x) => norm(x.code) === k) ?? branches.find((x) => norm(x.name_th ?? "") === k || norm(x.name) === k)
      ?? branches.find((x) => norm(x.name_th ?? "").includes(k) || norm(x.name).includes(k));
    if (b) { if (!out.includes(b.id)) out.push(b.id); } else miss.push(part);
  }
  return miss.length ? { error: `ไม่พบสาขา: ${miss.join(", ")}` } : out;
}

const PT: [RegExp, PriceType][] = [[/ประจำเดือน|monthly|month/i, "monthly"], [/เปิดตัว|launch/i, "launch"], [/เคลียร์|clearance|clear/i, "clearance"], [/อีเวนต์|event|งาน/i, "event"], [/สมาชิก|member/i, "member"]];
export function parsePriceType(raw: unknown): PriceType | null {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  for (const [re, t] of PT) if (re.test(s)) return t;
  return "other";
}
export function parseRounding(raw: unknown): Rounding | null {
  const s = raw == null ? "" : String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/ไม่ปัด|none|no/.test(s)) return "none";
  if (/สิบ|10/.test(s)) return "down10";
  if (/9/.test(s)) return "end9";
  if (/บาท|baht|เต็ม/.test(s)) return "baht";
  return null;
}

// หัวคอลัมน์ → ช่องข้อมูล (ไทย/อังกฤษ/รูปแบบที่ลูกทีมพิมพ์เอง)
export type ColKey = "sku" | "name" | "new_list" | "special" | "start" | "end" | "branches" | "type" | "promo" | "rounding";
const HEADERS: [ColKey, RegExp][] = [
  ["sku", /^(sku|รหัสสินค้า|รหัส|item ?code|product ?code)$/i],
  ["new_list", /ราคาหลักใหม่|new ?list|list ?price ?new|ราคาตั้งใหม่|ราคาป้ายใหม่/i],
  ["special", /ราคาพิเศษ|ส่วนลด|special|discount|promo ?price|ราคาโปร|ราคาช่วง/i],
  ["start", /^(เริ่ม|วันเริ่ม|start|from|ตั้งแต่)/i],
  ["end", /^(ถึง|สิ้นสุด|วันสิ้นสุด|end|to|until)/i],
  ["branches", /สาขา|branch/i],
  ["type", /ประเภทราคา|price ?type|ประเภท/i],
  ["promo", /ชื่อโปร|ชื่อแคมเปญ|promo ?name|campaign|ชื่อราคา/i],
  ["rounding", /ปัดเศษ|rounding/i],
  ["name", /^(ชื่อสินค้า|ชื่อ|product|name|สินค้า)$/i],
];
/** หาแถวหัวตาราง (ภายใน 15 แถวแรก) แล้วจับคอลัมน์ */
export function detectHeader(rows: unknown[][]): { row: number; map: Partial<Record<ColKey, number>>; percentHint: boolean } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map((c) => String(c ?? "").trim());
    const map: Partial<Record<ColKey, number>> = {};
    cells.forEach((c, i) => { const h = HEADERS.find(([k, re]) => re.test(c) && map[k] == null); if (h) map[h[0]] = i; });
    if (map.sku != null && (map.new_list != null || map.special != null)) {
      const sp = map.special != null ? cells[map.special] : "";
      return { row: r, map, percentHint: /%/.test(sp) };
    }
  }
  return null;
}
