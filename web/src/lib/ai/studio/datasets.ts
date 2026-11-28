// =====================================================================
// AI Studio — สร้างชุดข้อมูลจากข้อมูลจริงในระบบ (ยอดขายรายบิล · รายสินค้า · สต๊อก · ลูกค้า) + สรุปโครงข้อมูลให้ AI
//   เวลาเก็บเป็นวันที่ไทย (YYYY-MM-DD) + ชั่วโมง/วันในสัปดาห์คำนวณไว้แล้ว · ข้อมูลลูกค้า (ชื่อ/เบอร์) ไม่อยู่ในชุดข้อมูล
// =====================================================================
import type { Branch, Brand, Employee, Order, Product, StockLevel } from "@/lib/types";
import type { Dataset, Field, Row } from "./types";

const BKK = 7 * 3600_000;
const bkk = (iso: string) => new Date(new Date(iso).getTime() + BKK);
const ymd = (iso: string) => bkk(iso).toISOString().slice(0, 10);
const WD = ["0-อา", "1-จ", "2-อ", "3-พ", "4-พฤ", "5-ศ", "6-ส"];
const PAY_TH: Record<string, string> = { cash: "เงินสด", credit_card: "บัตรเครดิต", debit_card: "บัตรเดบิต", qr_promptpay: "พร้อมเพย์", bank_transfer: "โอนเงิน", edc: "EDC", installment: "ผ่อนชำระ", gift_card: "บัตรของขวัญ", store_credit: "เครดิตร้าน", online_marketplace: "มาร์เก็ตเพลส", online_payment: "ชำระออนไลน์", unspecified: "ไม่ระบุ", other: "อื่น ๆ" };
const CH_TH: Record<string, string> = { offline: "หน้าร้าน", online_shopee: "Shopee", online_lazada: "Lazada", online_tiktok: "TikTok", online_website: "เว็บไซต์", event: "อีเวนต์", b2b: "ขายส่ง", other: "อื่น ๆ" };
const ST_TH: Record<string, string> = { completed: "ขายแล้ว", partially_refunded: "คืนบางส่วน", refunded: "คืนครบ", voided: "ยกเลิก" };

