// =====================================================================
// /api/share/sheet?token= — ลิงก์สาธารณะของมุมมองตารางยอดขาย (ไม่ต้องล็อกอิน · เห็นเฉพาะมุมมองนี้)
//   ข้อมูลสด ตามช่วงวันที่ของมุมมอง (ช่วงสัมพัทธ์คำนวณใหม่ทุกครั้ง) · เฉพาะสาขาที่เจ้าของเห็นได้ ∩ สาขาที่มุมมองกรองไว้
//   ไม่ส่งต้นทุน/กำไร และไม่ส่งชื่อ/เบอร์ลูกค้า · หมดอายุ/ยกเลิกได้ · นับจำนวนครั้งที่เปิด
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadSalesData } from "@/lib/server/sales-data";
import { rangeDates } from "@/lib/range-dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return reply({ error: "ลิงก์ไม่ถูกต้อง" }, 404);
  const sb = supabaseAdmin();
  const v = await sb.from("pos_report_views").select("id,name,state,owner_id,link_expires_at,link_branches,link_views").eq("link_token", token).maybeSingle();
  if (!v.data) return reply({ error: "ลิงก์นี้ถูกยกเลิกหรือไม่มีอยู่" }, 404);
  if (v.data.link_expires_at && new Date(v.data.link_expires_at) < new Date()) return reply({ error: "ลิงก์นี้หมดอายุแล้ว" }, 410);

  const state = (v.data.state ?? {}) as { page?: { filter?: Record<string, unknown>; src?: string }; filters?: Record<string, { values?: string[] }> };
  const pf = (state.page?.filter ?? {}) as { range?: string; from?: string; to?: string; branchIds?: string[]; brandIds?: string[] };
  const { from, to } = rangeDates(pf.range, pf.from, pf.to);

  // สาขา: ขอบเขตของเจ้าของ ∩ ตัวกรองหน้า (สาขา/แบรนด์) ∩ ตัวกรองคอลัมน์สาขา — ส่งเฉพาะที่มุมมองแสดง
  let allowed: string[] | null = v.data.link_branches ?? null;
  const all = (await sb.from("branches").select("id,name,name_th,code,brand_id").eq("is_active", true)).data ?? [];
  const narrow = (ids: string[]) => { allowed = allowed === null ? ids : allowed.filter((x) => ids.includes(x)); };
  if (pf.branchIds?.length) narrow(pf.branchIds);
  if (pf.brandIds?.length) narrow(all.filter((b) => b.brand_id && pf.brandIds!.includes(b.brand_id)).map((b) => b.id));
  const byName = state.filters?.branch?.values, byCode = state.filters?.branch_code?.values;
  if (byName?.length) narrow(all.filter((b) => byName.includes(b.name_th ?? b.name) || byName.includes(b.name)).map((b) => b.id));
  if (byCode?.length) narrow(all.filter((b) => byCode.includes(b.code)).map((b) => b.id));

  try {
    const data = await loadSalesData(sb, { from, to, allowed, showCost: false, own: null, legacy: state.page?.src !== "pos", publicView: true });
    void sb.from("pos_report_views").update({ link_views: (v.data.link_views ?? 0) + 1 }).eq("id", v.data.id).then(() => null);
    return reply({ view: { name: v.data.name, state: v.data.state }, range: { from, to }, data });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "อ่านข้อมูลไม่สำเร็จ" }, 503);
  }
}
