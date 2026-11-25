// =====================================================================
// ปรับยอดสต๊อก/SN ของสาขา POS ให้ตรง OneWarehouse (OW = ตัวจริง, POS = สำเนาที่ checkout ใช้)
//   • ยอด: GET /v1/stock?warehouseId&skus (ทีละ 50 SKU) → ตั้ง qty_on_hand = ยอด OW − บิลที่ POS ตัดแล้วแต่ JST ยังไม่ยืนยัน
//     (กันขายซ้ำ: บิลที่ยังค้างคิว/รอ JST ยังนับอยู่ใน OW) · SKU ที่ OW ไม่มี = ไม่แตะ (รายงานกลับ)
//   • SN: OW ไม่มี API รายการ SN ทั้งหมด → ตรวจราย SN (GET /v1/serials/{sn}) จาก SN ที่ POS รู้จักของสาขานี้ + SN ที่ระบุเพิ่ม
//     อัปเดตสาขา/สถานะตาม OW · SN ที่ OW ไม่รู้จัก = ไม่ลบ (รายงานกลับ)
//   • ทุกการปรับลงบัญชีเคลื่อนไหว pos_ow_movements (key ต่อรอบ → รอบเดิมซ้ำไม่ปรับซ้ำ)
//   • ⚠ /v1/stock = ยอด JST ซึ่งอัปเดตช้ากว่าใบโอน (~1 นาที แม้ใบขึ้น synced แล้ว — ทดสอบจริง 2026-11-24)
//     → สินค้าที่เพิ่งมีการเคลื่อนไหวจากใบโอนในช่วง settleMinutes ข้ามไว้ก่อน ("รอ JST อัปเดต") ไม่ทับด้วยยอดเก่า
// =====================================================================
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pool } from "@/lib/ow-sync/model";
import { owConfig } from "./ow-gateway";
import { owCall, type OwResult } from "./ow-write";
import { warehouseLinks, OwTransferError } from "./ow-transfers";

type OwSerial = { serialNo: string; sku: string; warehouseId: string | null; status: string; stockType?: string | null };
export interface ReconcileReport {
  run: string; branch_id: string; warehouse_id: string;
  stock: { sku: string; ow_qty: number; pending_sales: number; target: number; delta: number | null; settling?: boolean }[];
  not_in_ow: number;
  serials: { checked: number; updated: number; unknown: string[]; other_warehouse: string[]; skipped: string[]; held_sold: string[] };
  reserved?: { sku: string; qty: number }[];
}

const SERIAL_STATUS: Record<string, string> = { in_stock: "in_stock", sold: "sold", transferred: "transferred", in_transit: "transferred", reserved: "reserved", returned: "returned", scrapped: "scrapped", defective: "defective" };

/** จำนวนชิ้นที่ POS ตัดขายแล้วแต่ OW/JST ยังไม่ตัด (ต่อสินค้า) ของสาขานี้ */
export async function pendingSaleQty(branchId: string, source: string): Promise<Map<string, number>> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const ev = await sb.from("pos_integration_events").select("aggregate_id,state,response").eq("source", source).eq("event_type", "sale.committed").gte("created_at", since).limit(2000);
  if (ev.error) throw new OwTransferError("อ่านคิวบิลขายไม่สำเร็จ", 503, "events_read");
  const holds = (ev.data ?? []).filter((e) => {
    const st = (e.response as { sale?: { status?: string } } | null)?.sale?.status;
    return !isOwSaleDone(st) && st !== "void";
  }).map((e) => e.aggregate_id as string);
  const out = new Map<string, number>();
  for (let i = 0; i < holds.length; i += 200) {
    const o = await sb.from("orders").select("branch_id,status,order_items(product_id,qty)").in("client_uuid", holds.slice(i, i + 200)).eq("branch_id", branchId);
    if (o.error) throw new OwTransferError("อ่านบิลไม่สำเร็จ", 503, "orders_read");
    for (const ord of o.data ?? []) {
      if (!["completed", "partially_refunded"].includes(ord.status as string)) continue;
      for (const it of (ord.order_items ?? []) as { product_id: string | null; qty: number }[]) if (it.product_id) out.set(it.product_id, (out.get(it.product_id) ?? 0) + Number(it.qty));
    }
  }
  return out;
}

