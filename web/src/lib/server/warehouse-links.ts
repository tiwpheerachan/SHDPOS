import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "./ow-gateway";
import { BRANCH_TO_WAREHOUSE } from "@/lib/onewarehouse/warehouse-map";
export async function warehouseLinks(branches: string[] | null) {
  const source = owConfig().source;
  let q = supabaseAdmin()
    .from("pos_warehouse_links")
    .select("warehouse_id,branch_id")
    .eq("source", source);
  if (branches !== null) {
    if (!branches.length) return [];
    q = q.in("branch_id", branches);
  }
  const { data, error } = await q;
  const fallback = Object.entries(BRANCH_TO_WAREHOUSE)
    .filter(([b]) => branches === null || branches.includes(b))
    .map(([branch_id, warehouse_id]) => ({ branch_id, warehouse_id }));
  if (error) return fallback;
  return [
    ...(data ?? []),
    ...fallback.filter(
      (f) => !data?.some((d) => d.warehouse_id === f.warehouse_id),
    ),
  ];
}
