"use client";
// =====================================================================
// SHD Workspace — งานของฉัน
//   แท็บ: ปฏิทินขาย (ค่าเริ่มต้น, <SalesExplorer/>) · ภาพรวม · รายการงาน (รายการ/บอร์ด) · ปฏิทินงาน
//   ข้อมูลงานจาก /api/work (รีเฟรช 30 วิ + event "shd:work-changed")
//   ยอดขายทุกจุดใช้นิยามกลาง lib/sales-basis ผ่าน /api/work/sales/explore → ตัวเลขตรงกับปฏิทินขาย
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Pin, Plus, ChevronLeft, ChevronRight, ArrowUpRight, CheckCircle2, Clock3, CalendarDays, LayoutGrid,
  ListTodo, BarChart3, Search, RefreshCw, AlertTriangle, Rows3, Columns3, Flame, Receipt, Users, CircleDot,
} from "lucide-react";
import { Button, Avatar } from "@/components/ui";
import { useSession } from "@/lib/store/session";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";
import { formatTHB } from "@/lib/money";
import { WorkTaskDialog } from "./task-dialog";
import { SalesExplorer } from "./sales-explorer";
import {
  workList, workWrite, workStatus, workPriority, personName, isWorkOpen, thaiDay, monthCells,
  type WorkItem, type WorkStatus,
} from "@/lib/work";

type View = "sales" | "today" | "list" | "calendar";
const today = () => thaiDay(new Date());
const currentMonth = () => today().slice(0, 7);
const dateLabel = (value: string) =>
  new Date(value + "T12:00:00+07:00").toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dueLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : tr("ยังไม่กำหนดเวลา", "No due time", "未设定时间");
const isOverdue = (t: WorkItem) => isWorkOpen(t) && !!t.due_at && Date.parse(t.due_at) < Date.now();
const PRI_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const PRI_TONE: Record<WorkItem["priority"], string> = {
  urgent: "bg-danger/10 text-danger", high: "bg-warn/12 text-warn", normal: "bg-brand/8 text-brand", low: "bg-surface2 text-muted",
};
const STATUS_TONE: Record<WorkStatus, string> = {
  todo: "bg-surface2 text-muted", in_progress: "bg-brand/10 text-brand", blocked: "bg-warn/12 text-warn",
  done: "bg-ok/10 text-ok", cancelled: "bg-surface2 text-muted line-through",
};
const BOARD: WorkStatus[] = ["todo", "in_progress", "blocked", "done"];

