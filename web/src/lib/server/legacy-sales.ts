// =====================================================================
// ยอดขายระบบเดิม (Lark) สำหรับหน้ายอดขาย — ฐานข้อมูลรวมบิล + บีบอัดให้ (RPC legacy_sales_compact, 0090)
//   ส่งต่อหน้าเว็บแบบบีบอัด แล้วค่อยกางเป็น Order ฝั่งเบราว์เซอร์ (lib/legacy-expand) — ช่วง 1 ปี ~6MB แทน ~50MB
//   กฎ (ทำใน SQL): อีเวนต์ระบบเดิมบันทึกติดลบ → ค่าบวก · ข้ามบรรทัดว่าง · ไม่นับตั้งแต่วันเริ่มใช้ POS ของสาขา
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegacyCompact, LegacyDaily } from "@/lib/legacy-expand";

const bkkDate = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const NONE = ["00000000-0000-0000-0000-000000000000"];
const scope = (allowed: string[] | null) => (allowed === null ? null : allowed.length ? allowed : NONE);

export async function legacyCompact(sb: SupabaseClient, fromIso: string, toIso: string, allowed: string[] | null): Promise<LegacyCompact> {
  const r = await sb.rpc("legacy_sales_compact", { p_from: bkkDate(fromIso), p_to: bkkDate(toIso), p_branches: scope(allowed) });
  if (r.error) throw Error(`อ่านยอดขายระบบเดิมไม่สำเร็จ: ${r.error.message}`);
  return r.data as LegacyCompact;
}

export async function legacyDaily(sb: SupabaseClient, fromIso: string, toIso: string, allowed: string[] | null): Promise<LegacyDaily> {
  const r = await sb.rpc("legacy_sales_daily", { p_from: bkkDate(fromIso), p_to: bkkDate(toIso), p_branches: scope(allowed) });
  if (r.error) throw Error(r.error.message);
  return (r.data ?? []) as LegacyDaily;
}
