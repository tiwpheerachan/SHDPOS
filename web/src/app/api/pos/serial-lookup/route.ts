// /api/pos/serial-lookup?branch_id=&sn= — สแกน SN ที่หน้าร้าน → สินค้าอะไร แบรนด์อะไร อยู่สาขาไหน สถานะอะไร
//   ใช้ตอนพิมพ์/สแกน SN ในช่องค้นหา (ไม่ต้องรู้ SKU) · สาขาหลายแบรนด์บอกได้ว่าแบรนด์นั้นขายที่สาขานี้ไหม
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { branchBrandMap } from "@/lib/server/branch-brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    const sn = (req.nextUrl.searchParams.get("sn") ?? "").trim();
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    if (sn.length < 4 || sn.length > 80) return NextResponse.json({ found: false });
    await posContext(req, "inventory.view", branch);
    const sb = supabaseAdmin();
    // ตรงตัว (ไม่ใช้ wildcard กัน SN ที่มี _ / % ไปจับตัวอื่น) · ลองตัวพิมพ์ใหญ่/เล็ก + IMEI
    const variants = [...new Set([sn, sn.toUpperCase(), sn.toLowerCase()])];
    const sel = "serial_no,status,branch_id,product_id";
    let { data, error } = await sb.from("serials").select(sel).in("serial_no", variants).limit(2);
    if (!error && !data?.length) ({ data, error } = await sb.from("serials").select(sel).in("imei", variants).limit(2));
    if (error) throw Error(error.message);
    if (!data?.length) return NextResponse.json({ found: false });
    const s = data[0];
    const [{ data: p }, bm, { data: br }] = await Promise.all([
      sb.from("products").select("id,sku,name_th,brand_id,is_active").eq("id", s.product_id).maybeSingle(),
      branchBrandMap([branch]),
      sb.from("branches").select("id,code,name_th,name").eq("id", s.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
    ]);
    const brand = p?.brand_id ? (await sb.from("brands").select("id,name").eq("id", p.brand_id).maybeSingle()).data : null;
    const sold = bm.map[branch] ?? [];
    return NextResponse.json({
      found: true, serial_no: s.serial_no, status: s.status, product_id: s.product_id, sku: p?.sku ?? null, name: p?.name_th ?? null,
      brand_id: p?.brand_id ?? null, brand_name: brand?.name ?? null,
      at_branch: s.branch_id === branch, branch_label: br ? `${br.code} · ${br.name_th ?? br.name}` : null,
      brand_sold_here: !p?.brand_id || sold.length === 0 || sold.includes(p.brand_id),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ผิดพลาด" }, { status: e instanceof PosError ? e.status : 503 });
  }
}
