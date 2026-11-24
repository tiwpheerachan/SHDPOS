// /api/pos/ow-sale-status?ids=<client_uuid,...> — สถานะบิลในคลังกลาง/JST ต่อบิล (สำหรับแสดงในหน้ารายการบิล)
//   คืน { [client_uuid]: { state, ow_status, sale_no, jst_order_no, reason, sent_at } } · เห็นเฉพาะบิลในสาขาที่มีสิทธิ์
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const ids = [...new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, 300);
  if (!ids.length) return reply({ items: {} });
  const sb = supabaseAdmin();
  const allowed = await visibleBranchIds(authz);
  const ord = await sb.from("orders").select("client_uuid,branch_id").in("client_uuid", ids);
  if (ord.error) return reply({ error: "อ่านบิลไม่สำเร็จ" }, 503);
  const ok = new Set((ord.data ?? []).filter((o) => allowed === null || allowed.includes(o.branch_id as string)).map((o) => o.client_uuid as string));
  const visible = ids.filter((i) => ok.has(i));
  if (!visible.length) return reply({ items: {} });
  const ev = await sb.from("pos_integration_events").select("aggregate_id,state,reason,response,updated_at").eq("event_type", "sale.committed").in("aggregate_id", visible);
  if (ev.error) return reply({ error: "อ่านสถานะคลังกลางไม่สำเร็จ" }, 503);
  const items: Record<string, unknown> = {};
  for (const e of ev.data ?? []) {
    const s = (e.response ?? {}) as { sale?: { saleNo?: string; status?: string; jstProgress?: { jstOrderNo?: string; submittedAt?: string } } };
    items[e.aggregate_id as string] = {
      state: e.state, reason: e.reason, ow_status: s.sale?.status ?? null, sale_no: s.sale?.saleNo ?? null,
      jst_order_no: s.sale?.jstProgress?.jstOrderNo ?? null, sent_at: s.sale?.jstProgress?.submittedAt ?? null, updated_at: e.updated_at,
    };
  }
  return reply({ items });
}
