// /api/pos/ow-sale-status?ids=<client_uuid,...> — สถานะบิลในคลังกลาง/JST ต่อบิล (สำหรับแสดงในหน้ารายการบิล)
//   คืน { [client_uuid]: { state, ow_status, sale_no, jst_order_no, reason, sent_at } } · เห็นเฉพาะบิลในสาขาที่มีสิทธิ์
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resubmitFailedSale, kickSaleOutbox } from "@/lib/server/ow-sales";

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
  const ev = await sb.from("pos_integration_events").select("id,aggregate_id,state,reason,response,updated_at").eq("event_type", "sale.committed").in("aggregate_id", visible);
  if (ev.error) return reply({ error: "อ่านสถานะคลังกลางไม่สำเร็จ" }, 503);
  const items: Record<string, unknown> = {};
  for (const e of ev.data ?? []) {
    const s = (e.response ?? {}) as { sale?: { saleNo?: string; status?: string; jstProgress?: { jstOrderNo?: string; submittedAt?: string } } };
    items[e.aggregate_id as string] = {
      event_id: e.id, state: e.state, reason: e.reason, ow_status: s.sale?.status ?? null, sale_no: s.sale?.saleNo ?? null,
      jst_order_no: s.sale?.jstProgress?.jstOrderNo ?? null, sent_at: s.sale?.jstProgress?.submittedAt ?? null, updated_at: e.updated_at,
    };
  }
  return reply({ items });
}

// POST { client_uuid } — หน้าร้านกด "ส่งใหม่" บิลที่ JST ไม่รับ (failed) หลังแก้สาเหตุแล้ว (เช่น เปิด SKU ในสาขา)
//   ส่งบิลเดิมซ้ำด้วย PATCH (ไม่สร้างบิลใหม่) · จำกัดเฉพาะบิลในสาขาที่มีสิทธิ์ · สถานะอื่น = ปลุกคิวส่งให้เท่านั้น
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as { client_uuid?: string } | null;
  const id = b?.client_uuid ?? "";
  if (!UUID.test(id)) return reply({ error: "รหัสบิลไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  const ord = await sb.from("orders").select("branch_id").eq("client_uuid", id).maybeSingle();
  if (ord.error || !ord.data) return reply({ error: "ไม่พบบิล" }, 404);
  const allowed = await visibleBranchIds(authz);
  if (allowed !== null && !allowed.includes(ord.data.branch_id as string)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);
  const ev = await sb.from("pos_integration_events").select("id,state,response").eq("event_type", "sale.committed").eq("aggregate_id", id).maybeSingle();
  if (ev.error || !ev.data) return reply({ error: "บิลนี้ไม่ได้ส่งคลังกลาง" }, 404);
  if (ev.data.state === "delivered") return reply({ ok: true, already: true });
  if ((ev.data.response as { sale?: { status?: string } } | null)?.sale?.status === "failed") {
    const r = await resubmitFailedSale(ev.data.id as string);
    return r.ok ? reply(r) : reply({ error: `JST ยังไม่รับบิล: ${r.reason ?? r.status}` }, 422);
  }
  kickSaleOutbox();
  return reply({ ok: true, queued: true });
}
