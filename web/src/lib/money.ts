// =====================================================================
// การคำนวณเงิน / VAT — รวมไว้ที่เดียว ห้ามคำนวณกระจายในหน้า UI
// ราคาสินค้าในระบบเป็น "ราคารวม VAT" (inclusive) ตามมาตรฐานค้าปลีกไทย
// =====================================================================

import type { CartLine } from "./types";

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

/** มูลค่าบรรทัดหลังหักส่วนลด (รวม VAT) */
export function lineTotal(line: CartLine): number {
  const gross = line.unit_price * line.qty;
  const discount = line.discount_amount > 0
    ? line.discount_amount
    : round2(gross * (line.discount_percent / 100));
  return round2(Math.max(gross - discount, 0));
}

export function lineDiscount(line: CartLine): number {
  const gross = line.unit_price * line.qty;
  return line.discount_amount > 0
    ? round2(line.discount_amount)
    : round2(gross * (line.discount_percent / 100));
}

export function lineCost(line: CartLine): number {
  return round2(line.unit_cost * line.qty);
}

export interface CartTotals {
  /** รวมราคาก่อนหักส่วนลด (รวม VAT) */
  subtotal: number;
  /** ส่วนลดรวม (บรรทัด + ท้ายบิล) */
  discountTotal: number;
  /** ยอดสุทธิที่ต้องจ่าย (รวม VAT) */
  grandTotal: number;
  /** ฐานภาษี (ไม่รวม VAT) */
  baseAmount: number;
  /** VAT ที่รวมอยู่ในยอดสุทธิ */
  vatAmount: number;
  costTotal: number;
  grossProfit: number;
  itemCount: number;
  unitCount: number;
}

export function computeTotals(lines: CartLine[], billDiscount = 0, billDiscountPercent = 0): CartTotals {
  let subtotal = 0;
  let lineDiscounts = 0;
  let costTotal = 0;
  let unitCount = 0;

  for (const l of lines) {
    subtotal += l.unit_price * l.qty;
    lineDiscounts += lineDiscount(l);
    costTotal += lineCost(l);
    unitCount += l.qty;
  }
  subtotal = round2(subtotal);
  lineDiscounts = round2(lineDiscounts);

  const afterLines = round2(subtotal - lineDiscounts);
  const billDisc = billDiscount > 0
    ? round2(billDiscount)
    : round2(afterLines * (billDiscountPercent / 100));

  const grandTotal = round2(Math.max(afterLines - billDisc, 0));
  const baseAmount = round2((grandTotal * 100) / (100 + VAT_RATE));
  const vatAmount = round2(grandTotal - baseAmount);

  return {
    subtotal,
    discountTotal: round2(lineDiscounts + billDisc),
    grandTotal,
    baseAmount,
    vatAmount,
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
