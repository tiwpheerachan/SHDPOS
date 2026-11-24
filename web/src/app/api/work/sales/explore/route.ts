// =====================================================================
// GET /api/work/sales/explore?from=YYYY-MM-DD&to=YYYY-MM-DD
//   ข้อมูลขายระดับบิล (ตามสิทธิ์) สำหรับปฏิทินขายแบบเจาะลึก แบรนด์→สาขา→พนักงาน
//   ขอบเขต: สาขาที่เห็นได้ (visibleBranchIds) + data_scope=own เห็นแค่บิลตัวเอง
//   ช่วงวันที่สูงสุด 366 วัน · สูงสุด 20,000 บิล (เกินแล้วแจ้ง truncated)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { workContext } from "@/lib/server/work-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasPerm } from "@/lib/sso/guard";
import { PosError } from "@/lib/server/pos-context";
import { COUNTED_SALE_STATUSES } from "@/lib/sales-basis";

export const dynamic = "force-dynamic";
const MAX_ORDERS = 20000;
const PAGE = 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const c = await workContext(req);
    if (!["pos.sell", "report.employee_perf", "finance.view"].some((p) => hasPerm(c.profile.email, c.authz, p as never)))
      throw new PosError("ไม่มีสิทธิ์ดูข้อมูลขาย", 403);

    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ?? "", to = sp.get("to") ?? "";
    if (!DATE.test(from) || !DATE.test(to)) throw new PosError("ช่วงวันที่ไม่ถูกต้อง");
    const fromTs = `${from}T00:00:00+07:00`;
    const toDate = new Date(`${to}T00:00:00+07:00`);
    toDate.setUTCDate(toDate.getUTCDate() + 1); // รวมวันสุดท้ายทั้งวัน
    const toTs = toDate.toISOString();
    const days = (toDate.getTime() - new Date(fromTs).getTime()) / 86400000;
    if (!(days > 0) || days > 366) throw new PosError("ช่วงวันที่ต้องไม่เกิน 366 วัน");

    const fromIso = new Date(fromTs).toISOString();
    const sb = supabaseAdmin();
    const allowed = c.branches; // null = ทุกสาขา
    if (allowed && !allowed.length) return NextResponse.json({ orders: [], pending: [], branches: [], brands: [], people: [], scope: "limited", truncated: false });
    const own = c.authz.data_scope === "own" && !c.authz.isSuperadmin;

    // ── บิล (แบ่งหน้า) ──
    type Row = { id: string; order_no: string; branch_id: string; cashier_id: string | null; salesperson_id: string | null; grand_total: number; created_at: string; sale_occurred_at: string | null };
    const orders: Row[] = [];
    let truncated = false;
    for (let off = 0; ; off += PAGE) {
      let q = sb.from("orders")
        .select("id,order_no,branch_id,cashier_id,salesperson_id,grand_total,created_at,sale_occurred_at")
        .in("status", [...COUNTED_SALE_STATUSES])
        // เวลาขายจริง = sale_occurred_at ?? created_at (ตรงกับ lib/sales-basis + pos_work_sales)
        .or(`and(sale_occurred_at.gte.${fromIso},sale_occurred_at.lt.${toTs}),and(sale_occurred_at.is.null,created_at.gte.${fromIso},created_at.lt.${toTs})`)
        .order("created_at", { ascending: true })
        .range(off, off + PAGE - 1);
      if (allowed) q = q.in("branch_id", allowed);
      if (own) q = q.or(`cashier_id.eq.${c.actor},salesperson_id.eq.${c.actor}`);
      const { data, error } = await q;
      if (error) throw new PosError("อ่านข้อมูลขายไม่สำเร็จ", 503);
      orders.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
      if (orders.length >= MAX_ORDERS) { truncated = true; break; }
    }

    // ── บิลรอปิด (deferred, ยังไม่ลงบิล) — แสดงแยก ไม่รวมยอดขาย (เหมือนปฏิทินขายเดิม) ──
    let dq = sb.from("pos_deferred_sales")
      .select("id,branch_id,created_by,agreed_total,occurred_at,payments")
      .eq("state", "pending")
      .gte("occurred_at", fromIso).lt("occurred_at", toTs)
      .limit(5000);
    if (allowed) dq = dq.in("branch_id", allowed);
    if (own) dq = dq.eq("created_by", c.actor);
    const { data: pendRows, error: pendErr } = await dq;
    if (pendErr) throw new PosError("อ่านบิลรอปิดไม่สำเร็จ", 503);
    const pending = (pendRows ?? []).map((d) => ({
      id: d.id as string,
      at: d.occurred_at as string,
      branch_id: d.branch_id as string,
      person_id: d.created_by as string,
      agreed: Number(d.agreed_total),
      received: Array.isArray(d.payments) ? (d.payments as { amount?: unknown }[]).reduce((s, x) => s + (Number(x?.amount) || 0), 0) : 0,
    }));

    // ── รายการสินค้า ──
    type Item = { order_id: string; sku: string; name: string; qty: number; line_total: number; salesperson_id: string | null; is_gift: boolean | null };
    const items: Item[] = [];
    const ids = orders.map((o) => o.id);
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await sb.from("order_items")
        .select("order_id,sku,name,qty,line_total,salesperson_id,is_gift")
        .in("order_id", ids.slice(i, i + 300));
      if (error) throw new PosError("อ่านรายการสินค้าไม่สำเร็จ", 503);
      items.push(...((data ?? []) as Item[]));
    }
    const itemsByOrder = new Map<string, Item[]>();
    for (const it of items) (itemsByOrder.get(it.order_id) ?? itemsByOrder.set(it.order_id, []).get(it.order_id)!).push(it);

    // ── อ้างอิง: สาขา / แบรนด์ / พนักงาน (เฉพาะที่เกี่ยว) ──
    const branchIds = [...new Set(orders.map((o) => o.branch_id))];
    let bq = sb.from("branches").select("id,code,name,name_th,brand_id,province").neq("branch_type", "warehouse");
    if (allowed) bq = bq.in("id", allowed);
    const { data: branches } = await bq;
    const brandIds = [...new Set((branches ?? []).map((b) => b.brand_id).filter(Boolean))] as string[];
    const { data: brands } = brandIds.length
      ? await sb.from("brands").select("id,code,name,name_th,color").in("id", brandIds)
      : { data: [] as unknown[] };
    const peopleIds = [...new Set(orders.flatMap((o) => [o.salesperson_id ?? o.cashier_id]).concat(items.map((i) => i.salesperson_id)).filter(Boolean))] as string[];
    const { data: people } = peopleIds.length
      ? await sb.from("employees").select("id,nickname,first_name,last_name,photo_url").in("id", peopleIds)
      : { data: [] as unknown[] };

    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        no: o.order_no,
        at: o.sale_occurred_at ?? o.created_at,
        branch_id: o.branch_id,
        person_id: o.salesperson_id ?? o.cashier_id,
        total: Number(o.grand_total),
        items: (itemsByOrder.get(o.id) ?? []).map((i) => ({ sku: i.sku, name: i.name, qty: Number(i.qty), total: Number(i.line_total), gift: !!i.is_gift })),
      })),
      branches: branches ?? [],
      brands: brands ?? [],
      people: (people ?? []) as unknown[],
      pending,
      used_branch_ids: branchIds,
      scope: own ? "own" : allowed ? "limited" : "all",
      truncated,
      timezone: "Asia/Bangkok",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "อ่านไม่สำเร็จ" }, { status: e instanceof PosError ? e.status : 503 });
  }
}
