// /api/admin/branch-brands — สาขาไหนขายแบรนด์อะไร (แบรนด์หลัก branches.brand_id ∪ branch_brands)
//   GET  → { map: { [branch_id]: brand_id[] }, primary: { [branch_id]: brand_id|null } } (เฉพาะสาขาที่ผู้ใช้เห็น)
//   POST { branch_id, brand_ids } → ตั้งแบรนด์ที่สาขาขาย (แบรนด์หลักรวมเสมอ) · สิทธิ์ admin.branch_manage
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { branchBrandMap } from "@/lib/server/branch-brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  return { profile, authz: await resolveAuthz(profile) };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  try { return reply(await branchBrandMap(await visibleBranchIds(c.authz))); }
  catch (e) { return reply({ error: e instanceof Error ? e.message : "อ่านไม่สำเร็จ" }, 503); }
}

export async function POST(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  if (!hasPerm(c.profile.email, c.authz, "admin.branch_manage")) return reply({ error: "ไม่มีสิทธิ์จัดการสาขา" }, 403);
  const b = (await req.json().catch(() => null)) as { branch_id?: string; brand_ids?: unknown } | null;
  const branchId = String(b?.branch_id ?? "");
  if (!UUID.test(branchId)) return reply({ error: "ระบุสาขาไม่ถูกต้อง" }, 400);
  const ids = [...new Set((Array.isArray(b?.brand_ids) ? b!.brand_ids : []).map(String))];
  if (ids.some((x) => !UUID.test(x)) || ids.length > 50) return reply({ error: "รายการแบรนด์ไม่ถูกต้อง" }, 400);
  const allowed = await visibleBranchIds(c.authz);
  if (allowed && !allowed.includes(branchId)) return reply({ error: "สาขานี้อยู่นอกขอบเขตของคุณ" }, 403);
  const sb = supabaseAdmin();
  const br = await sb.from("branches").select("id,brand_id").eq("id", branchId).maybeSingle();
  if (!br.data) return reply({ error: "ไม่พบสาขา" }, 404);
  if (br.data.brand_id && !ids.includes(br.data.brand_id)) ids.unshift(br.data.brand_id); // แบรนด์หลักต้องอยู่เสมอ
  const known = await sb.from("brands").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if ((known.data ?? []).length !== ids.length) return reply({ error: "มีแบรนด์ที่ไม่มีในระบบ" }, 400);
  const before = await sb.from("branch_brands").select("brand_id").eq("branch_id", branchId);
  const del = await sb.from("branch_brands").delete().eq("branch_id", branchId).not("brand_id", "in", `(${ids.join(",") || "00000000-0000-0000-0000-000000000000"})`);
  if (del.error) return reply({ error: del.error.message }, 503);
  if (ids.length) {
    const ins = await sb.from("branch_brands").upsert(ids.map((brand_id) => ({ branch_id: branchId, brand_id })), { onConflict: "branch_id,brand_id", ignoreDuplicates: true });
    if (ins.error) return reply({ error: ins.error.message }, 503);
  }
  return reply({ ok: true, brand_ids: ids, before: (before.data ?? []).map((x) => x.brand_id) });
}