export async function owReconcileBranch(branchId: string, actor: string, extraSerials: string[] = [], opts: { settleMinutes?: number } = {}): Promise<ReconcileReport> {
  const sb = supabaseAdmin(), source = owConfig().source;
  const links = await warehouseLinks();
  const wh = links.get(branchId);
  if (!wh) throw new OwTransferError("สาขานี้ยังไม่ผูกคลัง OneWarehouse", 409, "not_mapped");
  const whToBranch = new Map([...links].map(([b, w]) => [w, b]));
  const run = randomUUID(), ref = `reconcile ${run.slice(0, 8)} by ${actor}`;

  // ── ยอดสต๊อก ──
  const prods: { id: string; sku: string; track_serial: boolean | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from("products").select("id,sku,track_serial").not("sku", "is", null).order("id").range(from, from + 999);
    if (r.error) throw new OwTransferError("อ่านสินค้าไม่สำเร็จ", 503, "products_read");
    prods.push(...(r.data ?? []) as typeof prods);
    if ((r.data ?? []).length < 1000) break;
  }
  const bySku = new Map(prods.map((p) => [p.sku, p]));
  const pending = await pendingSaleQty(branchId, source);
  // สินค้าที่ JST อาจยังไม่สะท้อน (มีการเคลื่อนไหวจากใบโอนเมื่อเร็ว ๆ นี้)
  const settleMin = Math.max(0, opts.settleMinutes ?? 10);
  const settling = new Set<string>();
  if (settleMin > 0) {
    const rec = await sb.from("pos_ow_movements").select("product_id,move_key").eq("source", source).eq("branch_id", branchId).gt("applied_at", new Date(Date.now() - settleMin * 60_000).toISOString()).limit(5000);
    if (rec.error) throw new OwTransferError("อ่านบัญชีเคลื่อนไหวไม่สำเร็จ", 503, "movements_read");
    for (const m of rec.data ?? []) if (!String(m.move_key).startsWith("reconcile")) settling.add(m.product_id as string);
  }
  const owQty = new Map<string, number>();
  const skus = [...bySku.keys()].filter((k) => !k.includes(",")); // คั่นด้วย , ในพารามิเตอร์ — SKU ที่มี , ส่งไม่ได้
  for (let i = 0; i < skus.length; i += 50) {
    const chunk = skus.slice(i, i + 50);
    type StockRow = { sku: string; warehouseId: string; qty: number };
    const res: OwResult<StockRow[]> = await owCall<StockRow[]>("GET", `stock?${new URLSearchParams({ warehouseId: wh, skus: chunk.join(",") })}`);
    if (!res.ok || !Array.isArray(res.data)) throw new OwTransferError(`อ่านสต๊อก OW ไม่สำเร็จ: ${res.error?.message ?? res.status}`, 502, res.error?.code ?? "stock_read");
    const rows: StockRow[] = res.data;
    for (const row of rows) {
      if (row.warehouseId !== wh || !chunk.includes(row.sku) || !Number.isFinite(row.qty)) throw new OwTransferError(`ข้อมูลสต๊อก OW ผิดรูปแบบ (${row.sku})`, 502, "stock_shape");
      owQty.set(row.sku, row.qty);
    }
  }
  const stock: ReconcileReport["stock"] = [];
  for (const [sku, qty] of owQty) {
    const p = bySku.get(sku)!;
    const pend = pending.get(p.id) ?? 0;
    const target = Math.max(0, qty - pend);
    if (settling.has(p.id)) { stock.push({ sku, ow_qty: qty, pending_sales: pend, target, delta: null, settling: true }); continue; }
    const { data, error } = await sb.rpc("pos_ow_reconcile_stock", { p_source: source, p_key: `reconcile:${run}:${branchId}:${p.id}`, p_branch: branchId, p_product: p.id, p_target: target, p_ref: ref });
    if (error) throw new OwTransferError(`ปรับยอด ${sku} ไม่สำเร็จ: ${error.message}`, 503, "stock_apply");
    stock.push({ sku, ow_qty: qty, pending_sales: pend, target, delta: data == null ? null : Number(data) });
  }

  // ── SN ──
  const known = await sb.from("serials").select("serial_no").eq("branch_id", branchId).limit(5000);
  if (known.error) throw new OwTransferError("อ่าน SN ไม่สำเร็จ", 503, "serials_read");
  const cands = [...new Set([...(known.data ?? []).map((r) => r.serial_no as string), ...extraSerials.map((s) => s.trim()).filter(Boolean)])].slice(0, 2000);
  const rep: ReconcileReport["serials"] = { checked: cands.length, updated: 0, unknown: [], other_warehouse: [], skipped: [], held_sold: [] };
  await pool(cands, async (sn) => {
    const r = await owCall<OwSerial>("GET", `serials/${encodeURIComponent(sn)}`);
    if (r.status === 404) { rep.unknown.push(sn); return; }
    if (!r.ok || !r.data) { rep.skipped.push(sn); return; }
    const p = bySku.get(r.data.sku);
    const status = r.data.status === "in_stock" && r.data.stockType === "damaged" ? "defective" : SERIAL_STATUS[r.data.status];
    const target = r.data.warehouseId ? whToBranch.get(String(r.data.warehouseId)) : undefined;
    if (!p || !status) { rep.skipped.push(sn); return; }
    if (!target) { rep.other_warehouse.push(sn); return; } // อยู่คลังที่ไม่ผูกกับสาขา POS ใด — ไม่ย้ายเดา
    const { data: applied, error } = await sb.rpc("pos_ow_apply_movement", { p_source: source, p_key: `reconcile-sn:${run}:${sn}`, p_branch: target, p_product: p.id, p_onhand: 0, p_quarantine: 0, p_serials: [sn], p_serial_status: status, p_ref: ref });
    if (error) { rep.skipped.push(sn); return; }
    // false = SN ขายแล้วในบิล POS ที่ JST ยังไม่ยืนยัน (0059) → คงเป็น "ขายแล้ว" กันขายซ้ำ
    if (applied === false) { rep.held_sold.push(sn); return; }
    rep.updated++;
  }, 5);

  // ยอดจองตาม JST (ใบโอนขาออกที่ยังไม่ส่ง) — กันขายของที่ JST กันไว้แล้ว
  const reserved = await owSyncReservations(branchId);
  return { run, branch_id: branchId, warehouse_id: wh, stock, not_in_ow: skus.length - owQty.size, serials: rep, reserved };
}

