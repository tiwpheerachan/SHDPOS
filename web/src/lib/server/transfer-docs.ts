// เอกสารของใบโอนย้าย (ข้อมูลจริงจาก pos_ow_transfers.pos_snapshot) — ใช้ระบบเอกสารเดียวกับบิล (/doc/[token])
//   transfer_out  ใบโอน/ใบส่งสินค้า (Delivery note)  · transfer_in  ใบรับสินค้า (Goods received)  · transfer_diff  รายงานผลต่าง
//   เอกสารภายใน: ต้องล็อกอิน + สิทธิ์ transfer.request + อยู่สาขาต้นทาง/ปลายทาง (ตรวจที่ /api/doc/[token])
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "./ow-gateway";
import { fmt, type Row } from "./order-trace";
import { seller, docUrl } from "./order-docs";
import type { DocPayload, OrderDocItem } from "@/lib/doc-types";

const STATUS_TH: Record<string, string> = { draft: "ร่าง", pending_approval: "รออนุมัติ", approved: "อนุมัติแล้ว", picking: "กำลังจัด", packed: "แพ็กแล้ว", shipped: "จัดส่งแล้ว", in_transit: "ระหว่างทาง", partial_received: "รับบางส่วน", received: "รับครบ", completed: "เสร็จสิ้น", cancelled: "ยกเลิก", rejected: "ปฏิเสธ" };
const DISC_TH: Record<string, string> = { short: "ขาด", over: "เกิน", damaged: "ชำรุด", lost: "สูญหาย", wrong_sn: "SN ผิด", unexpected_sn: "SN นอกใบโอน" };
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" }) : "—");

export async function loadTransfer(posId: string): Promise<{ t: Row; from: Row | null; to: Row | null; names: Map<string, string> } | null> {
  const sb = supabaseAdmin();
  let source: string;
  try { source = owConfig().source; } catch { return null; }
  const { data } = await sb.from("pos_ow_transfers").select("pos_snapshot,from_branch_id,to_branch_id").eq("source", source).eq("pos_transfer_id", posId).maybeSingle();
  if (!data?.pos_snapshot) return null;
  const t = data.pos_snapshot as Row;
  const [br, ] = await Promise.all([sb.from("branches").select("id,code,name,name_th,address,district,province,postcode,phone,tax_branch_no").in("id", [data.from_branch_id, data.to_branch_id].filter(Boolean))]);
  const ids = [t.requested_by, t.approved_by, t.packed_by, t.received_by, ...((t.receipts ?? []) as Row[]).map((r) => r.by)].filter(Boolean) as string[];
  const emps = ids.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", [...new Set(ids)])).data ?? []) as Row[] : [];
  const names = new Map(emps.map((e) => [e.id as string, [e.first_name, e.last_name].filter(Boolean).join(" ") || (e.nickname as string)]));
  const b = (id: string) => ((br.data ?? []) as Row[]).find((x) => x.id === id) ?? null;
  return { t, from: b(data.from_branch_id), to: b(data.to_branch_id), names };
}

export function listTransferDocs(t: Row): OrderDocItem[] {
  const out: OrderDocItem[] = [];
  out.push({ kind: "transfer_out", key: `tout:${t.id}`, title: "ใบโอน / ใบส่งสินค้า", doc_no: t.transfer_no, stage: "ship", available: true, internal: true, url: docUrl("transfer_out", t.id), status: t.status, at: t.created_at });
  const rc = (t.receipts ?? []) as Row[];
  out.push({ kind: "transfer_in", key: `tin:${t.id}`, title: "ใบรับสินค้า", doc_no: t.transfer_no, stage: "receive", available: rc.length > 0, internal: true, url: rc.length ? docUrl("transfer_in", t.id) : null, reason: rc.length ? `${rc.length} รอบรับ` : "ยังไม่ได้รับเข้า" });
  const dc = (t.discrepancies ?? []) as Row[];
  if (dc.length) out.push({ kind: "transfer_diff", key: `tdiff:${t.id}`, title: "รายงานผลต่างการรับ", doc_no: t.transfer_no, stage: "receive", available: true, internal: true, url: docUrl("transfer_diff", t.id), reason: `${dc.length} รายการ · เปิดอยู่ ${dc.filter((d) => d.status === "open").length}` });
  return out;
}

const party = (label: string, b: Row | null): DocPayload["party"] => (b ? { label, name: `${b.code ?? ""} · ${b.name_th || b.name}`, address: [b.address, b.district, b.province, b.postcode].filter(Boolean).join(" ") || null, phone: b.phone ?? null } : null);

