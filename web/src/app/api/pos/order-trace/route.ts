// /api/pos/order-trace?client_uuid= | ?order_no= — "ที่มาของบิล" แบบละเอียด (สิทธิ์ sales.trace · จำกัดสาขาที่เห็นได้)
//   ตรรกะอยู่ที่ lib/server/order-trace.ts (ใช้ร่วมกับเอกสารของบิล)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { buildOrderTrace, loadOrder } from "@/lib/server/order-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "sales.trace")) return reply({ error: "ไม่มีสิทธิ์ดูที่มาของบิล" }, 403);
  const allowed = await visibleBranchIds(authz);
  const showCost = hasPerm(profile.email, authz, "report.cost") || hasPerm(profile.email, authz, "report.gross_profit");
  const cu = req.nextUrl.searchParams.get("client_uuid"), no = req.nextUrl.searchParams.get("order_no");
  if (!(cu && UUID.test(cu)) && !(no && no.length < 60)) return reply({ error: "ระบุบิลไม่ถูกต้อง" }, 400);
  try {
    const o = await loadOrder(cu && UUID.test(cu) ? { client_uuid: cu } : { order_no: no });
    if (!o) return reply({ error: "ยังไม่พบบิลนี้ในระบบกลาง (อาจยังไม่ซิงก์)" }, 404);
    if (allowed !== null && !allowed.includes(o.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
    const t = await buildOrderTrace(o, showCost);
    return reply({ order: { order_no: o.order_no, client_uuid: o.client_uuid, status: o.status, grand_total: Number(o.grand_total), created_at: o.created_at, branch: t.raw.branch?.code ?? "" }, stages: t.stages, timeline: t.timeline, show_cost: showCost });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503); }
}
