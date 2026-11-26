"use client";

import { create } from "zustand";
import { priceOf } from "@/lib/pricing/price-book";
import { nanoid } from "nanoid";
import type { CartLine, LineCampaign, Product } from "../types";
import { computeTotals, round2, type CartTotals } from "../money";
import { pointsToBaht } from "../loyalty";
import { tr } from "../i18n/tr";

/** Combine equivalent sale rows while retaining every scanned physical unit. */
export function coalesceCartLines(lines: CartLine[]): CartLine[] {
  const result: CartLine[] = [];
  for (const line of lines) {
    const existing = line.product_id && !line.is_gift && !line.gift_source && line.discount_amount === 0
      ? result.find(l => l.product_id === line.product_id && !l.is_gift && !l.gift_source &&
          l.kind === line.kind && l.unit_price === line.unit_price && l.list_price === line.list_price &&
          l.unit_cost === line.unit_cost && l.discount_amount === 0 && l.discount_percent === line.discount_percent &&
          l.track_serial === line.track_serial && l.salesperson_id === line.salesperson_id &&
          (l.note ?? "") === (line.note ?? "") &&
          !l.serials.some(sn => line.serials.some(other => other.trim().toUpperCase() === sn.trim().toUpperCase())))
      : undefined;
    if (existing) { existing.qty += line.qty; existing.serials.push(...line.serials); }
    else result.push({ ...line, serials: [...line.serials] });
  }
  return result;
}

interface CartState {
  lines: CartLine[];
  billDiscountAmount: number;
  billDiscountPercent: number;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerPoints: number;
  customerCredit: number;
  /** จำนวนแต้มที่เลือกใช้เป็นส่วนลดกับบิลนี้ */
  redeemPoints: number;
  couponCode: string | null;
  couponDiscount: number;
  couponCampaignId: string | null;
  defaultSalespersonId: string | null;
  note: string;
  /** id ของ approval ที่ใช้อนุมัติส่วนลดเกินสิทธิ์ */
  discountApprovedBy: string | null;

  addProduct: (p: Product, qty?: number) => void;
  addCustomLine: (line: Partial<CartLine> & { name: string; unit_price: number }) => void;
  setQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  setLineDiscount: (lineId: string, percent: number, amount: number) => void;
  /** ใส่/ถอดโปรรายสินค้าของบรรทัด (null = ถอด) */
  setLineCampaign: (lineId: string, campaign: LineCampaign | null) => void;
  setLinePrice: (lineId: string, price: number) => void;
  setLineSerials: (lineId: string, serials: string[]) => void;
  setLineSalesperson: (lineId: string, employeeId: string | null) => void;
  /** สลับรายการเป็น/ออกจากของแถม (ราคาเรียกเก็บ 0 แต่คงต้นทุน + ตัดสต๊อก) */
  toggleGift: (lineId: string) => void;
  /** แทนที่ของแถมจากแคมเปญทั้งหมด (engine เรียกเมื่อตะกร้าเปลี่ยน) */
  setCampaignGifts: (giftLines: CartLine[]) => void;
  setBillDiscount: (percent: number, amount: number) => void;
  setCustomer: (name: string, phone: string) => void;
  /** ผูกลูกค้าจากฐานข้อมูล (มี id + ยอดแต้ม/เครดิต) — ใช้ตอนเลือก/สร้างจาก CustomerPicker */
  setCustomerRef: (c: { id: string; name: string; phone?: string | null; points?: number; store_credit?: number }) => void;
  clearCustomer: () => void;
  /** ตั้งจำนวนแต้มที่จะใช้เป็นส่วนลด */
  setRedeem: (points: number) => void;
  /** อัปเดตยอดกระเป๋า (แต้ม/เครดิต) ของแบรนด์สาขาปัจจุบัน */
  setWallet: (points: number, credit: number) => void;
  /** ใส่/ล้างคูปองที่ตรวจแล้วว่าใช้ได้ */
  setCoupon: (code: string, discount: number, campaignId: string) => void;
  clearCoupon: () => void;
  setDefaultSalesperson: (id: string | null) => void;
  setDiscountApprover: (id: string | null) => void;
  setNote: (n: string) => void;
  loadLines: (lines: CartLine[]) => void;
  clear: () => void;
  totals: () => CartTotals;
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  billDiscountAmount: 0,
  billDiscountPercent: 0,
  customerId: null,
  customerName: "",
  customerPhone: "",
  customerPoints: 0,
  customerCredit: 0,
  redeemPoints: 0,
  couponCode: null,
  couponDiscount: 0,
  couponCampaignId: null,
  defaultSalespersonId: null,
  note: "",
  discountApprovedBy: null,

