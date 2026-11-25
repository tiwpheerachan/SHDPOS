// เอกสารของบิล — สร้างจากข้อมูลจริงในระบบกลาง (อ่านอย่างเดียว) · ใช้กับหน้าเอกสาร /doc/[token] (พิมพ์/PDF/แชร์)
//   receipt     ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ        (ขั้น ชำระเงิน)
//   tax_invoice ใบกำกับภาษีเต็มรูป (ออกตามคำขอ · 0068)     (ขั้น ชำระเงิน)
//   warranty    ใบรับประกันสินค้า (SN + วันหมดประกัน)       (ขั้น สต๊อก/SN)
//   return      ใบรับคืน/ใบคืนเงิน · ใบลดหนี้ · ใบยกเลิกบิล  (ขั้น หลังการขาย)
//   trace       รายงานที่มาของบิล (ภายใน ต้องล็อกอิน)       (ทุกขั้น)
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildOrderTrace, loadOrder, baht, fmt, type Row } from "./order-trace";
import { signDocToken, type DocKind } from "./doc-token";
import type { DocPayload, OrderDocItem } from "@/lib/doc-types";

const METHOD: Record<string, string> = { cash: "เงินสด", credit_card: "บัตรเครดิต", debit_card: "บัตรเดบิต", qr_promptpay: "พร้อมเพย์", bank_transfer: "โอนเงิน", edc: "EDC", gift: "บัตรของขวัญ" };
export const branchLabel = (no?: string | null) => (!no || /^0+$/.test(no) ? "สำนักงานใหญ่" : `สาขาที่ ${String(no).padStart(5, "0")}`);
const maskPhone = (p?: string | null) => (p ? p.replace(/\D/g, "").replace(/^(\d{2})\d+(\d{4})$/, "$1x-xxx-$2") : null);
const num = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" }) : "—");

/** ข้อมูลผู้ขาย — ตั้งใน env (Render): NEXT_PUBLIC_COMPANY_NAME, NEXT_PUBLIC_COMPANY_TAX_ID, COMPANY_NAME_EN, COMPANY_ADDRESS, COMPANY_PHONE */
export function seller(branch: Row | null): DocPayload["seller"] {
  const addr = [branch?.address, branch?.district, branch?.province, branch?.postcode].filter(Boolean).join(" ");
  return {
    name: process.env.NEXT_PUBLIC_COMPANY_NAME || "บริษัท เอส เอช ดี เทคโนโลยี จำกัด",
    name_en: process.env.COMPANY_NAME_EN || null,
    tax_id: process.env.NEXT_PUBLIC_COMPANY_TAX_ID || null,
    branch_label: `${branchLabel(branch?.tax_branch_no)}${branch ? ` · ${branch.name_th || branch.name}` : ""}`,
    address: addr || process.env.COMPANY_ADDRESS || null,
    phone: branch?.phone || process.env.COMPANY_PHONE || null,
  };
}

export function docUrl(kind: DocKind, id: string): string { return `/doc/${signDocToken(kind, id)}`; }

