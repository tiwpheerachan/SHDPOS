import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { campaignReferences, type CampaignProduct } from "@/lib/catalog/campaign-products";
import { visibleBranchIds, visibleBrandIds } from "@/lib/sso/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function resolveProducts(sb: ReturnType<typeof supabaseAdmin>, eligible: unknown, gifts: unknown, active: boolean, selected: boolean) {
  const inputs=[...(Array.isArray(eligible)?eligible:[]),...(Array.isArray(gifts)?gifts:[])];
  if(inputs.length>400) throw Error("รายการสินค้าแคมเปญมากเกินไป");
  const ids=[...new Set(inputs.map(p=>p?.product_id).filter(isUuid))];
  const skus=[...new Set(inputs.map(p=>p?.sku).filter((v):v is string=>typeof v==="string"))];
  const read=(field:string,values:string[])=>values.length ? sb.from("products").select("id,sku,name_th,is_active").in(field,values) : Promise.resolve({data:[],error:null});
  const results=await Promise.all([read("id",ids),read("sku",skus)]);
  if(results.some(r=>r.error)) throw Error("อ่านสินค้าอ้างอิงไม่สำเร็จ กรุณาลองใหม่");
  const products=[...new Map(results.flatMap(r=>r.data ?? []).map(p=>[p.id,p])).values()] as CampaignProduct[];
  return campaignReferences(eligible,gifts,products,active,selected);
}

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
      redemptions: (reds ?? []).slice(0, 500),
      byBranch: Object.values(byBranch).sort((a, b) => b.gift_cost - a.gift_cost),
    });
  }

  const [{ data: camps, error }, { data: reds }, { data: cprods }] = await Promise.all([
    sb.from("campaigns").select("*").is("archived_at",null).order("created_at", { ascending: false }),
    sb.from("coupon_redemptions").select("campaign_id,customer_id,discount_amount,order_total"),
    sb.from("campaign_products").select("campaign_id,product_id,sku,name,role,gift_qty"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const productIds=[...new Set((cprods ?? []).map(p=>p.product_id).filter(Boolean))];
  const states=new Map<string,boolean>();
  for(let offset=0;offset<productIds.length;offset+=200){
    const result=await sb.from("products").select("id,is_active").in("id",productIds.slice(offset,offset+200));
    if(result.error)return NextResponse.json({error:"อ่านสถานะสินค้าแคมเปญไม่สำเร็จ"},{status:503});
    for(const product of result.data ?? [])states.set(product.id,product.is_active);
  }
  const prodByCamp: Record<string, { eligible: unknown[]; gift: unknown[] }> = {};
  for (const p of cprods ?? []) {
    const g = (prodByCamp[p.campaign_id as string] ??= { eligible: [], gift: [] });
    (p.role === "gift" ? g.gift : g.eligible).push({ product_id: p.product_id, sku: p.sku, name: p.name, gift_qty: p.gift_qty, is_active: states.get(p.product_id) ?? false });
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
    cover_url: typeof b.cover_url === "string" ? b.cover_url.trim() || null : undefined,
    updated_at: new Date().toISOString(),
  };

  // Resolve all references before any campaign row or relation is changed.
  let refs;
  try {
    let previous: {role:string;product_id:string|null;sku:string;gift_qty:number}[]=[];
    if (isUuid(b.id) && (b.eligible_products === undefined || b.gift_products === undefined)) {
      const result=await sb.from("campaign_products").select("role,product_id,sku,gift_qty").eq("campaign_id",b.id);
      if(result.error) throw Error("อ่านสินค้าแคมเปญเดิมไม่สำเร็จ");
      previous=result.data ?? [];
    }
    refs=await resolveProducts(sb,row.eligible_scope==="selected" ? (b.eligible_products ?? previous.filter(p=>p.role==="eligible")) : [],promo==="gift" ? (b.gift_products ?? previous.filter(p=>p.role==="gift")) : [],row.active===true,row.eligible_scope==="selected");
    if(promo==="gift" && !refs.some(p=>p.role==="gift")) throw Error("กรุณาเลือกสินค้าของแถม");
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : "รายการสินค้าไม่ถูกต้อง"},{status:422}); }

  if(isUuid(b.id)&&(!Number.isSafeInteger(b.version)||Number(b.version)<1))return NextResponse.json({error:"ต้องระบุเวอร์ชันแคมเปญ กรุณาโหลดใหม่"},{status:409});
  const result=await sb.rpc("pos_save_campaign",{p_id:isUuid(b.id)?b.id:null,p_actor:actor,p_expected_version:isUuid(b.id)?b.version:0,p_row:{...row,cover_url:row.cover_url??null},p_refs:refs});
  if(result.error)return NextResponse.json({error:result.error.message==="campaign_version_conflict"?"แคมเปญถูกแก้ไขแล้ว กรุณาโหลดใหม่":"บันทึกแคมเปญไม่สำเร็จ: "+result.error.message},{status:409});
  return NextResponse.json({ok:true,...result.data});
}

// PATCH — อัปเดตเฉพาะฟิลด์ที่ส่งมา (เช่น เปิด/ปิด active) โดยไม่แตะฟิลด์อื่น
export async function PATCH(req:NextRequest){
 const ctx=await requireAdmin(req);if(!ctx)return NextResponse.json({error:"forbidden"},{status:403});
 const b=await req.json().catch(()=>null);if(!b||!isUuid(b.id)||!Number.isSafeInteger(b.version))return NextResponse.json({error:"รหัสหรือเวอร์ชันไม่ถูกต้อง"},{status:400});
 const sb=supabaseAdmin();const [campaign,products]=await Promise.all([sb.from("campaigns").select("*").eq("id",b.id).single(),sb.from("campaign_products").select("product_id,sku,role,gift_qty").eq("campaign_id",b.id)]);
 if(campaign.error||products.error)return NextResponse.json({error:"อ่านแคมเปญไม่สำเร็จ"},{status:503});
 const row={...campaign.data,active:typeof b.active==="boolean"?b.active:campaign.data.active};
 if(b.usage_limit!==undefined){if(b.usage_limit!==null&&(!Number.isSafeInteger(b.usage_limit)||b.usage_limit<1))return NextResponse.json({error:"จำนวนครั้งไม่ถูกต้อง"},{status:400});row.usage_limit=b.usage_limit;}
 try{
 const original=products.data??[];const refs=await resolveProducts(sb,row.eligible_scope==="selected"?original.filter(p=>p.role==="eligible"):[],row.promo_type==="gift"?original.filter(p=>p.role==="gift"):[],row.active,row.eligible_scope==="selected");
 const r=await sb.rpc("pos_save_campaign",{p_id:b.id,p_actor:ctx.authz.employee_id,p_expected_version:b.version,p_row:row,p_refs:refs});
 if(r.error)throw Error(r.error.message);return NextResponse.json({ok:true,...r.data});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"บันทึกไม่สำเร็จ"},{status:409});}
}
export async function DELETE(req:NextRequest){
 const ctx=await requireAdmin(req);if(!ctx)return NextResponse.json({error:"forbidden"},{status:403});
 const id=req.nextUrl.searchParams.get("id"),version=Number(req.nextUrl.searchParams.get("version"));if(!isUuid(id)||!Number.isSafeInteger(version)||version<1)return NextResponse.json({error:"รหัสหรือเวอร์ชันไม่ถูกต้อง"},{status:400});
 const r=await supabaseAdmin().rpc("pos_archive_campaign",{p_id:id,p_actor:ctx.authz.employee_id,p_version:version});if(r.error)return NextResponse.json({error:r.error.message},{status:409});return NextResponse.json({ok:true,archived:true});
}
