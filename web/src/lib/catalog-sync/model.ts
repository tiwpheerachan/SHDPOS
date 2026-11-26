import type { OwProduct } from "@/lib/onewarehouse/ow-client";
import { tr } from "@/lib/i18n/tr";
export interface ProductPage {
  items: OwProduct[];
  has_more: boolean;
  next_cursor: string | null;
}
export const skuKey = (sku: string) => sku.trim().toUpperCase();
export function decodeProduct(raw: unknown): OwProduct {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error(tr("รูปแบบสินค้าไม่ถูกต้อง", "Invalid product format", "商品格式无效"));
  const r = raw as Record<string, unknown>;
  if (typeof r.sku !== "string" || !r.sku.trim() || r.sku.length > 200)
    throw Error(tr("SKU ไม่ถูกต้อง", "Invalid SKU", "SKU 无效"));
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
      throw Error(tr(`ข้อมูล ${key} ไม่ถูกต้อง`, `Invalid ${key}`, `${key} 数据无效`));
    result[key] = typeof value === "string" ? value.trim() || null : null;
  }
  for (const key of ["serial_tracking", "is_combined"]) {
    const value = r[key];
    if (value != null && typeof value !== "boolean")
      throw Error(tr(`ข้อมูล ${key} ไม่ถูกต้อง`, `Invalid ${key}`, `${key} 数据无效`));
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
      throw Error(tr(`ข้อมูล ${key} ไม่ถูกต้อง`, `Invalid ${key}`, `${key} 数据无效`));
    result[key] = value ?? null;
  }
  return result as unknown as OwProduct;
}
export function decodePage(
  raw: unknown,
  currentCursor: string | null,
): ProductPage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error(tr("API list ต้องตอบ items / has_more / next_cursor", "API list must return items / has_more / next_cursor", "API list 必须返回 items / has_more / next_cursor"));
  const r = raw as Record<string, unknown>;
  if (
    !Array.isArray(r.items) ||
    r.items.length > 200 ||
    typeof r.has_more !== "boolean"
  )
    throw Error(tr("รูปแบบ pagination ไม่ถูกต้อง", "Invalid pagination format", "分页格式无效"));
  const next = r.next_cursor ?? null;
  if (next !== null && typeof next !== "string")
    throw Error(tr("cursor ไม่ถูกต้อง", "Invalid cursor", "cursor 无效"));
  if (r.has_more && (!next || next === currentCursor))
    throw Error(tr("API ส่ง cursor ว่างหรือซ้ำ กรุณาตรวจฝั่ง OneWarehouse", "API returned an empty or repeated cursor. Please check OneWarehouse.", "API 返回空或重复的 cursor，请检查 OneWarehouse"));
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
      reasons: [tr("SKU ซ้ำในแคตตาล็อก POS", "Duplicate SKU in POS catalog", "POS 目录中 SKU 重复")],
    };
  const linked = linkedId ? products.find((p) => p.id === linkedId) : null;
  if (linkedId && (!linked || skuKey(linked.sku) !== item.sku_key))
    return {
      kind: "conflict",
      product: linked ?? null,
      reasons: [tr("รหัสที่ผูกไว้ไม่ตรง SKU ปัจจุบัน ต้องตรวจการเปลี่ยนรหัส", "Linked ID doesn't match current SKU — check for a code change", "已关联的编码与当前 SKU 不符，请检查编码变更")],
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
      reasons: [tr("บาร์โค้ดถูกใช้กับสินค้าอีกตัว", "Barcode already used by another product", "条码已被其他商品使用")],
    };
  if (
    product &&
    typeof item.detail?.serial_tracking === "boolean" &&
    product.track_serial !== item.detail.serial_tracking
  )
    return {
      kind: "conflict",
      product,
      reasons: [tr("นโยบาย SN ไม่ตรง ต้องตรวจด้วยผู้ดูแล", "SN policy mismatch — admin review required", "SN 策略不一致，需管理员审核")],
    };
  if (
    product &&
    typeof item.detail?.is_combined === "boolean" &&
    (product.kind === "bundle") !== item.detail.is_combined
  )
    return {
      kind: "conflict",
      product,
      reasons: [tr("ประเภทสินค้าชุดไม่ตรง ต้องตรวจด้วยผู้ดูแล", "Bundle type mismatch — admin review required", "套装类型不一致，需管理员审核")],
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
        ? tr("ไม่พบ SKU ใน exact lookup", "SKU not found in exact lookup", "精确查询未找到 SKU")
        : tr("รอรายละเอียดจาก JST", "Waiting for JST details", "等待 JST 详情"),
    );
  const d = item.detail;
  const price = match.product?.price ?? d?.sale_price;
  if (price == null || price <= 0) issues.push(tr("ยังไม่มีราคาขายที่อนุมัติ", "No approved sale price yet", "尚无已批准的售价"));
  if (!match.product && d?.cost_price == null)
    issues.push(tr("ยังไม่มีต้นทุนที่ยืนยัน", "No confirmed cost yet", "尚无已确认的成本"));
  if (!match.product?.brand_id || !match.product?.category_id)
    issues.push(tr("รอตรวจแบรนด์และหมวดหมู่ใน POS", "Brand and category pending review in POS", "待在 POS 中审核品牌和分类"));
  if (d?.serial_tracking == null && !match.product)
    issues.push(tr("ยังไม่ทราบว่าต้องใช้ SN หรือไม่", "Unknown whether SN is required", "尚不确定是否需要 SN"));
  if (d?.is_combined == null) issues.push(tr("ยังไม่ทราบว่าเป็นสินค้าชุดหรือไม่", "Unknown whether this is a bundle", "尚不确定是否为套装"));
  if (d?.is_combined === true || match.product?.kind === "bundle") {
    if (item.bom_status !== "ok") issues.push(tr("รอส่วนประกอบ BOM", "Waiting for BOM components", "等待 BOM 组件"));
    else issues.push(tr("รอตั้งค่าการขายสินค้าชุดใน POS", "Bundle sale setup pending in POS", "待在 POS 中设置套装销售"));
  }
  if (!mappedWarehouse) issues.push(tr("ยังไม่ผูกคลังกับสาขา", "Warehouse not mapped to a branch", "仓库尚未关联门店"));
  if (item.stock_qty == null)
    issues.push(item.stock_error ? tr("อ่านสต๊อกไม่สำเร็จ", "Failed to read stock", "读取库存失败") : tr("ยังไม่ตรวจสต๊อก", "Stock not checked", "尚未检查库存"));
  return [...new Set(issues)];
}
