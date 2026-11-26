// =====================================================================
// ตามรอย Serial (SN) รายชิ้น — รวมไทม์ไลน์ของ SN จากเอกสารที่มีอยู่
//   ส่งออก/รับเข้า (transfers) + พักตรวจ/ส่งคืน/รับคืน (quarantine+returns) + ขาย (orders)
//   → รู้สินค้า, สถานะ, ที่อยู่ปัจจุบัน, เส้นทางเต็ม, ผลต่าง/ผู้อนุมัติ ราย SN
// =====================================================================
import { listAllTransfers, listOrders, listProducts } from "./repo";
import type { SerialLocated } from "../types";
import { tr as trL } from "../i18n/tr";

export type SerialEventKind = "received" | "shipped" | "sold" | "returned" | "quarantined" | "return_in" | "flagged";
export interface SerialEvent {
  kind: SerialEventKind;
  at: string;
  branchId: string;
  refNo: string;        // เลขเอกสาร (TF-… / RT-… / order_no)
  detail?: string | null;   // บริบท (เช่น "นอกใบโอน · ยอมรับ", "ขาด · ติดตาม")
  actor?: string | null;    // ผู้ทำ (employeeId)
}
export interface SerialInfo {
  serialNo: string;
  product: { id: string; sku: string; name: string; image_url: string | null; warranty_months?: number | null; price?: number | null } | null;
  status: "in_stock" | "in_transit" | "sold" | "returned" | "quarantined" | "unknown";
  currentBranchId: string | null;
  events: SerialEvent[];
  /** ข้อมูลการขาย (ถ้าขายแล้ว) — ไว้โชว์ลูกค้า/ประกัน */
  soldInfo?: { orderNo: string; at: string; branchId: string; customerName: string | null } | null;
}

const eq = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

type Ctx = { transfers: Awaited<ReturnType<typeof listAllTransfers>>; orders: Awaited<ReturnType<typeof listOrders>>; pMap: Map<string, Awaited<ReturnType<typeof listProducts>>[number]> };
async function loadCtx(): Promise<Ctx> {
  const [transfers, orders, products] = await Promise.all([listAllTransfers(), listOrders({}), listProducts()]);
  return { transfers, orders, pMap: new Map(products.map((p) => [p.id, p])) };
}

export async function resolveSerial(snRaw: string): Promise<SerialInfo> {
  return computeSerial(snRaw, await loadCtx());
}

