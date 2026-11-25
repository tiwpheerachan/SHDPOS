// =====================================================================
// ส่งบิลขาย POS → OneWarehouse (POST /v1/sales) จากคิว pos_integration_events ('sale.committed')
//   กติกา OW: opKey ทุกครั้ง · ยอดต้องลงตัว Σ(qty×unitPrice) − Σ lineDiscount − billDiscount = Σ payments
//   ของแถม = บรรทัดของตัวเอง isFreebie:true unitPrice:0 (ยังต้องมี SN ถ้าเป็นสินค้า SN)
//   SN ไม่ครบ/ไม่รู้จัก → OW รับเป็น sn_pending (ยังไม่ตัดสต๊อก/ไม่เปิดบิล JST) → ต้อง PATCH SN ที่ถูก
// =====================================================================
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "./ow-gateway";
import { discountBreakdown, discountRemark, type BreakdownOrder } from "@/lib/discount-breakdown";
import { owCall, opKey as makeOpKey, isRetryable, bkkIso, type OwApiError } from "./ow-write";

export interface OwSaleLine { sku: string; qty: number; unitPrice: number; lineDiscount?: number; isFreebie?: boolean; serials?: string[] }
export interface OwSaleBody {
  opKey: string; branchId: string; orderTime: string; salespersonId?: string;
  customer?: { name: string; phone: string } | null; lines: OwSaleLine[]; billDiscount?: number;
  payments: { method: string; amount: number }[]; remark?: string | null;
}
export interface OwSale { id: string; saleNo: string; status: "draft" | "submitted" | "jst_confirmed" | "shipped" | "sn_pending" | "failed" | "void"; statusReason?: string | null; version: number; problems?: { code: string; message: string; params?: unknown }[]; jstProgress?: { jstOrderNo?: string }; editableUntil?: string }

export interface PosSaleInput {
  orderNo: string; saleAt: string; owBranchId: string;
  /** JST UserId ของพนักงานขาย (จากตารางผูก 0063) — ไม่มี = ไม่ส่ง */
  salespersonId?: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  items: { sku: string; qty: number; unitPrice: number; lineDiscount: number; isGift: boolean; serials: string[] }[];
  grandTotal: number;
  payments: { method: string; amount: number }[];
  test?: boolean;
  /** ที่มาของส่วนลด/ของแถม (แคมเปญ/คูปอง/แต้ม/พนักงาน) — ใส่ในหมายเหตุบิลให้ JST เห็น */
  discountNote?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** แปลงบิล POS → body ของ OW ให้ยอดลงตัวตามกติกา (โยน Error ภาษาไทยถ้าแปลงไม่ได้) */
export function buildSaleBody(input: PosSaleInput, key: string): OwSaleBody {
  const lines: OwSaleLine[] = input.items.map((it) => {
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error(`จำนวนของ ${it.sku} ต้องเป็นจำนวนเต็มบวก (OW ไม่รับทศนิยม)`);
    const line: OwSaleLine = { sku: it.sku, qty: it.qty, unitPrice: it.isGift ? 0 : r2(it.unitPrice) };
    if (!it.isGift && it.lineDiscount > 0) line.lineDiscount = r2(it.lineDiscount);
    if (it.isGift) line.isFreebie = true;
    if (it.serials.length) line.serials = it.serials;
    return line;
  });
  const gross = r2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const lineDisc = r2(lines.reduce((s, l) => s + (l.lineDiscount ?? 0), 0));
  const billDiscount = r2(gross - lineDisc - input.grandTotal);
  if (billDiscount < -0.009) throw new Error("ยอดบิลสูงกว่าราคาสินค้ารวม (มีค่าบริการ/ปัดเศษ) — OW ยังไม่รองรับ");
  // ชำระเงิน: รวมต้องเท่ายอดสุทธิ (ตัดเงินทอนออกจากเงินสดถ้ามี)
  let payments = input.payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: r2(p.amount) }));
  let over = r2(payments.reduce((s, p) => s + p.amount, 0) - input.grandTotal);
  if (over > 0) {
    payments = payments.map((p) => { if (over > 0 && p.method === "cash") { const cut = Math.min(over, p.amount); over = r2(over - cut); return { ...p, amount: r2(p.amount - cut) }; } return p; }).filter((p) => p.amount > 0);
  }
  const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paid - input.grandTotal) > 0.009) throw new Error(`ยอดชำระ ${paid} ไม่เท่ายอดสุทธิ ${input.grandTotal}`);
  const name = input.customer?.name?.trim(), phone = input.customer?.phone?.trim();
  return {
    opKey: key,
    branchId: input.owBranchId,
    orderTime: bkkIso(input.saleAt),
    ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
    customer: name || phone ? { name: name || "-", phone: phone || "-" } : null,
    lines,
    ...(billDiscount > 0.009 ? { billDiscount } : {}),
    payments,
    // JST ไม่มีช่องแคมเปญ/คูปอง → บอกที่มาของส่วนลดในหมายเหตุ (≤1000 ตัวอักษรตาม OpenAPI)
    remark: `POS ${input.orderNo}${input.discountNote ? ` · ${input.discountNote}` : ""}${input.test ? " · test" : ""}`.slice(0, 1000),
  };
}

