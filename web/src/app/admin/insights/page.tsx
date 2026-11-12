"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Send, Save, Trash2, LayoutDashboard, Wand2, Bookmark, Pencil, Plus, X, Loader2, Download, Share2, GripVertical } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
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

// ── เข้ารหัสสเปก (ไม่มีข้อมูล) ลง URL สำหรับแชร์ ──
const b64e = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
function viewFromHash(): View | null {
  try {
    const m = (typeof window !== "undefined" ? window.location.hash : "").match(/d=([^&]+)/);
    if (!m) return null;
    const j = JSON.parse(b64d(m[1])) as { n: string; w: Omit<Widget, "id">[] };
    return { id: uid(), name: j.n || "Shared", prompt: "", widgets: j.w.map((w) => ({ ...w, id: uid() })), createdAt: new Date().toISOString() };
  } catch { return null; }
}

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
  const threadRef = useRef<HTMLDivElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  useEffect(() => {
    void listOrders().then(setOrders); void listEmployees().then(setEmployees); setSaved(listViews());
    try { const s = localStorage.getItem("shdpos.ai.split"); if (s) setLeftPct(Math.max(42, Math.min(75, Number(s)))); } catch { /* ignore */ }
    const shared = viewFromHash();
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
        if (d.widgets && d.widgets.length) newView = view ? { ...view, widgets: d.widgets } : { id: uid(), name: q.slice(0, 48), prompt: q, widgets: d.widgets, createdAt: new Date().toISOString() };
      }
    } catch { /* fall back */ }
    if (src === "local" && !reply) {
      const v = parsePrompt(q, locale); newView = v; src = "local";
      reply = L("สร้างแดชบอร์ดให้แล้ว ✨ ลองกดแก้แต่ละการ์ด หรือถามต่อได้เลย", "Built a dashboard ✨", "已生成仪表盘 ✨");
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
  function reset() { setMessages([]); setView(null); setSource(null); setEditId(null); setPrompt(""); if (typeof window !== "undefined" && window.location.hash) history.replaceState(null, "", window.location.pathname); }

  function onShare() {
    if (!view) return;
    const payload = b64e(JSON.stringify({ n: view.name, w: view.widgets.map(({ id, ...r }) => { void id; return r; }) }));
    const url = `${window.location.origin}${window.location.pathname}#d=${payload}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.push({ tone: "ok", title: L("คัดลอกลิงก์แดชบอร์ดแล้ว", "Dashboard link copied", "已复制仪表盘链接") }),
      () => { history.replaceState(null, "", `#d=${payload}`); toast.push({ tone: "info", title: L("ลิงก์อยู่ในแถบที่อยู่แล้ว", "Link is in the address bar", "链接已在地址栏") }); },
    );
  }
  function onExport() {
    if (!view) return;
    exportExcel(view, data, locale);
    toast.push({ tone: "ok", title: L("ดาวน์โหลด Excel แล้ว", "Excel downloaded", "已下载 Excel") });
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
        {saved.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Bookmark size={12} className="text-muted" />
            {saved.map((v) => (
              <span key={v.id} className="group inline-flex items-center gap-1 text-xs pl-2.5 pr-1 py-1 rounded-full bg-surface2 border border-line">
                <button onClick={() => recall(v)} className="hover:text-brand">{v.name}</button>
                <button onClick={() => setSaved(deleteView(v.id))} className="opacity-40 group-hover:opacity-100 hover:text-danger p-0.5"><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        ) : null}
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
                  <ToolBtn onClick={onExport} icon={<Download size={14} />} label="Excel" />
                  <ToolBtn onClick={onShare} icon={<Share2 size={14} />} label={L("แชร์", "Share", "分享")} />
                  <ToolBtn onClick={addWidget} icon={<Plus size={14} />} label={L("การ์ด", "Card", "卡片")} />
                  <button onClick={onSave} className="h-9 px-3 rounded-xl bg-brand text-white text-sm hover:bg-brandHover inline-flex items-center gap-1.5"><Save size={14} />{L("บันทึก", "Save", "保存")}</button>
                </div>
              </div>

              {view.widgets.some((w) => w.viz === "kpi") ? (
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
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

              <div className="grid xl:grid-cols-2 gap-4">
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
            </>
          ) : (
            <Card className="p-10 h-full grid place-items-center">
              <div>
                <EmptyState icon={<LayoutDashboard size={28} />} title={L("เริ่มคุยกับ AI ด้านขวา", "Start chatting on the right", "右侧开始对话")} body={L("ถามอะไรก็ได้ · หรือลอง:", "Ask anything · or try:", "随便问 · 或试试：")} />
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {EXAMPLES.map((ex) => <button key={ex} onClick={() => void onAsk(ex)} className="text-xs px-3 py-1.5 rounded-full border border-line text-muted hover:text-brand hover:border-brand/40 transition-colors">{ex}</button>)}
                </div>
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
    </div>
  );
}

const fmtMetric = (m: Metric, n: number) => (m === "orders" || m === "qty") ? formatInt(n) : formatTHB(n, false);
function Dot({ d = 0 }: { d?: number }) { return <i className="w-1.5 h-1.5 rounded-full bg-brand/60" style={{ animation: "shd-typ 1.2s infinite", animationDelay: `${d}s` }} />; }
function ToolBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className="h-9 px-2.5 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand inline-flex items-center gap-1.5">{icon}<span className="hidden sm:inline">{label}</span></button>;
}
function IconBtn({ children, onClick, ink }: { children: React.ReactNode; onClick: () => void; ink?: boolean }) {
  return <button onClick={onClick} className={`w-6 h-6 rounded-lg grid place-items-center border transition-colors ${ink ? "bg-brandInk/15 border-brandInk/20 text-brandInk hover:bg-brandInk/25" : "bg-surface border-line text-muted hover:text-brand hover:border-brand/40"}`}>{children}</button>;
}

// ── ส่งออก Excel (HTML→.xls, ไม่ต้องลง lib; รองรับไทย) ──
function exportExcel(view: View, dataMap: Map<string, WidgetData>, locale: "th" | "en" | "zh") {
  const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mL = (m: Metric) => METRIC_LABEL[m][locale];
  let h = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>table{border-collapse:collapse;margin-bottom:16px}td,th{border:1px solid #ccc;padding:4px 8px;font-family:sans-serif;font-size:12px}th{background:#7950D8;color:#fff;text-align:left}</style></head><body>`;
  h += `<h2>${esc(view.name)}</h2>`;
  const kpis = view.widgets.filter((w) => w.viz === "kpi");
  if (kpis.length) {
    h += `<table><tr>${kpis.map((w) => `<th>${esc(w.title || mL(w.metric))}</th>`).join("")}</tr><tr>${kpis.map((w) => `<td>${dataMap.get(w.id)?.total ?? 0}</td>`).join("")}</tr></table>`;
  }
  for (const w of view.widgets.filter((w) => w.viz !== "kpi")) {
    const d = dataMap.get(w.id); if (!d) continue;
    h += `<h3>${esc(w.title || mL(w.metric))}</h3><table><tr><th>${esc(L2(locale, "รายการ", "Item", "项目"))}</th><th>${esc(mL(w.metric))}</th><th>${esc(L2(locale, "ชิ้น", "Units", "件"))}</th><th>${esc(L2(locale, "บิล", "Bills", "单"))}</th></tr>`;
    for (const r of d.rows) h += `<tr><td>${esc(r.label)}</td><td>${r.value}</td><td>${r.qty}</td><td>${r.orders}</td></tr>`;
    h += `</table>`;
  }
  h += `</body></html>`;
  const blob = new Blob(["﻿" + h], { type: "application/vnd.ms-excel;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(view.name || "dashboard").replace(/[\\/:*?"<>|]/g, "_")}.xls`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const L2 = (l: "th" | "en" | "zh", th: string, en: string, zh: string) => (l === "th" ? th : l === "zh" ? zh : en);

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
        <tbody>{rows.map((r) => (<tr key={r.key}><Td className="max-w-[200px] truncate">{r.label}</Td><Td align="right" className="tnum font-medium">{fmt(r.value)}</Td><Td align="right" className="tnum text-muted">{formatInt(r.qty)}</Td><Td align="right" className="tnum text-muted">{formatInt(r.orders)}</Td></tr>))}</tbody>
      </Table></div>
    );
  } else {
    body = <InsightBars data={rows.map((r, i) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, value: r.value, highlight: i === 0 }))} config={config} valueFormat={fmt} />;
  }
  return <Card className="p-4"><CardHeader title={w.title || mL} subtitle={data ? `${L("รวม", "Total", "合计")} ${fmt(data.total)}` : undefined} />{body}</Card>;
}
