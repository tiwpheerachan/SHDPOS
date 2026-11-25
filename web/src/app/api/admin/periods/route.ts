// /api/admin/periods — ปิดงวดบัญชีรายเดือน รายสาขา (0075 · UAT F070/F068/F064)
//   GET  ?branch_id=&period=YYYY-MM → สาขาที่เห็น · 12 งวดล่าสุด (สถานะ/version) · สรุปยอดสด + snapshot ทุก version ของงวดที่เลือก
//   POST {action:"close", branch_id, period, note?}     สิทธิ์ period.close
//        {action:"reopen", branch_id, period, reason}   สิทธิ์ period.reopen (แยกจากผู้ปิด)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const fail = (e: unknown) => e instanceof PosError ? reply({ error: e.message }, e.status) : reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 500);
const OPEN_LABEL: Record<string, string> = { open_shifts: "กะที่ยังไม่ปิด", pending_returns: "คำขอคืน/ยกเลิกบิลที่รออนุมัติ", pending_deferred_sales: "บิลค้างส่งที่ยังไม่ลงบัญชี", open_counts: "รอบนับสต๊อกที่ยังไม่ปิด" };
function friendly(m: string): string {
  if (m.includes("period_not_ended")) return "งวดนี้ยังไม่จบเดือน — ปิดได้หลังสิ้นเดือน";
  if (m.includes("period_reopen_reason_required")) return "การเปิดงวดใหม่ต้องระบุเหตุผล (อย่างน้อย 5 ตัวอักษร)";
  if (m.includes("period_not_closed")) return "งวดนี้ยังไม่ได้ปิด";
  if (m.includes("period_has_open_items")) {
    try { const w = JSON.parse(m.slice(m.indexOf("{"))) as Record<string, number>; return "ยังปิดงวดไม่ได้ — มีรายการค้าง: " + Object.entries(w).filter(([, v]) => v > 0).map(([k, v]) => `${OPEN_LABEL[k] ?? k} ${v}`).join(" · "); } catch { return "ยังปิดงวดไม่ได้ — มีรายการค้าง"; }
  }
  return m;
}

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  const canClose = hasPerm(profile.email, authz, "period.close"), canReopen = hasPerm(profile.email, authz, "period.reopen");
  if (!authz.allowed || (!canClose && !canReopen && !hasPerm(profile.email, authz, "finance.view"))) throw new PosError("ไม่มีสิทธิ์ดูงวดบัญชี", 403);
  return { actor: authz.employee_id ?? null, canClose, canReopen, allowed: await visibleBranchIds(authz) };
}
const lastMonths = (n: number) => {
  const out: string[] = []; const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); }
  return out;
};
const range = (p: string) => { const [y, m] = p.split("-").map(Number); const last = new Date(y, m, 0).getDate(); return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, "0")}` }; };

export async function GET(req: NextRequest) {
  try {
    const c = await ctx(req);
    const sb = supabaseAdmin();
    let bq = sb.from("branches").select("id,code,name,name_th").eq("is_active", true).order("code");
    if (c.allowed !== null) bq = bq.in("id", c.allowed.length ? c.allowed : ["00000000-0000-0000-0000-000000000000"]);
    const branches = (await bq).data ?? [];
    const branch = req.nextUrl.searchParams.get("branch_id") ?? branches[0]?.id ?? "";
    if (!branch) return reply({ branches: [], periods: [], can_close: c.canClose, can_reopen: c.canReopen });
    if (!UUID.test(branch) || (c.allowed !== null && !c.allowed.includes(branch))) throw new PosError("ไม่มีสิทธิ์ในสาขานี้", 403);
    const months = lastMonths(12);
    const period = req.nextUrl.searchParams.get("period") ?? months[1];
    if (!PERIOD.test(period)) throw new PosError("งวดไม่ถูกต้อง");
    const [st, vers] = await Promise.all([
      sb.from("pos_periods").select("period,status,version,closed_by,closed_at,reopened_by,reopened_at,reopen_reason").eq("branch_id", branch).in("period", [...new Set([...months, period])]),
      sb.from("pos_period_versions").select("version,summary,closed_by,closed_at,note").eq("branch_id", branch).eq("period", period).order("version", { ascending: false }),
    ]);
    if (st.error) throw new PosError("อ่านงวดบัญชีไม่สำเร็จ — ตรวจ migration 0075", 503);
    const r = range(period);
    const live = await sb.rpc("pos_period_summary", { p_branch: branch, p_from: r.from, p_to: r.to });
    if (live.error) throw new PosError(live.error.message, 503);
    const people = new Set<string>();
    for (const p of st.data ?? []) { if (p.closed_by) people.add(p.closed_by); if (p.reopened_by) people.add(p.reopened_by); }
    for (const v of vers.data ?? []) if (v.closed_by) people.add(v.closed_by);
    const emps = people.size ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", [...people])).data ?? []) : [];
    const names = Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname]));
    const byP = new Map((st.data ?? []).map((p) => [p.period, p]));
    return reply({
      branches, branch_id: branch, period, can_close: c.canClose, can_reopen: c.canReopen, names,
      periods: months.map((m) => ({ ...(byP.get(m) ?? { status: "open", version: 0 }), period: m, ended: m !== months[0] })),
      current: byP.get(period) ?? { period, status: "open", version: 0 }, live: live.data, versions: vers.data ?? [],
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const c = await ctx(req);
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const branch = String(b?.branch_id ?? ""), period = String(b?.period ?? "");
    if (!UUID.test(branch) || !PERIOD.test(period)) throw new PosError("ระบุสาขา/งวดไม่ถูกต้อง");
    if (c.allowed !== null && !c.allowed.includes(branch)) throw new PosError("ไม่มีสิทธิ์ในสาขานี้", 403);
    if (!c.actor) throw new PosError("บัญชีนี้ยังไม่ผูกพนักงาน", 403);
    const sb = supabaseAdmin();
    if (b?.action === "close") {
      if (!c.canClose) throw new PosError("ไม่มีสิทธิ์ปิดงวด", 403);
      const r = await sb.rpc("pos_period_close", { p_actor: c.actor, p_branch: branch, p_period: period, p_note: typeof b.note === "string" ? b.note.slice(0, 500) : null });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    if (b?.action === "reopen") {
      if (!c.canReopen) throw new PosError("ไม่มีสิทธิ์เปิดงวดที่ปิดแล้ว — ต้องให้ผู้มีสิทธิ์ period.reopen ทำ", 403);
      const r = await sb.rpc("pos_period_reopen", { p_actor: c.actor, p_branch: branch, p_period: period, p_reason: String(b.reason ?? "").slice(0, 500) });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    throw new PosError("คำสั่งไม่ถูกต้อง");
  } catch (e) { return fail(e); }
}
