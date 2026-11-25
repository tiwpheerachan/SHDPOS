// =====================================================================
// /api/admin/ow-salesmen — ผูกพนักงาน POS ↔ พนักงานขาย JST (ERIS-254) รายสาขา
//   GET  ?branch_id=  → พนักงานของสาขา (สังกัด + เคยขาย 90 วัน) + การผูกเดิม + รายชื่อจาก OW GET /v1/sales/salesmen
//   POST {branch_id, employee_id, jst_user_id|null, jst_name?} → ผูก/ยกเลิกผูก
//   บิลที่ส่ง OW หลังผูกจะมี salespersonId (พนักงานขาย ถ้าไม่ระบุใช้แคชเชียร์) · สิทธิ์: integration.manage
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "@/lib/server/ow-gateway";
import { owCall } from "@/lib/server/ow-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const fail = (e: unknown) => reply({ error: e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ" }, e instanceof PosError ? e.status : 503);

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "integration.manage")) throw new PosError("ไม่มีสิทธิ์จัดการการเชื่อมคลังกลาง", 403);
  if (!authz.employee_id) throw new PosError("ไม่พบพนักงานของบัญชีนี้", 403);
  return { actor: authz.employee_id };
}

export async function GET(req: NextRequest) {
  try {
    await ctx(req);
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("สาขาไม่ถูกต้อง", 400);
    const sb = supabaseAdmin();
    const source = owConfig().source;
    const link = await sb.from("pos_ow_sale_branches").select("ow_branch_id").eq("source", source).eq("branch_id", branch).maybeSingle();
    if (link.error) throw new Error("อ่านการผูกสาขาไม่สำเร็จ");
    if (!link.data) return reply({ linked: false, employees: [], map: [], jst: [], jst_error: "สาขานี้ยังไม่ผูกสาขาขาย OneWarehouse" });
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [eb, home, sold, map] = await Promise.all([
      sb.from("employee_branches").select("employee_id").eq("branch_id", branch),
      sb.from("employees").select("id").eq("home_branch_id", branch),
      sb.from("orders").select("cashier_id,salesperson_id").eq("branch_id", branch).gte("created_at", since).limit(2000),
      sb.from("pos_ow_salesperson_map").select("employee_id,jst_user_id,jst_name,updated_at").eq("source", source).eq("branch_id", branch),
    ]);
    if (eb.error || home.error || sold.error || map.error) throw new Error("อ่านพนักงานของสาขาไม่สำเร็จ — ตรวจ migration 0063");
    const ids = new Set<string>([
      ...(eb.data ?? []).map((r) => r.employee_id as string), ...(home.data ?? []).map((r) => r.id as string),
      ...(sold.data ?? []).flatMap((r) => [r.cashier_id, r.salesperson_id]).filter(Boolean) as string[],
      ...(map.data ?? []).map((r) => r.employee_id as string),
    ]);
    const emps = ids.size ? (await sb.from("employees").select("id,employee_code,first_name,last_name,nickname,job_title,status").in("id", [...ids])).data ?? [] : [];
    const salesCount = new Map<string, number>();
    for (const r of sold.data ?? []) { const w = (r.salesperson_id ?? r.cashier_id) as string | null; if (w) salesCount.set(w, (salesCount.get(w) ?? 0) + 1); }
    const r = await owCall<{ id: string; name: string }[]>("GET", `sales/salesmen?branchId=${encodeURIComponent(String(link.data.ow_branch_id))}`);
    return reply({
      linked: true, ow_branch_id: link.data.ow_branch_id,
      employees: emps.map((e) => ({ ...e, bills_90d: salesCount.get(e.id as string) ?? 0 })).sort((a, b) => b.bills_90d - a.bills_90d),
      map: map.data ?? [],
      jst: r.ok && Array.isArray(r.data) ? r.data : [],
      jst_error: r.ok ? null : `ดึงรายชื่อพนักงานขายจาก OW ไม่ได้ (${r.status}${r.error?.message ? `: ${r.error.message}` : ""}) — กรอก JST UserId เองได้`,
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const { actor } = await ctx(req);
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!UUID.test(String(b?.branch_id)) || !UUID.test(String(b?.employee_id))) throw new PosError("ข้อมูลไม่ถูกต้อง", 400);
    const sb = supabaseAdmin();
    const source = owConfig().source;
    const key = { source, branch_id: String(b!.branch_id), employee_id: String(b!.employee_id) };
    const jst = typeof b?.jst_user_id === "string" ? b.jst_user_id.trim() : "";
    if (!jst) {
      const d = await sb.from("pos_ow_salesperson_map").delete().match(key);
      if (d.error) throw new Error("ยกเลิกผูกไม่สำเร็จ");
    } else {
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(jst)) throw new PosError("JST UserId ไม่ถูกต้อง", 400);
      const u = await sb.from("pos_ow_salesperson_map").upsert({ ...key, jst_user_id: jst, jst_name: typeof b?.jst_name === "string" ? b.jst_name.slice(0, 200) : null, updated_by: actor, updated_at: new Date().toISOString() });
      if (u.error) throw new Error("บันทึกการผูกไม่สำเร็จ");
    }
    await sb.from("audit_logs").insert({ action: "ow_salesperson_map", actor_id: actor, branch_id: key.branch_id, ref_table: "employees", ref_id: key.employee_id, after_data: { jst_user_id: jst || null } });
    return reply({ ok: true });
  } catch (e) { return fail(e); }
}
