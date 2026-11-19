// =====================================================================
// GET /api/display-banners?brand=<id> — แบนเนอร์จอลูกค้า (public read)
//   คืนเฉพาะ active เรียงตาม sort_order; รวมแบนเนอร์ global (brand_id null)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand");
  const sb = supabaseAdmin();
  let q = sb.from("display_banners").select("id,brand_id,media_url,media_type,fit,pos_x,pos_y,duration_sec,sort_order").eq("active", true);
  // แบรนด์ที่ระบุ + global (brand_id null)
  q = brand ? q.or(`brand_id.eq.${brand},brand_id.is.null`) : q.is("brand_id", null);
  const { data, error } = await q.order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ banners: [] });
  return NextResponse.json({ banners: data ?? [] });
}
