// /api/pos/returns — คืนสินค้า / ยกเลิกบิล (โหมดจริง) · เซิร์ฟเวอร์คิดยอดคืนเงินจากบิลจริงและตัดสินทุกอย่าง (0062)
//   GET  ?branch_id=            → คำขอที่รออนุมัติ + ประวัติ 30 วันของสาขา
//   POST {action:"request", ...} → ขอคืน/ยกเลิก (ผู้มีสิทธิ์อนุมัติเอง = อนุมัติทันที)
//   POST {action:"decide", return_id, approve, note} → อนุมัติ/ปฏิเสธ (return.approve)
//   POST {action:"jst_done", return_id}              → บันทึกว่าทำรับคืนใน JST แล้ว (return.approve / integration.manage)
//   สาขาผูกคลังกลาง + บิลถึง JST แล้ว: ไม่คืนสต๊อก POS · สร้างงาน "ทำรับคืนใน JST" (OW ยังไม่มี API ยกเลิก/คืนบิล)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const ERR: Record<string, string> = {
  return_order_not_found: "ไม่พบบิลในระบบกลาง", return_order_not_returnable: "บิลนี้ถูกยกเลิกหรือคืนครบแล้ว",
  return_branch_forbidden: "ไม่มีสิทธิ์ในสาขาของบิลนี้", void_has_returns: "บิลนี้มีการคืนสินค้าแล้ว ยกเลิกทั้งบิลไม่ได้ — ใช้การคืนรายการแทน",
  return_qty_exceeds: "จำนวนคืนเกินที่ขาย (รวมคำขอที่รออนุมัติ)", return_serials_required: "กรุณาสแกน/เลือก SN ที่คืนให้ครบตามจำนวน",
  return_serial_not_in_bill: "SN นี้ไม่ได้อยู่ในบิลนี้", return_invalid_condition: "สภาพสินค้าไม่ถูกต้อง", return_no_items: "ยังไม่ได้เลือกสินค้าที่คืน",
  return_not_found: "ไม่พบคำขอคืน", return_invalid_kind: "ประเภทรายการไม่ถูกต้อง",
};
const msg = (m: string) => ERR[m] ?? m;
const REFUND_METHODS = ["cash", "credit_card", "debit_card", "qr_promptpay", "bank_transfer", "edc", "gift"];

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id) return null;
  return { profile, authz, actor: authz.employee_id, allowed: await visibleBranchIds(authz) };
}

