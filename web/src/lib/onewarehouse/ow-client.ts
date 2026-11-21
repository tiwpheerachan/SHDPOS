// =====================================================================
// OneWarehouse `/v1` reads — typed client (browser-safe)
//   เรียกผ่าน same-origin /api/ow/* (proxy แนบ 2 headers ฝั่ง server)
//   → service token ไม่มีทางโผล่ฝั่ง client
//   endpoint: products · products/{sku}/components · stock · warehouses · serials/{sn}
// =====================================================================
import type { Product } from "../types";

// ── รูปแบบข้อมูลจาก OW (JST-faithful, ตรงตาม OpenAPI schema) ──
//   ⚠️ เกือบทุกฟิลด์ nullable: JST ว่าง→null (ยกเว้น sku, serial_tracking required)
//   ⚠️ ราคา: 0 = JST ตั้ง 0 จริง · null = JST ไม่ได้ตั้ง → "ห้าม" แปล null/0 เป็นของแถม/ขายฟรีอัตโนมัติ
export interface OwProduct {
  sku: string;
  name: string | null;
  short_name: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  image_url: string | null;       // ว่างเสมอ (JST ไม่มีรูป) → รูปมาจาก catalog เรา
  serial_tracking: boolean | null; // null = ยังไม่จัดประเภท
  availableQty: number | null;    // ledger figure (ใช้ /stock สำหรับ on-hand จริง)
  sale_price: number | null;
  member_price: number | null;
  wholesale_price: number | null;
  tag_price: number | null;
  cost_price: number | null;
  is_combined: boolean | null;    // true = ชุดคอมโบ/bundle
}
export interface OwStock { sku: string; warehouseId: string; qty: number }
export interface OwWarehouse {
  warehouse_id: string;
  code: string;
  name_en: string;
  name_th: string | null;
  name_zh: string | null;
  type: "main" | "branch" | "virtual";
  status: "active" | "inactive";
  updated_at: string;
}
export interface OwSerial { serialNo: string; sku: string; warehouseId: string | null; status: string; lastMovementId: string | null }
export interface OwCarrier { id: string; name: string; enabled: boolean; platformId?: string | null; codEnabled?: boolean }
export interface OwComponents { sku: string; available: boolean; reason?: string; components?: { sku: string; qty: number }[] }
export interface OwStatus { configured: boolean; authConfigured: boolean; subNumeric: boolean | null }

export interface OwResult<T> { ok: boolean; status: number; data?: T; error?: string }

async function owGet<T>(path: string): Promise<OwResult<T>> {
  try {
    const r = await fetch(`/api/ow/${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
    const txt = await r.text();
    let json: unknown = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { /* non-json */ }
    if (!r.ok) {
      const err = (json && typeof json === "object" && "error" in json) ? String((json as { error: unknown }).error) : `http_${r.status}`;
      return { ok: false, status: r.status, error: err };
    }
    return { ok: true, status: r.status, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

/** เปิดอ่าน OW ได้ไหม (base ตั้งแล้ว + มี token/sub) — ไม่เปิดเผยค่า secret */
export async function owStatus(): Promise<OwStatus> {
  const r = await owGet<OwStatus>("status");
  return r.data ?? { configured: false, authConfigured: false, subNumeric: null };
}

/** ค้นสินค้า — exact SKU = ดึง JST สด · ชื่อ = fuzzy local index */
export async function owProducts(q: string): Promise<OwResult<OwProduct[]>> {
  return owGet<OwProduct[]>(`products?q=${encodeURIComponent(q)}`);
}
/** สินค้า 1 ตัวจาก exact SKU (คืนตัวแรกที่ตรง) */
export async function owProductBySku(sku: string): Promise<OwProduct | null> {
  const r = await owProducts(sku);
  if (!r.ok || !r.data?.length) return null;
  const up = sku.trim().toUpperCase();
  // ตรง exact SKU เท่านั้น — ไม่ตรงคืน null (ห้ามหยิบผลลัพธ์ตัวแรกแทน กันได้สินค้าผิดตัว)
  return r.data.find((p) => p.sku.toUpperCase() === up) ?? null;
}
/** ส่วนประกอบคอมโบ (ตอนนี้ OW คืน 501 — contract นิ่ง เขียนรอได้) */
export async function owComponents(sku: string): Promise<OwResult<OwComponents>> {
  return owGet<OwComponents>(`products/${encodeURIComponent(sku)}/components`);
}
/** on-hand JST ต่อคลัง (≤50 SKU/ครั้ง) */
export async function owStock(warehouseId: string, skus: string[]): Promise<OwResult<OwStock[]>> {
  const q = skus.map((s) => s.trim()).filter(Boolean).slice(0, 50).join(",");
  return owGet<OwStock[]>(`stock?warehouseId=${encodeURIComponent(warehouseId)}&skus=${encodeURIComponent(q)}`);
}
/** รายการคลัง (อาจว่างช่วง populate → ใช้ ID เดิมไปก่อน) */
export async function owWarehouses(): Promise<OwResult<OwWarehouse[]>> {
  return owGet<OwWarehouse[]>("warehouses");
}
/** สถานะ/ตำแหน่ง SN จาก OW (serial flow ฝั่ง OW) */
export async function owSerial(sn: string): Promise<OwResult<OwSerial>> {
  return owGet<OwSerial>(`serials/${encodeURIComponent(sn.trim())}`);
}
/** รายชื่อขนส่ง (dropdown จัดส่ง) — ของจริงจาก OW */
export async function owCarriersApi(): Promise<OwResult<OwCarrier[]>> {
  return owGet<OwCarrier[]>("carriers");
}

// ── mapper: OW product → ฟิลด์ที่ตรงกับ Product ของเรา (บางส่วน) ──
//   หมายเหตุ: OW ไม่มี id/brand_id/category_id ภายในของเรา + image_url ว่างเสมอ (รูปมาจากฝั่งเรา)
// แปลงเฉพาะฟิลด์ที่ JST "มีค่าจริง" — ห้ามใส่ค่าว่าง/null/false ที่อาจลบข้อมูลเดิมตอน merge
//   • serial_tracking=null (ยังไม่ทราบ) → ไม่แตะ track_serial (รอจัดประเภท ไม่กลายเป็น "ไม่ต้องใช้ SN")
//   • image/barcode ว่าง → ไม่ทับรูป/บาร์โค้ดของเรา
//   • ราคา null → ไม่ตั้ง (0 เท่านั้นถือว่าตั้งจริง) · ชื่อ = ชื่อต้นทาง (POS เก็บชื่อไทยของตัวเองแยกได้)
export function owProductToPartial(p: OwProduct): Partial<Product> & { sku: string } {
  const out: Partial<Product> & { sku: string } = { sku: p.sku };
  if (p.name) out.name_th = p.name;
  if (p.short_name) out.short_name = p.short_name;
  if (p.sale_price != null) out.price = p.sale_price;
  if (p.cost_price != null) out.cost = p.cost_price;
  if (typeof p.serial_tracking === "boolean") out.track_serial = p.serial_tracking;
  if (p.barcode) out.barcodes = [p.barcode];
  if (p.image_url) out.image_url = p.image_url;
  return out;
  // price tiers อื่น (member/wholesale/tag) + is_combined + serial_tracking===null อ่านจาก OwProduct ดิบ
}
