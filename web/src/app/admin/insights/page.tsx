"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Send, Save, Trash2, LayoutDashboard, Wand2, Bookmark, Pencil, Plus, X, Loader2, Download, Share2, GripVertical, BarChart3, Undo2, Redo2, ListTodo, ListPlus, ArrowUp, ArrowDown, Maximize2, Minimize2, Boxes } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listOrders, listEmployees, listProducts, stockAll } from "@/lib/data/repo";
import type { Order, Employee, Product, StockLevel } from "@/lib/types";
import { Card, CardHeader, Badge, EmptyState, KpiTile, Select } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders } from "@/lib/analytics";
import { visibleBranchIds, can } from "@/lib/permissions";
import { Sparkline } from "@/components/charts";
import { WidgetBody, fmtWidget, widgetMetricLabel } from "@/components/admin/widget-body";
import { BorderBeam } from "@/components/ui/border-beam";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import {
  computeWidget, parsePrompt, localSuggestions, METRIC_LABEL, DIM_LABEL,
  type View, type Widget, type WidgetData, type Ctx, type Metric, type Dimension, type Viz, type Transform,
} from "@/lib/ai/engine";
import { buildFactPack, localInsights, type Insight } from "@/lib/ai/facts";
import { listViews, saveView, deleteView } from "@/lib/ai/views";
import { ChartBuilder } from "@/components/admin/chart-builder";
import { TaskDrawer } from "@/components/admin/task-drawer";
import { listTasks, addTask, type Task, type TaskPriority } from "@/lib/ai/tasks";
import { analyzeStock, type StockRow } from "@/lib/ai/stock";
import { StockDrawer } from "@/components/admin/stock-drawer";
import { dashboardShareUrl, dashboardFromHash } from "@/lib/ai/share";
import { exportExcel } from "@/lib/ai/export-excel";

const uid = () => Math.random().toString(36).slice(2, 9);
const METRICS: Metric[] = ["sales", "qty", "gp", "gp_pct", "orders", "aov", "discount", "discount_pct"];
const DIMS: Dimension[] = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];
// มิติที่กดเจาะลึก (drill) ได้ — ต้องกรองออเดอร์ได้ชัด (ตัวเลขตรวจย้อนกลับได้)
const DRILLABLE: Dimension[] = ["branch", "brand", "channel", "day", "weekday", "hour"];
// มิติที่ใช้เป็น "แกนซ้อน" (stacked) ได้ — ระดับออเดอร์ (ไม่ใช่ราย item/วิธีจ่าย)
const STACK_DIMS: Dimension[] = ["brand", "channel", "branch", "weekday", "hour", "day"];
const defaultStackBy = (d?: Dimension | null): Dimension => (d === "brand" ? "channel" : "brand");
type Drill = { dim: Dimension; key: string; label: string };
function applyDrills(orders: Order[], drills: Drill[], ctx: Ctx): Order[] {
  if (!drills.length) return orders;
  const bb = new Map(ctx.branches.map((b) => [b.id, b.brand_id]));
  const match = (o: Order, dr: Drill): boolean => {
    const d = new Date(o.created_at);
    switch (dr.dim) {
      case "branch": return o.branch_id === dr.key;
      case "brand": return (bb.get(o.branch_id) ?? "") === dr.key;
      case "channel": return o.channel === dr.key;
      case "day": return d.toLocaleDateString("en-CA") === dr.key;
      case "weekday": return String(d.getDay()) === dr.key;
      case "hour": return String(d.getHours()).padStart(2, "0") === dr.key;
      default: return true;
    }
  };
  return orders.filter((o) => drills.every((dr) => match(o, dr)));
}

type ChatMsg = { role: "user" | "assistant"; text: string; suggestions?: string[]; insights?: Insight[] };

