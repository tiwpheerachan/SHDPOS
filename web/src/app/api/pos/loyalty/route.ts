// /api/pos/loyalty — แต้มสะสมที่หน้าร้าน (สูตรเดียวกับตอนบันทึกบิล: pos_loyalty_calc)
//   POST { branch_id, channel, customer_id, grand_total, redeem_points, items:[{product_id, qty, is_gift}] } → พรีวิว "จะได้กี่แต้ม"
//   GET  ?client_uuid= → แต้มที่ได้จริงของบิล (จาก loyalty_ledger) สำหรับใบเสร็จ
//   GET  ?expiring=<customer_id>&days=30&branch_id= → แต้มที่จะหมดอายุ + ระดับสมาชิก (ตามแบรนด์ของสาขา)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

async function auth(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return null;
  return { allowed: await visibleBranchIds(authz) };
}

export async function POST(req: NextRequest) {
  const a = await auth(req);
  if (!a) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const branch = String(b?.branch_id ?? "");
  if (!UUID.test(branch)) return reply({ error: "สาขาไม่ถูกต้อง" }, 400);
  if (a.allowed !== null && !a.allowed.includes(branch)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);
  const net = Number(b?.grand_total);
  if (!Number.isFinite(net) || net < 0) return reply({ error: "ยอดไม่ถูกต้อง" }, 400);
  const items = (Array.isArray(b?.items) ? b!.items as { product_id?: string; qty?: number; is_gift?: boolean }[] : [])
    .filter((i) => UUID.test(String(i?.product_id))).slice(0, 200)
    .map((i) => ({ product_id: i.product_id, qty: Number(i.qty) || 0, is_gift: !!i.is_gift }));
  const customer = UUID.test(String(b?.customer_id)) ? String(b!.customer_id) : null;
  const r = await supabaseAdmin().rpc("pos_loyalty_calc", {
    p_branch: branch, p_channel: String(b?.channel ?? "offline").slice(0, 40), p_customer: customer,
    p_at: new Date().toISOString(), p_net: net, p_items: items, p_redeemed: Math.floor(Number(b?.redeem_points) || 0),
  });
  if (r.error) return reply({ error: "คำนวณแต้มไม่สำเร็จ" }, 503);
  return reply({ result: r.data });
}

export async function GET(req: NextRequest) {
  const a = await auth(req);
  if (!a) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const exp = req.nextUrl.searchParams.get("expiring");
  if (exp !== null) {
    if (!UUID.test(exp)) return reply({ error: "รหัสลูกค้าไม่ถูกต้อง" }, 400);
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);
    const sb = supabaseAdmin();
    const r = await sb.rpc("pos_points_expiring", { p_cust: exp, p_days: days });
    if (r.error) return reply({ error: "อ่านแต้มใกล้หมดอายุไม่สำเร็จ" }, 503);
    // ระดับสมาชิกตามแบรนด์ของสาขาที่ขาย (ไม่มีชุดระดับ = null)
    const br = req.nextUrl.searchParams.get("branch_id");
    let tier: unknown = null;
    if (br && UUID.test(br) && (a.allowed === null || a.allowed.includes(br))) {
      const b = await sb.from("branches").select("brand_id").eq("id", br).maybeSingle();
      const t = await sb.rpc("loyalty_customer_tier", { p_customer: exp, p_brand: b.data?.brand_id ?? null });
      if (!t.error) tier = t.data;
    }
    return reply({ expiring: r.data, days, tier });
  }
  const id = req.nextUrl.searchParams.get("client_uuid") ?? "";
  if (!UUID.test(id)) return reply({ error: "รหัสบิลไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  const o = await sb.from("orders").select("id,branch_id").eq("client_uuid", id).maybeSingle();
  if (o.error || !o.data) return reply({ earned: null });
  if (a.allowed !== null && !a.allowed.includes(o.data.branch_id as string)) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const l = await sb.from("loyalty_ledger").select("points_delta,detail,expires_at").eq("order_id", o.data.id).eq("kind", "earn").maybeSingle();
  return reply({ earned: l.data ? { points: l.data.points_delta, detail: l.data.detail, expires_at: l.data.expires_at } : { points: 0 } });
}