// ── ยอดจองตาม JST ────────────────────────────────────────────────────────
/** สถานะใบโอนขาออกที่ JST/OW กันของไว้แล้วแต่ยังไม่ส่งออก (ของยังอยู่คลังแต่ขายไม่ได้) */
const RESERVING = new Set(["reviewed", "picklist_created", "shipped", "sn_moved"]);

/** ตั้งยอด "จอง" ของสาขา = ผลรวมจำนวนในใบโอนขาออกที่ยังไม่ส่ง (รวมใบที่ OW/ทีมอื่นเปิดเอง) → checkout หักออกให้อัตโนมัติ */
export async function owSyncReservations(branchId: string): Promise<{ sku: string; qty: number }[]> {
  const sb = supabaseAdmin();
  const links = await warehouseLinks();
  const wh = links.get(branchId);
  if (!wh) return [];
  type Row = { id: string; direction: string; status: string };
  const ids: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await owCall<{ items?: Row[]; total?: number; pageSize?: number }>("GET", `transfers?warehouseId=${encodeURIComponent(wh)}&status=active&page=${page}`);
    if (!r.ok) throw new OwTransferError(`อ่านใบโอนขาออกจาก OW ไม่สำเร็จ: ${r.error?.message ?? r.status}`, 502, "list_failed");
    for (const t of r.data?.items ?? []) if (t.direction === "out" && RESERVING.has(t.status)) ids.push(t.id);
    if (!(r.data?.items ?? []).length || page * (r.data?.pageSize ?? 20) >= (r.data?.total ?? 0)) break;
  }
  const bySku = new Map<string, number>();
  await pool(ids, async (id) => {
    const d = await owCall<{ status: string; lines: { sku: string; qty: number }[] }>("GET", `transfers/${encodeURIComponent(id)}`);
    if (!d.ok || !d.data) throw new OwTransferError("อ่านใบโอนขาออกไม่สำเร็จ", 502, "read_failed");
    if (!RESERVING.has(d.data.status)) return; // เปลี่ยนสถานะระหว่างอ่าน
    for (const l of d.data.lines) bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + Number(l.qty));
  }, 4);
  const skus = [...bySku.keys()];
  const prods = skus.length ? await sb.from("products").select("id,sku").in("sku", skus) : { data: [], error: null };
  if (prods.error) throw new OwTransferError("อ่านสินค้าไม่สำเร็จ", 503, "products_read");
  const items = (prods.data ?? []).map((p) => ({ product_id: p.id as string, qty: bySku.get(p.sku as string) ?? 0 }));
  const { error } = await sb.rpc("pos_ow_set_reserved", { p_branch: branchId, p_items: items });
  if (error) throw new OwTransferError("บันทึกยอดจองไม่สำเร็จ: " + error.message, 503, "reserve_write");
  return skus.map((sku) => ({ sku, qty: bySku.get(sku)! }));
}

/** ซิงก์ยอดจองทุกสาขาที่ผูกคลังกลาง (วงรอบอัตโนมัติ) */
export async function owSyncAllReservations(): Promise<number> {
  const links = await warehouseLinks();
  let n = 0;
  for (const branchId of links.keys()) { await owSyncReservations(branchId); n++; }
  return n;
}
