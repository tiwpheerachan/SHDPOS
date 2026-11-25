// /api/doc/[token] — ข้อมูลเอกสารสำหรับหน้าแชร์ /doc/[token]
//   เอกสารลูกค้า (ใบเสร็จ/ใบกำกับ/ใบคืน/ใบรับประกัน): เปิดได้ด้วยลิงก์ที่ลงลายเซ็น (ไม่ต้องล็อกอิน · หมดอายุ 90 วัน · ปิดเบอร์ลูกค้าบางส่วน)
//   เอกสารภายใน (รายงานที่มาของบิล): ต้องล็อกอิน + สิทธิ์ sales.trace + เห็นสาขาของบิล
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { verifyDocToken, INTERNAL_KINDS } from "@/lib/server/doc-token";
import { buildDoc } from "@/lib/server/order-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  let p;
  try { p = verifyDocToken(decodeURIComponent(params.token)); } catch (e) { return reply({ error: e instanceof Error ? e.message : "ตั้งค่าไม่ครบ" }, 503); }
  if (!p) return reply({ error: "ลิงก์เอกสารไม่ถูกต้องหรือหมดอายุแล้ว — ขอลิงก์ใหม่จากสาขา" }, 404);
  try {
    const built = await buildDoc(p.k, p.id);
    if (!built) return reply({ error: "ไม่พบเอกสาร" }, 404);
    if (INTERNAL_KINDS.includes(p.k)) {
      const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
      if (!profile) return reply({ error: "เอกสารภายใน — กรุณาเข้าสู่ระบบก่อน", login: true }, 401);
      const authz = await resolveAuthz(profile);
      if (!authz.allowed || !hasPerm(profile.email, authz, "sales.trace")) return reply({ error: "ไม่มีสิทธิ์ดูเอกสารภายใน" }, 403);
      const allowed = await visibleBranchIds(authz);
      if (allowed !== null && !allowed.includes(built.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
    }
    return reply({ doc: built.doc, expires_at: new Date(p.e * 1000).toISOString() });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "สร้างเอกสารไม่สำเร็จ" }, 503); }
}
