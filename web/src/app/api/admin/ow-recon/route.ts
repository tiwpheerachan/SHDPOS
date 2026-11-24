// /api/admin/ow-recon — ตรวจความตรงกัน POS ↔ OneWarehouse ↔ JST
//   GET  ?run_id=   → ผลรอบล่าสุด (หรือรอบที่เลือก) + รายการรอบย้อนหลัง
//   POST {action:"run"} → ตรวจใหม่ทั้งหมดแล้วบันทึกผล
//   สิทธิ์: integration.reconcile
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { runRecon, latestRecon } from "@/lib/server/ow-recon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "integration.reconcile")) throw new PosError("ไม่มีสิทธิ์ตรวจความตรงกัน", 403);
  return { actor: authz.employee_id ?? null };
}
const fail = (e: unknown) => reply({ error: e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ" }, e instanceof PosError ? e.status : 503);

export async function GET(req: NextRequest) {
  try {
    await ctx(req);
    const run = req.nextUrl.searchParams.get("run_id");
    return reply(await latestRecon(run && UUID.test(run) ? run : undefined));
  } catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const { actor } = await ctx(req);
    const b = await req.json().catch(() => ({}));
    if (b.action !== "run") throw new PosError("คำสั่งไม่ถูกต้อง");
    return reply(await runRecon(actor));
  } catch (e) { return fail(e); }
}
