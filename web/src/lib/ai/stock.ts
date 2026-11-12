// =====================================================================
// วิเคราะห์สต๊อก (Phase B) — Days-of-Stock: เหลือพออีกกี่วันจากความเร็วขายจริง
//   on-hand (จาก stock) ÷ ความเร็วขายต่อวัน (จาก orders ช่วงที่เลือก)
//   คำนวณในเครื่อง · รวมหลายสาขาในขอบเขตที่เห็น · ไม่ส่งข้อมูลออกนอกระบบ
// =====================================================================
import type { Order, Product, StockLevel } from "@/lib/types";

export type StockStatus = "out" | "critical" | "low" | "healthy" | "overstock" | "idle";
export interface StockRow {
  productId: string; sku: string; name: string; brandId: string | null;
  onHand: number; reserved: number; soldUnits: number; velocity: number; // ชิ้น/วัน
  daysLeft: number | null;           // null = ไม่เคลื่อนไหว (ขายเป็น 0 แต่มีของ)
  reorderPoint: number; status: StockStatus; stockValue: number; cost: number;
}
export interface StockSummary {
  skuCount: number; out: number; critical: number; low: number; overstock: number; idle: number;
  totalValue: number; periodDays: number;
}
export interface StockAnalysis { rows: StockRow[]; summary: StockSummary }

const live = (o: Order) => o.status !== "voided";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** จำนวนวันในช่วง (อย่างน้อย 1) */
function periodDays(fromISO: string | Date, toISO: string | Date): number {
  const f = new Date(fromISO).getTime(), t = new Date(toISO).getTime();
  if (!isFinite(f) || !isFinite(t) || t < f) return 1;
  return Math.max(1, Math.round((t - f) / 86400000) + 1);
}

/**
 * วิเคราะห์ Days-of-Stock
 * @param orders  ออเดอร์ในขอบเขต/ช่วงที่เลือก (ใช้หาความเร็วขาย)
 * @param stock   ระดับสต๊อกในขอบเขต (รวมหลายสาขา)
 * @param products ทะเบียนสินค้า
 */
export function analyzeStock(
  orders: Order[], stock: StockLevel[], products: Product[],
  range: { from: string | Date; to: string | Date },
): StockAnalysis {
  const days = periodDays(range.from, range.to);
  const pMap = new Map(products.map((p) => [p.id, p]));

  // ขายได้กี่ชิ้นต่อสินค้า (ตามช่วง)
  const sold = new Map<string, number>();
  for (const o of orders) {
    if (!live(o)) continue;
    for (const it of o.items) {
      const pid = it.product_id || it.sku;
      if (!pid) continue;
      sold.set(pid, (sold.get(pid) ?? 0) + it.qty);
    }
  }

  // on-hand/reserved/reorder รวมหลายสาขา ต่อสินค้า
  const onHand = new Map<string, { oh: number; rv: number; rp: number }>();
  for (const s of stock) {
    const cur = onHand.get(s.product_id) ?? { oh: 0, rv: 0, rp: 0 };
    cur.oh += s.qty_on_hand; cur.rv += s.qty_reserved; cur.rp = Math.max(cur.rp, s.reorder_point);
    onHand.set(s.product_id, cur);
  }

  const ids = new Set<string>([...onHand.keys(), ...sold.keys()]);
  const rows: StockRow[] = [];
  for (const id of ids) {
    const p = pMap.get(id);
    const oh = onHand.get(id) ?? { oh: 0, rv: 0, rp: 0 };
    const soldUnits = sold.get(id) ?? 0;
    if (p && !p.is_stocked && oh.oh === 0) continue; // บริการ/ไม่นับสต๊อก และไม่มีของ → ข้าม
    const velocity = round2(soldUnits / days);
    const reorderPoint = Math.max(oh.rp, p?.reorder_point ?? 0);
    const daysLeft = velocity > 0 ? round2(oh.oh / velocity) : null;
    const cost = p?.cost ?? 0;
    let status: StockStatus;
    if (oh.oh <= 0) status = "out";
    else if (daysLeft == null) status = "idle";
    else if (daysLeft < 7 || oh.oh <= reorderPoint) status = "critical";
    else if (daysLeft < 14) status = "low";
    else if (daysLeft > 90) status = "overstock";
    else status = "healthy";
    rows.push({
      productId: id, sku: p?.sku ?? id, name: p?.name_th ?? p?.sku ?? id, brandId: p?.brand_id ?? null,
      onHand: round2(oh.oh), reserved: round2(oh.rv), soldUnits: round2(soldUnits), velocity,
      daysLeft, reorderPoint, status, cost, stockValue: round2(oh.oh * cost),
    });
  }

  // เรียงความเร่งด่วน: หมด → ใกล้หมด (daysLeft น้อย) → อื่นๆ
  const rank: Record<StockStatus, number> = { out: 0, critical: 1, low: 2, healthy: 3, overstock: 4, idle: 5 };
  rows.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const ad = a.daysLeft ?? Infinity, bd = b.daysLeft ?? Infinity;
    return ad - bd;
  });

  const summary: StockSummary = {
    skuCount: rows.length,
    out: rows.filter((r) => r.status === "out").length,
    critical: rows.filter((r) => r.status === "critical").length,
    low: rows.filter((r) => r.status === "low").length,
    overstock: rows.filter((r) => r.status === "overstock").length,
    idle: rows.filter((r) => r.status === "idle").length,
    totalValue: round2(rows.reduce((s, r) => s + r.stockValue, 0)),
    periodDays: days,
  };
  return { rows, summary };
}
