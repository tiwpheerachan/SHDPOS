// =====================================================================
// ใบโอนที่ OneWarehouse เป็นตัวจริง — "เซิร์ฟเวอร์เป็นเจ้าของสถานะ" (IndexedDB ในเครื่อง = แคชแสดงผล)
//   • เซิร์ฟเวอร์สร้าง/ปรับใบรูปแบบ POS (pos_snapshot) เอง จากผลจริงของ OW — ไม่เชื่อสถานะที่เบราว์เซอร์ส่งมา
//   • JST รับ 1 SKU/ใบ → ใบ POS 1 ใบ = ใบ OW หลายใบ (pos_ow_transfer_lines, OW id เป็นรหัสหลัก)
//   • บันทึกผลทุกคำสั่งต่อใบ OW ทันที (last_op) → สำเร็จบางส่วนกู้ต่อได้ (resume) · ยกเลิกติดตามผลรายใบ
//   • link_state (สถานะการเชื่อม) แยกจาก status (สถานะธุรกิจ): ok | creating | partially_created | recovery_required | checking
//   • สต๊อก/SN ที่ checkout ใช้ (stock_levels/serials) ปรับตามผลจริงผ่าน pos_ow_apply_movement (idempotent)
//   • ใบที่คลังกลางเปิดเอง (origin=ow) ดึงเข้ามาเป็น "รอรับจากคลังกลาง" ตามคลังของสาขาปลายทาง
// =====================================================================
import { randomUUID, createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Transfer, TransferItem, TransferStatus, TransferDiscrepancy } from "@/lib/types";
import { owConfig } from "./ow-gateway";
import { owCall, opKey, type OwApiError, type OwResult } from "./ow-write";

export interface OwTransferView {
  id: string; orderNo: string; status: string; version: number; syncState?: string; jstAllocationNo?: string | null;
  fromWarehouseId?: string; toWarehouseId?: string; remark?: string | null;
  lines: { sku: string; qty: number; name?: string; isSerialized?: boolean | null; shippedSerials?: { serialNo: string; at?: string }[]; receivedSerials?: { serialNo: string; at?: string }[] }[];
}
export type OwLineState = { ow_id: string; status: string; version: number; syncState: string | null; jstAllocationNo: string | null; orderNo: string };
export class OwTransferError extends Error {
  constructor(message: string, public status: number, public code: string, public sku?: string) { super(message); }
}
type LinkState = "ok" | "creating" | "partially_created" | "recovery_required" | "checking";
type Rec = {
  pos_transfer_id: string; transfer_no: string; from_branch_id: string | null; to_branch_id: string; from_warehouse_id: string; to_warehouse_id: string;
  status: string; link_state: LinkState; origin: "pos" | "ow"; revision: number; pos_snapshot: Transfer; last_error: string | null;
};
type LineRow = { ow_id: string; pos_transfer_id: string; product_id: string | null; sku: string; qty: number; serialized: boolean | null; state: Partial<OwLineState>; last_op: unknown };

const ORDER = ["draft", "submitted", "reviewed", "picklist_created", "shipped", "sn_moved", "in_transit", "received", "closed"];
const reached = (status: string, target: string) => status !== "void" && ORDER.indexOf(status) >= ORDER.indexOf(target);
const src = () => owConfig().source;
const now = () => new Date().toISOString();
const sb = () => supabaseAdmin();
const toState = (t: OwTransferView): OwLineState => ({ ow_id: t.id, status: t.status, version: t.version, syncState: t.syncState ?? null, jstAllocationNo: t.jstAllocationNo ?? null, orderNo: t.orderNo });
const isTimeout = (r: OwResult<unknown>) => r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504;

function err(e: OwApiError | undefined, status: number, sku?: string): OwTransferError {
  const msg = e?.message || `OneWarehouse ตอบ HTTP ${status}`;
  return new OwTransferError(sku ? `${sku}: ${msg}` : msg, status === 0 ? 504 : status >= 500 ? 502 : status, e?.code ?? `http_${status}`, sku);
}

