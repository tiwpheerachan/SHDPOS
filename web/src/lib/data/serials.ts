// =====================================================================
// ตามรอย Serial (SN) รายชิ้น — รวมไทม์ไลน์ของ SN จากเอกสารที่มีอยู่
//   รับเข้า/ส่งออก (transfers shipped/received serials) + ขาย (order items serials)
//   → รู้สินค้า (ชื่อ/รูป), สถานะ, ที่อยู่ปัจจุบัน และเส้นทางการเดินทาง
// =====================================================================
import { listAllTransfers, listOrders, listProducts } from "./repo";

export type SerialEventKind = "received" | "shipped" | "sold" | "returned";
export interface SerialEvent {
  kind: SerialEventKind;
  at: string;
  branchId: string;
  refNo: string;        // เลขเอกสาร (TF-… / order_no)
}
export interface SerialInfo {
  serialNo: string;
  product: { id: string; sku: string; name: string; image_url: string | null } | null;
  status: "in_stock" | "in_transit" | "sold" | "returned" | "unknown";
  currentBranchId: string | null;
  events: SerialEvent[];
}

const eq = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export async function resolveSerial(snRaw: string): Promise<SerialInfo> {
  const sn = snRaw.trim().toUpperCase();
  const empty: SerialInfo = { serialNo: sn, product: null, status: "unknown", currentBranchId: null, events: [] };
  if (!sn) return empty;

  const [transfers, orders, products] = await Promise.all([listAllTransfers(), listOrders({}), listProducts()]);
  const pMap = new Map(products.map((p) => [p.id, p]));
  const events: SerialEvent[] = [];
  let productId: string | null = null, sku = "", name = "";

  for (const tr of transfers) {
    for (const it of tr.items) {
      const shipped = (it.shippedSerials ?? []).find((s) => eq(s.serialNo, sn));
      if (shipped) { events.push({ kind: "shipped", at: shipped.at, branchId: tr.from_branch_id, refNo: tr.transfer_no }); productId = it.product_id; sku = it.sku; name = it.name; }
      const received = (it.receivedSerials ?? []).find((s) => eq(s.serialNo, sn));
      if (received) { events.push({ kind: "received", at: received.at, branchId: tr.to_branch_id, refNo: tr.transfer_no }); productId = it.product_id; sku = it.sku; name = it.name; }
    }
  }
  for (const o of orders) {
    if (o.status === "voided") continue;
    for (const it of o.items) {
      if ((it.serials ?? []).some((s) => eq(s, sn))) {
        events.push({ kind: "sold", at: o.created_at, branchId: o.branch_id, refNo: o.order_no });
        productId = it.product_id ?? productId; sku = sku || it.sku; name = name || it.name;
      }
    }
  }

  events.sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!events.length) return empty;

  const p = productId ? pMap.get(productId) : undefined;
  const product = { id: productId ?? "", sku: p?.sku ?? sku, name: p?.name_th ?? name, image_url: p?.image_url ?? null };
  const last = events[events.length - 1];
  const status: SerialInfo["status"] =
    last.kind === "sold" ? "sold" : last.kind === "returned" ? "returned" :
    last.kind === "received" ? "in_stock" : last.kind === "shipped" ? "in_transit" : "unknown";
  const currentBranchId = status === "in_transit" ? null : last.branchId;
  return { serialNo: sn, product, status, currentBranchId, events };
}

/** SN ล่าสุดที่พบในเอกสารโอนย้าย — ไว้กดทดลองเร็วๆ */
export async function recentSerials(limit = 12): Promise<{ serialNo: string; name: string }[]> {
  const transfers = await listAllTransfers();
  const seen = new Set<string>();
  const out: { serialNo: string; name: string }[] = [];
  for (const tr of transfers) {
    for (const it of tr.items) {
      for (const s of [...(it.shippedSerials ?? []), ...(it.receivedSerials ?? [])]) {
        const key = s.serialNo.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ serialNo: s.serialNo, name: it.name });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
