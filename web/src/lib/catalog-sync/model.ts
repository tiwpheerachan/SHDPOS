import type { OwProduct } from "@/lib/onewarehouse/ow-client";
export interface ProductPage {
  items: OwProduct[];
  has_more: boolean;
  next_cursor: string | null;
}
export const skuKey = (sku: string) => sku.trim().toUpperCase();
export function decodeProduct(raw: unknown): OwProduct {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("รูปแบบสินค้าไม่ถูกต้อง");
  const r = raw as Record<string, unknown>;
  if (typeof r.sku !== "string" || !r.sku.trim() || r.sku.length > 200)
    throw Error("SKU ไม่ถูกต้อง");
  const result: Record<string, unknown> = { sku: r.sku.trim() };
  for (const key of [
    "name",
    "short_name",
    "barcode",
    "category",
    "brand",
    "image_url",
  ]) {
    const value = r[key];
    if (value != null && typeof value !== "string")
      throw Error(`ข้อมูล ${key} ไม่ถูกต้อง`);
    result[key] = typeof value === "string" ? value.trim() || null : null;
  }
  for (const key of ["serial_tracking", "is_combined"]) {
    const value = r[key];
    if (value != null && typeof value !== "boolean")
      throw Error(`ข้อมูล ${key} ไม่ถูกต้อง`);
    result[key] = value ?? null;
  }
  for (const key of [
    "sale_price",
    "member_price",
    "wholesale_price",
    "tag_price",
    "cost_price",
    "availableQty",
  ]) {
    const value = r[key];
    if (
      value != null &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (key !== "availableQty" && value < 0))
    )
      throw Error(`ข้อมูล ${key} ไม่ถูกต้อง`);
    result[key] = value ?? null;
  }
  return result as unknown as OwProduct;
}
export function decodePage(
  raw: unknown,
  currentCursor: string | null,
): ProductPage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("API list ต้องตอบ items / has_more / next_cursor");
  const r = raw as Record<string, unknown>;
  if (
    !Array.isArray(r.items) ||
    r.items.length > 200 ||
    typeof r.has_more !== "boolean"
  )
    throw Error("รูปแบบ pagination ไม่ถูกต้อง");
  const next = r.next_cursor ?? null;
  if (next !== null && typeof next !== "string")
    throw Error("cursor ไม่ถูกต้อง");
  if (r.has_more && (!next || next === currentCursor))
    throw Error("API ส่ง cursor ว่างหรือซ้ำ กรุณาตรวจฝั่ง OneWarehouse");
  return {
    items: r.items.map(decodeProduct),
    has_more: r.has_more,
    next_cursor: r.has_more ? (next as string) : null,
  };
}
export interface CatalogProduct {
  id: string;
  sku: string;
  name_th: string;
  price: number;
  cost: number;
  track_serial: boolean;
  kind: string;
  brand_id: string | null;
  category_id: string | null;
  image_url?: string | null;
  updated_at?: string;
  barcodes: string[];
}
export interface StageItem {
  sku: string;
  sku_key: string;
  summary: OwProduct;
  detail: OwProduct | null;
  detail_status: "pending" | "ok" | "error" | "missing";
  detail_error?: string | null;
  stock_qty: number | null;
  stock_error?: string | null;
  bom_status: "unknown" | "ok" | "unavailable";
  bom?: unknown;
  imported_product_id?: string | null;
  import_kind?: string | null;
  import_error?: string | null;
  stage_error?: string | null;
}
export interface Match {
  kind: "new" | "existing" | "conflict";
  product: CatalogProduct | null;
  reasons: string[];
}
export function matchProduct(
  item: StageItem,
  products: CatalogProduct[],
  linkedId?: string | null,
): Match {
  const candidates = products.filter((p) => skuKey(p.sku) === item.sku_key);
  if (item.stage_error)
    return { kind: "conflict", product: null, reasons: [item.stage_error] };
  if (candidates.length > 1)
    return {
      kind: "conflict",
      product: null,
      reasons: ["SKU ซ้ำในแคตตาล็อก POS"],
    };
  const linked = linkedId ? products.find((p) => p.id === linkedId) : null;
  if (linkedId && (!linked || skuKey(linked.sku) !== item.sku_key))
    return {
      kind: "conflict",
      product: linked ?? null,
      reasons: ["รหัสที่ผูกไว้ไม่ตรง SKU ปัจจุบัน ต้องตรวจการเปลี่ยนรหัส"],
    };
  const product = linked ?? candidates[0] ?? null;
  const barcode = item.detail?.barcode?.trim();
  if (
    barcode &&
    products.some((p) => p.id !== product?.id && p.barcodes.includes(barcode))
  )
    return {
      kind: "conflict",
      product,
      reasons: ["บาร์โค้ดถูกใช้กับสินค้าอีกตัว"],
    };
  if (
    product &&
    typeof item.detail?.serial_tracking === "boolean" &&
    product.track_serial !== item.detail.serial_tracking
  )
    return {
      kind: "conflict",
      product,
      reasons: ["นโยบาย SN ไม่ตรง ต้องตรวจด้วยผู้ดูแล"],
    };
  if (
    product &&
    typeof item.detail?.is_combined === "boolean" &&
    (product.kind === "bundle") !== item.detail.is_combined
  )
    return {
      kind: "conflict",
      product,
      reasons: ["ประเภทสินค้าชุดไม่ตรง ต้องตรวจด้วยผู้ดูแล"],
    };
  return { kind: product ? "existing" : "new", product, reasons: [] };
}
export function readiness(
  item: StageItem,
  match: Match,
  mappedWarehouse: boolean,
): string[] {
  const issues = [...match.reasons];
  if (item.detail_status !== "ok" || !item.detail)
    issues.push(
      item.detail_status === "missing"
        ? "ไม่พบ SKU ใน exact lookup"
        : "รอรายละเอียดจาก JST",
    );
  const d = item.detail;
  const price = match.product?.price ?? d?.sale_price;
  if (price == null || price <= 0) issues.push("ยังไม่มีราคาขายที่อนุมัติ");
  if (!match.product && d?.cost_price == null)
    issues.push("ยังไม่มีต้นทุนที่ยืนยัน");
  if (!match.product?.brand_id || !match.product?.category_id)
    issues.push("รอตรวจแบรนด์และหมวดหมู่ใน POS");
  if (d?.serial_tracking == null && !match.product)
    issues.push("ยังไม่ทราบว่าต้องใช้ SN หรือไม่");
  if (d?.is_combined == null) issues.push("ยังไม่ทราบว่าเป็นสินค้าชุดหรือไม่");
  if (d?.is_combined === true || match.product?.kind === "bundle") {
    if (item.bom_status !== "ok") issues.push("รอส่วนประกอบ BOM");
    else issues.push("รอตั้งค่าการขายสินค้าชุดใน POS");
  }
  if (!mappedWarehouse) issues.push("ยังไม่ผูกคลังกับสาขา");
  if (item.stock_qty == null)
    issues.push(item.stock_error ? "อ่านสต๊อกไม่สำเร็จ" : "ยังไม่ตรวจสต๊อก");
  return [...new Set(issues)];
}
