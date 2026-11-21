import { NextRequest, NextResponse } from "next/server";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  posContext,
  PosError,
  requireSameOrigin,
} from "@/lib/server/pos-context";
import { object, UUID } from "@/lib/server/sale-validation";
import { OPERATION_POLICY } from "@/lib/server/operations-policy";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const b = object(await req.json()),
      p = object(b.payload),
      sb = supabaseAdmin();
    if (b.op === "create_order") {
      const ctx = await posContext(req, "pos.sell", p.branch_id);
      const { data: hold } = await sb
        .from("pos_checkout_holds")
        .select("actor_id,branch_id,status,result")
        .eq("id", p.client_uuid)
        .maybeSingle();
      if (
        !hold ||
        hold.actor_id !== ctx.actorId ||
        hold.branch_id !== p.branch_id ||
        hold.status !== "committed"
      )
        throw new PosError(
          "บิลนี้ยังไม่มีผลยืนยันจาก Checkout กลาง กรุณาตรวจรายการค้าง",
          409,
        );
      return NextResponse.json({ data: hold.result });
    }
    const policy = OPERATION_POLICY[b.op];
    if (!policy)
      throw new PosError("คำสั่งนี้ต้องผ่านกระบวนการอนุมัติส่วนกลาง", 403);
    let shiftOwner: string | null = null;
    let branch =
      p.branch_id ||
      (b.op === "create_customer" ? p.first_branch_id : undefined);
    if (b.op === "void_order") {
      const { data: o } = await sb
        .from("orders")
        .select("branch_id")
        .eq("client_uuid", p.order_client_uuid)
        .maybeSingle();
      if (!o) throw new PosError("ยังไม่พบบิลกลาง", 409);
      branch = o.branch_id;
    }
    if (b.op === "close_shift") {
      const { data: s } = await sb
        .from("shifts")
        .select("branch_id,opened_by")
        .eq("id", p.shift_id)
        .maybeSingle();
      if (!s) throw new PosError("ยังไม่พบกะกลาง", 409);
      branch = s.branch_id;
      shiftOwner = s.opened_by;
    }
    if (!UUID.test(branch))
      throw new PosError("ไม่พบสาขาของรายการ กรุณาตรวจสอบก่อนส่งใหม่", 409);
    const ctx = await posContext(req, policy.permission, branch);
    if (
      b.op === "close_shift" &&
      shiftOwner !== ctx.actorId &&
      !hasPerm(ctx.profile.email, ctx.authz, "shift.force_close")
    )
      throw new PosError("ไม่มีสิทธิ์ปิดกะของพนักงานอื่น", 403);
    if (b.op === "open_shift" && p.terminal_id) {
      const { data: t } = await sb
        .from("terminals")
        .select("branch_id")
        .eq("id", p.terminal_id)
        .maybeSingle();
      if (!t || t.branch_id !== branch)
        throw new PosError("เครื่องขายไม่ตรงสาขา", 403);
    }
    // A cashier identity supplied by a browser is never accepted as authority.
    if (
      (p.actor_id && p.actor_id !== ctx.actorId) ||
      (p.employee_id && p.employee_id !== ctx.actorId) ||
      (p.opened_by && p.opened_by !== ctx.actorId)
    )
      throw new PosError("ผู้ทำรายการไม่ตรงกับผู้ใช้ปัจจุบัน", 403);
    if (
      [
        "redeem_points",
        "redeem_coupon",
        "create_return",
        "void_order",
      ].includes(b.op)
    )
      throw new PosError(
        "รายการนี้ต้องตรวจคืนเงิน/สิทธิ์ส่วนกลางก่อน กรุณาส่งหัวหน้าตรวจสอบ",
        409,
      );
    const safePayload = { ...p, actor_id: ctx.actorId };
    if (b.op === "open_shift")
      Object.assign(safePayload, {
        opened_by: ctx.actorId,
        status: "open",
        opening_cash: 0,
        expected_cash: 0,
        total_sales: 0,
        total_orders: 0,
      });
    if (b.op === "create_customer")
      Object.assign(safePayload, {
        points: 0,
        store_credit: 0,
        tier: "normal",
        first_branch_id: branch,
      });
    let args: Record<string, unknown> = { p_payload: safePayload };
    if (b.op === "close_shift")
      args = {
        p_shift_id: p.shift_id,
        p_counted_cash: 0,
        p_employee_id: ctx.actorId,
        p_note: p.note ?? null,
      };
    if (b.op === "audit") {
      if (
        typeof b.client_uuid !== "string" ||
        !b.client_uuid ||
        b.client_uuid.length > 150
      )
        throw new PosError("ไม่พบรหัสคำสั่งบันทึกประวัติ");
      args = { p_id: b.client_uuid, p_payload: safePayload };
    }
    const result = policy.rpc
      ? await sb.rpc(
          b.op === "audit" ? "pos_sync_audit_once" : policy.rpc,
          args,
        )
      : await sb
          .from(policy.table!)
          .upsert(
            { ...p, branch_id: branch },
            { onConflict: "client_uuid", ignoreDuplicates: true },
          );
    if (result.error)
      throw new PosError("ส่งข้อมูลไม่สำเร็จ กรุณาตรวจสอบหรือส่งใหม่", 409);
    return NextResponse.json({ data: result.data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ส่งข้อมูลไม่สำเร็จ" },
      { status: error instanceof PosError ? error.status : 400 },
    );
  }
}
