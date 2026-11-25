// ถาม OneWarehouse ว่า SN อยู่ที่ไหน/สถานะอะไรใน JST (GET /v1/serials/{serialNo}) + ตีความเป็นภาษาไทย
//   ใช้ก่อนรับเงิน (กันบิลที่ JST จะปฏิเสธ) และหน้าตามรอย SN · แคช 30 วิ ลดการยิงซ้ำตอนกดชำระหลายครั้ง
import { owCall } from "./ow-write";

export type OwSerial = { serialNo: string; sku: string; warehouseId: string | null; status: string; stockType?: string | null; lastMovementId?: string | null };
export type OwSerialLookup = { sn: string; found: boolean; data?: OwSerial; error?: string | null };
export type SnIssue = { sn: string; sku: string; code: "unknown" | "wrong_warehouse" | "wrong_sku" | "not_in_stock" | "damaged"; message: string };

const cache = new Map<string, { at: number; v: OwSerialLookup }>();
const STATUS_TH: Record<string, string> = { in_stock: "อยู่ในสต๊อก", sold: "ขายแล้ว", in_transit: "อยู่ระหว่างโอน", reserved: "ถูกจอง", written_off: "ตัดจำหน่ายแล้ว", shipped: "ส่งออกแล้ว" };
export const owSerialStatusTh = (s?: string | null) => (s ? STATUS_TH[s] ?? s : "—");

export async function owSerialLookup(sn: string, timeoutMs = 6_000): Promise<OwSerialLookup> {
  const key = sn.trim().toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const r = await owCall<OwSerial>("GET", `serials/${encodeURIComponent(key)}`, undefined, timeoutMs);
  let v: OwSerialLookup;
  if (r.ok && r.data) v = { sn: key, found: true, data: r.data };
  else if (r.status === 404 || r.error?.code === "serial_unknown") v = { sn: key, found: false };
  else v = { sn: key, found: false, error: r.error?.message ?? `คลังกลางไม่ตอบ (${r.status})` }; // ล่ม/อ่านไม่ได้ — ห้ามตีความว่าไม่มี SN
  if (!v.error) { cache.set(key, { at: Date.now(), v }); if (cache.size > 2000) cache.delete(cache.keys().next().value as string); }
  return v;
}

/** ตรวจว่า SN ขายได้ที่คลังนี้ใน JST ไหม — คืนปัญหา (ว่าง = ผ่าน) และ SN ที่ตรวจไม่ได้ (OW ล่ม) */
export async function checkSaleSerials(warehouseId: string, items: { sku: string; serials: string[] }[]): Promise<{ issues: SnIssue[]; unchecked: string[] }> {
  const all = items.flatMap((i) => i.serials.map((sn) => ({ sku: i.sku, sn: sn.trim().toUpperCase() }))).filter((x) => x.sn).slice(0, 60);
  const res = await Promise.all(all.map(async (x) => ({ ...x, r: await owSerialLookup(x.sn) })));
  const issues: SnIssue[] = [], unchecked: string[] = [];
  for (const { sku, sn, r } of res) {
    if (r.error) { unchecked.push(sn); continue; }
    if (!r.found || !r.data) { issues.push({ sn, sku, code: "unknown", message: `SN ${sn} ไม่มีในระบบ JST — ตรวจว่าสแกนถูกเครื่อง หรือแจ้งทีมคลังกลางลงทะเบียน SN` }); continue; }
    const d = r.data;
    if (d.sku && d.sku.toUpperCase() !== sku.toUpperCase()) issues.push({ sn, sku, code: "wrong_sku", message: `SN ${sn} เป็นของสินค้า ${d.sku} ใน JST ไม่ใช่ ${sku}` });
    else if (d.warehouseId && d.warehouseId !== warehouseId) issues.push({ sn, sku, code: "wrong_warehouse", message: `SN ${sn} อยู่คลัง ${d.warehouseId} ใน JST ไม่ใช่คลังของสาขานี้ (${warehouseId}) — ต้องโอนเข้าก่อนขาย` });
    else if (d.status !== "in_stock") issues.push({ sn, sku, code: "not_in_stock", message: `SN ${sn} สถานะใน JST: ${owSerialStatusTh(d.status)} — ขายซ้ำไม่ได้` });
    else if (d.stockType && d.stockType !== "sellable") issues.push({ sn, sku, code: "damaged", message: `SN ${sn} เป็นของ${d.stockType === "damaged" ? "ชำรุด" : ` ${d.stockType}`} ใน JST — ขายเป็นของดีไม่ได้` });
  }
  return { issues, unchecked };
}
