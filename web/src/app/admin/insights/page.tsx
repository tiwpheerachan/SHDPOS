"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Send, Save, Trash2, LayoutDashboard, Wand2, Bookmark } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders, listEmployees } from "@/lib/data/repo";
import type { Order, Employee } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, EmptyState, KpiTile, Input, Button } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders } from "@/lib/analytics";
import { visibleBranchIds, can } from "@/lib/permissions";
import { formatTHB, formatInt } from "@/lib/money";
import { MixDonut, SalesAreaTrend, InsightBars } from "@/components/charts-rich";
import type { ChartConfig } from "@/components/ui/chart";
import { AiLoader } from "@/components/ui/ai-loader";
import {
  computeWidget, parsePrompt, localAnswer, METRIC_LABEL,
  type View, type Widget, type WidgetData, type Ctx, type Metric,
} from "@/lib/ai/engine";
import { listViews, saveView, deleteView } from "@/lib/ai/views";

const uid = () => Math.random().toString(36).slice(2, 9);

export default function AdminInsightsPage() {
  const { locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState<"ai" | "local" | null>(null);
  const [saved, setSaved] = useState<View[]>([]);
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  useEffect(() => { void listOrders().then(setOrders); void listEmployees().then(setEmployees); setSaved(listViews()); }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);
  const rows = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);
  const ctx: Ctx = useMemo(() => ({ branches, employees, brands: brands.map((b) => ({ id: b.id, name: b.name })) }), [branches, employees, brands]);

  // คำนวณ widget ทั้งหมดของ view ปัจจุบัน
  const data = useMemo(() => {
    if (!view) return new Map<string, WidgetData>();
    const m = new Map<string, WidgetData>();
    for (const w of view.widgets) m.set(w.id, computeWidget(rows, ctx, w, locale));
    return m;
  }, [view, rows, ctx, locale]);

  const shownAnswer = useMemo(() => {
    if (!view) return "";
    if (source === "ai" && answer) return answer;
    const firstBreak = view.widgets.find((w) => w.dimension);
    return localAnswer(view, firstBreak ? data.get(firstBreak.id) ?? null : null, locale);
  }, [view, answer, source, data, locale]);

  if (employee && !can(employee, "report.employee_perf")) {
    return <div className="p-6"><EmptyState icon={<Sparkles size={26} />} title={L("ไม่มีสิทธิ์ใช้ผู้ช่วย AI", "No AI access", "无 AI 权限")} /></div>;
  }

  async function onAsk(text: string) {
    const q = text.trim();
    if (!q) return;
    setPrompt(q); setThinking(true); setView(null); setAnswer(""); setSource(null);
    let v: View | null = null;
    try {
      const r = await fetch("/api/ai/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: q, locale }) });
      if (r.ok) {
        const d = (await r.json()) as { name: string; answer: string; widgets: Widget[] };
        v = { id: uid(), name: d.name, prompt: q, widgets: d.widgets, createdAt: new Date().toISOString() };
        setAnswer(d.answer || ""); setSource("ai");
      }
    } catch { /* fall back */ }
    if (!v) { v = parsePrompt(q, locale); setSource("local"); }
    setView(v);
    setThinking(false);
  }

  function onSave() {
    if (!view) return;
    const name = window.prompt(L("ตั้งชื่อมุมมอง", "Name this view", "命名视图"), view.name);
    if (!name) return;
    setSaved(saveView({ ...view, name, id: view.id || uid(), createdAt: view.createdAt || new Date().toISOString() }));
  }
  function recall(v: View) { setPrompt(v.prompt); setView(v); setSource(null); setAnswer(""); }

  const EXAMPLES = [
    L("ยอดขายรายสาขา", "Sales by branch", "各门店销售"),
    L("สินค้าขายดี 10 อันดับ", "Top 10 products", "热销商品前10"),
    L("กำไรต่อพนักงาน", "Profit by staff", "员工毛利"),
    L("ยอดตามช่องทางการจ่าย", "Sales by payment", "按支付方式"),
    L("แนวโน้มยอดขายรายวัน", "Daily sales trend", "每日趋势"),
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Wand2 size={20} className="text-brand" />{L("ผู้ช่วย AI · สร้างแดชบอร์ด", "AI · Dashboard builder", "AI 仪表盘生成")}</h1>
          <p className="text-sm text-muted">{L("ถามเป็นภาษาธรรมชาติ → สร้างแดชบอร์ดอัตโนมัติ → บันทึกมุมมอง", "Ask in natural language → auto dashboard → save views", "自然语言提问 → 自动仪表盘 → 保存视图")}</p>
        </div>
      </div>

      {/* กล่องถาม */}
      <Card className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); void onAsk(prompt); }} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={L("เช่น: ยอดขายรายสาขาเดือนนี้ + สินค้าขายดี 5 อันดับ", "e.g. sales by branch this month + top 5 products", "例如：本月各门店销售 + 热销前5")} className="pl-9 h-11" />
          </div>
          <Button type="submit" disabled={thinking || !prompt.trim()}><Send size={15} />{L("ถาม", "Ask", "提问")}</Button>
        </form>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => void onAsk(ex)} className="text-[11px] px-2.5 py-1 rounded-full border border-line text-muted hover:text-brand hover:border-brand/40 transition-colors">{ex}</button>
          ))}
        </div>
      </Card>

      {/* มุมมองที่บันทึกไว้ */}
      {saved.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted flex items-center gap-1"><Bookmark size={12} />{L("มุมมองที่บันทึก", "Saved views", "已保存")}:</span>
          {saved.map((v) => (
            <span key={v.id} className="group inline-flex items-center gap-1 text-xs pl-2.5 pr-1 py-1 rounded-full bg-surface2 border border-line">
              <button onClick={() => recall(v)} className="hover:text-brand">{v.name}</button>
              <button onClick={() => setSaved(deleteView(v.id))} className="opacity-40 group-hover:opacity-100 hover:text-danger p-0.5"><Trash2 size={11} /></button>
            </span>
          ))}
        </div>
      ) : null}

      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {thinking ? (
        <Card className="p-10"><AiLoader fullscreen={false} size={120} text={L("กำลังคิด", "Thinking", "思考中")} /></Card>
      ) : view ? (
        <div className="space-y-4">
          {/* หัว + คำตอบ + ปุ่มบันทึก */}
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-full grid place-items-center bg-brand/12 text-brand shrink-0"><Sparkles size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">{view.name}</p>
                  <Badge tone="brand">{source === "ai" ? "Claude AI" : L("AI ในเครื่อง", "On-device", "本地 AI")}</Badge>
                </div>
                <p className="text-sm text-ink mt-0.5">{shownAnswer}</p>
              </div>
              <Button onClick={onSave} className="shrink-0"><Save size={14} />{L("บันทึกมุมมอง", "Save view", "保存")}</Button>
            </div>
          </Card>

          {/* KPI row */}
          {view.widgets.some((w) => w.viz === "kpi") ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {view.widgets.filter((w) => w.viz === "kpi").map((w) => (
                <KpiTile key={w.id} label={w.title} value={fmtMetric(w.metric, data.get(w.id)?.total ?? 0)} variant="ink" />
              ))}
            </div>
          ) : null}

          {/* กราฟ/ตาราง */}
          <div className="grid lg:grid-cols-2 gap-4">
            {view.widgets.filter((w) => w.viz !== "kpi").map((w) => (
              <WidgetCard key={w.id} widget={w} data={data.get(w.id)} L={L} />
            ))}
          </div>
        </div>
      ) : (
        <Card className="p-10">
          <EmptyState icon={<LayoutDashboard size={28} />} title={L("พิมพ์คำถามเพื่อสร้างแดชบอร์ด", "Type a question to build a dashboard", "输入问题生成仪表盘")}
            body={L("ลองกดตัวอย่างด้านบน หรือถามอะไรก็ได้เกี่ยวกับยอดขาย/สินค้า/สาขา/พนักงาน", "Try an example above, or ask anything about sales/products/branches/staff", "试试上面的示例")} />
        </Card>
      )}

      <p className="text-[11px] text-muted pt-1">
        {source === "ai"
          ? L("ขับเคลื่อนด้วย Claude · ส่งเฉพาะคำถาม ไม่ส่งข้อมูลยอดขาย/ลูกค้าออกนอกระบบ", "Powered by Claude · only the question is sent, never your sales/customer data", "由 Claude 驱动 · 仅发送问题，不外传数据")
          : L("โหมด AI ในเครื่อง (ไม่ต้องใช้อินเทอร์เน็ต) · ตั้ง ANTHROPIC_API_KEY เพื่อใช้ Claude เข้าใจคำถามอิสระได้ลึกขึ้น", "On-device mode · set ANTHROPIC_API_KEY to use Claude for richer free-form questions", "本地模式 · 设置 ANTHROPIC_API_KEY 启用 Claude")}
      </p>
    </div>
  );
}

