// =====================================================================
// ตรวจความตรงกัน POS ↔ OneWarehouse ↔ JST — เทียบรายช่อง แล้วเก็บผลทุกรอบ (pos_ow_recon_checks)
//   • บิลขาย: เลขอ้างอิง · ยอด · สินค้า/จำนวน/ราคา · SN · การชำระ · เวลา · สถานะ JST · บิลยกเลิก/คืนใน POS
//   • ใบโอน: สถานะ (แมป POS↔OW) · SN ส่ง/รับ · เลข JST · คำสั่งที่ OW รับจริง (appliedOps) · ผล JST · เวลาแต่ละขั้น
//   • สต๊อก: ยอดคงคลัง POS เทียบ OW รายสินค้า (สินค้าที่เพิ่งเคลื่อนไหว = รอ JST อัปเดต ไม่นับว่าไม่ตรง)
//   หมายเหตุเวลา: JST ใช้เวลาที่ OW ส่ง (submittedAt) จนกว่า ERIS-254 → แสดงเป็นข้อมูล ไม่ถือว่าไม่ตรง
// =====================================================================
import { syncTransferIssues } from "./ow-issues";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pool } from "@/lib/ow-sync/model";
import type { Transfer, TransferStatus } from "@/lib/types";
import { owConfig } from "./ow-gateway";
import { owCall } from "./ow-write";
import { warehouseLinks } from "./ow-transfers";
import { pendingSaleQty } from "./ow-reconcile";

