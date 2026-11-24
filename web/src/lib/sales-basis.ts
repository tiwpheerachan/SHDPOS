// =====================================================================
// นิยามยอดขายกลาง — ทุกหน้าที่รวมยอดต้องใช้ชุดนี้ ตัวเลขจะได้ตรงกัน
//   • นับเฉพาะบิลสถานะ completed / partially_refunded
//     (ไม่นับ draft, voided, refunded = คืนเต็มบิล)
//   • ยอด = grand_total (รวม VAT) · ยังไม่หักคืนบางส่วน
//   • เวลาขาย = sale_occurred_at (บิลค้างที่มาปิดทีหลัง) ถ้าไม่มีใช้ created_at
//   • วัน/ชั่วโมง = เวลาไทย (Asia/Bangkok, UTC+7) ไม่ขึ้นกับเขตเวลาของเครื่อง
//   ฝั่ง SQL ใช้นิยามเดียวกัน (pos_work_sales, /api/work/sales/explore)
// =====================================================================

export const COUNTED_SALE_STATUSES = ["completed", "partially_refunded"] as const;

export function isCountedSale(o: { status: string }): boolean {
  return o.status === "completed" || o.status === "partially_refunded";
}

/** เวลาขายจริงของบิล (ISO) */
export function saleAt(o: { created_at: string; sale_occurred_at?: string | null }): string {
  return o.sale_occurred_at || o.created_at;
}

const BKK_MS = 7 * 3600_000;
const bkk = (iso: string) => new Date(new Date(iso).getTime() + BKK_MS);

/** วันที่เวลาไทย YYYY-MM-DD */
export function bkkDay(iso: string): string {
  return bkk(iso).toISOString().slice(0, 10);
}
/** ชั่วโมงเวลาไทย 0–23 */
export function bkkHour(iso: string): number {
  return bkk(iso).getUTCHours();
}
/** วันในสัปดาห์เวลาไทย (0=อาทิตย์) */
export function bkkWeekday(iso: string): number {
  return bkk(iso).getUTCDay();
}