// ── อ่าน/เขียนสถานะในฐาน ────────────────────────────────────────────────
export async function warehouseLinks(): Promise<Map<string, string>> {
  const { data, error } = await sb().from("pos_warehouse_links").select("warehouse_id,branch_id").eq("source", src());
  if (error) throw new OwTransferError("อ่านการผูกคลังไม่สำเร็จ", 503, "links_read");
  return new Map((data ?? []).map((r) => [r.branch_id as string, r.warehouse_id as string]));
}
async function loadRec(posId: string): Promise<Rec> {
  const { data, error } = await sb().from("pos_ow_transfers").select("*").eq("source", src()).eq("pos_transfer_id", posId).maybeSingle();
  if (error) throw new OwTransferError("อ่านใบโอนไม่สำเร็จ", 503, "copy_read");
  if (!data) throw new OwTransferError("ไม่พบใบโอนใน OneWarehouse", 404, "transfer_not_found");
  return data as Rec;
}
async function loadLines(posId: string): Promise<LineRow[]> {
  const { data, error } = await sb().from("pos_ow_transfer_lines").select("*").eq("source", src()).eq("pos_transfer_id", posId);
  if (error) throw new OwTransferError("อ่านใบ OW ย่อยไม่สำเร็จ", 503, "lines_read");
  return (data ?? []) as LineRow[];
}
/** บันทึกใบ (เพิ่ม revision ทุกครั้ง · กันเขียนทับกันด้วย revision เดิม) */
async function commit(rec: Rec, t: Transfer, link: LinkState, lastError: string | null = null): Promise<Rec> {
  const nextT: Transfer = { ...t, version: (t.version ?? 0) + 1, ow_owned: true, ow_error: lastError, ow_link_state: link };
  const { data, error } = await sb().from("pos_ow_transfers").update({
    pos_snapshot: nextT, status: nextT.status, link_state: link, last_error: lastError, revision: rec.revision + 1, updated_at: now(),
  }).eq("source", src()).eq("pos_transfer_id", rec.pos_transfer_id).eq("revision", rec.revision).select("*").maybeSingle();
  if (error) throw new OwTransferError("บันทึกใบโอนไม่สำเร็จ", 503, "copy_write");
  if (!data) throw new OwTransferError("ใบโอนถูกแก้จากเครื่องอื่นพร้อมกัน กรุณาโหลดใหม่", 409, "transfer_version_conflict");
  return data as Rec;
}
/** แถวครบ (มี pos_transfer_id) = upsert · บางฟิลด์ (สถานะ/คำสั่งล่าสุด) = update แถวที่มีอยู่ */
async function saveLine(row: Partial<LineRow> & { ow_id: string }) {
  const { error } = row.pos_transfer_id
    ? await sb().from("pos_ow_transfer_lines").upsert({ source: src(), ...row, updated_at: now() }, { onConflict: "source,ow_id,sku" })
    : await sb().from("pos_ow_transfer_lines").update({ ...row, updated_at: now() }).eq("source", src()).eq("ow_id", row.ow_id);
  if (error) throw new OwTransferError("บันทึกใบ OW ย่อยไม่สำเร็จ: " + error.message, 503, "lines_write");
}
async function lineOp(ow_id: string, op: string, key: string, r: OwResult<unknown>, state?: OwLineState) {
  await saveLine({ ow_id, last_op: { op, opKey: key, at: now(), ok: r.ok, http: r.status, code: r.error?.code ?? null, message: r.error?.message ?? null }, ...(state ? { state } : {}) });
}
async function read(id: string): Promise<OwTransferView> {
  const r = await owCall<OwTransferView>("GET", `transfers/${encodeURIComponent(id)}`);
  if (!r.ok || !r.data) throw err(r.error, r.status);
  return r.data;
}
/** สรุปสถานะจากใบ OW ย่อยทุกใบ → ฟิลด์ฝั่ง OW ในใบ POS */
function owSummary(lines: LineRow[]): Partial<Transfer> {
  const states = Object.fromEntries(lines.filter((l) => l.state?.ow_id).map((l) => [l.ow_id, l.state as OwLineState]));
  const vals = Object.values(states);
  const jst = [...new Set(vals.map((v) => v.jstAllocationNo).filter(Boolean))].join(", ");
  return {
    ow_ids: Object.fromEntries(lines.map((l) => [l.sku, l.ow_id])),
    ow_state: states,
    sync_state: vals.some((v) => v.syncState === "failed") ? "failed" : vals.length && vals.every((v) => v.syncState === "synced") ? "synced" : "pending",
    jst_allocation_no: jst || null,
  };
}
/** ใบ OW ไม่ซ้ำ (ใบจากคลังกลาง 1 ใบ OW มีหลาย SKU) — ใช้เวลาสั่งงานรายใบ OW */
const uniq = (lines: LineRow[]) => lines.filter((l, i, a) => a.findIndex((x) => x.ow_id === l.ow_id) === i);
/** ใบ OW ของสินค้า (ตาม SKU) */
const owIdOf = (lines: LineRow[], sku: string) => lines.find((l) => l.sku === sku)?.ow_id;

/** เดินขั้น OW พร้อมตรวจว่าถึงขั้นจริง (ไม่ข้าม error แบบเหมารวม) */
async function step(posId: string, id: string, s: "submit" | "review" | "create_picklist"): Promise<OwLineState> {
  const target = s === "submit" ? "submitted" : s === "review" ? "reviewed" : "picklist_created";
  let cur = await read(id);
  if (reached(cur.status, target)) return toState(cur);
  const key = opKey("tf-step", posId, id, s);
  const r = await owCall("POST", `transfers/${encodeURIComponent(id)}/steps/${s}`, { opKey: key, expectedVersion: cur.version });
  cur = await read(id);
  await lineOp(id, `step:${s}`, key, r, toState(cur));
  if (!reached(cur.status, target)) throw r.ok ? new OwTransferError(`ใบ ${cur.orderNo} ยังไม่ถึงขั้น ${target}`, 409, "step_not_reached") : err(r.error, r.status);
  return toState(cur);
}

async function stockMove(key: string, branch: string | null, productId: string | null, onhand: number, quarantine: number, serials: string[], serialStatus: string | null, ref: string) {
  if (!branch || !productId || (!onhand && !quarantine && !serials.length)) return;
  const { error } = await sb().rpc("pos_ow_apply_movement", { p_source: src(), p_key: key, p_branch: branch, p_product: productId, p_onhand: onhand, p_quarantine: quarantine, p_serials: serials, p_serial_status: serialStatus, p_ref: ref });
  if (error) throw new OwTransferError("ปรับสต๊อก/SN ใน POS ไม่สำเร็จ: " + error.message, 503, "stock_apply");
}

// ── ล็อกรายใบ: สองเครื่องสั่งงานใบเดียวกันพร้อมกัน → เครื่องที่สองหยุด "ก่อน" ยิง OW (กันยอด POS ตามหลัง OW) ──
const LOCK_SECONDS = 180;
async function withLock<T>(posId: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const { data, error } = await sb().rpc("pos_ow_transfer_lock", { p_source: src(), p_id: posId, p_token: token, p_seconds: LOCK_SECONDS });
  if (error) throw new OwTransferError("ล็อกใบโอนไม่สำเร็จ", 503, "lock_failed");
  if (!data) throw new OwTransferError("ใบนี้กำลังถูกทำรายการจากอีกเครื่อง — รอสักครู่แล้วโหลดสถานะล่าสุดก่อนทำต่อ", 409, "transfer_busy");
  try { return await fn(); }
  finally { await sb().rpc("pos_ow_transfer_unlock", { p_source: src(), p_id: posId, p_token: token }); }
}
export const owResume = (posId: string) => withLock(posId, () => owResumeImpl(posId));
export const owApproveTransfer = (...a: Parameters<typeof owApproveTransferImpl>) => withLock(a[0], () => owApproveTransferImpl(...a));
export const owCancelTransfer = (...a: Parameters<typeof owCancelTransferImpl>) => withLock(a[0], () => owCancelTransferImpl(...a));
export const owScanOut = (...a: Parameters<typeof owScanOutImpl>) => withLock(a[0], () => owScanOutImpl(...a));
export const owDispatch = (...a: Parameters<typeof owDispatchImpl>) => withLock(a[0], () => owDispatchImpl(...a));
export const owScanIn = (...a: Parameters<typeof owScanInImpl>) => withLock(a[0], () => owScanInImpl(...a));
export const owCloseShort = (...a: Parameters<typeof owCloseShortImpl>) => withLock(a[0], () => owCloseShortImpl(...a));

