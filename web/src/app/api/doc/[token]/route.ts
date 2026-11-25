// /api/doc/[token] — ข้อมูลเอกสารสำหรับหน้าแชร์ /doc/[token]
//   เอกสารลูกค้า (ใบเสร็จ/ใบกำกับ/ใบคืน/ใบรับประกัน): เปิดได้ด้วยลิงก์ที่ลงลายเซ็น (ไม่ต้องล็อกอิน · หมดอายุ 90 วัน · ปิดเบอร์ลูกค้าบางส่วน)
//   เอกสารภายใน (รายงานที่มาของบิล): ต้องล็อกอิน + สิทธิ์ sales.trace + เห็นสาขาของบิล
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { verifyDocToken, INTERNAL_KINDS } from "@/lib/server/doc-token";
import { buildDoc, docUrl } from "@/lib/server/order-docs";
import { loadOrder } from "@/lib/server/order-trace";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  let p;
  try { p = verifyDocToken(decodeURIComponent(params.token)); } catch (e) { return reply({ error: e instanceof Error ? e.message : "ตั้งค่าไม่ครบ" }, 503); }
  if (!p) return reply({ error: "ลิงก์เอกสารไม่ถูกต้องหรือหมดอายุแล้ว — ขอลิงก์ใหม่จากสาขา" }, 404);
  try {
    const built = await buildDoc(p.k, p.id);
    if (!built) return reply({ error: "ไม่พบเอกสาร" }, 404);
    if (INTERNAL_KINDS.includes(p.k)) {
      const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
      if (!profile) return reply({ error: "เอกสารภายใน — กรุณาเข้าสู่ระบบก่อน", login: true }, 401);
      const authz = await resolveAuthz(profile);
      if (!authz.allowed || !hasPerm(profile.email, authz, "sales.trace")) return reply({ error: "ไม่มีสิทธิ์ดูเอกสารภายใน" }, 403);
      const allowed = await visibleBranchIds(authz);
      if (allowed !== null && !allowed.includes(built.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
    }
    // ใบเสร็จ: บอกลูกค้าว่าออกใบกำกับเต็มรูปแล้วหรือยัง / มีคำขอค้างไหม
    let tax: unknown = null;
    if (p.k === "receipt") {
      const o = await loadOrder({ client_uuid: p.id });
      if (o) {
        const sb = supabaseAdmin();
        const [ti, rq] = await Promise.all([
          sb.from("tax_invoices").select("id,invoice_no").eq("order_id", o.id).eq("status", "issued").maybeSingle(),
          sb.from("tax_invoice_requests").select("status,created_at").eq("order_id", o.id).eq("status", "pending").maybeSingle(),
        ]);
        tax = { eligible: ["completed", "partially_refunded"].includes(o.status), issued: ti.data ? { invoice_no: ti.data.invoice_no, url: docUrl("tax_invoice", ti.data.id) } : null, pending: !!rq.data };
      }
    }
    return reply({ doc: built.doc, expires_at: new Date(p.e * 1000).toISOString(), tax });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "สร้างเอกสารไม่สำเร็จ" }, 503); }
}

// POST — ลูกค้าขอใบกำกับภาษีเต็มรูปจากลิงก์ใบเสร็จ (ไม่ต้องล็อกอิน · เฉพาะ token ใบเสร็จ · จำกัดความถี่)
const hits = new Map<string, number[]>();
const ERR: Record<string, string> = {
  tax_invoice_order_not_eligible: "บิลนี้ถูกยกเลิก/คืนแล้ว ขอใบกำกับภาษีไม่ได้", tax_invoice_already_issued: "บิลนี้ออกใบกำกับภาษีแล้ว",
  tax_invoice_buyer_name: "กรุณากรอกชื่อผู้ซื้อ/บริษัท", tax_invoice_buyer_tax_id: "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก", tax_invoice_buyer_address: "กรุณากรอกที่อยู่ตามทะเบียนให้ครบ",
};
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let p;
  try { p = verifyDocToken(decodeURIComponent(params.token)); } catch { return reply({ error: "ตั้งค่าไม่ครบ" }, 503); }
  if (!p || p.k !== "receipt") return reply({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" }, 404);
  const now = Date.now(), list = (hits.get(p.id) ?? []).filter((t) => now - t < 600_000);
  if (list.length >= 5) return reply({ error: "ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง" }, 429);
  hits.set(p.id, [...list, now]);
  const b = (await req.json().catch(() => null)) as { buyer?: Record<string, string>; contact?: string } | null;
  const o = await loadOrder({ client_uuid: p.id });
  if (!o) return reply({ error: "ไม่พบบิล" }, 404);
  const r = await supabaseAdmin().rpc("pos_request_tax_invoice", { p_order: o.id, p_buyer: b?.buyer ?? {}, p_contact: typeof b?.contact === "string" ? b.contact.slice(0, 200) : null });
  if (r.error) return reply({ error: ERR[r.error.message] ?? "ส่งคำขอไม่สำเร็จ" }, 409);
  return reply({ ok: true, ...(r.data as object) });
}
