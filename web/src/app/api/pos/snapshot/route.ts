import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasPerm } from "@/lib/sso/guard";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") || "";
    const ctx = await posContext(req, "inventory.view", branch),
      sb = supabaseAdmin();
    let query = sb
      .from("orders")
      .select(
        "*,order_items(*,order_item_serials(serial_no)),order_payments(*)",
      )
      .eq("branch_id", branch)
      .order("created_at", { ascending: false })
      .limit(200);
    if (ctx.authz.data_scope === "own")
      query = query.eq("cashier_id", ctx.actorId);
    const [stock, orders, shifts, holds] = await Promise.all([
      sb.from("stock_levels").select("*").eq("branch_id", branch),
      query,
      sb
        .from("shifts")
        .select("*")
        .eq("branch_id", branch)
        .eq("status", "open"),
      sb
        .from("pos_checkout_holds")
        .select("quote,expires_at,recorded_payments")
        .eq("branch_id", branch)
        .eq("status", "active"),
    ]);
    if (stock.error || orders.error || shifts.error || holds.error)
      throw new PosError("อ่านข้อมูลกลางไม่สำเร็จ เก็บข้อมูลเดิมไว้ก่อน", 503);
    const held = new Map<string, number>();
    for (const hold of holds.data ?? []) {
      if (
        new Date(hold.expires_at).getTime() <= Date.now() &&
        !hold.recorded_payments.length
      )
        continue;
      for (const line of hold.quote.items)
        held.set(
          line.product_id,
          (held.get(line.product_id) ?? 0) + Number(line.qty),
        );
    }
    const cost = hasPerm(ctx.profile.email, ctx.authz, "report.cost");
    const profit = hasPerm(ctx.profile.email, ctx.authz, "report.gross_profit");
    return NextResponse.json({
      branch_id: branch,
      actor_id: ctx.actorId,
      as_of: new Date().toISOString(),
      stock: stock.data.map((s) => ({
        ...s,
        qty_reserved_order:
          Number(s.qty_reserved_order ?? 0) + (held.get(s.product_id) ?? 0),
      })),
      shifts: shifts.data,
      orders: orders.data.map((o) => {
        const { order_items, order_payments, ...base } = o;
        return {
          ...base,
          ...(!cost ? { cost_total: 0, promo_snapshot: null } : {}),
          ...(!profit ? { gross_profit: 0 } : {}),
          synced: true,
          server_order_no: o.order_no,
          fulfillment: "immediate",
          items: order_items.map((i: any) => {
            const { order_item_serials, ...line } = i;
            return {
              ...line,
              ...(!cost ? { unit_cost: 0, cost_total: 0 } : {}),
              ...(!profit ? { gross_profit: 0 } : {}),
              serials: order_item_serials.map((s: any) => s.serial_no),
            };
          }),
          payments: order_payments,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "อ่านข้อมูลไม่สำเร็จ" },
      { status: e instanceof PosError ? e.status : 400 },
    );
  }
}
