"use client";

// =====================================================================
// Admin → ติดตามลูกค้า / นัดหมาย (follow-up tasks)
//   • มอบหมายพนักงาน, ตั้งวันนัด, บันทึกผลการติดต่อ
//   • กรอง: ค้างอยู่ / เกินกำหนด / วันนี้ / เสร็จแล้ว
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, Plus, Search, Check, Trash2, Phone, User, Loader2,
  AlertTriangle, ClipboardList, FileText, ShieldCheck, PhoneCall, X,
} from "lucide-react";
import { listEmployees } from "@/lib/data/repo";
import { useScopeFilter } from "@/lib/store/scope-filter";
import { useI18n } from "@/lib/i18n/provider";
import type { Employee } from "@/lib/types";
import { Modal, EmptyState } from "@/components/ui";

interface Task {
  id: string;
  customer_id: string;
  assigned_to: string | null;
  kind: string;
  title: string;
  note: string | null;
  due_date: string | null;
  status: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
  customer_name: string;
  customer_phone: string | null;
  assignee_name: string | null;
  branch_id?: string | null;
}
interface CustHit { id: string; name: string; phone: string | null }

// label tuples = [th, en, zh] — rendered via L at point of use
const KIND: Record<string, { label: [string, string, string]; icon: typeof FileText; cls: string }> = {
  follow_up: { label: ["ติดตาม", "Follow-up", "跟进"], icon: ClipboardList, cls: "bg-aqua text-ink" },
  quotation: { label: ["ใบเสนอราคา", "Quotation", "报价单"], icon: FileText, cls: "bg-lavender text-brand" },
  warranty: { label: ["ประกัน", "Warranty", "保修"], icon: ShieldCheck, cls: "bg-mint text-ink" },
  callback: { label: ["โทรกลับ", "Callback", "回电"], icon: PhoneCall, cls: "bg-yellow/70 text-ink" },
  other: { label: ["อื่นๆ", "Other", "其他"], icon: ClipboardList, cls: "bg-surface2 text-muted" },
};
const KIND_OPTS = Object.keys(KIND);

const FILTERS = [
  { v: "open", label: ["ค้างอยู่", "Open", "待办"] },
  { v: "overdue", label: ["เกินกำหนด", "Overdue", "逾期"] },
  { v: "today", label: ["วันนี้", "Today", "今天"] },
  { v: "done", label: ["เสร็จแล้ว", "Done", "已完成"] },
  { v: "all", label: ["ทั้งหมด", "All", "全部"] },
] as const;
type Filter = (typeof FILTERS)[number]["v"];

