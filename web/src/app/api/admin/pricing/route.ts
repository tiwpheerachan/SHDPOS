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
import { aiJson } from "@/lib/server/ai-text";
import { branchBrandMap } from "@/lib/server/branch-brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_BRANCH = "00000000-0000-0000-0000-000000000000"; // = เฉพาะกฎที่ใช้ทุกสาขา
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const ERR: [string, string][] = [
  ["price_rule_version_conflict", "มีคนแก้กฎนี้ไปก่อนแล้ว — รีเฟรชแล้วลองใหม่"], ["price_rule_products_required", "เลือกสินค้าอย่างน้อย 1 รายการ"],
  ["price_rule_product_not_found", "ไม่พบสินค้าบางรายการ"], ["price_rule_not_found", "ไม่พบกฎราคา"],
  ["pos_price_rules_check", "ข้อมูลกฎไม่ถูกต้อง (ช่วงวันที่/ค่าที่ลด/ขอบเขต)"], ["violates check constraint", "ข้อมูลกฎไม่ถูกต้อง (ช่วงวันที่ต้องถูกลำดับ · ลด % ต้องน้อยกว่า 100 · ต้องเลือกขอบเขต)"],
  ["price_revert_reason_required", "กรุณาระบุเหตุผลที่ย้อนกลับ"], ["price_import_", "ข้อมูลนำเข้าไม่ถูกต้อง"],
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
    if (view === "history") {
      // ไทม์ไลน์ราคาของสินค้า 1 ตัว (ราคาหลัก + กฎที่ครอบ) ล่าสุดก่อน
      const pid = req.nextUrl.searchParams.get("product_id") ?? "";
      if (!UUID.test(pid)) return reply({ error: "ระบุสินค้าไม่ถูกต้อง" }, 400);
      const prod = (await sb.from("products").select("id,brand_id").eq("id", pid).maybeSingle()).data;
      if (!prod || (c.brands !== null && !c.brands.includes(prod.brand_id as string))) return reply({ error: "ไม่มีสิทธิ์ดูสินค้านี้" }, 403);
      const { data, error } = await sb.from("pos_price_events").select("id,kind,rule_id,batch_id,before,after,actor_id,at").contains("product_ids", [pid]).order("id", { ascending: false }).limit(300);
      if (error) throw Error("อ่านประวัติราคาไม่สำเร็จ — ตรวจ migration 0084");
      const ids = [...new Set((data ?? []).map((e) => e.actor_id).filter(Boolean))] as string[];
      const bids = [...new Set((data ?? []).map((e) => e.batch_id).filter(Boolean))] as string[];
      const [emps, batches] = await Promise.all([
        ids.length ? sb.from("employees").select("id,first_name,last_name,nickname").in("id", ids) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string | null; nickname: string | null }[] }),
        bids.length ? sb.from("pos_price_batches").select("id,title,file_name,status").in("id", bids) : Promise.resolve({ data: [] as { id: string; title: string; file_name: string | null; status: string }[] }),
      ]);
      return reply({ events: data ?? [], names: Object.fromEntries((emps.data ?? []).map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname])), batches: Object.fromEntries((batches.data ?? []).map((b) => [b.id, b])) });
    }
    if (view === "batches") {
      const { data, error } = await sb.from("pos_price_batches").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw Error("อ่านประวัติการนำเข้าไม่สำเร็จ — ตรวจ migration 0084");
      const ids = [...new Set((data ?? []).flatMap((b) => [b.created_by, b.reverted_by]).filter(Boolean))] as string[];
      const emps = ids.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", ids)).data ?? []) : [];
      return reply({ batches: data ?? [], names: Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname])) });
    }
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
    const branchRows = (await bq).data ?? [];
    // แบรนด์ที่แต่ละสาขาขาย — ใช้เลือก "สาขานี้เอาแบรนด์ไหน" ตอนดาวน์โหลดเทมเพลต
    const bbm = await branchBrandMap(branchRows.map((b) => b.id));
    const branches = branchRows.map((b) => ({ ...b, brand_ids: bbm.map[b.id] ?? (b.brand_id ? [b.brand_id] : []) }));
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
  if (b?.action === "import") {
    // นำเข้าราคาจากไฟล์ (ตรวจแล้วที่หน้าพรีวิว) — เซิร์ฟเวอร์ตรวจซ้ำ: สิทธิ์ + แบรนด์ + ค่า · ทั้งชุดหรือไม่มีเลย
    const rows = Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]) : [];
    if (!rows.length || rows.length > 5000) return reply({ error: "ไม่มีรายการที่จะนำเข้า (สูงสุด 5,000 แถว)" }, 400);
    const wantsList = rows.some((r) => typeof r.list_price === "number"), wantsRule = rows.some((r) => r.rule && typeof r.rule === "object");
    if (wantsList && !hasPerm(c.profile.email, c.authz, "price.list")) return reply({ error: "ไฟล์มีการเปลี่ยนราคาหลัก แต่คุณไม่มีสิทธิ์ตั้งราคาหลัก" }, 403);
    if (wantsRule && !hasPerm(c.profile.email, c.authz, "price.period")) return reply({ error: "ไฟล์มีราคาช่วงเวลา แต่คุณไม่มีสิทธิ์ตั้งราคาช่วงเวลา" }, 403);
    const ids = rows.map((r) => String(r.product_id));
    if (ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) return reply({ error: "สินค้าในไฟล์ซ้ำหรือไม่ถูกต้อง" }, 400);
    if (!(await inScope(null, ids))) return reply({ error: "มีสินค้านอกแบรนด์ที่คุณดูแลในไฟล์" }, 403);
    const clean = rows.map((r) => {
      const out: Record<string, unknown> = { product_id: r.product_id };
      if (typeof r.list_price === "number" && r.list_price > 0) out.list_price = Math.round(r.list_price * 100) / 100;
      const x = r.rule as Record<string, unknown> | undefined;
      if (x && ["price", "amount", "percent"].includes(String(x.mode)) && Number(x.value) > 0) out.rule = {
        name: String(x.name ?? "").slice(0, 120), price_type: ["monthly", "launch", "clearance", "event", "member", "other"].includes(String(x.price_type)) ? x.price_type : "monthly",
        mode: x.mode, value: Number(x.value), rounding: ["none", "baht", "down10", "end9"].includes(String(x.rounding)) ? x.rounding : "baht",
        starts_at: x.starts_at, ends_at: x.ends_at, branch_ids: Array.isArray(x.branch_ids) ? (x.branch_ids as unknown[]).filter((v) => typeof v === "string" && UUID.test(v)) : [],
      };
      return out;
    }).filter((r) => r.list_price != null || r.rule);
    if (!clean.length) return reply({ error: "ไม่มีการเปลี่ยนแปลงในไฟล์" }, 400);
    const { data, error } = await sb.rpc("pos_import_prices", { p_actor: c.authz.employee_id, p_meta: { title: String(b.title ?? "").slice(0, 200), file_name: String(b.file_name ?? "").slice(0, 200) }, p_rows: clean });
    if (error) return reply({ error: friendly(error.message) }, 409);
    return reply(data);
  }
  if (b?.action === "ai_review") {
    // AI ให้ความเห็นไฟล์ราคาก่อนนำเข้า — ส่งเฉพาะ SKU/ราคา/สถิติ (ไม่มีข้อมูลส่วนบุคคล) · ไม่มีคีย์/ล้ม → source "none" (หน้าจอใช้ผลตรวจจากกฎ)
    if (!hasPerm(c.profile.email, c.authz, "price.period") && !hasPerm(c.profile.email, c.authz, "price.list")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
    const sample = (Array.isArray(b.sample) ? b.sample : []).slice(0, 60);
    const system = `คุณคือผู้ตรวจราคาสินค้าก่อนนำเข้าระบบ POS ร้านค้าปลีกไทย ตรวจหา: ราคาพิมพ์ผิดหลัก, ใส่ราคาแทน %, ส่วนลดไม่สมเหตุผลเทียบสินค้าอื่น, ช่วงวันที่แปลก, สินค้าที่น่าจะตกหล่น, ราคาต่ำกว่าทุน
ตอบเป็น JSON เท่านั้น: {"verdict":"ok|review|stop","summary":"สรุป 1-2 ประโยคภาษาไทย บอกว่าควรยืนยันหรือไม่ เพราะอะไร","findings":[{"severity":"high|medium|info","title":"หัวข้อสั้น","detail":"รายละเอียดสั้น","skus":["SKU"]}]}
วันนี้คือ today_bangkok — ช่วงวันที่ในเดือนถัดไปถือว่าปกติ · ราคาหลักเดิม 0 = สินค้าตั้งราคาครั้งแรก ไม่ใช่ความผิดปกติ · ห้ามซ้ำกับข้อสังเกตที่ระบบตรวจแล้ว (ให้เสริมเฉพาะที่เห็นเพิ่ม) · ถ้าไม่พบอะไรเพิ่ม findings เป็น [] · verdict=stop เมื่อมีโอกาสสูงว่าพิมพ์ผิด`;
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const user = JSON.stringify({ today_bangkok: today, stats: b.stats ?? {}, rule_findings: (Array.isArray(b.findings) ? b.findings : []).map((x: { title?: string }) => x.title).slice(0, 20), rows: sample });
    const out = await aiJson<{ verdict?: string; summary?: string; findings?: { severity?: string; title?: string; detail?: string; skus?: string[] }[] }>(system, user, { timeoutMs: 15_000, maxTokens: 900 });
    if (!out) return reply({ source: "none" });
    return reply({ source: "ai", verdict: ["ok", "review", "stop"].includes(String(out.verdict)) ? out.verdict : "review", summary: String(out.summary ?? "").slice(0, 600),
      findings: (out.findings ?? []).slice(0, 10).map((x, i) => ({ id: `ai${i}`, severity: ["high", "medium", "info"].includes(String(x.severity)) ? x.severity : "info", title: String(x.title ?? "").slice(0, 160), detail: String(x.detail ?? "").slice(0, 400), skus: Array.isArray(x.skus) ? x.skus.map(String).slice(0, 50) : [] })) });
  }
  if (b?.action === "revert_batch") {
    if (!hasPerm(c.profile.email, c.authz, "price.period") && !hasPerm(c.profile.email, c.authz, "price.list")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
    if (!UUID.test(String(b.batch_id))) return reply({ error: "ระบุชุดไม่ถูกต้อง" }, 400);
    if (c.brands !== null) {
      const pids = [...new Set(((await sb.from("pos_price_events").select("product_ids").eq("batch_id", b.batch_id)).data ?? []).flatMap((e) => e.product_ids as string[]))];
      if (pids.length && !(await inScope(null, pids))) return reply({ error: "ชุดนี้มีสินค้านอกแบรนด์ที่คุณดูแล" }, 403);
    }
    const { data, error } = await sb.rpc("pos_revert_price_batch", { p_actor: c.authz.employee_id, p_batch: b.batch_id, p_reason: String(b.reason ?? "").slice(0, 500) });
    if (error) return reply({ error: friendly(error.message) }, 409);
    return reply(data);
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
