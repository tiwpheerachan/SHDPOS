// /api/admin/commission — กฎค่าคอม + รายงานค่าคอมพนักงาน (0082)
//   GET ?view=rules                → กฎ (ตามขอบเขตแบรนด์) · สิทธิ์ commission.view หรือ commission.manage
//   GET ?view=report&from=&to=     → ค่าคอมต่อพนักงาน × กฎ (ตามสาขาที่เห็น · ขอบเขต own = เฉพาะของตัวเอง)
//   POST {action:"save_rule", rule} → สร้าง/แก้/หยุดกฎ (commission.manage + แบรนด์ของตัวเอง)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBrandIds, visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const ERR: [string, string][] = [["commission_invalid_tiers", "ขั้นค่าคอมไม่ถูกต้อง — ยอดเริ่มของแต่ละขั้นต้องไม่ซ้ำ ค่าไม่ติดลบ และ % ไม่เกิน 100"], ["commission_version_conflict", "มีคนแก้กฎนี้ไปก่อนแล้ว — รีเฟรชแล้วลองใหม่"], ["violates check constraint", "ข้อมูลกฎไม่ครบ (ช่วงวันที่/ขอบเขต/ขั้น)"], ["commission_rule_not_found", "ไม่พบกฎ"]];
const friendly = (m: string) => ERR.find(([k]) => m.includes(k))?.[1] ?? m;

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return null;
  return { profile, authz, brands: visibleBrandIds(authz) };
}
async function ruleInScope(sb: ReturnType<typeof supabaseAdmin>, brands: string[] | null, r: { scope: string; brand_id: string | null; product_ids: string[] }) {
  if (brands === null) return true;
  if (r.scope === "sku") { const { data } = await sb.from("products").select("brand_id").in("id", r.product_ids); return (data ?? []).length === r.product_ids.length && (data ?? []).every((p) => brands.includes(p.brand_id as string)); }
  return !!r.brand_id && brands.includes(r.brand_id);
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  if (!hasPerm(c.profile.email, c.authz, "commission.view") && !hasPerm(c.profile.email, c.authz, "commission.manage")) return reply({ error: "ไม่มีสิทธิ์ดูค่าคอม" }, 403);
  const sb = supabaseAdmin();
  try {
    const all = (await sb.from("pos_commission_rules").select("*").neq("status", "cancelled").order("starts_at", { ascending: false }).limit(500)).data ?? [];
    const rules = [];
    for (const r of all) if (await ruleInScope(sb, c.brands, r)) rules.push(r);
    if (req.nextUrl.searchParams.get("view") !== "report") return reply({ rules });
    const from = req.nextUrl.searchParams.get("from"), to = req.nextUrl.searchParams.get("to");
    if (!from || !to) return reply({ error: "ระบุช่วงวันที่" }, 400);
    const branches = await visibleBranchIds(c.authz);
    const { data, error } = await sb.rpc("pos_commission_report", { p_from: from, p_to: to, p_branches: branches });
    if (error) throw Error("คำนวณค่าคอมไม่สำเร็จ — ตรวจ migration 0082");
    const ruleIds = new Set(rules.map((r) => r.id));
    let rows = ((data ?? []) as { rule_id: string; employee_id: string }[]).filter((r) => ruleIds.has(r.rule_id));
    if (c.authz.data_scope === "own" && !c.authz.isSuperadmin) rows = rows.filter((r) => r.employee_id === c.authz.employee_id);
    const people = [...new Set(rows.map((r) => r.employee_id))];
    const emps = people.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname,home_branch_id").in("id", people)).data ?? []) : [];
    return reply({ rules, rows, people: Object.fromEntries(emps.map((e) => [e.id, { name: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname, branch_id: e.home_branch_id }])) });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503); }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req);
  if (!c || !c.authz.employee_id) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  if (!hasPerm(c.profile.email, c.authz, "commission.manage")) return reply({ error: "ไม่มีสิทธิ์ตั้งค่าคอม" }, 403);
  const b = (await req.json().catch(() => null)) as { action?: string; rule?: Record<string, unknown> } | null;
  if (b?.action !== "save_rule" || !b.rule) return reply({ error: "คำสั่งไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  const r = b.rule;
  const ids = Array.isArray(r.product_ids) ? (r.product_ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
  const scoped = { scope: String(r.scope), brand_id: typeof r.brand_id === "string" ? r.brand_id : null, product_ids: ids };
  if (!(await ruleInScope(sb, c.brands, scoped))) return reply({ error: "ตั้งค่าคอมได้เฉพาะสินค้าในแบรนด์ที่คุณดูแล" }, 403);
  if (typeof r.id === "string" && UUID.test(r.id) && c.brands !== null) {
    const old = (await sb.from("pos_commission_rules").select("scope,brand_id,product_ids").eq("id", r.id).maybeSingle()).data;
    if (old && !(await ruleInScope(sb, c.brands, old))) return reply({ error: "กฎนี้อยู่นอกแบรนด์ที่คุณดูแล" }, 403);
  }
  const { data, error } = await sb.rpc("pos_save_commission_rule", { p_actor: c.authz.employee_id, p_rule: { ...r, product_ids: ids } });
  if (error) return reply({ error: friendly(error.message) }, 409);
  return reply({ rule: data });
}
