import Dexie from "dexie";
// =====================================================================
// ตัวซิงก์ข้อมูลออฟไลน์ → Supabase
//
// กติกาสำคัญ (ตามที่ตกลงกันไว้):
//   Payment → Save Order (local) → Commit Inventory (local) → Print
//   การซิงก์ขึ้น server เป็นงานเบื้องหลัง ไม่บล็อกการขาย
//   ทุก op มี client_uuid → server ใช้กันบิลซ้ำ (create_order เป็น idempotent)
// =====================================================================

import { db, type PendingOp } from "./db";
import { isLiveMode } from "../supabase/client";

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
  // Keep queue insertion in the caller's transaction; never send before commit.
  if (!Dexie.currentTransaction) {
    await refreshCounts();
    void flush();
  }
}

/** ส่งงานค้างทั้งหมดขึ้น server — ปลอดภัยที่จะเรียกซ้ำ */
export async function flush(): Promise<void> {
  // Serialize workers across tabs sharing the same IndexedDB database.
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request("shd-pos-sync", { ifAvailable: true }, async (lock) => {
      if (lock) await flushUnlocked();
    });
    return;
  }
  await flushUnlocked();
}

async function flushUnlocked(): Promise<void> {
  if (state.syncing) return;
  if (!isLiveMode()) {
    // โหมดสาธิต: ถือว่าซิงก์เสร็จทันที ไม่ต้องยิงไปไหน
    await refreshCounts();
    return;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  state = { ...state, syncing: true, lastError: null };
  emit();

  let didSync = false;
  try {
    // A tab can close after claiming a job. Recover expired claims only; RPCs use client_uuid.
    const abandoned = await db().pending.where("status").equals("syncing").toArray();
    for (const item of abandoned) {
      if (item.id != null) await db().transaction("rw",db().pending,async()=>{
        const fresh=await db().pending.get(item.id!);
        if(!fresh || fresh.status!=="syncing")return;
        const claimed=Date.parse(fresh.claimed_at||"");
        if(!Number.isFinite(claimed)||Date.now()-claimed>120_000)await db().pending.update(item.id!,{status:"pending",claimed_at:null});
      });
    }
    const batch = await db().pending.where("status").anyOf("pending", "failed").limit(50).toArray();
    for (const item of batch) {
      if (item.id == null) continue;
      const claimed = await db().transaction("rw", db().pending, async () => {
        const current = await db().pending.get(item.id!);
        if (!current || !["pending", "failed"].includes(current.status)) return false;
        await db().pending.update(item.id!, { status: "syncing", claimed_at: new Date().toISOString(), attempts: current.attempts + 1 });
        return true;
      });
      if (!claimed) continue;
      try {
        const response = await fetch("/api/pos/operations", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: item.op, client_uuid: item.client_uuid, payload: item.payload }), signal: AbortSignal.timeout(30_000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (item.op === "create_order" && result.data?.order_no) {
          const cu = (item.payload as { client_uuid?: string }).client_uuid;
          if (cu) {
            const local = await db().orders.where("client_uuid").equals(cu).first();
            if (local) await db().orders.update(local.id, { synced: true, server_order_no: result.data.order_no });
          }
        }
        await db().pending.update(item.id, { status: "done", last_error: null });
        didSync = true;
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
    if (didSync) {
      try { await (await import("./refresh")).refreshBranchSnapshot(); } catch { /* Preserve local cache. */ }
    }
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
