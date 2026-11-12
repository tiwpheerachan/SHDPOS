"use client";

import { useMemo, useState } from "react";
import { Sparkles, Loader2, Plus, Lightbulb } from "lucide-react";
import { Modal, Select, Button } from "@/components/ui";
import { WidgetBody, fmtMetric } from "@/components/admin/widget-body";
import {
  computeWidget, METRIC_LABEL, DIM_LABEL,
  type Widget, type Ctx, type Metric, type Dimension, type Viz, type WidgetData,
} from "@/lib/ai/engine";
import type { FactPack } from "@/lib/ai/facts";
import type { Order, Branch } from "@/lib/types";

const uid = () => Math.random().toString(36).slice(2, 9);
const METRICS: Metric[] = ["sales", "qty", "gp", "orders", "aov", "discount"];
const DIMS: Dimension[] = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];

/** แนะนำชนิดกราฟจากมิติ */
const suggestViz = (d: Dimension | null | undefined): Viz => !d ? "kpi" : d === "day" ? "line" : d === "hour" || d === "weekday" ? "bar" : d === "channel" || d === "payment" ? "donut" : "bar";

export function ChartBuilder({ open, onClose, onAdd, rows, prevRows, ctx, branches, facts, locale, L }: {
  open: boolean; onClose: () => void; onAdd: (w: Widget) => void;
  rows: Order[]; prevRows: Order[]; ctx: Ctx; branches: Branch[]; facts: FactPack;
  locale: "th" | "en" | "zh"; L: (th: string, en: string, zh: string) => string;
}) {
  const [w0, setW] = useState<Widget>({ id: uid(), title: "", viz: "bar", metric: "sales", dimension: "branch", limit: 10 });
  const [compare, setCompare] = useState(true);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const w = { ...w0, compare: compare && w0.viz !== "heatmap" };

  const wr = useMemo(() => (w.branchId ? rows.filter((o) => o.branch_id === w.branchId) : rows), [rows, w.branchId]);
  const pwr = useMemo(() => (w.branchId ? prevRows.filter((o) => o.branch_id === w.branchId) : prevRows), [prevRows, w.branchId]);
  const data: WidgetData = useMemo(() => computeWidget(wr, ctx, w, locale, w.compare ? pwr : undefined), [wr, pwr, ctx, w, locale]);
  const mL = METRIC_LABEL[w.metric][locale];
  const patch = (p: Partial<Widget>) => setW((prev) => {
    const next = { ...prev, ...p };
    if (!next.dimension) { next.viz = "kpi"; next.dimension = null; }
    else if (next.viz === "kpi") next.viz = "bar";
    return next;
  });

  // delta เทียบช่วงก่อน (จาก fact pack — ตัวเลขจริง)
  const deltaKey: Record<Metric, keyof FactPack["totals"]> = { sales: "sales", orders: "orders", aov: "aov", gp: "gp", qty: "units", discount: "discount" };
  const delta = compare ? facts.totals[deltaKey[w.metric]] : null;
  const deltaPct = delta && typeof delta === "object" && "deltaPct" in delta ? (delta as { deltaPct: number | null }).deltaPct : null;

  const recommended = suggestViz(w.dimension);
  const poorChoice = w.viz === "donut" && data.rows.length > 6;

  async function aiAssist() {
    const q = aiText.trim(); if (!q || aiBusy) return;
    setAiBusy(true);
    try {
      const r = await fetch("/api/ai/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: `${L("ปรับกราฟนี้", "Adjust this chart", "调整此图")}: ${q}` }], currentWidgets: [w], facts, locale }),
      });
      if (r.ok) {
        const d = (await r.json()) as { widgets: Widget[] | null };
        if (d.widgets && d.widgets[0]) { setW({ ...d.widgets[0], id: w.id }); setAiText(""); }
      }
    } catch { /* ignore */ }
    setAiBusy(false);
  }

  const preview = w.viz === "kpi" ? (
    <div className="grid place-items-center h-full">
      <div className="text-center">
        <p className="text-[32px] font-bold tnum">{fmtMetric(w.metric, data.total)}</p>
        {deltaPct != null ? <p className={`text-sm font-medium ${deltaPct >= 0 ? "text-ok" : "text-danger"}`}>{deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct)}%</p> : null}
        <p className="text-xs text-muted mt-1">{w.title || mL}</p>
      </div>
    </div>
  ) : <WidgetBody w={w} data={data} locale={locale} L={L} />;

  const Field = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => <div><label className="block text-[11px] font-medium text-muted mb-1">{label}</label>{children}</div>;

  return (
    <Modal open={open} onClose={onClose} size="xl" title={<span className="flex items-center gap-2"><Plus size={16} className="text-brand" />{L("สร้างกราฟ", "Create chart", "创建图表")}</span>}
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="h-10 px-4 rounded-xl border border-line text-sm hover:bg-surface2">{L("ยกเลิก", "Cancel", "取消")}</button><Button onClick={() => { onAdd({ ...w, id: uid(), title: w.title || `${mL}${w.dimension ? " · " + DIM_LABEL[w.dimension][locale] : ""}` }); onClose(); }}><Plus size={15} />{L("เพิ่มลงแดชบอร์ด", "Add to dashboard", "加入仪表盘")}</Button></div>}
    >
      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        {/* ── ซ้าย: ตั้งค่า ── */}
        <div className="space-y-3">
          <Field label={L("ตัววัด (Metric)", "Metric", "指标")}><Select value={w.metric} onChange={(e) => patch({ metric: e.target.value as Metric })}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m][locale]}</option>)}</Select></Field>
          <Field label={L("มิติ (Dimension)", "Dimension", "维度")}><Select value={w.dimension ?? ""} onChange={(e) => patch(e.target.value ? { dimension: e.target.value as Dimension, viz: suggestViz(e.target.value as Dimension) } : { dimension: null })}><option value="">{L("รวม (KPI)", "Total (KPI)", "合计")}</option>{DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d][locale]}</option>)}</Select></Field>
          {w.dimension ? (
            <>
              <Field label={<span className="flex items-center gap-1">{L("รูปแบบกราฟ", "Chart type", "图表")} <span className="text-[10px] text-brand">({L("แนะนำ", "rec.", "推荐")}: {recommended})</span></span>}>
                <Select value={w.viz} onChange={(e) => patch({ viz: e.target.value as Viz })}><option value="bar">{L("แท่ง", "Bar", "柱状")}</option><option value="hbar">{L("แท่งแนวนอน", "H-Bar", "横向")}</option><option value="donut">{L("โดนัท", "Donut", "环形")}</option><option value="line">{L("เส้น", "Line", "折线")}</option><option value="heatmap">{L("ฮีตแมป (วัน×ชม.)", "Heatmap", "热力图")}</option><option value="table">{L("ตาราง", "Table", "表格")}</option></Select>
              </Field>
              {w.viz !== "heatmap" ? <Field label={L("จำกัดอันดับ (Top-N)", "Top-N", "前N")}><Select value={String(w.limit ?? 0)} onChange={(e) => patch({ limit: Number(e.target.value) || undefined })}><option value="0">{L("ทั้งหมด", "All", "全部")}</option>{[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field> : null}
            </>
          ) : null}
          <Field label={L("ฟิลเตอร์สาขา", "Branch filter", "门店筛选")}><Select value={w.branchId ?? ""} onChange={(e) => patch({ branchId: e.target.value || null })}><option value="">{L("ทุกสาขา", "All", "全部")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-brand" />{L("เทียบช่วงก่อนหน้า", "Compare prev period", "对比上期")}</label>
          <Field label={L("ชื่อกราฟ", "Title", "标题")}><input value={w.title} onChange={(e) => setW({ ...w, title: e.target.value })} placeholder={mL} className="w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" /></Field>
          {/* AI ช่วยปรับ */}
          <div className="pt-1">
            <label className="block text-[11px] font-medium text-muted mb-1 flex items-center gap-1"><Sparkles size={12} className="text-brand" />{L("ให้ AI ช่วยปรับกราฟนี้", "Ask AI to adjust this chart", "让 AI 调整")}</label>
            <div className="flex gap-1.5">
              <input value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void aiAssist(); } }} placeholder={L("เช่น เปลี่ยนเป็นกำไร เรียงมากไปน้อย", "e.g. switch to profit, sort desc", "例如改为毛利")} className="flex-1 h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              <button onClick={() => void aiAssist()} disabled={aiBusy || !aiText.trim()} className="w-10 h-10 rounded-xl bg-brand text-white grid place-items-center shrink-0 disabled:opacity-40">{aiBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}</button>
            </div>
          </div>
        </div>

        {/* ── ขวา: ตัวอย่างสด ── */}
        <div className="rounded-2xl border border-line bg-surface p-4 min-h-[340px] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div><p className="font-semibold text-sm">{w.title || mL}{w.dimension ? ` · ${DIM_LABEL[w.dimension][locale]}` : ""}</p>
              <p className="text-[11px] text-muted">{L("รวม", "Total", "合计")} {fmtMetric(w.metric, data.total)}{deltaPct != null ? <span className={deltaPct >= 0 ? "text-ok" : "text-danger"}> · {deltaPct >= 0 ? "+" : ""}{deltaPct}% {L("เทียบช่วงก่อน", "vs prev", "对比上期")}</span> : null}</p>
            </div>
          </div>
          <div className="flex-1 min-h-[240px]">{preview}</div>
          {poorChoice ? <p className="text-[11px] text-danger flex items-center gap-1 mt-2"><Lightbulb size={12} />{L("โดนัทเหมาะกับหมวดน้อย — ลองแท่งเรียงลำดับสำหรับหลายรายการ", "Donut suits few categories — try a ranked bar", "环形适合少类别")}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
