// =====================================================================
// บัญชีสต๊อกต่อคลัง (per-warehouse) — คำนวณ Stock / On Hand / Available
//   Stock      = On Hand + On the Way Out
//   Available  = Stock − Reserved Out − Reserved Order
//   * ไม่หัก Reserved ซ้ำ: ของที่สแกนออก (OTWO) ยังถูกนับใน Reserved Out
//     จนกว่าจะรับเข้าปลายทาง → Available คงที่ตลอดช่วงกำลังส่ง
// =====================================================================
import type { StockLevel } from "./types";

export interface StockView {
  onHand: number;        // อยู่จริงในคลัง
  otwo: number;          // On the Way Out (สแกนออกแล้ว ยังไม่ถึงปลายทาง)
  reservedOut: number;   // จองเพื่อโอนออก (CO OUT)
  reservedOrder: number; // จองตาม order/พักบิล
  quarantine: number;    // พักตรวจ (ชำรุด/SN ผิด) — ขายไม่ได้
  stock: number;         // On Hand + OTWO
  available: number;     // Stock − ReservedOut − ReservedOrder − Quarantine
}

export function stockView(row?: Partial<StockLevel> | null): StockView {
  const onHand = row?.qty_on_hand ?? 0;
  const otwo = row?.qty_otwo ?? 0;
  const reservedOut = row?.qty_reserved ?? 0;
  const reservedOrder = row?.qty_reserved_order ?? 0;
  const quarantine = row?.qty_quarantine ?? 0;
  const stock = onHand + otwo;
  const available = stock - reservedOut - reservedOrder - quarantine;
  return { onHand, otwo, reservedOut, reservedOrder, quarantine, stock, available };
}

/** Available อย่างเดียว (ใช้ตอนตัดขาย/เช็คของพอขายไหม) */
export function availableQty(row?: Partial<StockLevel> | null): number {
  return stockView(row).available;
}