/** รายการเอกสารทั้งหมดของบิล จัดตามขั้นในแผนภาพ */
export async function listOrderDocs(o: Row): Promise<OrderDocItem[]> {
  const sb = supabaseAdmin();
  const [tis, rets, items] = await Promise.all([
    sb.from("tax_invoices").select("id,invoice_no,status,issued_at,cancel_reason").eq("order_id", o.id).order("issued_at"),
    sb.from("returns").select("id,return_no,kind,type,status,created_at").eq("order_id", o.id).order("created_at"),
    sb.from("order_items").select("kind,order_item_serials(serial_no)").eq("order_id", o.id),
  ]);
  const out: OrderDocItem[] = [];
  out.push({ kind: "receipt", key: `receipt:${o.client_uuid}`, title: "ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ", doc_no: o.order_no, stage: "payment", available: true, url: docUrl("receipt", o.client_uuid), status: o.status, at: o.created_at });
  const tiRows = (tis.data ?? []) as Row[];
  for (const t of tiRows) out.push({ kind: "tax_invoice", key: `ti:${t.id}`, title: "ใบกำกับภาษีเต็มรูป", doc_no: t.invoice_no, stage: "payment", available: true, url: docUrl("tax_invoice", t.id), status: t.status, at: t.issued_at, reason: t.status === "cancelled" ? `ยกเลิกแล้ว${t.cancel_reason ? ` · ${t.cancel_reason}` : ""}` : null });
  if (!tiRows.some((t) => t.status === "issued")) out.push({ kind: "tax_invoice", key: "ti:new", title: "ใบกำกับภาษีเต็มรูป", doc_no: null, stage: "payment", available: false,
    reason: ["completed", "partially_refunded"].includes(o.status) ? "ยังไม่ได้ออก — ออกได้ตามคำขอลูกค้า" : "บิลถูกยกเลิก/คืนครบแล้ว ออกไม่ได้" });
  const goods = ((items.data ?? []) as Row[]).filter((i) => i.kind !== "service" && i.kind !== "fee");
  out.push({ kind: "warranty", key: `warranty:${o.client_uuid}`, title: "ใบรับประกันสินค้า", doc_no: o.order_no, stage: "stock", available: goods.length > 0 && o.status !== "voided",
    reason: !goods.length ? "บิลนี้ไม่มีสินค้าที่รับประกัน" : o.status === "voided" ? "บิลถูกยกเลิก" : `${goods.reduce((n, i) => n + ((i.order_item_serials ?? []) as Row[]).length, 0)} SN`, url: goods.length && o.status !== "voided" ? docUrl("warranty", o.client_uuid) : null });
  const hasTi = tiRows.some((t) => t.status === "issued");
  for (const r of (rets.data ?? []) as Row[]) out.push({ kind: "return", key: `return:${r.id}`, stage: "after", available: true, url: docUrl("return", r.id), doc_no: r.return_no, status: r.status, at: r.created_at,
    title: r.kind === "void" ? "ใบยกเลิกบิล" : hasTi ? "ใบลดหนี้" : r.type === "claim" ? "ใบรับเคลมสินค้า" : "ใบรับคืนสินค้า / ใบคืนเงิน",
    reason: r.status === "pending_approval" ? "รออนุมัติ" : r.status === "rejected" ? "ไม่อนุมัติ" : null });
  out.push({ kind: "trace", key: `trace:${o.client_uuid}`, title: "รายงานที่มาของบิล (ภายใน)", doc_no: o.order_no, stage: "all", available: true, internal: true, url: docUrl("trace", o.client_uuid) });
  return out;
}

