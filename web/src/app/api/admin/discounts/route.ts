// /api/admin/discounts?from=&to=&branch_id= — ประวัติส่วนลดรายบิล: ที่มา (พนักงาน/คูปอง/แต้ม/ของแถม) · ใครให้ · ส่งไป JST เป็นแบบไหน · สถานะ JST
//   สิทธิ์: report.discount · เห็นเฉพาะสาขาในขอบเขต
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { discountBreakdown, type BreakdownOrder } from "@/lib/discount-breakdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "report.discount")) return reply({ error: "ไม่มีสิทธิ์ดูประวัติส่วนลด" }, 403);
  const sp = req.nextUrl.searchParams;
  const to = sp.get("to") && !Number.isNaN(Date.parse(sp.get("to")!)) ? sp.get("to")! : new Date().toISOString();
  const from = sp.get("from") && !Number.isNaN(Date.parse(sp.get("from")!)) ? sp.get("from")! : new Date(Date.now() - 30 * 86400_000).toISOString();
  const branch = sp.get("branch_id");
  const allowed = await visibleBranchIds(authz);
  if (branch && !UUID.test(branch)) return reply({ error: "สาขาไม่ถูกต้อง" }, 400);
  if (branch && allowed && !allowed.includes(branch)) return reply({ error: "ไม่มีสิทธิ์สาขานี้" }, 403);
  const sb = supabaseAdmin();
  let q = sb.from("orders")
    .select("id,order_no,client_uuid,branch_id,status,created_at,sale_occurred_at,grand_total,discount_total,cashier_id,discount_approved_by,promo_snapshot,order_items(sku,name,qty,unit_price,discount_amount,is_gift,gift_source,gift_campaign_id)")
    .gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false }).limit(1000);
  if (branch) q = q.eq("branch_id", branch);
  else if (allowed) q = q.in("branch_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
  const { data: orders, error } = await q;
  if (error) return reply({ error: "อ่านบิลไม่สำเร็จ" }, 503);
  type O = NonNullable<typeof orders>[number];
  const withDisc = (orders ?? []).filter((o: O) => Number(o.discount_total) > 0 || (o.order_items as { is_gift: boolean | null }[]).some((i) => i.is_gift) || Number((o.promo_snapshot as { redeem_points?: number } | null)?.redeem_points ?? 0) > 0);
  // ชื่อแคมเปญ + ชื่อพนักงาน + ผลที่ส่ง JST
  const campIds = new Set<string>(), empIds = new Set<string>();
  for (const o of withDisc) {
    const c = (o.promo_snapshot as { coupon?: { campaign_id?: string } } | null)?.coupon?.campaign_id; if (c) campIds.add(c);
    for (const i of o.order_items as { gift_campaign_id: string | null }[]) if (i.gift_campaign_id) campIds.add(i.gift_campaign_id);
    if (o.cashier_id) empIds.add(o.cashier_id as string); if (o.discount_approved_by) empIds.add(o.discount_approved_by as string);
  }
  const [camps, emps, evs] = await Promise.all([
    campIds.size ? sb.from("campaigns").select("id,name,code").in("id", [...campIds]) : Promise.resolve({ data: [] as { id: string; name: string | null; code: string | null }[] }),
    empIds.size ? sb.from("employees").select("id,first_name,last_name,nickname").in("id", [...empIds]) : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; nickname: string | null }[] }),
    withDisc.length ? sb.from("pos_integration_events").select("aggregate_id,state,reason,response,payload").eq("event_type", "sale.committed").in("aggregate_id", withDisc.map((o) => o.client_uuid as string)) : Promise.resolve({ data: [] as { aggregate_id: string; state: string; reason: string | null; response: unknown; payload: unknown }[] }),
  ]);
  const cname = (id: string | null | undefined) => { const c = (camps.data ?? []).find((x) => x.id === id); return c ? String(c.name || c.code) : null; };
  const ename = (id: string | null | undefined) => { const e = (emps.data ?? []).find((x) => x.id === id); return e ? (e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ")) : null; };
  const evBy = new Map((evs.data ?? []).map((e) => [e.aggregate_id as string, e]));
  const rows = withDisc.map((o) => {
    const b = discountBreakdown({ grand_total: Number(o.grand_total), discount_total: Number(o.discount_total), promo_snapshot: o.promo_snapshot as BreakdownOrder["promo_snapshot"], items: o.order_items as BreakdownOrder["items"] }, cname);
    const ev = evBy.get(o.client_uuid as string);
    const sale = (ev?.response as { sale?: { saleNo?: string; status?: string; jstProgress?: { jstOrderNo?: string } } } | null)?.sale;
    const sent = (ev?.payload as { request?: { body?: { lines?: { lineDiscount?: number }[]; billDiscount?: number; remark?: string } } } | null)?.request?.body;
    return {
      order_no: o.order_no, branch_id: o.branch_id, status: o.status, sale_at: o.sale_occurred_at ?? o.created_at, grand_total: Number(o.grand_total),
      breakdown: b, cashier: ename(o.cashier_id as string), approved_by: ename(o.discount_approved_by as string),
      jst: ev ? {
        state: ev.state, ow_status: sale?.status ?? null, sale_no: sale?.saleNo ?? null, jst_order_no: sale?.jstProgress?.jstOrderNo ?? null,
        sent_line_discount: sent ? Math.round((sent.lines ?? []).reduce((a, l) => a + (l.lineDiscount ?? 0), 0) * 100) / 100 : null,
        sent_bill_discount: sent ? sent.billDiscount ?? 0 : null, remark: sent?.remark ?? null,
        // ยอดที่ส่ง JST ต้องตรงกับที่ระบบเราแยกไว้
        consistent: sent ? Math.abs(((sent.lines ?? []).reduce((a, l) => a + (l.lineDiscount ?? 0), 0)) - b.jst.lineDiscount) < 0.01 && Math.abs((sent.billDiscount ?? 0) - b.jst.billDiscount) < 0.01 : null,
      } : null,
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => Math.round(rows.reduce((a, r) => a + f(r), 0) * 100) / 100;
  return reply({
    from, to, rows,
    summary: {
      bills: rows.length, total: sum((r) => r.breakdown.total), line: sum((r) => r.breakdown.lineTotal), bill_manual: sum((r) => r.breakdown.billManual),
      coupon: sum((r) => r.breakdown.coupon?.amount ?? 0), points: sum((r) => r.breakdown.points?.value ?? 0), gifts: rows.reduce((a, r) => a + r.breakdown.gifts.length, 0),
    },
  });
}