  addProduct: (p, qty = 1) =>
    set((s) => {
      if (!Number.isFinite(qty) || qty <= 0 || (p.track_serial && !Number.isInteger(qty))) return s;
      const lines = coalesceCartLines(s.lines);
      // SN belongs to each unit within the same sale row, not a separate row per click.
      const existing = lines.find(l => l.product_id === p.id && !l.is_gift && !l.gift_source &&
        l.unit_price === p.price && l.list_price === p.price && l.unit_cost === p.cost &&
        l.track_serial === p.track_serial && l.salesperson_id === s.defaultSalespersonId &&
        !l.note && l.discount_percent === 0 && l.discount_amount === 0);
      if (existing) {
        return {
          lines: lines.map((l) => (l.lineId === existing.lineId ? { ...l, qty: l.qty + qty } : l)),
        };
      }
      const line: CartLine = {
        lineId: nanoid(),
        product_id: p.id,
        sku: p.sku,
        name: p.name_th,
        image_url: p.image_url ?? null,
        kind: p.kind === "service" ? "service" : p.kind === "fee" ? "fee" : "goods",
        qty,
        unit_price: priceOf(p),        // ราคาช่วงเวลา (ถ้ามี) ทับราคาหลัก — 0081
        list_price: p.price,
        discount_amount: 0,
        discount_percent: 0,
        unit_cost: p.cost,
        track_serial: p.track_serial,
        serials: [],
        salesperson_id: s.defaultSalespersonId,
        vat_mode: p.vat_mode ?? "inclusive",
        vat_rate: p.vat_rate ?? 7,
      };
      return { lines: [...lines, line] };
    }),

  addCustomLine: (input) =>
    set((s) => ({
      lines: [
        ...s.lines,
        {
          lineId: nanoid(),
          product_id: null,
          sku: input.sku ?? "CUSTOM",
          name: input.name,
          kind: input.kind ?? "fee",
          qty: input.qty ?? 1,
          unit_price: input.unit_price,
          list_price: input.unit_price,
          discount_amount: 0,
          discount_percent: 0,
          unit_cost: input.unit_cost ?? 0,
          track_serial: false,
          serials: [],
          salesperson_id: s.defaultSalespersonId,
        },
      ],
    })),

  setQty: (lineId, qty) =>
    set((s) => ({
      lines: !Number.isFinite(qty) ? s.lines : qty <= 0
        ? s.lines.filter((l) => l.lineId !== lineId)
        : s.lines.map(l => l.lineId === lineId && (!l.track_serial || (Number.isInteger(qty) && qty >= l.serials.length)) ? { ...l, qty } : l),
    })),

