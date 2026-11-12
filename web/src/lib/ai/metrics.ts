// =====================================================================
// ทะเบียน metric กลาง (metric registry) — นิยาม/สูตร/หน่วย/ข้อควรระวัง
//   ใช้ให้ LLM เข้าใจความหมายตัวเลข (เฟส A) และไว้โชว์ tooltip ภายหลัง
//   ตัวเลขจริงคำนวณด้วยโค้ด (facts.ts) ไม่ให้ LLM คิดเอง
// =====================================================================
import type { Metric } from "./engine";

export interface MetricDef {
  id: Metric;
  th: string; en: string;
  /** นิยามสั้น ภาษาอังกฤษ (ส่งให้ LLM) */
  def: string;
  unit: "THB" | "count";
}

export const METRIC_DEFS: MetricDef[] = [
  { id: "sales", th: "ยอดขาย", en: "Sales", unit: "THB", def: "Sum of order grand_total (incl. VAT), voided orders excluded. This is booked sales, NOT money actually received in the bank." },
  { id: "gp", th: "กำไรขั้นต้น", en: "Gross profit", unit: "THB", def: "Sum of line gross_profit = revenue - cost of goods. This is GROSS profit, NOT net profit (no opex/fees/tax)." },
  { id: "orders", th: "จำนวนบิล", en: "Orders/bills", unit: "count", def: "Count of distinct non-voided orders (bills), NOT the number of line items/units." },
  { id: "qty", th: "จำนวนชิ้น", en: "Units", unit: "count", def: "Sum of item quantities across orders (line items), includes gift items if any." },
  { id: "aov", th: "เฉลี่ยต่อบิล", en: "Avg per bill", unit: "THB", def: "Sales / Orders. Average basket value per bill." },
  { id: "discount", th: "ส่วนลด", en: "Discount", unit: "THB", def: "Sum of discount_total. Higher discount is NOT necessarily good — it reduces margin." },
];

/** ข้อความนิยามสั้นสำหรับใส่ใน system prompt ของ LLM */
export function metricsBrief(): string {
  const lines = METRIC_DEFS.map((m) => `- ${m.id} (${m.en}, ${m.unit}): ${m.def}`);
  return [
    "METRIC DEFINITIONS (use exactly; never conflate):",
    ...lines,
    "Key distinctions: sales != money-in-bank; gross profit != net profit; bills(orders) != units(line items); product sales != gift items; a company-wide claim is only valid if scope covers all branches.",
  ].join("\n");
}
