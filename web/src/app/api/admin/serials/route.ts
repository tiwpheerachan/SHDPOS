// =====================================================================
// GET /api/admin/serials?product_id=<uuid>
//   ทะเบียน SN กลาง (ตาราง serials) ของสินค้า 1 ตัว — ใช้ในหน้าสต๊อก (Drawer รายละเอียด SN)
//   สิทธิ์: inventory.view · ขอบเขต: เฉพาะสาขาที่เห็นได้ (+ SN ที่ยังไม่ผูกสาขา)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "inventory.view")) return reply({ error: "ไม่มีสิทธิ์ดูสต๊อก" }, 403);
  const productId = req.nextUrl.searchParams.get("product_id") ?? "";
  if (!UUID.test(productId)) return reply({ error: "สินค้าไม่ถูกต้อง" }, 400);

  const allowed = await visibleBranchIds(authz);
  let q = supabaseAdmin()
    .from("serials")
    .select("serial_no,imei,branch_id,status,received_at,sold_at,sold_order_id,warranty_start,warranty_end,note,updated_at")
    .eq("product_id", productId)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (allowed) q = allowed.length ? q.or(`branch_id.in.(${allowed.join(",")}),branch_id.is.null`) : q.is("branch_id", null);
  const { data, error } = await q;
  if (error) return reply({ error: "อ่านทะเบียน SN ไม่สำเร็จ" }, 503);
  return reply({ serials: data ?? [], truncated: (data?.length ?? 0) >= 2000 });
}
