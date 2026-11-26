// สาขา → แบรนด์ที่ขาย = branches.brand_id (แบรนด์หลัก) ∪ branch_brands (สาขาหลายแบรนด์)
import { supabaseAdmin } from "@/lib/supabase/admin";

/** แผนที่ สาขา → แบรนด์ที่ขาย (ใช้ร่วมกับ route อื่นได้) */
export async function branchBrandMap(branchIds: string[] | null) {
  const sb = supabaseAdmin();
  let bq = sb.from("branches").select("id,brand_id");
  if (branchIds) bq = bq.in("id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"]);
  let mq = sb.from("branch_brands").select("branch_id,brand_id");
  if (branchIds) mq = mq.in("branch_id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"]);
  const [b, m] = await Promise.all([bq, mq]);
  if (b.error || m.error) throw Error(b.error?.message ?? m.error?.message);
  const map: Record<string, string[]> = {}, primary: Record<string, string | null> = {};
  for (const r of b.data ?? []) { primary[r.id] = r.brand_id; map[r.id] = r.brand_id ? [r.brand_id] : []; }
  for (const r of m.data ?? []) if (map[r.branch_id] && !map[r.branch_id].includes(r.brand_id)) map[r.branch_id].push(r.brand_id);
  return { map, primary };
}

