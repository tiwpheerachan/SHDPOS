// =====================================================================
// งานติดตามจากบทวิเคราะห์ (Insight → Task) — เก็บใน localStorage ต่อเครื่อง
//   เปลี่ยน "ข้อค้นพบ" ให้เป็น "สิ่งที่ต้องทำ" ติดตามได้ (เปิด/กำลังทำ/เสร็จ)
//   (เฟสถัดไปย้ายขึ้น DB เพื่อมอบหมาย/แชร์ข้ามทีม)
// =====================================================================
export type TaskStatus = "open" | "doing" | "done";
export type TaskPriority = "high" | "med" | "low";

export interface Task {
  id: string;
  title: string;
  note?: string;
  status: TaskStatus;
  priority: TaskPriority;
  branchId?: string | null;
  due?: string | null; // yyyy-mm-dd
  source: "insight" | "manual";
  createdAt: string;
  doneAt?: string | null;
}

const KEY = "shdpos.ai.tasks";
const uid = () => Math.random().toString(36).slice(2, 9);
const PRI_RANK: Record<TaskPriority, number> = { high: 0, med: 1, low: 2 };

function read(): Task[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Task[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function write(all: Task[]) {
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(0, 300))); } catch { /* private mode */ }
}

/** เรียง: ยังไม่เสร็จก่อน → ความสำคัญ → กำหนดส่ง → ใหม่สุด; เสร็จไว้ท้าย */
function sortTasks(a: Task, b: Task): number {
  const ad = a.status === "done" ? 1 : 0, bd = b.status === "done" ? 1 : 0;
  if (ad !== bd) return ad - bd;
  if (a.status === "done") return (b.doneAt || "").localeCompare(a.doneAt || "");
  if (PRI_RANK[a.priority] !== PRI_RANK[b.priority]) return PRI_RANK[a.priority] - PRI_RANK[b.priority];
  if (!!a.due !== !!b.due) return a.due ? -1 : 1; // มีกำหนดส่งมาก่อน
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

export function listTasks(): Task[] {
  return read().sort(sortTasks);
}
export function openCount(): number {
  return read().filter((t) => t.status !== "done").length;
}

/** เพิ่มงานใหม่ (คืนรายการที่เรียงแล้ว) */
export function addTask(input: Partial<Task> & { title: string }): Task[] {
  const t: Task = {
    id: input.id || uid(),
    title: input.title.slice(0, 300),
    note: input.note,
    status: input.status || "open",
    priority: input.priority || "med",
    branchId: input.branchId ?? null,
    due: input.due ?? null,
    source: input.source || "manual",
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
  const all = read();
  all.unshift(t);
  write(all);
  return listTasks();
}

export function updateTask(id: string, patch: Partial<Task>): Task[] {
  write(read().map((t) => (t.id === id ? { ...t, ...patch } : t)));
  return listTasks();
}

/** วนสถานะ เปิด → กำลังทำ → เสร็จ → เปิด */
export function cycleStatus(id: string): Task[] {
  const next: Record<TaskStatus, TaskStatus> = { open: "doing", doing: "done", done: "open" };
  write(read().map((t) => {
    if (t.id !== id) return t;
    const s = next[t.status];
    return { ...t, status: s, doneAt: s === "done" ? new Date().toISOString() : null };
  }));
  return listTasks();
}

export function deleteTask(id: string): Task[] {
  write(read().filter((t) => t.id !== id));
  return listTasks();
}

export function clearDone(): Task[] {
  write(read().filter((t) => t.status !== "done"));
  return listTasks();
}
