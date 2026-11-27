// =====================================================================
// /api/admin/film-config — ตั้งค่างานติดฟิล์มรถ (สิทธิ์ film.manage)
//   GET  → ค่าตั้งทั้งหมด + รุ่นรถ + ม้วนฟิล์มที่เลือกผูกได้
//   POST { action, ... }
//     rules  {one_series_per_car, full_car_only, mixed_shades, round_up_feet, roll_width_ft}
//     price  {series_code, size_code, position_code('ALL'|FW|RW|FSW|RSW), price|null}  (null = ลบ)
//     area   {size_code, position_code, sqft}
//     shade  {series_code, shade, stock_product_id, feet_per_unit, active}
//     series {code, active}
//     car    {id?, make, model, size_code} · car_delete {id}
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadFilmConfig } from "@/lib/server/film-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POS = new Set(["ALL", "FW", "RW", "FSW", "RSW"]);

async function guard(req: NextRequest, write: boolean) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return { err: reply({ error: "กรุณาเข้าสู่ระบบ" }, 401) };
  const authz = await resolveAuthz(profile);
  const can = hasPerm(profile.email, authz, "film.manage");
  if (!can && (write || !hasPerm(profile.email, authz, "product.view"))) return { err: reply({ error: "ไม่มีสิทธิ์ตั้งค่างานติดฟิล์ม" }, 403) };
  return { profile, authz, can };
}

export async function GET(req: NextRequest) {
  const g = await guard(req, false);
  if ("err" in g) return g.err;
  const sb = supabaseAdmin();
  try {
    const cfg = await loadFilmConfig(sb);
    const [cars, rolls] = await Promise.all([
      sb.from("film_car_models").select("id,make,model,size_code").order("make").order("model").limit(5000),
      // ม้วนฟิล์มที่ผูกได้: สินค้าของแบรนด์ฟิล์ม (หรือชื่อมี film)
      sb.from("products").select("id,sku,name_th,unit,is_active").or(`brand_id.eq.${cfg.brand_id ?? "00000000-0000-0000-0000-000000000000"},sku.ilike.%film%,name_th.ilike.%film%`).order("sku").limit(500),
    ]);
    return reply({ ...cfg, cars: cars.data ?? [], rolls: rolls.data ?? [], can_edit: g.can });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "อ่านไม่สำเร็จ" }, 503); }
}

export async function POST(req: NextRequest) {
  const g = await guard(req, true);
  if ("err" in g) return g.err;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  const num = (v: unknown, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const str = (v: unknown, max = 80) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  let r: { error: { message: string } | null } = { error: null };
  switch (b.action) {
    case "rules": {
      const width = num(b.roll_width_ft, 1, 20);
      if (width === null) return reply({ error: "ความกว้างม้วนไม่ถูกต้อง" }, 400);
      r = await sb.from("film_config").update({ one_series_per_car: !!b.one_series_per_car, full_car_only: !!b.full_car_only, mixed_shades: !!b.mixed_shades, round_up_feet: !!b.round_up_feet, roll_width_ft: width, updated_at: new Date().toISOString() }).eq("id", 1);
      break;
    }
    case "price": {
      const se = str(b.series_code, 4), sz = str(b.size_code, 6), pos = str(b.position_code, 4);
      if (!se || !sz || !pos || !POS.has(pos)) return reply({ error: "ข้อมูลราคาไม่ถูกต้อง" }, 400);
      if (b.price === null || b.price === "") r = await sb.from("film_prices").delete().match({ series_code: se, size_code: sz, position_code: pos });
      else {
        const price = num(b.price, 1, 1_000_000);
        if (price === null) return reply({ error: "ราคาต้องมากกว่า 0" }, 400);
        r = await sb.from("film_prices").upsert({ series_code: se, size_code: sz, position_code: pos, price }, { onConflict: "series_code,size_code,position_code" });
      }
      break;
    }
    case "area": {
      const sz = str(b.size_code, 6), pos = str(b.position_code, 4), sqft = num(b.sqft, 0.1, 500);
      if (!sz || !pos || pos === "ALL" || !POS.has(pos) || sqft === null) return reply({ error: "พื้นที่ไม่ถูกต้อง" }, 400);
      r = await sb.from("film_size_areas").upsert({ size_code: sz, position_code: pos, sqft }, { onConflict: "size_code,position_code" });
      break;
    }
    case "shade": {
      const se = str(b.series_code, 4), shade = num(b.shade, 1, 99), fpu = num(b.feet_per_unit, 0.01, 10000);
      const pid = b.stock_product_id === null || b.stock_product_id === "" ? null : String(b.stock_product_id);
      if (!se || shade === null || fpu === null || (pid !== null && !UUID.test(pid))) return reply({ error: "ข้อมูลม้วนฟิล์มไม่ถูกต้อง" }, 400);
      r = await sb.from("film_shades").update({ stock_product_id: pid, feet_per_unit: fpu, active: b.active !== false }).match({ series_code: se, shade });
      break;
    }
    case "series": {
      const code = str(b.code, 4);
      if (!code) return reply({ error: "รุ่นไม่ถูกต้อง" }, 400);
      r = await sb.from("film_series").update({ active: b.active !== false }).eq("code", code);
      break;
    }
    case "car": {
      const make = str(b.make), model = str(b.model), sz = str(b.size_code, 6);
      if (!make || !model || !sz) return reply({ error: "กรอกยี่ห้อ รุ่น และขนาดให้ครบ" }, 400);
      if (typeof b.id === "string" && UUID.test(b.id)) r = await sb.from("film_car_models").update({ make, model, size_code: sz }).eq("id", b.id);
      else r = await sb.from("film_car_models").insert({ make, model, size_code: sz });
      if (r.error && /duplicate|unique/i.test(r.error.message)) return reply({ error: "มีรุ่นรถนี้อยู่แล้ว" }, 409);
      break;
    }
    case "car_delete": {
      if (typeof b.id !== "string" || !UUID.test(b.id)) return reply({ error: "id ไม่ถูกต้อง" }, 400);
      r = await sb.from("film_car_models").delete().eq("id", b.id);
      break;
    }
    default: return reply({ error: "action ไม่ถูกต้อง" }, 400);
  }
  if (r.error) return reply({ error: r.error.message }, 500);
  return reply({ ok: true });
}
