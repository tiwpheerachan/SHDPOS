"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Send, Save, Trash2, LayoutDashboard, Wand2, Bookmark, Pencil, Plus, X, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders, listEmployees } from "@/lib/data/repo";
import type { Order, Employee } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, EmptyState, KpiTile, Select } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders } from "@/lib/analytics";
import { visibleBranchIds, can } from "@/lib/permissions";
import { formatTHB, formatInt } from "@/lib/money";
import { MixDonut, SalesAreaTrend, InsightBars } from "@/components/charts-rich";
import type { ChartConfig } from "@/components/ui/chart";
import { BorderBeam } from "@/components/ui/border-beam";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import {
  computeWidget, parsePrompt, localSuggestions, METRIC_LABEL, DIM_LABEL,
  type View, type Widget, type WidgetData, type Ctx, type Metric, type Dimension, type Viz,
} from "@/lib/ai/engine";
import { listViews, saveView, deleteView } from "@/lib/ai/views";

const uid = () => Math.random().toString(36).slice(2, 9);
const METRICS: Metric[] = ["sales", "qty", "gp", "orders", "aov", "discount"];
const DIMS: Dimension[] = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];

type ChatMsg = { role: "user" | "assistant"; text: string; suggestions?: string[] };

export default function AdminInsightsPage() {
  const { locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [saved, setSaved] = useState<View[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  useEffect(() => { void listOrders().then(setOrders); void listEmployees().then(setEmployees); setSaved(listViews()); }, []);
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages, thinking]);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);
  const rows = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);
  const ctx: Ctx = useMemo(() => ({ branches, employees, brands: brands.map((b) => ({ id: b.id, name: b.name })) }), [branches, employees, brands]);

  const data = useMemo(() => {
    const m = new Map<string, WidgetData>();
    if (!view) return m;
    for (const w of view.widgets) {
      const wr = w.branchId ? rows.filter((o) => o.branch_id === w.branchId) : rows;
      m.set(w.id, computeWidget(wr, ctx, w, locale));
    }
    return m;
  }, [view, rows, ctx, locale]);

  if (employee && !can(employee, "report.employee_perf")) {
    return <div className="p-6"><EmptyState icon={<Sparkles size={26} />} title={L("ไม่มีสิทธิ์ใช้ผู้ช่วย AI", "No AI access", "无 AI 权限")} /></div>;
  }

  async function onAsk(text: string) {
    const q = text.trim();
    if (!q || thinking) return;
    const history: ChatMsg[] = [...messages, { role: "user", text: q }];
    setMessages(history); setPrompt(""); setThinking(true); setEditId(null);
    const minThink = new Promise((r) => setTimeout(r, 1100));

    let reply = "", suggestions: string[] = [], newView: View | null = view, src = "local";
    try {
      const r = await fetch("/api/ai/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.text })), currentWidgets: view?.widgets ?? [], locale }),
      });
      if (r.ok) {
        const d = (await r.json()) as { reply: string; suggestions: string[]; widgets: Widget[] | null; provider?: string };
        reply = d.reply || ""; suggestions = d.suggestions || []; src = d.provider || "ai";
        if (d.widgets && d.widgets.length) {
          newView = view ? { ...view, widgets: d.widgets } : { id: uid(), name: q.slice(0, 48), prompt: q, widgets: d.widgets, createdAt: new Date().toISOString() };
        }
      }
    } catch { /* fall back */ }

    if (src === "local" && !reply) {
      const v = parsePrompt(q, locale);
      newView = v; src = "local";
      reply = L("สร้างแดชบอร์ดให้แล้ว ✨ ลองกดแก้แต่ละการ์ด หรือถามต่อได้เลย", "Built a dashboard ✨ edit any card or keep chatting", "已生成仪表盘 ✨");
      suggestions = localSuggestions(v, locale);
    }

    await minThink;
    if (newView) setView(newView);
    setSource(src);
    setMessages((m) => [...m, { role: "assistant", text: reply || L("เรียบร้อย", "Done", "完成"), suggestions }]);
    setThinking(false);
  }

  const mutate = (fn: (ws: Widget[]) => Widget[]) => setView((v) => (v ? { ...v, widgets: fn(v.widgets) } : v));
  const patchWidget = (id: string, p: Partial<Widget>) => mutate((ws) => ws.map((w) => (w.id === id ? normalize({ ...w, ...p }) : w)));
  const removeWidget = (id: string) => { mutate((ws) => ws.filter((w) => w.id !== id)); if (editId === id) setEditId(null); };
  const addWidget = () => { const w: Widget = { id: uid(), title: L("การ์ดใหม่", "New card", "新卡片"), viz: "bar", metric: "sales", dimension: "branch" }; mutate((ws) => [...ws, w]); setEditId(w.id); };

  function onSave() {
    if (!view) return;
    const name = window.prompt(L("ตั้งชื่อมุมมอง", "Name this view", "命名视图"), view.name);
    if (!name) return;
    const v = { ...view, name, id: view.id || uid(), createdAt: new Date().toISOString() };
    setView(v); setSaved(saveView(v));
  }
  function recall(v: View) { setView(v); setSource(null); setEditId(null); setMessages([{ role: "assistant", text: L(`เปิดมุมมอง “${v.name}” ให้แล้ว`, `Opened “${v.name}”`, `已打开“${v.name}”`), suggestions: localSuggestions(v, locale) }]); }
  function reset() { setMessages([]); setView(null); setSource(null); setEditId(null); setPrompt(""); }

  const EXAMPLES = [
    L("ยอดขายรายสาขา", "Sales by branch", "各门店销售"),
    L("สินค้าขายดี 10 อันดับ", "Top 10 products", "热销商品前10"),
    L("กำไรต่อพนักงาน", "Profit by staff", "员工毛利"),
    L("ช่วยวิเคราะห์ว่าสาขาไหนน่าห่วง", "Which branch needs attention?", "哪个门店需关注"),
  ];
  const srcLabel = source === "deepseek" ? "DeepSeek" : source === "anthropic" ? "Claude" : source === "local" ? L("AI ในเครื่อง", "On-device", "本地 AI") : "AI";

  return (
    <div
      className="relative p-4 sm:p-6 pb-28 space-y-4 w-full min-h-[calc(100vh-64px)]"
      style={{ backgroundImage: "radial-gradient(rgb(var(--c-ink) / 0.055) 1px, transparent 1.3px)", backgroundSize: "22px 22px" }}
    >
      <style>{"@keyframes shd-typ{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}"}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Wand2 size={20} className="text-brand" />{L("ผู้ช่วย AI · สนทนา & สร้างแดชบอร์ด", "AI · Chat & dashboard", "AI 对话与仪表盘")}</h1>
          <p className="text-sm text-muted">{L("คุยโต้ตอบได้ · AI ถามกลับ แนะนำ และสร้าง/แก้แดชบอร์ดให้", "Chat with AI — it asks back, suggests, builds & edits dashboards", "可对话 · AI 追问、建议并生成/编辑仪表盘")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {messages.length ? <button onClick={reset} className="text-xs px-2.5 py-1 rounded-full border border-line text-muted hover:text-brand">{L("เริ่มใหม่", "New chat", "新对话")}</button> : null}
          {saved.length ? <><Bookmark size={12} className="text-muted ml-1" />
            {saved.map((v) => (
              <span key={v.id} className="group inline-flex items-center gap-1 text-xs pl-2.5 pr-1 py-1 rounded-full bg-surface2 border border-line">
                <button onClick={() => recall(v)} className="hover:text-brand">{v.name}</button>
                <button onClick={() => setSaved(deleteView(v.id))} className="opacity-40 group-hover:opacity-100 hover:text-danger p-0.5"><Trash2 size={11} /></button>
              </span>
            ))}</> : null}
        </div>
      </div>

      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {/* บทสนทนา */}
      {messages.length ? (
        <Card className="p-4">
          <div ref={threadRef} className="space-y-3 max-h-[42vh] overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2.5"}>
                {m.role === "assistant" ? <span className="w-7 h-7 rounded-full grid place-items-center bg-brand/12 text-brand shrink-0 mt-0.5"><Sparkles size={14} /></span> : null}
                <div className={m.role === "user" ? "max-w-[80%] rounded-2xl rounded-tr-sm bg-brand text-white px-3.5 py-2 text-sm" : "max-w-[85%]"}>
                  <p className={m.role === "user" ? "" : "text-sm text-ink whitespace-pre-wrap"}>{m.text}</p>
                  {m.role === "assistant" && m.suggestions?.length ? (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.suggestions.map((s) => (
                        <button key={s} onClick={() => void onAsk(s)} disabled={thinking} className="text-[11px] px-2.5 py-1 rounded-full border border-brand/30 text-brand hover:bg-brand/8 disabled:opacity-50 transition-colors">{s}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {thinking ? (
              <div className="flex gap-2.5">
                <span className="w-7 h-7 rounded-full grid place-items-center bg-brand/12 text-brand shrink-0"><Sparkles size={14} /></span>
                <span className="inline-flex items-center gap-1 h-7 px-3 rounded-2xl bg-surface2"><Dot /><Dot d={0.15} /><Dot d={0.3} /></span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* dashboard / orb / empty */}
      {thinking && !view ? (
        <div className="grid place-items-center min-h-[42vh]"><ThinkingOrb size={168} text={L("กำลังคิด", "Thinking", "思考中")} /></div>
      ) : view ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><p className="font-semibold">{view.name}</p><Badge tone="brand">{srcLabel}</Badge></div>
            <div className="flex items-center gap-1.5">
              <button onClick={addWidget} className="h-9 px-3 rounded-xl border border-line text-sm hover:bg-surface2 inline-flex items-center gap-1.5"><Plus size={14} />{L("เพิ่มการ์ด", "Add card", "加卡片")}</button>
              <button onClick={onSave} className="h-9 px-3 rounded-xl bg-brand text-white text-sm hover:bg-brandHover inline-flex items-center gap-1.5"><Save size={14} />{L("บันทึก", "Save", "保存")}</button>
            </div>
          </div>

          {view.widgets.some((w) => w.viz === "kpi") ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {view.widgets.filter((w) => w.viz === "kpi").map((w) => (
                <div key={w.id} className="relative group">
                  <KpiTile label={w.title || METRIC_LABEL[w.metric][locale]} value={fmtMetric(w.metric, data.get(w.id)?.total ?? 0)} variant="ink" />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconBtn onClick={() => setEditId(editId === w.id ? null : w.id)} ink><Pencil size={12} /></IconBtn>
                    <IconBtn onClick={() => removeWidget(w.id)} ink><Trash2 size={12} /></IconBtn>
                  </div>
                  {editId === w.id ? <EditPanel w={w} branches={branches} locale={locale} L={L} onChange={(p) => patchWidget(w.id, p)} onClose={() => setEditId(null)} /> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid lg:grid-cols-2 gap-4">
            {view.widgets.filter((w) => w.viz !== "kpi").map((w) => (
              <div key={w.id} className="relative group">
                <WidgetCard widget={w} data={data.get(w.id)} L={L} />
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconBtn onClick={() => setEditId(editId === w.id ? null : w.id)}><Pencil size={13} /></IconBtn>
                  <IconBtn onClick={() => removeWidget(w.id)}><Trash2 size={13} /></IconBtn>
                </div>
                {editId === w.id ? <EditPanel w={w} branches={branches} locale={locale} L={L} onChange={(p) => patchWidget(w.id, p)} onClose={() => setEditId(null)} /> : null}
              </div>
            ))}
          </div>
        </div>
      ) : !messages.length ? (
        <Card className="p-10">
          <EmptyState icon={<LayoutDashboard size={28} />} title={L("เริ่มคุยกับ AI ด้านล่าง", "Start chatting below", "下方开始对话")}
            body={L("ถามอะไรก็ได้ AI จะตอบ ถามกลับ และสร้างแดชบอร์ดให้ · หรือลอง:", "Ask anything — AI replies, asks back & builds dashboards · or try:", "随便问 · 或试试：")} />
          <div className="flex flex-wrap gap-1.5 justify-center mt-3">
            {EXAMPLES.map((ex) => <button key={ex} onClick={() => void onAsk(ex)} className="text-xs px-3 py-1.5 rounded-full border border-line text-muted hover:text-brand hover:border-brand/40 transition-colors">{ex}</button>)}
          </div>
        </Card>
      ) : null}

      {/* กล่องถามลอยด้านล่าง */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(680px,calc(100vw-2rem))]">
        <div aria-hidden className="pointer-events-none absolute inset-x-4 -bottom-3 h-14 -z-10 blur-2xl opacity-55 rounded-full"
          style={{ background: "linear-gradient(90deg, rgb(var(--c-brand) / .7), rgb(var(--c-aqua) / .7), rgb(var(--c-mint) / .6), rgb(var(--c-lavender) / .8))" }} />
        <BorderBeam radius={28} width={2} duration={3} active={thinking || focused} className="block rounded-[28px]">
          <form onSubmit={(e) => { e.preventDefault(); void onAsk(prompt); }} className="flex items-center gap-2 rounded-[28px] bg-surface/95 backdrop-blur-xl border border-line shadow-[0_12px_40px_-12px_rgba(0,0,0,.35)] pl-4 pr-1.5 py-1.5">
            <Sparkles size={18} className="text-brand shrink-0" />
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              placeholder={messages.length ? L("ถามต่อ หรือสั่งแก้แดชบอร์ด…", "Reply or edit the dashboard…", "继续问或修改仪表盘…") : L("ถามอะไรก็ได้ เช่น ยอดขายรายสาขา + สินค้าขายดี 5 อันดับ", "Ask anything…", "随便问…")}
              className="flex-1 bg-transparent h-10 outline-none text-sm placeholder:text-muted" />
            <button type="submit" disabled={thinking || !prompt.trim()} className="w-10 h-10 rounded-full bg-brand text-white grid place-items-center shrink-0 disabled:opacity-40 hover:bg-brandHover transition-colors">
              {thinking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        </BorderBeam>
        <p className="text-[10px] text-muted text-center mt-1.5">
          {source && source !== "local"
            ? L(`ขับเคลื่อนด้วย ${srcLabel} · ส่งเฉพาะบทสนทนา ไม่ส่งข้อมูลยอดขาย/ลูกค้า`, `Powered by ${srcLabel} · only the chat is sent`, `由 ${srcLabel} 驱动 · 仅发送对话`)
            : L("AI ในเครื่อง · ตั้งคีย์ใน .env.local เพื่อสนทนาฉลาดขึ้น", "On-device AI · set a key in .env.local for smarter chat", "本地 AI · 设置密钥以获得更智能对话")}
        </p>
      </div>
    </div>
  );
}

const fmtMetric = (m: Metric, n: number) => (m === "orders" || m === "qty") ? formatInt(n) : formatTHB(n, false);
function Dot({ d = 0 }: { d?: number }) { return <i className="w-1.5 h-1.5 rounded-full bg-brand/60" style={{ animation: "shd-typ 1.2s infinite", animationDelay: `${d}s` }} />; }

function IconBtn({ children, onClick, ink }: { children: React.ReactNode; onClick: () => void; ink?: boolean }) {
  return <button onClick={onClick} className={`w-6 h-6 rounded-lg grid place-items-center border transition-colors ${ink ? "bg-brandInk/15 border-brandInk/20 text-brandInk hover:bg-brandInk/25" : "bg-surface border-line text-muted hover:text-brand hover:border-brand/40"}`}>{children}</button>;
}

function EditPanel({ w, branches, locale, L, onChange, onClose }: {
  w: Widget; branches: ReturnType<typeof useAdminScope>["branches"]; locale: "th" | "en" | "zh";
  L: (th: string, en: string, zh: string) => string; onChange: (p: Partial<Widget>) => void; onClose: () => void;
}) {
  const isKpi = !w.dimension;
  return (
    <div className="absolute z-20 top-full mt-1 right-0 w-[min(340px,calc(100vw-3rem))] rounded-2xl border border-line bg-surface shadow-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-muted uppercase tracking-wide">{L("แก้การ์ด", "Edit card", "编辑卡片")}</p><button onClick={onClose} className="text-muted hover:text-ink"><X size={14} /></button></div>
      <input value={w.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={L("ชื่อการ์ด", "Card title", "标题")} className="w-full h-9 px-3 rounded-lg bg-surface2 border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
      <div className="grid grid-cols-2 gap-2">
        <Labeled label={L("ตัววัด", "Metric", "指标")}><Select value={w.metric} onChange={(e) => onChange({ metric: e.target.value as Metric })}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m][locale]}</option>)}</Select></Labeled>
        <Labeled label={L("มิติ", "Dimension", "维度")}><Select value={w.dimension ?? ""} onChange={(e) => { const v = e.target.value; onChange(v ? { dimension: v as Dimension } : { dimension: null, viz: "kpi" }); }}><option value="">{L("รวม (KPI)", "Total (KPI)", "合计")}</option>{DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d][locale]}</option>)}</Select></Labeled>
        {!isKpi ? <Labeled label={L("รูปแบบ", "Chart", "图表")}><Select value={w.viz} onChange={(e) => onChange({ viz: e.target.value as Viz })}><option value="bar">{L("แท่ง", "Bar", "柱状")}</option><option value="donut">{L("โดนัท", "Donut", "环形")}</option><option value="line">{L("เส้น", "Line", "折线")}</option><option value="table">{L("ตาราง", "Table", "表格")}</option></Select></Labeled> : null}
        {!isKpi ? <Labeled label={L("จำกัดอันดับ", "Top-N", "前N")}><Select value={String(w.limit ?? 0)} onChange={(e) => onChange({ limit: Number(e.target.value) || undefined })}><option value="0">{L("ทั้งหมด", "All", "全部")}</option>{[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Labeled> : null}
        <Labeled label={L("ฟิลเตอร์สาขา", "Branch filter", "门店筛选")}><Select value={w.branchId ?? ""} onChange={(e) => onChange({ branchId: e.target.value || null })}><option value="">{L("ทุกสาขา", "All branches", "全部门店")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}</Select></Labeled>
      </div>
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) { return <div><label className="block text-[10px] font-medium text-muted mb-1">{label}</label>{children}</div>; }
function normalize(w: Widget): Widget { if (!w.dimension) return { ...w, viz: "kpi", dimension: null }; if (w.viz === "kpi") return { ...w, viz: "bar" }; return w; }

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
      <div className="overflow-x-auto"><Table>
        <thead><tr><Th>{L("รายการ", "Item", "项目")}</Th><Th align="right">{mL}</Th><Th align="right">{L("ชิ้น", "Units", "件")}</Th><Th align="right">{L("บิล", "Bills", "单")}</Th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.key}><Td className="max-w-[220px] truncate">{r.label}</Td><Td align="right" className="tnum font-medium">{fmt(r.value)}</Td><Td align="right" className="tnum text-muted">{formatInt(r.qty)}</Td><Td align="right" className="tnum text-muted">{formatInt(r.orders)}</Td></tr>))}</tbody>
      </Table></div>
    );
  } else {
    body = <InsightBars data={rows.map((r, i) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, value: r.value, highlight: i === 0 }))} config={config} valueFormat={fmt} />;
  }
  return <Card className="p-4"><CardHeader title={w.title || mL} subtitle={data ? `${L("รวม", "Total", "合计")} ${fmt(data.total)}` : undefined} />{body}</Card>;
}