// ── สร้างใบ ───────────────────────────────────────────────────────────────
export async function owCreateTransfer(actor: string, canApprove: boolean, input: {
  from_branch_id: string; to_branch_id: string; note?: string | null; auto_approve?: boolean;
  lines: { product_id: string; qty: number; serials?: string[] }[];
}): Promise<{ transfer: Transfer; warning?: string }> {
  const links = await warehouseLinks();
  const fromWh = links.get(input.from_branch_id), toWh = links.get(input.to_branch_id);
  if (!fromWh || !toWh) throw new OwTransferError("สาขาต้นทางหรือปลายทางยังไม่ผูกคลัง OneWarehouse", 409, "not_mapped");
  if (input.from_branch_id === input.to_branch_id) throw new OwTransferError("ต้นทางและปลายทางต้องต่างกัน", 400, "validation");
  const ids = [...new Set(input.lines.map((l) => l.product_id))];
  if (ids.length !== input.lines.length) throw new OwTransferError("มีสินค้าซ้ำในใบ — รวมเป็นบรรทัดเดียว", 400, "validation");
  const { data: prods, error } = await sb().from("products").select("id,sku,name_th,track_serial,is_active").in("id", ids);
  if (error || (prods ?? []).length !== ids.length) throw new OwTransferError("ไม่พบสินค้าบางรายการ", 400, "validation");
  const pm = new Map(prods!.map((p) => [p.id, p]));
  const at = now();
  const items: TransferItem[] = input.lines.map((l) => {
    const p = pm.get(l.product_id)!;
    const sns = [...new Set((l.serials ?? []).map((s) => s.trim()).filter(Boolean))];
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new OwTransferError(`${p.sku}: จำนวนต้องเป็นจำนวนเต็ม`, 400, "validation");
    if (sns.length > l.qty) throw new OwTransferError(`${p.sku}: SN มากกว่าจำนวน`, 400, "validation");
    return { product_id: p.id, sku: p.sku, name: p.name_th, qty_requested: l.qty, qty_shipped: 0, qty_received: 0, isSerialized: !!p.track_serial, shippedSerials: sns.map((serialNo) => ({ serialNo, at, by: actor })), receivedSerials: [] };
  });
  const id = randomUUID();
  const no = `TF-${at.slice(2, 10).replace(/-/g, "")}-${createHash("sha1").update(id).digest("hex").slice(0, 4).toUpperCase()}`;
  const approved = !!input.auto_approve && canApprove;
  const t: Transfer = {
    id, transfer_no: no, from_branch_id: input.from_branch_id, to_branch_id: input.to_branch_id, from_kind: "branch",
    status: approved ? "approved" : "pending_approval", items, requested_by: actor, note: input.note ?? null, created_at: at,
    ...(approved ? { approved_by: actor } : {}), version: 0, sync_state: "pending", jst_allocation_no: null, ow_owned: true,
  };
  const ins = await sb().from("pos_ow_transfers").insert({
    source: src(), pos_transfer_id: id, transfer_no: no, from_branch_id: input.from_branch_id, to_branch_id: input.to_branch_id,
    from_warehouse_id: fromWh, to_warehouse_id: toWh, pos_snapshot: { ...t, version: 1 }, status: t.status, link_state: "creating", origin: "pos", updated_by: actor,
  }).select("*").single();
  if (ins.error) throw new OwTransferError("บันทึกใบโอนไม่สำเร็จ", 503, "copy_write");
  return withLock(id, () => ensureOw(ins.data as Rec));
}

/** ทำให้ใบ OW ครบตามสถานะ POS (สร้างที่ขาด + เดินขั้น) — ใช้ทั้งตอนสร้างและ "ดำเนินการต่อ" */
async function ensureOw(rec: Rec): Promise<{ transfer: Transfer; warning?: string }> {
  const t = rec.pos_snapshot;
  const test = (process.env.ONEWAREHOUSE_ENV || "uat") !== "production";
  let lines = await loadLines(rec.pos_transfer_id);
  try {
    for (const it of t.items) {
      if (owIdOf(lines, it.sku)) continue;
      const key = opKey("tf-create", rec.pos_transfer_id, it.sku);
      const r = await owCall<OwTransferView>("POST", "transfers", {
        opKey: key, fromWarehouseId: rec.from_warehouse_id, toWarehouseId: rec.to_warehouse_id,
        lines: [{ sku: it.sku, qty: it.qty_requested }], referenceNo: t.transfer_no, purpose: "stock",
        remark: `POS ${t.transfer_no}${t.note ? ` · ${t.note}` : ""}${test ? " · test" : ""}`.slice(0, 500),
      });
      if (!r.ok || !r.data) {
        const created = lines.length;
        const state: LinkState = isTimeout(r) ? "checking" : created ? "partially_created" : "recovery_required";
        rec = await commit(rec, { ...t, ...owSummary(lines) }, state, `${it.sku}: ${r.error?.message ?? "สร้างไม่สำเร็จ"}`);
        return { transfer: rec.pos_snapshot, warning: state === "checking" ? "OneWarehouse ตอบช้า — กำลังตรวจสอบผล กด \"ดำเนินการต่อ\" เพื่อตรวจ/สร้างส่วนที่ค้าง (ไม่สร้างซ้ำ)" : `สร้างใบ OW ได้ ${created}/${t.items.length} ใบ — ${r.error?.message ?? ""}` };
      }
      await saveLine({ ow_id: r.data.id, pos_transfer_id: rec.pos_transfer_id, product_id: it.product_id, sku: it.sku, qty: it.qty_requested, serialized: !!it.isSerialized, state: toState(r.data), last_op: { op: "create", opKey: key, at: now(), ok: true } });
      lines = await loadLines(rec.pos_transfer_id);
    }
    // OW ยกเลิกได้เฉพาะ draft/submitted/reviewed → อนุมัติใน POS = review เท่านั้น · create_picklist ทำตอนสแกนออก
    const target = t.status === "pending_approval" ? (["submit"] as const) : (["submit", "review"] as const);
    if (["pending_approval", "approved", "picking"].includes(t.status)) for (const l of uniq(lines)) for (const s of target) await step(rec.pos_transfer_id, l.ow_id, s);
    lines = await loadLines(rec.pos_transfer_id);
    rec = await commit(rec, { ...t, ...owSummary(lines) }, "ok");
    return { transfer: rec.pos_snapshot };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "เชื่อม OneWarehouse ไม่สำเร็จ";
    lines = await loadLines(rec.pos_transfer_id).catch(() => lines);
    rec = await commit(rec, { ...t, ...owSummary(lines) }, e instanceof OwTransferError && e.status === 504 ? "checking" : "recovery_required", msg);
    return { transfer: rec.pos_snapshot, warning: msg };
  }
}

