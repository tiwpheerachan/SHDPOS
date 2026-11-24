// =====================================================================
// OneWarehouse — โหมดตัวจริง (หน้าจอ ↔ เซิร์ฟเวอร์)
//   • ใบที่ต้นทาง+ปลายทางผูกคลัง OW → ทุกคำสั่งไปเซิร์ฟเวอร์ (/api/pos/ow-transfers) ซึ่งยิง OW และ "เป็นเจ้าของสถานะ"
//     หน้าจอได้ใบล่าสุดจากเซิร์ฟเวอร์ แล้วเก็บใน IndexedDB เป็นแคชแสดงผลเท่านั้น (ไม่ผ่านเครื่องยนต์ในเครื่อง)
//   • การผูกสาขาแยก 3 กรณี: ผูกแล้ว → OW · ยืนยันว่ายังไม่ผูก → แบบเดิมของสาขานั้น · อ่านไม่ได้ → หยุดและให้ลองใหม่
//   • ใบที่คลังกลางเปิดเอง ถูกดึงเข้ามาตอนแสดงรายการของสาขาปลายทาง ("รอรับจากคลังกลาง")
// =====================================================================
import type { Transfer } from "@/lib/types";
import {
  createTransfer, approveTransfer, rejectTransfer, scanOutTransfer, dispatchTransfer, receiveTransfer, closeTransferShort,
  listTransfersForBranch, listAllTransfers, importTransferSnapshot,
  type ReceiveLineInput, type ReceiveOpts,
} from "@/lib/data/repo";

type Links = { status: "ok"; configured: boolean; links: Record<string, string>; sale: Record<string, string> } | { status: "error"; message: string };
let linksCache: { at: number; value: Extract<Links, { status: "ok" }> } | null = null;

