"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import type { CartLine, Product } from "../types";
import { computeTotals, round2, type CartTotals } from "../money";

interface CartState {
  lines: CartLine[];
  billDiscountAmount: number;
  billDiscountPercent: number;
  customerName: string;
  customerPhone: string;
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
  customerName: "",
  customerPhone: "",
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
  setCustomer: (customerName, customerPhone) => set({ customerName, customerPhone }),
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
      customerName: "",
      customerPhone: "",
      note: "",
      discountApprovedBy: null,
    }),

  totals: () => {
    const s = get();
    return computeTotals(s.lines, s.billDiscountAmount, s.billDiscountPercent);
  },
}));