function fmtDate(iso: string | null, locale: string, L: (th: string, en: string, zh: string) => string): string {
  if (!iso) return L("ไม่กำหนด", "No due date", "未设定");
  const loc = locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US";
  return new Date(iso).toLocaleDateString(loc, { day: "numeric", month: "short", year: "2-digit" });
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function isOverdue(t: Task): boolean {
  return t.status === "open" && !!t.due_date && t.due_date < todayStr();
}

export default function AdminTasksPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("open");
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customer_id: "", customer_name: "", kind: "follow_up", title: "", due_date: "", assigned_to: "", note: "" });
  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<CustHit[]>([]);

  const [doneTask, setDoneTask] = useState<Task | null>(null);
  const [doneResult, setDoneResult] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = filter === "done" ? "done" : filter === "all" ? "all" : "open";
      const j = await fetch(`/api/admin/tasks?status=${statusParam}`).then((r) => r.json());
      setTasks(Array.isArray(j.tasks) ? j.tasks : []);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void listEmployees().then((e) => setEmployees(e.filter((x) => x.status === "active"))); }, []);

  // ค้นหาลูกค้าในฟอร์มสร้าง
  useEffect(() => {
    if (!createOpen || !cq.trim()) { setCHits([]); return; }
    let alive = true;
    const id = setTimeout(async () => {
      const j = await fetch(`/api/admin/customers?q=${encodeURIComponent(cq.trim())}`).then((r) => r.json());
      if (alive) setCHits((j.customers ?? []).slice(0, 8).map((c: CustHit) => ({ id: c.id, name: c.name, phone: c.phone })));
    }, 280);
    return () => { alive = false; clearTimeout(id); };
  }, [cq, createOpen]);

  const { branchId: fBranch } = useScopeFilter();
  const shown = useMemo(() => {
    let list = tasks;
    if (filter === "overdue") list = tasks.filter(isOverdue);
    else if (filter === "today") list = tasks.filter((t) => t.status === "open" && t.due_date === todayStr());
    if (fBranch) list = list.filter((t) => t.branch_id === fBranch);
    return list;
  }, [tasks, filter, fBranch]);

  const counts = useMemo(() => ({
    open: tasks.filter((t) => t.status === "open").length,
    overdue: tasks.filter(isOverdue).length,
  }), [tasks]);

  function openCreate() {
    setForm({ customer_id: "", customer_name: "", kind: "follow_up", title: "", due_date: "", assigned_to: "", note: "" });
    setCq(""); setCHits([]); setCreateOpen(true);
  }

  async function submitCreate() {
    if (!form.customer_id || !form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: form.customer_id, kind: form.kind, title: form.title.trim(),
          due_date: form.due_date || null, assigned_to: form.assigned_to || null, note: form.note.trim() || null,
        }),
      });
      if (res.ok) { setCreateOpen(false); await load(); }
    } finally {
      setSaving(false);
    }
  }

  async function markDone() {
    if (!doneTask) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doneTask.id, status: "done", result: doneResult.trim() || null }),
      });
      if (res.ok) { setDoneTask(null); setDoneResult(""); await load(); }
    } finally {
      setSaving(false);
    }
  }

  async function removeTask(id: string) {
    const res = await fetch(`/api/admin/tasks?id=${id}`, { method: "DELETE" });
    if (res.ok) setTasks((p) => p.filter((t) => t.id !== id));
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><CalendarClock size={22} /> {L("ติดตามลูกค้า", "Customer Follow-ups", "客户跟进")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("งานติดตาม นัดหมาย และบันทึกผลการติดต่อ", "Follow-up tasks, appointments, and contact logs", "跟进任务、预约与联系记录")}</p>
        </div>
        <button onClick={openCreate} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> {L("เพิ่มงานติดตาม", "Add follow-up task", "添加跟进任务")}
        </button>
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`px-3.5 h-8 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
              filter === f.v ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"
            }`}
          >
            {L(f.label[0], f.label[1], f.label[2])}
            {f.v === "overdue" && counts.overdue > 0 && (
              <span className="px-1.5 rounded-full bg-danger text-white text-[10px]">{counts.overdue}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลด…", "Loading…", "加载中…")}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<CalendarClock size={26} />} title={L("ไม่มีงานติดตาม", "No follow-up tasks", "暂无跟进任务")} body={L("กด “เพิ่มงานติดตาม” เพื่อสร้างงานใหม่", "Tap “Add follow-up task” to create one", "点击“添加跟进任务”以新建")} />
      ) : (
        <ul className="space-y-2.5">
          {shown.map((t) => {
            const k = KIND[t.kind] ?? KIND.other;
            const Icon = k.icon;
            const overdue = isOverdue(t);
            const done = t.status === "done";
            return (
              <li key={t.id} className={`flex items-start gap-3 p-3.5 rounded-2xl border bg-surface ${overdue ? "border-danger/40" : "border-line"}`}>
                <span className={`grid place-items-center w-10 h-10 rounded-xl shrink-0 ${k.cls}`}><Icon size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${done ? "line-through text-muted" : ""}`}>{t.title}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${k.cls}`}>{L(k.label[0], k.label[1], k.label[2])}</span>
                    {overdue && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger inline-flex items-center gap-1"><AlertTriangle size={10} />{L("เกินกำหนด", "Overdue", "逾期")}</span>}
                    {done && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ok/15 text-ok">{L("เสร็จแล้ว", "Done", "已完成")}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-muted mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1 font-medium text-ink/80"><User size={12} />{t.customer_name}</span>
                    {t.customer_phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{t.customer_phone}</span>}
                    <span className={`inline-flex items-center gap-1 ${overdue ? "text-danger font-semibold" : ""}`}><CalendarClock size={11} />{fmtDate(t.due_date, locale, L)}</span>
                    {t.assignee_name && <span className="inline-flex items-center gap-1">{L("มอบ", "Assigned", "负责")}: {t.assignee_name}</span>}
                  </div>
                  {t.note && <p className="text-xs text-muted mt-1">{t.note}</p>}
                  {t.result && <p className="text-xs mt-1 text-ok">{L("ผล", "Result", "结果")}: {t.result}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!done && (
                    <button onClick={() => { setDoneTask(t); setDoneResult(""); }}
                      className="h-8 px-3 rounded-lg bg-ok/12 text-ok text-xs font-semibold inline-flex items-center gap-1 hover:bg-ok/20">
                      <Check size={14} /> {L("เสร็จ", "Done", "完成")}
                    </button>
                  )}
                  <button onClick={() => void removeTask(t.id)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-surface2" aria-label={L("ลบ", "Delete", "删除")}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* สร้างงาน */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={L("เพิ่มงานติดตาม", "Add follow-up task", "添加跟进任务")} size="md"
        footer={
          <>
            <button onClick={() => setCreateOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button onClick={() => void submitCreate()} disabled={!form.customer_id || !form.title.trim() || saving}
              className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} {L("บันทึก", "Save", "保存")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {/* ลูกค้า */}
          {form.customer_id ? (
            <div className="flex items-center gap-2 p-2.5 rounded-xl border border-line bg-surface2/50">
              <User size={15} className="text-muted" />
              <span className="flex-1 text-sm font-medium">{form.customer_name}</span>
              <button onClick={() => setForm({ ...form, customer_id: "", customer_name: "" })} className="text-muted hover:text-danger"><X size={15} /></button>
            </div>
          ) : (
            <div className="relative">
              <Search size={15} className="absolute left-3 top-3 text-muted" />
              <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder={L("ค้นหาลูกค้า (ชื่อ/เบอร์)…", "Search customer (name/phone)…", "搜索客户（姓名/电话）…")} autoFocus
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface2/60 border border-line outline-none text-sm focus:border-brand/40" />
              {cHits.length > 0 && (
                <ul className="mt-1 border border-line rounded-xl overflow-hidden divide-y divide-line/60">
                  {cHits.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => { setForm({ ...form, customer_id: c.id, customer_name: c.name }); setCq(""); setCHits([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-center gap-2">
                        <span className="text-sm font-medium flex-1">{c.name}</span>
                        {c.phone && <span className="text-[11px] text-muted">{c.phone}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted">{L("ประเภท", "Type", "类型")}
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
                className="mt-1 w-full h-10 px-2 rounded-xl bg-surface border border-line text-sm text-ink">
                {KIND_OPTS.map((v) => { const lb = (KIND[v] ?? KIND.other).label; return <option key={v} value={v}>{L(lb[0], lb[1], lb[2])}</option>; })}
              </select>
            </label>
            <label className="text-xs text-muted">{L("วันนัด / ครบกำหนด", "Due date", "到期日")}
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="mt-1 w-full h-10 px-2 rounded-xl bg-surface border border-line text-sm text-ink" />
            </label>
          </div>

          <label className="text-xs text-muted block">{L("หัวข้องาน", "Task title", "任务标题")} *
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={L("เช่น โทรติดตามใบเสนอราคากล้องติดรถ", "e.g. Call to follow up on the dash cam quotation", "例如：致电跟进行车记录仪报价")}
              className="mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:border-brand/40" />
          </label>

          <label className="text-xs text-muted block">{L("มอบหมายให้", "Assign to", "指派给")}
            <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              className="mt-1 w-full h-10 px-2 rounded-xl bg-surface border border-line text-sm text-ink">
              <option value="">{L("— ไม่ระบุ —", "— Unassigned —", "— 未指定 —")}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.nickname ?? e.first_name}</option>)}
            </select>
          </label>

          <label className="text-xs text-muted block">{L("รายละเอียด", "Details", "详情")}
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-surface border border-line text-sm outline-none focus:border-brand/40 resize-none" />
          </label>
        </div>
      </Modal>

      {/* ปิดงาน + บันทึกผล */}
      <Modal open={Boolean(doneTask)} onClose={() => setDoneTask(null)} title={L("บันทึกผลการติดต่อ", "Log contact result", "记录联系结果")} size="sm"
        footer={
          <>
            <button onClick={() => setDoneTask(null)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button onClick={() => void markDone()} disabled={saving}
              className="h-10 px-5 rounded-xl bg-ok text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {L("ทำเสร็จ", "Mark done", "标记完成")}
            </button>
          </>
        }
      >
        <p className="text-sm mb-2">{doneTask?.title}</p>
        <textarea value={doneResult} onChange={(e) => setDoneResult(e.target.value)} rows={3} placeholder={L("ผลการติดต่อ (เช่น ลูกค้ายืนยันซื้อ / ขอคิดก่อน / ติดต่อไม่ได้)", "Contact result (e.g. customer confirmed / wants to think / unreachable)", "联系结果（例如：客户确认购买/再考虑/无法联系）")}
          className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-sm outline-none focus:border-brand/40 resize-none" />
      </Modal>
    </div>
  );
}