/** การผูกสาขา↔คลัง OW (แคช 60 วิ เฉพาะเมื่ออ่านสำเร็จ) */
export async function owLinks(force = false): Promise<Links> {
  if (!force && linksCache && Date.now() - linksCache.at < 60_000) return linksCache.value;
  try {
    const r = await fetch("/api/pos/ow-transfers?links=1", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { status: "error", message: j.error ?? `HTTP ${r.status}` };
    const value = { status: "ok" as const, configured: !!j.configured, links: j.links ?? {}, sale: j.sale ?? {} };
    linksCache = { at: Date.now(), value };
    return value;
  } catch {
    return { status: "error", message: "ออฟไลน์" };
  }
}
/** ใบนี้ต้องวิ่งผ่าน OW ไหม — อ่านการตั้งค่าไม่ได้ = โยน error (ห้ามเดาว่า "ไม่ผูก") */
export async function owIsLivePair(from: string, to: string): Promise<boolean> {
  const l = await owLinks();
  if (l.status === "error") throw new Error(`อ่านการตั้งค่าการเชื่อม OneWarehouse ไม่ได้ (${l.message}) — กรุณาลองใหม่/เข้าสู่ระบบอีกครั้ง`);
  return l.configured && !!l.links[from] && !!l.links[to];
}

async function call(method: "GET" | "POST", payload?: Record<string, unknown>, query = ""): Promise<{ transfer: Transfer; warning?: string }> {
  let r: Response;
  try {
    r = await fetch(`/api/pos/ow-transfers${query}`, method === "POST"
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      : { cache: "no-store" });
  } catch {
    throw new Error("เชื่อมเซิร์ฟเวอร์ไม่ได้ — ใบโอนผ่าน OneWarehouse ต้องออนไลน์ (ผลอาจสำเร็จแล้ว ให้โหลดรายการใหม่ก่อนกดซ้ำ)");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OneWarehouse: ${j.error ?? `HTTP ${r.status}`}`);
  return j;
}
/** เก็บใบจากเซิร์ฟเวอร์ลงแคช แล้วแจ้งคำเตือน (ถ้ามี) เป็น error ให้หน้าจอแสดง — ใบยังอยู่ในรายการพร้อมปุ่มดำเนินการต่อ */
async function settle(res: { transfer: Transfer; warning?: string }): Promise<Transfer> {
  if (res.transfer?.id) await importTransferSnapshot({ ...res.transfer, ow_owned: true });
  if (res.warning) throw new Error(`OneWarehouse: ${res.warning}`);
  return res.transfer;
}

// ── คำสั่งที่ UI เรียก (ชื่อเดิมของ adapter) ──────────────────────────────

export async function owCreate(
  from: string, to: string, employeeId: string,
  lines: Parameters<typeof createTransfer>[3], note: string, autoApprove: boolean,
  fromKind: "branch" | "warehouse" = "branch", replacementOf?: Transfer["replacement_of"],
): Promise<Transfer> {
  if (fromKind !== "branch" || !(await owIsLivePair(from, to))) return createTransfer(from, to, employeeId, lines, note, autoApprove, fromKind, replacementOf);
  return settle(await call("POST", {
    action: "create", from_branch_id: from, to_branch_id: to, note, auto_approve: autoApprove,
    lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, serials: l.serials ?? [] })),
  }));
}
export async function owApprove(tr: Transfer, employeeId: string, note?: string): Promise<Transfer> {
  if (!tr.ow_owned) return approveTransfer(tr, employeeId, note);
  return settle(await call("POST", { action: "approve", pos_transfer_id: tr.id, note }));
}
export async function owReject(tr: Transfer, employeeId: string, cancel = false, reason?: string): Promise<Transfer> {
  if (!tr.ow_owned) return rejectTransfer(tr, employeeId, cancel, reason);
  return settle(await call("POST", { action: cancel ? "cancel" : "reject", pos_transfer_id: tr.id, reason: reason ?? "" }));
}
export async function owScanOut(tr: Transfer, employeeId: string, serialsByProduct: Record<string, string[]>): Promise<Transfer> {
  if (!tr.ow_owned) return scanOutTransfer(tr, employeeId, serialsByProduct);
  return settle(await call("POST", { action: "scan-out", pos_transfer_id: tr.id, serials: serialsByProduct }));
}
export async function owDispatch(tr: Transfer, employeeId: string, opts: { carrier?: string | null; tracking?: string | null; shippingCost?: number | null } = {}): Promise<Transfer> {
  if (!tr.ow_owned) return dispatchTransfer(tr, employeeId, opts);
  return settle(await call("POST", { action: "dispatch", pos_transfer_id: tr.id, carrier: opts.carrier ?? null, tracking: opts.tracking ?? null, shippingCost: opts.shippingCost ?? undefined }));
}
export async function owReceive(tr: Transfer, employeeId: string, received: Record<string, ReceiveLineInput>, note?: string, opts?: ReceiveOpts): Promise<Transfer> {
  if (!tr.ow_owned) return receiveTransfer(tr, employeeId, received, note, opts);
  const lines = tr.items.map((it) => {
    const r = received[it.product_id] ?? {};
    return { product_id: it.product_id, serials: r.serials ?? [], damaged: r.damaged ?? [], receivedQty: r.qty ?? 0, damagedQty: r.damagedQty ?? 0 };
  });
  return settle(await call("POST", { action: "scan-in", pos_transfer_id: tr.id, lines }));
}
export async function owCloseShort(tr: Transfer, employeeId: string, note?: string): Promise<Transfer> {
  if (!tr.ow_owned) return closeTransferShort(tr, employeeId, note);
  return settle(await call("POST", { action: "close-short", pos_transfer_id: tr.id, reason: note || "ปิดรับขาดจาก POS" }));
}
/** ดำเนินการต่อเฉพาะส่วนที่ค้าง / ตรวจผลจาก OW (ใช้เมื่อใบติดสถานะการเชื่อม) */
export async function owResume(tr: Transfer): Promise<Transfer> {
  return settle(await call("POST", { action: "resume", pos_transfer_id: tr.id }));
}
/** โหลดใบล่าสุดจากเซิร์ฟเวอร์ (หลัง timeout ก่อนกดซ้ำ) */
export async function owRefresh(tr: Transfer): Promise<Transfer> {
  const r = await call("GET", undefined, `?id=${tr.id}`);
  return settle({ transfer: r.transfer });
}

// ── รายการ: ดึงใบจากเซิร์ฟเวอร์ (รวมใบที่คลังกลางเปิดเอง) แล้วคืนจากแคช ──────────
const lastPull = new Map<string, number>();
export async function owPull(branchId?: string, force = false): Promise<number> {
  const k = branchId ?? "*";
  if (!force && Date.now() - (lastPull.get(k) ?? 0) < 15_000) return 0;
  lastPull.set(k, Date.now());
  const l = await owLinks();
  if (l.status !== "ok" || !l.configured || !Object.keys(l.links).length) return 0;
  try {
    const r = await fetch(`/api/pos/ow-transfers${branchId ? `?branch_id=${branchId}` : ""}`, { cache: "no-store" });
    if (!r.ok) return 0;
    const j = (await r.json()) as { transfers: Transfer[] };
    let n = 0;
    for (const t of j.transfers ?? []) if (t?.id && Array.isArray(t.items) && (await importTransferSnapshot({ ...t, ow_owned: true }))) n++;
    return n;
  } catch { return 0; }
}
export async function owList(branchId: string): Promise<Transfer[]> {
  await owPull(branchId);
  return listTransfersForBranch(branchId);
}
export async function owListAll(): Promise<Transfer[]> {
  await owPull();
  return listAllTransfers();
}
