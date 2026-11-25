// /api/admin/loyalty — ตั้งค่าระบบสะสมแต้มรายแบรนด์ (สิทธิ์ loyalty.manage)
//   GET  : โปรแกรมทุกแบรนด์ + กฎเสริม + ตัวเลือก (แบรนด์/สาขา/หมวด/สินค้าที่อ้างอิง)
//   POST : save_program · save_rule · archive_rule · simulate (เรียกสูตรเดียวกับตอนบันทึกบิล: pos_loyalty_calc)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const CHANNELS = ["offline", "online_shopee", "online_lazada", "online_tiktok", "online_website", "event", "b2b", "other"];
// ค่าที่ customer_segment() คืนจริง
const SEGMENTS = ["all", "new", "returning", "vip", "lost"];

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "loyalty.manage")) throw new PosError("ไม่มีสิทธิ์ตั้งค่าแต้มสะสม", 403);
  return { actor: authz.employee_id ?? null };
}
const fail = (e: unknown) => e instanceof PosError ? reply({ error: e.message }, e.status) : reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 500);

const num = (v: unknown, label: string, min = 0, max = 1e9): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new PosError(`${label} ไม่ถูกต้อง`);
  return n;
};
const optNum = (v: unknown, label: string, min = 0, max = 1e9) => (v === null || v === undefined || v === "" ? null : num(v, label, min, max));
const uuids = (v: unknown, label: string): string[] => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 500 || v.some((x) => !UUID.test(String(x)))) throw new PosError(`${label} ไม่ถูกต้อง`);
  return [...new Set(v.map(String))];
};