/** ส่งบิล (idempotent ด้วย opKey) */
export async function postSale(body: OwSaleBody) {
  return owCall<OwSale>("POST", "sales", body);
}

/** สรุปผลส่งบิล → สถานะคิว */
/** แปลข้อความผิดพลาดที่พบบ่อยของ JST เป็นภาษาไทย + วิธีแก้ (คงข้อความเดิมไว้ท้าย เพื่อส่งทีม OW ได้) */
//   OW (24 พ.ย.): สาเหตุหลักของ "库存不足" = SKU ยังไม่ถูกเปิดใน POS ของ JST สำหรับร้าน/สาขานั้น (แม้คลังมีของ)
//   OW กำลังเปลี่ยนเป็นรหัส jst_stock_insufficient + ข้อความไทย → รองรับทั้งรหัสใหม่และข้อความจีนเดิม
export function jstReasonTh(raw: string | null | undefined, code?: string | null): string {
  const r = raw ?? "";
  if (code === "jst_stock_insufficient" || /库存不足/.test(r)) {
    const sku = r.match(/商品(.+?)库存不足/)?.[1];
    return `JST ไม่รับบิล: สต๊อกใน JST ไม่พอจัดส่ง หรือ SKU${sku ? ` ${sku}` : ""} ยังไม่เปิดขายใน POS ของสาขานี้ — ให้ทีมคลังกลางเปิด SKU ในสาขา (หรือเติมสต๊อก/ปิดใบโอนที่ค้าง) แล้วกด "ส่งใหม่" · บิลนี้ยังไม่สมบูรณ์ · [${r}]`;
  }
  return r;
}

export function saleOutcome(r: { ok: boolean; status: number; data?: OwSale; error?: OwApiError }, attempts: number) {
  if (r.ok && r.data) {
    const s = r.data;
    if (isOwSaleDone(s.status) || s.status === "submitted") return { state: "delivered" as const, reason: s.status === "submitted" ? "OW รับบิลแล้ว (รอเปิดบิล JST)" : null };
    if (s.status === "sn_pending") return { state: "blocked" as const, reason: `รอแก้ SN: ${(s.problems ?? []).map((p) => p.message || p.code).join(" · ") || "SN ไม่ครบ/ไม่รู้จัก"}` };
    return { state: "blocked" as const, reason: `OW สถานะ ${s.status}${s.statusReason || s.problems?.length ? `: ${jstReasonTh(s.statusReason ?? s.problems?.[0]?.message, s.problems?.[0]?.code)}` : ""}` };
  }
  const code = r.error?.code ?? "unknown";
  if (isRetryable(r as never) || (r.status === 409 && code !== "sale_op_key_conflict")) {
    return attempts >= 12 ? { state: "dead" as const, reason: `ลองซ้ำครบแล้ว: ${r.error?.message}` } : { state: "retry" as const, reason: `${code}: ${r.error?.message ?? ""}` };
  }
  return { state: "blocked" as const, reason: `${code}: ${r.error?.message ?? ""}` };
}

type EventRow = { id: string; source: string; event_key: string; aggregate_id: string; payload: Record<string, unknown>; attempts: number; response: Record<string, unknown> | null; lease_token?: string | null };
type StoredRequest = { body: OwSaleBody; hash: string; order_id: string; item_ids: string[] };
const hashOf = (b: unknown) => createHash("sha256").update(JSON.stringify(b)).digest("hex");