  removeLine: (lineId) => set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) })),

  setLineDiscount: (lineId, percent, amount) =>
    set((s) => ({
      lines: s.lines.map((l) =>
        l.lineId === lineId ? { ...l, discount_percent: percent, discount_amount: amount } : l
      ),
    })),

  setLineCampaign: (lineId, campaign) =>
    set((s) => ({ lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, campaign } : l)) })),

  setLinePrice: (lineId, price) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, unit_price: round2(price) } : l)),
    })),

  setLineSerials: (lineId, serials) =>
    set((s) => {
      const line = s.lines.find(l => l.lineId === lineId);
      if (!line) return s;
      const normalized = serials.map(sn => sn.trim().toUpperCase());
      const used = new Set(s.lines.filter(l => l.lineId !== lineId).flatMap(l => l.serials.map(sn => sn.trim().toUpperCase())));
      if ((!line.track_serial && normalized.length) || normalized.length > line.qty ||
          normalized.some(sn => !sn || used.has(sn)) || new Set(normalized).size !== normalized.length)
        throw new Error(tr("SN ซ้ำ ไม่ถูกต้อง หรือเกินจำนวนสินค้า", "SN duplicate, invalid, or exceeds quantity", "SN 重复、无效或超过数量"));
      return { lines: s.lines.map(l => l.lineId === lineId ? { ...l, serials: normalized } : l) };
    }),

  setLineSalesperson: (lineId, employeeId) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, salesperson_id: employeeId } : l)),
    })),

  toggleGift: (lineId) =>
    set((s) => ({
      lines: s.lines.map((l) => {
        if (l.lineId !== lineId) return l;
        if (l.is_gift) {
          // คืนค่าเป็นสินค้าขายปกติ
          return { ...l, is_gift: false, gift_source: undefined, unit_price: l.list_price, discount_amount: 0, discount_percent: 0 };
        }
        // ทำเป็นของแถม: ราคาเรียกเก็บ 0, ล้างส่วนลด (คง unit_cost ไว้คิดต้นทุน)
        return { ...l, is_gift: true, gift_source: "manual", unit_price: 0, discount_amount: 0, discount_percent: 0 };
      }),
    })),

  setCampaignGifts: (giftLines) =>
    set((s) => ({ lines: [...s.lines.filter((l) => l.gift_source !== "campaign"), ...giftLines] })),

  setBillDiscount: (percent, amount) => set({ billDiscountPercent: percent, billDiscountAmount: amount }),
  // เปลี่ยนลูกค้า = ล้างทั้งแต้มที่เลือก และคูปอง (สิทธิ์ขึ้นกับลูกค้า/กลุ่ม ต้องตรวจใหม่)
  setCustomer: (customerName, customerPhone) =>
    set({ customerName, customerPhone, customerId: null, customerPoints: 0, customerCredit: 0, redeemPoints: 0, couponCode: null, couponDiscount: 0, couponCampaignId: null }),
  setCustomerRef: (c) =>
    set({
      customerId: c.id,
      customerName: c.name,
      customerPhone: c.phone ?? "",
      customerPoints: Math.max(0, Math.floor(Number(c.points ?? 0))),
      customerCredit: Number(c.store_credit ?? 0),
      redeemPoints: 0,
      couponCode: null, couponDiscount: 0, couponCampaignId: null,
    }),
  clearCustomer: () =>
    set({ customerId: null, customerName: "", customerPhone: "", customerPoints: 0, customerCredit: 0, redeemPoints: 0, couponCode: null, couponDiscount: 0, couponCampaignId: null }),
  // อัปเดตยอดกระเป๋าตามแบรนด์ของสาขา (เรียกหลังผูกลูกค้า)
  setWallet: (points, credit) => set({ customerPoints: Math.max(0, Math.floor(points)), customerCredit: credit }),
  setRedeem: (points) => set((s) => ({ redeemPoints: Math.max(0, Math.min(Math.floor(points), s.customerPoints)) })),
  setCoupon: (couponCode, couponDiscount, couponCampaignId) => set({ couponCode, couponDiscount, couponCampaignId }),
  clearCoupon: () => set({ couponCode: null, couponDiscount: 0, couponCampaignId: null }),
  setDefaultSalesperson: (defaultSalespersonId) =>
    set((s) => ({
      defaultSalespersonId,
      lines: s.lines.map((l) => (l.salesperson_id ? l : { ...l, salesperson_id: defaultSalespersonId })),
    })),
  setDiscountApprover: (discountApprovedBy) => set({ discountApprovedBy }),
  setNote: (note) => set({ note }),
  loadLines: (lines) => set({ lines: coalesceCartLines(lines) }),

  clear: () =>
    set({
      lines: [],
      billDiscountAmount: 0,
      billDiscountPercent: 0,
      customerId: null,
      customerName: "",
      customerPhone: "",
      customerPoints: 0,
      customerCredit: 0,
      redeemPoints: 0,
      couponCode: null,
      couponDiscount: 0,
      couponCampaignId: null,
      note: "",
      discountApprovedBy: null,
    }),

  totals: () => {
    const s = get();
    return computeTotals(s.lines, s.billDiscountAmount, s.billDiscountPercent, pointsToBaht(s.redeemPoints), s.couponDiscount);
  },
}));
