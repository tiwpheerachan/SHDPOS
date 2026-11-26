import { enrichEdcPayments } from "@/lib/server/edc";
import { legacyUuid } from "@/lib/server/legacy-ids";
import { kickSaleOutbox } from "@/lib/server/ow-sales";
import { owWarehouseOf } from "@/lib/server/ow-branch";
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
const quoteErrors:Record<string,string>={
 line_campaign_not_found:"ไม่พบโปรรายสินค้านี้ — อาจถูกปิดหรือเปลี่ยนรหัส",line_campaign_not_applicable:"โปรรายสินค้าไม่อยู่ในช่วงเวลา สาขา หรือช่องทางนี้",
 line_campaign_product_mismatch:"โปรนี้ใช้กับสินค้าในบรรทัดนี้ไม่ได้",line_campaign_minimum_not_met:"จำนวน/ยอดของสินค้ายังไม่ถึงเงื่อนไขโปร",
 campaign_used_twice:"โปรเดียวกันใช้เป็นทั้งโปรรายสินค้าและคูปองทั้งบิลไม่ได้",
 campaign_usage_limit:"คูปองหรือแคมเปญถูกใช้ครบแล้ว กรุณาตรวจสิทธิ์อีกครั้ง",
 campaign_customer_limit:"ลูกค้าใช้สิทธิ์แคมเปญนี้ครบแล้ว",campaign_customer_required:"กรุณาเลือกลูกค้าสมาชิกก่อนใช้สิทธิ์",
 coupon_not_found:"ไม่พบคูปองที่ใช้กับรายการนี้",coupon_not_applicable:"คูปองไม่อยู่ในช่วงเวลา สาขา หรือช่องทางนี้",
 coupon_minimum_not_met:"สินค้าร่วมรายการหรือยอดซื้อยังไม่ครบเงื่อนไข",coupon_customer_segment:"ลูกค้าไม่อยู่ในกลุ่มที่ได้รับสิทธิ์",
 campaign_gifts_changed_reload:"สิทธิ์ของแถมเปลี่ยน กรุณาตรวจสิทธิ์ของแถมอีกครั้ง",campaign_gift_mismatch:"รายการหรือจำนวนของแถมไม่ตรงกับสิทธิ์",
 insufficient_available_points:"แต้มคงเหลือถูกใช้หรือจองโดยบิลอื่น กรุณาตรวจยอดใหม่",insufficient_brand_points:"แต้มสำหรับแบรนด์นี้ไม่เพียงพอ",
 promotion_total_changed_preview_required:"ยอดส่วนลดเปลี่ยน กรุณาตรวจคูปองและยอดชำระใหม่",invalid_expected_payable:"ยอดรับชำระไม่ถูกต้อง",
 gift_product_not_ready:"สินค้าของแถมยังไม่พร้อมขาย กรุณาให้ผู้ดูแลตรวจสอบ",gift_serial_count_mismatch:"กรุณาสแกน SN ของแถมให้ครบจำนวน",
 promotion_requires_positive_payable:"ส่วนลดและแต้มต้องเหลือยอดชำระมากกว่าศูนย์",
};

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const body = object(await req.json());
    if (!UUID.test(body.id) || !UUID.test(body.branch_id))
      throw new PosError("รหัสรายการไม่ถูกต้อง");
    const ctx = await posContext(req, "pos.sell", body.branch_id),
      sb = supabaseAdmin();
    if (body.action === "reserve" || body.action === "preview") {
      const draft = object(body.draft);
      if(!Array.isArray(draft.items))throw new PosError("รายการสินค้าไม่ถูกต้อง");
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
      const gifts=draft.items.filter((i:any)=>i.is_gift);
      if(gifts.some((i:any)=>i.gift_source!=="campaign"))throw new PosError("ของแถมที่เพิ่มเองต้องผ่านการอนุมัติส่วนกลางก่อน",409);
      const manual=draft.manual_discount_total ?? ((!draft.coupon_code&&!draft.redeem_points)?draft.discount_total:NaN);
      if(typeof manual!=="number"||!Number.isFinite(manual)||manual<0)throw new PosError("กรุณาโหลดหน้าใหม่เพื่อตรวจส่วนลดกับเซิร์ฟเวอร์");
      if(body.action!=="preview"&&(typeof draft.grand_total!=="number"||!Number.isFinite(draft.grand_total)||draft.grand_total<=0))throw new PosError("ยอดรับชำระไม่ถูกต้อง");
      const points=draft.redeem_points??0;if(!Number.isSafeInteger(points)||points<0)throw new PosError("จำนวนแต้มไม่ถูกต้อง");
      if(draft.coupon_code!=null&&(typeof draft.coupon_code!=="string"||draft.coupon_code.length>100))throw new PosError("รหัสคูปองไม่ถูกต้อง");
      // กะจากเครื่องรุ่นเก่า (nanoid) → UUID คงที่ตัวเดียวกับที่ sync_open_shift บันทึก
      if (draft.shift_id) draft.shift_id = legacyUuid("shift", draft.shift_id);
      const quote = validateQuote(
        { ...draft, items:draft.items.filter((i:any)=>!i.is_gift),discount_total:manual,grand_total:Math.round((draft.subtotal-manual)*100)/100,coupon_code:null,redeem_points:0,client_uuid: body.id, branch_id: body.branch_id },
        data ?? [],
        !ctx.authz.isSuperadmin && ["deny", "approval"].includes(ctx.authz.permission_overrides["pos.discount"]) ? 0 : ctx.authz.max_discount_percent,
        {preview:body.action==="preview", allowVatModes: !(await owWarehouseOf(body.branch_id))},
      );
      // โปรรายสินค้า: เครื่องส่งแค่รหัสต่อบรรทัด — ยอดลดคิดที่ DB (pos_apply_line_campaigns) ไม่นับเพดานส่วนลดพนักงาน
      draft.items.filter((i:any)=>!i.is_gift).forEach((i:any,k:number)=>{
        const code=i.line_campaign_code;
        if(code==null||code==="")return;
        if(typeof code!=="string"||code.length>100)throw new PosError("รหัสโปรรายสินค้าไม่ถูกต้อง");
        quote.items[k].line_campaign_code=code.trim();
      });
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
      const r = await sb.rpc("pos_prepare_promoted_checkout", {
        p_id: body.id,p_actor: ctx.actorId,p_branch: body.branch_id,p_base:quote,
        p_coupon:draft.coupon_code??null,p_points:points,p_gifts:gifts,
        p_expected:body.action==="preview"?null:draft.grand_total,p_preview:body.action==="preview",
      });
      if (r.error)
        throw new PosError(quoteErrors[r.error.message]||`จองสินค้าไม่สำเร็จ: ${r.error.message}`, 409);
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
      const promo=hold.quote?.promotion_request;
      const r = promo ? await sb.rpc("pos_prepare_promoted_checkout", {
        p_id:hold.id,p_actor:ctx.actorId,p_branch:body.branch_id,p_base:promo.base,
        p_coupon:promo.coupon,p_points:promo.points,p_gifts:promo.gifts,
        p_expected:hold.quote.grand_total,p_preview:false,
      }) : await sb.rpc("pos_reserve_checkout", {
        p_id: hold.id,p_actor: ctx.actorId,p_branch: body.branch_id,p_quote: hold.quote,
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
      const payments = await enrichEdcPayments(sb, body.branch_id, validatePayments(
        body.payments,
        Number(hold.quote.grand_total),
      ));
      const r = await sb.rpc("pos_commit_checkout", {
        p_id: body.id,
        p_actor: ctx.actorId,
        p_payments: payments,
      });
      if (r.error)
        throw new PosError(`รายการรับชำระต้องตรวจสอบ: ${r.error.message}`, 409);
      // บิลเข้าคิวแล้ว (trigger ใน transaction เดียวกับ commit) → ส่งไป OneWarehouse/JST ทันทีแบบไม่รอ
      kickSaleOutbox();
      // ลูกค้าจ่ายเต็มแล้วมารับของทีหลัง (0077) — สร้างรายการรอรับต่อจากบิล · ล้มเหลว = บิลยังสำเร็จ แจ้งให้ตั้งจากหน้า "รอลูกค้ารับของ"
      if (body.pickup && typeof body.pickup === "object") {
        const pu = object(body.pickup);
        const due = typeof pu.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pu.due) ? pu.due : null;
        const p = await sb.rpc("pos_pickup_create", { p_actor: ctx.actorId, p_order_client: body.id, p_due: due, p_contact: {}, p_note: typeof pu.note === "string" ? pu.note.slice(0, 500) : null });
        return NextResponse.json({ ...(r.data as object), pickup: p.error ? { ok: false, error: p.error.message } : { ok: true, ...(p.data as object) } });
      }
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