export async function GET(req: NextRequest) {
  try {
    await ctx(req);
    const sb = supabaseAdmin();
    const [prog, rules, brands, branches, cats] = await Promise.all([
      sb.from("loyalty_programs").select("*"),
      sb.from("loyalty_rules").select("*").is("archived_at", null).order("priority", { ascending: false }).order("created_at"),
      sb.from("brands").select("id,name").order("name"),
      sb.from("branches").select("id,name,code,brand_id").order("name"),
      sb.from("categories").select("id,name_th,name_en").eq("is_active", true).order("sort_order"),
    ]);
    if (prog.error || rules.error) throw new PosError("อ่านการตั้งค่าแต้มไม่สำเร็จ — ตรวจ migration 0061", 503);
    const pids = [...new Set((rules.data ?? []).flatMap((r) => r.product_ids ?? []))];
    const prods = pids.length ? await sb.from("products").select("id,sku,name_th").in("id", pids) : { data: [] };
    return reply({ programs: prog.data ?? [], rules: rules.data ?? [], brands: brands.data ?? [], branches: branches.data ?? [], categories: cats.data ?? [], products: prods.data ?? [] });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const { actor } = await ctx(req);
    const b = await req.json();
    const sb = supabaseAdmin();
    switch (b.action) {
      case "save_program": {
        const brand = b.brand_id == null || b.brand_id === "" ? null : String(b.brand_id);
        if (brand && !UUID.test(brand)) throw new PosError("แบรนด์ไม่ถูกต้อง");
        const row = {
          brand_id: brand, active: b.active !== false,
          spend_per_unit: num(b.spend_per_unit, "ยอดต่อหน่วย", 0.01, 1e7),
          points_per_unit: Math.floor(num(b.points_per_unit, "แต้มต่อหน่วย", 0, 1e6)),
          min_spend: num(b.min_spend ?? 0, "ยอดขั้นต่ำ", 0, 1e9),
          max_points_per_bill: optNum(b.max_points_per_bill, "เพดานแต้มต่อบิล", 0, 1e7),
          earn_on_redeemed_bill: b.earn_on_redeemed_bill !== false,
          expiry_months: optNum(b.expiry_months, "อายุแต้ม (เดือน)", 1, 120),
          note: b.note ? String(b.note).slice(0, 500) : null, updated_by: actor, updated_at: new Date().toISOString(),
        };
        // upsert ด้วย brand (null = ค่าเริ่มต้น) — unique index ใช้ coalesce จึงหาแล้วอัปเดตเอง
        const cur = brand ? await sb.from("loyalty_programs").select("id").eq("brand_id", brand).maybeSingle() : await sb.from("loyalty_programs").select("id").is("brand_id", null).maybeSingle();
        if (cur.error) throw new PosError("อ่านโปรแกรมไม่สำเร็จ", 503);
        const r = cur.data ? await sb.from("loyalty_programs").update(row).eq("id", cur.data.id).select().single() : await sb.from("loyalty_programs").insert(row).select().single();
        if (r.error) throw new PosError("บันทึกไม่สำเร็จ: " + r.error.message, 400);
        return reply({ program: r.data });
      }
      case "delete_program": {
        // ลบโปรแกรมรายแบรนด์ = กลับไปใช้ค่าเริ่มต้น (ค่าเริ่มต้นลบไม่ได้)
        if (!UUID.test(String(b.brand_id))) throw new PosError("ลบค่าเริ่มต้นไม่ได้ — ปิดใช้งานแทน");
        const r = await sb.from("loyalty_programs").delete().eq("brand_id", b.brand_id);
        if (r.error) throw new PosError("ลบไม่สำเร็จ", 400);
        return reply({ ok: true });
      }
      case "save_rule": {
        const r = b.rule ?? {};
        const kind = String(r.kind);
        if (!["multiplier", "per_item", "bonus"].includes(kind)) throw new PosError("ประเภทกฎไม่ถูกต้อง");
        const name = String(r.name ?? "").trim();
        if (!name || name.length > 200) throw new PosError("กรุณาตั้งชื่อกฎ");
        const brand = r.brand_id ? String(r.brand_id) : null;
        if (brand && !UUID.test(brand)) throw new PosError("แบรนด์ไม่ถูกต้อง");
        const days: number[] = Array.isArray(r.days_of_week) ? [...new Set((r.days_of_week as unknown[]).map(Number))] : [];
        if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new PosError("วันในสัปดาห์ไม่ถูกต้อง");
        const time = (v: unknown) => (v ? (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : (() => { throw new PosError("เวลาไม่ถูกต้อง (HH:MM)"); })()) : null);
        const ts = (v: unknown, label: string) => { if (!v) return null; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new PosError(`${label} ไม่ถูกต้อง`); return d.toISOString(); };
        const channels = Array.isArray(r.channels) ? r.channels.map(String) : [];
        if (channels.some((c: string) => !CHANNELS.includes(c))) throw new PosError("ช่องทางไม่ถูกต้อง");
        const seg = String(r.target_segment ?? "all");
        if (!SEGMENTS.includes(seg)) throw new PosError("กลุ่มลูกค้าไม่ถูกต้อง");
        const row = {
          brand_id: brand, name, kind, active: r.active !== false,
          starts_at: ts(r.starts_at, "วันเริ่ม"), ends_at: ts(r.ends_at, "วันสิ้นสุด"),
          days_of_week: days, time_from: time(r.time_from), time_to: time(r.time_to),
          branch_ids: uuids(r.branch_ids, "สาขา"), channels, target_segment: seg,
          product_ids: uuids(r.product_ids, "สินค้า"), category_ids: uuids(r.category_ids, "หมวดสินค้า"),
          multiplier: kind === "multiplier" ? num(r.multiplier, "ตัวคูณ", 1, 100) : null,
          points_per_unit: kind === "per_item" ? Math.floor(num(r.points_per_unit, "แต้มต่อชิ้น", 0, 1e6)) : null,
          bonus_points: kind === "bonus" ? Math.floor(num(r.bonus_points, "แต้มโบนัส", 0, 1e7)) : null,
          min_spend: num(r.min_spend ?? 0, "ยอดขั้นต่ำ", 0, 1e9), min_qty: Math.floor(num(r.min_qty ?? 1, "จำนวนขั้นต่ำ", 1, 1e6)),
          priority: Math.floor(num(r.priority ?? 0, "ลำดับ", -1000, 1000)),
          updated_by: actor, updated_at: new Date().toISOString(),
        };
        if (row.starts_at && row.ends_at && row.ends_at <= row.starts_at) throw new PosError("วันสิ้นสุดต้องหลังวันเริ่ม");
        const res = r.id
          ? await sb.from("loyalty_rules").update(row).eq("id", String(r.id)).select().single()
          : await sb.from("loyalty_rules").insert({ ...row, created_by: actor }).select().single();
        if (res.error) throw new PosError("บันทึกกฎไม่สำเร็จ: " + res.error.message, 400);
        return reply({ rule: res.data });
      }
      case "archive_rule": {
        if (!UUID.test(String(b.id))) throw new PosError("รหัสกฎไม่ถูกต้อง");
        const r = await sb.from("loyalty_rules").update({ archived_at: new Date().toISOString(), active: false, updated_by: actor }).eq("id", b.id);
        if (r.error) throw new PosError("ลบกฎไม่สำเร็จ", 400);
        return reply({ ok: true });
      }
      case "simulate": {
        if (!UUID.test(String(b.branch_id))) throw new PosError("กรุณาเลือกสาขา");
        const items = Array.isArray(b.items) ? b.items.filter((i: { product_id?: string }) => UUID.test(String(i?.product_id))).slice(0, 100) : [];
        const r = await sb.rpc("pos_loyalty_calc", {
          p_branch: b.branch_id, p_channel: CHANNELS.includes(b.channel) ? b.channel : "offline", p_customer: null,
          p_at: b.at ? new Date(b.at).toISOString() : new Date().toISOString(), p_net: num(b.net, "ยอดซื้อ", 0, 1e9),
          p_items: items.map((i: { product_id: string; qty?: number }) => ({ product_id: i.product_id, qty: Number(i.qty) || 1, is_gift: false })),
          p_redeemed: Math.floor(Number(b.redeem_points) || 0),
        });
        if (r.error) throw new PosError("คำนวณไม่สำเร็จ: " + r.error.message, 400);
        return reply({ result: r.data });
      }
      default: throw new PosError("คำสั่งไม่ถูกต้อง");
    }
  } catch (e) { return fail(e); }
}