async function jstTask(sb: ReturnType<typeof supabaseAdmin>, returnId: string) {
  const r = await sb.from("returns").select("id,return_no,branch_id,kind,refund_amount,jst_state,requested_by,orders!returns_order_id_fkey(order_no),return_items(sku,qty,condition,serials)").eq("id", returnId).single();
  if (r.error || !r.data || r.data.jst_state !== "pending") return;
  const d = r.data as unknown as { id: string; return_no: string; branch_id: string; kind: string; refund_amount: number; requested_by: string | null; orders: { order_no: string } | null; return_items: { sku: string; qty: number; condition: string; serials: string[] }[] };
  const lines = d.return_items.map((i) => `• ${i.sku} × ${Number(i.qty)} (${i.condition === "defective" ? "ชำรุด" : "ขายได้"})${i.serials?.length ? ` SN ${i.serials.join(", ")}` : ""}`).join("\n");
  await sb.rpc("pos_ow_issue_upsert", {
    p_kind: "ow_return", p_source: d.id, p_branch: d.branch_id,
    p_title: `${d.kind === "void" ? "ยกเลิกบิล" : "คืนสินค้า"} ${d.return_no}: ทำรับคืนใน JST (บิล ${d.orders?.order_no ?? ""})`,
    p_desc: `บิลนี้ถูกส่งเข้า JST แล้ว แต่ OneWarehouse ยังไม่มี API ยกเลิก/คืนบิล — ให้ทีมคลังกลางทำรับคืน (after-sale) ใน JST:\n${lines}\nยอดคืนเงิน ${d.refund_amount} บาท\n\nเสร็จแล้วกด "ทำใน JST แล้ว" ที่หน้า คืน/เปลี่ยนสินค้า แล้ว "ปรับยอดจาก OW" เพื่อดึงสต๊อกกลับ`,
    p_priority: "high", p_sig: `pending:${d.id}`, p_hint: d.requested_by,
  });
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  // ?status_of=uuid,uuid → สถานะบิลในระบบกลาง (ยกเลิก/คืน จากเครื่องอื่นหรือหัวหน้าอนุมัติภายหลัง) ให้เครื่องอัปเดตสำเนาในเครื่อง
  const statusOf = req.nextUrl.searchParams.get("status_of");
  if (statusOf !== null) {
    const ids = statusOf.split(",").filter((x) => UUID.test(x)).slice(0, 300);
    if (!ids.length) return reply({ statuses: {} });
    const o = await supabaseAdmin().from("orders").select("client_uuid,status,branch_id").in("client_uuid", ids);
    if (o.error) return reply({ error: "อ่านสถานะบิลไม่สำเร็จ" }, 503);
    const statuses: Record<string, string> = {};
    for (const r of o.data ?? []) if (c.allowed === null || c.allowed.includes(r.branch_id as string)) statuses[r.client_uuid as string] = r.status as string;
    return reply({ statuses });
  }
  const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
  if (!UUID.test(branch)) return reply({ error: "สาขาไม่ถูกต้อง" }, 400);
  if (c.allowed !== null && !c.allowed.includes(branch)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const r = await supabaseAdmin().from("returns")
    .select("id,return_no,kind,type,status,reason_code,reason_note,refund_method,refund_amount,requested_by,approved_by,approved_at,created_at,ow_linked,jst_state,points_reversed,decided_note,orders!returns_order_id_fkey(order_no,client_uuid),return_items(sku,name,qty,line_total,condition,serials)")
    .eq("branch_id", branch).or(`status.eq.pending_approval,created_at.gte.${since}`).order("created_at", { ascending: false }).limit(200);
  if (r.error) return reply({ error: "อ่านรายการคืนไม่สำเร็จ — ตรวจ migration 0062" }, 503);
  return reply({ items: r.data ?? [], can_approve: hasPerm(c.profile.email, c.authz, "return.approve") });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req);
  if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const sb = supabaseAdmin();
  const canApprove = hasPerm(c.profile.email, c.authz, "return.approve");
  try {
    if (b?.action === "request") {
      if (!hasPerm(c.profile.email, c.authz, "return.create") && !canApprove) {
        // return.create = approval → ขอได้ แต่ต้องรอผู้อนุมัติ (ไม่ใช่ deny)
        if (c.authz.permission_overrides?.["return.create"] === "deny") return reply({ error: "ไม่มีสิทธิ์รับคืนสินค้า" }, 403);
      }
      const p = (b.payload ?? {}) as Record<string, unknown>;
      if (!UUID.test(String(p.client_uuid)) || !UUID.test(String(p.order_client_uuid))) return reply({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, 400);
      // ช่องทางคืนเงินต้องตรง enum payment_method (ไม่มี store_credit) · ยกเลิกบิล DB ใช้วิธีชำระเดิมของบิลเอง
      if (p.kind === "void") p.refund_method = null;
      else if (p.refund_method != null && !REFUND_METHODS.includes(String(p.refund_method))) return reply({ error: "ช่องทางคืนเงินนี้ยังไม่รองรับในระบบกลาง" }, 400);
      // บรรทัดบิล: เครื่องส่ง sku+occurrence (รหัสบรรทัดในเครื่อง ≠ ในระบบกลาง) → แปลงเป็น order_item_id ที่นี่ (ตรวจ sku ตรงกัน)
      if (Array.isArray(p.items)) {
        const ord = await sb.from("orders").select("id").eq("client_uuid", String(p.order_client_uuid)).maybeSingle();
        if (ord.error || !ord.data) return reply({ error: ERR.return_order_not_found }, 404);
        const rows = await sb.from("order_items").select("id,sku,sort_order").eq("order_id", ord.data.id).order("sort_order", { ascending: true }).order("id");
        if (rows.error) return reply({ error: "อ่านรายการในบิลไม่สำเร็จ" }, 503);
        const list = rows.data ?? [];
        const mapped = [];
        for (const raw of p.items as Record<string, unknown>[]) {
          if (UUID.test(String(raw.order_item_id))) { mapped.push(raw); continue; }
          // จับคู่ด้วย SKU + ลำดับที่ของ SKU นั้นในบิล (ของแถมแคมเปญถูกต่อท้ายบิลฝั่งกลาง ลำดับรวมจึงอาจไม่ตรงเครื่อง)
          const row = list.filter((x) => x.sku === raw.sku)[Number(raw.occurrence) || 0];
          if (!row) return reply({ error: `รายการ ${String(raw.sku)} ไม่ตรงกับบิลในระบบกลาง กรุณาค้นบิลใหม่` }, 409);
          mapped.push({ order_item_id: row.id, qty: raw.qty, condition: raw.condition === "sellable" ? "sellable" : "defective", serials: raw.serials ?? [] });
        }
        p.items = mapped;
      }
      const req1 = await sb.rpc("pos_return_request", { p_actor: c.actor, p_payload: p });
      if (req1.error) return reply({ error: msg(req1.error.message) }, 409);
      const out = req1.data as { return_id: string; status: string; refund_amount: number };
      if (canApprove && out.status === "pending_approval") {
        const d = await sb.rpc("pos_return_decide", { p_return: out.return_id, p_actor: c.actor, p_approve: true, p_note: "อนุมัติโดยผู้ทำรายการ (มีสิทธิ์อนุมัติ)" });
        if (d.error) return reply({ error: msg(d.error.message) }, 409);
        await jstTask(sb, out.return_id);
        return reply({ ...out, ...(d.data as object), approved_now: true });
      }
      return reply(out);
    }
    if (b?.action === "decide") {
      if (!canApprove) return reply({ error: "ต้องให้ผู้มีสิทธิ์อนุมัติคืนสินค้าเป็นผู้กด" }, 403);
      if (!UUID.test(String(b.return_id))) return reply({ error: "รหัสคำขอไม่ถูกต้อง" }, 400);
      const d = await sb.rpc("pos_return_decide", { p_return: b.return_id, p_actor: c.actor, p_approve: b.approve === true, p_note: String(b.note ?? "").slice(0, 1000) || null });
      if (d.error) return reply({ error: msg(d.error.message) }, 409);
      if (b.approve === true) await jstTask(sb, String(b.return_id));
      return reply(d.data);
    }
    if (b?.action === "jst_done") {
      if (!canApprove && !hasPerm(c.profile.email, c.authz, "integration.manage")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
      if (!UUID.test(String(b.return_id))) return reply({ error: "รหัสคำขอไม่ถูกต้อง" }, 400);
      const u = await sb.from("returns").update({ jst_state: "done" }).eq("id", b.return_id).eq("jst_state", "pending").select("id,branch_id");
      if (u.error) return reply({ error: "บันทึกไม่สำเร็จ" }, 503);
      if (!u.data?.length) return reply({ error: "รายการนี้ไม่ได้รอทำใน JST" }, 409);
      await sb.rpc("pos_ow_issue_resolve", { p_kind: "ow_return", p_source: b.return_id, p_note: "ทีมคลังกลางทำรับคืนใน JST แล้ว" });
      await sb.from("audit_logs").insert({ action: "return_jst_done", actor_id: c.actor, branch_id: u.data[0].branch_id, ref_table: "returns", ref_id: b.return_id });
      return reply({ ok: true });
    }
    return reply({ error: "คำสั่งไม่ถูกต้อง" }, 400);
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 500);
  }
}