/** ดำเนินการต่อเฉพาะส่วนที่ค้าง (สร้างใบที่ขาด/เดินขั้น/รีเฟรชผลจาก OW) — ปลอดภัยเพราะ opKey เดิม */
async function owResumeImpl(posId: string) {
  const rec = await loadRec(posId);
  if (rec.origin === "ow") return { transfer: (await refreshFromOw(rec)).pos_snapshot };
  if (["pending_approval", "approved", "picking"].includes(rec.pos_snapshot.status)) return ensureOw(rec);
  return { transfer: (await refreshFromOw(rec)).pos_snapshot };
}
async function refreshFromOw(rec: Rec): Promise<Rec> {
  const lines = await loadLines(rec.pos_transfer_id);
  for (const l of uniq(lines)) { try { await saveLine({ ow_id: l.ow_id, state: toState(await read(l.ow_id)) }); } catch { /* คงค่าเดิม */ } }
  return commit(rec, { ...rec.pos_snapshot, ...owSummary(await loadLines(rec.pos_transfer_id)) }, "ok");
}

// ── อนุมัติ / ยกเลิก ───────────────────────────────────────────────────────
async function owApproveTransferImpl(posId: string, actor: string, note?: string) {
  const rec = await loadRec(posId);
  if (rec.pos_snapshot.status !== "pending_approval") throw new OwTransferError("ใบนี้ไม่ได้อยู่ในสถานะรออนุมัติ", 409, "transfer_wrong_status");
  const t: Transfer = { ...rec.pos_snapshot, status: "approved", approved_by: actor, approval_note: note || null };
  return ensureOw(await commit(rec, t, "creating"));
}
async function owCancelTransferImpl(posId: string, actor: string, reason: string, reject: boolean) {
  let rec = await loadRec(posId);
  const t = rec.pos_snapshot;
  if (!["draft", "pending_approval", "approved", "picking"].includes(t.status)) throw new OwTransferError("ยกเลิกได้เฉพาะก่อนสแกนออก — หลังส่งให้ใช้ปิดรับ/คืน", 409, "transfer_not_cancellable");
  // OW ยกเลิกได้เฉพาะ draft/submitted/reviewed (picklist แล้วยกเลิกไม่ได้) — แจ้งรายใบที่ยกเลิกไม่ได้ตามจริง
  const lines = await loadLines(posId);
  const failed: string[] = [];
  for (const l of uniq(lines)) {
    const cur = await read(l.ow_id);
    if (cur.status === "void") { await saveLine({ ow_id: l.ow_id, state: toState(cur) }); continue; }
    const key = opKey("tf-cancel", posId, l.ow_id);
    const r = await owCall("POST", `transfers/${encodeURIComponent(l.ow_id)}/cancel`, { opKey: key, expectedVersion: cur.version, reason: (reason || "ยกเลิกจาก POS").slice(0, 300) });
    const after = await read(l.ow_id).catch(() => cur);
    await lineOp(l.ow_id, "cancel", key, r, toState(after));
    if (after.status !== "void") failed.push(`${l.sku}: ${r.error?.message ?? "ยังไม่ถูกยกเลิก"}`);
  }
  const fresh = await loadLines(posId);
  if (failed.length) {
    rec = await commit(rec, { ...t, ...owSummary(fresh) }, "recovery_required", `ยกเลิกใน OW ไม่ครบ: ${failed.join(" · ")}`);
    return { transfer: rec.pos_snapshot, warning: rec.last_error ?? undefined };
  }
  rec = await commit(rec, { ...t, ...owSummary(fresh), status: reject ? "rejected" : "cancelled", approved_by: actor, approval_note: reason || null }, "ok");
  return { transfer: rec.pos_snapshot };
}