/** สร้างเอกสาร 1 ใบ — คืน branch_id ให้ผู้เรียกตรวจสิทธิ์สาขา (กรณีเอกสารภายใน) */
export async function buildDoc(kind: DocKind, id: string): Promise<{ doc: DocPayload; branch_id: string } | null> {
  const sb = supabaseAdmin();
  if (kind === "tax_invoice") {
    const { data: ti } = await sb.from("tax_invoices").select("*").eq("id", id).maybeSingle();
    if (!ti) return null;
    const o = await loadOrder({ id: ti.order_id }); if (!o) return null;
    const t = await buildOrderTrace(o, false);
    const b = ti.buyer as Row;
    const prev = ti.replaces_id ? (await sb.from("tax_invoices").select("invoice_no").eq("id", ti.replaces_id).maybeSingle()).data : null;
    return { branch_id: o.branch_id, doc: {
      kind, title: "ใบกำกับภาษี / ใบเสร็จรับเงิน", title_en: "TAX INVOICE / RECEIPT", subtitle: "ต้นฉบับ (เอกสารออกเป็นชุด)",
      doc_no: ti.invoice_no, date: day(ti.issued_at), watermark: ti.status === "cancelled" ? "ยกเลิก" : null,
      seller: seller(t.raw.branch),
      party: { label: "ผู้ซื้อ", name: b.name, tax_id: b.tax_id, branch_label: branchLabel(b.branch_no), address: b.address, phone: b.phone ?? null },
      refs: [{ label: "เลขที่", value: ti.invoice_no }, { label: "วันที่", value: day(ti.issued_at) }, { label: "อ้างอิงบิลขาย", value: o.order_no }, { label: "วันที่ขาย", value: day(o.sale_occurred_at ?? o.created_at) },
        ...(prev ? [{ label: "ออกแทนใบเลขที่", value: String(prev.invoice_no) }] : [])],
      table: itemsTable(t.raw.items),
      totals: tiTotals(t.raw.items, ti),
      payments: payRows(t.raw.payments),
      notes: [ti.status === "cancelled" ? `ใบนี้ถูกยกเลิกแล้ว${ti.cancel_reason ? `: ${ti.cancel_reason}` : ""}` : "", "เอกสารนี้ออกโดยระบบคอมพิวเตอร์"].filter(Boolean),
      signatures: ["ผู้รับเงิน", "ผู้มีอำนาจลงนาม"], issued_by: t.raw.who(ti.issued_by),
    } };
  }
  if (kind === "return") {
    const { data: r } = await sb.from("returns").select("*,return_items(sku,name,qty,line_total,condition,serials)").eq("id", id).maybeSingle();
    if (!r) return null;
    const o = await loadOrder({ id: r.order_id }); if (!o) return null;
    const t = await buildOrderTrace(o, false);
    const ti = (await sb.from("tax_invoices").select("invoice_no,amount_total").eq("order_id", o.id).eq("status", "issued").maybeSingle()).data;
    const isVoid = r.kind === "void";
    const title = isVoid ? "ใบยกเลิกบิล" : ti ? "ใบลดหนี้" : r.type === "claim" ? "ใบรับเคลมสินค้า" : "ใบรับคืนสินค้า / ใบคืนเงิน";
    const amt = Number(r.refund_amount), vat = Math.round((amt - amt / 1.07) * 100) / 100;
    return { branch_id: o.branch_id, doc: {
      kind, title, title_en: isVoid ? "VOID NOTE" : ti ? "CREDIT NOTE" : r.type === "claim" ? "CLAIM RECEIPT" : "RETURN / REFUND NOTE",
      doc_no: r.return_no, date: day(r.approved_at ?? r.created_at),
      watermark: r.status === "pending_approval" ? "รออนุมัติ" : r.status === "rejected" ? "ไม่อนุมัติ" : null,
      seller: seller(t.raw.branch),
      party: customerParty(t.raw.customer, o, true),
      refs: [{ label: "เลขที่", value: r.return_no }, { label: "อ้างอิงบิลขาย", value: o.order_no }, { label: "วันที่ขาย", value: day(o.sale_occurred_at ?? o.created_at) },
        ...(ti ? [{ label: "อ้างอิงใบกำกับภาษี", value: String(ti.invoice_no) }] : []),
        { label: "เหตุผล", value: [r.reason_code, r.reason_note].filter(Boolean).join(" · ") || "—" }],
      table: { columns: [{ label: "รายการ" }, { label: "SN" }, { label: "จำนวน", align: "right", width: "70px" }, { label: "สภาพ", width: "90px" }, { label: "มูลค่าคืน", align: "right", width: "110px" }],
        rows: ((r.return_items ?? []) as Row[]).map((i) => ({ cells: [`${i.name}`, (i.serials ?? []).join(", ") || "—", String(Number(i.qty)), i.condition === "defective" ? "ชำรุด" : "ขายได้", num(i.line_total)], sub: i.sku })) },
      totals: [
        ...(ti ? [{ label: "มูลค่าตามใบกำกับภาษีเดิม", value: num(ti.amount_total) }, { label: "มูลค่าที่ถูกต้อง", value: num(Number(ti.amount_total) - amt) }] : []),
        { label: ti ? "ผลต่าง (ลดหนี้) ไม่รวม VAT" : "มูลค่าไม่รวม VAT", value: num(amt - vat) }, { label: "ภาษีมูลค่าเพิ่ม 7%", value: num(vat) },
        { label: isVoid ? "ยอดคืนเงิน (ยกเลิกทั้งบิล)" : r.type === "claim" ? "ยอดคืนเงิน (เคลม ไม่คืนเงิน)" : "ยอดคืนเงินรวม", value: num(amt), strong: true }],
      payments: r.refund_method && amt > 0 ? [{ label: `คืนเงินทาง ${METHOD[r.refund_method] ?? r.refund_method}`, value: num(amt) }] : [],
      notes: [r.status === "completed" && r.jst_state === "pending" ? "สินค้าคืนเข้าคลังกลางหลังทีมคลังทำรับคืนใน JST" : "", r.points_reversed ? `หักแต้มสะสม ${r.points_reversed} แต้ม` : ""].filter(Boolean),
      signatures: ["ผู้รับคืน", "ลูกค้า / ผู้รับเงินคืน"], issued_by: t.raw.who(r.approved_by ?? r.requested_by),
    } };
  }
  // ใบที่อ้างบิลโดยตรง (receipt / warranty / trace)
  const o = await loadOrder({ client_uuid: id }); if (!o) return null;
  const t = await buildOrderTrace(o, false);
  const s = seller(t.raw.branch);
  if (kind === "receipt") {
    const gross = t.raw.items.reduce((n, i) => n + Number(i.unit_price) * Number(i.qty), 0);
    const ti = (await sb.from("tax_invoices").select("invoice_no").eq("order_id", o.id).eq("status", "issued").maybeSingle()).data;
    return { branch_id: o.branch_id, doc: {
      kind, title: "ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ", title_en: "RECEIPT / ABB. TAX INVOICE",
      doc_no: o.order_no, date: day(o.sale_occurred_at ?? o.created_at),
      watermark: o.status === "voided" ? "ยกเลิก" : o.status === "refunded" ? "คืนสินค้าแล้ว" : null,
      seller: s, party: customerParty(t.raw.customer, o, true),
      refs: [{ label: "เลขที่", value: o.order_no }, { label: "วันที่/เวลา", value: fmt(o.sale_occurred_at ?? o.created_at) }, { label: "แคชเชียร์", value: t.raw.who(o.cashier_id) ?? "—" },
        ...(o.salesperson_id && o.salesperson_id !== o.cashier_id ? [{ label: "พนักงานขาย", value: t.raw.who(o.salesperson_id) ?? "—" }] : [])],
      table: itemsTable(t.raw.items),
      totals: [{ label: "รวมราคาสินค้า", value: num(gross) }, ...(Number(o.discount_total) > 0 ? [{ label: "ส่วนลด", value: `−${num(o.discount_total)}` }] : []),
        { label: "ยอดสุทธิ (รวม VAT)", value: num(o.grand_total), strong: true }, { label: "มูลค่าก่อน VAT", value: num(Number(o.grand_total) - Number(o.vat_amount)) }, { label: "ภาษีมูลค่าเพิ่ม 7%", value: num(o.vat_amount) }],
      payments: [...payRows(t.raw.payments), ...(Number(o.change_amount) > 0 ? [{ label: "เงินทอน", value: num(o.change_amount) }] : [])],
      notes: [ti ? `ออกใบกำกับภาษีเต็มรูปแล้ว เลขที่ ${ti.invoice_no}` : "ต้องการใบกำกับภาษีเต็มรูป ติดต่อสาขาพร้อมบิลนี้", o.status === "partially_refunded" ? "บิลนี้มีการคืนสินค้าบางส่วน" : "", "ราคารวมภาษีมูลค่าเพิ่มแล้ว · ขอบคุณที่ใช้บริการ"].filter(Boolean),
    } };
  }
  if (kind === "warranty") {
    const pids = [...new Set(t.raw.items.map((i) => i.product_id).filter(Boolean))] as string[];
    const prods = pids.length ? ((await sb.from("products").select("id,warranty_months").in("id", pids)).data ?? []) as Row[] : [];
    const start = new Date(o.sale_occurred_at ?? o.created_at);
    const rows = t.raw.items.filter((i) => i.kind !== "service" && i.kind !== "fee").flatMap((i) => {
      const m = Number(prods.find((p) => p.id === i.product_id)?.warranty_months ?? 12);
      const end = new Date(start); end.setMonth(end.getMonth() + m);
      const sns = ((i.order_item_serials ?? []) as Row[]).map((x) => String(x.serial_no));
      const returned = Number(i.returned_qty ?? 0) > 0;
      const base = { muted: returned };
      return (sns.length ? sns : [null]).map((sn) => ({ ...base, cells: [String(i.name), sn ?? "—", sns.length ? "1" : String(Number(i.qty)), m > 0 ? `${m} เดือน` : "ไม่มีประกัน", m > 0 ? day(end.toISOString()) : "—"], sub: `${i.sku}${returned ? " · มีการคืนสินค้า" : ""}` }));
    });
    return { branch_id: o.branch_id, doc: {
      kind, title: "ใบรับประกันสินค้า", title_en: "WARRANTY CARD", doc_no: o.order_no, date: day(start.toISOString()),
      watermark: o.status === "voided" ? "ยกเลิก" : null, seller: s, party: customerParty(t.raw.customer, o, true),
      refs: [{ label: "อ้างอิงบิลขาย", value: o.order_no }, { label: "วันที่เริ่มประกัน", value: day(start.toISOString()) }],
      table: { columns: [{ label: "สินค้า" }, { label: "หมายเลขเครื่อง (SN)" }, { label: "จำนวน", align: "right", width: "60px" }, { label: "ระยะประกัน", width: "90px" }, { label: "หมดประกัน", width: "120px" }], rows },
      notes: ["การรับประกันครอบคลุมความเสียหายจากการผลิตตามเงื่อนไขของผู้ผลิต ไม่รวมความเสียหายจากการใช้งานผิดวิธี ตกหล่น หรือน้ำเข้า", "กรุณาเก็บเอกสารนี้หรือลิงก์นี้ไว้ แสดงพร้อม SN เมื่อใช้สิทธิ์รับประกัน"],
    } };
  }
  // trace (ภายใน)
  return { branch_id: o.branch_id, doc: {
    kind: "trace", title: "รายงานที่มาของบิล", title_en: "ORDER TRACE REPORT", doc_no: o.order_no, date: fmt(new Date().toISOString()), internal: true,
    seller: s, refs: [{ label: "บิล", value: o.order_no }, { label: "สถานะ", value: o.status }, { label: "ยอดสุทธิ", value: baht(o.grand_total) }, { label: "พิมพ์เมื่อ", value: fmt(new Date().toISOString()) }],
    sections: t.stages.map((st) => ({ title: `${st.title} — ${st.summary}`, tone: st.status, lines: [...st.details.map((d) => ({ label: d.label, value: d.value })), ...(st.items ?? []).map((it) => ({ label: it.title, value: [it.value, ...(it.lines ?? [])].filter(Boolean).join(" · ") }))] })),
    table: { columns: [{ label: "เวลา", width: "150px" }, { label: "เหตุการณ์" }, { label: "โดย", width: "160px" }], rows: t.timeline.map((e) => ({ cells: [fmt(e.at), e.label, e.by ?? "—"] })) },
    notes: ["เอกสารภายใน — ห้ามส่งให้ลูกค้า"],
  } };
}

