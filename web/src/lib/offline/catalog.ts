import { db, kvGet, kvSet } from "./db";
import { isLiveMode } from "../supabase/client";
import { useSession } from "../store/session";
import type { Product } from "../types";
import { tr } from "../i18n/tr";
let running = false;
/** Stage the complete response before touching the cache. Never change inventory or delete absent products. */
export async function refreshCatalogCache(force = false) {
  const employee = useSession.getState().employee;
  if (running || !isLiveMode() || !employee || !navigator.onLine) return;
  const stamp = await kvGet<{ actor: string; at: number } | null>(
    "catalog_last_refresh",
    null,
  );
  if (!force && stamp?.actor === employee.id && Date.now() - stamp.at < 300_000)
    return;
  running = true;
  try {
    const rows: Product[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (;;) {
      const r: Response = await fetch(
        `/api/pos/catalog${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(20_000) },
      );
      const data: {
        actor_id: string;
        items: Product[];
        has_more: boolean;
        next_cursor: string | null;
        error?: string;
      } = await r.json();
      if (!r.ok) throw Error(data.error || tr("อ่านแคตตาล็อกไม่สำเร็จ", "Failed to load catalog", "读取商品目录失败"));
      if (
        data.actor_id !== employee.id ||
        useSession.getState().employee?.id !== employee.id
      )
        return;
      if (!Array.isArray(data.items) || typeof data.has_more !== "boolean")
        throw Error(tr("รูปแบบแคตตาล็อกไม่ถูกต้อง", "Invalid catalog format", "商品目录格式无效"));
      rows.push(...data.items);
      if (!data.has_more) break;
      if (
        typeof data.next_cursor !== "string" ||
        !data.next_cursor ||
        seen.has(data.next_cursor)
      )
        throw Error(tr("cursor แคตตาล็อกซ้ำ", "Duplicate catalog cursor", "商品目录游标重复"));
      seen.add(data.next_cursor);
      cursor = data.next_cursor;
    }
    await db().transaction("rw", db().products, db().kv, async () => {
      if(useSession.getState().employee?.id!==employee.id)return;
      await db().products.bulkPut(rows);
      await kvSet("catalog_last_refresh", {
        actor: employee.id,
        at: Date.now(),
      });
    });
    window.dispatchEvent(new Event("pos-catalog-refreshed"));
  } finally {
    running = false;
  }
}