// ── สแกนออก / ส่ง ─────────────────────────────────────────────────────────
async function owScanOutImpl(posId: string, actor: string, serialsByProduct: Record<string, string[]>) {
  let rec = await loadRec(posId);
  const t = rec.pos_snapshot;
  if (!["approved", "picking", "packed"].includes(t.status)) throw new OwTransferError("ต้องอนุมัติก่อนสแกนออก", 409, "transfer_wrong_status");
  if (rec.link_state !== "ok") throw new OwTransferError("ใบนี้ยังเชื่อม OW ไม่ครบ — กด \"ดำเนินการต่อ\" ก่อน", 409, "link_not_ready");
  const lines = await loadLines(posId);
  const at = now();
  const all = new Set<string>();
  const items = [...t.items];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const id = owIdOf(lines, it.sku);
    if (!id) throw new OwTransferError(`${it.sku}: ไม่พบใบ OW`, 409, "transfer_not_found", it.sku);
    const sns = it.isSerialized ? [...new Set((serialsByProduct[it.product_id] ?? it.shippedSerials?.map((s) => s.serialNo) ?? []).map((s) => s.trim()).filter(Boolean))] : [];
    if (it.isSerialized) {
      if (sns.length !== it.qty_requested) throw new OwTransferError(`${it.sku}: ต้องสแกน SN ให้ครบ ${it.qty_requested} ชิ้น (ได้ ${sns.length})`, 400, "qty_mismatch", it.sku);
      for (const s of sns) { if (all.has(s)) throw new OwTransferError(`SN ซ้ำ: ${s}`, 400, "serial_duplicate", it.sku); all.add(s); }
    }
    if (!reached((await read(id)).status, "picklist_created")) await step(posId, id, "create_picklist");
    const cur = await read(id);
    if (!reached(cur.status, "shipped")) {
      const body = it.isSerialized ? { serials: sns.map((serialNo) => ({ serialNo, sku: it.sku })) } : { quantities: [{ sku: it.sku, qty: it.qty_requested }] };
      const key = opKey("tf-scanout", posId, id, JSON.stringify(body));
      const r = await owCall("POST", `transfers/${encodeURIComponent(id)}/scan-out`, { opKey: key, expectedVersion: cur.version, ...body });
      const after = await read(id).catch(() => cur);
      await lineOp(id, "scan-out", key, r, toState(after));
      if (!reached(after.status, "shipped")) {
        rec = await commit(rec, { ...t, items, ...owSummary(await loadLines(posId)) }, isTimeout(r) ? "checking" : "ok", `${it.sku}: ${r.error?.message ?? "สแกนออกไม่สำเร็จ"}`);
        throw err(r.error, r.ok ? 409 : r.status, it.sku);
      }
    }
    items[i] = { ...it, qty_shipped: it.isSerialized ? sns.length : it.qty_requested, shippedSerials: it.isSerialized ? sns.map((serialNo) => ({ serialNo, at, by: actor })) : it.shippedSerials };
  }
  rec = await commit(rec, { ...t, items, status: "packed", packed_by: actor, packed_at: at, ...owSummary(await loadLines(posId)) }, "ok");
  return { transfer: rec.pos_snapshot };
}

async function owDispatchImpl(posId: string, actor: string, opts: { carrier?: string | null; tracking?: string | null; shippingCost?: number | null }) {
  let rec = await loadRec(posId);
  const t = rec.pos_snapshot;
  if (t.status !== "packed") throw new OwTransferError("ต้องสแกนออกครบก่อนยืนยันส่ง", 409, "transfer_wrong_status");
  const lines = await loadLines(posId);
  for (const l of uniq(lines)) {
    const cur = await read(l.ow_id);
    if (reached(cur.status, "in_transit")) { await saveLine({ ow_id: l.ow_id, state: toState(cur) }); continue; }
    const key = opKey("tf-dispatch", posId, l.ow_id);
    const r = await owCall("POST", `transfers/${encodeURIComponent(l.ow_id)}/dispatch`, {
      opKey: key, expectedVersion: cur.version, ...(opts.carrier ? { carrier: opts.carrier } : {}), ...(opts.tracking ? { tracking: opts.tracking } : {}),
      ...(opts.shippingCost != null ? { shippingCost: opts.shippingCost } : {}),
    }, 60_000);
    const after = await read(l.ow_id).catch(() => cur);
    await lineOp(l.ow_id, "dispatch", key, r, toState(after));
    if (!reached(after.status, "in_transit")) {
      rec = await commit(rec, { ...t, ...owSummary(await loadLines(posId)) }, isTimeout(r) ? "checking" : "ok", `${l.sku}: ${r.error?.message ?? "ส่งไม่สำเร็จ"} (ส่งซ้ำได้ ไม่สร้าง allocation ซ้ำ)`);
      throw err(r.error, r.ok ? 409 : r.status, l.sku);
    }
  }
  // สต๊อกที่ checkout ใช้: ของออกจากต้นทางจริง (idempotent ต่อใบ OW)
  for (const it of t.items) {
    const id = owIdOf(lines, it.sku)!;
    await stockMove(`${id}:out`, t.from_branch_id || null, it.product_id, -it.qty_shipped, 0, (it.shippedSerials ?? []).map((s) => s.serialNo), it.isSerialized ? "transferred" : null, t.transfer_no);
  }
  rec = await commit(rec, {
    ...t, status: "in_transit", carrier: opts.carrier ?? null, tracking: opts.tracking ?? null, shipping_cost: opts.shippingCost ?? null,
    ship_stage: "picked_up", shipped_by: actor, shipped_at: now(), ...owSummary(await loadLines(posId)),
  }, "ok");
  return { transfer: rec.pos_snapshot };
}

// ── รับเข้า ────────────────────────────────────────────────────────────────
/** รับเข้า: SN ตรง+ปกติ → ขายได้ · SN ตรง+ชำรุด → พักตรวจ (stockType damaged) · SN นอกใบ → บันทึกผลต่าง (ไม่ส่ง OW · ไม่นับสต๊อก)
 *  SN ที่ยังไม่มา → คงค้างรับ (ไม่ปิดอัตโนมัติ — ปิดรับขาด/ยืนยันสูญหายเป็นคนละคำสั่ง) */
