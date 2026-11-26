import { round2 } from "@/lib/money";

export interface CatalogPrice {
  kind?: string;
  vat_rate?: number;
  vat_mode?: string;
  id: string;
  sku: string;
  name_th: string;
  price: number;
  cost: number;
  is_active: boolean;
  track_serial: boolean;
  is_stocked: boolean;
  is_discountable: boolean;
  max_discount_percent: number | null;
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("รูปแบบข้อมูลไม่ถูกต้อง");
  return value as Record<string, any>;
}
function amount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${label}ไม่ถูกต้อง`);
  return round2(value);
}
export function validateQuote(
  input: unknown,
  catalog: CatalogPrice[],
  limit: number,
  options: {preview?:boolean; allowVatModes?:boolean} = {},
): Record<string, any> {
  const p = object(input);
  if (!UUID.test(p.client_uuid) || !UUID.test(p.branch_id))
    throw new Error("รหัสรายการหรือสาขาไม่ถูกต้อง");
  if (p.reserve) throw new Error("การส่งมอบภายหลังยังไม่พร้อมเชื่อมสต๊อกกลาง");
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 200)
    throw new Error("จำนวนรายการสินค้าไม่ถูกต้อง");
  // Redemption needs a single server transaction with the sale, not independent client claims.
  if (p.redeem_points || p.coupon_code)
    throw new Error(
      "การใช้แต้ม/คูปองต้องผ่านการตรวจสิทธิ์ส่วนกลางก่อน กรุณายกเลิกแต้ม/คูปองในบิลนี้",
    );
  const channels = new Set([
    "offline",
    "online_shopee",
    "online_lazada",
    "online_tiktok",
    "online_website",
    "event",
    "b2b",
    "other",
  ]);
  if (!channels.has(p.channel)) throw new Error("ช่องทางขายไม่ถูกต้อง");
  for (const key of [
    "terminal_id",
    "shift_id",
    "customer_id",
    "salesperson_id",
  ])
    if (p[key] && !UUID.test(p[key])) throw new Error("รหัสอ้างอิงไม่ถูกต้อง");
  const products = new Map(catalog.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const items = p.items.map((raw: unknown) => {
    const i = object(raw);
    if (i.is_gift)
      throw new Error("ของแถมต้องผ่านการอนุมัติและตรวจแคมเปญส่วนกลางก่อน");
    const product = products.get(i.product_id);
    if (!product?.is_active) throw new Error("สินค้าไม่พบหรือปิดใช้งานแล้ว");
    if (product.kind === "bundle")
      throw new Error("สินค้าชุดต้องตรวจส่วนประกอบ BOM ก่อนเปิดขาย");
    // ภาษีแยก/ยกเว้น/อัตราอื่น: คิดที่ขั้นสุดท้าย pos_quote_finalize_vat (0076) · สาขาที่ส่งบิลเข้า JST ยังรับเฉพาะราคารวม VAT 7%
    const vatMode = product.vat_mode ?? "inclusive";
    const vatRate = product.vat_rate == null ? 7 : Number(product.vat_rate);
    if (!["inclusive", "exclusive", "exempt"].includes(vatMode) || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 30)
      throw new Error(`ตั้งค่าภาษีของ ${product.sku} ไม่ถูกต้อง`);
    if (!options.allowVatModes && (vatRate !== 7 || vatMode !== "inclusive"))
      throw new Error(`${product.sku} ตั้งภาษีแบบ${vatMode === "exclusive" ? "แยก VAT" : vatMode === "exempt" ? "ยกเว้น VAT" : `อัตรา ${vatRate}%`} — สาขาที่ส่งบิลเข้า JST รับได้เฉพาะราคารวม VAT 7%`);
    const qty = i.qty;
    if (
      typeof qty !== "number" ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      qty > 10000 ||
      Math.round(qty * 1000) !== qty * 1000
    )
      throw new Error("จำนวนสินค้าไม่ถูกต้อง");
    if (Number(product.price) <= 0)
      throw new Error(`ยังไม่มีราคาขายที่อนุมัติ: ${product.sku}`);
    const price = amount(i.unit_price, "ราคา");
    if (price !== round2(Number(product.price)))
      throw new Error(
        `ราคา ${product.sku} เปลี่ยนหรือยังไม่ได้รับอนุมัติ กรุณาโหลดราคาใหม่`,
      );
    const gross = round2(price * qty);
    const percent = amount(i.discount_percent ?? 0, "ส่วนลด");
    const discount = amount(
      i.discount_amount || round2((gross * percent) / 100),
      "ส่วนลด",
    );
    if (discount > gross) throw new Error("ส่วนลดเกินมูลค่าสินค้า");
    const max = product.is_discountable
      ? Math.min(limit, product.max_discount_percent ?? 100)
      : 0;
    if (discount > round2((gross * max) / 100))
      throw new Error(
        `ส่วนลด ${product.sku} เกินสิทธิ์ ต้องให้ผู้มีสิทธิ์ตรวจรายการ`,
      );
    const serials = Array.isArray(i.serials)
      ? i.serials.map((sn: unknown) => {
          if (typeof sn !== "string" || !sn.trim() || sn.length > 200)
            throw new Error("SN ไม่ถูกต้อง");
          return sn.trim().toUpperCase();
        })
      : [];
    if (
      product.track_serial &&
      (!Number.isInteger(qty) || (!options.preview && serials.length !== qty))
    )
      throw new Error(`กรุณาสแกน SN ให้ครบ: ${product.sku}`);
    if (!product.track_serial && serials.length)
      throw new Error("สินค้านี้ไม่ได้ตั้งค่าให้ใช้ SN");
    for (const sn of serials) {
      if (seen.has(sn)) throw new Error("SN ซ้ำในบิล");
      seen.add(sn);
    }
    return {
      product_id: product.id,
      sku: product.sku,
      name: product.name_th,
      kind: product.kind === "service" ? "service" : "goods",
      qty,
      unit_price: price,
      discount_amount: discount,
      discount_percent: percent,
      line_total: round2(gross - discount),
      vat_mode: vatMode,
      vat_rate: vatRate,
      vat_amount: round2(gross - discount - (gross - discount) / 1.07),
      unit_cost: Number(product.cost),
      cost_total: round2(Number(product.cost) * qty),
      gross_profit: round2(
        (gross - discount) / 1.07 - Number(product.cost) * qty,
      ),
      serials,
      salesperson_id: p.salesperson_id ?? null,
      is_gift: false,
    };
  });
  const subtotal = round2(
    items.reduce((s: number, i: any) => s + i.unit_price * i.qty, 0),
  );
  const discount = amount(p.discount_total, "ส่วนลดรวม");
  const lineDiscounts = round2(
    items.reduce((s: number, i: any) => s + i.discount_amount, 0),
  );
  if (discount < lineDiscounts || discount > round2((subtotal * limit) / 100))
    throw new Error("ส่วนลดรวมเกินสิทธิ์หรือไม่ตรงกับรายการ");
  const extraDiscount = round2(discount - lineDiscounts);
  const extraBase = items
    .filter((i: any) => products.get(i.product_id)?.is_discountable)
    .reduce((s: number, i: any) => s + i.line_total, 0);
  if (extraDiscount > round2((extraBase * limit) / 100))
    throw new Error("ส่วนลดท้ายบิลเกินสิทธิ์");
  const total = round2(subtotal - discount);
  if (total <= 0 || total !== amount(p.grand_total, "ยอดสุทธิ"))
    throw new Error("ยอดสุทธิไม่ตรง กรุณาตรวจบิลใหม่");
  return {
    client_uuid: p.client_uuid,
    branch_id: p.branch_id,
    terminal_id: p.terminal_id ?? null,
    shift_id: p.shift_id ?? null,
    customer_id: p.customer_id ?? null,
    customer_name: String(p.customer_name ?? "").slice(0, 200),
    customer_phone: String(p.customer_phone ?? "").slice(0, 30),
    salesperson_id: p.salesperson_id ?? null,
    channel: p.channel,
    status: "completed",
    is_offline_origin: false,
    items,
    subtotal,
    discount_total: discount,
    discount_percent: subtotal ? round2((discount / subtotal) * 100) : 0,
    grand_total: total,
    vat_amount: round2(total - total / 1.07),
  };
}
export function validatePayments(value: unknown, total: number) {
  const methods = new Set([
    "credit_card",
    "debit_card",
    "edc",
    "installment",
    "bank_transfer",
    "qr_promptpay",
  ]);
  if (!Array.isArray(value) || !value.length || value.length > 20)
    throw new Error("กรุณาระบุการรับชำระ");
  const payments = value.map((raw) => {
    const p = object(raw);
    if (!methods.has(p.method))
      throw new Error("ช่องทางนี้ยังไม่เปิดใช้งาน บริษัทไม่รับเงินสด");
    const paid = amount(p.amount, "ยอดชำระ");
    if (!paid) throw new Error("ยอดชำระต้องมากกว่าศูนย์");
    for (const key of ["reference_no","approval_code","acquirer_bank","card_last4"]) {
      if(p[key]!=null && typeof p[key]!=="string")throw new Error("ข้อมูลอ้างอิงรับชำระไม่ถูกต้อง");
    }
    if(p.card_last4 && !/^\d{4}$/.test(p.card_last4))throw new Error("เลขบัตรท้ายต้องเป็นตัวเลขสี่หลัก");
    const ref = String(p.reference_no || p.approval_code || "").trim();
    if (!ref || ref.length > 150)
      throw new Error("กรุณาระบุเลขอ้างอิงการรับชำระ");
    if (
      p.method === "installment" &&
      ![3, 4, 6, 9, 10, 12, 18, 24, 36].includes(p.installment_months)
    )
      throw new Error("จำนวนงวดไม่ถูกต้อง");
    return {
      method: p.method,
      amount: paid,
      reference_no: ref,
      approval_code: p.approval_code ?? null,
      acquirer_bank: p.acquirer_bank ?? null,
      card_last4: p.card_last4 ?? null,
      installment_months: p.installment_months ?? null,
      // เครื่อง EDC ที่เลือก (0080) — เซิร์ฟเวอร์ตรวจ/เติมธนาคาร MID TID ค่าธรรมเนียมเองใน enrichEdcPayments
      edc_terminal_id: typeof p.edc_terminal_id === "string" ? p.edc_terminal_id : null,
      card_brand: typeof p.card_brand === "string" ? p.card_brand.slice(0, 20) : null,
      fee_amount: 0,
    };
  });
  if (round2(payments.reduce((s, p) => s + p.amount, 0)) !== round2(total))
    throw new Error("ยอดรับชำระต้องเท่ากับยอดบิล บริษัทไม่มีเงินทอน");
  return payments;
}
