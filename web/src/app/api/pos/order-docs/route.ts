// /api/pos/order-docs — เอกสารทั้งหมดของบิล (จัดตามขั้น) + ออกใบกำกับภาษีเต็มรูป
//   GET  ?client_uuid= | ?order_no=  → { docs, buyer_prefill, can_issue_tax }   (ผู้ใช้ที่เห็นสาขาของบิล)
//   POST { action:"issue_tax_invoice", client_uuid, buyer:{name,tax_id,branch_no,address,phone}, replace_reason? }  (สิทธิ์ tax.issue_full)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadOrder } from "@/lib/server/order-trace";
import { listOrderDocs, docUrl } from "@/lib/server/order-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const ERR: Record<string, string> = {
  tax_invoice_order_not_eligible: "บิลถูกยกเลิก/คืนครบแล้ว ออกใบกำกับภาษีไม่ได้", tax_invoice_branch_forbidden: "ไม่มีสิทธิ์ในสาขาของบิลนี้",
  tax_invoice_buyer_name: "กรุณากรอกชื่อผู้ซื้อ", tax_invoice_buyer_tax_id: "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก", tax_invoice_buyer_address: "กรุณากรอกที่อยู่ผู้ซื้อให้ครบ",
  tax_invoice_exists: "บิลนี้ออกใบกำกับภาษีแล้ว — ถ้าต้องการแก้ไข ให้ระบุเหตุผลเพื่อยกเลิกใบเดิมและออกใบใหม่", tax_invoice_order_not_found: "ไม่พบบิล",
};

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return null;
  return { profile, authz, allowed: await visibleBranchIds(authz) };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const cu = req.nextUrl.searchParams.get("client_uuid"), no = req.nextUrl.searchParams.get("order_no");
  if (!(cu && UUID.test(cu)) && !(no && no.length < 60)) return reply({ error: "ระบุบิลไม่ถูกต้อง" }, 400);
  try {
    const o = await loadOrder(cu && UUID.test(cu) ? { client_uuid: cu } : { order_no: no });
    if (!o) return reply({ error: "ยังไม่พบบิลนี้ในระบบกลาง" }, 404);
    if (c.allowed !== null && !c.allowed.includes(o.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
    const canTrace = hasPerm(c.profile.email, c.authz, "sales.trace");
    const docs = (await listOrderDocs(o)).filter((d) => !d.internal || canTrace);
    const cust = o.customer_id ? (await supabaseAdmin().from("customers").select("name,tax_id,tax_name,tax_address,tax_branch_no,phone").eq("id", o.customer_id).maybeSingle()).data : null;
    return reply({
      order: { order_no: o.order_no, client_uuid: o.client_uuid, status: o.status },
      docs, can_issue_tax: hasPerm(c.profile.email, c.authz, "tax.issue_full"),
      buyer_prefill: cust ? { name: cust.tax_name || cust.name, tax_id: cust.tax_id ?? "", branch_no: cust.tax_branch_no ?? "", address: cust.tax_address ?? "", phone: cust.phone ?? "" } : null,
    });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503); }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req);
  if (!c || !c.authz.employee_id) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (b?.action !== "issue_tax_invoice") return reply({ error: "คำสั่งไม่ถูกต้อง" }, 400);
  if (!hasPerm(c.profile.email, c.authz, "tax.issue_full")) return reply({ error: "ไม่มีสิทธิ์ออกใบกำกับภาษีเต็มรูป" }, 403);
  if (!UUID.test(String(b.client_uuid))) return reply({ error: "ระบุบิลไม่ถูกต้อง" }, 400);
  const o = await loadOrder({ client_uuid: String(b.client_uuid) });
  if (!o) return reply({ error: "ไม่พบบิล" }, 404);
  if (c.allowed !== null && !c.allowed.includes(o.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
  const sb = supabaseAdmin();
  const r = await sb.rpc("pos_issue_tax_invoice", { p_order: o.id, p_actor: c.authz.employee_id, p_buyer: b.buyer ?? {}, p_replace_reason: b.replace_reason ? String(b.replace_reason).slice(0, 500) : null });
  if (r.error) return reply({ error: ERR[r.error.message] ?? r.error.message }, 409);
  const out = r.data as { id: string; invoice_no: string; replay?: boolean; replaced?: string | null };
  // เก็บข้อมูลภาษีไว้ที่ลูกค้า (ครั้งหน้าเติมให้อัตโนมัติ) — เฉพาะช่องที่ยังว่าง
  if (o.customer_id && b.buyer && typeof b.buyer === "object") {
    const by = b.buyer as Record<string, string>;
    const cur = (await sb.from("customers").select("tax_id,tax_name,tax_address,tax_branch_no").eq("id", o.customer_id).maybeSingle()).data;
    if (cur) {
      const patch: Record<string, string> = {};
      if (!cur.tax_id && by.tax_id) patch.tax_id = by.tax_id.replace(/\D/g, "");
      if (!cur.tax_name && by.name) patch.tax_name = by.name.trim();
      if (!cur.tax_address && by.address) patch.tax_address = by.address.trim();
      if (!cur.tax_branch_no && by.branch_no) patch.tax_branch_no = by.branch_no.replace(/\D/g, "").padStart(5, "0");
      if (Object.keys(patch).length) await sb.from("customers").update(patch).eq("id", o.customer_id);
    }
  }
  return reply({ ...out, url: docUrl("tax_invoice", out.id) });
}
