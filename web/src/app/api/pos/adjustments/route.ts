// /api/pos/adjustments — ใบขอปรับสต๊อก + อนุมัติ (0078 · UAT F051)
//   GET  ?branch_id=&status=pending|all   → ใบขอปรับของสาขา (+ ชื่อผู้ขอ/ผู้อนุมัติ)
//   POST {action:"request", branch_id, client_uuid, reason_code, note, lines:[{product_id, delta, serials?}]}  สิทธิ์ inventory.adjust
//   POST {action:"approve"|"reject", id, note}    สิทธิ์ inventory.adjust_approve (ผู้อนุมัติ ≠ ผู้ขอ)
//   POST {action:"cancel", id}                    ผู้ขอเท่านั้น
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError, requireSameOrigin } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { object, UUID } from "@/lib/server/sale-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const MSG: [string, string][] = [
  ["adjust_self_approval", "ผู้ขอปรับอนุมัติใบของตัวเองไม่ได้ — ให้หัวหน้า/ผู้มีสิทธิ์คนอื่นอนุมัติ"], ["adjust_negative", "ปรับแล้วสต๊อกจะติดลบ"],
  ["adjust_direction", "จำนวนไม่ตรงกับเหตุผล (ของเสีย/หาย/หมดอายุ/ใช้ภายใน = ลด · พบเพิ่ม = เพิ่ม)"], ["adjust_note_required", "เหตุผล “แก้ยอดผิด/ใช้ภายใน” ต้องอธิบายเพิ่มในหมายเหตุ"],
  ["adjust_serials_required", "สินค้ามี SN — ระบุ SN ให้ครบตามจำนวนที่ลด"], ["adjust_serial_not_in_stock", "SN นี้ไม่ได้อยู่ในสต๊อกสาขานี้"],
  ["adjust_serial_increase_use_receive", "เพิ่มสินค้า SN ให้ทำผ่านการรับสินค้าเข้า"], ["adjust_ow_branch", "สาขานี้ใช้สต๊อกจากคลังกลาง — ปรับยอดที่ OneWarehouse"],
  ["adjust_reject_reason_required", "การไม่อนุมัติต้องระบุเหตุผล"], ["adjust_cancel_owner_only", "ยกเลิกได้เฉพาะผู้ขอ"], ["adjust_wrong_status", "ใบนี้ถูกดำเนินการไปแล้ว — รีเฟรช"],
  ["adjust_zero_delta", "จำนวนต้องไม่เป็น 0"], ["adjust_duplicate_line", "สินค้าซ้ำในใบเดียว"], ["adjust_no_lines", "ยังไม่มีรายการ"], ["stock_frozen_for_count", "สินค้านี้อยู่ในรอบตรวจนับแบบล็อกสต๊อก — รอปิดรอบนับก่อน"],
  ["period_closed", "งวดบัญชีนี้ปิดแล้ว"],
];
const friendly = (m: string) => { const h = MSG.find(([k]) => m.includes(k)); return h ? h[1] + (m.includes(": ") ? ` (${m.split(": ").pop()})` : "") : m; };

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    const ctx = await posContext(req, "inventory.view", branch);
    const sb = supabaseAdmin();
    let q = sb.from("pos_stock_adjustments").select("*").eq("branch_id", branch).order("requested_at", { ascending: false }).limit(100);
    if (req.nextUrl.searchParams.get("status") === "pending") q = q.eq("status", "pending");
    const r = await q;
    if (r.error) throw new PosError("อ่านใบขอปรับไม่สำเร็จ — ตรวจ migration 0078", 503);
    const ids = [...new Set((r.data ?? []).flatMap((a) => [a.requested_by, a.decided_by]).filter(Boolean))] as string[];
    const emps = ids.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", ids)).data ?? []) : [];
    const names = Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname]));
    const link = (await sb.from("pos_warehouse_links").select("warehouse_id").eq("branch_id", branch).limit(1)).data;
    return reply({ adjustments: r.data ?? [], names, me: ctx.actorId, ow_linked: !!link?.length });
  } catch (e) { return reply({ error: e instanceof Error ? friendly(e.message) : "ผิดพลาด" }, e instanceof PosError ? e.status : 400); }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const b = object(await req.json());
    const sb = supabaseAdmin();
    if (b.action === "request") {
      if (!UUID.test(b.branch_id) || !UUID.test(b.client_uuid)) throw new PosError("ข้อมูลไม่ถูกต้อง");
      const ctx = await posContext(req, "inventory.adjust", b.branch_id);
      if (!Array.isArray(b.lines)) throw new PosError("ยังไม่มีรายการ");
      const lines = b.lines.slice(0, 200).map((raw: unknown) => {
        const l = object(raw);
        if (!UUID.test(l.product_id) || typeof l.delta !== "number" || !Number.isFinite(l.delta)) throw new PosError("รายการไม่ถูกต้อง");
        return { product_id: l.product_id, delta: l.delta, serials: Array.isArray(l.serials) ? l.serials.filter((x: unknown) => typeof x === "string").slice(0, 500) : [] };
      });
      const r = await sb.rpc("pos_adjust_request", { p_actor: ctx.actorId, p_payload: { branch_id: b.branch_id, client_uuid: b.client_uuid, reason_code: String(b.reason_code ?? ""), note: typeof b.note === "string" ? b.note.slice(0, 500) : null, lines } });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    if (!UUID.test(b.id)) throw new PosError("ระบุใบไม่ถูกต้อง");
    const a = (await sb.from("pos_stock_adjustments").select("branch_id").eq("id", b.id).maybeSingle()).data;
    if (!a) throw new PosError("ไม่พบใบขอปรับ", 404);
    if (b.action === "approve" || b.action === "reject") {
      const ctx = await posContext(req, "inventory.adjust_approve", a.branch_id);
      const r = await sb.rpc("pos_adjust_decide", { p_actor: ctx.actorId, p_id: b.id, p_approve: b.action === "approve", p_note: typeof b.note === "string" ? b.note.slice(0, 500) : null });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    if (b.action === "cancel") {
      const ctx = await posContext(req, "inventory.adjust", a.branch_id);
      const r = await sb.rpc("pos_adjust_cancel", { p_actor: ctx.actorId, p_id: b.id });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    throw new PosError("ไม่รู้จักคำสั่ง");
  } catch (e) { return reply({ error: e instanceof Error ? friendly(e.message) : "ผิดพลาด" }, e instanceof PosError ? e.status : 400); }
}
