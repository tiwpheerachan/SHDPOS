// =====================================================================
// AI Studio — ตัวตรวจ + แก้แดชบอร์ดอัตโนมัติ (ทำงานทุกครั้งก่อนแสดง ไม่ว่าแดชบอร์ดมาจาก AI ไหน)
//   รันทุกคำสั่งคำนวณจริง → ผิด = รายงานให้ AI แก้ · กราฟผิดประเภท = แก้ให้ตามหลักการแสดงข้อมูล
// =====================================================================
import { runQuery } from "./query";
import type { Dataset, StudioDashboard, StudioWidget, Viz } from "./types";

export type LintIssue = { widget: string; title: string; message: string; fixed: boolean };
const isTime = (w: StudioWidget) => !!w.query.groupBy?.[0]?.bucket && w.query.groupBy[0].bucket !== "weekday" && w.query.groupBy[0].bucket !== "hour";
const uid = () => Math.random().toString(36).slice(2, 9);

export function lintDashboard(d: StudioDashboard, datasets: Dataset[]): { dashboard: StudioDashboard; issues: LintIssue[]; errors: LintIssue[] } {
  const byId = new Map(datasets.map((x) => [x.id, x]));
  const issues: LintIssue[] = [], errors: LintIssue[] = [];
  const seen = new Set<string>();
  const out: StudioWidget[] = [];
  for (const raw of (d.widgets ?? []).slice(0, 14)) {
    const w: StudioWidget = { ...raw, id: raw.id || uid(), query: { ...raw.query, groupBy: raw.query?.groupBy ?? [], measures: raw.query?.measures ?? [] } };
    const note = (message: string, fixed = true) => issues.push({ widget: w.id, title: w.title, message, fixed });
    const ds = byId.get(w.query.dataset);
    if (!ds) { errors.push({ widget: w.id, title: w.title, message: `ไม่มีชุดข้อมูล "${w.query.dataset}" (มี: ${[...byId.keys()].join(", ")})`, fixed: false }); continue; }
    const g = w.query.groupBy!;
    const allowed: Viz[] = ["kpi", "line", "area", "bar", "hbar", "stacked_bar", "donut", "table", "heatmap", "scatter"];
    if (!allowed.includes(w.viz)) { note(`ไม่รู้จักกราฟ "${w.viz}" → ใช้แท่ง`); w.viz = "bar"; }

    // ── ชนิดกราฟให้ตรงกับรูปข้อมูล ──
    if (w.viz === "kpi" && g.length) { note("KPI ต้องไม่จัดกลุ่ม → ใช้แท่งแทน"); w.viz = g[0].bucket ? "line" : "bar"; }
    if (w.viz !== "kpi" && !g.length && w.viz !== "table") { note("ไม่มีการจัดกลุ่ม → แสดงเป็น KPI"); w.viz = "kpi"; }
    if ((w.viz === "line" || w.viz === "area") && !isTime(w)) { note("กราฟเส้นใช้กับแกนเวลาเท่านั้น → แท่ง"); w.viz = "bar"; }
    if ((w.viz === "stacked_bar" || w.viz === "heatmap") && g.length < 2) { note("ต้องมี 2 มิติ → แท่ง"); w.viz = "bar"; }
    if (w.viz === "scatter" && w.query.measures.length + (w.query.derived?.length ?? 0) < 2) { note("กราฟกระจายต้องมี 2 ตัวชี้วัด → แท่ง"); w.viz = "bar"; }

    let res;
    try { res = runQuery(ds, w.query); }
    catch (e) { errors.push({ widget: w.id, title: w.title, message: e instanceof Error ? e.message : String(e), fixed: false }); continue; }

    if (w.viz === "donut") {
      const neg = res.rows.some((r) => Number(r[w.query.measures[0].as]) < 0);
      if (neg) { note("สัดส่วนมีค่าติดลบ → แท่ง"); w.viz = "bar"; }
      else if (res.rowCount > 6) { note(`สัดส่วน ${res.rowCount} กลุ่มมากเกิน → 5 อันดับ + อื่น ๆ`); w.query = { ...w.query, limit: 6, others: true }; }
    }
    if (w.viz === "bar" && !isTime(w) && res.rowCount > 12) { note(`${res.rowCount} หมวดมากเกินแท่งตั้ง → แท่งนอน 15 อันดับ`); w.viz = "hbar"; w.query = { ...w.query, limit: Math.min(15, w.query.limit ?? 15) }; }
    if (w.viz === "hbar" && res.rowCount > 25 && !w.query.limit) { note("จำกัด 20 อันดับ"); w.query = { ...w.query, limit: 20 }; }
    if (!res.matched) note("ไม่มีข้อมูลตามเงื่อนไข (ช่วงวันที่/ตัวกรอง)", false);

    // ค่าเริ่มต้นแกน/ขนาด
    const dims = res.columns.filter((c) => c.kind === "dim").map((c) => c.key), meas = res.columns.filter((c) => c.kind === "measure").map((c) => c.key);
    if (!w.x || !dims.includes(w.x)) w.x = dims[0];
    if (!w.series && dims.length > 1) w.series = dims[1];
    w.y = (w.y ?? []).filter((k) => meas.includes(k)); if (!w.y.length) w.y = meas.slice(0, w.viz === "kpi" ? 1 : 3);
    if (!w.span) w.span = w.viz === "kpi" ? 1 : ["line", "area", "table", "heatmap", "stacked_bar"].includes(w.viz) ? 2 : 1;

    // การ์ดซ้ำ
    const sig = JSON.stringify([w.viz, w.query]);
    if (seen.has(sig)) { note("การ์ดซ้ำกับใบอื่น → ตัดออก"); continue; }
    seen.add(sig);
    out.push(w);
  }
  // KPI ไว้บนสุด (ไม่เกิน 6) · ที่เหลือตามลำดับเดิม
  const kpis = out.filter((w) => w.viz === "kpi");
  if (kpis.length > 6) issues.push({ widget: "-", title: "KPI", message: `KPI ${kpis.length} ใบ → เหลือ 6`, fixed: true });
  const widgets = [...kpis.slice(0, 6), ...out.filter((w) => w.viz !== "kpi")];
  return { dashboard: { ...d, widgets }, issues, errors };
}
