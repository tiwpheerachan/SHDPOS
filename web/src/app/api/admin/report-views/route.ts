// /api/admin/report-views — มุมมองรายงานที่บันทึกไว้ (ตัวกรอง+แท็บ) ของตัวเอง + ที่เพื่อนแชร์ให้ทีม (0079)
//   GET ?report=sales · POST {id?, name, state, shared} (แก้ได้เฉพาะของตัวเอง) · DELETE ?id= (ของตัวเอง)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id || !hasPerm(profile.email, authz, "sales.view")) return null;
  return { me: authz.employee_id };
}
export async function GET(req: NextRequest) {
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const report = req.nextUrl.searchParams.get("report") ?? "sales";
  const sb = supabaseAdmin();
  const r = await sb.from("pos_report_views").select("id,name,state,shared,owner_id,updated_at").eq("report", report).or(`owner_id.eq.${c.me},shared.eq.true`).order("updated_at", { ascending: false }).limit(100);
  if (r.error) return reply({ error: "อ่านมุมมองไม่สำเร็จ — ตรวจ migration 0079" }, 503);
  const owners = [...new Set((r.data ?? []).map((v) => v.owner_id))];
  const emps = owners.length ? ((await sb.from("employees").select("id,first_name,nickname").in("id", owners)).data ?? []) : [];
  const names = Object.fromEntries(emps.map((e) => [e.id, e.nickname || e.first_name]));
  return reply({ views: (r.data ?? []).map((v) => ({ ...v, mine: v.owner_id === c.me, owner: names[v.owner_id] ?? "" })) });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as { id?: string; name?: string; state?: unknown; shared?: boolean; report?: string } | null;
  const name = String(b?.name ?? "").trim().slice(0, 80);
  if (!name || !b?.state || typeof b.state !== "object" || JSON.stringify(b.state).length > 8000) return reply({ error: "ข้อมูลมุมมองไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  if (b.id && UUID.test(b.id)) {
    const r = await sb.from("pos_report_views").update({ name, state: b.state, shared: !!b.shared, updated_at: new Date().toISOString() }).eq("id", b.id).eq("owner_id", c.me).select("id").maybeSingle();
    if (!r.data) return reply({ error: "แก้ได้เฉพาะมุมมองของตัวเอง" }, 403);
    return reply({ id: r.data.id });
  }
  const r = await sb.from("pos_report_views").insert({ report: b.report ?? "sales", name, state: b.state, shared: !!b.shared, owner_id: c.me }).select("id").single();
  if (r.error) return reply({ error: r.error.message }, 400);
  return reply({ id: r.data.id });
}
export async function DELETE(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return reply({ error: "id" }, 400);
  const r = await supabaseAdmin().from("pos_report_views").delete().eq("id", id).eq("owner_id", c.me).select("id");
  return r.data?.length ? reply({ ok: true }) : reply({ error: "ลบได้เฉพาะมุมมองของตัวเอง" }, 403);
}