const fmtMetric = (m: Metric, n: number) => (m === "orders" || m === "qty") ? formatInt(n) : formatTHB(n, false);

function WidgetCard({ widget: w, data, L }: { widget: Widget; data?: WidgetData; L: (th: string, en: string, zh: string) => string }) {
  const rows = data?.rows ?? [];
  const mL = METRIC_LABEL[w.metric][L("th", "en", "zh") as "th" | "en" | "zh"];
  const fmt = (n: number) => fmtMetric(w.metric, n);
  const config: ChartConfig = { value: { label: mL, color: "rgb(var(--chart-1))" } };

  let body: React.ReactNode;
  if (!rows.length) body = <EmptyState title={L("ไม่มีข้อมูล", "No data", "无数据")} />;
  else if (w.viz === "line") body = <SalesAreaTrend data={rows.map((r) => ({ label: r.label, value: r.value }))} config={config} valueFormat={fmt} />;
  else if (w.viz === "donut") {
    const dd = rows.map((r) => ({ key: r.key, value: r.value }));
    const dc: ChartConfig = Object.fromEntries(rows.map((r, i) => [r.key, { label: r.label, color: `rgb(var(--chart-${(i % 5) + 1}))` }]));
    body = <MixDonut data={dd} config={dc} />;
  } else if (w.viz === "table") {
    body = (
      <div className="overflow-x-auto">
        <Table>
          <thead><tr><Th>{L("รายการ", "Item", "项目")}</Th><Th align="right">{mL}</Th><Th align="right">{L("ชิ้น", "Units", "件")}</Th><Th align="right">{L("บิล", "Bills", "单")}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><Td className="max-w-[220px] truncate">{r.label}</Td><Td align="right" className="tnum font-medium">{fmt(r.value)}</Td><Td align="right" className="tnum text-muted">{formatInt(r.qty)}</Td><Td align="right" className="tnum text-muted">{formatInt(r.orders)}</Td></tr>
            ))}
          </tbody>
        </Table>
      </div>
    );
  } else {
    body = <InsightBars data={rows.map((r, i) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, value: r.value, highlight: i === 0 }))} config={config} valueFormat={fmt} />;
  }

  return (
    <Card className="p-4">
      <CardHeader title={w.title} subtitle={data ? `${L("รวม", "Total", "合计")} ${fmt(data.total)}` : undefined} />
      {body}
    </Card>
  );
}
