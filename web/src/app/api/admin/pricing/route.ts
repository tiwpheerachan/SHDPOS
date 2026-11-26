// /api/admin/pricing — สินค้าและราคา (ราคาหลัก + ราคาช่วงเวลา)
//   GET  ?view=products              → สินค้า (ตามขอบเขตแบรนด์) + ราคาที่ใช้ขายตอนนี้ (กฎทุกสาขา) + ข้อมูลกฎ · แบรนด์/หมวด/สาขา
//   GET  ?view=rules&from=&to=       → กฎที่ทับช่วงเวลา (ตามขอบเขตแบรนด์)
//   POST {action:"save_rule", rule}  → สร้าง/แก้กฎ (สิทธิ์ price.period + ต้องอยู่ในแบรนด์ของตัวเอง)
//   POST {action:"set_list_price", product_id, price, reason} → ตั้งราคาหลัก (สิทธิ์ price.list + แบรนด์ของตัวเอง)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBrandIds, visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { effectivePrices } from "@/lib/server/effective-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_BRANCH = "00000000-0000-0000-0000-000000000000"; // = เฉพาะกฎที่ใช้ทุกสาขา
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const ERR: [string, string][] = [
  ["price_rule_version_conflict", "มีคนแก้กฎนี้ไปก่อนแล้ว — รีเฟรชแล้วลองใหม่"], ["price_rule_products_required", "เลือกสินค้าอย่างน้อย 1 รายการ"],
  ["price_rule_product_not_found", "ไม่พบสินค้าบางรายการ"], ["price_rule_not_found", "ไม่พบกฎราคา"],
  ["pos_price_rules_check", "ข้อมูลกฎไม่ถูกต้อง (ช่วงวันที่/ค่าที่ลด/ขอบเขต)"], ["violates check constraint", "ข้อมูลกฎไม่ถูกต้อง (ช่วงวันที่ต้องถูกลำดับ · ลด % ต้องน้อยกว่า 100 · ต้องเลือกขอบเขต)"],
  ["list_price_reason_required", "กรุณาระบุเหตุผลที่เปลี่ยนราคาหลัก"], ["list_price_invalid", "ราคาไม่ถูกต้อง"], ["employee_access_revoked", "บัญชีถูกระงับ"],
];
const friendly = (m: string) => ERR.find(([k]) => m.includes(k))?.[1] ?? m;

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return null;
  return { profile, authz, brands: visibleBrandIds(authz) };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  if (!hasPerm(c.profile.email, c.authz, "product.view")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const sb = supabaseAdmin();
  const view = req.nextUrl.searchParams.get("view") ?? "products";
  try {
    if (view === "rules") {
      const from = req.nextUrl.searchParams.get("from"), to = req.nextUrl.searchParams.get("to");
      let q = sb.from("pos_price_rules").select("*").neq("status", "cancelled").order("starts_at", { ascending: false }).limit(500);
      if (from) q = q.gt("ends_at", from);
      if (to) q = q.lt("starts_at", to);
      const { data, error } = await q;
      if (error) throw Error("อ่านกฎราคาไม่สำเร็จ — ตรวจ migration 0081");
      let rules = data ?? [];
      if (c.brands !== null) {
        const ok = new Set(c.brands);
        const pb = rules.some((r) => r.scope === "sku") ? new Map(((await sb.from("products").select("id,brand_id").in("id", [...new Set(rules.flatMap((r) => r.product_ids as string[]))])).data ?? []).map((p) => [p.id, p.brand_id])) : new Map();
        rules = rules.filter((r) => r.scope === "sku" ? (r.product_ids as string[]).every((id) => ok.has(pb.get(id) as string)) : ok.has(r.brand_id));
      }
      const people = [...new Set(rules.flatMap((r) => [r.created_by, r.updated_by]).filter(Boolean))] as string[];
      const emps = people.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", people)).data ?? []) : [];
      return reply({ rules, names: Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname])) });
    }
    let q = sb.from("products").select("id,sku,name_th,name_en,brand_id,category_id,price,cost,is_active,track_serial,image_url,kind,updated_at").order("sku").limit(5000);
    if (c.brands !== null) { if (!c.brands.length) return reply({ products: [], brands: [], categories: [], branches: [], perms: {} }); q = q.in("brand_id", c.brands); }
    const [prods, brands, cats, branchesAllowed] = await Promise.all([q, sb.from("brands").select("id,name").order("name"), sb.from("categories").select("id,name_th").order("name_th"), visibleBranchIds(c.authz)]);
    if (prods.error) throw Error("อ่านสินค้าไม่สำเร็จ");
    let bq = sb.from("branches").select("id,code,name,name_th,brand_id").eq("is_active", true).order("code");
    if (branchesAllowed !== null) bq = bq.in("id", branchesAllowed.length ? branchesAllowed : [NO_BRANCH]);
    const branches = (await bq).data ?? [];
    const eff = await effectivePrices(sb, NO_BRANCH, (prods.data ?? []).map((p) => p.id));
    // กฎที่จำกัดเฉพาะบางสาขา (ไม่โชว์ในราคากลาง) → บอกจำนวนไว้
    const now = new Date().toISOString();
    const branchRules = (await sb.from("pos_price_rules").select("scope,product_ids,category_id,brand_id").eq("status", "active").lte("starts_at", now).gt("ends_at", now).neq("branch_ids", "{}")).data ?? [];
    const cost = hasPerm(c.profile.email, c.authz, "report.cost");
    const products = (prods.data ?? []).map((p) => {
      const e = eff.get(p.id);
      const local = branchRules.filter((r) => r.scope === "sku" ? (r.product_ids as string[]).includes(p.id) : r.scope === "category" ? r.category_id === p.category_id && (!r.brand_id || r.brand_id === p.brand_id) : r.brand_id === p.brand_id).length;
      return { ...p, cost: cost ? p.cost : null, current_price: e?.price ?? Number(p.price), rule_id: e?.rule_id ?? null, rule_name: e?.rule_name ?? null, price_type: e?.price_type ?? null, rule_ends_at: e?.ends_at ?? null, branch_rules: local };
    });
    return reply({
      products, brands: c.brands === null ? brands.data ?? [] : (brands.data ?? []).filter((b) => c.brands!.includes(b.id)), categories: (cats.data ?? []).map((x) => ({ id: x.id, name: x.name_th })), branches,
      perms: { list: hasPerm(c.profile.email, c.authz, "price.list"), period: hasPerm(c.profile.email, c.authz, "price.period"), cost, review: hasPerm(c.profile.email, c.authz, "admin.product_manage") && cost && (c.authz.isSuperadmin || c.authz.data_scope === "company"), commission: hasPerm(c.profile.email, c.authz, "commission.manage"), commission_view: hasPerm(c.profile.email, c.authz, "commission.view") },
    });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503); }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req);
  if (!c || !c.authz.employee_id) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const sb = supabaseAdmin();
  const inScope = async (brandId: string | null, productIds: string[] = []) => {
    if (c.brands === null) return true;
    if (productIds.length) {
      const { data } = await sb.from("products").select("brand_id").in("id", productIds);
      return (data ?? []).length === productIds.length && (data ?? []).every((p) => c.brands!.includes(p.brand_id as string));
    }
    return !!brandId && c.brands.includes(brandId);
  };
  if (b?.action === "save_rule") {
    if (!hasPerm(c.profile.email, c.authz, "price.period")) return reply({ error: "ไม่มีสิทธิ์ตั้งราคาช่วงเวลา" }, 403);
    const r = (b.rule ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(r.product_ids) ? (r.product_ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
    if (!["sku", "category", "brand"].includes(String(r.scope))) return reply({ error: "เลือกขอบเขตของราคา" }, 400);
    if (r.scope !== "sku" && !(typeof r.brand_id === "string" && UUID.test(r.brand_id)) && c.brands !== null) return reply({ error: "เลือกแบรนด์" }, 400);
    if (!(await inScope((r.brand_id as string) ?? null, r.scope === "sku" ? ids : []))) return reply({ error: "ตั้งราคาได้เฉพาะสินค้าในแบรนด์ที่คุณดูแล" }, 403);
    // แก้กฎเดิม: กฎเดิมต้องอยู่ในขอบเขตด้วย
    if (typeof r.id === "string" && UUID.test(r.id) && c.brands !== null) {
      const old = (await sb.from("pos_price_rules").select("scope,brand_id,product_ids").eq("id", r.id).maybeSingle()).data;
      if (old && !(await inScope(old.brand_id, old.scope === "sku" ? old.product_ids : []))) return reply({ error: "กฎนี้อยู่นอกแบรนด์ที่คุณดูแล" }, 403);
    }
    const { data, error } = await sb.rpc("pos_save_price_rule", { p_actor: c.authz.employee_id, p_rule: { ...r, product_ids: ids } });
    if (error) return reply({ error: friendly(error.message) }, 409);
    return reply({ rule: data });
  }
  if (b?.action === "set_list_price") {
    if (!hasPerm(c.profile.email, c.authz, "price.list")) return reply({ error: "ไม่มีสิทธิ์ตั้งราคาหลัก" }, 403);
    if (!UUID.test(String(b.product_id))) return reply({ error: "ระบุสินค้าไม่ถูกต้อง" }, 400);
    if (!(await inScope(null, [String(b.product_id)]))) return reply({ error: "ตั้งราคาได้เฉพาะสินค้าในแบรนด์ที่คุณดูแล" }, 403);
    const { data, error } = await sb.rpc("pos_set_list_price", { p_actor: c.authz.employee_id, p_product: b.product_id, p_price: Number(b.price), p_reason: String(b.reason ?? "").slice(0, 500) });
    if (error) return reply({ error: friendly(error.message) }, 409);
    return reply(data);
  }
  return reply({ error: "คำสั่งไม่ถูกต้อง" }, 400);
}
