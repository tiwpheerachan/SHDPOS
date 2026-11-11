// =====================================================================
// ตำแหน่งงานมาตรฐาน (fixed) สำหรับผังองค์กร + เปรียบเทียบ performance ตามตำแหน่ง
//   code = คีย์คงที่ (ใช้ group/เทียบข้ามสาขา/แบรนด์) · level = ระดับ (เรียงผัง/สายงาน)
//   พยายามให้ตรงกับ job_title ที่ดึงจาก Lark (Feishu)
// =====================================================================
export type Locale = "th" | "en" | "zh";

export interface PositionDef {
  code: string;
  level: number; // 1 = หน้างาน … 6 = บริหารระดับสูง
  th: string;
  en: string;
  zh: string;
}

export const POSITIONS: PositionDef[] = [
  // ── หน้างาน / ขาย ──
  { code: "pc", level: 1, th: "PC (พนักงานขายประจำจุด)", en: "PC (Product Consultant)", zh: "PC 导购" },
  { code: "sales", level: 1, th: "พนักงานขาย", en: "Sales Associate", zh: "销售员" },
  { code: "senior_pc", level: 2, th: "PC อาวุโส", en: "Senior PC", zh: "资深导购" },
  { code: "cashier", level: 1, th: "แคชเชียร์", en: "Cashier", zh: "收银员" },
  { code: "stock", level: 1, th: "พนักงานสต็อก/คลัง", en: "Stock / Warehouse", zh: "仓管员" },
  { code: "technician", level: 1, th: "ช่างติดตั้ง", en: "Installation Technician", zh: "安装技师" },
  { code: "vm", level: 2, th: "Visual Merchandiser (VM)", en: "Visual Merchandiser", zh: "陈列师" },
  // ── หัวหน้า / สาขา ──
  { code: "shift_lead", level: 2, th: "หัวหน้ากะ", en: "Shift Supervisor", zh: "值班主管" },
  { code: "sales_lead", level: 2, th: "หัวหน้าทีมขาย", en: "Sales Team Lead", zh: "销售组长" },
  { code: "asst_manager", level: 3, th: "ผู้ช่วยผู้จัดการร้าน", en: "Assistant Store Manager", zh: "店副理" },
  { code: "store_manager", level: 4, th: "ผู้จัดการร้าน", en: "Store Manager", zh: "店长" },
  // ── สนับสนุน ──
  { code: "trainer", level: 3, th: "เทรนเนอร์", en: "Trainer", zh: "培训师" },
  { code: "admin", level: 2, th: "ธุรการ", en: "Admin", zh: "行政" },
  { code: "hr", level: 3, th: "ฝ่ายบุคคล (HR)", en: "HR", zh: "人力资源" },
  { code: "accountant", level: 3, th: "บัญชี", en: "Accounting", zh: "会计" },
  { code: "marketing", level: 3, th: "การตลาด", en: "Marketing", zh: "市场" },
  // ── บริหาร ──
  { code: "area_manager", level: 5, th: "ผู้จัดการเขต", en: "Area Manager", zh: "区域经理" },
  { code: "regional_manager", level: 6, th: "ผู้จัดการภาค", en: "Regional Manager", zh: "大区经理" },
  { code: "brand_manager", level: 6, th: "ผู้จัดการแบรนด์", en: "Brand Manager", zh: "品牌经理" },
  { code: "operations", level: 5, th: "ฝ่ายปฏิบัติการ", en: "Operations", zh: "运营" },
];

const byCode = new Map(POSITIONS.map((p) => [p.code, p]));

export function positionDef(code: string | null | undefined): PositionDef | undefined {
  return code ? byCode.get(code) : undefined;
}

/** ป้ายตำแหน่งตามภาษา — ถ้า code ไม่อยู่ในชุด (ข้อมูลเก่าที่พิมพ์เอง) คืนค่าเดิม */
export function positionLabel(code: string | null | undefined, locale: Locale): string {
  const p = positionDef(code);
  return p ? p[locale] : (code ?? "");
}

export function positionLevel(code: string | null | undefined): number {
  return positionDef(code)?.level ?? 0;
}

/** ค้นหาตำแหน่งจากคำค้น (ตรงทุกภาษา + code) */
export function searchPositions(q: string): PositionDef[] {
  const term = q.trim().toLowerCase();
  if (!term) return POSITIONS;
  return POSITIONS.filter(
    (p) => p.code.includes(term) || p.th.toLowerCase().includes(term) || p.en.toLowerCase().includes(term) || p.zh.includes(term)
  );
}
