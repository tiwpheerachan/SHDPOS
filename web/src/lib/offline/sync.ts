// =====================================================================
// ตัวซิงก์ข้อมูลออฟไลน์ → Supabase
//
// กติกาสำคัญ (ตามที่ตกลงกันไว้):
//   Payment → Save Order (local) → Commit Inventory (local) → Print
//   การซิงก์ขึ้น server เป็นงานเบื้องหลัง ไม่บล็อกการขาย
//   ทุก op มี client_uuid → server ใช้กันบิลซ้ำ (create_order เป็น idempotent)
// =====================================================================

import { db, type PendingOp } from "./db";
import { supabase, isLiveMode } from "../supabase/client";

export type SyncState = {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

type Listener = (s: SyncState) => void;

const listeners = new Set<Listener>();

let state: SyncState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  failed: 0,
  lastSyncAt: null,
  lastError: null,
};

function emit() {
  for (const l of listeners) l(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export async function refreshCounts(): Promise<void> {
  try {
    const pending = await db().pending.where("status").anyOf("pending", "syncing").count();
    const failed = await db().pending.where("status").equals("failed").count();
    state = { ...state, pending, failed };
    emit();
  } catch {
    /* ignore */
  }
}

export async function enqueue(op: PendingOp["op"], client_uuid: string, payload: unknown): Promise<void> {
  await db().pending.add({
    op,
    client_uuid,
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  });
  await refreshCounts();
  void flush();
}

const OP_RPC: Partial<Record<PendingOp["op"], string>> = {
  create_order: "create_order",
  void_order: "void_order",
  close_shift: "close_shift",
  // ผ่าน SECURITY DEFINER RPC (ต้อง apply migration 0010_sync_rpcs.sql ก่อน)
  audit: "sync_audit",
  create_return: "sync_return",
  open_shift: "sync_open_shift",
};

const OP_TABLE: Partial<Record<PendingOp["op"], string>> = {
  cash_movement: "cash_movements",
  stock_count: "stock_counts",
  create_quotation: "quotations",
};

/** ส่งงานค้างทั้งหมดขึ้น server — ปลอดภัยที่จะเรียกซ้ำ */
export async function flush(): Promise<void> {
  if (state.syncing) return;
  if (!isLiveMode()) {
    // โหมดสาธิต: ถือว่าซิงก์เสร็จทันที ไม่ต้องยิงไปไหน
    await refreshCounts();
    return;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  const sb = supabase();
  if (!sb) return;

  state = { ...state, syncing: true, lastError: null };
  emit();

  try {
    const batch = await db().pending.where("status").anyOf("pending", "failed").limit(50).toArray();
    for (const item of batch) {
      if (item.id == null) continue;
      await db().pending.update(item.id, { status: "syncing", attempts: item.attempts + 1 });
      try {
        const rpc = OP_RPC[item.op];
        if (rpc) {
          const { error } = await sb.rpc(rpc, rpcArgs(item));
          if (error) throw error;
        } else {
          const table = OP_TABLE[item.op];
          if (!table) throw new Error(`unknown op ${item.op}`);
          const { error } = await sb.from(table).upsert(item.payload as never, {
            onConflict: "client_uuid",
            ignoreDuplicates: true,
          });
          if (error) throw error;
        }
        await db().pending.update(item.id, { status: "done", last_error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db().pending.update(item.id, { status: "failed", last_error: msg });
        state = { ...state, lastError: msg };
      }
    }
    // เก็บกวาดงานที่เสร็จแล้ว (เก็บไว้ 200 รายการล่าสุดเผื่อตรวจสอบ)
    const done = await db().pending.where("status").equals("done").toArray();
    if (done.length > 200) {
      const remove = done.slice(0, done.length - 200).map((d) => d.id!).filter(Boolean);
      await db().pending.bulkDelete(remove);
    }
    state = { ...state, lastSyncAt: new Date().toISOString() };
  } finally {
    state = { ...state, syncing: false };
    await refreshCounts();
    emit();
  }
}

function rpcArgs(item: PendingOp): Record<string, unknown> {
  switch (item.op) {
    case "create_order":
    case "audit":
    case "create_return":
    case "open_shift":
      return { p_payload: item.payload };
    case "void_order": {
      const p = item.payload as { order_id: string; employee_id: string; reason: string };
      return { p_order_id: p.order_id, p_employee_id: p.employee_id, p_reason: p.reason };
    }
    case "close_shift": {
      const p = item.payload as { shift_id: string; counted_cash: number; employee_id: string; note?: string };
      return {
        p_shift_id: p.shift_id,
        p_counted_cash: p.counted_cash,
        p_employee_id: p.employee_id,
        p_note: p.note ?? null,
      };
    }
    default:
      return {};
  }
}

let started = false;

/** เริ่มเฝ้าสถานะเน็ต + ซิงก์เป็นระยะ */
export function startSyncWorker(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const setOnline = (online: boolean) => {
    state = { ...state, online };
    emit();
    if (online) void flush();
  };

  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });

  void refreshCounts();
  void flush();
  window.setInterval(() => void flush(), 30_000);
}
