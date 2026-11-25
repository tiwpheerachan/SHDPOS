// GET /api/pos/receipt-link?client_uuid= → ลิงก์ใบเสร็จออนไลน์ (ลงลายเซ็น) สำหรับ QR บนสลิป · ผู้ใช้ที่เห็นสาขาของบิล
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { visibleBranchIds } from "@/lib/sso/scope";
import { loadOrder } from "@/lib/server/order-trace";
import { docUrl } from "@/lib/server/order-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const cu = req.nextUrl.searchParams.get("client_uuid") ?? "";
  if (!UUID.test(cu)) return reply({ error: "ระบุบิลไม่ถูกต้อง" }, 400);
  try {
    const o = await loadOrder({ client_uuid: cu });
    if (!o) return reply({ url: null }); // ยังไม่ถึงระบบกลาง — สลิปไม่พิมพ์ QR
    const allowed = await visibleBranchIds(authz);
    if (allowed !== null && !allowed.includes(o.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
    return reply({ url: docUrl("receipt", cu) });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503); }
}