export type Ref = { branches: Branch[]; brands: Brand[]; employees: Employee[]; products: Product[]; categories?: { id: string; name_th: string }[] };
function lookups(ref: Ref) {
  const br = new Map(ref.branches.map((b) => [b.id, b]));
  const bn = new Map(ref.brands.map((b) => [b.id, b.name]));
  const em = new Map(ref.employees.map((e) => [e.id, e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ")]));
  const pr = new Map(ref.products.map((p) => [p.id, p]));
  const cat = new Map((ref.categories ?? []).map((c) => [c.id, c.name_th]));
  const branchName = (id: string) => { const b = br.get(id); return b ? b.name_th ?? b.name : id.startsWith("lark:") ? "ร้าน/อีเวนต์ระบบเดิม" : "—"; };
  return { br, bn, em, pr, cat, branchName };
}

const F = (key: string, label: string, type: Field["type"], role: Field["role"], unit?: Field["unit"], description?: string): Field => ({ key, label, type, role, unit, description });

/** ยอดขายรายบิล — current = ช่วงที่เลือก · ก่อนหน้า = ช่วงก่อนยาวเท่ากัน (ถ้ามีแถว) */
export function salesBills(orders: Order[], ref: Ref, range: { from: Date; to: Date }, prev: { from: Date; to: Date } | null, opts: { cost: boolean; id?: string; label?: string }): Dataset {
  const L = lookups(ref);
  const rows: Row[] = orders.map((o) => {
    const at = (o as Order & { sale_occurred_at?: string }).sale_occurred_at || o.created_at;
    const goods = o.items.filter((i) => !i.is_gift);
    const firstBrand = goods.find((i) => i.brand_id)?.brand_id ?? L.br.get(o.branch_id)?.brand_id ?? null;
    const sold = o.status === "completed" || o.status === "partially_refunded";
    return {
      bill: o.id, date: ymd(at), hour: o.source === "lark" ? null : bkk(at).toISOString().slice(11, 13), weekday: WD[bkk(at).getUTCDay()],
      branch: L.branchName(o.branch_id), brand: firstBrand ? L.bn.get(firstBrand) ?? "—" : "—",
      channel: CH_TH[o.channel] ?? o.channel, source: o.source === "lark" ? "Lark" : "POS",
      salesperson: L.em.get(o.salesperson_id ?? o.cashier_id ?? "") ?? null,
      payment: [...new Set(o.payments.map((p) => PAY_TH[p.method] ?? p.method))].join(" + ") || "ไม่ระบุ",
      status: ST_TH[o.status] ?? o.status, member: o.customer_id ? "สมาชิก" : "ทั่วไป", is_sale: sold,
      net: sold ? o.grand_total : 0, gross: sold ? o.subtotal : 0, discount: sold ? o.discount_total : 0,
      units: sold ? goods.reduce((s, i) => s + i.qty, 0) : 0, lines: goods.length, voided_amount: sold ? 0 : o.grand_total,
      ...(opts.cost ? { gp: sold ? o.gross_profit : 0, cost: sold ? o.cost_total : 0 } : {}),
    };
  });
  const fields: Field[] = [
    F("bill", "บิล", "string", "id", undefined, "รหัสบิล (นับจำนวนบิลด้วย count หรือ count_distinct)"),
    F("date", "วันที่", "date", "time"), F("hour", "ชั่วโมง", "string", "dimension", undefined, "00–23 (บิลระบบเดิมไม่มีเวลา = null)"),
    F("weekday", "วันในสัปดาห์", "string", "dimension"), F("branch", "สาขา", "string", "dimension"), F("brand", "แบรนด์", "string", "dimension"),
    F("channel", "ช่องทาง", "string", "dimension"), F("source", "แหล่งข้อมูล", "string", "dimension", undefined, "POS = ระบบใหม่, Lark = ระบบเดิม"),
    F("salesperson", "พนักงานขาย", "string", "dimension"), F("payment", "วิธีชำระ", "string", "dimension"), F("status", "สถานะ", "string", "dimension"),
    F("member", "ประเภทลูกค้า", "string", "dimension"), F("is_sale", "นับเป็นยอดขาย", "boolean", "dimension", undefined, "false = ยกเลิก/คืน (กรอง is_sale eq true เมื่อนับบิลขาย)"),
    F("net", "ยอดขายสุทธิ", "number", "measure", "thb"), F("gross", "ยอดก่อนส่วนลด", "number", "measure", "thb"), F("discount", "ส่วนลด", "number", "measure", "thb"),
    F("units", "จำนวนชิ้น", "number", "measure", "qty"), F("lines", "จำนวนรายการ", "number", "measure", "count"), F("voided_amount", "ยอดบิลยกเลิก", "number", "measure", "thb"),
    ...(opts.cost ? [F("gp", "กำไรขั้นต้น", "number", "measure", "thb"), F("cost", "ต้นทุน", "number", "measure", "thb")] : []),
  ];
  return { id: opts.id ?? "sales_bills", label: opts.label ?? "ยอดขายรายบิล", description: "1 แถว = 1 บิล (POS + ระบบเดิม Lark)", fields, rows, timeField: "date",
    range: { from: ymd(range.from.toISOString()), to: ymd(range.to.toISOString()) }, prevRange: prev ? { from: ymd(prev.from.toISOString()), to: ymd(prev.to.toISOString()) } : undefined };
}

/** ยอดขายรายสินค้า (1 แถว = 1 รายการในบิล) */
export function salesLines(orders: Order[], ref: Ref, range: { from: Date; to: Date }, prev: { from: Date; to: Date } | null, opts: { cost: boolean }): Dataset {
  const L = lookups(ref);
  const rows: Row[] = [];
  for (const o of orders) {
    if (!(o.status === "completed" || o.status === "partially_refunded")) continue;
    const at = (o as Order & { sale_occurred_at?: string }).sale_occurred_at || o.created_at;
    for (const i of o.items) {
      const p = i.product_id ? L.pr.get(i.product_id) : undefined;
      rows.push({
        bill: o.id, date: ymd(at), branch: L.branchName(o.branch_id), brand: (i.brand_id && L.bn.get(i.brand_id)) || (p?.brand_id && L.bn.get(p.brand_id)) || "—",
        sku: i.sku || null, product: i.name, category: p?.category_id ? L.cat.get(p.category_id) ?? "—" : "—",
        sale_type: i.sale_type ?? (i.kind === "service" ? "บริการ" : "สินค้า"), salesperson: L.em.get(i.salesperson_id ?? o.salesperson_id ?? "") ?? null,
        channel: CH_TH[o.channel] ?? o.channel, source: o.source === "lark" ? "Lark" : "POS", is_gift: !!i.is_gift,
        qty: i.qty, amount: i.line_total, discount: i.discount_amount, unit_price: i.unit_price,
        ...(opts.cost ? { gp: i.gross_profit, cost: i.cost_total } : {}),
      });
    }
  }
  const fields: Field[] = [
    F("bill", "บิล", "string", "id"), F("date", "วันที่", "date", "time"), F("branch", "สาขา", "string", "dimension"), F("brand", "แบรนด์สินค้า", "string", "dimension"),
    F("sku", "SKU", "string", "dimension"), F("product", "สินค้า", "string", "dimension"), F("category", "หมวดสินค้า", "string", "dimension"),
    F("sale_type", "ประเภทการขาย", "string", "dimension"), F("salesperson", "พนักงานขาย", "string", "dimension"), F("channel", "ช่องทาง", "string", "dimension"),
    F("source", "แหล่งข้อมูล", "string", "dimension"), F("is_gift", "ของแถม", "boolean", "dimension"),
    F("qty", "จำนวน", "number", "measure", "qty"), F("amount", "ยอดขาย", "number", "measure", "thb"), F("discount", "ส่วนลด", "number", "measure", "thb"), F("unit_price", "ราคาต่อชิ้น", "number", "measure", "thb"),
    ...(opts.cost ? [F("gp", "กำไรขั้นต้น", "number", "measure", "thb"), F("cost", "ต้นทุน", "number", "measure", "thb")] : []),
  ];
  return { id: "sales_lines", label: "ยอดขายรายสินค้า", description: "1 แถว = สินค้า 1 รายการในบิลที่ขายแล้ว (ไม่รวมบิลยกเลิก)", fields, rows, timeField: "date",
    range: { from: ymd(range.from.toISOString()), to: ymd(range.to.toISOString()) }, prevRange: prev ? { from: ymd(prev.from.toISOString()), to: ymd(prev.to.toISOString()) } : undefined };
}

/** สต๊อกปัจจุบัน + ความเร็วขาย 30 วัน (จากบิล POS ที่โหลดมา) → วันคงเหลือ */
export function stockDataset(levels: StockLevel[], ref: Ref, orders: Order[], opts: { cost: boolean }): Dataset {
  const L = lookups(ref);
  const since = Date.now() - 30 * 86400_000;
  const sold = new Map<string, number>();
  for (const o of orders) {
    if (o.source === "lark" || !(o.status === "completed" || o.status === "partially_refunded") || +new Date(o.created_at) < since) continue;
    for (const i of o.items) if (i.product_id) { const k = `${o.branch_id}|${i.product_id}`; sold.set(k, (sold.get(k) ?? 0) + i.qty); }
  }
  const rows: Row[] = levels.map((s) => {
    const p = L.pr.get(s.product_id);
    const onHand = Number(s.qty_on_hand) || 0, q = Number(s.qty_quarantine ?? 0), res = (Number(s.qty_reserved) || 0) + (Number(s.qty_reserved_order ?? 0));
    const available = Math.max(0, onHand - q - res);
    const s30 = sold.get(`${s.branch_id}|${s.product_id}`) ?? 0;
    const perDay = s30 / 30;
    return {
      branch: L.branchName(s.branch_id), product: p?.name_th ?? p?.name_en ?? s.product_id, sku: p?.sku ?? null, brand: p?.brand_id ? L.bn.get(p.brand_id) ?? "—" : "—",
      category: p?.category_id ? L.cat.get(p.category_id) ?? "—" : "—",
      on_hand: onHand, available, reserved: res, quarantine: q, reorder_point: Number(s.reorder_point) || 0,
      sold_30d: s30, days_of_stock: perDay > 0 ? Math.round((available / perDay) * 10) / 10 : null,
      status: available <= 0 ? "หมด" : s.reorder_point && available <= s.reorder_point ? "ต่ำกว่าจุดสั่งซื้อ" : perDay > 0 && available / perDay < 7 ? "เหลือน้อย (<7 วัน)" : perDay === 0 ? "ไม่เคลื่อนไหว 30 วัน" : "ปกติ",
      retail_value: onHand * (p?.price ?? 0), ...(opts.cost ? { cost_value: onHand * (p?.cost ?? 0) } : {}),
      age_days: s.last_in_at ? Math.floor((Date.now() - +new Date(s.last_in_at)) / 86400_000) : null,
    };
  });
  const fields: Field[] = [
    F("branch", "สาขา/คลัง", "string", "dimension"), F("product", "สินค้า", "string", "dimension"), F("sku", "SKU", "string", "dimension"), F("brand", "แบรนด์", "string", "dimension"),
    F("category", "หมวด", "string", "dimension"), F("status", "สถานะสต๊อก", "string", "dimension"),
    F("on_hand", "คงเหลือ", "number", "measure", "qty"), F("available", "พร้อมขาย", "number", "measure", "qty"), F("reserved", "จองไว้", "number", "measure", "qty"),
    F("quarantine", "พักตรวจ", "number", "measure", "qty"), F("reorder_point", "จุดสั่งซื้อ", "number", "measure", "qty"), F("sold_30d", "ขาย 30 วัน", "number", "measure", "qty"),
    F("days_of_stock", "พอขายอีก (วัน)", "number", "measure", "days"), F("retail_value", "มูลค่าราคาขาย", "number", "measure", "thb"),
    ...(opts.cost ? [F("cost_value", "มูลค่าต้นทุน", "number", "measure", "thb")] : []), F("age_days", "อายุสต๊อก (วัน)", "number", "measure", "days"),
  ];
  return { id: "stock", label: "สต๊อกปัจจุบัน", description: "1 แถว = สินค้า × สาขา ณ ตอนนี้ (ไม่มีมิติเวลา) · ขาย 30 วันจากบิล POS", fields, rows };
}

export type CustomerRow = { segment: string; source?: string | null; brands?: string[]; orders: number; spend: number; recencyDays: number | null; tier?: string | null; points?: number };
/** ลูกค้า (ไม่มีชื่อ/เบอร์) */
export function customersDataset(list: CustomerRow[]): Dataset {
  const SEG: Record<string, string> = { new: "ลูกค้าใหม่", returning: "ซื้อซ้ำ", vip: "VIP", lost: "หายไป" };
  const rows: Row[] = list.map((c) => ({
    segment: SEG[c.segment] ?? c.segment, source: c.source === "lark" ? "Lark" : c.source ?? "POS", brand: c.brands?.[0] ?? "—", brand_count: c.brands?.length ?? 0,
    tier: c.tier ?? "—", orders: c.orders, spend: c.spend, avg_bill: c.orders ? c.spend / c.orders : 0, recency_days: c.recencyDays, points: c.points ?? 0,
    recency_band: c.recencyDays == null ? "ไม่เคยซื้อ" : c.recencyDays <= 30 ? "≤30 วัน" : c.recencyDays <= 90 ? "31–90 วัน" : c.recencyDays <= 180 ? "91–180 วัน" : ">180 วัน",
  }));
  const fields: Field[] = [
    F("segment", "กลุ่มลูกค้า", "string", "dimension"), F("source", "ที่มา", "string", "dimension"), F("brand", "แบรนด์หลัก", "string", "dimension"),
    F("tier", "ระดับ", "string", "dimension"), F("recency_band", "ซื้อล่าสุด", "string", "dimension"),
    F("brand_count", "จำนวนแบรนด์ที่ซื้อ", "number", "measure", "count"), F("orders", "จำนวนบิล", "number", "measure", "count"), F("spend", "ยอดซื้อสะสม", "number", "measure", "thb"),
    F("avg_bill", "ยอดเฉลี่ยต่อบิล", "number", "measure", "thb"), F("recency_days", "ไม่ได้ซื้อมา (วัน)", "number", "measure", "days"), F("points", "แต้ม", "number", "measure", "count"),
  ];
  return { id: "customers", label: "ลูกค้า", description: "1 แถว = ลูกค้า 1 คน (ไม่มีชื่อ/เบอร์)", fields, rows };
}

/** สรุปโครงข้อมูลให้ AI: จำนวนแถว · ช่วงวันที่ · ค่าที่พบบ่อยของมิติ · min/max/sum ของตัวเลข */
export function profileDataset(ds: Dataset) {
  const cur = ds.timeField && ds.range ? ds.rows.filter((r) => { const v = String(r[ds.timeField!] ?? ""); return v >= ds.range!.from && v <= ds.range!.to; }) : ds.rows;
  return {
    id: ds.id, label: ds.label, description: ds.description, rows_current: cur.length, rows_total: ds.rows.length,
    time_field: ds.timeField ?? null, current_range: ds.range ?? null, previous_range: ds.prevRange ?? null,
    fields: ds.fields.map((f) => {
      const vals = cur.map((r) => r[f.key]).filter((v) => v != null && v !== "");
      const base = { key: f.key, label: f.label, type: f.type, role: f.role, ...(f.unit ? { unit: f.unit } : {}), ...(f.description ? { note: f.description } : {}), filled_pct: cur.length ? Math.round((vals.length / cur.length) * 100) : 0 };
      if (f.role === "measure") {
        const n = vals.map(Number).filter((x) => Number.isFinite(x));
        return { ...base, min: n.length ? Math.min(...n) : null, max: n.length ? Math.max(...n) : null, sum: Math.round(n.reduce((a, b) => a + b, 0)) };
      }
      if (f.role === "dimension") {
        const m = new Map<string, number>(); for (const v of vals) m.set(String(v), (m.get(String(v)) ?? 0) + 1);
        const top = [...m].sort((a, b) => b[1] - a[1]);
        return { ...base, distinct: m.size, top_values: top.slice(0, 8).map(([v, c]) => `${v} (${c})`) };
      }
      if (f.role === "time") { const s = vals.map(String).sort(); return { ...base, min: s[0] ?? null, max: s[s.length - 1] ?? null }; }
      return { ...base, distinct: new Set(vals.map(String)).size };
    }),
  };
}
