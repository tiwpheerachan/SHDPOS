// /api/pos/prices?branch_id= — ราคาช่วงเวลาที่มีผล ณ ตอนนี้ของสาขา (เฉพาะสินค้าที่มีกฎ · ที่เหลือใช้ราคาหลัก)
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { effectivePrices } from "@/lib/server/effective-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    await posContext(req, "inventory.view", branch);
    const m = await effectivePrices(supabaseAdmin(), branch, null);
    const items = [...m.values()].filter((r) => r.rule_id && r.price !== r.list_price)
      .map((r) => ({ product_id: r.product_id, price: r.price, list_price: r.list_price, rule_name: r.rule_name, price_type: r.price_type, ends_at: r.ends_at }));
    return NextResponse.json({ branch_id: branch, at: new Date().toISOString(), items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ผิดพลาด" }, { status: e instanceof PosError ? e.status : 503 });
  }
}
