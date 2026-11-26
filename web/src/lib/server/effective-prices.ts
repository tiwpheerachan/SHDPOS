// ราคาที่ใช้ขายจริง (ราคาช่วงเวลาทับราคาหลัก) — ตัวคิดเดียวกับหน้าร้าน: SQL pos_effective_prices (0081)
//   ใช้ก่อนตรวจราคาในบิล (checkout / ขายก่อนรอปิดบิล) เพื่อให้ราคาที่หน้าร้านเห็น = ราคาที่เซิร์ฟเวอร์ยอมรับ
import type { SupabaseClient } from "@supabase/supabase-js";

export type EffectivePrice = { product_id: string; list_price: number; price: number; rule_id: string | null; rule_name: string | null; price_type: string | null; ends_at: string | null };

export async function effectivePrices(sb: SupabaseClient, branchId: string, ids: string[] | null, at?: string): Promise<Map<string, EffectivePrice>> {
  const { data, error } = await sb.rpc("pos_effective_prices", { p_branch: branchId, p_ids: ids, p_at: at ?? new Date().toISOString() });
  if (error) throw new Error("อ่านราคาขายไม่สำเร็จ");
  return new Map(((data ?? []) as EffectivePrice[]).map((r) => [r.product_id, { ...r, price: Number(r.price), list_price: Number(r.list_price) }]));
}

/** คืนสินค้าชุดเดิม แต่ price = ราคาที่ใช้ขาย ณ เวลา/สาขา (คง list_price ไว้ดูราคาหลัก) */
export async function withEffectivePrices<T extends { id: string; price: unknown }>(sb: SupabaseClient, branchId: string, products: T[], at?: string): Promise<(T & { list_price: number })[]> {
  if (!products.length) return [];
  const m = await effectivePrices(sb, branchId, products.map((p) => p.id), at);
  return products.map((p) => ({ ...p, list_price: Number(p.price), price: m.get(p.id)?.price ?? Number(p.price) }));
}