export type Diff = { field: string; pos: unknown; ow: unknown; jst?: unknown; ok: boolean; note?: string };
export type ReconRow = {
  kind: "sale" | "transfer" | "stock"; ref: string; branch_id: string | null;
  status: "match" | "mismatch" | "pending" | "info"; summary: string;
  diffs: Diff[]; times: Record<string, string | number | null>; pos_data: unknown; ow_data: unknown;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const secs = (a?: string | null, b?: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);
const sortJoin = (xs: string[]) => [...xs].sort().join(", ");
const finalize = (row: Omit<ReconRow, "status" | "summary">, pending = false, extra = ""): ReconRow => {
  const bad = row.diffs.filter((d) => !d.ok);
  const status = pending ? "pending" : bad.length ? "mismatch" : "match";
  const summary = pending ? `รอผล${extra ? ` · ${extra}` : ""}` : bad.length ? `ไม่ตรง ${bad.length} รายการ: ${bad.map((d) => d.field).join(", ")}` : `ตรงกันครบ ${row.diffs.length} รายการ${extra ? ` · ${extra}` : ""}`;
  return { ...row, status, summary };
};

// ── บิลขาย ──────────────────────────────────────────────────────────────
type OwSaleFull = {
  id: string; saleNo: string; status: string; orderTime?: string; createdAt?: string; remark?: string | null; billDiscount?: number;
  lines: { sku: string; qty: number; unitPrice: number; lineDiscount?: number; isFreebie?: boolean; serials?: string[] }[];
  payments: { method: string; amount: number }[]; problems?: { code: string; message: string }[];
  jstProgress?: { jstOrderNo?: string; submittedAt?: string } | null; jstSync?: { at?: string; phase?: string; outcome?: string } | null;
};

async function checkSales(source: string, limit: number): Promise<ReconRow[]> {
  const sb = supabaseAdmin();
  const ev = await sb.from("pos_integration_events").select("id,aggregate_id,state,reason,response,created_at")
    .eq("source", source).eq("event_type", "sale.committed").order("created_at", { ascending: false }).limit(limit);
  if (ev.error) throw new Error("อ่านคิวบิลขายไม่สำเร็จ: " + ev.error.message);
  const holds = (ev.data ?? []).map((e) => e.aggregate_id as string);
  if (!holds.length) return [];
  const ord = await sb.from("orders")
    .select("id,order_no,client_uuid,branch_id,status,grand_total,created_at,sale_occurred_at,order_items(sku,qty,unit_price,discount_amount,is_gift,order_item_serials(serial_no)),order_payments(method,amount)")
    .in("client_uuid", holds);
  if (ord.error) throw new Error("อ่านบิล POS ไม่สำเร็จ: " + ord.error.message);
  const byHold = new Map((ord.data ?? []).map((o) => [o.client_uuid as string, o]));
  const rows: ReconRow[] = [];
  await pool(ev.data ?? [], async (e) => {
    const o = byHold.get(e.aggregate_id as string);
    const saleId = (e.response as { sale?: { id?: string } } | null)?.sale?.id;
    if (!o) { rows.push({ kind: "sale", ref: String(e.aggregate_id), branch_id: null, status: "mismatch", summary: "มีในคิวแต่ไม่พบบิล POS", diffs: [], times: {}, pos_data: null, ow_data: e.response }); return; }
    type Item = { sku: string; qty: number; unit_price: number; discount_amount: number; is_gift: boolean | null; order_item_serials: { serial_no: string }[] | null };
    const items = (o.order_items ?? []) as Item[];
    const pays = (o.order_payments ?? []) as { method: string; amount: number }[];
    const posSaleAt = (o.sale_occurred_at ?? o.created_at) as string;
    const pos = {
      order_no: o.order_no, status: o.status, grand_total: Number(o.grand_total), sale_at: posSaleAt,
      items: items.map((i) => ({ sku: i.sku, qty: Number(i.qty), unit_price: Number(i.unit_price), discount: Number(i.discount_amount), gift: !!i.is_gift, serials: (i.order_item_serials ?? []).map((s) => s.serial_no) })),
      payments: pays.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    };
    if (!saleId) {
      rows.push(finalize({ kind: "sale", ref: o.order_no, branch_id: o.branch_id, diffs: [{ field: "ส่งเข้า OneWarehouse", pos: "ขายแล้ว", ow: `ยังไม่มีบิล (${e.state}${e.reason ? `: ${e.reason}` : ""})`, ok: false }], times: { pos_sale_at: posSaleAt }, pos_data: pos, ow_data: null }, ["queued", "processing", "retry"].includes(String(e.state)), String(e.state)));
      return;
    }
    const r = await owCall<OwSaleFull>("GET", `sales/${encodeURIComponent(saleId)}`);
    if (!r.ok || !r.data) { rows.push({ kind: "sale", ref: o.order_no, branch_id: o.branch_id, status: "pending", summary: `อ่านบิลจาก OW ไม่ได้ (${r.error?.message ?? r.status})`, diffs: [], times: {}, pos_data: pos, ow_data: null }); return; }
    const s = r.data;
    const diffs: Diff[] = [];
    // เลขอ้างอิง
    diffs.push({ field: "เลขบิลอ้างอิง", pos: o.order_no, ow: s.remark ?? "", jst: s.jstProgress?.jstOrderNo ?? null, ok: (s.remark ?? "").includes(o.order_no), note: "OW เก็บเลขบิล POS ในหมายเหตุ" });
    // ยอด
    const owLinesTotal = r2(s.lines.reduce((a, l) => a + l.unitPrice * l.qty - (l.lineDiscount ?? 0), 0) - (s.billDiscount ?? 0));
    const owPaid = r2(s.payments.reduce((a, p) => a + Number(p.amount), 0));
    diffs.push({ field: "ยอดสุทธิ", pos: pos.grand_total, ow: owLinesTotal, ok: r2(pos.grand_total) === owLinesTotal });
    diffs.push({ field: "ยอดรับชำระ", pos: r2(pos.payments.reduce((a, p) => a + p.amount, 0)), ow: owPaid, ok: r2(pos.payments.reduce((a, p) => a + p.amount, 0)) === owPaid });
    // สินค้า/จำนวน/ราคา (รวมตาม SKU + ของแถม)
    const agg = (xs: { sku: string; qty: number; price: number; gift: boolean }[]) => {
      const m = new Map<string, number>();
      for (const x of xs) m.set(`${x.sku}|${x.gift ? "แถม" : r2(x.price)}`, (m.get(`${x.sku}|${x.gift ? "แถม" : r2(x.price)}`) ?? 0) + x.qty);
      return [...m].sort().map(([k, q]) => `${k.replace("|", " @")} ×${q}`).join(" · ");
    };
    const posItems = agg(pos.items.map((i) => ({ sku: i.sku, qty: i.qty, price: i.unit_price, gift: i.gift })));
    const owItems = agg(s.lines.map((l) => ({ sku: l.sku, qty: Number(l.qty), price: l.unitPrice, gift: !!l.isFreebie })));
    diffs.push({ field: "สินค้า/จำนวน/ราคา", pos: posItems, ow: owItems, ok: posItems === owItems });
    // SN
    const posSn = sortJoin(pos.items.flatMap((i) => i.serials)), owSn = sortJoin(s.lines.flatMap((l) => l.serials ?? []));
    diffs.push({ field: "SN", pos: posSn || "—", ow: owSn || "—", ok: posSn === owSn });
    // การชำระ
    const payKey = (xs: { method: string; amount: number }[]) => xs.map((p) => `${p.method}:${r2(Number(p.amount))}`).sort().join(" · ");
    diffs.push({ field: "วิธีชำระ", pos: payKey(pos.payments), ow: payKey(s.payments), jst: "บันทึกเป็น เครดิต", ok: payKey(pos.payments) === payKey(s.payments), note: "JST บันทึกทุกวิธีเป็น เครดิต (ตามสัญญา OW)" });
    // เวลา
    const lagOw = secs(posSaleAt, s.orderTime ?? null);
    diffs.push({ field: "เวลาขาย", pos: posSaleAt, ow: s.orderTime ?? null, jst: s.jstProgress?.submittedAt ?? null, ok: lagOw != null && Math.abs(lagOw) <= 60, note: "JST ใช้เวลาที่ OW ส่ง (submittedAt) จนกว่า ERIS-254 จะส่ง orderTime ถึง JST" });
    // สถานะ POS ↔ OW (ยกเลิก/คืน)
    const posVoid = ["voided", "refunded"].includes(String(o.status));
    diffs.push({ field: "สถานะบิล", pos: o.status, ow: s.status, ok: posVoid ? s.status === "void" : s.status !== "void", note: posVoid ? "บิลยกเลิก/คืนเงินใน POS — ยังไม่มีการส่งยกเลิกไป OW/JST" : undefined });
    // JST
    const jstOk = s.status === "jst_confirmed" && !!s.jstProgress?.jstOrderNo;
    diffs.push({ field: "บิล JST", pos: "—", ow: s.status, jst: s.jstProgress?.jstOrderNo ?? (s.problems?.map((p) => p.message).join("; ") || null), ok: jstOk || s.status === "sn_pending" || s.status === "submitted", note: s.status === "sn_pending" ? "รอแก้ SN — JST ยังไม่เปิดบิล/ไม่ตัดสต๊อก" : undefined });
    rows.push(finalize({
      kind: "sale", ref: o.order_no, branch_id: o.branch_id, diffs,
      times: { pos_sale_at: posSaleAt, ow_order_time: s.orderTime ?? null, ow_created_at: s.createdAt ?? null, jst_submitted_at: s.jstProgress?.submittedAt ?? null, lag_pos_to_ow_sec: secs(posSaleAt, s.createdAt ?? null), lag_pos_to_jst_sec: secs(posSaleAt, s.jstProgress?.submittedAt ?? null) },
      pos_data: pos, ow_data: s,
    }, ["sn_pending", "submitted"].includes(s.status), s.status === "sn_pending" ? "รอแก้ SN" : s.status === "submitted" ? "รอ JST ยืนยัน" : ""));
  }, 4);
  // ตรวจกลับทาง: บิลใน OW (GET /sales ต่อสาขาขาย 30 วัน) ที่ไม่มีบิลคู่ในระบบเรา
  const known = new Set((ev.data ?? []).map((e) => (e.response as { sale?: { id?: string } } | null)?.sale?.id).filter(Boolean) as string[]);
  const sb2 = supabaseAdmin();
  const map = await sb2.from("pos_ow_sale_branches").select("branch_id,ow_branch_id").eq("source", source);
  if (map.error) throw new Error("อ่านการผูกสาขาขายไม่สำเร็จ: " + map.error.message);
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();
  for (const m of map.data ?? []) {
    const r = await owCall<OwSaleFull[]>("GET", `sales?${new URLSearchParams({ branchId: String(m.ow_branch_id), from, limit: "200" })}`);
    if (!r.ok || !Array.isArray(r.data)) { rows.push({ kind: "sale", ref: `OW ${m.ow_branch_id}`, branch_id: m.branch_id as string, status: "pending", summary: `อ่านรายการบิลใน OW ไม่ได้ (${r.error?.message ?? r.status})`, diffs: [], times: {}, pos_data: null, ow_data: null }); continue; }
    for (const s of r.data) {
      if (known.has(s.id)) continue;
      const claimsPos = /^POS\s/.test(s.remark ?? "");
      rows.push({
        kind: "sale", ref: s.saleNo, branch_id: m.branch_id as string, status: claimsPos ? "mismatch" : "info",
        summary: claimsPos ? `มีใน OW (${s.status}) แต่ไม่มีบิลคู่ในระบบเรา — ${s.remark}` : `บิลที่ระบบอื่นเปิดใน OW (${s.status}) — ${s.remark ?? "ไม่มีหมายเหตุ"}`,
        diffs: [{ field: "บิลในระบบเรา", pos: "ไม่มี", ow: `${s.saleNo} · ${s.status}`, jst: s.jstProgress?.jstOrderNo ?? null, ok: !claimsPos, note: claimsPos ? "หมายเหตุอ้างว่ามาจาก POS แต่ไม่พบบิล — ตรวจว่าเป็นบิลทดสอบ/บิลซ้ำหรือไม่" : undefined }],
        times: { ow_order_time: s.orderTime ?? null, jst_submitted_at: s.jstProgress?.submittedAt ?? null }, pos_data: null, ow_data: s,
      });
    }
  }
  return rows;
}

// ── ใบโอน ───────────────────────────────────────────────────────────────
type OwTf = {
  id: string; orderNo: string; status: string; jstAllocationNo?: string | null; createdAt?: string; referenceNo?: string | null;
  appliedOps?: Record<string, string>;
  lines: { sku: string; qty: number; isSerialized?: boolean | null; shippedSerials?: { serialNo: string }[]; receivedSerials?: { serialNo: string }[] }[];
};
type OwEvent = { type: string; at: string; summary?: string; detail?: { step?: string; phase?: string; outcome?: string } };
const EXPECT: Record<TransferStatus | string, string[]> = {
  draft: ["draft"], pending_approval: ["draft", "submitted"], approved: ["submitted", "reviewed", "picklist_created"], picking: ["reviewed", "picklist_created"],
  packed: ["shipped", "sn_moved"], shipped: ["shipped", "sn_moved", "in_transit"], in_transit: ["in_transit"], partial_received: ["in_transit", "received"],
  received: ["received", "closed"], completed: ["closed"], cancelled: ["void"], rejected: ["void"],
};

async function checkTransfers(source: string, limit: number): Promise<ReconRow[]> {
  const sb = supabaseAdmin();
  const recs = await sb.from("pos_ow_transfers").select("pos_transfer_id,transfer_no,from_branch_id,to_branch_id,status,link_state,origin,pos_snapshot,updated_at")
    .eq("source", source).order("updated_at", { ascending: false }).limit(limit);
  if (recs.error) throw new Error("อ่านใบโอนไม่สำเร็จ: " + recs.error.message);
  const lines = await sb.from("pos_ow_transfer_lines").select("pos_transfer_id,ow_id,sku,last_op").eq("source", source).in("pos_transfer_id", (recs.data ?? []).map((r) => r.pos_transfer_id));
  if (lines.error) throw new Error("อ่านใบ OW ย่อยไม่สำเร็จ: " + lines.error.message);
  const rows: ReconRow[] = [];
  await pool(recs.data ?? [], async (rec) => {
    const t = rec.pos_snapshot as Transfer;
    const my = (lines.data ?? []).filter((l) => l.pos_transfer_id === rec.pos_transfer_id);
    const owIds = [...new Set(my.map((l) => l.ow_id as string))];
    const diffs: Diff[] = [];
    const ows: OwTf[] = [], events: OwEvent[] = [];
    if (!owIds.length) {
      rows.push(finalize({ kind: "transfer", ref: rec.transfer_no, branch_id: rec.from_branch_id, diffs: [{ field: "ใบใน OneWarehouse", pos: t.status, ow: "ยังไม่มี", ok: false, note: `สถานะการเชื่อม: ${rec.link_state}` }], times: {}, pos_data: t, ow_data: null }, rec.link_state !== "ok", rec.link_state));
      return;
    }
    for (const id of owIds) {
      // อ่านซ้ำ 1 ครั้งถ้าล้ม (OW ตอบช้า/ชั่วคราว) — ไม่ให้รายงานผิดว่า "อ่านไม่ครบ"
      const get = async <T,>(path: string) => { let r = await owCall<T>("GET", path); if (!r.ok) { await new Promise((ok) => setTimeout(ok, 800)); r = await owCall<T>("GET", path); } return r; };
      const [d, tl] = await Promise.all([get<OwTf>(`transfers/${encodeURIComponent(id)}`), get<{ events: OwEvent[] }>(`transfers/${encodeURIComponent(id)}/timeline`)]);
      if (d.ok && d.data) ows.push(d.data);
      if (tl.ok && tl.data?.events) events.push(...tl.data.events);
    }
    if (ows.length !== owIds.length) { rows.push({ kind: "transfer", ref: rec.transfer_no, branch_id: rec.from_branch_id, status: "pending", summary: "อ่านใบจาก OW ไม่ครบ", diffs: [], times: {}, pos_data: t, ow_data: ows }); return; }
    // สถานะ
    const owStatuses = [...new Set(ows.map((o) => o.status))];
    const exp = EXPECT[t.status] ?? [];
    diffs.push({ field: "สถานะ", pos: t.status, ow: owStatuses.join(", "), ok: owStatuses.every((s) => exp.includes(s)), note: `POS ${t.status} ควรตรงกับ OW: ${exp.join("/") || "—"}` });
    // เลข JST
    const owJst = [...new Set(ows.map((o) => o.jstAllocationNo).filter(Boolean))].join(", ");
    if (owJst || t.jst_allocation_no) diffs.push({ field: "เลข JST allocation", pos: t.jst_allocation_no ?? "—", ow: owJst || "—", jst: owJst || null, ok: (t.jst_allocation_no ?? "") === owJst });
    // รายสินค้า: SN ส่ง/รับ หรือจำนวน
    for (const it of t.items) {
      const ol = ows.flatMap((o) => o.lines).filter((l) => l.sku === it.sku);
      if (!ol.length) { diffs.push({ field: `${it.sku}`, pos: `ขอ ${it.qty_requested}`, ow: "ไม่พบในใบ OW", ok: false }); continue; }
      diffs.push({ field: `${it.sku} · จำนวนขอ`, pos: it.qty_requested, ow: ol.reduce((a, l) => a + Number(l.qty), 0), ok: it.qty_requested === ol.reduce((a, l) => a + Number(l.qty), 0) });
      if (it.isSerialized) {
        const ps = sortJoin((it.shippedSerials ?? []).map((s) => s.serialNo)), os = sortJoin(ol.flatMap((l) => (l.shippedSerials ?? []).map((s) => s.serialNo)));
        const pr = sortJoin((it.receivedSerials ?? []).map((s) => s.serialNo)), orr = sortJoin(ol.flatMap((l) => (l.receivedSerials ?? []).map((s) => s.serialNo)));
        diffs.push({ field: `${it.sku} · SN ส่งออก`, pos: ps || "—", ow: os || "—", ok: ps === os });
        diffs.push({ field: `${it.sku} · SN รับเข้า`, pos: pr || "—", ow: orr || "—", ok: pr === orr, note: (it.quarantinedSerials ?? []).length ? `SN นอกใบ (ไม่ส่ง OW): ${(it.quarantinedSerials ?? []).map((s) => s.serialNo).join(", ")}` : undefined });
      } else if (["completed", "partial_received"].includes(t.status)) {
        // OW ไม่คืนจำนวนรับรายบรรทัดสำหรับสินค้าไม่มี SN — ยืนยันจากสถานะ closed + ผลต่างที่บันทึก
        const short = (t.discrepancies ?? []).filter((d) => d.product_id === it.product_id && d.kind === "short").reduce((a, d) => a + d.qty, 0);
        diffs.push({ field: `${it.sku} · จำนวนรับ`, pos: `${it.qty_received}/${it.qty_shipped}${short ? ` (ขาด ${short})` : ""}`, ow: owStatuses.join(", "), ok: t.status !== "completed" || owStatuses.every((s) => s === "closed"), note: "OW ไม่แสดงจำนวนรับรายบรรทัดของสินค้าไม่มี SN — ยืนยันด้วยสถานะ closed" });
      }
    }
    // คำสั่งที่ POS ยิงสำเร็จ ต้องอยู่ใน appliedOps ของ OW
    const applied = new Set(ows.flatMap((o) => Object.keys(o.appliedOps ?? {})));
    const posOps = my.map((l) => l.last_op as { op?: string; opKey?: string; ok?: boolean } | null).filter((x): x is { op?: string; opKey?: string; ok?: boolean } => !!x?.opKey && !!x.ok);
    const missing = posOps.filter((x) => ![...applied].some((k) => k === x.opKey || k.startsWith(`${x.opKey}:`)));
    if (posOps.length) diffs.push({ field: "คำสั่งล่าสุดที่ OW รับจริง", pos: posOps.map((x) => x.op).join(", "), ow: missing.length ? `ไม่พบ: ${missing.map((x) => x.op).join(", ")}` : "รับครบ", ok: !missing.length });
    // ผล JST จาก timeline
    const sync = events.filter((e) => e.type === "sync");
    const failed = sync.filter((e) => e.detail?.outcome && e.detail.outcome !== "succeeded");
    if (sync.length || ["in_transit", "partial_received", "completed"].includes(t.status)) {
      const phases = sync.map((e) => `${e.detail?.phase}:${e.detail?.outcome}`).join(", ") || "—";
      const needIn = t.status === "completed", needOut = ["in_transit", "partial_received", "completed"].includes(t.status);
      const hasOut = sync.some((e) => e.detail?.phase === "dispatch" && e.detail.outcome === "succeeded");
      const hasIn = sync.some((e) => e.detail?.phase === "confirm_in" && e.detail.outcome === "succeeded");
      diffs.push({ field: "ผล JST (ส่งออก/รับเข้า)", pos: t.status, ow: phases, jst: hasIn ? "รับเข้าแล้ว" : hasOut ? "ส่งออกแล้ว" : "ยังไม่ซิงก์", ok: !failed.length && (!needOut || hasOut) && (!needIn || hasIn) });
    }
    const at = (pred: (e: OwEvent) => boolean) => events.filter(pred).map((e) => e.at).sort()[0] ?? null;
    const owDispatch = at((e) => e.type === "dispatch"), owReceive = at((e) => e.detail?.step === "receive"), owClose = at((e) => e.detail?.step === "close");
    rows.push(finalize({
      kind: "transfer", ref: rec.transfer_no, branch_id: rec.from_branch_id, diffs,
      times: {
        pos_created_at: t.created_at ?? null, ow_created_at: ows.map((o) => o.createdAt ?? "").sort()[0] || null,
        pos_packed_at: t.packed_at ?? null, pos_shipped_at: t.shipped_at ?? null, ow_dispatch_at: owDispatch,
        pos_received_at: t.received_at ?? null, ow_receive_at: owReceive, ow_closed_at: owClose,
        jst_dispatch_sync_at: at((e) => e.type === "sync" && e.detail?.phase === "dispatch"), jst_confirm_in_at: at((e) => e.type === "sync" && e.detail?.phase === "confirm_in"),
      },
      pos_data: { status: t.status, items: t.items, discrepancies: t.discrepancies ?? [], jst: t.jst_allocation_no, link_state: rec.link_state, origin: rec.origin },
      ow_data: { transfers: ows.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status, jst: o.jstAllocationNo, lines: o.lines })), events },
    }, rec.link_state !== "ok" && !diffs.some((d) => !d.ok), rec.link_state));
  }, 3);
  return rows;
}