/** อ่านบิลจริงจาก DB (client_uuid = hold id) แล้วสร้าง input (+ รหัสบรรทัดบิลตามลำดับ ใช้ตอนแก้ SN) */
// ช่องทางที่ส่งเข้า JST ในนามสาขา (ลูกค้า JST = สาขา) — OW 25 พ.ย.:
//   • ขายส่ง (b2b) ต้องเลือกลูกค้า JST จริง (jstCustomerId, ERIS-256) → ยังไม่ส่งจนกว่า API ขึ้น
//   • ออนไลน์ (Shopee/Lazada/TikTok/เว็บ) ร้านผูก JST โดยตรง (OW ยืนยันแล้ว) → ห้ามส่งถาวร ส่งซ้ำ = ออเดอร์ซ้ำ + ตัดสต๊อก 2 รอบ
export const OW_SALE_CHANNELS = new Set(["offline", "event"]);
export const HOLD_PREFIX = "พักไว้ไม่ส่ง:";
export function holdReasonForChannel(channel: string | null | undefined): string | null {
  const c = channel ?? "offline";
  if (OW_SALE_CHANNELS.has(c)) return null;
  if (c === "b2b") return `${HOLD_PREFIX} บิลขายส่ง — ต้องเลือกลูกค้า JST จริง รอ OneWarehouse เปิด API ลูกค้า (jstCustomerId, ERIS-256)`;
  // OW ยืนยัน 25 พ.ย.: ร้านออนไลน์ผูก JST โดยตรง (JST ดึงออเดอร์/ตัดสต๊อก/จัดส่งเอง) → ห้ามส่งผ่าน /v1/sales ถาวร
  if (c.startsWith("online_")) return `${HOLD_PREFIX} บิลช่องทางออนไลน์ (${c.replace("online_", "")}) — ออเดอร์เข้า JST ทางแพลตฟอร์มโดยตรงอยู่แล้ว ห้ามส่งซ้ำผ่าน POS (ออเดอร์ซ้ำ + ตัดสต๊อก 2 รอบ) · ถ้าร้านนี้ยังไม่ขึ้นใน JST ให้แจ้งทีมคลังกลาง/ทีมออนไลน์ผูกร้านกับ JST`;
  return `${HOLD_PREFIX} ช่องทาง ${c} ยังไม่ได้ตกลงวิธีส่งเข้า JST`;
}

// บิลยกเลิก/คืนก่อนถึง JST (สต๊อก JST ไม่เคยถูกตัด · POS คืนสต๊อกแล้ว) → ห้ามส่งตามไปทีหลัง
export function holdReasonForOrderStatus(status: string | null | undefined): string | null {
  if (status === "voided") return `${HOLD_PREFIX} บิลถูกยกเลิกก่อนส่งเข้า JST — ไม่ต้องส่ง`;
  if (status === "refunded") return `${HOLD_PREFIX} บิลถูกคืนทั้งหมดก่อนส่งเข้า JST — ไม่ต้องส่ง`;
  if (status === "partially_refunded") return `${HOLD_PREFIX} บิลถูกคืนบางส่วนก่อนส่งเข้า JST — ส่งทั้งบิลจะตัดสต๊อกของที่คืนแล้ว ให้หัวหน้าตรวจและแจ้งทีมคลังกลาง`;
  return null;
}

