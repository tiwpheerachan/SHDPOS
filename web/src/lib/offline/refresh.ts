import { db, stockKey, kvSet, kvGet } from "./db";
import { isLiveMode } from "../supabase/client";
import { useSession } from "../store/session";
import type { Order, StockLevel, Shift } from "../types";
let running = false;
export async function refreshBranchSnapshot() {
  const { employee, branchId } = useSession.getState();
  if (running || !isLiveMode() || !employee || !branchId || !navigator.onLine)
    return;
  running = true;
  try {
    const generation = await kvGet("central_commit_generation", "");
    const r = await fetch(
      `/api/pos/snapshot?branch_id=${encodeURIComponent(branchId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );
    const data = await r.json();
    if (!r.ok) throw Error(data.error || "อ่านข้อมูลกลางไม่สำเร็จ");
    if (
      useSession.getState().branchId !== branchId ||
      useSession.getState().employee?.id !== data.actor_id
    )
      return;
    const d = db();
    await d.transaction(
      "rw",
      [d.orders, d.stock, d.shifts, d.pending, d.transfers, d.kv],
      async () => {
        if ((await kvGet("central_commit_generation", "")) !== generation)
          return;
        const pending = await d.pending
          .where("status")
          .notEqual("done")
          .toArray();
        const localTransfers = (await d.transfers.toArray()).some(
          // ใบโอน OneWarehouse (ow_owned) ไม่ใช่งานค้างในเครื่อง (sync_state = สถานะ JST) — เดิมทำให้สต๊อกไม่รีเฟรชเลย
          (t) => t.sync_state !== "synced" && !t.ow_owned,
        );
        // Do not overwrite stock with a snapshot that predates an unsent local movement.
        if (!pending.some((p) => p.op !== "audit") && !localTransfers) {
          const old = await d.stock
            .where("branch_id")
            .equals(branchId)
            .primaryKeys();
          await d.stock.bulkDelete(old);
          await d.stock.bulkPut(
            (data.stock as StockLevel[]).map((s) => ({
              ...s,
              key: stockKey(s.branch_id, s.product_id),
            })),
          );
        }
        for (const order of data.orders as Order[]) {
          const existing = order.client_uuid
            ? await d.orders
                .where("client_uuid")
                .equals(order.client_uuid)
                .first()
            : undefined;
          if (existing) await d.orders.put({ ...order, id: existing.id });
          else await d.orders.put(order);
        }
        await d.shifts.bulkPut(data.shifts as Shift[]);
        await kvSet("central_snapshot", {
          branchId,
          at: data.as_of,
          blockedByLocalTransfers: localTransfers,
        });
      },
    );
    window.dispatchEvent(new Event("pos-data-refreshed"));
  } finally {
    running = false;
  }
}
