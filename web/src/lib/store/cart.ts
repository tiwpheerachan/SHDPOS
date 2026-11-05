"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import type { CartLine, Product } from "../types";
import { computeTotals, round2, type CartTotals } from "../money";
import { pointsToBaht } from "../loyalty";

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
  setLinePrice: (lineId: string, price: number) => void;
  setLineSerials: (lineId: string, serials: string[]) => void;
  setLineSalesperson: (lineId: string, employeeId: string | null) => void;
  setBillDiscount: (percent: number, amount: number) => void;
  setCustomer: (name: string, phone: string) => void;
  /** ผูกลูกค้าจากฐานข้อมูล (มี id + ยอดแต้ม/เครดิต) — ใช้ตอนเลือก/สร้างจาก CustomerPicker */
  setCustomerRef: (c: { id: string; name: string; phone?: string | null; points?: number; store_credit?: number }) => void;
  clearCustomer: () => void;
  /** ตั้งจำนวนแต้มที่จะใช้เป็นส่วนลด */
  setRedeem: (points: number) => void;
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
      // สินค้าที่ไม่ต้องคุม serial → รวมบรรทัดเดิม
      const existing = !p.track_serial && s.lines.find((l) => l.product_id === p.id && l.discount_percent === 0 && l.discount_amount === 0);
      if (existing) {
        return {
          lines: s.lines.map((l) => (l.lineId === existing.lineId ? { ...l, qty: l.qty + qty } : l)),
        };
      }
      const line: CartLine = {
        lineId: nanoid(),
        product_id: p.id,
        sku: p.sku,
        name: p.name_th,
        kind: p.kind === "service" ? "service" : p.kind === "fee" ? "fee" : "goods",
        qty,
        unit_price: p.price,
        list_price: p.price,
        discount_amount: 0,
        discount_percent: 0,
        unit_cost: p.cost,
        track_serial: p.track_serial,
        serials: [],
        salesperson_id: s.defaultSalespersonId,
      };
      return { lines: [...s.lines, line] };
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
      lines: qty <= 0
        ? s.lines.filter((l) => l.lineId !== lineId)
        : s.lines.map((l) => (l.lineId === lineId ? { ...l, qty } : l)),
    })),

  removeLine: (lineId) => set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) })),

  setLineDiscount: (lineId, percent, amount) =>
    set((s) => ({
      lines: s.lines.map((l) =>
        l.lineId === lineId ? { ...l, discount_percent: percent, discount_amount: amount } : l
      ),
    })),

  setLinePrice: (lineId, price) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, unit_price: round2(price) } : l)),
    })),

  setLineSerials: (lineId, serials) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, serials, qty: Math.max(l.qty, serials.length || 1) } : l)),
    })),

  setLineSalesperson: (lineId, employeeId) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, salesperson_id: employeeId } : l)),
    })),

  setBillDiscount: (percent, amount) => set({ billDiscountPercent: percent, billDiscountAmount: amount }),
  // พิมพ์ชื่อ/เบอร์เองในช่อง = ลูกค้าไม่ผูกกับ record → ล้าง customerId + แต้ม
  setCustomer: (customerName, customerPhone) =>
    set({ customerName, customerPhone, customerId: null, customerPoints: 0, customerCredit: 0, redeemPoints: 0 }),
  setCustomerRef: (c) =>
    set({
      customerId: c.id,
      customerName: c.name,
      customerPhone: c.phone ?? "",
      customerPoints: Math.max(0, Math.floor(Number(c.points ?? 0))),
      customerCredit: Number(c.store_credit ?? 0),
      redeemPoints: 0,
    }),
  clearCustomer: () =>
    set({ customerId: null, customerName: "", customerPhone: "", customerPoints: 0, customerCredit: 0, redeemPoints: 0 }),
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
  loadLines: (lines) => set({ lines }),

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
