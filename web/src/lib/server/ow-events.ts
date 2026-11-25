// รับเหตุการณ์จาก OneWarehouse (Pub/Sub push) → อัปเดตใบโอน/ยอดจองทันที แทนการรอรอบดึงข้อมูล
//   transfer.*: ซิงก์ใบขาเข้าของสาขาปลายทาง + ยอดจองของสาขาต้นทาง · warehouse.upserted: บันทึกไว้ (ข้อมูลคลังอ่านสดอยู่แล้ว)
//   กันทำซ้ำด้วย envelope id (ตาราง pos_ow_event_inbox) · ไม่ใช่ทุกเหตุการณ์ที่เกี่ยวกับสาขาเรา → ข้ามได้
import { supabaseAdmin } from "@/lib/supabase/admin";
import { warehouseLinks, owSyncInbound } from "./ow-transfers";
import { owSyncReservations } from "./ow-reconcile";

export type OwEnvelope = { id: string; eventType: string; aggregate?: { type?: string; id?: string }; occurredAt?: string; data?: Record<string, unknown> };

/** รับได้ทั้ง Pub/Sub push ({message:{data:base64}}) และ envelope ตรง ๆ */
export function parseOwEvent(body: unknown): OwEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  let env: unknown = b;
  const msg = b.message as { data?: string } | undefined;
  if (msg && typeof msg.data === "string") {
    try { env = JSON.parse(Buffer.from(msg.data, "base64").toString("utf8")); } catch { return null; }
  }
  const e = env as OwEnvelope;
  return e && typeof e.id === "string" && typeof e.eventType === "string" ? e : null;
}

export async function handleOwEvent(e: OwEnvelope): Promise<{ status: "duplicate" | "processed" | "ignored"; detail: string }> {
  const sb = supabaseAdmin();
  const ins = await sb.from("pos_ow_event_inbox").insert({ id: e.id.slice(0, 200), event_type: e.eventType.slice(0, 60), aggregate_id: e.aggregate?.id ?? null, occurred_at: e.occurredAt ?? null, payload: e as unknown as Record<string, unknown> });
  if (ins.error) {
    if (ins.error.code === "23505") return { status: "duplicate", detail: "ได้รับแล้ว" };
    throw new Error("บันทึกเหตุการณ์ไม่สำเร็จ");
  }
  let detail = "", status: "processed" | "ignored" = "processed";
  try {
    if (e.eventType.startsWith("transfer.")) {
      const d = (e.data ?? {}) as { fromWarehouseId?: string; toWarehouseId?: string; orderNo?: string; status?: string };
      const links = await warehouseLinks();
      const byWh = new Map([...links].map(([branch, wh]) => [wh, branch]));
      const toBranch = d.toWarehouseId ? byWh.get(d.toWarehouseId) : undefined;
      const fromBranch = d.fromWarehouseId ? byWh.get(d.fromWarehouseId) : undefined;
      const parts: string[] = [];
      if (toBranch) parts.push(`ขาเข้า ${await owSyncInbound(toBranch, null)} ใบใหม่`);
      if (fromBranch) { await owSyncReservations(fromBranch); parts.push("อัปเดตยอดจองต้นทาง"); }
      if (!toBranch && !fromBranch) { status = "ignored"; parts.push("ไม่เกี่ยวกับสาขาที่ผูกไว้"); }
      detail = `${d.orderNo ?? e.aggregate?.id ?? ""} ${d.status ?? ""} · ${parts.join(" · ")}`.trim();
    } else { status = "ignored"; detail = "บันทึกไว้ (ไม่ต้องทำอะไร)"; }
  } catch (err) {
    detail = `ผิดพลาด: ${err instanceof Error ? err.message : String(err)} — รอบดึงข้อมูลปกติจะตามให้`;
  }
  await sb.from("pos_ow_event_inbox").update({ processed_at: new Date().toISOString(), result: detail.slice(0, 500) }).eq("id", e.id.slice(0, 200));
  return { status, detail };
}
