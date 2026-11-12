// ส่งออกแดชบอร์ดเป็น Excel (HTML→.xls, ไม่ต้องลง lib; BOM utf-8 รองรับไทย)
//   ใช้ร่วมกันระหว่างหน้า /admin/insights และ /dashboard
import { METRIC_LABEL, isPctMetric, type View, type WidgetData, type Metric } from "@/lib/ai/engine";

type Loc = "th" | "en" | "zh";
const L = (l: Loc, th: string, en: string, zh: string) => (l === "th" ? th : l === "zh" ? zh : en);
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// ตัวเลขดิบสำหรับ Excel (คำนวณต่อได้) — metric อัตราส่วนแนบหน่วย % ไว้อ่านง่าย
const num = (m: Metric, n: number) => (isPctMetric(m) ? `${Math.round(n * 10) / 10}%` : String(Math.round(n * 100) / 100));
const pct = (cur: number, prev?: number) => (prev == null || prev === 0 ? "" : `${Math.round(((cur - prev) / prev) * 1000) / 10}%`);

export function exportExcel(view: View, dataMap: Map<string, WidgetData>, locale: Loc) {
  const mL = (m: Metric) => METRIC_LABEL[m][locale];
  const DAYS = L(locale, "อา,จ,อ,พ,พฤ,ศ,ส", "Sun,Mon,Tue,Wed,Thu,Fri,Sat", "日,一,二,三,四,五,六").split(",");

  let h = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>table{border-collapse:collapse;margin:0 0 18px}td,th{border:1px solid #d8d8d8;padding:4px 10px;font-family:'Noto Sans Thai',sans-serif;font-size:12px}th{background:#7950D8;color:#fff;text-align:left;font-weight:600}h2{font-family:sans-serif}h3{font-family:sans-serif;margin:14px 0 6px}</style></head><body>`;
  h += `<h2>${esc(view.name)}</h2>`;
  h += `<p style="font-family:sans-serif;font-size:11px;color:#777">${esc(L(locale, "ส่งออกเมื่อ", "Exported", "导出于"))} ${new Date().toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB")}</p>`;

  // ── KPI (ตารางสรุปบน) ──
  const kpis = view.widgets.filter((w) => w.viz === "kpi");
  if (kpis.length) {
    h += `<table><tr>${kpis.map((w) => `<th>${esc(w.title || mL(w.metric))}</th>`).join("")}</tr>`;
    h += `<tr>${kpis.map((w) => `<td>${num(w.metric, dataMap.get(w.id)?.total ?? 0)}</td>`).join("")}</tr>`;
    // แถว Δ% เทียบช่วงก่อน (เมื่อมีข้อมูลช่วงก่อน)
    if (kpis.some((w) => dataMap.get(w.id)?.totalPrev != null)) {
      h += `<tr>${kpis.map((w) => { const d = dataMap.get(w.id); const p = pct(d?.total ?? 0, d?.totalPrev); return `<td style="color:#888">${p ? `Δ ${p}` : "—"}</td>`; }).join("")}</tr>`;
    }
    h += `</table>`;
  }

  // ── กราฟ/ตารางราย widget ──
  for (const w of view.widgets.filter((w) => w.viz !== "kpi")) {
    const d = dataMap.get(w.id);
    if (!d) continue;
    h += `<h3>${esc(w.title || mL(w.metric))}</h3>`;

    // heatmap — ตารางวัน×ชั่วโมง
    if (w.viz === "heatmap" && d.matrix) {
      const cols = d.cols ?? [];
      const rowsLabel = d.rowsLabel ?? DAYS;
      h += `<table><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
      d.matrix.forEach((row, ri) => {
        h += `<tr><th>${esc(rowsLabel[ri] ?? ri)}</th>${row.map((v) => `<td>${v ? num(w.metric, v) : ""}</td>`).join("")}</tr>`;
      });
      h += `</table>`;
      continue;
    }

    if (!d.rows.length) { h += `<p style="font-family:sans-serif;font-size:11px;color:#999">${esc(L(locale, "ไม่มีข้อมูล", "No data", "无数据"))}</p>`; continue; }

    const cmp = !!w.compare && d.rows.some((r) => r.prev != null);
    h += `<table><tr><th>${esc(L(locale, "รายการ", "Item", "项目"))}</th><th>${esc(mL(w.metric))}</th>`;
    if (cmp) h += `<th>${esc(L(locale, "ช่วงก่อน", "Previous", "上期"))}</th><th>Δ%</th>`;
    h += `<th>${esc(L(locale, "ชิ้น", "Units", "件"))}</th><th>${esc(L(locale, "บิล", "Bills", "单"))}</th></tr>`;
    for (const r of d.rows) {
      h += `<tr><td>${esc(r.label)}</td><td>${num(w.metric, r.value)}</td>`;
      if (cmp) h += `<td style="color:#888">${r.prev != null ? num(w.metric, r.prev) : "—"}</td><td style="color:#888">${pct(r.value, r.prev) || "—"}</td>`;
      h += `<td>${r.qty}</td><td>${r.orders}</td></tr>`;
    }
    h += `</table>`;
  }

  h += `</body></html>`;
  const blob = new Blob(["﻿" + h], { type: "application/vnd.ms-excel;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(view.name || "dashboard").replace(/[\\/:*?"<>|]/g, "_")}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
