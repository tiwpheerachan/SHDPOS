// =====================================================================
// โหลดข้อมูลหน้ายอดขาย (บิล POS + ยอดขายระบบเดิม Lark แบบบีบอัด) — ใช้ร่วม: /api/admin/sales-data และลิงก์แชร์มุมมองสาธารณะ
//   allowed = สาขาที่เห็นได้ (null = ทุกสาขา) · own = data_scope own · showCost = เห็นต้นทุน · publicView = ตัดข้อมูลลูกค้าออก
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { legacyCompact, legacyDaily } from "@/lib/server/legacy-sales";

const MAX = 20000, PAGE = 1000;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function loadSalesData(sb: SupabaseClient, opts: { from: Date; to: Date; allowed: string[] | null; showCost: boolean; own: string | null; legacy?: boolean; publicView?: boolean }) {
  const { from, to, allowed, showCost, own } = opts;
  // ยอดขายระบบเดิม (Lark): ยิงคู่ขนานกับการอ่านบิล POS — ร้านที่ยังไม่จับคู่/อีเวนต์ เห็นเฉพาะผู้ดูทั้งบริษัท · data_scope=own ไม่มี (ระบบเดิมไม่มีผู้ขาย)
  const len = +to - +from, pFrom = new Date(+from - len), pTo = new Date(+from - 1);
  const wantLegacy = opts.legacy !== false && !own;
  const soft = <T,>(p: Promise<T>) => p.catch((e) => { console.error("[sales-data:legacy]", e instanceof Error ? e.message : e); return null; });
  const legacyP = wantLegacy ? soft(legacyCompact(sb, from.toISOString(), to.toISOString(), allowed)) : Promise.resolve(null);
  const legacyPrevP = wantLegacy ? soft(legacyDaily(sb, pFrom.toISOString(), pTo.toISOString(), allowed)) : Promise.resolve(null);

  // บิลในช่วง (เวลาขายจริง = sale_occurred_at ถ้ามี) — ทีละหน้า
  const rows: Row[] = [];
  let truncated = false;
  for (let page = 0; ; page++) {
    let q = sb.from("orders")
      .select("id,client_uuid,order_no,branch_id,terminal_id,shift_id,cashier_id,salesperson_id,customer_id,customer_name,customer_phone,status,channel,subtotal,discount_total,vat_amount,grand_total,paid_total,change_amount,cost_total,gross_profit,created_at,sale_occurred_at,void_reason,order_items(id,product_id,sku,name,kind,qty,unit_price,discount_amount,line_total,unit_cost,cost_total,gross_profit,salesperson_id,returned_qty,is_gift,products(brand_id)),order_payments(method,amount)")
      .gte("created_at", new Date(+from - 31 * 86400_000).toISOString()).lte("created_at", to.toISOString())
      .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (allowed !== null) q = q.in("branch_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
    if (own) q = q.or(`cashier_id.eq.${own},salesperson_id.eq.${own}`);
    const r = await q;
    if (r.error) throw Error(`อ่านบิลไม่สำเร็จ: ${r.error.message}`);
    rows.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGE) break;
    if (rows.length >= MAX) { truncated = true; break; }
  }
  const inRange = rows.filter((o) => { const t = new Date(o.sale_occurred_at ?? o.created_at); return t >= from && t <= to; });
  const orders = inRange.map((o) => ({
    id: o.id, client_uuid: o.client_uuid, order_no: o.order_no, branch_id: o.branch_id, terminal_id: o.terminal_id, shift_id: o.shift_id,
    cashier_id: o.cashier_id, salesperson_id: o.salesperson_id, customer_id: o.customer_id, customer_name: o.customer_name, customer_phone: o.customer_phone,
    status: o.status, channel: o.channel, subtotal: +o.subtotal, discount_total: +o.discount_total, vat_amount: +o.vat_amount, grand_total: +o.grand_total,
    paid_total: +o.paid_total, change_amount: +o.change_amount, cost_total: showCost ? +o.cost_total : 0, gross_profit: showCost ? +o.gross_profit : 0,
    created_at: o.sale_occurred_at ?? o.created_at, void_reason: o.void_reason, is_offline_origin: false, synced: true, source: "pos" as const,
    items: (o.order_items ?? []).map((i: Row) => ({ id: i.id, product_id: i.product_id, sku: i.sku, name: i.name, kind: i.kind, qty: +i.qty, unit_price: +i.unit_price,
      discount_amount: +i.discount_amount, line_total: +i.line_total, unit_cost: showCost ? +i.unit_cost : 0, cost_total: showCost ? +i.cost_total : 0,
      gross_profit: showCost ? +i.gross_profit : 0, serials: [], salesperson_id: i.salesperson_id, returned_qty: +(i.returned_qty ?? 0), is_gift: !!i.is_gift, brand_id: (i.products as { brand_id?: string | null } | null)?.brand_id ?? null })),
    payments: (o.order_payments ?? []).map((p: Row) => ({ method: p.method, amount: +p.amount })),
  }));

  const legacy = await legacyP;

  let bq = sb.from("branches").select("id,code,name,name_th,brand_id,province,branch_type,is_active").eq("is_active", true).order("code");
  if (allowed !== null) bq = bq.in("id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
  const branches = ((await bq).data ?? []).filter((b) => b.branch_type !== "warehouse");
  // แบรนด์ = ของสาขา + ของสินค้าที่ขายจริง (สาขาคลัง/ร้านรวมหลายแบรนด์ไม่มี brand_id ที่สาขา)
  const brandIds = [...new Set([...branches.map((b) => b.brand_id), ...orders.flatMap((o) => o.items.map((i: { brand_id: string | null }) => i.brand_id)), ...(legacy?.skus ?? []).map((k) => k[3])].filter(Boolean))] as string[];
  const brands = brandIds.length ? ((await sb.from("brands").select("id,code,name,name_th,name_zh,logo_url").in("id", brandIds)).data ?? []) : [];
  // ตำแหน่งในผังองค์กร (ข้อมูลจริง ตามสาขาที่เห็นได้) — ใช้เทียบผลงานตามตำแหน่ง รวมคนที่ยังไม่มียอดขาย
  let posQ = sb.from("org_positions").select("branch_id,employee_id,title").limit(5000);
  if (allowed !== null) posQ = posQ.in("branch_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
  if (own) posQ = posQ.eq("employee_id", own);
  const positions = ((await posQ).data ?? []).filter((r) => r.title);
  const people = [...new Set([...orders.flatMap((o) => [o.cashier_id, o.salesperson_id, ...o.items.map((i: Row) => i.salesperson_id)]), ...positions.map((r) => r.employee_id), ...(legacy?.persons ?? []).map((p) => p[2])].filter(Boolean))] as string[];
  const employees = people.length ? ((await sb.from("employees").select("id,employee_code,first_name,last_name,nickname,role,home_branch_id,photo_url,status").in("id", people.slice(0, 1000))).data ?? []) : [];
  // ยอดหักออก (ลงตามวันที่เกิด): คืนเงินจากรับคืน · ยกเลิกบิล · ใบลดหนี้ส่วนลด → ยอดสุทธิ
  const scopeIn = <T extends { in: (c: string, v: string[]) => T }>(q: T) => (allowed !== null ? q.in("branch_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]) : q);
  const [rets, cns] = await Promise.all([
    scopeIn(sb.from("returns").select("branch_id,refund_amount,kind,completed_at").eq("status", "completed").gte("completed_at", from.toISOString()).lte("completed_at", to.toISOString()).limit(5000)),
    scopeIn(sb.from("credit_notes").select("branch_id,amount_total,kind,issued_at").eq("kind", "discount").gte("issued_at", from.toISOString()).lte("issued_at", to.toISOString()).limit(5000)),
  ]);
  const adjustments = [
    ...(rets.data ?? []).map((r) => ({ branch_id: r.branch_id, kind: r.kind === "void" ? "void" : "return", amount: +r.refund_amount, at: r.completed_at })),
    ...(cns.data ?? []).map((c) => ({ branch_id: c.branch_id, kind: "credit_note", amount: +c.amount_total, at: c.issued_at })),
  ];
  // ช่วงก่อนหน้า (ยาวเท่ากัน) — แถวย่อสำหรับเทียบ % (หน้าเว็บกรองสาขา/แบรนด์/ช่องทางเหมือนช่วงปัจจุบัน)
  let pq = sb.from("orders").select("branch_id,grand_total,status,channel,created_at,sale_occurred_at,cashier_id,salesperson_id").gte("created_at", pFrom.toISOString()).lte("created_at", pTo.toISOString()).limit(20000);
  if (allowed !== null) pq = pq.in("branch_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
  if (own) pq = pq.or(`cashier_id.eq.${own},salesperson_id.eq.${own}`);
  const prev = ((await pq).data ?? []).map((o) => ({ branch_id: o.branch_id, grand_total: +o.grand_total, status: o.status, channel: o.channel, created_at: o.sale_occurred_at ?? o.created_at }));
  const legacyPrev = await legacyPrevP;
  if (opts.publicView) {
    // ลิงก์สาธารณะ: ไม่ส่งชื่อ/เบอร์ลูกค้า
    for (const o of orders) { o.customer_name = null; o.customer_phone = null; o.customer_id = null; }
    if (legacy) for (const b of legacy.bills) { if (b.length > 10) { b[10] = null; b[11] = null; b[12] = null; } }
  }
  return { orders, branches, brands, employees, positions, truncated, show_cost: showCost, adjustments, prev, prev_range: { from: pFrom, to: pTo }, legacy, legacy_prev: legacyPrev };
}