async function owScanInImpl(posId: string, actor: string, input: { product_id: string; serials?: string[]; damaged?: string[]; receivedQty?: number; damagedQty?: number }[]) {
  let rec = await loadRec(posId);
  const t = rec.pos_snapshot;
  if (!["in_transit", "partial_received"].includes(t.status)) throw new OwTransferError("ใบนี้ยังไม่อยู่ระหว่างขนส่ง", 409, "transfer_wrong_status");
  const lines = await loadLines(posId);
  const at = now();
  const items = t.items.map((x) => ({ ...x }));
  const discrepancies: TransferDiscrepancy[] = [...(t.discrepancies ?? [])];
  const receiptLines: { product_id: string; qty: number; serials?: string[] }[] = [];
  // รวมคำสั่งต่อใบ OW (ใบจากคลังกลางอาจมีหลายสินค้าในใบเดียว)
  const perOw = new Map<string, { serials: { serialNo: string; stockType: string }[]; quantities: { sku: string; receivedQty: number; stockType: string }[] }>();
  const moves: (() => Promise<void>)[] = [];
  for (const inp of input) {
    const it = items.find((x) => x.product_id === inp.product_id || x.sku === inp.product_id);
    if (!it) continue;
    const id = owIdOf(lines, it.sku);
    if (!id) throw new OwTransferError(`${it.sku}: ไม่พบใบ OW`, 409, "transfer_not_found", it.sku);
    const acc = perOw.get(id) ?? { serials: [], quantities: [] };
    if (it.isSerialized) {
      const shipped = new Set((it.shippedSerials ?? []).map((s) => s.serialNo));
      // SN ที่บันทึกไปแล้ว (รับแล้ว หรือบันทึกเป็น "นอกใบ" แล้ว) → ไม่บันทึกซ้ำเมื่อส่งคำสั่งเดิมซ้ำ
      const already = new Set([...(it.receivedSerials ?? []), ...(it.quarantinedSerials ?? [])].map((s) => s.serialNo));
      const scanned = [...new Set((inp.serials ?? []).map((s) => s.trim()).filter(Boolean))].filter((s) => !already.has(s));
      const damaged = new Set(inp.damaged ?? []);
      const matched = scanned.filter((s) => shipped.has(s)), unexpected = scanned.filter((s) => !shipped.has(s));
      for (const s of matched) acc.serials.push({ serialNo: s, stockType: damaged.has(s) ? "damaged" : "sellable" });
      it.receivedSerials = [...(it.receivedSerials ?? []), ...matched.map((serialNo) => ({ serialNo, at, by: actor }))];
      it.quarantinedSerials = [...(it.quarantinedSerials ?? []), ...unexpected.map((serialNo) => ({ serialNo, at, by: actor }))];
      it.qty_received = (it.receivedSerials ?? []).length;
      for (const s of matched.filter((x) => damaged.has(x))) discrepancies.push({ id: randomUUID(), product_id: it.product_id, kind: "damaged", qty: 1, serialNo: s, status: "open", at, by: actor, note: "รับเข้าพักตรวจ (ชำรุด)" });
      for (const s of unexpected) discrepancies.push({ id: randomUUID(), product_id: it.product_id, kind: "unexpected_sn", qty: 1, serialNo: s, status: "open", at, by: actor, note: "SN นอกใบโอน — ไม่ส่งรับเข้าใน OW รอพิสูจน์ที่มา" });
      const ok = matched.filter((s) => !damaged.has(s)), bad = matched.filter((s) => damaged.has(s));
      moves.push(async () => {
        for (const s of ok) await stockMove(`${id}:in:${s}`, t.to_branch_id, it.product_id, 1, 0, [s], "in_stock", t.transfer_no);
        for (const s of bad) await stockMove(`${id}:in:${s}`, t.to_branch_id, it.product_id, 1, 1, [s], "defective", t.transfer_no);
        // SN นอกใบ: ไม่นับเข้าสต๊อก (OW ไม่ได้รับเข้า) — เป็นเคสผลต่างจนพิสูจน์ที่มา ยอด POS จึงตรงกับ OW
      });
      if (matched.length) receiptLines.push({ product_id: it.product_id, qty: matched.length, serials: matched });
    } else {
      const qty = Math.max(0, Math.floor(inp.receivedQty ?? 0)), dq = Math.min(qty, Math.max(0, Math.floor(inp.damagedQty ?? 0)));
      if (!qty) continue;
      if (it.qty_received + qty > it.qty_shipped) throw new OwTransferError(`${it.sku}: รับเกินจำนวนที่ส่ง`, 400, "qty_exceeds_shipped", it.sku);
      if (qty - dq) acc.quantities.push({ sku: it.sku, receivedQty: qty - dq, stockType: "sellable" });
      if (dq) acc.quantities.push({ sku: it.sku, receivedQty: dq, stockType: "damaged" });
      const before = it.qty_received;
      it.qty_received += qty;
      if (dq) discrepancies.push({ id: randomUUID(), product_id: it.product_id, kind: "damaged", qty: dq, status: "open", at, by: actor, note: "รับเข้าพักตรวจ (ชำรุด)" });
      moves.push(async () => { await stockMove(`${id}:inqty:${before}->${it.qty_received}`, t.to_branch_id, it.product_id, qty, dq, [], null, t.transfer_no); });
      receiptLines.push({ product_id: it.product_id, qty });
    }
    perOw.set(id, acc);
  }
  for (const [id, body] of perOw) {
    if (!body.serials.length && !body.quantities.length) continue;
    const cur = await read(id);
    // รวมยอดที่รับแล้วใน opKey: รับแบบจำนวนรอบใหม่ (เช่น 1 ชิ้นอีกครั้ง) ต้องไม่ชน opKey รอบก่อน — ลองซ้ำรอบเดิมยังได้ key เดิม
    const key = opKey("tf-scanin", posId, id, JSON.stringify(body), JSON.stringify(t.items.map((x) => [x.sku, x.qty_received, (x.receivedSerials ?? []).length])));
    const r = await owCall("POST", `transfers/${encodeURIComponent(id)}/scan-in`, { opKey: key, expectedVersion: cur.version, ...(body.serials.length ? { serials: body.serials } : {}), ...(body.quantities.length ? { quantities: body.quantities } : {}) });
    const after = await read(id).catch(() => cur);
    await lineOp(id, "scan-in", key, r, toState(after));
    if (!r.ok) {
      rec = await commit(rec, { ...t, ...owSummary(await loadLines(posId)) }, isTimeout(r) ? "checking" : "ok", `รับเข้าไม่สำเร็จ: ${r.error?.message ?? ""}`);
      throw err(r.error, r.status);
    }
  }
  for (const m of moves) await m();
  const done = items.every((x) => x.qty_received >= x.qty_shipped);
  rec = await commit(rec, {
    ...t, items, discrepancies, status: done ? "completed" : "partial_received",
    receipts: [...(t.receipts ?? []), ...(receiptLines.length ? [{ id: randomUUID(), at, by: actor, lines: receiptLines }] : [])],
    ...(done ? { received_by: actor, received_at: at } : {}), ...owSummary(await loadLines(posId)),
  } as Transfer, "ok");
  return { transfer: rec.pos_snapshot };
}