// ── สต๊อก ───────────────────────────────────────────────────────────────
async function checkStock(source: string): Promise<ReconRow[]> {
  const sb = supabaseAdmin();
  const links = await warehouseLinks();
  const rows: ReconRow[] = [];
  const recent = await sb.from("pos_ow_movements").select("branch_id,product_id,move_key").eq("source", source).gt("applied_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if (recent.error) throw new Error("อ่านบัญชีเคลื่อนไหวไม่สำเร็จ: " + recent.error.message);
  const settling = new Set((recent.data ?? []).filter((m) => !String(m.move_key).startsWith("reconcile")).map((m) => `${m.branch_id}:${m.product_id}`));
  for (const [branchId, wh] of links) {
    // บิลที่ POS ตัดแล้วแต่ JST ยังไม่ตัด (รอส่ง/รอ JST/ถูกปฏิเสธ) → อธิบายส่วนต่างได้ ไม่นับว่าไม่ตรงเฉย ๆ
    const pendSales = await pendingSaleQty(branchId, source);
    const st = await sb.from("stock_levels").select("product_id,qty_on_hand,qty_quarantine,products(sku,name_th)").eq("branch_id", branchId);
    if (st.error) throw new Error("อ่านสต๊อกไม่สำเร็จ: " + st.error.message);
    const list = (st.data ?? []).map((s) => ({ product_id: s.product_id as string, onhand: Number(s.qty_on_hand), quarantine: Number(s.qty_quarantine), sku: (s.products as unknown as { sku: string } | null)?.sku ?? "" })).filter((s) => s.sku && !s.sku.includes(","));
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const r = await owCall<{ sku: string; qty: number }[]>("GET", `stock?${new URLSearchParams({ warehouseId: wh, skus: chunk.map((c) => c.sku).join(",") })}`);
      const om = new Map((r.ok && Array.isArray(r.data) ? r.data : []).map((x) => [x.sku, Number(x.qty)]));
      for (const c of chunk) {
        const ow = om.get(c.sku);
        const pend = settling.has(`${branchId}:${c.product_id}`);
        const unsent = pendSales.get(c.product_id) ?? 0;
        const ok = ow != null && ow === c.onhand;
        const explained = !ok && ow != null && unsent > 0 && ow - unsent === c.onhand;
        if (ow == null && !r.ok) { rows.push({ kind: "stock", ref: `${wh} · ${c.sku}`, branch_id: branchId, status: "pending", summary: "อ่านสต๊อก OW ไม่ได้", diffs: [], times: {}, pos_data: c, ow_data: null }); continue; }
        rows.push({
          kind: "stock", ref: `${wh} · ${c.sku}`, branch_id: branchId,
          status: ok ? "match" : explained || pend ? "pending" : "mismatch",
          summary: ok ? `ตรงกัน ${c.onhand}`
            : explained ? `POS ${c.onhand} / OW ${ow} · ต่างกัน ${unsent} = บิลขายที่ JST ยังไม่ตัด (ดูแท็บ ส่งบิลขาย)`
            : pend ? `POS ${c.onhand} / OW ${ow ?? "—"} · เพิ่งเคลื่อนไหว รอ JST อัปเดต` : `POS ${c.onhand} / OW ${ow ?? "ไม่มี SKU"}`,
          diffs: [{ field: "คงคลัง", pos: c.onhand, ow: ow ?? null, ok: ok || explained, note: [c.quarantine ? `พักตรวจใน POS ${c.quarantine} (OW นับรวมของชำรุด)` : "", unsent ? `บิลขายที่ JST ยังไม่ตัด ${unsent} ชิ้น` : ""].filter(Boolean).join(" · ") || undefined }],
          times: {}, pos_data: c, ow_data: ow ?? null,
        });
      }
    }
  }
  return rows;
}

