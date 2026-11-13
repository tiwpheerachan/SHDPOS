// แม็พสถานะ: TransferStatus (UI/Dexie — Spec 2) ↔ OwStatus (สัญญา OneWarehouse — Spec 1)
import type { TransferStatus } from "@/lib/types";
import type { OwStatus } from "./types";

type Locale = "th" | "en" | "zh";
type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand";

/** UI → สัญญา OneWarehouse (ใช้ตอนต่อ REST จริง) */
export const TO_OW: Record<TransferStatus, OwStatus> = {
  draft: "draft",
  pending_approval: "submitted",
  approved: "reviewed",
  picking: "picklist_created",
  packed: "sn_moved",
  shipped: "shipped",
  in_transit: "in_transit",
  received: "received",
  partial_received: "partial",
  completed: "closed",
  cancelled: "cancelled",
  rejected: "rejected",
};
export const toOwStatus = (s: TransferStatus): OwStatus => TO_OW[s] ?? "draft";

/** ลำดับ lifecycle สำหรับ timeline/stepper */
export const FLOW: TransferStatus[] = [
  "draft", "pending_approval", "approved", "picking", "packed", "shipped", "in_transit", "received", "completed",
];

/** สถานะที่ถือว่า "กำลังดำเนินการ" / "มีปัญหา" / "จบ" สำหรับฟิลเตอร์ */
export const isActive = (s: TransferStatus) => !["completed", "cancelled", "rejected"].includes(s);
export const isIssue = (s: TransferStatus) => ["partial_received", "cancelled", "rejected"].includes(s);
export const isDone = (s: TransferStatus) => s === "completed";

const META: Record<TransferStatus, { tone: Tone; th: string; en: string; zh: string }> = {
  draft: { tone: "neutral", th: "ร่าง", en: "Draft", zh: "草稿" },
  pending_approval: { tone: "warn", th: "รออนุมัติ", en: "Pending approval", zh: "待审批" },
  approved: { tone: "info", th: "อนุมัติแล้ว", en: "Approved", zh: "已批准" },
  picking: { tone: "info", th: "กำลังจัดของ", en: "Picking", zh: "拣货中" },
  packed: { tone: "info", th: "แพ็ค/สแกนออกแล้ว", en: "Packed", zh: "已打包" },
  shipped: { tone: "brand", th: "พร้อมส่ง", en: "Ready to ship", zh: "待发货" },
  in_transit: { tone: "brand", th: "ระหว่างทาง", en: "In transit", zh: "运输中" },
  received: { tone: "ok", th: "รับแล้ว", en: "Received", zh: "已接收" },
  partial_received: { tone: "danger", th: "รับไม่ครบ", en: "Partial", zh: "部分接收" },
  completed: { tone: "ok", th: "เสร็จสิ้น", en: "Completed", zh: "已完成" },
  cancelled: { tone: "neutral", th: "ยกเลิก", en: "Cancelled", zh: "已取消" },
  rejected: { tone: "danger", th: "ปฏิเสธ", en: "Rejected", zh: "已拒绝" },
};
export const statusMeta = (s: TransferStatus, l: Locale): { tone: Tone; label: string } => {
  const m = META[s] ?? META.draft;
  return { tone: m.tone, label: l === "th" ? m.th : l === "zh" ? m.zh : m.en };
};