/** ปิดรับขาด = ปิดการรอรับใน OW (admin ฝั่ง OW) + บันทึกส่วนขาดเป็นเคสเปิด (ยืนยันสูญหายเป็นอีกขั้น ต้องอนุมัติ) */
async function owCloseShortImpl(posId: string, actor: string, reason: string) {
  let rec = await loadRec(posId);
  const t = rec.pos_snapshot;
  if (t.status !== "partial_received") throw new OwTransferError("ปิดรับขาดได้เฉพาะใบที่รับบางส่วน", 409, "transfer_wrong_status");
  if (!reason || reason.trim().length < 3) throw new OwTransferError("ต้องระบุเหตุผลการปิดรับขาด", 400, "validation");
  const lines = await loadLines(posId);
  for (const l of uniq(lines)) {
    const cur = await read(l.ow_id);
    if (cur.status === "closed") { await saveLine({ ow_id: l.ow_id, state: toState(cur) }); continue; }
    const key = opKey("tf-closeshort", posId, l.ow_id);
    const r = await owCall("POST", `transfers/${encodeURIComponent(l.ow_id)}/close-short`, { opKey: key, expectedVersion: cur.version, reason: reason.slice(0, 300) });
    const after = await read(l.ow_id).catch(() => cur);
    await lineOp(l.ow_id, "close-short", key, r, toState(after));
    if (after.status !== "closed") {
      rec = await commit(rec, { ...t, ...owSummary(await loadLines(posId)) }, "ok", `${l.sku}: ${r.error?.message ?? "ปิดรับขาดไม่สำเร็จ"}`);
      throw err(r.error, r.ok ? 409 : r.status, l.sku);
    }
  }
  const at = now();
  const discrepancies: TransferDiscrepancy[] = [...(t.discrepancies ?? [])];
  for (const it of t.items) {
    if (it.isSerialized) {
      const got = new Set((it.receivedSerials ?? []).map((s) => s.serialNo));
      for (const s of (it.shippedSerials ?? []).filter((x) => !got.has(x.serialNo))) discrepancies.push({ id: randomUUID(), product_id: it.product_id, kind: "short", qty: 1, serialNo: s.serialNo, status: "open", sn_outcome: "tracking", at, by: actor, note: reason });
    } else if (it.qty_shipped > it.qty_received) discrepancies.push({ id: randomUUID(), product_id: it.product_id, kind: "short", qty: it.qty_shipped - it.qty_received, status: "open", at, by: actor, note: reason });
  }
  rec = await commit(rec, { ...t, discrepancies, status: "completed", ...owSummary(await loadLines(posId)) }, "ok");
  return { transfer: rec.pos_snapshot };
}

// ── ใบที่คลังกลางเปิดเอง → "รอรับจากคลังกลาง" ───────────────────────────────
const posStatusOf = (s: string): TransferStatus =>
  s === "void" ? "cancelled" : s === "closed" ? "completed" : s === "received" ? "partial_received" : reached(s, "shipped") ? "in_transit" : "approved";

