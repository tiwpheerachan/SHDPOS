"use client";
// =====================================================================
// AI Studio — ให้ AI ออกแบบแดชบอร์ดจากข้อมูลจริงหลายแหล่ง (ยอดขาย/มุมมองตาราง/สต๊อก/ลูกค้า) แล้วปรับต่อได้
//   AI คิดหลายรอบ: ตั้งสมมติฐานหลายมุม → ทดลองคำนวณจริง → ออกแบบ → ตรวจตัวเลข → แก้จนผ่าน (ดูความคืบหน้าสดได้)
//   เข้ามาได้จาก: ?view=<มุมมองตาราง> · ?source=sales|stock|customers · ?dash=<แดชบอร์ดที่บันทึก>
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2, Loader2, Send, Save, Trash2, Database, Table2, Boxes, Users, ReceiptText, Rows3, Sparkles, CheckCircle2, AlertTriangle, Search, FlaskConical, ShieldCheck, Lightbulb, LayoutGrid, Share2, X, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { can } from "@/lib/permissions";
import { useToast } from "@/components/toast-host";
import { useSalesData } from "@/lib/hooks/use-sales-data";
import { useCatalogProducts } from "@/lib/hooks/use-catalog-products";
import { useAdminScope, rangeToDates, EMPTY_FILTER, type AdminFilter, type RangeKey } from "@/components/admin/filters";
import { applySheetView } from "@/components/admin/sales-sheet";
import { applyOrderFilters } from "@/lib/analytics";
import { listCategories, stockAll } from "@/lib/data/repo";
import { salesBills, salesLines, stockDataset, customersDataset, type CustomerRow, type Ref } from "@/lib/ai/studio/datasets";
import { runStudioAgent, type Progress, type Turn } from "@/lib/ai/studio/agent-client";
import { lintDashboard } from "@/lib/ai/studio/lint";
import type { Dataset, StudioDashboard, StudioWidget, Viz } from "@/lib/ai/studio/types";
import { WidgetView } from "@/components/admin/ai-studio/widget-view";
import type { StockLevel } from "@/lib/types";

type SrcKey = "sales_bills" | "sales_lines" | "stock" | "customers";
type SheetView = { id: string; name: string; state: { page?: { filter?: Partial<AdminFilter> & { from?: string; to?: string }; src?: "all" | "pos" | "lark" } } & Record<string, unknown> };
type Saved = { id: string; name: string; mine: boolean; owner: string; shared: boolean; updated_at: string; sources?: Sources };
type Sources = { keys: SrcKey[]; range: RangeKey; viewId?: string | null };
const VIZ_LABEL: Record<Viz, string> = { kpi: "ตัวเลข KPI", line: "เส้น", area: "พื้นที่", bar: "แท่ง", hbar: "แท่งนอน", stacked_bar: "แท่งซ้อน", donut: "วงกลม", table: "ตาราง", heatmap: "แผนที่ความร้อน", scatter: "กระจาย" };
const RANGES: [RangeKey, string][] = [["7d", "7 วัน"], ["30d", "30 วัน"], ["mtd", "เดือนนี้"], ["ytd", "ปีนี้"], ["all", "ทั้งหมด"]];

