// =====================================================================
// การคำนวณเงิน / VAT — รวมไว้ที่เดียว ห้ามคำนวณกระจายในหน้า UI
// ราคาสินค้าในระบบเป็น "ราคารวม VAT" (inclusive) ตามมาตรฐานค้าปลีกไทย
// =====================================================================

import type { CartLine } from "./types";
import { computeVat } from "./tax";

export const VAT_RATE = 7;

/** ปัดเป็นสตางค์ (2 ตำแหน่ง) แบบ half-up กันปัญหา floating point */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** ปัดเศษสตางค์ตอนรับเงินสด (ไทยใช้ทศนิยม 2 ตำแหน่ง ไม่ต้องปัดขึ้นบาท) */
export function roundCash(n: number): number {
  return round2(n);
}

export function formatTHB(n: number, withSymbol = true): string {
  const s = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n ?? 0);
  return withSymbol ? `฿${s}` : s;
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("th-TH").format(Math.round(n ?? 0));
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return formatInt(n);
}

/** ส่วนลดที่พนักงานกดเองในบรรทัด (นับเพดานสิทธิ์ส่วนลด) */
export function lineManualDiscount(line: CartLine): number {
  const gross = line.unit_price * line.qty;
  const d = line.discount_amount > 0
    ? round2(line.discount_amount)
    : round2(gross * (line.discount_percent / 100));
  return Math.min(d, round2(gross));
}

/** ส่วนลดจากโปรรายสินค้า — สูตรเดียวกับเซิร์ฟเวอร์ (pos_apply_line_campaigns):
 *  ฐาน = ยอดบรรทัดหลังส่วนลดพนักงาน · amount = บาทต่อชิ้น × จำนวน · percent = % ของฐาน · ไม่เกิน max_discount/ฐาน */
export function lineCampaignDiscount(line: CartLine): number {
  const c = line.campaign;
  if (!c || line.is_gift) return 0;
  const base = round2(Math.max(line.unit_price * line.qty - lineManualDiscount(line), 0));
  let d = c.type === "percent" ? round2((base * c.value) / 100) : Math.min(c.value * line.qty, base);
  if (c.max_discount != null) d = Math.min(d, c.max_discount);
  return round2(Math.max(0, Math.min(d, base)));
}

/** ส่วนลดรวมของบรรทัด (พนักงาน + โปรรายสินค้า) */
export function lineDiscount(line: CartLine): number {
  return round2(lineManualDiscount(line) + lineCampaignDiscount(line));
}

/** มูลค่าบรรทัดหลังหักส่วนลดทั้งหมด (รวม VAT) */
export function lineTotal(line: CartLine): number {
  return round2(Math.max(line.unit_price * line.qty - lineDiscount(line), 0));
}

export function lineCost(line: CartLine): number {
  return round2(line.unit_cost * line.qty);
}

export interface CartTotals {
  /** รวมราคาก่อนหักส่วนลด (รวม VAT) */
  subtotal: number;
  /** ส่วนลดรวม (บรรทัด + ท้ายบิล) — ส่วนลดจากพนักงาน ใช้เช็คสิทธิอนุมัติ */
  discountTotal: number;
  /** ส่วนลดรายการที่พนักงานกดเอง (รวมทุกบรรทัด) */
  lineDiscountTotal: number;
  /** ส่วนลดจากโปรรายสินค้า (ไม่นับเพดานสิทธิ์พนักงาน) */
  campaignLineTotal: number;
  /** ส่วนลดท้ายบิล (คิดจากยอดหลังหักส่วนลดรายการ) */
  billDiscountTotal: number;
  /** ยอดหลังหักส่วนลดรายการ = ฐานของส่วนลดท้ายบิล */
  afterLineDiscount: number;
  /** ส่วนลดจากการใช้แต้มลูกค้า (แยกจากส่วนลดพนักงาน ไม่ต้องขออนุมัติ) */
  redeemAmount: number;
  /** ส่วนลดจากคูปอง/แคมเปญ */
  couponAmount: number;
  /** ยอดสุทธิที่ต้องจ่าย (รวม VAT) */
  grandTotal: number;
  /** ฐานภาษี (ไม่รวม VAT) */
  baseAmount: number;
  /** VAT รวมทั้งบิล (= ผลรวม VAT รายบรรทัด) */
  vatAmount: number;
  /** VAT ที่บวกเพิ่มจากสินค้าราคาก่อน VAT (exclusive) — รวมอยู่ใน grandTotal แล้ว */
  exclusiveVat: number;
  costTotal: number;
  grossProfit: number;
  itemCount: number;
  unitCount: number;
}

export function computeTotals(lines: CartLine[], billDiscount = 0, billDiscountPercent = 0, redeemAmount = 0, couponAmount = 0): CartTotals {
  let subtotal = 0;
  let lineDiscounts = 0;
  let campaignLines = 0;
  let costTotal = 0;
  let unitCount = 0;

  for (const l of lines) {
    subtotal += l.unit_price * l.qty;
    lineDiscounts += lineManualDiscount(l);
    campaignLines += lineCampaignDiscount(l);
    costTotal += lineCost(l);
    unitCount += l.qty;
  }
  subtotal = round2(subtotal);
  lineDiscounts = round2(lineDiscounts);
  campaignLines = round2(campaignLines);

  const afterLines = round2(subtotal - lineDiscounts - campaignLines);
  const billDisc = billDiscount > 0
    ? round2(billDiscount)
    : round2(afterLines * (billDiscountPercent / 100));

  // ส่วนลดจากคูปอง + แต้ม — รวมกันไม่เกินยอดหลังหักส่วนลดพนักงาน
  const afterBill = Math.max(afterLines - billDisc, 0);
  const coupon = round2(Math.min(Math.max(couponAmount, 0), afterBill));
  const redeem = round2(Math.min(Math.max(redeemAmount, 0), Math.max(afterBill - coupon, 0)));
  // VAT รายบรรทัด (lib/tax — สูตรเดียวกับเซิร์ฟเวอร์ 0076): กระจายส่วนลดหัวบิล · รวม/แยก/ยกเว้น VAT ตามสินค้า
  const header = round2(Math.max(afterBill - coupon - redeem, 0));
  const tax = computeVat(lines.map((l) => ({ amount: l.is_gift ? 0 : lineTotal(l), mode: l.vat_mode ?? "inclusive", rate: l.vat_rate ?? VAT_RATE })), header);
  const grandTotal = tax.total;
  const baseAmount = tax.base;
  const vatAmount = tax.vat;

  return {
    subtotal,
    discountTotal: round2(lineDiscounts + billDisc),
    lineDiscountTotal: lineDiscounts,
    campaignLineTotal: campaignLines,
    billDiscountTotal: billDisc,
    afterLineDiscount: afterLines,
    redeemAmount: redeem,
    couponAmount: coupon,
    grandTotal,
    baseAmount,
    vatAmount,
    exclusiveVat: tax.exclusiveVat,
    costTotal: round2(costTotal),
    grossProfit: round2(baseAmount - costTotal),
    itemCount: lines.length,
    unitCount,
  };
}

/** % ส่วนลดรวมของทั้งบิล — ใช้เช็คว่าต้องขออนุมัติไหม */
export function effectiveDiscountPercent(totals: CartTotals): number {
  if (totals.subtotal <= 0) return 0;
  return round2((totals.discountTotal / totals.subtotal) * 100);
}