function computeSerial(snRaw: string, { transfers, orders, pMap }: Ctx): SerialInfo {
  const sn = snRaw.trim().toUpperCase();
  const empty: SerialInfo = { serialNo: sn, product: null, status: "unknown", currentBranchId: null, events: [] };
  if (!sn) return empty;
  const events: SerialEvent[] = [];
  let productId: string | null = null, sku = "", name = "";

  for (const tr of transfers) {
    for (const it of tr.items) {
      const shipped = (it.shippedSerials ?? []).find((s) => eq(s.serialNo, sn));
      if (shipped) { events.push({ kind: "shipped", at: shipped.at, branchId: tr.from_branch_id, refNo: tr.transfer_no, actor: shipped.by ?? null }); productId = it.product_id; sku = it.sku; name = it.name; }
      const received = (it.receivedSerials ?? []).find((s) => eq(s.serialNo, sn));
      if (received) { events.push({ kind: "received", at: received.at, branchId: tr.to_branch_id, refNo: tr.transfer_no, actor: received.by ?? null }); productId = it.product_id; sku = it.sku; name = it.name; }
      const quar = (it.quarantinedSerials ?? []).find((s) => eq(s.serialNo, sn));
      if (quar) { events.push({ kind: "quarantined", at: quar.at, branchId: tr.to_branch_id, refNo: tr.transfer_no, detail: trL("นอกใบโอน · พักตรวจ", "Not on transfer · quarantined", "不在调拨单 · 暂扣"), actor: quar.by ?? null }); productId = it.product_id; sku = it.sku; name = it.name; }
    }
    // ผลต่างที่ผูก SN (ขาด/ชำรุด/SN ผิด/นอกใบโอน) — จุดเปิดเคส + ผลสรุป
    for (const d of tr.discrepancies ?? []) {
      if (!d.serialNo || !eq(d.serialNo, sn)) continue;
      const kindTh = d.kind === "short" ? trL("ขาด", "Short", "短缺") : d.kind === "lost" ? trL("สูญหาย", "Lost", "丢失") : d.kind === "damaged" ? trL("ชำรุด", "Damaged", "损坏") : d.kind === "wrong_sn" ? trL("SN ผิด", "Wrong SN", "SN 错误") : d.kind === "unexpected_sn" ? trL("นอกใบโอน", "Not on transfer", "不在调拨单") : d.kind;
      const outTh = d.sn_outcome === "accept" ? trL("ยอมรับที่ปลายทาง", "Accepted at destination", "目的地接收") : d.sn_outcome === "return_source" ? trL("ส่งคืนต้นทาง", "Returned to source", "退回来源") : d.sn_outcome === "dispose" ? trL("ตัดจำหน่าย", "Written off", "已核销") : d.sn_outcome === "found_source" ? trL("พบที่ต้นทาง", "Found at source", "在来源找到") : d.sn_outcome === "tracking" ? trL("กำลังติดตาม", "Tracking", "追踪中") : d.sn_outcome === "confirmed_lost" ? trL("ยืนยันสูญหาย", "Confirmed lost", "确认丢失") : d.sn_outcome === "replaced" ? trL("ส่งทดแทนแล้ว", "Replacement sent", "已补发") : d.status === "resolved" ? trL("ปิดเคสแล้ว", "Case closed", "已结案") : trL("รอตรวจสอบ", "Pending review", "待核查");
      events.push({ kind: "flagged", at: d.resolved_at ?? d.at, branchId: d.kind === "short" || d.kind === "lost" ? tr.to_branch_id : tr.to_branch_id, refNo: tr.transfer_no, detail: `${kindTh} · ${outTh}`, actor: d.resolved_by ?? d.by ?? null });
      productId = d.product_id; const p = tr.items.find((x) => x.product_id === d.product_id); if (p) { sku = p.sku; name = p.name; }
    }
    // ใบส่งคืน — SN ที่ส่งคืนจริง (sns_found/expected) + ต้นทางรับคืน
    for (const r of tr.returns ?? []) {
      for (const l of r.lines ?? []) {
        const sns = [...(l.sns_found ?? []), ...(l.sns_expected ?? []), ...(l.sns_received_back ?? [])];
        if (!sns.some((x) => eq(x, sn))) continue;
        if (r.shipped_at) events.push({ kind: "returned", at: r.shipped_at, branchId: tr.to_branch_id, refNo: r.return_no ?? tr.transfer_no, detail: r.outcome === "repair" ? trL("ส่งซ่อม", "Sent for repair", "送修") : trL("ส่งคืนต้นทาง", "Returned to source", "退回来源"), actor: r.shipped_by ?? null });
        if (r.received_at) events.push({ kind: "return_in", at: r.received_at, branchId: tr.from_branch_id, refNo: r.return_no ?? tr.transfer_no, detail: l.close_outcome === "release" ? trL("รับคืน · ปล่อยขาย", "Received back · released for sale", "已收回 · 放行销售") : l.close_outcome === "dispose" ? trL("รับคืน · ตัดจำหน่าย", "Received back · written off", "已收回 · 核销") : l.close_outcome === "repair" ? trL("รับคืน · ส่งซ่อม", "Received back · sent for repair", "已收回 · 送修") : trL("รับคืน · พักตรวจ", "Received back · quarantined", "已收回 · 暂扣"), actor: r.received_by ?? null });
        productId = l.product_id; const p = tr.items.find((x) => x.product_id === l.product_id); if (p) { sku = p.sku; name = p.name; }
      }
    }
  }
  let soldInfo: SerialInfo["soldInfo"] = null;
  for (const o of orders) {
    if (o.status === "voided") continue;
    for (const it of o.items) {
      if ((it.serials ?? []).some((s) => eq(s, sn))) {
        events.push({ kind: "sold", at: o.created_at, branchId: o.branch_id, refNo: o.order_no });
        productId = it.product_id ?? productId; sku = sku || it.sku; name = name || it.name;
        soldInfo = { orderNo: o.order_no, at: o.created_at, branchId: o.branch_id, customerName: o.customer_name ?? null };
      }
    }
  }

  events.sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!events.length) return empty;

  const p = productId ? pMap.get(productId) : undefined;
  const product = { id: productId ?? "", sku: p?.sku ?? sku, name: p?.name_th ?? name, image_url: p?.image_url ?? null, warranty_months: p?.warranty_months ?? null, price: p?.price ?? null };
  // สถานะ/ตำแหน่ง ดูจากเหตุการณ์ "ย้ายของจริง" ตัวท้ายสุด — flagged เป็นหมายเหตุผลต่าง ไม่ใช่การย้าย
  const moveEvents = events.filter((e) => e.kind !== "flagged");
  const last = (moveEvents.length ? moveEvents : events)[moveEvents.length ? moveEvents.length - 1 : events.length - 1];
  const status: SerialInfo["status"] =
    last.kind === "sold" ? "sold" :
    last.kind === "returned" ? "in_transit" :
    last.kind === "return_in" ? "returned" :
    last.kind === "quarantined" ? "quarantined" :
    last.kind === "flagged" ? "quarantined" :
    last.kind === "received" ? "in_stock" :
    last.kind === "shipped" ? "in_transit" : "unknown";
  const currentBranchId = status === "in_transit" ? null : last.branchId;
  return { serialNo: sn, product, status, currentBranchId, events, soldInfo };
}

