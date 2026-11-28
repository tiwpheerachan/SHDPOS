// =====================================================================
// AI Studio — ตัววางแผนสำรอง (ไม่ใช้ AI): ดูโครงข้อมูลแล้วเลือกมุมมองที่ให้ข้อมูลมากที่สุด
//   ใช้เมื่อไม่มี/เรียก AI ไม่ได้ และเป็น "ร่างแรก" ที่ AI ปรับต่อได้
// =====================================================================
import { runQuery } from "./query";
import type { Dataset, Measure, StudioDashboard, StudioWidget } from "./types";

const uid = () => Math.random().toString(36).slice(2, 9);
const PRIMARY: Record<string, string[]> = {
  sales_bills: ["net", "bill", "units", "discount"], sales_lines: ["amount", "qty", "discount"],
  stock: ["available", "retail_value", "sold_30d", "days_of_stock"], customers: ["spend", "orders", "recency_days"],
};

/** คะแนนว่ามิติไหนน่าดู: จำนวนกลุ่มพอเหมาะ (3–30) และไม่กระจุกตัวกลุ่มเดียวเกินไป */
function dimScore(ds: Dataset, field: string, m: Measure): number {
  try {
    const r = runQuery(ds, { dataset: ds.id, groupBy: [{ field }], measures: [m] });
    const n = r.rowCount; if (n < 2) return 0;
    const vals = r.rows.map((x) => Math.max(0, Number(x[m.as]) || 0)); const tot = vals.reduce((a, b) => a + b, 0) || 1;
    const top = Math.max(...vals) / tot;
    const fill = ds.rows.filter((x) => x[field] != null && x[field] !== "" && x[field] !== "—").length / Math.max(1, ds.rows.length);
    return (n <= 30 ? 1 : 0.5) * (top < 0.9 ? 1 : 0.3) * fill * Math.log2(Math.min(n, 30) + 1);
  } catch { return 0; }
}

export function planLocal(ds: Dataset, title?: string): StudioDashboard {
  const meas = ds.fields.filter((f) => f.role === "measure");
  const idf = ds.fields.find((f) => f.role === "id");
  const order = PRIMARY[ds.id] ?? [];
  const pick = [...meas].sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
  const main: Measure = pick[0] ? { as: pick[0].key, agg: pick[0].unit === "days" ? "median" : "sum", field: pick[0].key, label: pick[0].label } : { as: "rows", agg: "count", label: "จำนวน" };
  const saleFilter = ds.fields.some((f) => f.key === "is_sale") ? [{ field: "is_sale", op: "eq" as const, value: true }] : [];
  const w: StudioWidget[] = [];
  // KPI
  for (const f of pick.slice(0, 3)) w.push({ id: uid(), title: f.label, viz: "kpi", compare: !!ds.prevRange, query: { dataset: ds.id, filters: saleFilter, measures: [{ as: f.key, agg: f.unit === "days" ? "median" : "sum", field: f.key, label: f.label }] } });
  if (idf) w.push({ id: uid(), title: `จำนวน${idf.label}`, viz: "kpi", compare: !!ds.prevRange, query: { dataset: ds.id, filters: saleFilter, measures: [{ as: "n", agg: "count_distinct", field: idf.key, label: `จำนวน${idf.label}` }] } });
  // แนวโน้ม
  if (ds.timeField) {
    const days = ds.range ? (+new Date(ds.range.to) - +new Date(ds.range.from)) / 86400_000 : 30;
    w.push({ id: uid(), title: `${main.label} ตามเวลา`, viz: "area", span: 2, query: { dataset: ds.id, filters: saleFilter, groupBy: [{ field: ds.timeField, bucket: days > 120 ? "month" : days > 45 ? "week" : "day" }], measures: [main] } });
  }
  // มิติที่น่าสนใจ 4 อันดับ
  const dims = ds.fields.filter((f) => f.role === "dimension" && f.type !== "boolean").map((f) => ({ f, s: dimScore(ds, f.key, main) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
  dims.forEach(({ f }, i) => {
    const n = runQuery(ds, { dataset: ds.id, groupBy: [{ field: f.key }], measures: [main] }).rowCount;
    w.push({ id: uid(), title: `${main.label} ตาม${f.label}`, viz: n <= 6 && i % 2 ? "donut" : "hbar",
      query: { dataset: ds.id, filters: saleFilter, groupBy: [{ field: f.key }], measures: [{ ...main, share: true }], limit: n <= 6 ? 6 : 10, others: n <= 6 } });
  });
  return { title: title ?? `ภาพรวม${ds.label}`, summary: "ร่างอัตโนมัติจากโครงข้อมูล (ไม่ได้ใช้ AI)", widgets: w };
}
