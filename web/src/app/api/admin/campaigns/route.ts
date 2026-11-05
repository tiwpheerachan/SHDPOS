import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { visibleBranchIds, visibleBrandIds } from "@/lib/sso/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------------
// GET — รายการแคมเปญ + สถิติการใช้ (ครั้ง / ส่วนลดรวม / ยอดขายที่เกิดขึ้น)
// ---------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");

  // ---------- รายงานแคมเปญรายตัว ----------
  if (id) {
    const [{ data: camp }, { data: reds }, { data: gifts }, { data: branches }] = await Promise.all([
      sb.from("campaigns").select("*").eq("id", id).maybeSingle(),
      sb.from("coupon_redemptions").select("customer_id,order_id,discount_amount,order_total,created_at").eq("campaign_id", id).order("created_at", { ascending: false }).limit(500),
      sb.from("order_items").select("qty,cost_total,order_id").eq("gift_campaign_id", id).limit(2000),
      sb.from("branches").select("id,name,name_th"),
    ]);
    if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });

    const brName: Record<string, string> = {};
    for (const b of branches ?? []) brName[b.id] = (b.name_th as string) || (b.name as string);

    // map order_id → branch_id สำหรับบรรทัดของแถม
    const giftOrderIds = [...new Set((gifts ?? []).map((g) => g.order_id).filter(Boolean))] as string[];
    const orderBranch: Record<string, string> = {};
    if (giftOrderIds.length) {
      const { data: ords } = await sb.from("orders").select("id,branch_id").in("id", giftOrderIds);
      for (const o of ords ?? []) orderBranch[o.id] = o.branch_id as string;
    }

    const uses = (reds ?? []).length;
    const customers = new Set((reds ?? []).map((r) => r.customer_id).filter(Boolean)).size;
    const discountTotal = (reds ?? []).reduce((s, r) => s + Number(r.discount_amount ?? 0), 0);
    const revenue = (reds ?? []).reduce((s, r) => s + Number(r.order_total ?? 0), 0);

    // ของแถม: จำนวน + ต้นทุน
    let giftQty = 0, giftCost = 0;
    const byBranch: Record<string, { name: string; gift_qty: number; gift_cost: number }> = {};
    for (const g of gifts ?? []) {
      const q = Number(g.qty ?? 0), c = Number(g.cost_total ?? 0);
      giftQty += q; giftCost += c;
      const bid = orderBranch[g.order_id as string];
      if (bid) { const bb = (byBranch[bid] ??= { name: brName[bid] ?? "—", gift_qty: 0, gift_cost: 0 }); bb.gift_qty += q; bb.gift_cost += c; }
    }

    return NextResponse.json({
      campaign: camp,
      summary: { uses, customers, discountTotal, revenue, giftQty, giftCost },
      redemptions: (reds ?? []).slice(0, 100),
      byBranch: Object.values(byBranch).sort((a, b) => b.gift_cost - a.gift_cost),
    });
  }

  const [{ data: camps, error }, { data: reds }, { data: cprods }] = await Promise.all([
    sb.from("campaigns").select("*").order("created_at", { ascending: false }),
    sb.from("coupon_redemptions").select("campaign_id,customer_id,discount_amount,order_total"),
    sb.from("campaign_products").select("campaign_id,product_id,sku,name,role,gift_qty"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prodByCamp: Record<string, { eligible: unknown[]; gift: unknown[] }> = {};
  for (const p of cprods ?? []) {
    const g = (prodByCamp[p.campaign_id as string] ??= { eligible: [], gift: [] });
    (p.role === "gift" ? g.gift : g.eligible).push({ product_id: p.product_id, sku: p.sku, name: p.name, gift_qty: p.gift_qty });
  }

  const stats: Record<string, { uses: number; discount: number; revenue: number; customers: Set<string> }> = {};
  for (const r of reds ?? []) {
    const k = r.campaign_id as string;
    const s = (stats[k] ??= { uses: 0, discount: 0, revenue: 0, customers: new Set() });
    s.uses += 1;
    s.discount += Number(r.discount_amount ?? 0);
    s.revenue += Number(r.order_total ?? 0);
    if (r.customer_id) s.customers.add(r.customer_id as string);
  }

  // ขอบเขตพนักงาน: เห็นแคมเปญส่วนกลาง (ไม่จำกัดแบรนด์/สาขา) หรือที่ตรงแบรนด์/สาขาตน
  const vBranch = await visibleBranchIds(ctx.authz);
  const vBrand = visibleBrandIds(ctx.authz);
  const overlaps = (a: string[] = [], b: string[] | null) => !!b && a.some((x) => b.includes(x));
  const scoped = (camps ?? []).filter((c) => {
    if (vBranch === null) return true; // company/superadmin
    const brs = (c.brand_ids as string[]) ?? [];
    const bchs = (c.branch_ids as string[]) ?? [];
    if (brs.length === 0 && bchs.length === 0) return true; // แคมเปญส่วนกลาง
    return overlaps(bchs, vBranch) || overlaps(brs, vBrand);
  });

  const campaigns = scoped.map((c) => {
    const s = stats[c.id];
    return {
      ...c,
      uses: s?.uses ?? 0,
      discount_total: s?.discount ?? 0,
      revenue: s?.revenue ?? 0,
      customers: s?.customers.size ?? 0,
      eligible_products: prodByCamp[c.id]?.eligible ?? [],
      gift_products: prodByCamp[c.id]?.gift ?? [],
    };
  });
  return NextResponse.json({ campaigns });
}

// ---------------------------------------------------------------------
// POST — สร้าง/แก้ไขแคมเปญ (มี id = แก้ไข)
// ---------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });

  const actor = ctx.authz.employee_id;
  const sb = supabaseAdmin();

  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const promo = b.promo_type === "gift" ? "gift" : "discount";

  const row: Record<string, unknown> = {
    name: typeof b.name === "string" ? b.name.trim() : undefined,
    description: typeof b.description === "string" ? b.description.trim() || null : undefined,
    code: typeof b.code === "string" && b.code.trim() ? b.code.trim().toUpperCase() : null,
    discount_type: b.discount_type === "percent" ? "percent" : "amount",
    discount_value: Number(b.discount_value ?? 0),
    max_discount: b.max_discount != null && b.max_discount !== "" ? Number(b.max_discount) : null,
    min_spend: Number(b.min_spend ?? 0),
    target_segment: typeof b.target_segment === "string" ? b.target_segment : "all",
    starts_at: b.starts_at || null,
    ends_at: b.ends_at || null,
    usage_limit: b.usage_limit != null && b.usage_limit !== "" ? Math.trunc(Number(b.usage_limit)) : null,
    per_customer_limit: b.per_customer_limit != null && b.per_customer_limit !== "" ? Math.trunc(Number(b.per_customer_limit)) : null,
    active: b.active === undefined ? true : !!b.active,
    // ขอบเขต + รูปแบบสิทธิ์ (v2)
    brand_ids: arr(b.brand_ids),
    branch_ids: arr(b.branch_ids),
    channels: arr(b.channels),
    is_automatic: !!b.is_automatic,
    promo_type: promo,
    eligible_scope: b.eligible_scope === "selected" ? "selected" : "all",
    eligible_min_qty: b.eligible_min_qty != null && b.eligible_min_qty !== "" ? Math.trunc(Number(b.eligible_min_qty)) : null,
    eligible_across_sku: b.eligible_across_sku === undefined ? true : !!b.eligible_across_sku,
    gift_mode: promo === "gift" ? (b.gift_mode === "per_item" ? "per_item" : "per_bill") : null,
    gift_per_qty: b.gift_per_qty != null && b.gift_per_qty !== "" ? Math.trunc(Number(b.gift_per_qty)) : 1,
    gift_cap: b.gift_cap != null && b.gift_cap !== "" ? Math.trunc(Number(b.gift_cap)) : null,
    updated_at: new Date().toISOString(),
  };

  let campaignId: string;
  if (isUuid(b.id)) {
    const patch = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const { error } = await sb.from("campaigns").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    campaignId = b.id as string;
  } else {
    if (!row.name) return NextResponse.json({ error: "name required" }, { status: 400 });
    row.created_by = isUuid(actor) ? actor : null;
    const { data, error } = await sb.from("campaigns").insert(row).select("id").single();
    if (error) {
      const msg = error.code === "23505" ? "รหัสคูปองนี้ถูกใช้แล้ว" : error.message;
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    campaignId = data.id;
  }

  // แทนที่รายการสินค้าแคมเปญ (eligible + gift) ถ้าส่งมา
  type ProdIn = { product_id?: string; sku?: string; name?: string; gift_qty?: number };
  const toRows = (list: unknown, role: string) =>
    (Array.isArray(list) ? list : [])
      .map((p) => p as ProdIn)
      .filter((p) => p.sku)
      .map((p) => ({
        campaign_id: campaignId,
        product_id: isUuid(p.product_id) ? p.product_id : null,
        sku: String(p.sku),
        name: p.name ?? null,
        role,
        gift_qty: role === "gift" ? Math.max(1, Math.trunc(Number(p.gift_qty ?? 1))) : 1,
      }));
  if (b.eligible_products !== undefined || b.gift_products !== undefined) {
    await sb.from("campaign_products").delete().eq("campaign_id", campaignId);
    const rows = [...toRows(b.eligible_products, "eligible"), ...toRows(b.gift_products, "gift")];
    if (rows.length) {
      const { error } = await sb.from("campaign_products").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, id: campaignId });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin().from("campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