/** ตรวจทั้งหมดแล้วบันทึกผลรอบนี้ */
export async function runRecon(actorId: string | null, opts: { sales?: number; transfers?: number } = {}) {
  const source = owConfig().source;
  const run = randomUUID();
  const [sales, transfers, stock] = await Promise.all([checkSales(source, opts.sales ?? 100), checkTransfers(source, opts.transfers ?? 100), checkStock(source)]);
  const all = [...sales, ...transfers, ...stock];
  const sb = supabaseAdmin();
  for (let i = 0; i < all.length; i += 200) {
    const { error } = await sb.from("pos_ow_recon_checks").insert(all.slice(i, i + 200).map((r) => ({ source, run_id: run, actor_id: actorId, ...r })));
    if (error) throw new Error("บันทึกผลตรวจไม่สำเร็จ: " + error.message);
  }
  // ใบโอนไม่ตรง → งาน + แจ้งเตือน (ไม่ให้การแจ้งเตือนล้มทำให้ผลตรวจหาย)
  try { await syncTransferIssues(source, all); } catch (e) { console.error("[ow-recon] issues", e instanceof Error ? e.message : e); }
  return { run_id: run, checked_at: new Date().toISOString(), rows: all };
}

/** ผลรอบล่าสุด + ประวัติรอบ */
export async function latestRecon(runId?: string) {
  const source = owConfig().source, sb = supabaseAdmin();
  const runs = await sb.from("pos_ow_recon_checks").select("run_id,checked_at").eq("source", source).order("checked_at", { ascending: false }).limit(2000);
  if (runs.error) throw new Error("อ่านประวัติการตรวจไม่สำเร็จ");
  const seen = new Map<string, string>();
  for (const r of runs.data ?? []) if (!seen.has(r.run_id)) seen.set(r.run_id, r.checked_at);
  const id = runId && seen.has(runId) ? runId : [...seen.keys()][0];
  if (!id) return { run_id: null, checked_at: null, rows: [], runs: [] };
  const rows = await sb.from("pos_ow_recon_checks").select("kind,ref,branch_id,status,summary,diffs,times,pos_data,ow_data").eq("source", source).eq("run_id", id).order("kind").order("ref", { ascending: false });
  if (rows.error) throw new Error("อ่านผลตรวจไม่สำเร็จ");
  return { run_id: id, checked_at: seen.get(id) ?? null, rows: rows.data ?? [], runs: [...seen].slice(0, 30).map(([run_id, checked_at]) => ({ run_id, checked_at })) };
}
