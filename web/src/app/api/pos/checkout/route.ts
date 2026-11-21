import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  posContext,
  PosError,
  requireSameOrigin,
} from "@/lib/server/pos-context";
import {
  object,
  UUID,
  validateQuote,
  validatePayments,
} from "@/lib/server/sale-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const body = object(await req.json());
    if (!UUID.test(body.id) || !UUID.test(body.branch_id))
      throw new PosError("รหัสรายการไม่ถูกต้อง");
    const ctx = await posContext(req, "pos.sell", body.branch_id),
      sb = supabaseAdmin();
    if (body.action === "reserve") {
      const draft = object(body.draft);
      const ids = [
        ...new Set((draft.items ?? []).map((i: any) => i.product_id)),
      ];
      if (!ids.length || ids.length > 200)
        throw new PosError("จำนวนรายการไม่ถูกต้อง");
      const { data, error } = await sb
        .from("products")
        .select(
          "id,sku,name_th,kind,price,cost,is_active,track_serial,is_stocked,is_discountable,max_discount_percent,vat_rate,vat_mode",
        )
        .in("id", ids);
      if (error) throw new PosError("อ่านแคตตาล็อกกลางไม่สำเร็จ", 503);
      const quote = validateQuote(
        { ...draft, client_uuid: body.id, branch_id: body.branch_id },
        data ?? [],
        !ctx.authz.isSuperadmin && ["deny", "approval"].includes(ctx.authz.permission_overrides["pos.discount"]) ? 0 : ctx.authz.max_discount_percent,
      );
      if (quote.salesperson_id && quote.salesperson_id !== ctx.actorId) {
        const [{ data: person }, { data: assignment }] = await Promise.all([
          sb
            .from("employees")
            .select("status,home_branch_id")
            .eq("id", quote.salesperson_id)
            .maybeSingle(),
          sb
            .from("employee_branches")
            .select("branch_id")
            .eq("employee_id", quote.salesperson_id)
            .eq("branch_id", body.branch_id)
            .maybeSingle(),
        ]);
        if (
          !person ||
          person.status !== "active" ||
          (person.home_branch_id !== body.branch_id && !assignment)
        )
          throw new PosError("พนักงานขายไม่ได้ประจำสาขานี้", 403);
      }
      quote.cashier_id = ctx.actorId;
      quote.discount_approved_by = null; // Browser-supplied approver identities are not approval evidence.
      if (quote.terminal_id) {
        const { data: terminal } = await sb
          .from("terminals")
          .select("branch_id")
          .eq("id", quote.terminal_id)
          .maybeSingle();
        if (!terminal || terminal.branch_id !== body.branch_id)
          throw new PosError("เครื่องขายไม่อยู่ในสาขานี้", 403);
      }
      if (quote.shift_id) {
        const { data: shift } = await sb
          .from("shifts")
          .select("branch_id,status")
          .eq("id", quote.shift_id)
          .maybeSingle();
        if (
          !shift ||
          shift.branch_id !== body.branch_id ||
          shift.status !== "open"
        )
          throw new PosError(
            "กะยังไม่ซิงก์หรือปิดแล้ว กรุณาซิงก์กะก่อนรับชำระ",
            409,
          );
      }
      const r = await sb.rpc("pos_reserve_checkout", {
        p_id: body.id,
        p_actor: ctx.actorId,
        p_branch: body.branch_id,
        p_quote: quote,
      });
      if (r.error)
        throw new PosError(`จองสินค้าไม่สำเร็จ: ${r.error.message}`, 409);
      return NextResponse.json(r.data);
    }
    const { data: hold, error } = await sb
      .from("pos_checkout_holds")
      .select("*")
      .eq("id", body.id)
      .eq("actor_id", ctx.actorId)
      .eq("branch_id", body.branch_id)
      .maybeSingle();
    if (error || !hold)
      throw new PosError("ไม่พบการจองกลาง กรุณาตรวจสถานะก่อนรับเงินซ้ำ", 409);
    if (body.action === "renew") {
      const r = await sb.rpc("pos_reserve_checkout", {
        p_id: hold.id,
        p_actor: ctx.actorId,
        p_branch: body.branch_id,
        p_quote: hold.quote,
      });
      if (r.error)
        throw new PosError(
          "ต่ออายุการจองไม่สำเร็จ กรุณาตรวจสถานะก่อนรับชำระ",
          409,
        );
      return NextResponse.json(r.data);
    }
    if (body.action === "status")
      return NextResponse.json({
        status: hold.status,
        expires_at: hold.expires_at,
        result: hold.result,
        payments: hold.recorded_payments,
      });
    if (body.action === "release") {
      // Only explicitly cancelled, unpaid checkouts are released by the UI.
      const r = await sb.rpc("pos_release_checkout", {
        p_id: hold.id,
        p_actor: ctx.actorId,
      });
      if (r.error) throw new PosError("ปลดจองไม่สำเร็จ", 503);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "record") {
      const entry = object(body.payment);
      const payment = validatePayments([entry], entry.amount)[0];
      if (payment.method === "qr_promptpay") {
        const { data: account } = await sb
          .from("pos_payment_accounts")
          .select("verified,promptpay_mobile")
          .eq("branch_id", body.branch_id)
          .maybeSingle();
        if (!account?.verified || !account.promptpay_mobile)
          throw new PosError("ยังไม่มีบัญชีพร้อมเพย์ที่ยืนยันของสาขานี้", 409);
      }
      const r = await sb.rpc("pos_record_checkout_payment", {
        p_id: body.id,
        p_actor: ctx.actorId,
        p_payment: payment,
      });
      if (r.error)
        throw new PosError(
          `บันทึกผลรับชำระไม่สำเร็จ กรุณาตรวจรายการเดิมก่อนรับเงินซ้ำ: ${r.error.message}`,
          409,
        );
      return NextResponse.json({ payments: r.data });
    }
    if (body.action === "commit") {
      const payments = validatePayments(
        body.payments,
        Number(hold.quote.grand_total),
      );
      const r = await sb.rpc("pos_commit_checkout", {
        p_id: body.id,
        p_actor: ctx.actorId,
        p_payments: payments,
      });
      if (r.error)
        throw new PosError(`รายการรับชำระต้องตรวจสอบ: ${r.error.message}`, 409);
      return NextResponse.json(r.data);
    }
    throw new PosError("ไม่รองรับคำสั่งนี้");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ" },
      { status: error instanceof PosError ? error.status : 400 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") || "";
    const ctx = await posContext(req, "pos.sell", branch);
    const { data, error } = await supabaseAdmin()
      .from("pos_checkout_holds")
      .select("id,status,expires_at,created_at,result,quote,recorded_payments")
      .eq("actor_id", ctx.actorId)
      .eq("branch_id", branch)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error)
      throw new PosError(
        "ยังไม่พร้อมอ่านรายการกลาง กรุณาตรวจ migration 0039",
        503,
      );
    return NextResponse.json({
      items: (data ?? []).map((h) => ({
        id: h.id,
        status: h.status,
        expires_at: h.expires_at,
        created_at: h.created_at,
        result: h.result,
        total: h.quote.grand_total,
        payments: h.recorded_payments,
        items: h.quote.items.map((i: any) => ({
          sku: i.sku,
          qty: i.qty,
          serials: i.serials,
        })),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "อ่านรายการไม่สำเร็จ" },
      { status: error instanceof PosError ? error.status : 400 },
    );
  }
}
