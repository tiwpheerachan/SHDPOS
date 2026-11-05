import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ค้นหาสินค้า (ชื่อ/SKU) สำหรับเลือกเข้าแคมเปญ
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ products: [] });

  const safe = q.replace(/[%,]/g, " ");
  const { data, error } = await supabaseAdmin()
    .from("products")
    .select("id,sku,name_th,name_en,brand_id,price,cost")
    .or(`sku.ilike.%${safe}%,name_th.ilike.%${safe}%,name_en.ilike.%${safe}%`)
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    products: (data ?? []).map((p) => ({
      id: p.id, sku: p.sku, name: p.name_th || p.name_en || p.sku,
      brand_id: p.brand_id, price: Number(p.price ?? 0), cost: Number(p.cost ?? 0),
    })),
  });
}
