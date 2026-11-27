// =====================================================================
// กางยอดขายระบบเดิม (Lark) แบบบีบอัดจากเซิร์ฟเวอร์ → Order (source "lark") ให้หน้ายอดขายใช้สูตรเดียวกับบิล POS
//   ระบบเดิมไม่มีเวลาขาย → ตั้งเที่ยงวันเวลาไทย (หน้าเว็บไม่เอาไปคิดรายชั่วโมง) · คืนสินค้า = บิลยกเลิก
// =====================================================================
import type { Branch, Order } from "@/lib/types";
import { tr } from "@/lib/i18n/tr";

/** [branch | "lark:<place_key>", "YYYY-MM-DD", bill_no, returned 0|1, event 0|1, [[sku_i, qty, unit, disc, amount, pay_i]]] */
export type LegacyBill = [string, string, string, 0 | 1, 0 | 1, [number, number | null, number | null, number | null, number | null, number][], string?];
export type LegacyCompact = { skus: [string, string | null, string | null, string | null][]; pays: string[]; places: Record<string, [string | null, boolean]>; bills: LegacyBill[] };
/** ช่วงก่อนหน้า: [branch, date, event 0|1, bills, amount] */
export type LegacyDaily = [string, string, 0 | 1, number, number][];

const PAY: [RegExp, string][] = [[/online|线上|ออนไลน์/i, "online_payment"], [/บัตรเครดิต|credit|信用卡/i, "credit_card"], [/เดบิต|debit/i, "debit_card"], [/qr|扫码|พร้อมเพย์|promptpay/i, "qr_promptpay"], [/โอน|转账|transfer/i, "bank_transfer"], [/เงินสด|cash|现金/i, "cash"], [/ผ่อน|installment|分期/i, "installment"]];
export const legacyPayMethod = (s: string | null | undefined) => { if (!s) return "unspecified"; for (const [re, m] of PAY) if (re.test(s)) return m; return "other"; };
const NO_SKU = () => tr("ไม่ระบุสินค้า (ระบบเดิมไม่ส่งรหัส)", "Unspecified item (no code from legacy)", "未注明商品（旧系统无编码）");
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number | null | undefined) => Number(n) || 0;

export function expandLegacy(c: LegacyCompact): { orders: Order[]; pseudoBranches: Branch[] } {
  const pay = c.pays.map(legacyPayMethod);
  const pseudo = new Map<string, Branch>();
  const orders: Order[] = new Array(c.bills.length);
  for (let b = 0; b < c.bills.length; b++) {
    const [rawBr, date, billNo, ret, ev, lines, placeKey] = c.bills[b];
    const br = rawBr || "lark:unknown";
    if (br.startsWith("lark:") && !pseudo.has(br)) {
      const pl = c.places[br.slice(5)];
      const nm = pl?.[0] || (ev ? "อีเวนต์ (ระบบเดิม)" : "ร้านที่ยังไม่จับคู่");
      pseudo.set(br, { id: br, code: ev ? "EVENT" : "LARK", name: nm, name_th: nm, brand_id: null, province: null, branch_type: ev ? "popup" : "brand_shop", is_active: true } as unknown as Branch);
    }
    let total = 0, disc = 0;
    const pays = new Map<string, number>();
    const items = lines.map(([si, qty, unit, d, amt, pi], k) => {
      const s = c.skus[si];
      const q = num(qty) || 1, a = num(amt), dd = num(d);
      total += a; disc += dd;
      const m = pay[pi] ?? "other"; pays.set(m, (pays.get(m) ?? 0) + a);
      // ระบบเดิมไม่ส่งรหัส/ชื่อสินค้ามา (key "?") → ระบุชัดว่าไม่ทราบสินค้า
      const unknown = !s || s[0] === "?";
      return { id: `${billNo}:${k}`, product_id: s?.[2] ?? null, sku: unknown ? "" : s[0], name: unknown ? NO_SKU() : s[1] ?? s[0], kind: "goods", qty: q, unit_price: num(unit) || r2(a / q), discount_amount: dd,
        line_total: a, unit_cost: 0, cost_total: 0, gross_profit: 0, serials: [], salesperson_id: null, returned_qty: ret ? q : 0, is_gift: false, brand_id: s?.[3] ?? null };
    });
    total = r2(total); disc = r2(disc);
    // รหัสบิลคงที่ = ร้านในระบบเดิม (ไม่ใช่สาขาที่จับคู่ — แก้การจับคู่แล้วค่าที่กรอกไว้ยังผูกบิลเดิม)
    const id = `lark:${placeKey ?? br}|${date}|${billNo}|${ret}`;
    orders[b] = {
      id, client_uuid: id, order_no: billNo, branch_id: br, terminal_id: null, shift_id: null, cashier_id: null, salesperson_id: null, customer_id: null, customer_name: null, customer_phone: null,
      status: ret ? "voided" : "completed", channel: ev ? "event" : "offline",
      subtotal: r2(total + disc), discount_total: disc, vat_amount: r2((total * 7) / 107), grand_total: total, paid_total: total, change_amount: 0, cost_total: 0, gross_profit: 0,
      created_at: `${date}T05:00:00.000Z`, void_reason: ret ? "คืนสินค้า (ระบบเดิม Lark)" : null, is_offline_origin: false, synced: true, source: "lark",
      items, payments: [...pays.entries()].filter(([, a]) => a > 0).map(([method, amount]) => ({ method, amount: r2(amount) })),
    } as unknown as Order;
  }
  return { orders, pseudoBranches: [...pseudo.values()] };
}

/** ช่วงก่อนหน้า → แถวย่อ (น้ำหนัก n = จำนวนบิล) */
export function expandLegacyDaily(d: LegacyDaily) {
  return d.map(([br, date, ev, n, amt]) => ({ branch_id: br, grand_total: Number(amt) || 0, status: "completed", channel: ev ? "event" : "offline", created_at: `${date}T05:00:00.000Z`, n: Number(n) || 1, source: "lark" as const }));
}