// ยอดในใบกำกับต้องกระทบกับตาราง: รวมรายการ − ส่วนลดท้ายบิล (คูปอง/แต้ม/ส่วนลดรวม) = ยอดรวม → แยก VAT
function tiTotals(items: Row[], ti: Row): DocPayload["totals"] {
  const lines = items.reduce((n, i) => n + Number(i.line_total), 0);
  const billDisc = Math.round((lines - Number(ti.amount_total)) * 100) / 100;
  return [
    { label: "รวมเงินตามรายการ", value: num(lines) },
    ...(billDisc > 0.009 ? [{ label: "ส่วนลดท้ายบิล", value: `−${num(billDisc)}` }] : []),
    { label: "มูลค่าสินค้า/บริการ (ไม่รวม VAT)", value: num(ti.amount_before_vat) },
    { label: "ภาษีมูลค่าเพิ่ม 7%", value: num(ti.amount_vat) },
    { label: "จำนวนเงินรวมทั้งสิ้น", value: num(ti.amount_total), strong: true },
  ];
}

function itemsTable(items: Row[]): DocPayload["table"] {
  return {
    columns: [{ label: "รายการ" }, { label: "จำนวน", align: "right", width: "60px" }, { label: "ราคา/หน่วย", align: "right", width: "100px" }, { label: "ส่วนลด", align: "right", width: "90px" }, { label: "จำนวนเงิน", align: "right", width: "110px" }],
    rows: items.map((i) => ({ cells: [`${i.name}${i.is_gift ? " (ของแถม)" : ""}`, String(Number(i.qty)), num(i.unit_price), Number(i.discount_amount) > 0 ? num(i.discount_amount) : "—", num(i.line_total)],
      sub: [i.sku, ((i.order_item_serials ?? []) as Row[]).length ? `SN ${((i.order_item_serials ?? []) as Row[]).map((s) => s.serial_no).join(", ")}` : ""].filter(Boolean).join(" · ") })),
  };
}
function payRows(ps: Row[]) { return ps.map((p) => ({ label: `${METHOD[p.method] ?? p.method}${p.card_last4 ? ` ••${p.card_last4}` : ""}${p.approval_code ? ` · อนุมัติ ${p.approval_code}` : ""}${p.reference_no ? ` · อ้างอิง ${p.reference_no}` : ""}`, value: num(p.amount) })); }
function customerParty(c: Row | null, o: Row, mask: boolean): DocPayload["party"] {
  const name = c?.name ?? o.customer_name; if (!name) return null;
  const phone = c?.phone ?? o.customer_phone;
  return { label: "ลูกค้า", name, phone: mask ? maskPhone(phone) : phone, tax_id: null, address: null };
}
