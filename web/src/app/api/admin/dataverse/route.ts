// =====================================================================
// /api/admin/dataverse — ยอดขายระบบเดิม (Lark) จาก Dataverse (สิทธิ์ integration.manage)
//   GET  → สถานะ (ตั้งค่า key แล้วไหม) · สรุปรายเดือน · การจับคู่ร้าน · วันเริ่มใช้ POS ของสาขา · ประวัติการดึง
//   POST { action: "sync", month: "YYYY-MM" }                 ดึงทีละเดือน (หน้าเว็บวนเดือนให้ตอนดึงย้อนหลัง)
//        { action: "map", place_key, branch_id|null }          จับคู่ร้านเอง (ทับการจับอัตโนมัติ) + อัปเดตบรรทัดเดิม
//        { action: "go_live", branch_id, date|null }           วันเริ่มใช้ POS (ตั้งแต่วันนั้นนับยอดจาก POS)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dataverseReady, monthRange, syncLegacyRange } from "@/lib/server/dataverse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  return hasPerm(profile.email, authz, "integration.manage") ? { profile, authz } : null;
}

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const sb = supabaseAdmin();
  const [months, places, branches, runs] = await Promise.all([
    sb.from("legacy_sales_monthly").select("*").order("ym", { ascending: false }),
    sb.from("dv_place_map").select("place_key,dv_place_id,place_name,channel,brand_ids,branch_id,matched_by,score,lines,last_sale").order("lines", { ascending: false }).limit(500),
    sb.from("branches").select("id,code,name,name_th,branch_type,pos_go_live_date,is_active").eq("is_active", true).order("code"),
    sb.from("legacy_sync_runs").select("*").order("id", { ascending: false }).limit(20),
  ]);
  const err = [months, places, branches, runs].find((r) => r.error);
  if (err?.error) return reply({ error: err.error.message }, 503);
  return reply({ ready: dataverseReady(), months: months.data ?? [], places: places.data ?? [], branches: branches.data ?? [], runs: runs.data ?? [] });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (!g) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  if (b.action === "sync") {
    const ym = String(b.month ?? "");
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(ym)) return reply({ error: "เดือนไม่ถูกต้อง" }, 400);
    if (!dataverseReady()) return reply({ error: "ยังไม่ได้ตั้งค่า DATAVERSE_API_KEY บนเซิร์ฟเวอร์" }, 409);
    const { from, to } = monthRange(ym);
    try { return reply({ ok: true, month: ym, ...(await syncLegacyRange(sb, from, to, b.backfill ? "backfill" : "manual", g.profile.email)) }); }
    catch (e) { return reply({ error: e instanceof Error ? e.message : "ดึงข้อมูลไม่สำเร็จ" }, 502); }
  }
  if (b.action === "map") {
    const key = String(b.place_key ?? "");
    const bid = b.branch_id === null || b.branch_id === "" ? null : String(b.branch_id);
    if (!key || (bid !== null && !UUID.test(bid))) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const r = await sb.from("dv_place_map").update({ branch_id: bid, matched_by: "manual", updated_at: new Date().toISOString() }).eq("place_key", key);
    if (r.error) return reply({ error: r.error.message }, 500);
    const u = await sb.from("legacy_sales_lines").update({ branch_id: bid }).eq("place_key", key); // บรรทัดที่ดึงมาแล้วเปลี่ยนตาม
    if (u.error) return reply({ error: u.error.message }, 500);
    return reply({ ok: true });
  }
  if (b.action === "go_live") {
    const bid = String(b.branch_id ?? "");
    const date = b.date === null || b.date === "" ? null : String(b.date);
    if (!UUID.test(bid) || (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const r = await sb.from("branches").update({ pos_go_live_date: date }).eq("id", bid);
    if (r.error) return reply({ error: r.error.message }, 500);
    return reply({ ok: true });
  }
  return reply({ error: "action ไม่ถูกต้อง" }, 400);
}
