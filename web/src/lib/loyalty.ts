// =====================================================================
// Loyalty — ค่าคงที่สำหรับแต้มสะสม (ฝั่ง client)
//   • การ "ได้แต้ม" คำนวณที่ DB (trigger fn_loyalty_order: 1 แต้ม / 20 บาท)
//   • การ "ใช้แต้ม" (redeem) ใช้ค่าด้านล่างนี้
// =====================================================================

/** มูลค่าแต้มเมื่อใช้เป็นส่วนลด: 1 แต้ม = กี่บาท (ปรับได้) */
export const POINT_VALUE_THB = 1;

/** แปลงจำนวนแต้ม → มูลค่าเงิน (บาท) */
export function pointsToBaht(points: number): number {
  return Math.max(0, Math.floor(points)) * POINT_VALUE_THB;
}

/** แต้มสูงสุดที่ใช้ได้ = ไม่เกินแต้มที่มี และไม่เกินยอดที่ต้องจ่าย */
export function maxRedeemablePoints(availablePoints: number, payableBaht: number): number {
  const byCash = Math.floor(payableBaht / POINT_VALUE_THB);
  return Math.max(0, Math.min(Math.floor(availablePoints), byCash));
}
