// /api/pos/film-config?branch_id= — ค่าตั้งงานติดฟิล์ม + รายชื่อรุ่นรถ (หน้าร้าน)
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadFilmConfig } from "@/lib/server/film-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    await posContext(req, "pos.sell", branch);
    const sb = supabaseAdmin();
    const [cfg, cars] = await Promise.all([
      loadFilmConfig(sb, branch),
      sb.from("film_car_models").select("make,model,size_code").order("make").order("model").limit(5000),
    ]);
    return NextResponse.json({ ...cfg, cars: cars.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ผิดพลาด" }, { status: e instanceof PosError ? e.status : 503 });
  }
}
