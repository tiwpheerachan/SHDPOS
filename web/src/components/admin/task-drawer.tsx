"use client";

import { useMemo, useState } from "react";
import { Circle, CircleDot, CheckCircle2, Trash2, Plus, ListTodo, Flag } from "lucide-react";
import { Drawer, Badge, Select } from "@/components/ui";
import { listTasks, addTask, cycleStatus, deleteTask, clearDone, type Task, type TaskPriority, type TaskStatus } from "@/lib/ai/tasks";
import type { Branch } from "@/lib/types";

type LFn = (th: string, en: string, zh: string) => string;
const PRI_TONE: Record<TaskPriority, "danger" | "warn" | "neutral"> = { high: "danger", med: "warn", low: "neutral" };

export function TaskDrawer({ open, onClose, branches, tasks, onChange, locale, L }: {
  open: boolean; onClose: () => void; branches: Branch[];
  tasks: Task[]; onChange: (t: Task[]) => void;
  locale: "th" | "en" | "zh"; L: LFn;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("med");
  const [branchId, setBranchId] = useState("");
  const [due, setDue] = useState("");

  const priLabel = (p: TaskPriority) => (p === "high" ? L("สูง", "High", "高") : p === "med" ? L("กลาง", "Med", "中") : L("ต่ำ", "Low", "低"));
  const branchName = (id?: string | null) => { const b = branches.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : null; };
  const openN = useMemo(() => tasks.filter((t) => t.status !== "done").length, [tasks]);
  const doneN = tasks.length - openN;

  function add() {
    const t = title.trim(); if (!t) return;
    onChange(addTask({ title: t, priority, branchId: branchId || null, due: due || null, source: "manual" }));
    setTitle(""); setDue(""); setBranchId("");
  }
  const StatusIcon = ({ s }: { s: TaskStatus }) => s === "done" ? <CheckCircle2 size={18} className="text-ok" /> : s === "doing" ? <CircleDot size={18} className="text-brand" /> : <Circle size={18} className="text-muted" />;
  const overdue = (t: Task) => t.status !== "done" && t.due && t.due < new Date().toISOString().slice(0, 10);

  return (
    <Drawer open={open} onClose={onClose} width="md"
      title={<span className="flex items-center gap-2"><ListTodo size={17} className="text-brand" />{L("งานติดตาม", "Follow-up tasks", "跟进任务")}</span>}
      badge={<Badge tone="brand">{openN} {L("ค้าง", "open", "待办")}</Badge>}
      subtitle={L("เปลี่ยนข้อค้นพบให้เป็นสิ่งที่ต้องทำ แล้วติดตามจนปิดงาน", "Turn findings into trackable to-dos", "把发现变成可跟踪的待办")}
      footer={doneN ? <button onClick={() => onChange(clearDone())} className="text-xs text-muted hover:text-danger inline-flex items-center gap-1"><Trash2 size={13} />{L(`ล้างงานที่เสร็จแล้ว (${doneN})`, `Clear done (${doneN})`, `清除已完成 (${doneN})`)}</button> : undefined}
    >
      {/* เพิ่มงานเอง */}
      <div className="px-4 py-3 border-b border-line space-y-2 bg-surface2/40">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }}
          placeholder={L("เพิ่มงานใหม่…", "Add a task…", "新增任务…")} className="w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
        <div className="flex flex-wrap gap-2">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="flex-1 min-w-[90px]">
            <option value="high">{L("สำคัญสูง", "High", "高")}</option><option value="med">{L("ปานกลาง", "Medium", "中")}</option><option value="low">{L("ต่ำ", "Low", "低")}</option>
          </Select>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="flex-1 min-w-[120px]">
            <option value="">{L("ไม่ระบุสาขา", "No branch", "不限门店")}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
          </Select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-10 px-2.5 rounded-xl bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          <button onClick={add} disabled={!title.trim()} className="h-10 px-3.5 rounded-xl bg-brand text-white text-sm inline-flex items-center gap-1 disabled:opacity-40 hover:bg-brandHover"><Plus size={15} />{L("เพิ่ม", "Add", "加")}</button>
        </div>
      </div>

      {/* รายการงาน */}
      {!tasks.length ? (
        <div className="grid place-items-center py-16 text-center text-muted px-6">
          <ListTodo size={30} className="mb-2 opacity-50" />
          <p className="text-sm">{L("ยังไม่มีงาน — กด “สร้างงาน” จากบทวิเคราะห์ หรือเพิ่มเองด้านบน", "No tasks yet — create one from an insight or add above", "暂无任务")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-start gap-2.5 px-4 py-3">
              <button onClick={() => onChange(cycleStatus(t.id))} title={L("กดเพื่อเปลี่ยนสถานะ", "Cycle status", "切换状态")} className="mt-0.5 shrink-0"><StatusIcon s={t.status} /></button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm leading-snug ${t.status === "done" ? "line-through text-muted" : "text-ink"}`}>{t.title}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center gap-0.5 text-[10.5px] px-1.5 py-0.5 rounded-full border ${PRI_TONE[t.priority] === "danger" ? "border-danger/30 text-danger bg-danger/8" : PRI_TONE[t.priority] === "warn" ? "border-amber-500/30 text-amber-600 bg-amber-500/8" : "border-line text-muted"}`}><Flag size={9} />{priLabel(t.priority)}</span>
                  {t.status === "doing" ? <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand">{L("กำลังทำ", "In progress", "进行中")}</span> : null}
                  {branchName(t.branchId) ? <span className="text-[10.5px] text-muted">· {branchName(t.branchId)}</span> : null}
                  {t.due ? <span className={`text-[10.5px] ${overdue(t) ? "text-danger font-medium" : "text-muted"}`}>· {L("ครบ", "due", "截")} {t.due}</span> : null}
                  {t.source === "insight" ? <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-brand/8 text-brand">AI</span> : null}
                </div>
              </div>
              <button onClick={() => onChange(deleteTask(t.id))} className="shrink-0 text-muted hover:text-danger p-0.5 mt-0.5"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export { listTasks };