/** หา "ที่อยู่ปัจจุบัน" ของ SN แบบย่อ — กัน SN เดียวอยู่สองสาขา (ใช้ตอนรับ SN นอกใบโอน) */
export async function locateSerial(snRaw: string): Promise<SerialLocated> {
  const info = await resolveSerial(snRaw);
  const where: SerialLocated["where"] =
    info.status === "sold" ? "sold" :
    info.status === "in_transit" ? "in_transit" :
    info.status === "unknown" ? "unknown" : "in_stock";
  const last = info.events[info.events.length - 1];
  return { where, branchId: info.currentBranchId, refNo: last?.refNo ?? null };
}

/** SN ล่าสุดที่พบในเอกสาร (ผสมทั้งขายแล้ว + โอนย้าย) — ไว้กดทดลองเร็วๆ */
export async function recentSerials(limit = 16): Promise<{ serialNo: string; name: string }[]> {
  const [transfers, orders] = await Promise.all([listAllTransfers(), listOrders({})]);
  const seen = new Set<string>();
  const out: { serialNo: string; name: string }[] = [];
  const add = (serialNo: string, name: string) => { const k = serialNo.toUpperCase(); if (seen.has(k)) return; seen.add(k); out.push({ serialNo, name }); };
  // ขายแล้วก่อน (โชว์ฟีเจอร์ประกัน/ลูกค้า) ~ครึ่งหนึ่ง
  const soldCap = Math.ceil(limit / 2);
  for (const o of orders) { if (o.status === "voided") continue; for (const it of o.items) for (const s of it.serials ?? []) { add(s, it.name); if (out.length >= soldCap) break; } if (out.length >= soldCap) break; }
  // เติมด้วย SN จากโอนย้าย
  for (const tr of transfers) for (const it of tr.items) for (const s of [...(it.shippedSerials ?? []), ...(it.receivedSerials ?? []), ...(it.quarantinedSerials ?? [])]) { add(s.serialNo, it.name); if (out.length >= limit) return out; }
  return out;
}

/** SN ทุกตัวของสินค้า 1 ตัว (จากเอกสารโอน/ส่งคืน/ขายในเครื่อง) พร้อมสถานะ/ที่อยู่/ไทม์ไลน์ — โหลดข้อมูลครั้งเดียว */
export async function serialsForProduct(productId: string): Promise<SerialInfo[]> {
  const ctx = await loadCtx();
  const sns = new Set<string>();
  const add = (x?: string | null) => { if (x && x.trim()) sns.add(x.trim().toUpperCase()); };
  for (const tr of ctx.transfers) {
    for (const it of tr.items) {
      if (it.product_id !== productId) continue;
      for (const x of [...(it.shippedSerials ?? []), ...(it.receivedSerials ?? []), ...(it.quarantinedSerials ?? [])]) add(x.serialNo);
    }
    for (const d of tr.discrepancies ?? []) if (d.product_id === productId) add(d.serialNo);
    for (const r of tr.returns ?? []) for (const l of r.lines ?? []) if (l.product_id === productId) for (const x of [...(l.sns_found ?? []), ...(l.sns_expected ?? []), ...(l.sns_received_back ?? [])]) add(x);
  }
  for (const o of ctx.orders) {
    if (o.status === "voided") continue;
    for (const it of o.items) if (it.product_id === productId) for (const x of it.serials ?? []) add(x);
  }
  return [...sns].map((sn) => computeSerial(sn, ctx));
}