export function WorkWorkspace({ admin = false }: { admin?: boolean }) {
  const session = useSession(), sp = useSearchParams(), router = useRouter();
  const L = useL();
  const [view, setView] = useState<View>("sales");
  const [month, setMonth] = useState(currentMonth);
  const [day, setDay] = useState(today);
  const [branch, setBranch] = useState(admin ? "all" : (session.branchId ?? "all"));
  const [scope, setScope] = useState<"mine" | "created" | "team">("mine");
  const [status, setStatus] = useState<"open" | "all" | WorkStatus>("open");
  const [priority, setPriority] = useState<"all" | WorkItem["priority"]>("all");
  const [layout, setLayout] = useState<"rows" | "board">("rows");
  const [q, setQ] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>({ items: [], branches: [], actor: "", can_team: false });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ id?: string } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [todaySales, setTodaySales] = useState<{ sales: number; orders: number; pending: number } | null>(null);
  const scopeRef = useRef(branch);

  async function load() {
    const key = branch;
    try {
      const j = await workList(branch === "all" ? {} : { branch_id: branch });
      if (scopeRef.current !== key) return;
      setData(j);
      setError("");
    } catch (e) {
      if (scopeRef.current === key) setError(e instanceof Error ? e.message : L("อ่านงานไม่สำเร็จ", "Failed to load tasks", "读取任务失败"));
    } finally {
      if (scopeRef.current === key) setLoading(false);
    }
  }
  useEffect(() => {
    scopeRef.current = branch;
    setLoading(true);
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const refresh = () => void load();
    window.addEventListener("shd:work-changed", refresh);
    return () => { scopeRef.current = ""; clearInterval(t); window.removeEventListener("shd:work-changed", refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);
  useEffect(() => { const id = sp.get("task"); if (id) setEdit({ id }); }, [sp]);

  // ยอดขายวันนี้ (การ์ดเชื่อมในภาพรวม) — แหล่งเดียวกับปฏิทินขาย ตัวเลขจึงตรงกัน
  useEffect(() => {
    if (view !== "today") return;
    let alive = true;
    const d = today();
    fetch(`/api/work/sales/explore?from=${d}&to=${d}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (!j) { setTodaySales(null); return; }
        const orders = (j.orders ?? []) as { total: number; branch_id: string }[];
        const inBranch = (b: string) => branch === "all" || b === branch;
        const os = orders.filter((o) => inBranch(o.branch_id));
        setTodaySales({
          sales: os.reduce((s, o) => s + o.total, 0),
          orders: os.length,
          pending: ((j.pending ?? []) as { branch_id: string }[]).filter((p) => inBranch(p.branch_id)).length,
        });
      })
      .catch(() => alive && setTodaySales(null));
    return () => { alive = false; };
  }, [view, branch]);

  // ── คัดกรองงาน ──
  const tasks: WorkItem[] = data.items;
  const filtered = useMemo(() => tasks
    .filter((t) =>
      scope === "team" ||
      (scope === "created" && t.created_by === data.actor && t.assigned_to !== data.actor) ||
      (scope === "mine" && t.assigned_to === data.actor))
    .filter((t) => !q || [t.title, t.description, personName(t.assignee)].some((s) => s.toLowerCase().includes(q.toLowerCase())))
    .filter((t) => priority === "all" || t.priority === priority),
  [tasks, scope, data.actor, q, priority]);
  const open = filtered.filter(isWorkOpen);
  const overdue = open.filter(isOverdue);
  const pins = filtered.filter((t) => t.pinned);
  const done = filtered.filter((t) => t.status === "done");
  const dueToday = open.filter((t) => t.due_at && thaiDay(t.due_at) === today());
  const doneToday = done.filter((t) => thaiDay(t.updated_at) === today());
  const sorted = [...filtered].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    Number(isWorkOpen(b)) - Number(isWorkOpen(a)) ||
    PRI_RANK[a.priority] - PRI_RANK[b.priority] ||
    Date.parse(a.due_at ?? "2100-01-01") - Date.parse(b.due_at ?? "2100-01-01"));
  const rows = sorted.filter((t) => status === "all" || (status === "open" && isWorkOpen(t)) || status === t.status);
  const next = [...open].sort((a, b) => Date.parse(a.due_at ?? "2100-01-01") - Date.parse(b.due_at ?? "2100-01-01")).slice(0, 3);
  const cells = monthCells(month);
  const dayTasks = filtered.filter((t) => thaiDay(t.due_at || t.created_at) === day);
  const countBy = (s: WorkStatus) => filtered.filter((t) => t.status === s).length;
  const workload = useMemo(() => {
    const m = new Map<string, { name: string; photo?: string | null; open: number; over: number }>();
    for (const t of open) {
      const name = personName(t.assignee);
      const cur = m.get(name) ?? { name, photo: t.assignee?.photo_url, open: 0, over: 0 };
      cur.open++; if (isOverdue(t)) cur.over++;
      m.set(name, cur);
    }
    return [...m.values()].sort((a, b) => b.open - a.open).slice(0, 6);
  }, [open]);
  const maxLoad = Math.max(1, ...workload.map((w) => w.open));
  const progress = doneToday.length + open.length ? doneToday.length / (doneToday.length + open.length) : 0;

  function moveMonth(delta: number) {
    const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    setMonth(value); setDay(value + "-01");
  }
  async function pin(t: WorkItem) {
    try { await workWrite({ action: "pin", id: t.id, pinned: !t.pinned }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : L("ปักหมุดไม่สำเร็จ", "Failed to pin", "置顶失败")); }
  }
  async function move(t: WorkItem, to: WorkStatus) {
    if (t.status === to) return;
    setMoving(t.id);
    try {
      await workWrite({ action: "save", id: t.id, version: t.version, patch: { status: to } });
      window.dispatchEvent(new Event("shd:work-changed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : L("เปลี่ยนสถานะไม่สำเร็จ", "Failed to change status", "更改状态失败"));
    } finally { setMoving(null); }
  }
  function closeEdit() {
    setEdit(null);
    if (sp.get("task")) router.replace(admin ? "/admin/work" : "/pos/work");
  }

  // ── แถวงาน ──
  function row(t: WorkItem, compact = false) {
    const over = isOverdue(t);
    return (
      <div key={t.id} className="group flex gap-3 items-center py-3 px-2 -mx-2 rounded-xl hover:bg-surface2/50 border-b border-line/40 last:border-0">
        <button className="min-w-0 flex-1 text-left" onClick={() => setEdit({ id: t.id })}>
          <div className="flex gap-2 items-center">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === "urgent" ? "bg-danger" : t.status === "done" ? "bg-ok" : t.status === "blocked" ? "bg-warn" : "bg-brand/50"}`} />
            <p className={`text-[13px] font-medium truncate group-hover:text-brand ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pl-3.5 text-[10px]">
            <span className={`px-1.5 py-0.5 rounded-md ${STATUS_TONE[t.status]}`}>{workStatus[t.status]}</span>
            {!compact ? <span className={`px-1.5 py-0.5 rounded-md ${PRI_TONE[t.priority]}`}>{workPriority[t.priority]}</span> : null}
            <span className={`flex items-center gap-1 ${over ? "text-danger font-medium" : "text-muted"}`}>
              <Clock3 size={10} />{over ? L("เกินกำหนด · ", "Overdue · ", "已逾期 · ") : ""}{dueLabel(t.due_at)}
            </span>
            {t.source_kind === "deferred_sale" ? <span className="px-1.5 py-0.5 rounded-md bg-warn/10 text-warn">{L("บิลรอปิด", "Pending bill", "待结单据")}</span> : null}
            {t.source_kind === "ow_sale" ? <span className="px-1.5 py-0.5 rounded-md bg-danger/10 text-danger">{L("บิล → JST", "Bill → JST", "单据 → JST")}</span> : null}
            {t.source_kind === "ow_transfer" ? <span className="px-1.5 py-0.5 rounded-md bg-danger/10 text-danger">{L("ใบโอน ↔ JST", "Transfer ↔ JST", "调拨单 ↔ JST")}</span> : null}
          </div>
        </button>
        {!compact ? (
          <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted max-w-[140px]">
            <Avatar name={personName(t.assignee)} src={t.assignee?.photo_url ?? undefined} size={22} />
            <span className="truncate" translate="no">{personName(t.assignee)}</span>
          </span>
        ) : null}
        <button onClick={() => void pin(t)} aria-label={t.pinned ? L("เลิกปักหมุด", "Unpin", "取消置顶") : L("ปักหมุด", "Pin", "置顶")}
          className={`w-8 h-8 rounded-xl grid place-items-center shrink-0 ${t.pinned ? "bg-brand/10 text-brand" : "text-muted opacity-0 group-hover:opacity-100 hover:bg-surface2"}`}>
          <Pin size={13} fill={t.pinned ? "currentColor" : "none"} />
        </button>
      </div>
    );
  }

  const tabs = [
    ["sales", BarChart3, L("ปฏิทินขาย", "Sales calendar", "销售日历")],
    ["today", LayoutGrid, L("ภาพรวม", "Overview", "概览")],
    ["list", ListTodo, L("รายการงาน", "Task list", "任务列表")],
    ["calendar", CalendarDays, L("ปฏิทินงาน", "Task calendar", "任务日历")],
  ] as const;

  return (
    <div className="work-surface min-h-full px-4 py-4 sm:px-6 sm:py-5 space-y-4">
      {/* หัวเรื่อง + แท็บ + ตัวกรอง อยู่แถวเดียว (ประหยัดพื้นที่) */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl sm:text-2xl tracking-tight font-semibold whitespace-nowrap" title={new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>
          {L("งานของฉัน", "My work", "我的工作")}<span className="text-muted/35 font-normal"> / </span>
          <span className="text-muted font-normal text-base sm:text-lg">{view === "sales" ? L("ยอดขายตามสิทธิ์ของคุณ", "Sales within your access", "您权限内的销售额") : L("โฟกัสสิ่งที่ต้องทำ", "Focus on what to do", "专注待办事项")}</span>
        </h1>
        <div className="flex overflow-x-auto max-w-full rounded-2xl bg-surface/65 border border-line/70 p-1 gap-0.5 no-scrollbar">
          {tabs.map(([v, Icon, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`h-8 px-3 flex items-center gap-1.5 rounded-xl text-xs whitespace-nowrap transition ${view === v ? "bg-brand text-brandInk shadow-sm" : "text-muted hover:bg-surface"}`}>
              <Icon size={13} />{label}
              {v === "list" && open.length ? <span className={`ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center ${view === v ? "bg-white/20" : "bg-surface2"}`}>{open.length}</span> : null}
              {v === "today" && overdue.length ? <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-danger" /> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center ml-auto">
          {view !== "sales" ? (
            <>
              <div className="inline-flex rounded-xl bg-surface/70 border border-line p-0.5">
                {(["mine", "created", ...(data.can_team ? ["team"] : [])] as const).map((s) => (
                  <button key={s} onClick={() => setScope(s as "mine" | "created" | "team")}
                    className={`text-[11px] px-2.5 h-7 rounded-lg ${scope === s ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                    {s === "mine" ? L("ของฉัน", "Mine", "我的") : s === "created" ? L("ส่งต่อโดยฉัน", "Assigned by me", "我分派的") : L("ทีมที่ดูแล", "My team", "我管理的团队")}
                  </button>
                ))}
              </div>
              <select aria-label={L("สาขาของงาน", "Task branch", "任务门店")} className="work-field !w-44" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="all">{L("ทุกสาขาที่มีสิทธิ์", "All permitted branches", "所有有权限的门店")}</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {data.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name_th || b.name}</option>)}
              </select>
              <Button size="icon" onClick={() => void load()} aria-label={L("โหลดงานใหม่", "Reload tasks", "重新加载任务")}><RefreshCw size={13} /></Button>
            </>
          ) : null}
          <Button size="sm" variant="primary" onClick={() => setEdit({})}><Plus size={14} />{L("สร้างงาน", "New task", "新建任务")}</Button>
        </div>
      </header>

      {view === "sales" ? (
        <SalesExplorer admin={admin} />
      ) : (
        <>
          {error ? <p role="alert" className="text-xs text-danger bg-danger/5 rounded-xl p-3">{error}</p> : null}
          {data.truncated ? <p className="work-caption text-warn">{L("ยังอ่านงานไม่ครบ กรุณาตรวจข้อมูลก่อนใช้ยอดรวม", "Not all tasks loaded — check data before using totals", "任务尚未全部读取，请核对后再使用合计")}</p> : null}

          {/* ── KPI งาน (คลิกได้) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              [L("งานที่ยังเปิด", "Open tasks", "未完成任务"), open.length, L("รอทำ กำลังทำ และติดขัด", "To do, in progress and blocked", "待办、进行中和受阻"), ListTodo, () => { setView("list"); setStatus("open"); }],
              [L("เกินกำหนด", "Overdue", "已逾期"), overdue.length, L("ต้องตามก่อน", "Follow up first", "需优先跟进"), AlertTriangle, () => { setView("list"); setStatus("open"); }],
              [L("ครบกำหนดวันนี้", "Due today", "今日到期"), dueToday.length, L("ต้องเสร็จภายในวันนี้", "Must finish today", "须今日完成"), Flame, () => { setView("calendar"); setMonth(currentMonth()); setDay(today()); }],
              [L("เสร็จแล้ววันนี้", "Done today", "今日已完成"), doneToday.length, L(`ปักหมุด ${pins.length} งาน`, `${pins.length} pinned`, `置顶 ${pins.length} 项`), CheckCircle2, () => { setView("list"); setStatus("done"); }],
            ] as const).map(([label, value, hint, Icon, go], i) => (
              <button key={label} onClick={go}
                className={`text-left p-4 sm:p-5 rounded-[22px] transition hover:-translate-y-0.5 ${i === 0 ? "bg-brand text-brandInk shadow-sm" : i === 1 && value ? "work-card ring-1 ring-danger/25" : "work-card"}`}>
                <div className="flex items-center justify-between">
                  <p className={`text-[11px] ${i === 0 ? "opacity-70" : "text-muted"}`}>{label}</p>
                  <Icon size={14} className={i === 0 ? "opacity-70" : i === 1 && value ? "text-danger" : "text-muted"} />
                </div>
                <p className={`text-2xl sm:text-[27px] font-semibold tracking-tight mt-2 tnum ${i === 1 && value ? "text-danger" : ""}`}>{loading ? "—" : value}</p>
                <p className={`text-[10px] mt-2 ${i === 0 ? "opacity-60" : "text-muted"}`}>{hint}</p>
              </button>
            ))}
          </div>

          {view === "today" ? (
            <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
              <div className="space-y-4 min-w-0">
                {/* สรุปวันนี้ + ยอดขายวันนี้ (เชื่อมปฏิทินขาย) */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <section className="work-card p-5 flex items-center gap-5">
                    <Ring value={progress} />
                    <div className="min-w-0">
                      <p className="work-caption">{L("ความคืบหน้าวันนี้", "Today's progress", "今日进度")}</p>
                      <p className="text-lg font-semibold mt-0.5">{L(`เสร็จ ${doneToday.length} / ${doneToday.length + open.length} งาน`, `Done ${doneToday.length} / ${doneToday.length + open.length} tasks`, `完成 ${doneToday.length} / ${doneToday.length + open.length} 项`)}</p>
                      <p className="text-[11px] text-muted mt-1">
                        {overdue.length ? <span className="text-danger">{L(`เกินกำหนด ${overdue.length} งาน · `, `${overdue.length} overdue · `, `逾期 ${overdue.length} 项 · `)}</span> : null}
                        {L(`ครบกำหนดวันนี้ ${dueToday.length} งาน`, `${dueToday.length} due today`, `今日到期 ${dueToday.length} 项`)}
                      </p>
                    </div>
                  </section>
                  <button onClick={() => setView("sales")} className="work-card p-5 text-left group hover:ring-1 hover:ring-brand/30 transition">
                    <div className="flex items-center justify-between">
                      <p className="work-caption flex items-center gap-1.5"><Receipt size={12} /> {L("ยอดขายวันนี้", "Today's sales", "今日销售额")}</p>
                      <span className="text-[11px] text-brand flex items-center gap-0.5">{L("ปฏิทินขาย", "Sales calendar", "销售日历")} <ArrowUpRight size={12} className="group-hover:translate-x-0.5 transition" /></span>
                    </div>
                    {todaySales ? (
                      <>
                        <p className="text-2xl font-semibold tnum tracking-tight mt-2">{formatTHB(todaySales.sales)}</p>
                        <p className="text-[11px] text-muted mt-1">
                          {todaySales.orders} {L("บิล", "bills", "单")}{todaySales.pending ? <span className="text-warn"> · {L("รอปิดบิล", "pending", "待结单")} {todaySales.pending}</span> : null}
                          {branch !== "all" ? L(" · สาขาที่เลือก", " · selected branch", " · 所选门店") : L(" · ตามสิทธิ์", " · by access", " · 按权限")}
                        </p>
                      </>
                    ) : <p className="text-sm text-muted mt-3">{L("ไม่มีสิทธิ์ดูยอดขาย หรือยังโหลดไม่ได้", "No access to sales, or not loaded yet", "无权查看销售额或尚未加载")}</p>}
                  </button>
                </div>

                <section className="work-card p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h2 className="text-sm font-semibold">{L("พื้นที่ทำงานวันนี้", "Today's workspace", "今日工作区")}</h2>
                      <p className="work-caption">{L("เรียงจาก ปักหมุด → ความสำคัญ → กำหนดส่ง", "Sorted by pinned → priority → due date", "按 置顶 → 优先级 → 截止时间 排序")}</p>
                    </div>
                    <button className="text-[11px] text-brand" onClick={() => setView("list")}>{L(`ดูทั้งหมด ${open.length} →`, `View all ${open.length} →`, `查看全部 ${open.length} →`)}</button>
                  </div>
                  {loading ? (
                    <div className="space-y-2 py-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-12 rounded-xl bg-surface2/60 animate-pulse" />)}</div>
                  ) : sorted.filter(isWorkOpen).length ? (
                    <>
                      {overdue.length ? <Group label={L("เกินกำหนด", "Overdue", "已逾期")} tone="text-danger" items={overdue.slice(0, 4)} render={(t) => row(t)} /> : null}
                      <Group label={L("ต้องทำ", "To do", "待办")} items={sorted.filter((t) => isWorkOpen(t) && !isOverdue(t)).slice(0, 8)} render={(t) => row(t)} />
                    </>
                  ) : (
                    <div className="py-14 text-center">
                      <CheckCircle2 size={28} className="mx-auto text-ok/50 mb-3" />
                      <p className="text-sm">{L("เคลียร์งานหมดแล้ว", "All caught up", "任务已全部完成")}</p>
                      <p className="work-caption mt-1">{L("สร้างงานใหม่ หรือส่งต่อจากรายการรอปิดบิล", "Create a new task or forward from pending bills", "新建任务，或从待结单据转派")}</p>
                    </div>
                  )}
                </section>
              </div>

              <aside className="space-y-4">
                <div className="bg-brand text-brandInk rounded-[22px] p-5">
                  <p className="text-[10px] uppercase tracking-wider opacity-50">Next up</p>
                  <h2 className="text-lg font-medium mt-1">{L("ลำดับถัดไป", "Up next", "下一步")}</h2>
                  {next.length ? next.map((t) => (
                    <button key={t.id} onClick={() => setEdit({ id: t.id })} className="block text-left w-full mt-5 pb-4 border-b border-white/10 last:border-0 last:pb-0">
                      <p className={`text-[10px] ${isOverdue(t) ? "text-red-200" : "opacity-50"}`}>{isOverdue(t) ? L("เกินกำหนด · ", "Overdue · ", "已逾期 · ") : ""}{dueLabel(t.due_at)}</p>
                      <p className="text-sm font-medium mt-1.5 leading-relaxed">{t.title}</p>
                      <div className="flex gap-2 items-center mt-3">
                        <Avatar name={personName(t.assignee)} src={t.assignee?.photo_url ?? undefined} size={22} />
                        <span className="text-[10px] opacity-60 flex-1 truncate">{personName(t.assignee)}</span>
                        <ArrowUpRight size={13} />
                      </div>
                    </button>
                  )) : <p className="text-xs opacity-50 mt-6">{L("ไม่มีงานใกล้ถึงกำหนด", "No tasks due soon", "暂无即将到期的任务")}</p>}
                </div>
                <div className="work-card p-5">
                  <h2 className="text-xs font-semibold flex items-center gap-1.5"><Users size={13} /> {L("ภาระงานของทีม", "Team workload", "团队工作量")}</h2>
                  <div className="mt-4 space-y-3">
                    {workload.map((w) => (
                      <div key={w.name}>
                        <div className="flex items-center gap-2">
                          <Avatar name={w.name} src={w.photo ?? undefined} size={22} />
                          <span className="text-[11px] truncate flex-1">{w.name}</span>
                          {w.over ? <span className="text-[10px] text-danger">{L(`เกิน ${w.over}`, `${w.over} late`, `逾期 ${w.over}`)}</span> : null}
                          <span className="text-xs tnum text-muted">{w.open}</span>
                        </div>
                        <div className="mt-1.5 ml-[30px] h-1 rounded-full bg-surface2 overflow-hidden">
                          <div className={`h-full rounded-full ${w.over ? "bg-danger/70" : "bg-brand/60"}`} style={{ width: `${(w.open / maxLoad) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                    {!workload.length ? <p className="work-caption">{L("ยังไม่มีงานเปิดในมุมมองนี้", "No open tasks in this view", "此视图暂无未完成任务")}</p> : null}
                  </div>
                </div>
              </aside>
            </div>
          ) : view === "list" ? (
            <section className="work-card p-4 sm:p-5">
              {/* ตัวกรองรายการ */}
              <div className="flex flex-wrap gap-2 mb-3 items-center">
                <div className="relative flex-1 min-w-[180px]">
                  <Search size={13} className="absolute top-1/2 -translate-y-1/2 left-3 text-muted" />
                  <input className="work-field !pl-8 w-full" placeholder={L("ค้นหางานหรือผู้รับผิดชอบ", "Search tasks or assignees", "搜索任务或负责人")} value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <select className="work-field !w-32" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} aria-label={L("กรองความสำคัญ", "Filter priority", "筛选优先级")}>
                  <option value="all">{L("ทุกความสำคัญ", "All priorities", "全部优先级")}</option>
                  {Object.entries(workPriority).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="inline-flex rounded-xl bg-surface2/70 p-0.5">
                  {([["rows", Rows3, L("รายการ", "List", "列表")], ["board", Columns3, L("บอร์ด", "Board", "看板")]] as const).map(([k, Icon, l]) => (
                    <button key={k} onClick={() => setLayout(k)} className={`h-8 px-2.5 rounded-lg text-xs flex items-center gap-1 ${layout === k ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                      <Icon size={13} />{l}
                    </button>
                  ))}
                </div>
              </div>
              {layout === "rows" ? (
                <>
                  <div className="flex gap-1.5 overflow-x-auto pb-3 no-scrollbar">
                    {([["open", L("ยังเปิด", "Open", "未完成"), open.length], ...BOARD.map((s) => [s, workStatus[s], countBy(s)] as const), ["cancelled", workStatus.cancelled, countBy("cancelled")], ["all", L("ทั้งหมด", "All", "全部"), filtered.length]] as const).map(([k, l, n]) => (
                      <button key={k} onClick={() => setStatus(k as typeof status)}
                        className={`shrink-0 h-7 px-3 rounded-full text-[11px] flex items-center gap-1.5 transition ${status === k ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>
                        {l}<span className={`tnum ${status === k ? "opacity-80" : "opacity-60"}`}>{n}</span>
                      </button>
                    ))}
                  </div>
                  {rows.length ? rows.map((t) => row(t)) : <p className="work-caption text-center py-12">{L("ไม่มีงานตามตัวกรองนี้", "No tasks match this filter", "没有符合筛选的任务")}</p>}
                </>
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {BOARD.map((s) => {
                    const col = sorted.filter((t) => t.status === s);
                    return (
                      <div key={s} className="rounded-2xl bg-surface2/45 p-2.5 min-h-[180px]">
                        <div className="flex items-center justify-between px-1 pb-2">
                          <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${STATUS_TONE[s]}`}>{workStatus[s]}</span>
                          <span className="text-[11px] text-muted tnum">{col.length}</span>
                        </div>
                        <div className="space-y-2">
                          {col.slice(0, 30).map((t) => (
                            <div key={t.id} className={`rounded-xl bg-surface border border-line/70 p-3 shadow-sm ${moving === t.id ? "opacity-50" : ""}`}>
                              <button onClick={() => setEdit({ id: t.id })} className="text-left w-full">
                                <p className="text-xs font-medium leading-snug line-clamp-2">{t.title}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                                  <span className={`px-1.5 py-0.5 rounded ${PRI_TONE[t.priority]}`}>{workPriority[t.priority]}</span>
                                  <span className={isOverdue(t) ? "text-danger" : "text-muted"}>{t.due_at ? dueLabel(t.due_at) : ""}</span>
                                </div>
                              </button>
                              <div className="flex items-center gap-1.5 mt-2.5">
                                <Avatar name={personName(t.assignee)} src={t.assignee?.photo_url ?? undefined} size={18} />
                                <span className="text-[10px] text-muted truncate flex-1">{personName(t.assignee)}</span>
                                <select aria-label={L("ย้ายสถานะ", "Move status", "更改状态")} value={t.status} disabled={moving === t.id}
                                  onChange={(e) => void move(t, e.target.value as WorkStatus)}
                                  className="h-6 text-[10px] rounded-md bg-surface2 border-0 px-1 outline-none">
                                  {(Object.keys(workStatus) as WorkStatus[]).map((k) => <option key={k} value={k}>{workStatus[k]}</option>)}
                                </select>
                              </div>
                            </div>
                          ))}
                          {!col.length ? <p className="text-[11px] text-muted text-center py-6">{L("ว่าง", "Empty", "空")}</p> : null}
                          {col.length > 30 ? <p className="text-[10px] text-muted text-center">+{col.length - 30} {L("งาน", "tasks", "项")}</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : (
            <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
              <section className="work-card p-3 sm:p-5">
                <div className="flex flex-wrap justify-between gap-2 items-center mb-5">
                  <div>
                    <h2 className="text-sm font-semibold">{L("ปฏิทินงาน", "Task calendar", "任务日历")}</h2>
                    <p className="work-caption">{new Date(month + "-01T12:00:00+07:00").toLocaleDateString("th-TH", { month: "long", year: "numeric" })} · {L("ตามกำหนดส่ง (ไม่มีกำหนด = วันสร้าง)", "By due date (none = created date)", "按截止日期（无截止 = 创建日期）")}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" aria-label={L("เดือนก่อน", "Previous month", "上个月")} onClick={() => moveMonth(-1)}><ChevronLeft size={14} /></Button>
                    <Button size="sm" onClick={() => { setMonth(currentMonth()); setDay(today()); }}>{L("วันนี้", "Today", "今天")}</Button>
                    <Button size="icon" aria-label={L("เดือนถัดไป", "Next month", "下个月")} onClick={() => moveMonth(1)}><ChevronRight size={14} /></Button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                  {(L("จ.|อ.|พ.|พฤ.|ศ.|ส.|อา.", "Mon|Tue|Wed|Thu|Fri|Sat|Sun", "一|二|三|四|五|六|日")).split("|").map((l) => <p key={l} className="text-center text-[10px] text-muted pb-2">{l}</p>)}
                  {cells.map((date, index) => {
                    if (!date) return <div key={"blank" + index} />;
                    const entries = filtered.filter((t) => thaiDay(t.due_at || t.created_at) === date);
                    const late = entries.filter(isOverdue).length;
                    return (
                      <button key={date} onClick={() => setDay(date)}
                        className={`min-w-0 text-left min-h-[76px] sm:min-h-[104px] rounded-xl p-1.5 sm:p-2 border transition ${day === date ? "border-brand/50 bg-brand/5 shadow-sm" : "border-line/50 hover:border-brand/25 bg-surface/35"}`}>
                        <div className="flex items-center justify-between">
                          <p className={`text-[11px] w-5 h-5 grid place-items-center rounded-full ${date === today() ? "bg-brand text-brandInk" : "text-muted"}`}>{Number(date.slice(-2))}</p>
                          {late ? <span className="w-1.5 h-1.5 rounded-full bg-danger" title={L(`เกินกำหนด ${late}`, `Overdue ${late}`, `逾期 ${late}`)} /> : null}
                        </div>
                        <div className="space-y-1 mt-1.5">
                          {entries.slice(0, 2).map((t) => (
                            <p key={t.id} className={`text-[9px] sm:text-[10px] truncate rounded-md px-1.5 py-1 ${t.status === "done" ? "bg-ok/10 text-ok line-through" : t.priority === "urgent" ? "bg-danger/10 text-danger" : t.status === "blocked" ? "bg-warn/10 text-warn" : "bg-brand/6 text-ink"}`}>{t.title}</p>
                          ))}
                          {entries.length > 2 ? <p className="text-[9px] text-muted pl-1">+{entries.length - 2} {L("งาน", "tasks", "项")}</p> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-4 text-[10px] text-muted">
                  {[["bg-brand/40", L("งาน", "Task", "任务")], ["bg-danger/60", L("เร่งด่วน / เกินกำหนด", "Urgent / overdue", "紧急 / 逾期")], ["bg-warn/60", L("ติดขัด", "Blocked", "受阻")], ["bg-ok/60", L("เสร็จแล้ว", "Done", "已完成")]].map(([c, l]) => (
                    <span key={l} className="flex items-center gap-1"><CircleDot size={10} className={c.replace("bg-", "text-")} />{l}</span>
                  ))}
                </div>
              </section>
              <aside className="work-card p-4 sm:p-5 xl:sticky xl:top-4 self-start">
                <p className="work-caption">{L("วันที่เลือก", "Selected day", "所选日期")}</p>
                <h3 className="text-sm font-semibold mt-0.5">{dateLabel(day)}</h3>
                <p className="text-[11px] text-muted mt-1 mb-3">{L(`${dayTasks.length} งาน · เปิด ${dayTasks.filter(isWorkOpen).length}`, `${dayTasks.length} tasks · ${dayTasks.filter(isWorkOpen).length} open`, `${dayTasks.length} 项 · 未完成 ${dayTasks.filter(isWorkOpen).length}`)}</p>
                {dayTasks.length ? dayTasks.map((t) => row(t, true)) : (
                  <div className="py-10 text-center">
                    <CalendarDays size={22} className="mx-auto text-muted/40" />
                    <p className="work-caption mt-2">{L("ไม่มีงานในวันนี้", "No tasks on this day", "当天没有任务")}</p>
                  </div>
                )}
                <Button size="sm" className="w-full mt-3" onClick={() => setEdit({})}><Plus size={13} />{L("สร้างงาน", "New task", "新建任务")}</Button>
              </aside>
            </div>
          )}
        </>
      )}

      <WorkTaskDialog
        open={!!edit}
        onClose={closeEdit}
        id={edit?.id}
        branchId={branch === "all" ? data.branches[0]?.id : branch}
        branches={data.branches}
        onSaved={() => void load()}
      />
    </div>
  );
}

/** fallback ระหว่างโหลดหน้า /admin/work (page เป็น server component) */
export function WorkLoading() {
  const L = useL();
  return <p className="p-6 text-sm text-muted">{L("กำลังเตรียมพื้นที่ทำงาน…", "Preparing workspace…", "正在准备工作区…")}</p>;
}

function Group({ label, tone, items, render }: { label: string; tone?: string; items: WorkItem[]; render: (t: WorkItem) => React.ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${tone ?? "text-muted"}`}>{label} · {items.length}</p>
      {items.map(render)}
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 26, c = 2 * Math.PI * r, pct = Math.round(value * 100);
  return (
    <div className="relative w-[68px] h-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--c-brand, 121 80 216))" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value)} style={{ transition: "stroke-dashoffset .6s" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tnum">{pct}%</span>
    </div>
  );
}
