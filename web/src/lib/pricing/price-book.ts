// สมุดราคาของสาขา (หน้าร้าน) — ราคาช่วงเวลาที่มีผลตอนนี้ · สินค้าที่ไม่อยู่ในสมุด = ราคาหลัก (product.price)
//   โหลดจาก /api/pos/prices ทุกครั้งที่เปลี่ยนสาขา/ทุก 5 นาที/ตอนเซิร์ฟเวอร์แจ้งราคาเปลี่ยน · เก็บในเครื่องไว้ใช้ตอนเน็ตหลุด
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isLiveMode } from "@/lib/supabase/client";
import { useSession } from "@/lib/store/session";

export type PriceEntry = { product_id: string; price: number; list_price: number; rule_name: string | null; price_type: string | null; ends_at: string | null };
type Book = { branchId: string | null; at: string | null; items: Record<string, PriceEntry>; set: (b: string, at: string, items: PriceEntry[]) => void };

export const usePriceBook = create<Book>()(persist((set) => ({
  branchId: null, at: null, items: {},
  set: (branchId, at, items) => set({ branchId, at, items: Object.fromEntries(items.map((i) => [i.product_id, i])) }),
}), { name: "shdpos.pricebook" }));

/** ราคาที่ใช้ขายของสินค้า (ตามสาขาปัจจุบัน) */
export function priceOf(p: { id: string; price: number }): number {
  const b = usePriceBook.getState(), branch = useSession.getState().branchId;
  const e = b.branchId && b.branchId === branch ? b.items[p.id] : undefined;
  // ช่วงราคาหมดแล้ว (เครื่องยังไม่ได้โหลดใหม่) → กลับราคาหลัก
  if (!e || (e.ends_at && Date.parse(e.ends_at) <= Date.now())) return p.price;
  return e.price;
}
export function priceEntry(id: string): PriceEntry | null {
  const b = usePriceBook.getState(), branch = useSession.getState().branchId;
  const e = b.branchId && b.branchId === branch ? b.items[id] : undefined;
  return e && !(e.ends_at && Date.parse(e.ends_at) <= Date.now()) ? e : null;
}

let last = 0;
export async function refreshPriceBook(force = false): Promise<void> {
  if (!isLiveMode()) return;
  const branch = useSession.getState().branchId;
  if (!branch) return;
  const b = usePriceBook.getState();
  if (!force && b.branchId === branch && Date.now() - last < 5 * 60_000) return;
  try {
    const r = await fetch(`/api/pos/prices?branch_id=${branch}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json() as { at: string; items: PriceEntry[] };
    if (useSession.getState().branchId !== branch) return;
    usePriceBook.getState().set(branch, j.at, j.items);
    last = Date.now();
  } catch { /* ออฟไลน์ — ใช้สมุดเดิม */ }
}
