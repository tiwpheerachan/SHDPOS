// /api/pos/film-config?branch_id= — ค่าตั้งงานติดฟิล์ม + รายชื่อรุ่นรถ (หน้าร้าน)
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadFilmConfig } from "@/lib/server/film-config";
import { branchBrandMap } from "@/lib/server/branch-brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    await posContext(req, "pos.sell", branch);
    const sb = supabaseAdmin();
    const [cfg, cars, bm] = await Promise.all([
      loadFilmConfig(sb, branch),
      sb.from("film_car_models").select("make,model,size_code").order("make").order("model").limit(5000),
      branchBrandMap([branch]),
    ]);
    // สาขานี้มีงานติดฟิล์มไหม — ตัดสินที่เซิร์ฟเวอร์ครั้งเดียว (หน้าร้านไม่ต้องรอข้อมูลหลายแหล่ง กันปุ่มขึ้นบ้างไม่ขึ้นบ้าง)
    //   มีความเข้มที่เปิดในสาขา และ (สาขาขายแบรนด์ฟิล์ม หรือมีม้วนในสต๊อก)
    const rollIds = cfg.shades.filter((s) => s.active && s.stock_product_id).map((s) => s.stock_product_id as string);
    const sells = !!cfg.brand_id && (bm.map[branch] ?? []).includes(cfg.brand_id);
    let hasRoll = false;
    if (!sells && rollIds.length) {
      const st = await sb.from("stock_levels").select("product_id").eq("branch_id", branch).in("product_id", rollIds).gt("qty_on_hand", 0).limit(1);
      hasRoll = !!st.data?.length;
    }
    const available = rollIds.length > 0 && cfg.series.some((s) => s.active) && (sells || hasRoll);
    const roll_ids = cfg.shades.map((s) => s.stock_product_id).filter(Boolean);
    return NextResponse.json({ ...cfg, cars: cars.data ?? [], available, roll_ids }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ผิดพลาด" }, { status: e instanceof PosError ? e.status : 503 });
  }
}
