"use client";

// ตัวเรนเดอร์เนื้อหากราฟกลาง — ใช้ทั้งหน้า insights และ Chart Builder
//   รองรับ bar/hbar/donut/line/table/heatmap + โหมดเทียบช่วงก่อน (compare)
import { MixDonut, SalesAreaTrend, InsightBars, CompareBars, RankedBars, WaterfallChart, StackedBars, ScatterPlot } from "@/components/charts-rich";
import { Heatmap } from "@/components/charts";
import { Table, Th, Td, EmptyState } from "@/components/ui";
import type { ChartConfig } from "@/components/ui/chart";
import { formatTHB, formatInt } from "@/lib/money";
import { METRIC_LABEL, type Widget, type WidgetData, type Metric } from "@/lib/ai/engine";

export const fmtMetric = (m: Metric, n: number) => (m === "gp_pct" || m === "discount_pct") ? `${Math.round(n * 10) / 10}%` : (m === "orders" || m === "qty") ? formatInt(n) : formatTHB(n, false);
// จัดรูปแบบตามตัววัดของ widget (รองรับตัววัดแบบสูตร: ฿/จำนวน/%)
export const fmtWidget = (w: Widget, n: number) => w.formula ? (w.formula.fmt === "pct" ? `${Math.round(n * 10) / 10}%` : w.formula.fmt === "int" ? formatInt(n) : formatTHB(n, false)) : fmtMetric(w.metric, n);
// ชื่อตัววัดที่แสดง (สูตร → ชื่อสูตร)
export const widgetMetricLabel = (w: Widget, locale: "th" | "en" | "zh") => w.formula?.name || METRIC_LABEL[w.metric][locale];
type LFn = (th: string, en: string, zh: string) => string;
const deltaPct = (cur: number, prev?: number) => (prev == null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

export function WidgetBody({ w, data, locale, L, onDrill }: { w: Widget; data?: WidgetData; locale: "th" | "en" | "zh"; L: LFn; onDrill?: (key: string, label: string) => void }) {
  const rows = data?.rows ?? [];
  const drill = onDrill ? (i: number) => { const r = rows[i]; if (r) onDrill(r.key, r.label); } : undefined;
  const mL = w.formula?.name || METRIC_LABEL[w.metric][locale];
  const fmt = (n: number) => fmtWidget(w, n);
  const cfg: ChartConfig = { value: { label: mL, color: "rgb(var(--chart-1))" } };
  const cmp = !!w.compare;
  const curLbl = L("ช่วงนี้", "Current", "本期"), prevLbl = L("ช่วงก่อน", "Previous", "上期");

  if (w.viz === "heatmap") {
    if (!data?.matrix) return <EmptyState title={L("ไม่มีข้อมูล", "No data", "无数据")} />;
    return <div className="overflow-x-auto"><Heatmap rows={data.rowsLabel ?? []} cols={data.cols ?? []} values={data.matrix} valueFormat={(n) => fmtMetric(w.metric, n)} /></div>;
  }

  if (w.viz === "stacked") {
    const s = data?.stacked;
    if (!s || !s.data.length) return <EmptyState title={L("ต้องเลือก “แยกตาม (ซ้อน)” และมีข้อมูล", "Pick a stack dimension", "需选择堆叠维度")} />;
    return <StackedBars data={s.data} series={s.series} valueFormat={fmt} />;
  }
  if (w.viz === "scatter") {
    const pts = data?.points;
    if (!pts || !pts.length) return <EmptyState title={L("ไม่มีข้อมูลในช่วง/ตัวกรองนี้", "No data", "无数据")} />;
    const my = data?.metricY ?? w.metric;
    return <ScatterPlot data={pts} xLabel={mL} yLabel={METRIC_LABEL[my][locale]} xFormat={(n) => fmtWidget(w, n)} yFormat={(n) => fmtMetric(my, n)} />;
  }

  if (!rows.length) return <EmptyState title={L("ไม่มีข้อมูลในช่วง/ตัวกรองนี้", "No data", "无数据")} />;

  if (w.viz === "waterfall") {
    const tp = data?.totalPrev; const tt = data?.total ?? 0;
    if (tp == null) return <EmptyState title={L("ต้องเปิด “เทียบช่วงก่อนหน้า”", "Enable “Compare prev period”", "需开启对比上期")} />;
    const movers = rows.map((r) => ({ label: r.label, delta: r.value - (r.prev ?? 0) })).filter((m) => Math.abs(m.delta) > 0.5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 7);
    const other = (tt - tp) - movers.reduce((s, m) => s + m.delta, 0);
    const segs: { label: string; base: number; val: number; kind: "up" | "down" | "total" }[] = [{ label: prevLbl, base: 0, val: tp, kind: "total" }];
    let cum = tp;
    const step = (label: string, delta: number) => { if (delta >= 0) segs.push({ label, base: cum, val: delta, kind: "up" }); else segs.push({ label, base: cum + delta, val: -delta, kind: "down" }); cum += delta; };
    for (const m of movers) step(m.label, m.delta);
    if (Math.abs(other) > 0.5) step(L("อื่นๆ", "Other", "其他"), other);
    segs.push({ label: curLbl, base: 0, val: tt, kind: "total" });
    return <WaterfallChart data={segs.map((s) => ({ ...s, label: s.label.length > 9 ? s.label.slice(0, 9) + "…" : s.label }))} valueFormat={fmt} />;
  }

  if (w.viz === "line") return <SalesAreaTrend data={rows.map((r) => ({ label: r.label, value: r.value }))} config={cfg} valueFormat={fmt} />;

  if (w.viz === "donut") {
    const dc: ChartConfig = Object.fromEntries(rows.map((r, i) => [r.key, { label: r.label, color: `rgb(var(--chart-${(i % 5) + 1}))` }]));
    return <MixDonut data={rows.map((r) => ({ key: r.key, value: r.value }))} config={dc} onBarClick={drill} />;
  }

  if (w.viz === "hbar") return <RankedBars data={rows.map((r, i) => ({ label: r.label.length > 16 ? r.label.slice(0, 16) + "…" : r.label, value: r.value, prev: r.prev, highlight: i === 0 }))} valueFormat={fmt} compare={cmp} onBarClick={drill} />;

  if (w.viz === "table") {
    return (
      <div className="overflow-x-auto"><Table>
        <thead><tr>
          <Th>{L("รายการ", "Item", "项目")}</Th>
          <Th align="right">{mL}</Th>
          {cmp ? <Th align="right">{prevLbl}</Th> : null}
          {cmp ? <Th align="right">Δ%</Th> : null}
          <Th align="right">{L("ชิ้น", "Units", "件")}</Th>
        </tr></thead>
        <tbody>{rows.map((r) => {
          const d = cmp ? deltaPct(r.value, r.prev) : null;
          return (
            <tr key={r.key}>
              <Td className="max-w-[220px] truncate">{r.label}</Td>
              <Td align="right" className="tnum font-medium">{fmt(r.value)}</Td>
              {cmp ? <Td align="right" className="tnum text-muted">{r.prev != null ? fmt(r.prev) : "—"}</Td> : null}
              {cmp ? <Td align="right" className={`tnum ${d == null ? "text-muted" : d >= 0 ? "text-ok" : "text-danger"}`}>{d == null ? "—" : `${d >= 0 ? "+" : ""}${d}%`}</Td> : null}
              <Td align="right" className="tnum text-muted">{formatInt(r.qty)}</Td>
            </tr>
          );
        })}</tbody>
      </Table></div>
    );
  }

  // bar (ค่าเริ่มต้น) — เทียบคู่เมื่อ compare
  if (cmp) return <CompareBars data={rows.map((r) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, cur: r.value, prev: r.prev ?? 0 }))} labels={{ cur: curLbl, prev: prevLbl }} valueFormat={fmt} onBarClick={drill} />;
  return <InsightBars data={rows.map((r, i) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, value: r.value, highlight: i === 0 }))} config={cfg} valueFormat={fmt} onBarClick={drill} />;
}