export default function AdminInsightsPage() {
  const { locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const toast = useToast();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [saved, setSaved] = useState<View[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [leftPct, setLeftPct] = useState(62);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [stock, setStock] = useState<StockLevel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockOpen, setStockOpen] = useState(false);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [hist, setHist] = useState({ i: -1, len: 0 });
  const threadRef = useRef<HTMLDivElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const histRef = useRef<View[]>([]);
  const hiRef = useRef(-1);
  const skipHist = useRef(false);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  // ── undo/redo: บันทึก snapshot ของ view ทุกครั้งที่เปลี่ยน ──
  useEffect(() => {
    if (!view) return;
    if (skipHist.current) { skipHist.current = false; return; }
    if (histRef.current[hiRef.current] === view) return;
    const h = histRef.current.slice(0, hiRef.current + 1);
    h.push(view); histRef.current = h; hiRef.current = h.length - 1;
    setHist({ i: hiRef.current, len: h.length });
  }, [view]);
  const undo = () => { if (hiRef.current <= 0) return; skipHist.current = true; hiRef.current -= 1; setView(histRef.current[hiRef.current]); setHist({ i: hiRef.current, len: histRef.current.length }); setEditId(null); };
  const redo = () => { if (hiRef.current >= histRef.current.length - 1) return; skipHist.current = true; hiRef.current += 1; setView(histRef.current[hiRef.current]); setHist({ i: hiRef.current, len: histRef.current.length }); setEditId(null); };
  const canUndo = hist.i > 0, canRedo = hist.i >= 0 && hist.i < hist.len - 1;

  useEffect(() => {
    void listOrders().then(setOrders); void listEmployees().then(setEmployees); setSaved(listViews()); setTasks(listTasks());
    void listProducts().then(setProducts); void stockAll().then(setStock);
    try { const s = localStorage.getItem("shdpos.ai.split"); if (s) setLeftPct(Math.max(42, Math.min(75, Number(s)))); } catch { /* ignore */ }
    const shared = dashboardFromHash(typeof window !== "undefined" ? window.location.hash : "");
    if (shared) { setView(shared); setSource("shared"); setMessages([{ role: "assistant", text: L("เปิดแดชบอร์ดที่แชร์มาให้แล้ว ✨ (ตัวเลขคำนวณตามสิทธิ์ของคุณ)", "Opened shared dashboard ✨", "已打开分享的仪表盘 ✨") }]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages, thinking]);

  // ลากปรับขนาดซ้าย/ขวา
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !contRef.current) return;
      const r = contRef.current.getBoundingClientRect();
      setLeftPct(Math.max(42, Math.min(75, ((e.clientX - r.left) / r.width) * 100)));
    };
    const up = () => { if (dragging.current) { dragging.current = false; document.body.style.userSelect = ""; try { localStorage.setItem("shdpos.ai.split", String(Math.round(leftPct))); } catch { /* ignore */ } } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [leftPct]);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);
  const ctx: Ctx = useMemo(() => ({ branches, employees, brands: brands.map((b) => ({ id: b.id, name: b.name })) }), [branches, employees, brands]);
  // เจาะลึก: กรองออเดอร์ตาม drill breadcrumb (ทั้งแดชบอร์ด + บทวิเคราะห์)
  const drilled = useMemo(() => applyDrills(scoped, drills, ctx), [scoped, drills, ctx]);
  const rows = useMemo(() => filterOrders(drilled, { ...filter, branches }), [drilled, filter, branches]);
  // fact pack: ตัวเลขจริง (ปัจจุบัน vs ช่วงก่อน) ให้ AI วิเคราะห์ + โชว์ delta
  const facts = useMemo(() => buildFactPack(drilled, ctx, { from: filter.from, to: filter.to }, locale), [drilled, ctx, filter.from, filter.to, locale]);
  const kpiDelta = (m: Metric): number | null => {
    const t = facts.totals;
    const map: Record<string, { deltaPct: number | null }> = { sales: t.sales, orders: t.orders, aov: t.aov, gp: t.gp, qty: t.units, discount: t.discount };
    return map[m]?.deltaPct ?? null;
  };

  const prevRows = useMemo(() => {
    const pf = new Date(facts.prevPeriod.from).getTime(), pt = new Date(facts.prevPeriod.to).getTime();
    return drilled.filter((o) => { const t = new Date(o.created_at).getTime(); return t >= pf && t <= pt; });
  }, [drilled, facts.prevPeriod.from, facts.prevPeriod.to]);

  // วิเคราะห์สต๊อก (Days-of-Stock) — ความเร็วขายจากช่วง/ขอบเขตปัจจุบัน (ไม่เอา drill)
  const stockAnalysis = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    const stockScoped = stock.filter((s) => ids.includes(s.branch_id));
    const f = new Date(filter.from).getTime(), t = new Date(filter.to).getTime();
    const periodOrders = scoped.filter((o) => { const x = new Date(o.created_at).getTime(); return x >= f && x <= t; });
    return analyzeStock(periodOrders, stockScoped, products, { from: filter.from, to: filter.to });
  }, [stock, products, scoped, employee, branches, filter.from, filter.to]);

  const data = useMemo(() => {
    const m = new Map<string, WidgetData>();
    if (!view) return m;
    for (const w of view.widgets) {
      const wr = w.branchId ? rows.filter((o) => o.branch_id === w.branchId) : rows;
      const needPrev = w.compare || w.viz === "waterfall";
      const pw = needPrev ? (w.branchId ? prevRows.filter((o) => o.branch_id === w.branchId) : prevRows) : undefined;
      m.set(w.id, computeWidget(wr, ctx, w, locale, pw));
    }
    return m;
  }, [view, rows, prevRows, ctx, locale]);

  if (employee && !can(employee, "report.employee_perf")) {
    return <div className="p-6"><EmptyState icon={<Sparkles size={26} />} title={L("ไม่มีสิทธิ์ใช้ผู้ช่วย AI", "No AI access", "无 AI 权限")} /></div>;
  }

  async function onAsk(text: string) {
    const q = text.trim();
    if (!q || thinking) return;
    const history: ChatMsg[] = [...messages, { role: "user", text: q }];
    setMessages(history); setPrompt(""); setThinking(true); setEditId(null);
    const minThink = new Promise((r) => setTimeout(r, 1100));
    let reply = "", suggestions: string[] = [], insights: Insight[] = [], newView: View | null = view, src = "local";
    try {
      const r = await fetch("/api/ai/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.text })), currentWidgets: view?.widgets ?? [], facts, locale }),
      });
      if (r.ok) {
        const d = (await r.json()) as { reply: string; insights?: Insight[]; suggestions: string[]; widgets: Widget[] | null; provider?: string };
        reply = d.reply || ""; suggestions = d.suggestions || []; insights = d.insights || []; src = d.provider || "ai";
        if (d.widgets && d.widgets.length) newView = view ? { ...view, widgets: d.widgets } : { id: uid(), name: q.slice(0, 48), prompt: q, widgets: d.widgets, createdAt: new Date().toISOString() };
      }
    } catch { /* fall back */ }
    if (src === "local" && !reply) {
      const v = parsePrompt(q, locale); newView = v; src = "local";
      reply = L("นี่คือภาพรวมจากข้อมูลจริง ✨", "Here's the picture from live data ✨", "基于实时数据 ✨");
      suggestions = localSuggestions(v, locale);
      insights = localInsights(facts, locale); // บทวิเคราะห์จากตัวเลขจริง (ออฟไลน์)
    }
    await minThink;
    if (newView) setView(newView);
    setSource(src);
    setMessages((m) => [...m, { role: "assistant", text: reply || L("เรียบร้อย", "Done", "完成"), suggestions, insights }]);
    setThinking(false);
  }

  const mutate = (fn: (ws: Widget[]) => Widget[]) => setView((v) => (v ? { ...v, widgets: fn(v.widgets) } : v));
  const patchWidget = (id: string, p: Partial<Widget>) => mutate((ws) => ws.map((w) => (w.id === id ? normalize({ ...w, ...p }) : w)));
  const removeWidget = (id: string) => { mutate((ws) => ws.filter((w) => w.id !== id)); if (editId === id) setEditId(null); };
  const addFromBuilder = (w: Widget) => {
    setView((v) => v ? { ...v, widgets: [...v.widgets, w] } : { id: uid(), name: L("แดชบอร์ดใหม่", "New dashboard", "新仪表盘"), prompt: "", widgets: [w], createdAt: new Date().toISOString() });
  };
  const onDrill = (dim: Dimension, key: string, label: string) => setDrills((d) => [...d.filter((x) => x.dim !== dim), { dim, key, label }]);

  // ── จัดวางการ์ด: ปรับกว้าง (span) + ย้ายลำดับ (ปุ่ม/ลาก) ──
  const setSpan = (id: string, span: 1 | 2) => patchWidget(id, { span });
  // ย้ายการ์ดกราฟสลับกับเพื่อนบ้าน (คง KPI ไว้ที่เดิม)
  const moveChart = (id: string, dir: -1 | 1) => setView((v) => {
    if (!v) return v;
    const ws = [...v.widgets];
    const chartIdx = ws.map((w, i) => ({ w, i })).filter((x) => x.w.viz !== "kpi").map((x) => x.i);
    const pos = chartIdx.findIndex((i) => ws[i].id === id);
    const target = pos + dir;
    if (pos < 0 || target < 0 || target >= chartIdx.length) return v;
    const a = chartIdx[pos], b = chartIdx[target];
    [ws[a], ws[b]] = [ws[b], ws[a]];
    return { ...v, widgets: ws };
  });
  // ลากวางเพื่อสลับตำแหน่ง (ย้ายการ์ดที่ลากไปไว้หน้าการ์ดเป้าหมาย)
  const reorderChart = (fromId: string, toId: string) => setView((v) => {
    if (!v || fromId === toId) return v;
    const ws = [...v.widgets];
    const from = ws.findIndex((w) => w.id === fromId);
    if (from < 0) return v;
    const [moved] = ws.splice(from, 1);
    const to = ws.findIndex((w) => w.id === toId);
    if (to < 0) return v;
    ws.splice(to, 0, moved);
    return { ...v, widgets: ws };
  });

  function onSave() {
    if (!view) return;
    const name = window.prompt(L("ตั้งชื่อมุมมอง", "Name this view", "命名视图"), view.name);
    if (!name) return;
    const v = { ...view, name, id: view.id || uid(), createdAt: new Date().toISOString() };
    setView(v); setSaved(saveView(v));
  }
  function recall(v: View) { setView(v); setSource(null); setEditId(null); setMessages([{ role: "assistant", text: L(`เปิดมุมมอง “${v.name}” ให้แล้ว`, `Opened “${v.name}”`, `已打开“${v.name}”`), suggestions: localSuggestions(v, locale) }]); }
  function reset() { setMessages([]); setView(null); setSource(null); setEditId(null); setPrompt(""); setDrills([]); histRef.current = []; hiRef.current = -1; setHist({ i: -1, len: 0 }); if (typeof window !== "undefined" && window.location.hash) history.replaceState(null, "", window.location.pathname); }

  function onShare() {
    if (!view) return;
    // ลิงก์หน้าแดชบอร์ดเดี่ยว (/dashboard) — เปิดเหมือนเว็บหนึ่งหน้า กดเข้าระบบได้
    const url = dashboardShareUrl(view.name, view.widgets);
    const done = () => toast.push({ tone: "ok", title: L("คัดลอกลิงก์แดชบอร์ดแล้ว", "Dashboard link copied", "已复制仪表盘链接"), body: L("เปิดได้เหมือนเว็บหนึ่งหน้า · ผู้เปิดเข้าสู่ระบบแล้วดูได้", "Opens as its own page · recipient signs in to view", "作为独立页面打开") });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt(L("คัดลอกลิงก์นี้", "Copy this link", "复制此链接"), url));
    else window.prompt(L("คัดลอกลิงก์นี้", "Copy this link", "复制此链接"), url);
  }
  function onExport() {
    if (!view) return;
    exportExcel(view, data, locale);
    toast.push({ tone: "ok", title: L("ดาวน์โหลด Excel แล้ว", "Excel downloaded", "已下载 Excel") });
  }
  // บทวิเคราะห์ → งานติดตาม (ความสำคัญจากโทน · ผูกสาขาที่กำลังเจาะอยู่ ถ้ามี)
  const toneToPriority: Record<string, TaskPriority> = { warn: "high", info: "med", ok: "low" };
  function createTaskFromInsight(text: string, tone?: string) {
    const branchId = drills.find((d) => d.dim === "branch")?.key ?? null;
    setTasks(addTask({ title: text, priority: toneToPriority[tone ?? "info"] ?? "med", branchId, source: "insight" }));
    toast.push({ tone: "ok", title: L("เพิ่มเป็นงานติดตามแล้ว", "Added to follow-up tasks", "已加入跟进任务") });
  }
  const openTaskCount = tasks.filter((t) => t.status !== "done").length;
  // สต๊อก → งานเติม (เชื่อมกับระบบงานติดตาม)
  function onRestock(r: StockRow) {
    const dl = r.daysLeft == null ? null : Math.round(r.daysLeft);
    const tail = r.onHand <= 0 ? L(" (หมด)", " (out)", " (缺货)") : dl != null ? L(` (เหลือ ~${dl} วัน)`, ` (~${dl}d left)`, ` (~${dl}天)`) : "";
    setTasks(addTask({ title: L(`เติมสต๊อก ${r.name}${tail}`, `Restock ${r.name}${tail}`, `补货 ${r.name}${tail}`), priority: (r.status === "out" || r.status === "critical") ? "high" : "med", source: "insight" }));
    toast.push({ tone: "ok", title: L("เพิ่มงานเติมสต๊อกแล้ว", "Restock task added", "已加入补货任务") });
  }

  const EXAMPLES = [
    L("ยอดขายรายสาขา", "Sales by branch", "各门店销售"),
    L("สินค้าขายดี 10 อันดับ", "Top 10 products", "热销商品前10"),
    L("กำไรต่อพนักงาน", "Profit by staff", "员工毛利"),
    L("ช่วยวิเคราะห์ว่าสาขาไหนน่าห่วง", "Which branch needs attention?", "哪个门店需关注"),
  ];
  const srcLabel = source === "deepseek" ? "DeepSeek" : source === "anthropic" ? "Claude" : source === "shared" ? L("แชร์", "Shared", "分享") : source === "local" ? L("AI ในเครื่อง", "On-device", "本地 AI") : "AI";

  return (
    <div className="relative p-4 sm:p-6 w-full flex flex-col lg:h-[calc(100dvh-74px)] lg:overflow-hidden" style={{ backgroundImage: "radial-gradient(rgb(var(--c-ink) / 0.055) 1px, transparent 1.3px)", backgroundSize: "22px 22px" }}>
      <style>{"@keyframes shd-typ{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}"}</style>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Wand2 size={20} className="text-brand" />{L("ผู้ช่วย AI · สนทนา & แดชบอร์ด", "AI · Chat & dashboard", "AI 对话与仪表盘")}</h1>
          <p className="text-sm text-muted">{L("แชตด้านขวา · แดชบอร์ดด้านซ้าย (ลากแบ่งปรับขนาด) · ดาวน์โหลด Excel / แชร์ลิงก์ได้", "Chat right · dashboard left (drag to resize) · export Excel / share link", "右侧对话 · 左侧仪表盘（拖动调整）· 导出 Excel / 分享")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setStockOpen(true)} className="relative inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand">
            <Boxes size={15} />{L("สต๊อก", "Stock", "库存")}
            {stockAnalysis.summary.out + stockAnalysis.summary.critical > 0 ? <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold grid place-items-center">{stockAnalysis.summary.out + stockAnalysis.summary.critical}</span> : null}
          </button>
          <button onClick={() => setTasksOpen(true)} className="relative inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand">
            <ListTodo size={15} />{L("งานติดตาม", "Tasks", "任务")}
            {openTaskCount ? <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-semibold grid place-items-center">{openTaskCount}</span> : null}
          </button>
        {saved.length ? (
          <>
            <span className="w-px h-5 bg-line mx-0.5" />
            <Bookmark size={12} className="text-muted" />
            {saved.map((v) => (
              <span key={v.id} className="group inline-flex items-center gap-1 text-xs pl-2.5 pr-1 py-1 rounded-full bg-surface2 border border-line">
                <button onClick={() => recall(v)} className="hover:text-brand">{v.name}</button>
                <button onClick={() => setSaved(deleteView(v.id))} className="opacity-40 group-hover:opacity-100 hover:text-danger p-0.5"><Trash2 size={11} /></button>
              </span>
            ))}
          </>
        ) : null}
        </div>
      </div>

      <div className="shrink-0"><FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} /></div>

      <div ref={contRef} className="flex flex-col lg:flex-row gap-4 mt-4 lg:flex-1 lg:min-h-0" style={{ ["--lw" as string]: `${leftPct}%` }}>
        {/* ── ซ้าย: แดชบอร์ด (ปรับขนาดได้ · เลื่อนในกรอบตัวเอง) ── */}
        <div className="w-full lg:w-[var(--lw)] min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:pr-1">
          {thinking && !view ? (
            <div className="grid place-items-center min-h-[52vh]"><ThinkingOrb size={168} text={L("กำลังคิด", "Thinking", "思考中")} /></div>
          ) : view ? (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2"><p className="font-semibold truncate max-w-[40vw]">{view.name}</p><Badge tone="brand">{srcLabel}</Badge></div>
                <div className="flex items-center gap-1.5">
                  <IconBtn2 onClick={undo} disabled={!canUndo} title={L("ย้อนกลับ", "Undo", "撤销")}><Undo2 size={15} /></IconBtn2>
                  <IconBtn2 onClick={redo} disabled={!canRedo} title={L("ทำซ้ำ", "Redo", "重做")}><Redo2 size={15} /></IconBtn2>
                  <span className="w-px h-6 bg-line mx-0.5" />
                  <ToolBtn onClick={() => setBuilderOpen(true)} icon={<BarChart3 size={14} />} label={L("สร้างกราฟ", "New chart", "建图")} />
                  <ToolBtn onClick={onExport} icon={<Download size={14} />} label="Excel" />
                  <ToolBtn onClick={onShare} icon={<Share2 size={14} />} label={L("แชร์", "Share", "分享")} />
                  <button onClick={onSave} className="h-9 px-3 rounded-xl bg-brand text-white text-sm hover:bg-brandHover inline-flex items-center gap-1.5"><Save size={14} />{L("บันทึก", "Save", "保存")}</button>
                </div>
              </div>

              <p className="text-[11px] text-muted -mt-1">
                {L(
                  `ขอบเขต ${facts.scope.branchesInScope} สาขา (มีขาย ${facts.scope.branchesWithSales}) · เทียบ ${facts.period.days} วันก่อนหน้า · ล่าสุด ${facts.scope.latestOrder ? new Date(facts.scope.latestOrder).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—"} · เฉพาะข้อมูลที่ซิงก์ในเครื่อง`,
                  `Scope ${facts.scope.branchesInScope} branches (${facts.scope.branchesWithSales} selling) · vs ${facts.period.days}d prior · latest ${facts.scope.latestOrder ? new Date(facts.scope.latestOrder).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—"} · local synced data only`,
                  `范围 ${facts.scope.branchesInScope} 门店 · 对比前 ${facts.period.days} 天 · 仅本地同步数据`,
                )}
              </p>

              {drills.length ? (
                <div className="flex flex-wrap items-center gap-1.5 -mt-1">
                  <span className="text-[11px] text-muted">{L("กำลังเจาะ:", "Drilling:", "钻取：")}</span>
                  {drills.map((dr) => (
                    <span key={dr.dim} className="inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-0.5 rounded-full bg-brand/12 text-brand border border-brand/25">
                      {DIM_LABEL[dr.dim][locale]}: <b className="font-semibold">{dr.label}</b>
                      <button onClick={() => setDrills((d) => d.filter((x) => x.dim !== dr.dim))} className="hover:text-danger"><X size={11} /></button>
                    </span>
                  ))}
                  <button onClick={() => setDrills([])} className="text-[11px] text-muted hover:text-danger underline">{L("ล้างทั้งหมด", "Clear all", "全部清除")}</button>
                </div>
              ) : null}

              {view.widgets.some((w) => w.viz === "kpi") ? (
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {view.widgets.filter((w) => w.viz === "kpi").map((w) => (
                    <div key={w.id} className="relative group">
                      <KpiTile label={w.title || widgetMetricLabel(w, locale)} value={fmtWidget(w, data.get(w.id)?.total ?? 0)} delta={w.formula ? null : kpiDelta(w.metric)} variant="ink"
                        spark={(() => { const s = data.get(w.id)?.series; return s && s.length > 2 ? <Sparkline values={s} color="rgba(255,255,255,0.55)" height={28} /> : undefined; })()} />
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconBtn onClick={() => setEditId(editId === w.id ? null : w.id)} ink><Pencil size={12} /></IconBtn>
                        <IconBtn onClick={() => removeWidget(w.id)} ink><Trash2 size={12} /></IconBtn>
                      </div>
                      {editId === w.id ? <EditPanel w={w} branches={branches} locale={locale} L={L} onChange={(p) => patchWidget(w.id, p)} onClose={() => setEditId(null)} /> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid xl:grid-cols-2 gap-4">
                {view.widgets.filter((w) => w.viz !== "kpi").map((w) => (
                  <div key={w.id}
                    className={`relative group transition-all ${w.span === 2 ? "xl:col-span-2" : ""} ${dragOverId === w.id ? "ring-2 ring-brand/50 rounded-2xl" : ""}`}
                    onDragOver={(e) => { if (dragId.current && dragId.current !== w.id) { e.preventDefault(); setDragOverId(w.id); } }}
                    onDragLeave={() => setDragOverId((p) => (p === w.id ? null : p))}
                    onDrop={(e) => { e.preventDefault(); if (dragId.current) reorderChart(dragId.current, w.id); dragId.current = null; setDragOverId(null); }}>
                    <WidgetCard widget={w} data={data.get(w.id)} locale={locale} L={L}
                  onDrill={w.dimension && DRILLABLE.includes(w.dimension) && (w.viz === "bar" || w.viz === "hbar" || w.viz === "donut") ? (k, l) => onDrill(w.dimension as Dimension, k, l) : undefined} />
                    <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button draggable onDragStart={(e) => { dragId.current = w.id; e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
                        title={L("ลากเพื่อย้าย", "Drag to move", "拖动移动")} className="w-6 h-6 rounded-lg grid place-items-center border bg-surface border-line text-muted hover:text-brand hover:border-brand/40 cursor-grab active:cursor-grabbing"><GripVertical size={13} /></button>
                      <IconBtn onClick={() => moveChart(w.id, -1)} title={L("ย้ายขึ้น", "Move up", "上移")}><ArrowUp size={13} /></IconBtn>
                      <IconBtn onClick={() => moveChart(w.id, 1)} title={L("ย้ายลง", "Move down", "下移")}><ArrowDown size={13} /></IconBtn>
                      <IconBtn onClick={() => setSpan(w.id, w.span === 2 ? 1 : 2)} title={w.span === 2 ? L("กว้างครึ่ง", "Half width", "半宽") : L("กว้างเต็มแถว", "Full width", "整行")}>{w.span === 2 ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</IconBtn>
                      <IconBtn onClick={() => setEditId(editId === w.id ? null : w.id)}><Pencil size={13} /></IconBtn>
                      <IconBtn onClick={() => removeWidget(w.id)}><Trash2 size={13} /></IconBtn>
                    </div>
                    {editId === w.id ? <EditPanel w={w} branches={branches} locale={locale} L={L} onChange={(p) => patchWidget(w.id, p)} onClose={() => setEditId(null)} /> : null}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Card className="p-10 h-full grid place-items-center">
              <div>
                <EmptyState icon={<LayoutDashboard size={28} />} title={L("เริ่มคุยกับ AI ด้านขวา", "Start chatting on the right", "右侧开始对话")} body={L("ถามอะไรก็ได้ · หรือลอง:", "Ask anything · or try:", "随便问 · 或试试：")} />
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {EXAMPLES.map((ex) => <button key={ex} onClick={() => void onAsk(ex)} className="text-xs px-3 py-1.5 rounded-full border border-line text-muted hover:text-brand hover:border-brand/40 transition-colors">{ex}</button>)}
                </div>
                <div className="text-center mt-4"><button onClick={() => setBuilderOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand"><BarChart3 size={15} />{L("สร้างกราฟเอง (ไม่ต้องใช้ AI)", "Build a chart yourself", "自己建图")}</button></div>
              </div>
            </Card>
          )}
        </div>

        {/* ── ตัวลากปรับขนาด ── */}
        <div onPointerDown={() => { dragging.current = true; document.body.style.userSelect = "none"; }}
          className="hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center group/handle" title={L("ลากเพื่อปรับขนาด", "Drag to resize", "拖动调整")}>
          <div className="w-1 h-10 rounded-full bg-line group-hover/handle:bg-brand transition-colors flex items-center justify-center"><GripVertical size={12} className="text-muted group-hover/handle:text-brand" /></div>
        </div>

        {/* ── ขวา: แชต (เลื่อนในกรอบตัวเอง) ── */}
        <div className="w-full lg:flex-1 lg:min-w-[300px] flex flex-col rounded-2xl border border-line bg-surface/70 backdrop-blur-sm overflow-hidden lg:h-full min-h-[360px]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line shrink-0">
            <p className="text-sm font-semibold flex items-center gap-1.5"><Sparkles size={15} className="text-brand" />{L("ผู้ช่วย AI", "AI assistant", "AI 助手")}</p>
            {messages.length ? <button onClick={reset} className="text-xs px-2 py-0.5 rounded-full border border-line text-muted hover:text-brand">{L("เริ่มใหม่", "New", "新")}</button> : null}
          </div>

          <div ref={threadRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {!messages.length ? (
              <div className="h-full grid place-items-center text-center px-4">
                <div>
                  <Sparkles size={26} className="text-brand/50 mx-auto mb-2" />
                  <p className="text-sm text-muted">{L("ถามอะไรก็ได้ — ผมจะตอบ ถามกลับ และสร้างแดชบอร์ดให้", "Ask anything — I'll reply, ask back & build dashboards", "随便问")}</p>
                  <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                    {EXAMPLES.map((ex) => <button key={ex} onClick={() => void onAsk(ex)} className="text-[11px] px-2.5 py-1 rounded-full border border-line text-muted hover:text-brand hover:border-brand/40">{ex}</button>)}
                  </div>
                </div>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2"}>
                {m.role === "assistant" ? <span className="w-6 h-6 rounded-full grid place-items-center bg-brand/12 text-brand shrink-0 mt-0.5"><Sparkles size={12} /></span> : null}
                <div className={m.role === "user" ? "max-w-[85%] rounded-2xl rounded-tr-sm bg-brand text-white px-3 py-2 text-sm" : "max-w-[90%]"}>
                  <p className={m.role === "user" ? "" : "text-sm text-ink whitespace-pre-wrap"}>{m.text}</p>
                  {m.role === "assistant" && m.insights?.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {m.insights.map((ins, j) => (
                        <li key={j} className="group/ins flex items-start gap-1.5 text-[12.5px] leading-snug">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${ins.tone === "ok" ? "bg-ok" : ins.tone === "warn" ? "bg-danger" : "bg-brand"}`} />
                          <span className="text-ink flex-1">{ins.text}</span>
                          <button onClick={() => createTaskFromInsight(ins.text, ins.tone)} title={L("สร้างงานติดตามจากข้อนี้", "Create a follow-up task", "创建跟进任务")}
                            className="shrink-0 mt-0.5 opacity-0 group-hover/ins:opacity-100 transition-opacity text-muted hover:text-brand"><ListPlus size={14} /></button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.role === "assistant" && m.suggestions?.length ? (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.suggestions.map((s) => <button key={s} onClick={() => void onAsk(s)} disabled={thinking} className="text-[11px] px-2.5 py-1 rounded-full border border-brand/30 text-brand hover:bg-brand/8 disabled:opacity-50 transition-colors">{s}</button>)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {thinking ? (
              <div className="flex gap-2"><span className="w-6 h-6 rounded-full grid place-items-center bg-brand/12 text-brand shrink-0"><Sparkles size={12} /></span>
                <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-2xl bg-surface2"><Dot /><Dot d={0.15} /><Dot d={0.3} /></span></div>
            ) : null}
          </div>

          <div className="p-2.5 border-t border-line shrink-0">
            <BorderBeam radius={22} width={2} duration={3} active className="block rounded-[22px]">
              <form onSubmit={(e) => { e.preventDefault(); void onAsk(prompt); }} className="flex items-center gap-2 rounded-[22px] bg-surface border border-line pl-3.5 pr-1.5 py-1.5">
                <Sparkles size={16} className="text-brand shrink-0" />
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  placeholder={messages.length ? L("ถามต่อ หรือสั่งแก้แดชบอร์ด…", "Reply or edit…", "继续…") : L("ถามอะไรก็ได้…", "Ask anything…", "随便问…")}
                  className="flex-1 bg-transparent h-9 outline-none text-sm placeholder:text-muted" />
                <button type="submit" disabled={thinking || !prompt.trim()} className="w-9 h-9 rounded-full bg-brand text-white grid place-items-center shrink-0 disabled:opacity-40 hover:bg-brandHover transition-colors">
                  {thinking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </form>
            </BorderBeam>
            <p className="text-[10px] text-muted text-center mt-1.5">
              {source && source !== "local" && source !== "shared"
                ? L(`ขับเคลื่อนด้วย ${srcLabel} · ไม่ส่งข้อมูลยอดขาย/ลูกค้า`, `Powered by ${srcLabel}`, `由 ${srcLabel} 驱动`)
                : L("AI ในเครื่อง · ตั้งคีย์ใน .env.local เพื่อสนทนาฉลาดขึ้น", "On-device AI", "本地 AI")}
            </p>
          </div>
        </div>
      </div>

      <ChartBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} onAdd={addFromBuilder}
        rows={rows} prevRows={prevRows} ctx={ctx} branches={branches} facts={facts} locale={locale} L={L} />

      <TaskDrawer open={tasksOpen} onClose={() => setTasksOpen(false)} branches={branches} tasks={tasks} onChange={setTasks} locale={locale} L={L} />

      <StockDrawer open={stockOpen} onClose={() => setStockOpen(false)} analysis={stockAnalysis} locale={locale} L={L} onRestock={onRestock} />
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) { return <i className="w-1.5 h-1.5 rounded-full bg-brand/60" style={{ animation: "shd-typ 1.2s infinite", animationDelay: `${d}s` }} />; }
function ToolBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className="h-9 px-2.5 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand inline-flex items-center gap-1.5">{icon}<span className="hidden sm:inline">{label}</span></button>;
}
function IconBtn2({ onClick, disabled, title, children }: { onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} title={title} className="h-9 w-9 rounded-xl border border-line grid place-items-center hover:bg-surface2 hover:text-brand disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-current">{children}</button>;
}
function IconBtn({ children, onClick, ink, title }: { children: React.ReactNode; onClick: () => void; ink?: boolean; title?: string }) {
  return <button onClick={onClick} title={title} className={`w-6 h-6 rounded-lg grid place-items-center border transition-colors ${ink ? "bg-brandInk/15 border-brandInk/20 text-brandInk hover:bg-brandInk/25" : "bg-surface border-line text-muted hover:text-brand hover:border-brand/40"}`}>{children}</button>;
}

function EditPanel({ w, branches, locale, L, onChange, onClose }: {
  w: Widget; branches: ReturnType<typeof useAdminScope>["branches"]; locale: "th" | "en" | "zh";
  L: (th: string, en: string, zh: string) => string; onChange: (p: Partial<Widget>) => void; onClose: () => void;
}) {
  const isKpi = !w.dimension;
  return (
    <div className="absolute z-20 top-full mt-1 right-0 w-[min(320px,calc(100vw-3rem))] rounded-2xl border border-line bg-surface shadow-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-muted uppercase tracking-wide">{L("แก้การ์ด", "Edit card", "编辑卡片")}</p><button onClick={onClose} className="text-muted hover:text-ink"><X size={14} /></button></div>
      <input value={w.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={L("ชื่อการ์ด", "Card title", "标题")} className="w-full h-9 px-3 rounded-lg bg-surface2 border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
      <div className="grid grid-cols-2 gap-2">
        <Labeled label={L("ตัววัด", "Metric", "指标")}><Select value={w.metric} onChange={(e) => onChange({ metric: e.target.value as Metric })}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m][locale]}</option>)}</Select></Labeled>
        <Labeled label={L("มิติ", "Dimension", "维度")}><Select value={w.dimension ?? ""} onChange={(e) => { const v = e.target.value; onChange(v ? { dimension: v as Dimension } : { dimension: null, viz: "kpi" }); }}><option value="">{L("รวม (KPI)", "Total (KPI)", "合计")}</option>{DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d][locale]}</option>)}</Select></Labeled>
        {!isKpi ? <Labeled label={L("รูปแบบ", "Chart", "图表")}><Select value={w.viz} onChange={(e) => { const v = e.target.value as Viz; onChange(v === "stacked" ? { viz: v, stackBy: w.stackBy && w.stackBy !== w.dimension ? w.stackBy : defaultStackBy(w.dimension) } : { viz: v }); }}><option value="bar">{L("แท่ง", "Bar", "柱状")}</option><option value="stacked">{L("แท่งซ้อน (มิติซ้อน)", "Stacked bar", "堆叠柱")}</option><option value="hbar">{L("แท่งแนวนอน", "H-Bar", "横向")}</option><option value="donut">{L("โดนัท", "Donut", "环形")}</option><option value="line">{L("เส้น", "Line", "折线")}</option><option value="scatter">{L("กระจาย (x×y)", "Scatter", "散点")}</option><option value="waterfall">{L("Waterfall (ปัจจัยเปลี่ยนแปลง)", "Waterfall", "瀑布图")}</option><option value="heatmap">{L("ฮีตแมป (วัน×ชม.)", "Heatmap", "热力图")}</option><option value="table">{L("ตาราง", "Table", "表格")}</option></Select></Labeled> : null}
        {w.viz === "stacked" ? <Labeled label={L("แยกตาม (ซ้อน)", "Stack by", "堆叠维度")}><Select value={w.stackBy ?? ""} onChange={(e) => onChange({ stackBy: (e.target.value || null) as Dimension | null })}>{STACK_DIMS.filter((d) => d !== w.dimension).map((d) => <option key={d} value={d}>{DIM_LABEL[d][locale]}</option>)}</Select></Labeled> : null}
        {w.viz === "scatter" ? <Labeled label={L("แกน Y (ตัววัด)", "Y axis", "Y轴")}><Select value={w.metricY ?? "gp_pct"} onChange={(e) => onChange({ metricY: e.target.value as Metric })}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m][locale]}</option>)}</Select></Labeled> : null}
        {!isKpi && w.viz !== "heatmap" && w.viz !== "scatter" ? <Labeled label={L("จำกัดอันดับ", "Top-N", "前N")}><Select value={String(w.limit ?? 0)} onChange={(e) => onChange({ limit: Number(e.target.value) || undefined })}><option value="0">{L("ทั้งหมด", "All", "全部")}</option>{[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Labeled> : null}
        {w.dimension === "day" && (w.viz === "line" || w.viz === "bar") ? <Labeled label={L("แปลงอนุกรม", "Transform", "变换")}><Select value={w.transform ?? "none"} onChange={(e) => onChange({ transform: e.target.value as Transform })}><option value="none">{L("ไม่แปลง", "None", "无")}</option><option value="cumulative">{L("สะสม", "Cumulative", "累计")}</option><option value="ma7">{L("เฉลี่ยเคลื่อนที่ 7", "Moving avg 7", "移动均7")}</option></Select></Labeled> : null}
        <Labeled label={L("ฟิลเตอร์สาขา", "Branch filter", "门店筛选")}><Select value={w.branchId ?? ""} onChange={(e) => onChange({ branchId: e.target.value || null })}><option value="">{L("ทุกสาขา", "All branches", "全部门店")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}</Select></Labeled>
      </div>
      {w.formula ? (
        <div className="flex items-center gap-1.5 text-[11px] rounded-lg bg-brand/8 border border-brand/20 px-2 py-1.5">
          <span className="text-brand font-mono truncate flex-1" title={w.formula.expr}>ƒ {w.formula.name}: {w.formula.expr}</span>
          <button onClick={() => onChange({ formula: null })} className="text-muted hover:text-danger shrink-0">{L("ล้างสูตร", "Clear", "清除")}</button>
        </div>
      ) : null}
      {w.viz !== "heatmap" ? <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={!!w.compare} onChange={(e) => onChange({ compare: e.target.checked })} className="accent-brand" />{L("เทียบช่วงก่อนหน้า", "Compare prev period", "对比上期")}</label> : null}
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) { return <div><label className="block text-[10px] font-medium text-muted mb-1">{label}</label>{children}</div>; }
function normalize(w: Widget): Widget { if (!w.dimension) return { ...w, viz: "kpi", dimension: null }; if (w.viz === "kpi") return { ...w, viz: "bar" }; return w; }

function WidgetCard({ widget: w, data, locale, L, onDrill }: { widget: Widget; data?: WidgetData; locale: "th" | "en" | "zh"; L: (th: string, en: string, zh: string) => string; onDrill?: (key: string, label: string) => void }) {
  const mL = widgetMetricLabel(w, locale);
  const dp = w.compare && data && data.totalPrev != null && data.totalPrev !== 0 ? Math.round(((data.total - data.totalPrev) / data.totalPrev) * 1000) / 10 : null;
  return (
    <Card className="p-4">
      <CardHeader title={w.title || mL}
        subtitle={data ? <span>{L("รวม", "Total", "合计")} {fmtWidget(w, data.total)}{dp != null ? <span className={dp >= 0 ? "text-ok" : "text-danger"}> · {dp >= 0 ? "+" : ""}{dp}% {L("เทียบช่วงก่อน", "vs prev", "对比上期")}</span> : null}{onDrill ? <span className="text-brand/70"> · {L("กดเพื่อเจาะ", "tap to drill", "点击钻取")}</span> : null}</span> : undefined} />
      <WidgetBody w={w} data={data} locale={locale} L={L} onDrill={onDrill} />
    </Card>
  );
}
