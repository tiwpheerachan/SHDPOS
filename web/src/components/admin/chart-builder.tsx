"use client";

import { useMemo, useState } from "react";
import { Sparkles, Loader2, Plus, Lightbulb, Sigma } from "lucide-react";
import { Modal, Select, Button } from "@/components/ui";
import { WidgetBody, fmtWidget, widgetMetricLabel } from "@/components/admin/widget-body";
import {
  computeWidget, METRIC_LABEL, DIM_LABEL, validateFormula, FORMULA_VARS,
  type Widget, type Ctx, type Metric, type Dimension, type Viz, type Transform, type WidgetData, type Formula,
} from "@/lib/ai/engine";
import type { FactPack } from "@/lib/ai/facts";
import type { Order, Branch } from "@/lib/types";

const uid = () => Math.random().toString(36).slice(2, 9);
const METRICS: Metric[] = ["sales", "qty", "gp", "gp_pct", "orders", "aov", "discount", "discount_pct"];
const DIMS: Dimension[] = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];
const STACK_DIMS: Dimension[] = ["brand", "channel", "branch", "weekday", "hour", "day"];
const defaultStackBy = (d?: Dimension | null): Dimension => (d === "brand" ? "channel" : "brand");

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
  const mL = widgetMetricLabel(w, locale);
  const formulaErr = w.formula ? validateFormula(w.formula.expr) : null;
  const patch = (p: Partial<Widget>) => setW((prev) => {
    const next = { ...prev, ...p };
    if (!next.dimension) { next.viz = "kpi"; next.dimension = null; }
    else if (next.viz === "kpi") next.viz = "bar";
    if (next.viz === "stacked" && (!next.stackBy || next.stackBy === next.dimension)) next.stackBy = defaultStackBy(next.dimension);
    if (next.viz === "scatter" && !next.metricY) next.metricY = next.metric === "sales" || next.metric === "gp" ? "gp_pct" : "sales";
    return next;
  });

  // delta เทียบช่วงก่อน (จาก fact pack — ตัวเลขจริง)
  const deltaKey: Partial<Record<Metric, keyof FactPack["totals"]>> = { sales: "sales", orders: "orders", aov: "aov", gp: "gp", qty: "units", discount: "discount" };
  const dk = deltaKey[w.metric];
  const delta = compare && dk ? facts.totals[dk] : null;
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
        <p className="text-[32px] font-bold tnum">{fmtWidget(w, data.total)}</p>
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
          <Field label={L("ตัววัด (Metric)", "Metric", "指标")}><Select value={w.metric} disabled={!!w.formula} onChange={(e) => patch({ metric: e.target.value as Metric })} className={w.formula ? "opacity-50" : ""}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m][locale]}</option>)}</Select></Field>
          {/* ตัววัดแบบสูตรเอง */}
          <Field label={<span className="flex items-center gap-1"><Sigma size={11} className="text-brand" />{L("ตัววัดแบบสูตรเอง", "Custom formula", "自定义公式")}</span>}>
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-1">
              <input type="checkbox" checked={!!w.formula} onChange={(e) => patch({ formula: e.target.checked ? { name: w.formula?.name || L("ตัววัดใหม่", "Custom metric", "自定义"), expr: w.formula?.expr || "gp/qty", fmt: w.formula?.fmt || "thb" } : null })} className="accent-brand" />
              {L("สร้างสูตรเอง (แทนตัววัด)", "Build a formula", "使用公式")}
            </label>
            {w.formula ? (
              <div className="space-y-1.5 rounded-xl border border-line bg-surface2/40 p-2">
                <input value={w.formula.name} onChange={(e) => patch({ formula: { ...w.formula!, name: e.target.value } })} placeholder={L("ชื่อตัววัด เช่น กำไร/ชิ้น", "Metric name", "名称")} className="w-full h-8 px-2 rounded-lg bg-surface border border-line text-xs outline-none focus:ring-2 focus:ring-brand/30" />
                <input value={w.formula.expr} onChange={(e) => patch({ formula: { ...w.formula!, expr: e.target.value } })} placeholder="gp/qty" spellCheck={false} className={`w-full h-8 px-2 rounded-lg bg-surface border text-xs font-mono outline-none focus:ring-2 focus:ring-brand/30 ${formulaErr ? "border-danger" : "border-line"}`} />
                <div className="flex flex-wrap gap-1">
                  {FORMULA_VARS.map((v) => <button key={v.key} type="button" onClick={() => patch({ formula: { ...w.formula!, expr: `${w.formula!.expr} ${v.key} `.replace(/\s+/g, " ").replace(/^\s/, "") } })} title={locale === "th" ? v.th : v.en} className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 text-brand hover:bg-brand/20">{v.key}</button>)}
                  {["+", "-", "*", "/", "(", ")"].map((op) => <button key={op} type="button" onClick={() => patch({ formula: { ...w.formula!, expr: w.formula!.expr + op } })} className="text-[10px] w-5 py-0.5 rounded bg-surface2 border border-line hover:text-brand">{op}</button>)}
                  <button type="button" onClick={() => patch({ formula: { ...w.formula!, expr: "" } })} className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 border border-line text-muted hover:text-danger">{L("ล้าง", "clear", "清")}</button>
                </div>
                <Select value={w.formula.fmt} onChange={(e) => patch({ formula: { ...w.formula!, fmt: e.target.value as Formula["fmt"] } })} className="h-8 text-xs"><option value="thb">฿ {L("บาท", "THB", "泰铢")}</option><option value="int">{L("จำนวน", "Number", "数量")}</option><option value="pct">% {L("ร้อยละ", "Percent", "百分比")}</option></Select>
                {formulaErr ? <p className="text-[10px] text-danger">{L("สูตรไม่ถูกต้อง", "Invalid formula", "公式无效")}{formulaErr.startsWith("unknown:") ? ` (${formulaErr.slice(8)}?)` : ""}</p> : <p className="text-[10px] text-muted">{L("ตัวอย่าง", "e.g.", "例")}: gp/qty, sales-discount, gp/sales*100</p>}
              </div>
            ) : null}
          </Field>
          <Field label={L("มิติ (Dimension)", "Dimension", "维度")}><Select value={w.dimension ?? ""} onChange={(e) => patch(e.target.value ? { dimension: e.target.value as Dimension, viz: suggestViz(e.target.value as Dimension) } : { dimension: null })}><option value="">{L("รวม (KPI)", "Total (KPI)", "合计")}</option>{DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d][locale]}</option>)}</Select></Field>
          {w.dimension ? (
            <>
              <Field label={<span className="flex items-center gap-1">{L("รูปแบบกราฟ", "Chart type", "图表")} <span className="text-[10px] text-brand">({L("แนะนำ", "rec.", "推荐")}: {recommended})</span></span>}>
                <Select value={w.viz} onChange={(e) => patch({ viz: e.target.value as Viz })}><option value="bar">{L("แท่ง", "Bar", "柱状")}</option><option value="stacked">{L("แท่งซ้อน (มิติซ้อน)", "Stacked bar", "堆叠柱")}</option><option value="hbar">{L("แท่งแนวนอน", "H-Bar", "横向")}</option><option value="donut">{L("โดนัท", "Donut", "环形")}</option><option value="line">{L("เส้น", "Line", "折线")}</option><option value="scatter">{L("กระจาย (x×y)", "Scatter", "散点")}</option><option value="waterfall">{L("Waterfall (ปัจจัยเปลี่ยนแปลง)", "Waterfall", "瀑布图")}</option><option value="heatmap">{L("ฮีตแมป (วัน×ชม.)", "Heatmap", "热力图")}</option><option value="table">{L("ตาราง", "Table", "表格")}</option></Select>
              </Field>
              {w.viz === "stacked" ? <Field label={L("แยกตาม (ซ้อน)", "Stack by", "堆叠维度")}><Select value={w.stackBy ?? ""} onChange={(e) => patch({ stackBy: e.target.value as Dimension })}>{STACK_DIMS.filter((d) => d !== w.dimension).map((d) => <option key={d} value={d}>{DIM_LABEL[d][locale]}</option>)}</Select></Field> : null}
              {w.viz === "scatter" ? <Field label={L("แกน Y (ตัววัด)", "Y axis metric", "Y轴指标")}><Select value={w.metricY ?? "gp_pct"} onChange={(e) => patch({ metricY: e.target.value as Metric })}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m][locale]}</option>)}</Select></Field> : null}
              {w.viz !== "heatmap" && w.viz !== "scatter" ? <Field label={L("จำกัดอันดับ (Top-N)", "Top-N", "前N")}><Select value={String(w.limit ?? 0)} onChange={(e) => patch({ limit: Number(e.target.value) || undefined })}><option value="0">{L("ทั้งหมด", "All", "全部")}</option>{[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field> : null}
              {w.dimension === "day" && (w.viz === "line" || w.viz === "bar") ? <Field label={L("แปลงอนุกรม", "Transform", "变换")}><Select value={w.transform ?? "none"} onChange={(e) => patch({ transform: e.target.value as Transform })}><option value="none">{L("ไม่แปลง", "None", "无")}</option><option value="cumulative">{L("สะสม", "Cumulative", "累计")}</option><option value="ma7">{L("เฉลี่ยเคลื่อนที่ 7", "Moving avg 7", "移动均7")}</option></Select></Field> : null}
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
              <p className="text-[11px] text-muted">{L("รวม", "Total", "合计")} {fmtWidget(w, data.total)}{!w.formula && deltaPct != null ? <span className={deltaPct >= 0 ? "text-ok" : "text-danger"}> · {deltaPct >= 0 ? "+" : ""}{deltaPct}% {L("เทียบช่วงก่อน", "vs prev", "对比上期")}</span> : null}</p>
            </div>
          </div>
          <div className="flex-1 min-h-[240px]">{preview}</div>
          {poorChoice ? <p className="text-[11px] text-danger flex items-center gap-1 mt-2"><Lightbulb size={12} />{L("โดนัทเหมาะกับหมวดน้อย — ลองแท่งเรียงลำดับสำหรับหลายรายการ", "Donut suits few categories — try a ranked bar", "环形适合少类别")}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
