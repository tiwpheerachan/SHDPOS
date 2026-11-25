// /api/pos/order-trace?client_uuid= | ?order_no= — "ที่มาของบิล" แบบละเอียด (สิทธิ์ sales.trace · จำกัดสาขาที่เห็นได้)
//   รวมทุกแหล่งของบิลเดียวเป็น 7 ขั้น + ไทม์ไลน์: ที่มา → ราคาและโปร → ชำระเงิน → สต๊อก/SN → คลังกลาง/JST → แต้มสะสม → หลังการขาย
//   ต้นทุน/กำไรแสดงเฉพาะผู้มีสิทธิ์ report.cost / report.gross_profit · อ่านอย่างเดียว ไม่แก้ข้อมูล
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
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Status = "ok" | "warn" | "error" | "info" | "none";
type Detail = { label: string; value: string; tone?: Status; mono?: boolean };
type Stage = { key: string; title: string; status: Status; summary: string; at?: string | null; details: Detail[]; items?: { title: string; sub?: string; value?: string; tone?: Status; lines?: string[] }[] };
type Ev = { at: string; stage: string; label: string; tone?: Status; by?: string | null };

const METHOD: Record<string, string> = { cash: "เงินสด", credit_card: "บัตรเครดิต", debit_card: "บัตรเดบิต", qr_promptpay: "พร้อมเพย์", bank_transfer: "โอนเงิน", edc: "EDC", gift: "บัตรของขวัญ" };
const CHANNEL: Record<string, string> = { offline: "หน้าร้าน", event: "อีเวนต์", b2b: "ขายส่ง", online_shopee: "Shopee", online_lazada: "Lazada", online_tiktok: "TikTok", online_website: "เว็บไซต์", other: "อื่นๆ" };
const LEDGER: Record<string, string> = { earn: "ได้แต้ม", redeem: "ใช้แต้ม", reverse: "คืนแต้ม (ยกเลิก/คืน)", return: "หักแต้มจากการคืน", expire: "หมดอายุ", adjust: "ปรับแต้ม" };
const baht = (n: unknown) => `${Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
const OW_DONE = ["jst_confirmed", "shipped"];

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "sales.trace")) return reply({ error: "ไม่มีสิทธิ์ดูที่มาของบิล" }, 403);
  const allowed = await visibleBranchIds(authz);
  const showCost = hasPerm(profile.email, authz, "report.cost") || hasPerm(profile.email, authz, "report.gross_profit");
  const sp = req.nextUrl.searchParams;
  const cu = sp.get("client_uuid"), no = sp.get("order_no");
  const sb = supabaseAdmin();
  let q = sb.from("orders").select("*");
  if (cu && UUID.test(cu)) q = q.eq("client_uuid", cu); else if (no && no.length < 60) q = q.eq("order_no", no); else return reply({ error: "ระบุบิลไม่ถูกต้อง" }, 400);
  const { data: o, error } = await q.maybeSingle();
  if (error) return reply({ error: "อ่านบิลไม่สำเร็จ" }, 503);
  if (!o) return reply({ error: "ยังไม่พบบิลนี้ในระบบกลาง (อาจยังไม่ซิงก์)" }, 404);
  if (allowed !== null && !allowed.includes(o.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);

  const [items, pays, mv, evs, ledger, rets, audits, branch, shift, holds, camps, deferred] = await Promise.all([
    sb.from("order_items").select("id,sku,name,kind,qty,unit_price,discount_amount,line_total,unit_cost,cost_total,gross_profit,is_gift,gift_source,gift_campaign_id,gift_of_sku,returned_qty,sort_order,product_id,order_item_serials(serial_no)").eq("order_id", o.id).order("sort_order"),
    sb.from("order_payments").select("method,amount,acquirer_bank,card_brand,card_last4,approval_code,reference_no,installment_months,received_at").eq("order_id", o.id),
    sb.from("stock_movements").select("type,qty_delta,qty_after,ref_table,ref_no,product_id,note,occurred_at,employee_id").or(`ref_id.eq.${o.id},ref_no.eq.${o.order_no}`).order("occurred_at"),
    sb.from("pos_integration_events").select("id,source,state,reason,attempts,created_at,updated_at,response,payload").eq("event_type", "sale.committed").eq("aggregate_id", o.client_uuid),
    o.customer_id ? sb.from("loyalty_ledger").select("kind,points_delta,balance_points,note,detail,expires_at,created_at").eq("order_id", o.id).order("created_at") : Promise.resolve({ data: [] as Row[] }),
    sb.from("returns").select("id,return_no,kind,type,status,refund_amount,refund_method,reason_code,reason_note,jst_state,ow_linked,points_reversed,requested_by,approved_by,created_at,approved_at,decided_note,return_items(sku,qty,condition,serials)").eq("order_id", o.id).order("created_at"),
    sb.from("audit_logs").select("action,actor_id,amount,created_at,after_data").or(`ref_id.eq.${o.id},ref_no.eq.${o.order_no}`).order("created_at").limit(100),
    sb.from("branches").select("code,name,name_th,brand_id").eq("id", o.branch_id).maybeSingle(),
    o.shift_id ? sb.from("shifts").select("shift_no,status,opened_at").eq("id", o.shift_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("pos_checkout_holds").select("status,created_at,expires_at,actor_id").eq("id", o.client_uuid).maybeSingle(),
    sb.from("pos_campaign_uses").select("campaign_id,discount,reversed_at,created_at").eq("checkout_id", o.client_uuid),
    o.deferred_sale_id ? sb.from("pos_deferred_sales").select("state,created_by,occurred_at,posted_by,posted_at,created_at,reason").eq("id", o.deferred_sale_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const its = (items.data ?? []) as Row[], payments = (pays.data ?? []) as Row[], moves = (mv.data ?? []) as Row[], led = (ledger.data ?? []) as Row[], returns = (rets.data ?? []) as Row[];
  const ev = ((evs.data ?? []) as Row[])[0] ?? null;

  // ชื่อคน/แคมเปญ/สินค้า ที่อ้างถึง
  const empIds = [...new Set([o.cashier_id, o.salesperson_id, o.discount_approved_by, o.voided_by, deferred.data?.created_by, deferred.data?.posted_by, holds.data?.actor_id,
    ...returns.flatMap((r) => [r.requested_by, r.approved_by]), ...((audits.data ?? []) as Row[]).map((a) => a.actor_id), ...moves.map((m) => m.employee_id)].filter(Boolean))] as string[];
  const campIds = [...new Set([o.promo_snapshot?.coupon?.campaign_id, ...its.map((i) => i.gift_campaign_id), ...((camps.data ?? []) as Row[]).map((c) => c.campaign_id),
    ...((o.promo_snapshot?.line_campaigns ?? []) as Row[]).map((l) => l.campaign_id)].filter(Boolean))] as string[];
  const serialList = its.flatMap((i) => ((i.order_item_serials ?? []) as Row[]).map((s) => String(s.serial_no)));
  const brandRow = branch.data?.brand_id ? (await sb.from("brands").select("name").eq("id", branch.data.brand_id).maybeSingle()).data : null;
  const [emps, cs, cust, sers, works] = await Promise.all([
    empIds.length ? sb.from("employees").select("id,first_name,last_name,nickname").in("id", empIds) : Promise.resolve({ data: [] as Row[] }),
    campIds.length ? sb.from("campaigns").select("id,name,code").in("id", campIds) : Promise.resolve({ data: [] as Row[] }),
    o.customer_id ? sb.from("customers").select("name,phone,tier,member_code").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    serialList.length ? sb.from("serials").select("serial_no,status,branch_id,note,updated_at").in("serial_no", serialList) : Promise.resolve({ data: [] as Row[] }),
    sb.from("pos_work_items").select("title,status,source_kind,created_at,completed_at").in("source_id", [o.id, ...(ev ? [ev.id] : []), ...returns.map((r) => r.id)]),
  ]);
  const who = (id?: string | null) => { if (!id) return null; const e = ((emps.data ?? []) as Row[]).find((x) => x.id === id); return e ? [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname : "ไม่ทราบชื่อ"; };
  const camp = (id?: string | null) => { const c = ((cs.data ?? []) as Row[]).find((x) => x.id === id); return c ? String(c.name || c.code) : "แคมเปญ"; };
  const skuOf = (pid: string) => its.find((i) => i.product_id === pid)?.sku ?? "สินค้า";
  const timeline: Ev[] = [];
  const stages: Stage[] = [];

  // 1) ที่มา
  const origin: Detail[] = [
    { label: "ช่องทาง", value: CHANNEL[o.channel] ?? o.channel ?? "หน้าร้าน" },
    { label: "สาขา", value: `${branch.data?.code ?? ""} · ${branch.data?.name_th || branch.data?.name || ""}` },
    ...(brandRow?.name ? [{ label: "แบรนด์", value: String(brandRow.name) }] : []),
    { label: "แคชเชียร์", value: who(o.cashier_id) ?? "—" },
    ...(o.salesperson_id && o.salesperson_id !== o.cashier_id ? [{ label: "พนักงานขาย", value: who(o.salesperson_id) ?? "—" }] : []),
    { label: "ลูกค้า", value: cust.data ? `${cust.data.name}${cust.data.phone ? ` · ${cust.data.phone}` : ""}${cust.data.tier && cust.data.tier !== "normal" ? ` · ${cust.data.tier}` : ""}` : o.customer_name ? `${o.customer_name} (ไม่ผูกสมาชิก)` : "ไม่ระบุลูกค้า" },
    ...(shift.data ? [{ label: "กะ", value: `${shift.data.shift_no ?? ""} (${shift.data.status === "open" ? "เปิดอยู่" : "ปิดแล้ว"})` }] : []),
    { label: "เวลาขายจริง", value: fmt(o.sale_occurred_at ?? o.created_at) },
    ...(o.is_offline_origin ? [{ label: "ขายตอนออฟไลน์", value: `เครื่องบันทึก ${fmt(o.device_created_at)} · ซิงก์ ${fmt(o.synced_at)}`, tone: "info" as Status }] : []),
    ...(deferred.data ? [{ label: "มาจาก", value: `รายการขายก่อน-บันทึกทีหลัง (บันทึกโดย ${who(deferred.data.created_by)} · ลงบิล ${fmt(deferred.data.posted_at)})`, tone: "info" as Status }] : []),
    ...(o.quotation_id ? [{ label: "มาจาก", value: "ใบเสนอราคา", tone: "info" as Status }] : []),
    ...(holds.data ? [{ label: "การจองสต๊อกก่อนรับเงิน", value: `${holds.data.status === "committed" ? "ตัดจริงแล้ว" : holds.data.status} · จอง ${fmt(holds.data.created_at)}` }] : []),
    ...(o.note ? [{ label: "หมายเหตุ", value: String(o.note) }] : []),
  ];
  stages.push({ key: "origin", title: "ที่มา", status: "ok", at: o.sale_occurred_at ?? o.created_at, summary: `${CHANNEL[o.channel] ?? "หน้าร้าน"} · ${branch.data?.code ?? ""}${cust.data ? ` · ${cust.data.name}` : ""}`, details: origin });
  if (deferred.data) timeline.push({ at: deferred.data.created_at, stage: "origin", label: "บันทึกรายการขายก่อน", by: who(deferred.data.created_by) });
  if (holds.data) timeline.push({ at: holds.data.created_at, stage: "origin", label: "จองสต๊อก/ล็อกยอดก่อนรับเงิน", by: who(holds.data.actor_id) });
  timeline.push({ at: o.created_at, stage: "origin", label: `บันทึกบิล ${o.order_no}`, tone: "ok", by: who(o.cashier_id) });

  // 2) ราคาและโปร
  const snap = (o.promo_snapshot ?? {}) as Row;
  const lineCamps = (snap.line_campaigns ?? []) as Row[];
  const manual = its.reduce((n, i) => n + Number(i.discount_amount || 0), 0) - lineCamps.reduce((n, l) => n + Number(l.discount || 0), 0);
  const gross = its.reduce((n, i) => n + Number(i.unit_price) * Number(i.qty), 0);
  const priceItems = its.map((i) => {
    const lc = lineCamps.find((l) => l.sku === i.sku && Number(l.line) === its.indexOf(i));
    return { title: `${i.sku} × ${Number(i.qty)}${i.is_gift ? " (ของแถม)" : ""}`, sub: i.name, value: baht(i.line_total), tone: (i.is_gift ? "info" : "none") as Status,
      lines: [`ราคา ${baht(i.unit_price)} × ${Number(i.qty)} = ${baht(Number(i.unit_price) * Number(i.qty))}`,
        ...(Number(i.discount_amount) > 0 ? [`ส่วนลดบรรทัด ${baht(i.discount_amount)}${lc ? ` (โปรสินค้า ${lc.code} ${baht(lc.discount)})` : ""}`] : []),
        ...(i.is_gift ? [`ของแถมจาก ${i.gift_campaign_id ? camp(i.gift_campaign_id) : i.gift_source ?? "แคมเปญ"}${i.gift_of_sku ? ` (ซื้อ ${i.gift_of_sku})` : ""}`] : []),
        ...(showCost ? [`ต้นทุน ${baht(i.cost_total)} · กำไร ${baht(i.gross_profit)}`] : [])] };
  });
  const promo: Detail[] = [
    { label: "ราคาสินค้ารวม", value: baht(gross) },
    ...(manual > 0.009 ? [{ label: "ส่วนลดที่พนักงานกด", value: `−${baht(manual)}${o.discount_approved_by ? ` · อนุมัติโดย ${who(o.discount_approved_by)}` : ""}` }] : []),
    ...lineCamps.map((l) => ({ label: `โปรสินค้า ${l.code}`, value: `−${baht(l.discount)} (${l.sku})` })),
    ...(snap.coupon ? [{ label: `คูปอง ${snap.coupon.code}`, value: `−${baht(snap.coupon.discount)} · ${camp(snap.coupon.campaign_id)}` }] : []),
    ...(Number(snap.redeem_points) > 0 ? [{ label: "ใช้แต้มแลกส่วนลด", value: `${Number(snap.redeem_points).toLocaleString()} แต้ม` }] : []),
    ...((snap.gifts ?? []) as Row[]).length ? [{ label: "ของแถม", value: `${(snap.gifts as Row[]).length} รายการ` }] : [],
    { label: "ส่วนลดรวม", value: `−${baht(o.discount_total)}` },
    { label: "ยอดสุทธิ", value: baht(o.grand_total), tone: "ok" },
    { label: "VAT (รวมในราคา)", value: baht(o.vat_amount) },
    ...(showCost ? [{ label: "ต้นทุน / กำไรขั้นต้น", value: `${baht(o.cost_total)} / ${baht(o.gross_profit)}` }] : []),
  ];
  const promoCount = lineCamps.length + (snap.coupon ? 1 : 0) + (Number(snap.redeem_points) > 0 ? 1 : 0) + its.filter((i) => i.is_gift).length;
  stages.push({ key: "price", title: "ราคาและโปร", status: "ok", summary: `${baht(o.grand_total)}${Number(o.discount_total) > 0 ? ` · ลด ${baht(o.discount_total)}` : ""}${promoCount ? ` · ${promoCount} โปร` : ""}`, details: promo, items: priceItems });

  // 3) ชำระเงิน
  const paid = payments.reduce((n, p) => n + Number(p.amount), 0);
  stages.push({ key: "payment", title: "ชำระเงิน", status: Math.abs(paid - Number(o.grand_total)) < 0.01 || paid > Number(o.grand_total) ? "ok" : "warn",
    summary: payments.map((p) => METHOD[p.method] ?? p.method).join(" + ") || "—",
    details: [{ label: "รับชำระรวม", value: baht(paid) }, ...(Number(o.change_amount) > 0 ? [{ label: "เงินทอน", value: baht(o.change_amount) }] : [])],
    items: payments.map((p) => ({ title: METHOD[p.method] ?? p.method, value: baht(p.amount),
      lines: [p.acquirer_bank, p.card_brand && `${p.card_brand}${p.card_last4 ? ` ••${p.card_last4}` : ""}`, p.approval_code && `อนุมัติ ${p.approval_code}`, p.reference_no && `อ้างอิง ${p.reference_no}`, p.installment_months && `ผ่อน ${p.installment_months} เดือน`].filter(Boolean) as string[] })) });

  // 4) สต๊อก / SN
  const sold = moves.filter((m) => m.ref_table === "orders");
  const later = moves.filter((m) => m.ref_table !== "orders");
  const snRows = ((sers.data ?? []) as Row[]);
  stages.push({ key: "stock", title: "สต๊อก / SN", status: sold.length || its.every((i) => i.kind !== "goods") ? "ok" : ev?.state === "delivered" || ev ? "info" : "warn",
    summary: sold.length ? `ตัดสต๊อก POS ${sold.length} รายการ${serialList.length ? ` · SN ${serialList.length}` : ""}` : "ไม่ได้ตัดสต๊อก POS",
    details: [
      ...sold.map((m) => ({ label: `ขาย ${skuOf(m.product_id)}`, value: `${Number(m.qty_delta)} → คงเหลือ ${Number(m.qty_after)} · ${fmt(m.occurred_at)}` })),
      ...later.map((m) => ({ label: `${m.type === "return" ? "รับคืน" : m.type} ${skuOf(m.product_id)}`, value: `${Number(m.qty_delta) > 0 ? "+" : ""}${Number(m.qty_delta)} → ${Number(m.qty_after)} · ${m.ref_no ?? ""}`, tone: "info" as Status })),
    ],
    items: serialList.map((sn) => { const s = snRows.find((x) => x.serial_no === sn); return { title: sn, value: s ? snLabel(s.status) : "ไม่พบในทะเบียน", tone: (s?.status === "sold" ? "ok" : s ? "info" : "warn") as Status, lines: s?.note ? [String(s.note)] : [] }; }) });
  for (const m of moves) timeline.push({ at: m.occurred_at, stage: "stock", label: `${m.ref_table === "orders" ? "ตัดสต๊อก" : "สต๊อกเปลี่ยน"} ${skuOf(m.product_id)} ${Number(m.qty_delta) > 0 ? "+" : ""}${Number(m.qty_delta)}`, by: who(m.employee_id) });

  // 5) คลังกลาง / JST
  if (!ev) {
    stages.push({ key: "jst", title: "คลังกลาง / JST", status: "none", summary: "ไม่ส่ง (สาขาไม่ได้ผูก OneWarehouse)", details: [{ label: "สถานะ", value: "บิลนี้ไม่ได้เข้าคิวส่งคลังกลาง" }] });
  } else {
    const sale = (ev.response?.sale ?? null) as Row | null;
    const req = (ev.response?.request ?? ev.payload?.request?.body ?? null) as Row | null;
    const ow = sale?.status as string | undefined;
    const held = String(ev.reason ?? "").startsWith("พักไว้ไม่ส่ง:");
    const st: Status = ow && OW_DONE.includes(ow) ? "ok" : held ? "info" : ow === "failed" || ev.state === "dead" ? "error" : "warn";
    stages.push({ key: "jst", title: "คลังกลาง / JST", status: st,
      summary: ow && OW_DONE.includes(ow) ? `JST รับแล้ว${sale?.jstProgress?.jstOrderNo ? ` · ${sale.jstProgress.jstOrderNo}` : ""}` : held ? "พักไว้ไม่ส่ง (ตามกติกา)" : ow === "failed" ? "JST ไม่รับ · ยังไม่สมบูรณ์" : `รอส่ง/รอยืนยัน (${ev.state})`,
      at: ev.updated_at,
      details: [
        { label: "คิวส่ง", value: `${ev.state} · ลอง ${ev.attempts} ครั้ง`, tone: st },
        ...(sale?.saleNo ? [{ label: "เลขบิล OneWarehouse", value: String(sale.saleNo), mono: true }] : []),
        ...(sale?.jstProgress?.jstOrderNo ? [{ label: "เลขออเดอร์ JST", value: String(sale.jstProgress.jstOrderNo), mono: true, tone: "ok" as Status }] : []),
        ...(ow ? [{ label: "สถานะใน OW", value: ow }] : []),
        ...(ev.reason ? [{ label: "เหตุผล", value: String(ev.reason), tone: st }] : []),
        ...(req?.branchId ? [{ label: "ส่งในนามสาขา (ลูกค้า JST)", value: String(req.branchId), mono: true }] : []),
        ...(req?.salespersonId ? [{ label: "พนักงานขาย JST", value: String(req.salespersonId), mono: true }] : []),
        ...(req?.billDiscount ? [{ label: "ส่วนลดท้ายบิลที่ส่ง", value: baht(req.billDiscount) }] : []),
        ...(req?.remark ? [{ label: "หมายเหตุที่ JST เห็น", value: String(req.remark) }] : []),
      ],
      items: ((req?.lines ?? []) as Row[]).map((l) => ({ title: `${l.sku} × ${l.qty}`, value: baht(Number(l.unitPrice) * Number(l.qty) - Number(l.lineDiscount ?? 0)),
        lines: [`ราคา ${baht(l.unitPrice)}${l.lineDiscount ? ` · ลด ${baht(l.lineDiscount)}` : ""}${l.isFreebie ? " · ของแถม" : ""}`, ...(l.serials?.length ? [`SN ${l.serials.join(", ")}`] : [])] })) });
    timeline.push({ at: ev.created_at, stage: "jst", label: "เข้าคิวส่งคลังกลาง" });
    if (ev.updated_at !== ev.created_at) timeline.push({ at: ev.updated_at, stage: "jst", label: ow && OW_DONE.includes(ow) ? "JST ยืนยันรับบิล" : held ? "พักไว้ไม่ส่ง" : ow === "failed" ? "JST ไม่รับบิล" : `สถานะคิว: ${ev.state}`, tone: st });
  }

  // 6) แต้มสะสม
  if (!o.customer_id) {
    stages.push({ key: "loyalty", title: "แต้มสะสม", status: "none", summary: "ไม่มีลูกค้า — ไม่คิดแต้ม", details: [] });
  } else {
    const earn = led.find((l) => l.kind === "earn");
    const net = led.reduce((n, l) => n + Number(l.points_delta), 0);
    stages.push({ key: "loyalty", title: "แต้มสะสม", status: led.length ? "ok" : "info", summary: led.length ? `${earn ? `ได้ +${earn.points_delta}` : "ไม่ได้แต้ม"}${led.some((l) => l.kind === "redeem") ? ` · ใช้ ${-led.filter((l) => l.kind === "redeem").reduce((n, l) => n + Number(l.points_delta), 0)}` : ""} · สุทธิ ${net > 0 ? "+" : ""}${net}` : "ยังไม่มีรายการแต้ม",
      details: [
        ...(earn?.detail?.tier?.name ? [{ label: "ระดับสมาชิกตอนซื้อ", value: String(earn.detail.tier.name) }] : []),
        ...(earn?.expires_at ? [{ label: "แต้มหมดอายุ", value: fmt(earn.expires_at) }] : []),
      ],
      items: led.map((l) => ({ title: LEDGER[l.kind] ?? l.kind, value: `${Number(l.points_delta) > 0 ? "+" : ""}${Number(l.points_delta).toLocaleString()} แต้ม`, tone: (Number(l.points_delta) >= 0 ? "ok" : "warn") as Status,
        lines: [fmt(l.created_at), ...(((l.detail?.parts ?? []) as Row[]).map((p) => `${p.label}${p.qty ? ` × ${p.qty}` : ""}: ${Number(p.points) > 0 ? "+" : ""}${p.points}`)), ...(l.note && !l.detail ? [String(l.note)] : [])] })) });
    for (const l of led) timeline.push({ at: l.created_at, stage: "loyalty", label: `${LEDGER[l.kind] ?? l.kind} ${Number(l.points_delta) > 0 ? "+" : ""}${l.points_delta} แต้ม` });
  }

  // 7) หลังการขาย
  stages.push(afterSale(o, returns, (works.data ?? []) as Row[], who));
  for (const r of returns) {
    timeline.push({ at: r.created_at, stage: "after", label: `${r.kind === "void" ? "ขอยกเลิกบิล" : "ขอคืนสินค้า"} ${r.return_no}`, by: who(r.requested_by) });
    if (r.approved_at) timeline.push({ at: r.approved_at, stage: "after", label: `${r.status === "rejected" ? "ปฏิเสธ" : "อนุมัติ"} ${r.return_no} · คืนเงิน ${baht(r.refund_amount)}`, tone: r.status === "rejected" ? "warn" : "ok", by: who(r.approved_by) });
  }
  if (o.voided_at && !returns.some((r) => r.kind === "void")) timeline.push({ at: o.voided_at, stage: "after", label: `ยกเลิกบิล${o.void_reason ? ` (${o.void_reason})` : ""}`, tone: "warn", by: who(o.voided_by) });
  for (const a of (audits.data ?? []) as Row[]) if (!["sale"].includes(a.action)) timeline.push({ at: a.created_at, stage: "audit", label: `บันทึกระบบ: ${a.action}`, by: who(a.actor_id) });

  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return reply({
    order: { order_no: o.order_no, client_uuid: o.client_uuid, status: o.status, grand_total: Number(o.grand_total), created_at: o.created_at, branch: branch.data?.code ?? "" },
    stages, timeline, show_cost: showCost,
  });
}

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function snLabel(s: string): string {
  return ({ sold: "ขายแล้ว (อยู่กับลูกค้า)", in_stock: "กลับเข้าสต๊อก", returned: "รับคืนแล้ว · รอรับคืนใน JST", defective: "ชำรุด (พักตรวจ)", transferred: "โอนออก", reserved: "จองไว้", scrapped: "ตัดจำหน่าย" } as Record<string, string>)[s] ?? s;
}
function afterSale(o: Row, returns: Row[], works: Row[], who: (id?: string | null) => string | null): Stage {
  const done = returns.filter((r) => r.status === "completed");
  const pending = returns.filter((r) => r.status === "pending_approval");
  const jstPending = returns.filter((r) => r.jst_state === "pending");
  const openWork = works.filter((w) => !["done", "cancelled"].includes(w.status));
  const status: Status = o.status === "voided" ? "warn" : jstPending.length || pending.length || openWork.length ? "warn" : returns.length ? "info" : "ok";
  const summary = o.status === "voided" ? "ยกเลิกบิลแล้ว" : o.status === "refunded" ? "คืนสินค้าครบแล้ว" : o.status === "partially_refunded" ? "คืนสินค้าบางส่วน" : pending.length ? "มีคำขอคืนรออนุมัติ" : "ไม่มีการคืน/ยกเลิก";
  return {
    key: "after", title: "หลังการขาย", status, summary,
    details: [
      { label: "สถานะบิล", value: ({ completed: "สำเร็จ", voided: "ยกเลิกแล้ว", refunded: "คืนครบ", partially_refunded: "คืนบางส่วน" } as Record<string, string>)[o.status] ?? o.status },
      ...(done.length ? [{ label: "คืนเงินรวม", value: baht(done.reduce((n, r) => n + Number(r.refund_amount), 0)) }] : []),
      ...(jstPending.length ? [{ label: "รอทีมคลังกลางทำรับคืนใน JST", value: jstPending.map((r) => r.return_no).join(", "), tone: "warn" as Status }] : []),
      ...openWork.map((w) => ({ label: "งานค้าง", value: String(w.title), tone: "warn" as Status })),
    ],
    items: returns.map((r) => ({
      title: `${r.kind === "void" ? "ยกเลิกบิล" : r.type === "exchange" ? "เปลี่ยนสินค้า" : r.type === "claim" ? "เคลม" : "คืนเงิน"} ${r.return_no}`,
      value: baht(r.refund_amount),
      tone: (r.status === "completed" ? (r.jst_state === "pending" ? "warn" : "ok") : r.status === "rejected" ? "none" : "warn") as Status,
      lines: [
        `${({ pending_approval: "รออนุมัติ", completed: "เสร็จแล้ว", rejected: "ปฏิเสธ" } as Record<string, string>)[r.status] ?? r.status} · ขอโดย ${who(r.requested_by) ?? "—"}${r.approved_by ? ` · ตัดสินโดย ${who(r.approved_by)}` : ""}`,
        ...((r.return_items ?? []) as Row[]).map((i) => `${i.sku} × ${Number(i.qty)} (${i.condition === "defective" ? "ชำรุด" : "ขายได้"})${i.serials?.length ? ` SN ${i.serials.join(", ")}` : ""}`),
        ...(r.refund_method ? [`คืนเงินทาง ${METHOD[r.refund_method] ?? r.refund_method}`] : []),
        ...(r.points_reversed ? [`หักแต้ม ${r.points_reversed}`] : []),
        ...(r.jst_state === "pending" ? ["บิลอยู่ใน JST แล้ว — รอทีมคลังกลางทำรับคืน"] : r.jst_state === "done" ? ["ทำรับคืนใน JST แล้ว"] : []),
        ...(r.reason_note ? [`เหตุผล: ${r.reason_note}`] : []),
      ],
    })),
  };
}