export default function AiStudioPage() {
  const { locale, L } = useI18n();
  const { employee } = useSession();
  const toast = useToast();
  const scope = useAdminScope();
  const [products] = useCatalogProducts();
  const showCost = !!employee && can(employee, "report.cost");

  // ── แหล่งข้อมูล ──
  const [keys, setKeys] = useState<SrcKey[]>(["sales_bills", "sales_lines"]);
  const [range, setRange] = useState<RangeKey>("30d");
  const [views, setViews] = useState<SheetView[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [savedList, setSavedList] = useState<Saved[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const pendingDash = useRef<{ spec: StudioDashboard; name: string } | null>(null);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const v = u.get("view"), src = u.get("source"), dash = u.get("dash"), rg = u.get("range") as RangeKey | null;
    if (v) setViewId(v);
    if (src === "stock") setKeys(["stock"]); else if (src === "customers") setKeys(["customers"]); else if (src === "sales") setKeys(["sales_bills", "sales_lines"]);
    if (rg) setRange(rg);
    void fetch("/api/admin/report-views?report=sales_sheet", { cache: "no-store" }).then((r) => r.json()).then((j) => setViews(j.views ?? [])).catch(() => {});
    void loadSaved();
    if (dash) void fetch(`/api/admin/ai-dashboards?id=${encodeURIComponent(dash)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!j.dashboard) { toast.push({ tone: "danger", title: j.error ?? L("เปิดแดชบอร์ดไม่ได้", "Can't open dashboard", "无法打开仪表盘") }); return; }
      const s = j.dashboard.sources as Sources | undefined;
      if (s?.keys?.length) setKeys(s.keys); if (s?.range) setRange(s.range); setViewId(s?.viewId ?? null);
      setSavedId(j.dashboard.mine ? j.dashboard.id : null); pendingDash.current = { spec: j.dashboard.spec, name: j.dashboard.name };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSaved = useCallback(async () => { try { const r = await fetch("/api/admin/ai-dashboards", { cache: "no-store" }); const j = await r.json(); setSavedList(j.dashboards ?? []); } catch { /* */ } }, []);

  const view = views.find((v) => v.id === viewId) ?? null;
  // ช่วงวันที่: มุมมองตาราง (ถ้าเลือก) หรือปุ่มช่วง · โหลดยาวสองเท่าเพื่อเทียบช่วงก่อน
  const cur = useMemo(() => {
    const f = view?.state.page?.filter;
    if (view && f) return f.range && f.range !== "custom" ? rangeToDates(f.range) : f.from && f.to ? { from: new Date(f.from), to: new Date(f.to) } : rangeToDates("30d");
    return rangeToDates(range);
  }, [view, range]);
  const isAll = (view?.state.page?.filter?.range ?? range) === "all";
  const prev = useMemo(() => (isAll ? null : { from: new Date(+cur.from - (+cur.to - +cur.from) - 1), to: new Date(+cur.from - 1) }), [cur, isAll]);
  const loadRange = useMemo(() => ({ from: prev ? prev.from : cur.from, to: cur.to }), [cur, prev]);
  const needSales = keys.some((k) => k.startsWith("sales")) || keys.includes("stock");
  const sales = useSalesData(loadRange, { enabled: needSales });
  const [stock, setStock] = useState<StockLevel[] | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [cats, setCats] = useState<{ id: string; name_th: string }[]>([]);
  useEffect(() => { void listCategories().then((c) => setCats(c.map((x) => ({ id: x.id, name_th: x.name_th })))).catch(() => {}); }, []);
  useEffect(() => { if (keys.includes("stock") && !stock) void stockAll().then(setStock).catch(() => setStock([])); }, [keys, stock]);
  useEffect(() => { if (keys.includes("customers") && !customers) void fetch("/api/admin/customers?all=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setCustomers(j.customers ?? [])).catch(() => setCustomers([])); }, [keys, customers]);

  const ref: Ref = useMemo(() => ({
    branches: [...sales.branches, ...scope.branches.filter((b) => !sales.branches.some((x) => x.id === b.id))],
    brands: [...sales.brands, ...scope.brands.filter((b) => !sales.brands.some((x) => x.id === b.id))],
    employees: sales.employees, products, categories: cats,
  }), [sales.branches, sales.brands, sales.employees, scope.branches, scope.brands, products, cats]);

  const datasets: Dataset[] = useMemo(() => {
    const out: Dataset[] = [];
    let orders = sales.orders;
    if (view) {
      const page = view.state.page ?? {};
      if (page.src === "lark") orders = orders.filter((o) => o.source === "lark"); else if (page.src === "pos") orders = orders.filter((o) => o.source !== "lark");
      orders = applyOrderFilters(orders, { ...EMPTY_FILTER, ...(page.filter ?? {}), range: "custom", from: loadRange.from, to: loadRange.to } as AdminFilter, { branches: ref.branches, products: [] });
      orders = applySheetView(orders, view.state, { branches: ref.branches, brands: ref.brands, employees: ref.employees });
    }
    const lbl = view ? ` · มุมมอง “${view.name}”` : "";
    if (keys.includes("sales_bills") && !sales.loading) out.push(salesBills(orders, ref, cur, prev, { cost: showCost, label: `ยอดขายรายบิล${lbl}` }));
    if (keys.includes("sales_lines") && !sales.loading) out.push(salesLines(orders, ref, cur, prev, { cost: showCost }));
    if (keys.includes("stock") && stock) out.push(stockDataset(stock, ref, sales.orders, { cost: showCost }));
    if (keys.includes("customers") && customers) out.push(customersDataset(customers));
    return out;
  }, [keys, sales.orders, sales.loading, view, ref, cur, prev, loadRange, stock, customers, showCost]);
  const ready = datasets.length === keys.length && keys.length > 0;

  // ── แดชบอร์ด + agent ──
  const [dash, setDash] = useState<StudioDashboard | null>(null);
  const [dashName, setDashName] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{ provider: string; queries: number; fixes: number; note?: string } | null>(null);
  const [chat, setChat] = useState("");
  const abort = useRef<AbortController | null>(null);

  // เปิดแดชบอร์ดที่บันทึก: รอข้อมูลพร้อมแล้วตรวจกับข้อมูลสด
  useEffect(() => {
    if (!ready || !pendingDash.current) return;
    const { spec, name } = pendingDash.current; pendingDash.current = null;
    setDash(lintDashboard(spec, datasets).dashboard); setDashName(name);
  }, [ready, datasets]);

  async function ask(text: string, fresh: boolean) {
    if (!ready || busy) return;
    const base: Turn[] = fresh ? [] : turns;
    const prompt = fresh
      ? `${text.trim() || L("ออกแบบแดชบอร์ดที่ช่วยตัดสินใจได้ดีที่สุดจากข้อมูลชุดนี้", "Design the most decision-useful dashboard from these datasets", "根据这些数据设计最有助于决策的仪表盘")}${view ? `\n(ข้อมูลมาจากมุมมองตาราง “${view.name}”)` : ""}`
      : `${text}\n\nCurrent dashboard JSON (edit it and resubmit the full dashboard):\n${JSON.stringify(dash).slice(0, 30000)}`;
    setBusy(true); setProgress([]); setChat("");
    abort.current = new AbortController();
    try {
      const r = await runStudioAgent({ datasets, turns: [...base, { role: "user", text: prompt }], locale, signal: abort.current.signal, onProgress: (p) => setProgress((x) => [...x, p]) });
      setDash(r.dashboard); setTurns(r.turns); if (fresh || !dashName) setDashName(r.dashboard.title);
      setMeta({ provider: r.provider, queries: r.queries, fixes: r.issues.length, note: r.note });
    } catch (e) { if ((e as Error).name !== "AbortError") toast.push({ tone: "danger", title: L("สร้างแดชบอร์ดไม่สำเร็จ", "Failed", "失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  async function save(asNew = false) {
    if (!dash) return;
    const name = (dashName || dash.title).trim();
    try {
      const r = await fetch("/api/admin/ai-dashboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asNew ? undefined : savedId ?? undefined, name, spec: dash, sources: { keys, range, viewId } satisfies Sources }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      setSavedId(j.id); await loadSaved();
      toast.push({ tone: "ok", title: L(`บันทึก “${name}” แล้ว`, `Saved “${name}”`, `已保存“${name}”`), body: L("เปิดใหม่จะคำนวณจากข้อมูลล่าสุดเสมอ", "Reopening always uses live data", "重新打开时使用最新数据") });
      const u = new URL(window.location.href); u.searchParams.set("dash", j.id); window.history.replaceState(null, "", u.toString());
    } catch (e) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: e instanceof Error ? e.message : String(e) }); }
  }
  async function toggleShare(d: Saved) {
    const full = await fetch(`/api/admin/ai-dashboards?id=${d.id}`).then((r) => r.json());
    if (!full.dashboard) return;
    await fetch("/api/admin/ai-dashboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id, name: d.name, spec: full.dashboard.spec, sources: full.dashboard.sources, shared: !d.shared }) });
    await loadSaved();
  }
  async function remove(d: Saved) { await fetch(`/api/admin/ai-dashboards?id=${d.id}`, { method: "DELETE" }); if (savedId === d.id) setSavedId(null); await loadSaved(); }
  const patchWidget = (id: string, p: Partial<StudioWidget>) => setDash((d) => (d ? lintDashboard({ ...d, widgets: d.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) }, datasets).dashboard : d));
  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);

  if (employee && !can(employee, "report.employee_perf")) return <div className="p-6 text-sm text-muted">{L("ไม่มีสิทธิ์ใช้ผู้ช่วย AI", "No AI access", "无 AI 权限")}</div>;

  const SRC: { key: SrcKey; icon: typeof ReceiptText; label: string; sub: string }[] = [
    { key: "sales_bills", icon: ReceiptText, label: L("ยอดขายรายบิล", "Sales by bill", "按单销售"), sub: "POS + Lark" },
    { key: "sales_lines", icon: Rows3, label: L("ยอดขายรายสินค้า", "Sales by item", "按商品销售"), sub: L("SKU · หมวด · ประเภทการขาย", "SKU · category · sale type", "SKU · 类别") },
    { key: "stock", icon: Boxes, label: L("สต๊อกปัจจุบัน", "Current stock", "当前库存"), sub: L("พอขายกี่วัน · มูลค่า", "Days of stock · value", "可售天数 · 价值") },
    { key: "customers", icon: Users, label: L("ลูกค้า", "Customers", "顾客"), sub: L("กลุ่ม · ยอดสะสม (ไม่มีชื่อ/เบอร์)", "Segments · spend (no PII)", "分群 · 消费（无隐私）") },
  ];
  const P_ICON = { thinking: Sparkles, query: FlaskConical, validate: ShieldCheck, fix: AlertTriangle, done: CheckCircle2, fallback: Lightbulb };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/admin/insights" className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} />{L("ผู้ช่วย AI แบบเดิม", "Classic AI assistant", "经典 AI 助手")}</a>
          <h1 className="text-xl font-bold flex items-center gap-2 mt-0.5"><Wand2 size={20} className="text-brand" />AI Studio · {L("ออกแบบแดชบอร์ดจากข้อมูลจริง", "dashboards from real data", "基于真实数据的仪表盘")}</h1>
          <p className="text-xs text-muted mt-0.5">{L("AI ตั้งสมมติฐานหลายมุม → ทดลองคำนวณจากข้อมูลจริง → ออกแบบ → ตรวจตัวเลขทุกการ์ด · ข้อมูลรายบิลไม่ออกจากเครื่อง (AI ได้แค่ผลรวม)", "AI explores many angles → tests with real numbers → designs → verifies every card · row data stays in your browser", "AI 多角度假设 → 用真实数据验证 → 设计 → 校验每张卡片 · 明细数据不出浏览器")}</p>
        </div>
        {savedList.length ? (
          <details className="relative">
            <summary className="list-none cursor-pointer h-9 px-3 rounded-xl border border-line text-sm inline-flex items-center gap-1.5 hover:bg-surface2"><LayoutGrid size={14} />{L("แดชบอร์ดที่บันทึก", "Saved dashboards", "已保存")} ({savedList.length})</summary>
            <div className="absolute right-0 mt-1 w-80 max-h-[60vh] overflow-auto z-40 bg-surface border border-line rounded-xl shadow-pop p-1.5">
              {savedList.map((d) => (
                <div key={d.id} className="group flex items-center gap-1 rounded-lg hover:bg-surface2">
                  <a href={`/admin/insights/studio?dash=${d.id}`} className="flex-1 min-w-0 px-2.5 py-2">
                    <span className="block text-[13px] font-medium truncate" translate="no">{d.name}</span>
                    <span className="block text-[10.5px] text-muted">{d.mine ? (d.shared ? L("แชร์ให้ทีมแล้ว", "Shared with team", "已共享") : L("ของฉัน", "Mine", "我的")) : `${L("โดย", "by", "作者")} ${d.owner}`}</span>
                  </a>
                  {d.mine ? <>
                    <button title={d.shared ? L("เลิกแชร์", "Unshare", "取消共享") : L("แชร์ให้ทีม", "Share with team", "共享")} onClick={() => void toggleShare(d)} className={`p-1.5 rounded-md ${d.shared ? "text-brand" : "text-muted opacity-0 group-hover:opacity-100"}`}><Share2 size={13} /></button>
                    <button title={L("ลบ", "Delete", "删除")} onClick={() => void remove(d)} className="p-1.5 rounded-md text-muted hover:text-danger opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                  </> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {/* ── 1) แหล่งข้อมูล ── */}
      <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-2"><Database size={15} />{L("1. เลือกข้อมูลที่ให้ AI ใช้ (เลือกได้หลายชุด)", "1. Choose datasets (multiple)", "1. 选择数据（可多选）")}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {SRC.map(({ key, icon: I, label, sub }) => {
            const on = keys.includes(key);
            const ds = datasets.find((d) => d.id === key);
            return (
              <button key={key} onClick={() => setKeys((k) => (on ? k.filter((x) => x !== key) : [...k, key]))} className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "border-brand bg-brand/[0.06]" : "border-line hover:bg-surface2"}`}>
                <span className="flex items-center gap-2 text-[13px] font-medium"><I size={15} className={on ? "text-brand" : "text-muted"} />{label}{on ? <CheckCircle2 size={13} className="ml-auto text-brand" /> : null}</span>
                <span className="block text-[11px] text-muted mt-0.5">{on ? (ds ? L(`${ds.rows.length.toLocaleString()} แถว`, `${ds.rows.length.toLocaleString()} rows`, `${ds.rows.length.toLocaleString()} 行`) : L("กำลังโหลด…", "Loading…", "加载中…")) : sub}</span>
              </button>
            );
          })}
        </div>
        {keys.some((k) => k.startsWith("sales")) ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">{L("ยอดขายจาก:", "Sales from:", "销售来源：")}</span>
            <select value={viewId ?? ""} onChange={(e) => setViewId(e.target.value || null)} className="h-8 rounded-lg border border-line bg-surface px-2 max-w-[260px]">
              <option value="">{L("ทั้งหมดตามช่วงวันที่", "All, by date range", "全部（按日期）")}</option>
              {views.map((v) => <option key={v.id} value={v.id}>{L("มุมมอง: ", "View: ", "视图：")}{v.name}</option>)}
            </select>
            {!view ? RANGES.map(([k, l]) => <button key={k} onClick={() => setRange(k)} className={`h-8 px-2.5 rounded-lg border ${range === k ? "border-brand text-brand bg-brand/[0.06]" : "border-line hover:bg-surface2"}`}>{l}</button>)
              : <span className="inline-flex items-center gap-1 text-muted"><Table2 size={12} />{L("ใช้ช่วงวันที่และตัวกรองของมุมมอง", "Using the view's dates and filters", "使用视图的日期和筛选")}</span>}
            {sales.loading ? <span className="inline-flex items-center gap-1 text-muted"><Loader2 size={12} className="animate-spin" />{L("กำลังโหลดยอดขาย…", "Loading sales…", "加载销售…")}</span> : null}
          </div>
        ) : null}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(goal, true); }}
              placeholder={L("อยากรู้อะไร? เช่น ‘สาขาไหนโตช้า เพราะอะไร’ หรือเว้นว่างให้ AI เลือกมุมที่สำคัญเอง", "What do you want to know? Leave empty to let AI pick", "想了解什么？留空让 AI 决定")}
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-line bg-surface text-sm" />
          </div>
          {busy ? <button onClick={() => abort.current?.abort()} className="h-11 px-4 rounded-xl border border-line text-sm inline-flex items-center gap-2"><X size={15} />{L("หยุด", "Stop", "停止")}</button>
            : <button onClick={() => void ask(goal, true)} disabled={!ready} className="h-11 px-5 rounded-xl bg-brand text-brandInk font-medium text-sm inline-flex items-center gap-2 disabled:opacity-50"><Wand2 size={16} />{dash ? L("ออกแบบใหม่", "Redesign", "重新设计") : L("ให้ AI ออกแบบ", "Design with AI", "AI 设计")}</button>}
        </div>
      </div>

      {/* ── ความคืบหน้าขณะ AI คิด ── */}
      {busy || (progress.length && !dash) ? (
        <div className="rounded-2xl border border-brand/25 bg-brand/[0.03] p-4">
          <p className="text-sm font-semibold flex items-center gap-2 mb-2">{busy ? <Loader2 size={15} className="animate-spin text-brand" /> : null}{L("AI กำลังทำงาน", "AI at work", "AI 工作中")}</p>
          <ol className="space-y-1 text-xs max-h-48 overflow-auto">
            {progress.map((p, i) => { const I = P_ICON[p.kind]; return <li key={i} className={`flex items-start gap-2 ${p.kind === "fix" || p.kind === "fallback" ? "text-warn" : p.kind === "done" ? "text-ok" : "text-muted"}`}><I size={13} className="mt-0.5 shrink-0" />{p.text}</li>; })}
          </ol>
        </div>
      ) : null}

      {/* ── แดชบอร์ด ── */}
      {dash ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={dashName} onChange={(e) => setDashName(e.target.value)} className="flex-1 min-w-[220px] h-10 px-3 rounded-xl border border-transparent hover:border-line focus:border-brand bg-transparent text-lg font-semibold" />
            <button onClick={() => void save()} className="h-9 px-3.5 rounded-xl bg-ink text-surface text-sm inline-flex items-center gap-1.5"><Save size={14} />{savedId ? L("บันทึก", "Save", "保存") : L("บันทึกแดชบอร์ด", "Save dashboard", "保存仪表盘")}</button>
            {savedId ? <button onClick={() => void save(true)} className="h-9 px-3 rounded-xl border border-line text-sm">{L("บันทึกเป็นอันใหม่", "Save as new", "另存为")}</button> : null}
          </div>
          {meta ? <p className="text-[11px] text-muted">{meta.note ? <span className="text-warn">{meta.note} · </span> : null}{L(`ผู้ออกแบบ: ${meta.provider === "anthropic" ? "Claude" : meta.provider === "deepseek" ? "DeepSeek" : "ร่างอัตโนมัติ"} · ทดลองคำนวณ ${meta.queries} ครั้ง · ตัวตรวจแก้อัตโนมัติ ${meta.fixes} จุด`, `Designer: ${meta.provider} · ${meta.queries} probe queries · ${meta.fixes} auto-fixes`, `设计者：${meta.provider} · 试算 ${meta.queries} 次 · 自动修正 ${meta.fixes} 处`)}</p> : null}
          {dash.summary ? <p className="text-sm">{dash.summary}</p> : null}
          {dash.insights?.length ? (
            <div className="grid md:grid-cols-2 gap-2">
              {dash.insights.map((it, i) => (
                <div key={i} className={`rounded-xl border px-3 py-2 text-[13px] ${it.tone === "warn" ? "border-warn/40 bg-warn/[0.06]" : it.tone === "good" ? "border-ok/40 bg-ok/[0.06]" : "border-line bg-surface"}`}>
                  {it.text}{it.evidence ? <span className="block text-[11px] text-muted mt-0.5">{L("หลักฐาน: ", "Evidence: ", "依据：")}{it.evidence}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {dash.widgets.map((w) => (
              <div key={w.id} className={`rounded-2xl border border-line bg-surface p-4 ${w.viz === "kpi" ? "" : w.span === 2 ? "lg:col-span-2" : ""}`}>
                <div className="flex items-start gap-2 mb-2">
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold truncate">{w.title}</p>{w.subtitle ? <p className="text-[11px] text-muted truncate">{w.subtitle}</p> : null}</div>
                  <select value={w.viz} onChange={(e) => patchWidget(w.id, { viz: e.target.value as Viz })} className="h-7 rounded-md border border-line bg-surface text-[11px] px-1" title={L("เปลี่ยนชนิดกราฟ", "Change chart type", "更改图表类型")}>
                    {(Object.keys(VIZ_LABEL) as Viz[]).map((v) => <option key={v} value={v}>{VIZ_LABEL[v]}</option>)}
                  </select>
                  {w.viz !== "kpi" ? <button onClick={() => patchWidget(w.id, { span: w.span === 2 ? 1 : 2 })} className="h-7 px-1.5 rounded-md border border-line text-[11px]" title={L("ขยาย/ย่อความกว้าง", "Toggle width", "切换宽度")}>{w.span === 2 ? "½" : "↔"}</button> : null}
                  <button onClick={() => setDash((d) => (d ? { ...d, widgets: d.widgets.filter((x) => x.id !== w.id) } : d))} className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-danger" title={L("ลบการ์ด", "Remove card", "删除卡片")}><Trash2 size={13} /></button>
                </div>
                <WidgetView w={w} ds={byId.get(w.query.dataset)} />
                {w.note ? <p className="text-[11px] text-muted mt-2">{w.note}</p> : null}
              </div>
            ))}
          </div>
          {/* ── สั่งปรับต่อ ── */}
          <div className="rounded-2xl border border-line bg-surface p-3 space-y-2">
            {dash.questions?.length ? <div className="flex flex-wrap gap-1.5">{dash.questions.map((q) => <button key={q} disabled={busy} onClick={() => void ask(q, false)} className="h-7 px-2.5 rounded-full border border-line text-xs hover:border-brand hover:text-brand disabled:opacity-50">{q}</button>)}</div> : null}
            <div className="flex gap-2">
              <input value={chat} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && chat.trim()) void ask(chat, false); }} disabled={busy}
                placeholder={L("สั่งปรับต่อ เช่น ‘เพิ่มกราฟส่วนลดรายสาขา’ ‘เปลี่ยนเป็นรายเดือน’ ‘ตัดการ์ดที่ไม่จำเป็น’", "Ask for changes, e.g. ‘add discount by branch’", "继续调整，例如“按门店添加折扣”")}
                className="flex-1 h-10 px-3 rounded-xl border border-line bg-surface text-sm" />
              <button disabled={busy || !chat.trim()} onClick={() => void ask(chat, false)} className="h-10 px-4 rounded-xl bg-brand text-brandInk inline-flex items-center gap-1.5 text-sm disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{L("ส่ง", "Send", "发送")}</button>
            </div>
          </div>
        </div>
      ) : !busy ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">
          <Wand2 size={26} className="mx-auto mb-2 text-brand/60" />{ready ? L("พร้อมแล้ว — พิมพ์สิ่งที่อยากรู้ หรือกด ‘ให้ AI ออกแบบ’", "Ready — ask a question or press ‘Design with AI’", "已就绪 — 输入问题或点击“AI 设计”") : L("เลือกข้อมูลแล้วรอโหลดสักครู่…", "Choose datasets and wait for them to load…", "选择数据并等待加载…")}
        </div>
      ) : null}
    </div>
  );
}