async function loadSaleInput(holdId: string, owBranchId: string): Promise<{ input: PosSaleInput; orderId: string; itemIds: string[]; channel: string | null; status: string | null }> {
  const sb = supabaseAdmin();
  const { data: o, error } = await sb.from("orders")
    .select("id,order_no,branch_id,cashier_id,salesperson_id,channel,status,grand_total,discount_total,promo_snapshot,customer_name,customer_phone,created_at,sale_occurred_at,order_items(id,sku,qty,unit_price,discount_amount,is_gift,gift_source,gift_campaign_id,sort_order,order_item_serials(serial_no)),order_payments(method,amount)")
    .eq("client_uuid", holdId).maybeSingle();
  if (error) throw new Error("อ่านบิลไม่สำเร็จ");
  if (!o) throw new Error("ยังไม่พบบิลของรายการนี้");
  type Item = { id: string; sku: string; qty: number; unit_price: number; discount_amount: number; is_gift: boolean | null; gift_source: string | null; gift_campaign_id: string | null; sort_order: number | null; order_item_serials: { serial_no: string }[] | null };
  const items = ((o.order_items ?? []) as Item[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  // ชื่อแคมเปญของคูปอง/ของแถม (ถ้ามี) สำหรับหมายเหตุบิล
  const snap = (o.promo_snapshot ?? null) as BreakdownOrder["promo_snapshot"];
  const campIds = [...new Set([snap?.coupon?.campaign_id, ...items.map((i) => i.gift_campaign_id)].filter(Boolean) as string[])];
  const camps = campIds.length ? (await sb.from("campaigns").select("id,name,code").in("id", campIds)).data ?? [] : [];
  const cname = (id: string | null | undefined) => { const c = camps.find((x) => x.id === id); return c ? String(c.name || c.code) : null; };
  // พนักงานขาย → JST UserId (ผูกไว้รายสาขา) · ไม่ระบุพนักงานขายใช้แคชเชียร์
  const who = (o.salesperson_id ?? o.cashier_id) as string | null;
  const sp = who ? (await sb.from("pos_ow_salesperson_map").select("jst_user_id").eq("source", owConfig().source).eq("branch_id", o.branch_id).eq("employee_id", who).maybeSingle()).data : null;
  const note = discountRemark(discountBreakdown({ grand_total: Number(o.grand_total), discount_total: Number(o.discount_total ?? 0), promo_snapshot: snap, items }, cname));
  return {
    orderId: o.id, itemIds: items.map((i) => i.id), channel: (o.channel as string | null) ?? null, status: (o.status as string | null) ?? null,
    input: {
      orderNo: o.order_no, saleAt: o.sale_occurred_at ?? o.created_at, owBranchId, salespersonId: (sp?.jst_user_id as string | undefined) ?? null,
      customer: { name: o.customer_name, phone: o.customer_phone },
      items: items.map((i) => ({ sku: i.sku, qty: Number(i.qty), unitPrice: Number(i.unit_price), lineDiscount: Number(i.discount_amount), isGift: !!i.is_gift, serials: (i.order_item_serials ?? []).map((s) => s.serial_no) })),
      grandTotal: Number(o.grand_total),
      payments: ((o.order_payments ?? []) as { method: string; amount: number }[]).map((p) => ({ method: p.method, amount: Number(p.amount) })),
      test: (process.env.ONEWAREHOUSE_ENV || "uat") !== "production",
      discountNote: note || undefined,
    },
  };
}

/** บันทึกผล — เฉพาะเมื่อยังถือ lease เดิม (กัน worker อื่นที่ยึดงานต่อไปแล้วถูกเขียนทับ) */
async function finish(ev: EventRow, patch: Record<string, unknown>): Promise<boolean> {
  let q = supabaseAdmin().from("pos_integration_events").update({ ...patch, lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", ev.id);
  if (ev.lease_token) q = q.eq("lease_token", ev.lease_token);
  const { data, error } = await q.select("id");
  if (error) throw new Error("บันทึกผลคิวไม่สำเร็จ: " + error.message);
  return (data ?? []).length > 0;
}

/** ส่งบิล 1 รายการจากคิว — ครั้งแรกสร้าง request แล้วเก็บไว้ (hash) ก่อนส่ง · ลองซ้ำใช้ request+opKey เดิมเสมอ */
export async function deliverSaleEvent(ev: EventRow) {
  const owBranchId = String(ev.payload.ow_branch_id ?? "");
  const block = async (reason: string) => { await finish(ev, { state: "blocked", reason }); return { state: "blocked" as const, reason }; };
  if (!owBranchId) return block("สาขานี้ยังไม่ผูกสาขาขาย OneWarehouse");
  let stored = ev.payload.request as StoredRequest | undefined;
  if (stored) {
    const cur = await supabaseAdmin().from("orders").select("status").eq("client_uuid", ev.aggregate_id).maybeSingle();
    const hold = holdReasonForOrderStatus((cur.data?.status as string | undefined) ?? null);
    if (hold) return block(hold);
  }
  if (!stored) {
    try {
      const { input, orderId, itemIds, channel, status } = await loadSaleInput(ev.aggregate_id, owBranchId);
      const hold = holdReasonForChannel(channel) ?? holdReasonForOrderStatus(status);
      if (hold) return block(hold); // ไม่สร้าง request · ไม่ส่ง OW (ปลดได้เมื่อเปิดช่องทางนี้แล้ว กด "ส่งใหม่")
      const body = buildSaleBody(input, makeOpKey("sale", ev.event_key));
      stored = { body, hash: hashOf(body), order_id: orderId, item_ids: itemIds };
    } catch (e) {
      return block(e instanceof Error ? e.message : "สร้างข้อมูลบิลไม่สำเร็จ");
    }
    // เก็บ request ก่อนส่งครั้งแรก (ถือ lease อยู่)
    let q = supabaseAdmin().from("pos_integration_events").update({ payload: { ...ev.payload, request: stored }, updated_at: new Date().toISOString() }).eq("id", ev.id);
    if (ev.lease_token) q = q.eq("lease_token", ev.lease_token);
    const { data, error } = await q.select("id");
    if (error || !(data ?? []).length) return { state: "retry" as const, reason: "เสีย lease ก่อนส่ง — worker อื่นทำต่อ" };
  } else if (hashOf(stored.body) !== stored.hash) {
    return block("ข้อมูลคำขอที่เก็บไว้ถูกแก้ไข — ไม่ส่งด้วย opKey เดิม");
  }
  const r = await postSale(stored.body);
  const out = saleOutcome(r, ev.attempts);
  const backoff = Math.min(30 * 60, 30 * 2 ** Math.max(0, ev.attempts - 1));
  await finish(ev, {
    state: out.state, reason: out.reason,
    response: { request: stored.body, sale: r.data ?? (ev.response as { sale?: OwSale } | null)?.sale ?? null, error: r.error ?? null, http: r.status, at: new Date().toISOString() },
    ...(out.state === "retry" ? { available_at: new Date(Date.now() + backoff * 1000).toISOString() } : {}),
  });
  return out;
}

/** ประมวลผลคิวขาย (worker / ปุ่มในหน้าแอดมิน) — จองทีละชุดเล็ก */
export async function processSaleOutbox(source: string, limit = 5) {
  const sb = supabaseAdmin();
  const token = crypto.randomUUID();
  const { data, error } = await sb.rpc("pos_claim_integration_events", { p_source: source, p_token: token, p_limit: limit, p_types: ["sale.committed"] });
  if (error) throw new Error("จองคิวส่งบิลไม่สำเร็จ: " + error.message);
  const results: { id: string; state: string; reason: string | null }[] = [];
  for (const ev of (data ?? []) as EventRow[]) {
    try {
      const out = await deliverSaleEvent(ev);
      results.push({ id: ev.id, state: out.state, reason: out.reason ?? null });
    } catch (e) {
      await finish(ev, { state: "retry", reason: e instanceof Error ? e.message : "ส่งไม่สำเร็จ", available_at: new Date(Date.now() + 120_000).toISOString() }).catch(() => false);
      results.push({ id: ev.id, state: "retry", reason: "error" });
    }
  }
  return results;
}

/** ติดตามผลบิลที่ OW รับแล้วแต่ยังไม่จบ (submitted / sn_pending) — อ่านสถานะ ไม่สร้างบิลใหม่ */
export async function followUpSales(source: string, limit = 20) {
  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data, error } = await sb.from("pos_integration_events").select("id,response,state")
    .eq("source", source).eq("event_type", "sale.committed").in("state", ["delivered", "blocked"]).lt("updated_at", cutoff)
    .in("response->sale->>status", ["submitted", "sn_pending"]).order("updated_at").limit(limit);
  if (error) throw new Error("อ่านคิวติดตามผลไม่สำเร็จ: " + error.message);
  let changed = 0;
  for (const ev of data ?? []) {
    const resp = (ev.response ?? {}) as { sale?: OwSale };
    if (!resp.sale?.id) continue;
    const r = await owCall<OwSale>("GET", `sales/${encodeURIComponent(resp.sale.id)}`);
    if (!r.ok || !r.data) continue;
    const out = saleOutcome(r, 0);
    const { error: upErr } = await sb.from("pos_integration_events").update({
      state: out.state, reason: out.reason, response: { ...resp, sale: r.data, followed_at: new Date().toISOString() }, updated_at: new Date().toISOString(),
    }).eq("id", ev.id).eq("state", ev.state);
    if (!upErr && r.data.status !== resp.sale.status) changed++;
  }
  return { checked: (data ?? []).length, changed };
}

/** แก้ SN ของบิล (PATCH /v1/sales/{id}) — ระบุตาม "ลำดับบรรทัด" (รองรับ SKU เดียวกันหลายบรรทัด เช่นขาย+แถม)
 *  ตรวจ: สถานะ/เวอร์ชันล่าสุดจาก OW · ภายในช่วงแก้ไข · จำนวน SN = จำนวนชิ้น · ไม่ซ้ำทั้งบิล
 *  สำเร็จแล้วปรับ order_item_serials/serials ของ POS + บันทึกประวัติ (เดิม → ใหม่ · ผู้แก้ · เหตุผล) */
export async function patchSaleSerials(eventId: string, actor: string, reason: string, serialsByLine: Record<number, string[]>) {
  const sb = supabaseAdmin();
  if (!reason || reason.trim().length < 3) throw new Error("ต้องระบุเหตุผลการแก้ SN");
  // SN ใน POS เก็บตัวพิมพ์ใหญ่เสมอ (checkout/cart/validateQuote) — ไม่งั้นเช็ก "ขายไปแล้วในบิลอื่น" พลาดและเกิด SN ซ้ำ
  serialsByLine = Object.fromEntries(Object.entries(serialsByLine).map(([k, v]) => [k, v.map((x) => x.trim().toUpperCase()).filter(Boolean)]));
  const { data: ev, error } = await sb.from("pos_integration_events").select("id,event_key,attempts,response,payload,state").eq("id", eventId).single();
  if (error || !ev) throw new Error("ไม่พบรายการ");
  const resp = (ev.response ?? {}) as { request?: OwSaleBody; sale?: OwSale };
  const stored = (ev.payload as { request?: StoredRequest }).request;
  if (!resp.sale?.id || !resp.request) throw new Error("รายการนี้ยังไม่มีบิลใน OW");
  const latest = await owCall<OwSale & { lines?: OwSaleLine[] }>("GET", `sales/${encodeURIComponent(resp.sale.id)}`);
  if (!latest.ok || !latest.data) throw new Error(`อ่านบิลล่าสุดจาก OW ไม่ได้: ${latest.error?.message ?? latest.status}`);
  const sale = latest.data;
  // ตาม OpenAPI: PATCH ได้เฉพาะ submitted | sn_pending | failed และก่อน JST รับบิล — jst_confirmed ผ่านได้เฉพาะ "ส่งซ้ำของเดิม" (ตรวจด้านล่าง)
  if (!["sn_pending", "submitted", "failed", "jst_confirmed", "shipped"].includes(sale.status)) throw new Error(`บิลสถานะ ${sale.status} แก้ SN ไม่ได้`);
  if (sale.editableUntil && Date.parse(sale.editableUntil) < Date.now()) throw new Error("เกินช่วงแก้ไขบิล (7 วัน) — ต้องดำเนินการผ่าน OW/บัญชี");
  const baseLines: OwSaleLine[] = (sale.lines && sale.lines.length ? sale.lines : resp.request.lines).map((l) => ({ ...l }));
  const owNow = baseLines.map((l) => [...(l.serials ?? [])].sort().join("|"));
  const seen = new Set<string>();
  for (const [idxStr, list] of Object.entries(serialsByLine)) {
    const idx = Number(idxStr), line = baseLines[idx];
    if (!line) throw new Error(`ไม่พบบรรทัดที่ ${idx + 1}`);
    const sns = list.map((x) => x.trim()).filter(Boolean);
    if (sns.length !== line.qty) throw new Error(`บรรทัด ${idx + 1} (${line.sku}): ต้องมี SN ${line.qty} ตัว (ได้ ${sns.length})`);
    line.serials = sns;
  }
  for (const l of baseLines) for (const s of l.serials ?? []) { if (seen.has(s)) throw new Error(`SN ซ้ำในบิล: ${s}`); seen.add(s); }
  // ตรวจฝั่ง POS ก่อนส่ง OW: SN ใหม่ต้องไม่ถูกขายในบิลอื่น (ไม่งั้น OW รับแต่ POS ปฏิเสธ → สองระบบไม่ตรงกัน)
  const newAll = Object.values(serialsByLine).flat().map((x) => x.trim()).filter(Boolean);
  if (newAll.length && stored?.order_id) {
    const clash = await sb.from("serials").select("serial_no,sold_order_id").in("serial_no", newAll).eq("status", "sold").neq("sold_order_id", stored.order_id);
    if (clash.error) throw new Error("ตรวจ SN ใน POS ไม่สำเร็จ: " + clash.error.message);
    if (clash.data?.length) throw new Error(`SN ถูกขายในบิลอื่นแล้วใน POS: ${clash.data.map((x) => x.serial_no).join(", ")}`);
  }
  // OW มี SN ตามที่ขออยู่แล้ว (เช่น ส่งซ้ำหลังสำเร็จ / เน็ตหลุดหลัง OW บันทึกแล้ว) → ไม่ PATCH ซ้ำ แต่ทำฝั่ง POS ให้ครบ
  const alreadyApplied = Object.entries(serialsByLine).every(([i, list]) => owNow[Number(i)] === list.map((x) => x.trim()).filter(Boolean).sort().join("|"));
  if (isOwSaleDone(sale.status) && !alreadyApplied) throw new Error("JST รับบิลนี้แล้ว — แก้ SN ผ่านคลังกลางไม่ได้ (OpenAPI: แก้ได้ก่อน JST รับบิลเท่านั้น) ต้องให้ฝ่ายคลัง/บัญชีแก้ใน JST");
  let r: { ok: boolean; status: number; data?: OwSale; error?: OwApiError };
  if (alreadyApplied) r = { ok: true, status: 200, data: sale };
  else {
    // opKey ผูกกับเวอร์ชันบิล — แก้รอบใหม่ (เวอร์ชันใหม่) ไม่ชน opKey รอบก่อน
    const body = { opKey: makeOpKey("sale-patch", ev.event_key, String(sale.version), JSON.stringify(serialsByLine)), expectedVersion: sale.version, lines: baseLines };
    r = await owCall<OwSale>("PATCH", `sales/${encodeURIComponent(sale.id)}`, body);
  }
  if (!r.ok || !r.data) {
    await sb.from("pos_integration_events").update({ reason: `แก้ SN ไม่สำเร็จ: ${r.error?.code}: ${r.error?.message}`, updated_at: new Date().toISOString() }).eq("id", eventId);
    return { ok: false, status: sale.status, error: r.error ?? { code: `http_${r.status}`, message: "OW ไม่รับการแก้ SN" } };
  }
  const out = saleOutcome(r, ev.attempts);
  const up = await sb.from("pos_integration_events").update({
    state: out.state, reason: out.reason,
    response: { ...resp, request: { ...resp.request, lines: baseLines }, sale: r.data, error: null, http: r.status, at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("id", eventId);
  if (up.error) throw new Error("OW รับการแก้แล้ว แต่บันทึกคิวไม่สำเร็จ: " + up.error.message);
  // ปรับข้อมูล POS ให้ตรงในธุรกรรมเดียว (pos_apply_serial_correction) — ประวัติ/ถอด SN เดิม/ผูก SN ใหม่
  if (stored?.order_id) {
    for (const [idxStr, list] of Object.entries(serialsByLine)) {
      const itemId = stored.item_ids[Number(idxStr)];
      if (!itemId) throw new Error(`OW รับการแก้แล้ว แต่ไม่พบบรรทัด ${Number(idxStr) + 1} ในบิล POS`);
      const cur = await sb.from("order_item_serials").select("serial_id,serial_no").eq("order_item_id", itemId);
      if (cur.error) throw new Error("อ่าน SN เดิมของบิลไม่สำเร็จ: " + cur.error.message);
      const newSns = list.map((x) => x.trim()).filter(Boolean);
      // SN เดิม: คืนเป็นพร้อมขายเฉพาะเมื่อ OW ยืนยันว่าอยู่ในคลังพร้อมขายจริง — ไม่งั้นเป็น SN ผี (ขายต่อจะติดรอแก้ SN อีก)
      const old: { serial_id: string; status: string; note: string }[] = [];
      for (const o of (cur.data ?? []) as { serial_id: string; serial_no: string }[]) {
        if (newSns.includes(o.serial_no)) continue;
        const chk = await owCall<{ status?: string; stockType?: string }>("GET", `serials/${encodeURIComponent(o.serial_no)}`);
        const sellable = chk.ok && chk.data?.status === "in_stock" && chk.data?.stockType !== "damaged";
        old.push(sellable
          ? { serial_id: o.serial_id, status: "in_stock", note: `คืนจากการแก้ SN บิล ${resp.request.remark ?? ""}` }
          : { serial_id: o.serial_id, status: "defective", note: `แก้ SN ออกจากบิล — คลังกลางไม่ยืนยัน SN นี้ (${chk.status === 404 ? "ไม่รู้จัก SN" : chk.data?.status ?? `HTTP ${chk.status}`}) ตรวจสอบก่อนขาย` });
      }
      const ap = await sb.rpc("pos_apply_serial_correction", { p_order: stored.order_id, p_item: itemId, p_old: old, p_new: newSns, p_reason: reason.trim(), p_actor: actor, p_ow_sale: sale.id });
      if (ap.error) throw new Error("OW รับการแก้แล้ว แต่ปรับ SN ใน POS ไม่สำเร็จ (ต้องแก้ด้วยมือ): " + ap.error.message);
    }
  }
  return { ok: true, status: r.data.status, error: null, already_applied: alreadyApplied };
}

/** ส่งคิวบิลขายทันทีหลัง commit (ไม่รอ — แคชเชียร์ไม่ต้องรอ OW) · ล้มเหลวไม่เป็นไร worker ลองซ้ำให้
 *  ปลอดภัยเมื่อเรียกพร้อมกันหลายเครื่อง: การจองคิวใช้ lease (pos_claim_integration_events) */
let kickRunning = false;
export function kickSaleOutbox(): void {
  if (kickRunning) return;
  let source: string;
  try { source = owConfig().source; } catch { return; } // ยังไม่ตั้งค่า OW → ไม่ทำอะไร
  kickRunning = true;
  void processSaleOutbox(source, 3)
    .catch((e) => console.error("[ow-sales] kick failed:", e instanceof Error ? e.message : e))
    .finally(() => { kickRunning = false; });
}

/** บิลที่ JST ปฏิเสธ (OW status failed) → ส่งเข้า JST ใหม่ด้วย PATCH รายการเดิม (POST ซ้ำจะได้ผลเดิมกลับเพราะ opKey เดิม)
 *  ทดสอบจริง 2026-11-24: PATCH ทำให้ OW ลอง JST ใหม่ (jstSync.at เปลี่ยน) */
export async function resubmitFailedSale(eventId: string) {
  const sb = supabaseAdmin();
  const { data: ev, error } = await sb.from("pos_integration_events").select("id,event_key,attempts,response").eq("id", eventId).single();
  if (error || !ev) throw new Error("ไม่พบรายการ");
  const resp = (ev.response ?? {}) as { request?: OwSaleBody; sale?: OwSale };
  if (!resp.sale?.id) throw new Error("รายการนี้ยังไม่มีบิลใน OW");
  const ord = await sb.from("orders").select("status").eq("client_uuid", (await sb.from("pos_integration_events").select("aggregate_id").eq("id", eventId).single()).data?.aggregate_id ?? "").maybeSingle();
  const hold = holdReasonForOrderStatus((ord.data?.status as string | undefined) ?? null);
  if (hold) throw new Error(hold.replace(HOLD_PREFIX, "ส่งใหม่ไม่ได้:"));
  const latest = await owCall<OwSale & { lines?: OwSaleLine[] }>("GET", `sales/${encodeURIComponent(resp.sale.id)}`);
  if (!latest.ok || !latest.data) throw new Error(`อ่านบิลล่าสุดจาก OW ไม่ได้: ${latest.error?.message ?? latest.status}`);
  const sale = latest.data;
  if (sale.status !== "failed") return { ok: true, status: sale.status, resubmitted: false };
  const lines = sale.lines && sale.lines.length ? sale.lines : resp.request?.lines ?? [];
  const body = { opKey: makeOpKey("sale-resubmit", ev.event_key, String(sale.version)), expectedVersion: sale.version, lines };
  const r = await owCall<OwSale>("PATCH", `sales/${encodeURIComponent(sale.id)}`, body);
  const out = r.ok && r.data ? saleOutcome(r, ev.attempts) : { state: "blocked" as const, reason: `ส่งใหม่ไม่สำเร็จ: ${r.error?.code}: ${r.error?.message}` };
  const up = await sb.from("pos_integration_events").update({
    state: out.state, reason: out.reason, attempts: ev.attempts + 1,
    response: { ...resp, sale: r.data ?? sale, error: r.error ?? null, http: r.status, at: new Date().toISOString() }, updated_at: new Date().toISOString(),
  }).eq("id", eventId);
  if (up.error) throw new Error("บันทึกผลส่งใหม่ไม่สำเร็จ: " + up.error.message);
  return { ok: r.ok && r.data?.status !== "failed", status: r.data?.status ?? sale.status, resubmitted: true, reason: out.reason };
}
