// =====================================================================
// /api/admin/presence — ใครออนไลน์อยู่หน้าไหน (หลังบ้าน)
//   POST { path, label }  ส่งสัญญาณว่ายังอยู่ (ทุกคนที่เข้าแอปได้) — เก็บแค่ชื่อ/รูป/หน้า ไม่เก็บอย่างอื่น
//   GET                   รายชื่อที่ออนไลน์ใน 2 นาทีล่าสุด (สิทธิ์ presence.view)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const ONLINE_MS = 2 * 60_000;

export async function POST(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "unauthenticated" }, 401);
  const b = (await req.json().catch(() => null)) as { path?: unknown; label?: unknown; leave?: unknown } | null;
  const path = typeof b?.path === "string" && b.path.startsWith("/") ? b.path.slice(0, 200) : null;
  if (!path) return reply({ error: "bad path" }, 400);
  const sb = supabaseAdmin();
  if (b?.leave) { await sb.from("admin_presence").delete().eq("email", profile.email); return reply({ ok: true }); }
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "forbidden" }, 403);
  const r = await sb.from("admin_presence").upsert({
    email: profile.email, name: profile.name || profile.email.split("@")[0], avatar_url: profile.avatar_url ?? null,
    path, page_label: typeof b?.label === "string" ? b.label.slice(0, 80) : null, updated_at: new Date().toISOString(),
  }, { onConflict: "email" });
  if (r.error) return reply({ error: r.error.message }, 500);
  return reply({ ok: true });
}

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "unauthenticated" }, 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "presence.view")) return reply({ error: "forbidden" }, 403);
  const sb = supabaseAdmin();
  const r = await sb.from("admin_presence").select("email,name,avatar_url,path,page_label,updated_at")
    .gte("updated_at", new Date(Date.now() - ONLINE_MS).toISOString()).order("updated_at", { ascending: false }).limit(100);
  if (r.error) return reply({ error: r.error.message }, 500);
  // ไม่ส่งอีเมลคนอื่นออกไป — ใช้ key แบบย่อแทน (ระบุตัวเองด้วย me)
  return reply({ people: (r.data ?? []).map((p) => ({ key: p.email === profile.email ? "me" : p.email.split("@")[0], me: p.email === profile.email, name: p.name, avatar_url: p.avatar_url, path: p.path, label: p.page_label, at: p.updated_at })) });
}