export async function buildTransferDoc(kind: "transfer_out" | "transfer_in" | "transfer_diff", posId: string): Promise<{ doc: DocPayload; branch_ids: string[] } | null> {
  const x = await loadTransfer(posId);
  if (!x) return null;
  const { t, from, to, names } = x;
  const who = (id?: string | null) => (id ? names.get(id) ?? "—" : "—");
  const items = (t.items ?? []) as Row[];
  const sku = (pid: string) => items.find((i) => i.product_id === pid);
  const base = {
    doc_no: t.transfer_no as string, internal: true, seller: seller(from),
    watermark: t.status === "cancelled" ? "ยกเลิก" : t.status === "rejected" ? "ปฏิเสธ" : null,
  };
  const branch_ids = [t.from_branch_id, t.to_branch_id].filter(Boolean) as string[];
  const ow = Object.values((t.ow_state ?? {}) as Record<string, Row>);
  if (kind === "transfer_out") {
    return { branch_ids, doc: { ...base, kind, title: "ใบโอนย้าย / ใบส่งสินค้า", title_en: "TRANSFER / DELIVERY NOTE", date: day(t.created_at),
      party: party("ส่งถึง (ปลายทาง)", to),
      refs: [{ label: "เลขที่", value: t.transfer_no }, { label: "สถานะ", value: STATUS_TH[t.status] ?? t.status }, { label: "ต้นทาง", value: from ? `${from.code} · ${from.name_th || from.name}` : "—" },
        ...(t.jst_allocation_no || ow.some((o) => o.jstAllocationNo) ? [{ label: "เลขจัดสรร JST", value: String(t.jst_allocation_no ?? ow.map((o) => o.jstAllocationNo).filter(Boolean).join(", ")) }] : []),
        ...(t.carrier ? [{ label: "ขนส่ง", value: `${t.carrier}${t.tracking ? ` · ${t.tracking}` : ""}` }] : [])],
      table: { columns: [{ label: "สินค้า" }, { label: "ขอ", align: "right", width: "55px" }, { label: "ส่ง", align: "right", width: "55px" }, { label: "SN ที่ส่ง" }],
        rows: items.map((i) => ({ cells: [String(i.name), String(i.qty_requested ?? 0), String(i.qty_shipped ?? 0), ((i.shippedSerials ?? []) as Row[]).map((s) => s.serialNo).join(", ") || (i.isSerialized ? "—" : "ไม่ใช้ SN")], sub: i.sku })) },
      notes: [t.note ? `หมายเหตุ: ${t.note}` : "", `ขอโดย ${who(t.requested_by)}${t.approved_by ? ` · อนุมัติโดย ${who(t.approved_by)}` : ""}${t.packed_by ? ` · แพ็ก/สแกนออกโดย ${who(t.packed_by)} ${fmt(t.packed_at)}` : ""}`].filter(Boolean),
      signatures: ["ผู้ส่ง (ต้นทาง)", "ผู้ขนส่ง", "ผู้รับ (ปลายทาง)"],
    } };
  }
  if (kind === "transfer_in") {
    const rc = (t.receipts ?? []) as Row[];
    return { branch_ids, doc: { ...base, kind, title: "ใบรับสินค้า", title_en: "GOODS RECEIVED NOTE", date: day(t.received_at ?? rc.at(-1)?.at ?? t.created_at),
      party: party("รับจาก (ต้นทาง)", from), seller: seller(to),
      refs: [{ label: "อ้างอิงใบโอน", value: t.transfer_no }, { label: "สถานะ", value: STATUS_TH[t.status] ?? t.status }, { label: "รับเข้ารอบ", value: `${rc.length} รอบ` }],
      table: { columns: [{ label: "รอบรับ / สินค้า" }, { label: "จำนวน", align: "right", width: "60px" }, { label: "SN ที่รับ" }, { label: "ผู้รับ", width: "130px" }],
        rows: rc.flatMap((r, n) => ((r.lines ?? []) as Row[]).map((l) => ({ cells: [`รอบ ${n + 1} · ${sku(l.product_id)?.name ?? l.product_id}`, String(l.qty), ((l.serials ?? []) as string[]).join(", ") || "—", `${who(r.by)}\n${fmt(r.at)}`], sub: sku(l.product_id)?.sku ?? "" }))) },
      totals: items.map((i) => ({ label: `${i.sku} ส่ง ${i.qty_shipped ?? 0} · รับ ${i.qty_received ?? 0}`, value: Number(i.qty_received ?? 0) === Number(i.qty_shipped ?? 0) ? "ครบ" : `ต่าง ${Number(i.qty_received ?? 0) - Number(i.qty_shipped ?? 0)}` })),
      notes: [((t.discrepancies ?? []) as Row[]).length ? "มีผลต่างการรับ — ดูรายงานผลต่าง" : "รับครบตามใบส่ง"],
      signatures: ["ผู้ส่ง / ผู้ขนส่ง", "ผู้รับ (ปลายทาง)"],
    } };
  }
  const dc = (t.discrepancies ?? []) as Row[];
  return { branch_ids, doc: { ...base, kind, title: "รายงานผลต่างการรับสินค้า", title_en: "RECEIVING DISCREPANCY REPORT", date: day(dc[0]?.at ?? t.created_at),
    party: party("ปลายทาง", to),
    refs: [{ label: "อ้างอิงใบโอน", value: t.transfer_no }, { label: "ต้นทาง", value: from ? `${from.code} · ${from.name_th || from.name}` : "—" }, { label: "ผลต่าง", value: `${dc.length} รายการ` }, { label: "ยังเปิดอยู่", value: String(dc.filter((d) => d.status === "open").length) }],
    table: { columns: [{ label: "สินค้า" }, { label: "ประเภท", width: "95px" }, { label: "จำนวน", align: "right", width: "55px" }, { label: "SN", width: "120px" }, { label: "สถานะ / ผลสรุป", width: "150px" }],
      rows: dc.map((d) => ({ cells: [String(sku(d.product_id)?.name ?? d.product_id), DISC_TH[d.kind] ?? d.kind, String(d.qty ?? 1), d.serialNo ?? "—", `${d.status === "open" ? "เปิดอยู่" : d.status === "resolved" ? "ปิดแล้ว" : d.status ?? "—"}${d.resolution ? ` · ${d.resolution}` : ""}${d.replacement_no ? ` · ส่งทดแทน ${d.replacement_no}` : ""}`], sub: [sku(d.product_id)?.sku, d.note].filter(Boolean).join(" · ") })) },
    notes: ["ของที่ชำรุด/SN นอกใบโอน อยู่ในโซนพักตรวจที่ปลายทาง จนกว่าจะปิดเคส"],
    signatures: ["ผู้รายงาน (ปลายทาง)", "ผู้ตรวจสอบ"],
  } };
}
