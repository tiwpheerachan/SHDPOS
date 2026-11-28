// /api/admin/ai-dashboards — แดชบอร์ด AI Studio ที่บันทึก (ของฉัน + ทีม + แชร์ให้ฉัน)
//   GET → รายการ (?id= → ตัวเดียวพร้อมสเปก) · POST {id?, name, spec, sources, shared?, shared_with?} · DELETE ?id=
//   สิทธิ์: report.employee_perf (เหมือนผู้ช่วย AI) · แก้/ลบได้เฉพาะของตัวเอง
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const sameOrigin = (req: NextRequest) => !req.headers.get("origin") || new URL(req.headers.get("origin")!).host === req.nextUrl.host;

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id || !hasPerm(profile.email, authz, "report.employee_perf")) return null;
  return { me: authz.employee_id };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const sb = supabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");
  const vis = `owner_id.eq.${c.me},shared.eq.true,shared_with.cs.{${c.me}}`;
  if (id) {
    if (!UUID.test(id)) return reply({ error: "id" }, 400);
    const r = await sb.from("ai_dashboards").select("id,name,spec,sources,shared,shared_with,owner_id,updated_at").eq("id", id).or(vis).maybeSingle();
    if (!r.data) return reply({ error: "ไม่พบแดชบอร์ด หรือไม่ได้แชร์ให้คุณ" }, 404);
    return reply({ dashboard: { ...r.data, mine: r.data.owner_id === c.me } });
  }
  const r = await sb.from("ai_dashboards").select("id,name,sources,shared,shared_with,owner_id,updated_at").or(vis).order("updated_at", { ascending: false }).limit(100);
  if (r.error) return reply({ error: r.error.message }, 503);
  const owners = [...new Set((r.data ?? []).map((d) => d.owner_id))];
  const emps = owners.length ? ((await sb.from("employees").select("id,first_name,nickname").in("id", owners)).data ?? []) : [];
  const nm = new Map(emps.map((e) => [e.id, e.nickname || e.first_name]));
  return reply({ dashboards: (r.data ?? []).map((d) => ({ ...d, mine: d.owner_id === c.me, owner: nm.get(d.owner_id) ?? "" })) });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as { id?: string; name?: string; spec?: unknown; sources?: unknown; shared?: boolean; shared_with?: unknown } | null;
  const name = String(b?.name ?? "").trim().slice(0, 120);
  if (!name || !b?.spec || typeof b.spec !== "object" || JSON.stringify(b.spec).length > 200_000) return reply({ error: "ข้อมูลแดชบอร์ดไม่ถูกต้อง" }, 400);
  const sharedWith = Array.isArray(b.shared_with) ? [...new Set(b.shared_with.map(String).filter((x) => UUID.test(x) && x !== c.me))].slice(0, 200) : undefined;
  const sb = supabaseAdmin();
  const row = { name, spec: b.spec, sources: b.sources ?? {}, shared: !!b.shared, ...(sharedWith ? { shared_with: sharedWith } : {}), updated_at: new Date().toISOString() };
  if (b.id && UUID.test(b.id)) {
    const r = await sb.from("ai_dashboards").update(row).eq("id", b.id).eq("owner_id", c.me).select("id").maybeSingle();
    if (!r.data) return reply({ error: "แก้ได้เฉพาะแดชบอร์ดของตัวเอง" }, 403);
    return reply({ id: r.data.id });
  }
  const r = await sb.from("ai_dashboards").insert({ ...row, owner_id: c.me }).select("id").single();
  if (r.error) return reply({ error: r.error.message }, 400);
  return reply({ id: r.data.id });
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return reply({ error: "id" }, 400);
  const r = await supabaseAdmin().from("ai_dashboards").delete().eq("id", id).eq("owner_id", c.me).select("id");
  return r.data?.length ? reply({ ok: true }) : reply({ error: "ลบได้เฉพาะของตัวเอง" }, 403);
}
