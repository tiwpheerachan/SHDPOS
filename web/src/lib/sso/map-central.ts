// แมปข้อมูลจากส่วนกลาง (Lark/GoodHR) → ค่าในระบบเรา (best-effort)
//   * สาขาส่วนกลาง = ห้าง/โลเคชัน · สาขาเรา = ร้านต่อแบรนด์ → แมปจาก (แบรนด์จากแผนก + โลเคชัน)
//   * job_title → position code ด้วยคีย์เวิร์ด

interface BranchLite { id: string; name: string; name_th?: string | null; brand_id?: string | null }
interface BrandLite { id: string; name: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim();

/** เดาแบรนด์จากชื่อแผนก/ตำแหน่ง (เช่น "ฝ่ายขาย Retail 70 mai" → 70mai) */
export function brandFromDepartment(dept: string | undefined, brands: BrandLite[]): string | null {
  if (!dept) return null;
  const d = norm(dept).replace(/\s+/g, "");
  for (const b of brands) {
    const key = norm(b.name).replace(/\s+/g, "");
    if (key && d.includes(key)) return b.id;
  }
  // คีย์เวิร์ดเพิ่มเติม
  if (d.includes("70mai") || d.includes("70 mai")) return brands.find((b) => norm(b.name).includes("70mai"))?.id ?? null;
  return null;
}

/**
 * แมปสาขาส่วนกลาง (ห้าง) + แผนก(แบรนด์) → สาขาในระบบเรา
 *   คืน branch.id ถ้าเจอที่น่าจะใช่ ไม่งั้น null
 */
export function matchOurBranch(
  centralBranch: string | undefined,
  department: string | undefined,
  branches: BranchLite[],
  brands: BrandLite[]
): string | null {
  if (!centralBranch) return null;
  const brandId = brandFromDepartment(department, brands);
  const locTokens = norm(centralBranch).split(" ").filter((t) => t.length >= 2 && t !== "mall" && t !== "ห้าง");
  if (!locTokens.length) return null;

  const pool = brandId ? branches.filter((b) => b.brand_id === brandId) : branches;
  let best: { id: string; score: number } | null = null;
  for (const b of pool) {
    const hay = norm(`${b.name} ${b.name_th ?? ""}`);
    const score = locTokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { id: b.id, score };
  }
  return best?.id ?? null;
}

/** job_title (ส่วนกลาง) → position code ของเรา (คีย์เวิร์ด) */
export function jobTitleToPositionCode(title: string | undefined): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  const has = (...k: string[]) => k.some((x) => t.includes(x));
  if (has("regional", "大区")) return "regional_manager";
  if (has("area", "区域")) return "area_manager";
  if (has("brand manager", "品牌经理")) return "brand_manager";
  if (has("store manager", "ผู้จัดการร้าน", "店长")) return "store_manager";
  if (has("assistant", "ผู้ช่วย", "店副")) return "asst_manager";
  if (has("account manager", "sales manager", "ผู้จัดการ", "manager", "经理", "主管")) return "store_manager";
  if (has("supervisor", "lead", "หัวหน้า", "组长", "主管")) return "sales_lead";
  if (has("cashier", "แคชเชียร์", "收银")) return "cashier";
  if (has("stock", "warehouse", "คลัง", "สต็อก", "仓")) return "stock";
  if (has("technician", "teknisi", "ช่าง", "技师", "安装")) return "technician";
  if (has("trainer", "เทรนเนอร์", "培训")) return "trainer";
  if (has("vm", "visual merchand", "陈列")) return "vm";
  if (has("marketing", "การตลาด", "市场")) return "marketing";
  if (has("hr", "human resource", "บุคคล", "人力")) return "hr";
  if (has("account", "บัญชี", "会计")) return "accountant";
  if (has("pc", "product consultant", "导购")) return "pc";
  if (has("sales", "ขาย", "销售")) return "sales";
  return null;
}
