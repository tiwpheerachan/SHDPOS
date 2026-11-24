import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { visibleBrandIds } from "@/lib/sso/scope";
import { catalogSearchFilter } from "@/lib/catalog/search";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, {status, headers:{"Cache-Control":"no-store"}});

/** Canonical POS products, including imported inactive products for campaign planning. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return reply({ error: "ไม่มีสิทธิ์ค้นหาสินค้า กรุณาเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์" }, 403);
    const term = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (term.length > 200) return reply({error:"คำค้นยาวเกิน 200 ตัวอักษร"},400);
    const sb = supabaseAdmin();
    let query = sb.from("products").select("id,sku,name_th,name_en,short_name,brand_id,price,is_active,track_serial,image_url").order("sku").limit(31);
    if (term) query = query.or(catalogSearchFilter(term));
    const brands = visibleBrandIds(ctx.authz);
    if (ctx.authz.data_scope === "brand" && brands !== null) {
      if (!brands.length) return reply({products:[],has_more:false});
      query = query.in("brand_id",brands);
    }
    const {data,error} = await query;
    if (error || !data) return reply({error:"อ่านแคตตาล็อกกลางไม่สำเร็จ กรุณาลองใหม่"},503);
    const rows = data.slice(0,30);
    const links = rows.length ? await sb.from("pos_catalog_links").select("product_id,source").in("product_id",rows.map(p=>p.id)) : {data:[],error:null};
    if (links.error) return reply({error:"อ่านที่มาสินค้าไม่สำเร็จ กรุณาลองใหม่"},503);
    return reply({products:rows.map(p=>({
      id:p.id,sku:p.sku,name:p.name_th || p.name_en || p.sku,brand_id:p.brand_id,
      price:Number(p.price ?? 0),is_active:p.is_active,track_serial:p.track_serial,image_url:p.image_url,
      sources:(links.data ?? []).filter(l=>l.product_id===p.id).map(l=>l.source),
    })).sort((a,b)=>Number(b.sku.toLowerCase()===term.toLowerCase())-Number(a.sku.toLowerCase()===term.toLowerCase())),has_more:data.length>30});
  } catch { return reply({error:"ค้นหาสินค้าไม่สำเร็จ กรุณาลองใหม่"},503); }
}