/** ดึงใบขาเข้าของคลังสาขานี้จาก OW (OW transfer id = รหัสหลัก ไม่ดึงซ้ำ) และอัปเดตใบที่มีอยู่ */
export async function owSyncInbound(branchId: string, actor: string | null): Promise<number> {
  const links = await warehouseLinks();
  const wh = links.get(branchId);
  if (!wh) return 0;
  const reverse = new Map([...links].map(([b, w]) => [w, b]));
  let added = 0;
  type Row = { id: string; docNo?: string; direction: string; status: string; referenceNo?: string | null };
  for (let page = 1; page <= 10; page++) {
    const r = await owCall<{ items?: Row[]; total?: number; pageSize?: number }>("GET", `transfers?warehouseId=${encodeURIComponent(wh)}&status=active&page=${page}`);
    if (!r.ok) throw new OwTransferError(`อ่านใบขาเข้าจาก OW ไม่สำเร็จ: ${r.error?.message ?? r.status}`, 502, r.error?.code ?? "list_failed");
    const list = r.data?.items ?? [];
    for (const row of list) {
      if (row.direction !== "in" || !reached(row.status, "shipped")) continue;
      const kn = await sb().from("pos_ow_transfer_lines").select("pos_transfer_id").eq("source", src()).eq("ow_id", row.id).limit(1);
      if (kn.error) throw new OwTransferError("อ่านใบ OW ย่อยไม่สำเร็จ", 503, "lines_read");
      const known = kn.data?.[0];
      if (known) {
        // ใบคลังกลางที่มีอยู่: อัปเดตสถานะภายใต้ล็อก (ถ้ามีเครื่องกำลังรับอยู่ → ข้ามรอบนี้ ไม่ชนกัน)
        const posId = known.pos_transfer_id as string;
        try {
          await withLock(posId, async () => {
            const rec = await loadRec(posId).catch(() => null);
            if (!rec || rec.origin !== "ow") return;
            const v = await read(row.id);
            await saveLine({ ow_id: row.id, state: toState(v) });
            const next = posStatusOf(v.status);
            // ปรับเฉพาะสถานะที่ POS ยังไม่ได้ทำเอง (ยังรอรับ) — ไม่ทับผลรับที่ POS บันทึกแล้ว
            if (rec.pos_snapshot.status === "in_transit" && next !== "in_transit" && next !== "partial_received")
              await commit(rec, { ...rec.pos_snapshot, status: next, ...owSummary(await loadLines(posId)) }, "ok");
          });
        } catch (e) { if (!(e instanceof OwTransferError && e.code === "transfer_busy")) throw e; }
        continue;
      }
      // ใบที่ POS เปิดเอง (referenceNo = เลขใบ POS) แต่บันทึกใบย่อยไม่ทัน → ห้ามดึงซ้ำเป็นใบคลังกลาง
      if (row.referenceNo) {
        const mine = await sb().from("pos_ow_transfers").select("pos_transfer_id").eq("source", src()).eq("transfer_no", row.referenceNo).eq("origin", "pos").limit(1);
        if (mine.error) throw new OwTransferError("อ่านใบโอนไม่สำเร็จ", 503, "copy_read");
        if (mine.data?.length) continue;
      }
      const v = await read(row.id);
      const skus = [...new Set(v.lines.map((l) => l.sku))];
      const { data: prods, error: pErr } = await sb().from("products").select("id,sku,name_th,track_serial").in("sku", skus);
      if (pErr) throw new OwTransferError("อ่านสินค้าไม่สำเร็จ", 503, "products_read");
      const pm = new Map((prods ?? []).map((p) => [p.sku, p]));
      const missingSku = skus.filter((x) => !pm.has(x));
      const posId = randomUUID(), at = now();
      const t: Transfer = {
        id: posId, transfer_no: v.orderNo || row.docNo || row.id, from_branch_id: reverse.get(v.fromWarehouseId ?? "") ?? "", to_branch_id: branchId, from_kind: "warehouse",
        status: posStatusOf(v.status), note: `เปิดจากคลังกลาง OW${v.remark ? ` · ${v.remark}` : ""}${missingSku.length ? ` · ไม่พบสินค้าใน POS: ${missingSku.join(", ")}` : ""}`,
        items: v.lines.filter((l) => pm.has(l.sku)).map((l) => {
          const p = pm.get(l.sku)!;
          const serialized = l.isSerialized ?? !!p.track_serial;
          const shipped = (l.shippedSerials ?? []).map((x) => ({ serialNo: x.serialNo, at: x.at ?? at }));
          const got = (l.receivedSerials ?? []).map((x) => ({ serialNo: x.serialNo, at: x.at ?? at }));
          return { product_id: p.id, sku: l.sku, name: l.name || p.name_th, qty_requested: l.qty, qty_shipped: serialized ? shipped.length || l.qty : l.qty, qty_received: got.length, isSerialized: serialized, shippedSerials: shipped, receivedSerials: got };
        }),
        created_at: at, version: 0, sync_state: "synced", jst_allocation_no: v.jstAllocationNo ?? null, ow_owned: true,
      };
      // จองใบย่อยก่อน (PK source+ow_id+sku) — อีกเครื่องดึงพร้อมกันจะชน PK แล้วข้าม ไม่เกิดใบซ้ำ
      const lineRows = v.lines.map((l) => ({ source: src(), ow_id: v.id, pos_transfer_id: posId, product_id: pm.get(l.sku)?.id ?? null, sku: l.sku, qty: l.qty, serialized: l.isSerialized ?? null, state: toState(v), updated_at: at }));
      const li = await sb().from("pos_ow_transfer_lines").insert(lineRows);
      if (li.error) { if (li.error.code === "23505") continue; throw new OwTransferError("บันทึกใบ OW ย่อยไม่สำเร็จ: " + li.error.message, 503, "lines_write"); }
      const ins = await sb().from("pos_ow_transfers").insert({
        source: src(), pos_transfer_id: posId, transfer_no: t.transfer_no, from_branch_id: t.from_branch_id || null, to_branch_id: branchId,
        from_warehouse_id: v.fromWarehouseId ?? "", to_warehouse_id: wh, pos_snapshot: { ...t, version: 1 }, status: t.status, link_state: "ok", origin: "ow", updated_by: actor,
      });
      if (ins.error) {
        await sb().from("pos_ow_transfer_lines").delete().eq("source", src()).eq("pos_transfer_id", posId);
        throw new OwTransferError("บันทึกใบจากคลังกลางไม่สำเร็จ: " + ins.error.message, 503, "copy_write");
      }
      // ต้นทางเป็นสาขา POS ที่ผูกคลัง (คลังกลาง/OW ส่งออกเอง) → ตัดสต๊อกต้นทางใน POS ด้วย (key ต่อ SKU — ใบคลังกลาง 1 ใบมีได้หลายสินค้า · idempotent)
      if (t.from_branch_id) {
        for (const it of t.items) {
          await stockMove(`${v.id}:out:${it.sku}`, t.from_branch_id, it.product_id, -it.qty_shipped, 0, (it.shippedSerials ?? []).map((x) => x.serialNo), it.isSerialized ? "transferred" : null, t.transfer_no);
        }
      }
      added++;
    }
    const size = r.data?.pageSize ?? 20;
    if (!list.length || page * size >= (r.data?.total ?? 0)) break;
  }
  return added;
}

/** รายการสำเนาใบ (เซิร์ฟเวอร์เป็นผู้สร้าง) — แบ่งหน้าด้วย before/since ไม่จำกัดแค่ 300 ใบล่าสุด */
export async function owListCopies(branchIds: string[] | null, opts: { since?: string; before?: string; limit?: number } = {}) {
  let q = sb().from("pos_ow_transfers").select("pos_transfer_id,transfer_no,from_branch_id,to_branch_id,status,link_state,origin,revision,last_error,pos_snapshot,updated_at")
    .eq("source", src()).order("updated_at", { ascending: false }).limit(Math.min(500, Math.max(1, opts.limit ?? 200)));
  if (branchIds) q = q.or(`from_branch_id.in.(${branchIds.join(",")}),to_branch_id.in.(${branchIds.join(",")})`);
  if (opts.since) q = q.gt("updated_at", opts.since);
  if (opts.before) q = q.lt("updated_at", opts.before);
  const { data, error } = await q;
  if (error) throw new OwTransferError("อ่านใบโอน OW ไม่สำเร็จ", 503, "copy_read");
  return (data ?? []).map((r) => ({ ...r, transfer: { ...(r.pos_snapshot as Transfer), ow_owned: true, ow_link_state: r.link_state, ow_error: r.last_error } }));
}
export async function owGetCopy(posId: string) {
  const rec = await loadRec(posId);
  return { transfer: { ...rec.pos_snapshot, ow_link_state: rec.link_state, ow_error: rec.last_error }, link_state: rec.link_state, revision: rec.revision };
}
