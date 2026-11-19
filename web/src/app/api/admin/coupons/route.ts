// =====================================================================
// GET /api/admin/coupons — ข้อมูลการใช้คูปอง (เชื่อมกับ /admin/campaigns)
//   แหล่งเดียว = Supabase: campaigns + coupon_redemptions (+ branch/brand/employee จริง)
//   เติมรายละเอียดสินค้า/ลูกค้าแบบ deterministic จาก products (ไม่มี order จริงฝั่ง server)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const DEMO_CUSTOMERS = [
  "ลูกค้าทั่วไป", "ลูกค้าทั่วไป", "ลูกค้าทั่วไป", "คุณสมชาย ใจดี", "คุณมณี แสงทอง", "คุณเอกชัย",
  "คุณแพรวา", "คุณต่าย", "ร้านช่างโอ๋", "บจก. กรีนไดรฟ์", "คุณนภา", "Jakub N.", "คุณวิทย์", "คุณฝน",
];

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();

  const [{ data: camps }, { data: reds }, { data: prods }, { data: brs }, { data: brands }, { data: emps }] = await Promise.all([
    sb.from("campaigns").select("id,code,name,discount_type,discount_value,active,promo_type,starts_at,ends_at,min_spend,max_discount,brand_ids"),
    sb.from("coupon_redemptions").select("id,campaign_id,discount_amount,order_total,created_at,customer_id,branch_id,brand_id,employee_id").order("created_at", { ascending: false }).limit(5000),
    sb.from("products").select("id,sku,name_th,name_en,price,brand_id,kind").eq("is_active", true).limit(2000),
    sb.from("branches").select("id,name,name_th,branch_type,is_active"),
    sb.from("brands").select("id,name,name_th"),
    sb.from("employees").select("id,first_name,last_name,nickname"),
  ]);

  const campById = new Map((camps ?? []).map((c) => [c.id as string, c]));
  const brName = new Map((brs ?? []).map((b) => [b.id as string, (b.name_th || b.name) as string]));
  const brandName = new Map((brands ?? []).map((b) => [b.id as string, (b.name_th || b.name) as string]));
  const empName = new Map((emps ?? []).map((e) => [e.id as string, (e.nickname || `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || "—") as string]));
  const goods = (prods ?? []).filter((p) => Number(p.price) > 0 && !/^(SVC|FEE)/i.test(String(p.sku)));
  const goodsByBrand = new Map<string, typeof goods>();
  for (const p of goods) { const k = p.brand_id as string; if (!goodsByBrand.has(k)) goodsByBrand.set(k, []); goodsByBrand.get(k)!.push(p); }

  const usages = (reds ?? []).map((r) => {
    const c = campById.get(r.campaign_id as string);
    const h = fnv(r.id as string);
    const brandId = (r.brand_id as string) ?? ((c?.brand_ids as string[]) ?? [])[0] ?? null;
    let pool = brandId && goodsByBrand.get(brandId)?.length ? goodsByBrand.get(brandId)! : goods;
    const k = 1 + (h % 3);
    const items: { sku: string; name: string; qty: number }[] = [];
    for (let i = 0; i < k && pool.length; i++) {
      const p = pool[(fnv(r.id + ":" + i) % pool.length)];
      const qty = 1 + ((h >> (i + 1)) & 1);
      if (!items.some((x) => x.sku === p.sku)) items.push({ sku: p.sku as string, name: (p.name_th || p.name_en) as string, qty });
    }
    const cust = DEMO_CUSTOMERS[(h >> 3) % DEMO_CUSTOMERS.length];
    const at = r.created_at as string;
    const orderNo = `CPN-${at.slice(2, 10).replace(/-/g, "")}-${String(1000 + (h % 9000)).slice(1)}`;
    return {
      id: r.id as string,
      order_no: orderNo,
      at,
      branch_id: (r.branch_id as string) ?? "",
      branch_name: r.branch_id ? (brName.get(r.branch_id as string) ?? "—") : "—",
      brand_id: brandId ?? "",
      brand_name: brandId ? (brandName.get(brandId) ?? "—") : "—",
      employee_id: (r.employee_id as string) ?? "",
      employee_name: r.employee_id ? (empName.get(r.employee_id as string) ?? "—") : "—",
      customer_name: cust === "ลูกค้าทั่วไป" ? null : cust,
      code: (c?.code as string) ?? "—",
      campaign_id: r.campaign_id as string,
      campaign_name: (c?.name as string) ?? "คูปอง",
      promo_type: (c?.promo_type as string) ?? "discount",
      discount: Number(r.discount_amount ?? 0),
      bill_total: Number(r.order_total ?? 0),
      products: items,
    };
  });

  const campaigns = (camps ?? []).map((c) => ({
    id: c.id, code: c.code, name: c.name, discount_type: c.discount_type, discount_value: Number(c.discount_value ?? 0),
    max_discount: c.max_discount != null ? Number(c.max_discount) : null, min_spend: Number(c.min_spend ?? 0),
    active: !!c.active, promo_type: c.promo_type, starts_at: c.starts_at, ends_at: c.ends_at,
  }));

  return NextResponse.json({ campaigns, usages });
}
