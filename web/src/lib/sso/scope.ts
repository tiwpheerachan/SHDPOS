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
