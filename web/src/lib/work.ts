import { tr } from "@/lib/i18n/tr";

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
  get todo() { return tr("รอทำ", "To do", "待办"); },
  get in_progress() { return tr("กำลังทำ", "In progress", "进行中"); },
  get blocked() { return tr("ติดขัด", "Blocked", "受阻"); },
  get done() { return tr("เสร็จแล้ว", "Done", "已完成"); },
  get cancelled() { return tr("ยกเลิก", "Cancelled", "已取消"); },
};
export const workPriority = {
  get low() { return tr("ต่ำ", "Low", "低"); },
  get normal() { return tr("ปกติ", "Normal", "普通"); },
  get high() { return tr("สูง", "High", "高"); },
  get urgent() { return tr("เร่งด่วน", "Urgent", "紧急"); },
};
export const personName = (p?: WorkPerson) =>
  p?.name ||
  p?.nickname ||
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
  tr("ไม่ระบุ", "Unassigned", "未指定");
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
  if (!r.ok) throw Error(j.error || tr("อ่านงานไม่สำเร็จ", "Failed to load tasks", "读取任务失败"));
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
      throw Error(tr("จุดอ่านงานซ้ำ กรุณาโหลดใหม่", "Duplicate read cursor — please reload", "读取游标重复，请重新加载"));
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
  if (!r.ok) throw Error(j.error || tr("บันทึกงานไม่สำเร็จ", "Failed to save task", "保存任务失败"));
  window.dispatchEvent(new Event("shd:work-changed"));
  return j;
}
