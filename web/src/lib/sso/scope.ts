// =====================================================================
// Scope — บังคับขอบเขตข้อมูลตามสิทธิ์พนักงาน ที่ชั้น API
//   (admin API ใช้ service-role ที่ bypass RLS จึงต้องกรองเองที่นี่)
//   คืน branch ids ที่พนักงานคนนี้เห็นได้ — null = เห็นทุกสาขา (company/superadmin)
// =====================================================================
import type { AppAuthz } from "./types";
import { supabaseAdmin } from "../supabase/admin";

export async function visibleBranchIds(authz: AppAuthz): Promise<string[] | null> {
  if (authz.isSuperadmin || authz.data_scope === "company") return null; // เห็นทุกสาขา

  if (authz.data_scope === "brand") {
    const sb = supabaseAdmin();
    const brandIds = authz.brand_ids;
    const set = new Set<string>(authz.branch_ids);
    if (brandIds.length) {
      const [{ data: byPrimary }, { data: byMap }] = await Promise.all([
        sb.from("branches").select("id").in("brand_id", brandIds),
        sb.from("branch_brands").select("branch_id").in("brand_id", brandIds),
      ]);
      for (const b of byPrimary ?? []) set.add(b.id as string);
      for (const b of byMap ?? []) set.add(b.branch_id as string);
    }
    return [...set];
  }

  // branch / own → เฉพาะสาขาที่ผูกไว้
  return authz.branch_ids;
}

/** แบรนด์ที่เห็นได้ (จาก brand_ids โดยตรง) — null = ทุกแบรนด์ */
export function visibleBrandIds(authz: AppAuthz): string[] | null {
  if (authz.isSuperadmin || authz.data_scope === "company") return null;
  return authz.brand_ids;
}

/** แบรนด์ที่สาขาเหล่านี้ขาย = branches.brand_id (แบรนด์หลัก) ∪ branch_brands (สาขาหลายแบรนด์) */
export async function brandsSoldAtBranches(branchIds: string[]): Promise<string[]> {
  if (!branchIds.length) return [];
  const sb = supabaseAdmin();
  const [primary, mapped] = await Promise.all([
    sb.from("branches").select("brand_id").in("id", branchIds),
    sb.from("branch_brands").select("brand_id").in("branch_id", branchIds),
  ]);
  if (primary.error || mapped.error) throw Error("branch_brands_read_failed");
  const set = new Set<string>();
  for (const r of [...(primary.data ?? []), ...(mapped.data ?? [])]) if (r.brand_id) set.add(r.brand_id as string);
  return [...set];
}

/**
 * แบรนด์สินค้าที่พนักงานใช้ขาย/วางแผนแคมเปญได้ — null = ทุกแบรนด์
 *   brand scope: แบรนด์ของตัวเอง ∪ ทุกแบรนด์ที่สาขาที่ตนเห็นขาย (สาขาหลายแบรนด์ → ของแถมข้ามแบรนด์ได้)
 *   branch/own scope: ไม่จำกัดแบรนด์สินค้า (เหมือนเดิม)
 */
export async function catalogBrandIds(authz: AppAuthz): Promise<string[] | null> {
  const own = visibleBrandIds(authz);
  if (own === null || authz.data_scope !== "brand") return null;
  const branches = (await visibleBranchIds(authz)) ?? [];
  return [...new Set([...own, ...(await brandsSoldAtBranches(branches))])];
}
