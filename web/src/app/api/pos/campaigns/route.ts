// GET /api/pos/campaigns?branch_id=&channel= — แคมเปญส่วนลดที่หน้าร้านกดเลือกได้ (การ์ด)
//   เฉพาะ: promo_type=discount · มีรหัส · active · ไม่เก็บถาวร · อยู่ในช่วงวันที่ (เวลาไทย) · สาขา/ช่องทางตรง · โควตายังเหลือ
//   เจาะจงสินค้า (eligible_scope≠all) → target_skus = SKU ที่ร่วมรายการ (การ์ดโชว์เมื่อมีสินค้านั้นในตะกร้า)
//   ยอดลดจริงคำนวณที่เซิร์ฟเวอร์ตอนชำระ (pos_promoted_quote) — ค่าที่นี่ใช้แสดงผล/ประเมินเท่านั้น
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { brandsSoldAtBranches, visibleBranchIds } from "@/lib/sso/scope";
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
  const sp = req.nextUrl.searchParams;
  const branch = sp.get("branch_id") ?? "";
  const channel = (sp.get("channel") ?? "").slice(0, 40);
  if (!UUID.test(branch)) return reply({ error: "สาขาไม่ถูกต้อง" }, 400);
  const allowed = await visibleBranchIds(authz);
  if (allowed !== null && !allowed.includes(branch)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);

  const sb = supabaseAdmin();
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // วันที่ไทย
  // สาขาหลายแบรนด์: แบรนด์หลัก + branch_brands
  let branchBrands: string[];
  try { branchBrands = await brandsSoldAtBranches([branch]); } catch { return reply({ error: "อ่านแบรนด์ของสาขาไม่สำเร็จ" }, 503); }
  const cs = await sb.from("campaigns")
    .select("id,code,name,description,discount_type,discount_value,max_discount,min_spend,starts_at,ends_at,branch_ids,brand_ids,channels,usage_limit,eligible_scope,eligible_min_qty,target_segment,is_automatic")
    .eq("active", true).eq("promo_type", "discount").is("archived_at", null).not("code", "is", null);
  if (cs.error) return reply({ error: "อ่านแคมเปญไม่สำเร็จ" }, 503);
  const list = (cs.data ?? []).filter((c) =>
    String(c.code ?? "").trim() &&
    (!c.starts_at || today >= c.starts_at) && (!c.ends_at || today <= c.ends_at) &&
    (!(c.branch_ids as string[] | null)?.length || (c.branch_ids as string[]).includes(branch)) &&
    (!(c.channels as string[] | null)?.length || !channel || (c.channels as string[]).includes(channel)) &&
    // แคมเปญผูกแบรนด์: สาขาต้องขายแบรนด์ใดแบรนด์หนึ่งของแคมเปญ (ถ้าไม่ผูกสาขาไว้ตรง ๆ)
    (!(c.brand_ids as string[] | null)?.length || (c.branch_ids as string[] | null)?.length || (c.brand_ids as string[]).some((b) => branchBrands.includes(b))));
  if (!list.length) return reply({ campaigns: [] });

  const ids = list.map((c) => c.id as string);
  const [prods, uses] = await Promise.all([
    sb.from("campaign_products").select("campaign_id,sku,role").in("campaign_id", ids).eq("role", "eligible"),
    sb.from("pos_campaign_uses").select("campaign_id").in("campaign_id", ids),
  ]);
  if (prods.error || uses.error) return reply({ error: "อ่านรายละเอียดแคมเปญไม่สำเร็จ" }, 503);
  const used = new Map<string, number>();
  for (const u of uses.data ?? []) used.set(u.campaign_id as string, (used.get(u.campaign_id as string) ?? 0) + 1);

  const campaigns = list.flatMap((c) => {
    const left = c.usage_limit == null ? null : Math.max(0, Number(c.usage_limit) - (used.get(c.id as string) ?? 0));
    if (left === 0) return []; // โควตาหมด
    const skus = c.eligible_scope === "all" ? [] : (prods.data ?? []).filter((p) => p.campaign_id === c.id).map((p) => p.sku as string).filter(Boolean);
    if (c.eligible_scope !== "all" && !skus.length) return []; // เจาะจงสินค้าแต่ไม่มีสินค้า = ใช้ไม่ได้
    return [{
      id: c.id, code: String(c.code).toUpperCase(), name: c.name, desc: c.description ?? null,
      type: c.discount_type === "percent" ? "percent" : "amount", value: Number(c.discount_value) || 0,
      min_spend: Number(c.min_spend) || 0, max_discount: c.max_discount == null ? null : Number(c.max_discount),
      color: "#7950D8", product_sku: skus[0] ?? null, target_skus: skus, active: true, until: c.ends_at ?? null,
      uses_left: left, segment: c.target_segment && c.target_segment !== "all" ? c.target_segment : null,
    }];
  });
  return reply({ campaigns });
}
