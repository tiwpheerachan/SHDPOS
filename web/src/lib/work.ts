export type WorkStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";
export interface WorkPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  name?: string;
  photo_url?: string | null;
  role?: string;
}
export interface WorkItem {
  id: string;
  branch_id: string;
  created_by: string;
  assigned_to: string;
  title: string;
  description: string;
  status: WorkStatus;
  priority: "low" | "normal" | "high" | "urgent";
  due_at: string | null;
  source_kind: "manual" | "deferred_sale" | "ow_sale" | "ow_transfer";
  source_id: string | null;
  version: number;
  pinned: boolean;
  assignee?: WorkPerson;
  creator?: WorkPerson;
  created_at: string;
  updated_at: string;
}
export const workStatus: Record<WorkStatus, string> = {
  todo: "รอทำ",
  in_progress: "กำลังทำ",
  blocked: "ติดขัด",
  done: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};
export const workPriority = {
  low: "ต่ำ",
  normal: "ปกติ",
  high: "สูง",
  urgent: "เร่งด่วน",
};
export const personName = (p?: WorkPerson) =>
  p?.name ||
  p?.nickname ||
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
  "ไม่ระบุ";
export const isWorkOpen = (t: WorkItem) =>
  !["done", "cancelled"].includes(t.status);
export function thaiDay(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function monthCells(month: string) {
  const [y, m] = month.split("-").map(Number),
    first = new Date(Date.UTC(y, m - 1, 1)),
    offset = (first.getUTCDay() + 6) % 7,
    count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((count + offset) / 7) * 7 }, (_, i) =>
    i >= offset && i < offset + count
      ? `${month}-${String(i - offset + 1).padStart(2, "0")}`
      : null,
  );
}
export async function workRead(params: Record<string, string> = {}) {
  const r = await fetch("/api/work?" + new URLSearchParams(params), {
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "อ่านงานไม่สำเร็จ");
  return j;
}
export async function workList(params: Record<string, string> = {}) {
  let meta: any = null;
  const items = new Map<string, WorkItem>(),
    seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const j = await workRead(params);
    meta = j;
    for (const i of j.items) items.set(i.id, i);
    if (!j.has_more)
      return { ...j, items: [...items.values()], truncated: false };
    if (!j.next_cursor || seen.has(j.next_cursor))
      throw Error("จุดอ่านงานซ้ำ กรุณาโหลดใหม่");
    seen.add(j.next_cursor);
    params = { ...params, cursor: j.next_cursor };
  }
  return { ...meta, items: [...items.values()], truncated: true };
}
export async function workWrite(body: Record<string, unknown>) {
  const r = await fetch("/api/work", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "บันทึกงานไม่สำเร็จ");
  window.dispatchEvent(new Event("shd:work-changed"));
  return j;
}
