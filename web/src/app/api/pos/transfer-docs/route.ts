// GET /api/pos/transfer-docs?id=<pos_transfer_id> → เอกสารของใบโอน (ใบส่ง/ใบรับ/ผลต่าง) · สิทธิ์ transfer.request + สาขาต้นทาง/ปลายทาง
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { loadTransfer, listTransferDocs } from "@/lib/server/transfer-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "transfer.request")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id || id.length > 80) return reply({ error: "ระบุใบโอนไม่ถูกต้อง" }, 400);
  try {
    const x = await loadTransfer(id);
    if (!x) return reply({ docs: [], reason: "ใบนี้ไม่ได้อยู่ในระบบคลังกลาง (โหมดสาธิต/ยังไม่ซิงก์)" });
    const allowed = await visibleBranchIds(authz);
    if (allowed !== null && ![x.t.from_branch_id, x.t.to_branch_id].some((b) => allowed.includes(b))) return reply({ error: "ไม่มีสิทธิ์ในสาขาของใบนี้" }, 403);
    return reply({ docs: listTransferDocs(x.t) });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503); }
}
