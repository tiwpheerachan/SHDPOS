// =====================================================================
// AI Insights engine — สเปก widget + query engine + parser ในเครื่อง
//   คำถาม → View (ชุด widget: metric×dimension×viz) → คำนวณจาก orders
//   ปลอดภัย: AI สร้างแค่ "สเปก" ไม่เห็นข้อมูลดิบ; คำนวณจริงฝั่ง client
// =====================================================================
import type { Order, Branch, Employee } from "../types";

export type Metric = "sales" | "qty" | "gp" | "orders" | "aov" | "discount";
export type Dimension = "branch" | "brand" | "product" | "employee" | "channel" | "payment" | "day" | "weekday" | "hour";
export type Viz = "kpi" | "bar" | "hbar" | "donut" | "line" | "table" | "heatmap";
export type Locale = "th" | "en" | "zh";

export interface Widget {
  id: string;
  title: string;
  viz: Viz;
  metric: Metric;
  dimension?: Dimension | null; // null = KPI รวม
  limit?: number;
  branchId?: string | null; // ฟิลเตอร์รายการ์ด: เจาะสาขาเดียว (ว่าง = ทุกสาขาตามตัวกรองหลัก)
  compare?: boolean;         // เทียบช่วงก่อนหน้า (แสดงคู่/เดลต้า)
}
export interface View {
  id: string;
  name: string;
  prompt: string;
  widgets: Widget[];
  createdAt: string;
}

export interface Ctx { branches: Branch[]; employees: Employee[]; brands: { id: string; name: string }[] }
export interface Row { key: string; label: string; value: number; qty: number; gp: number; orders: number; prev?: number }
export interface WidgetData { rows: Row[]; total: number; metric: Metric; totalPrev?: number; series?: number[]; matrix?: number[][]; cols?: string[]; rowsLabel?: string[] }

const round2 = (n: number) => Math.round(n * 100) / 100;
const live = (o: Order) => o.status !== "voided";
const tr = (l: Locale, th: string, en: string, zh: string) => (l === "th" ? th : l === "zh" ? zh : en);

export const METRIC_LABEL: Record<Metric, { th: string; en: string; zh: string }> = {
  sales: { th: "ยอดขาย", en: "Sales", zh: "销售额" },
  qty: { th: "จำนวนชิ้น", en: "Units", zh: "件数" },
  gp: { th: "กำไรขั้นต้น", en: "Gross profit", zh: "毛利" },
  orders: { th: "จำนวนบิล", en: "Orders", zh: "订单" },
  aov: { th: "เฉลี่ย/บิล", en: "Avg/bill", zh: "客单价" },
  discount: { th: "ส่วนลด", en: "Discount", zh: "折扣" },
};
export const DIM_LABEL: Record<Dimension, { th: string; en: string; zh: string }> = {
  branch: { th: "สาขา", en: "Branch", zh: "门店" },
  brand: { th: "แบรนด์", en: "Brand", zh: "品牌" },
  product: { th: "สินค้า", en: "Product", zh: "商品" },
  employee: { th: "พนักงาน", en: "Staff", zh: "员工" },
  channel: { th: "ช่องทาง", en: "Channel", zh: "渠道" },
  payment: { th: "วิธีจ่าย", en: "Payment", zh: "支付方式" },
  day: { th: "รายวัน", en: "Daily", zh: "按天" },
  weekday: { th: "วันในสัปดาห์", en: "Weekday", zh: "星期" },
  hour: { th: "รายชั่วโมง", en: "Hourly", zh: "按小时" },
};

const WEEKDAYS: Record<Locale, string[]> = {
  th: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
};
const CHAN: Record<string, { th: string; en: string; zh: string }> = {
  offline: { th: "หน้าร้าน", en: "In-store", zh: "门店" },
  online_shopee: { th: "Shopee", en: "Shopee", zh: "Shopee" },
  online_lazada: { th: "Lazada", en: "Lazada", zh: "Lazada" },
  online_tiktok: { th: "TikTok", en: "TikTok", zh: "TikTok" },
  online_website: { th: "เว็บไซต์", en: "Website", zh: "官网" },
  event: { th: "อีเวนต์", en: "Event", zh: "活动" },
  b2b: { th: "B2B", en: "B2B", zh: "B2B" },
  other: { th: "อื่นๆ", en: "Other", zh: "其他" },
};
const PAY: Record<string, { th: string; en: string; zh: string }> = {
  cash: { th: "เงินสด", en: "Cash", zh: "现金" },
  credit_card: { th: "บัตรเครดิต", en: "Credit", zh: "信用卡" },
  debit_card: { th: "บัตรเดบิต", en: "Debit", zh: "借记卡" },
  qr_promptpay: { th: "QR", en: "QR", zh: "QR" },
  bank_transfer: { th: "โอน", en: "Transfer", zh: "转账" },
  edc: { th: "EDC", en: "EDC", zh: "EDC" },
  gift_card: { th: "บัตรของขวัญ", en: "Gift card", zh: "礼品卡" },
  store_credit: { th: "เครดิตร้าน", en: "Credit", zh: "店铺积分" },
  installment: { th: "ผ่อน", en: "Installment", zh: "分期" },
  online_marketplace: { th: "มาร์เก็ตเพลส", en: "Marketplace", zh: "电商" },
  other: { th: "อื่นๆ", en: "Other", zh: "其他" },
};

type Acc = { label: string; sales: number; qty: number; gp: number; orders: Set<string>; discount: number };
const pick = (a: Acc, m: Metric): number =>
  m === "sales" ? round2(a.sales) : m === "qty" ? round2(a.qty) : m === "gp" ? round2(a.gp)
  : m === "orders" ? a.orders.size : m === "discount" ? round2(a.discount)
  : a.orders.size ? round2(a.sales / a.orders.size) : 0;

/** คำนวณ widget จาก orders ตาม metric×dimension (prevOrders = ช่วงก่อน สำหรับเทียบ) */
export function computeWidget(orders: Order[], ctx: Ctx, w: Widget, l: Locale, prevOrders?: Order[]): WidgetData {
  const metric = w.metric;
  const bName = (id: string) => { const b = ctx.branches.find((x) => x.id === id); return b ? (l === "th" ? b.name_th ?? b.name : b.name) : id; };
  const brandName = (id: string) => ctx.brands.find((x) => x.id === id)?.name ?? id;
  const eName = (id: string) => { const e = ctx.employees.find((x) => x.id === id); return e ? (e.nickname ?? e.first_name ?? e.employee_code) : id; };
  const branchBrand = new Map(ctx.branches.map((b) => [b.id, b.brand_id]));

  // รวมทั้งหมด (สำหรับ KPI/total)
  const aggAll = (os: Order[]): Acc => {
    const a: Acc = { label: "", sales: 0, qty: 0, gp: 0, orders: new Set(), discount: 0 };
    for (const o of os) { if (!live(o)) continue; a.sales += o.grand_total; a.gp += o.gross_profit; a.discount += o.discount_total; a.orders.add(o.id); for (const it of o.items) a.qty += it.qty; }
    return a;
  };

  // ── Heatmap: วัน(คอลัมน์) × ชั่วโมง(แถว) ──
  if (w.viz === "heatmap") {
    const mat: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const o of orders) { if (!live(o)) continue; const d = new Date(o.created_at); mat[d.getHours()][d.getDay()] += (metric === "orders" ? 1 : metric === "qty" ? o.items.reduce((s, it) => s + it.qty, 0) : metric === "gp" ? o.gross_profit : metric === "discount" ? o.discount_total : o.grand_total); }
    const total = pick(aggAll(orders), metric);
    return { rows: [], total: round2(total), metric, matrix: mat, cols: WEEKDAYS[l], rowsLabel: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`) };
  }

  // ── KPI รวม + sparkline ──
  if (!w.dimension || w.viz === "kpi") {
    const a = aggAll(orders);
    // series รายวันสำหรับ sparkline
    const byDay = new Map<string, Acc>();
    for (const o of orders) { if (!live(o)) continue; const k = new Date(o.created_at).toLocaleDateString("en-CA"); let d = byDay.get(k); if (!d) { d = { label: k, sales: 0, qty: 0, gp: 0, orders: new Set(), discount: 0 }; byDay.set(k, d); } d.sales += o.grand_total; d.gp += o.gross_profit; d.discount += o.discount_total; d.orders.add(o.id); for (const it of o.items) d.qty += it.qty; }
    const series = Array.from(byDay.entries()).sort((x, y) => x[0].localeCompare(y[0])).map(([, d]) => pick(d, metric)).slice(-30);
    return { rows: [], total: pick(a, metric), metric, totalPrev: prevOrders ? pick(aggAll(prevOrders), metric) : undefined, series };
  }

  const dim = w.dimension;
  // จัดกลุ่มตามมิติ → Map<key, Acc>
  const groupBy = (os: Order[]): Map<string, Acc> => {
    const map = new Map<string, Acc>();
    const get = (key: string, label: string) => { let a = map.get(key); if (!a) { a = { label, sales: 0, qty: 0, gp: 0, orders: new Set(), discount: 0 }; map.set(key, a); } return a; };
    for (const o of os) {
      if (!live(o)) continue;
      if (dim === "product" || dim === "employee") {
        for (const it of o.items) {
          if (dim === "product") { const a = get(it.sku || it.product_id || it.name, it.name); a.sales += it.line_total; a.qty += it.qty; a.gp += it.gross_profit; a.orders.add(o.id); }
          else { const eid = it.salesperson_id ?? o.salesperson_id ?? o.cashier_id; if (!eid) continue; const a = get(eid, eName(eid)); a.sales += it.line_total; a.qty += it.qty; a.gp += it.gross_profit; a.orders.add(o.id); }
        }
        continue;
      }
      if (dim === "payment") { for (const p of o.payments) { const a = get(p.method, (PAY[p.method] ?? PAY.other)[l]); a.sales += p.amount; a.orders.add(o.id); } continue; }
      let key = "", label = "";
      if (dim === "branch") { key = o.branch_id; label = bName(o.branch_id); }
      else if (dim === "brand") { const bid = branchBrand.get(o.branch_id) ?? "—"; key = bid ?? "—"; label = bid ? brandName(bid) : "—"; }
      else if (dim === "channel") { key = o.channel; label = (CHAN[o.channel] ?? CHAN.other)[l]; }
      else if (dim === "day") { key = new Date(o.created_at).toLocaleDateString("en-CA"); label = new Date(o.created_at).toLocaleDateString(l === "th" ? "th-TH" : l === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" }); }
      else if (dim === "weekday") { const wd = new Date(o.created_at).getDay(); key = String(wd); label = WEEKDAYS[l][wd]; }
      else if (dim === "hour") { const h = new Date(o.created_at).getHours(); key = String(h).padStart(2, "0"); label = `${key}:00`; }
      const a = get(key, label); a.sales += o.grand_total; a.gp += o.gross_profit; a.discount += o.discount_total; a.orders.add(o.id);
      for (const it of o.items) a.qty += it.qty;
    }
    return map;
  };

  const curMap = groupBy(orders);
  const prevMap = prevOrders ? groupBy(prevOrders) : null;
  let rows: Row[] = Array.from(curMap.entries()).map(([key, a]) => ({
    key, label: a.label, value: pick(a, metric), qty: round2(a.qty), gp: round2(a.gp), orders: a.orders.size,
    prev: prevMap ? (prevMap.has(key) ? pick(prevMap.get(key)!, metric) : 0) : undefined,
  }));
  if (dim === "day") rows.sort((a, b) => a.key.localeCompare(b.key));
  else if (dim === "weekday" || dim === "hour") rows.sort((a, b) => Number(a.key) - Number(b.key));
  else rows.sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const totalPrev = prevMap ? Array.from(prevMap.values()).reduce((s, a) => s + pick(a, metric), 0) : undefined;
  if (w.limit && w.limit > 0 && dim !== "day" && dim !== "hour" && dim !== "weekday") rows = rows.slice(0, w.limit);
  return { rows, total: round2(total), metric, totalPrev: totalPrev != null ? round2(totalPrev) : undefined };
}

// ── parser ในเครื่อง (เผื่อไม่มี LLM) ──────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

function detectMetric(q: string): Metric {
  if (/กำไร|profit|毛利|margin/.test(q)) return "gp";
  if (/จำนวนชิ้น|ชิ้น|unit|件|ขายได้กี่/.test(q)) return "qty";
  if (/บิล|ออเดอร์|order|单|จำนวนออเดอร/.test(q)) return "orders";
  if (/เฉลี่ย|average|avg|客单|ต่อบิล/.test(q)) return "aov";
  if (/ส่วนลด|discount|折扣/.test(q)) return "discount";
  return "sales";
}
function detectDims(q: string): Dimension[] {
  const d: Dimension[] = [];
  if (/สาขา|branch|门店|ร้าน/.test(q)) d.push("branch");
  if (/แบรนด์|brand|品牌/.test(q)) d.push("brand");
  if (/สินค้า|product|商品|รุ่น|ขายดี|sku/.test(q)) d.push("product");
  if (/พนักงาน|staff|employee|员工|คนขาย|เซลล?/.test(q)) d.push("employee");
  if (/ช่องทาง|channel|渠道|shopee|lazada|tiktok|ออนไลน/.test(q)) d.push("channel");
  if (/วิธีจ่าย|วิธีรับเงิน|จ่าย|payment|支付|เงินสด|บัตร|โอน|qr/.test(q)) d.push("payment");
  if (/รายวัน|แนวโน้ม|trend|daily|每天|ต่อวัน/.test(q)) d.push("day");
  if (/วันไหน|weekday|星期|วันในสัปดาห/.test(q)) d.push("weekday");
  if (/ชั่วโมง|เวลาไหน|hour|peak|小时|พีค/.test(q)) d.push("hour");
  return d;
}
function detectLimit(q: string): number | undefined {
  const m = q.match(/(?:top|อันดับ|อันดับ\s*|)(\d{1,3})\s*(?:อันดับ|รายการ|ตัว|อย่าง)?/i);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 100) return n; }
  if (/top|อันดับ|สูงสุด|ขายดี|best/.test(q)) return 10;
  return undefined;
}
const vizFor = (dim: Dimension): Viz =>
  dim === "day" ? "line" : dim === "hour" || dim === "weekday" ? "bar" : dim === "channel" || dim === "payment" ? "donut" : "bar";

/** แปลงคำถามเป็น View (fallback เมื่อไม่มี LLM) */
export function parsePrompt(prompt: string, l: Locale): View {
  const q = prompt.toLowerCase();
  const metric = detectMetric(q);
  const dims = detectDims(q);
  const limit = detectLimit(q);
  const mL = (m: Metric) => METRIC_LABEL[m][l];
  const dL = (d: Dimension) => DIM_LABEL[d][l];

  const widgets: Widget[] = [
    { id: uid(), title: mL("sales"), viz: "kpi", metric: "sales", dimension: null },
    { id: uid(), title: mL("orders"), viz: "kpi", metric: "orders", dimension: null },
    { id: uid(), title: mL("aov"), viz: "kpi", metric: "aov", dimension: null },
    { id: uid(), title: mL("gp"), viz: "kpi", metric: "gp", dimension: null },
  ];
  const useDims = dims.length ? dims : (["product", "branch"] as Dimension[]);
  for (const d of useDims) {
    widgets.push({ id: uid(), title: `${mL(metric)} · ${dL(d)}`, viz: vizFor(d), metric, dimension: d, limit });
    // ตารางคู่กับกราฟหลักของมิติแรก
    if (d === useDims[0] && (d === "product" || d === "employee" || d === "branch")) {
      widgets.push({ id: uid(), title: `${tr(l, "ตาราง", "Table", "表格")} · ${dL(d)}`, viz: "table", metric, dimension: d, limit: limit ?? 20 });
    }
  }
  const name = prompt.trim().slice(0, 48) || tr(l, "มุมมองใหม่", "New view", "新视图");
  return { id: uid(), name, prompt: prompt.trim(), widgets, createdAt: new Date().toISOString() };
}

/** คำแนะนำต่อยอดอย่างฉลาด (เมื่อไม่มี LLM) — เสนอมิติที่ยังไม่ได้ดู */
export function localSuggestions(view: View | null, l: Locale): string[] {
  const dims = new Set((view?.widgets ?? []).map((w) => w.dimension).filter(Boolean) as Dimension[]);
  const opts: [boolean, string][] = [
    [!dims.has("branch"), tr(l, "ดูรายสาขาด้วย", "Break down by branch", "按门店拆分")],
    [!dims.has("employee"), tr(l, "ดูรายพนักงาน", "By staff", "按员工")],
    [!dims.has("product"), tr(l, "สินค้าขายดี 10 อันดับ", "Top 10 products", "热销前10")],
    [!dims.has("day"), tr(l, "แนวโน้มรายวัน", "Daily trend", "每日趋势")],
    [!dims.has("payment"), tr(l, "สัดส่วนวิธีจ่าย", "Payment mix", "支付占比")],
    [!dims.has("channel"), tr(l, "แยกตามช่องทาง", "By channel", "按渠道")],
    [true, tr(l, "เทียบกำไรแทนยอดขาย", "Show profit instead", "改看毛利")],
  ];
  return opts.filter(([ok]) => ok).map(([, s]) => s).slice(0, 3);
}

/** สรุปคำตอบสั้นจากผลลัพธ์ (ใช้เมื่อไม่มีคำตอบจาก LLM) */
export function localAnswer(view: View, firstData: WidgetData | null, l: Locale): string {
  if (!firstData || !firstData.rows.length) return tr(l, "ไม่พบข้อมูลในช่วงที่เลือก", "No data in range", "所选范围无数据");
  const top = firstData.rows[0];
  const mL = METRIC_LABEL[firstData.metric][l];
  const fmt = (n: number) => (firstData.metric === "orders" || firstData.metric === "qty") ? Math.round(n).toLocaleString() : "฿" + Math.round(n).toLocaleString();
  return tr(l,
    `อันดับ 1: ${top.label} (${mL} ${fmt(top.value)}) · จากทั้งหมด ${firstData.rows.length} รายการ`,
    `Top: ${top.label} (${mL} ${fmt(top.value)}) · of ${firstData.rows.length}`,
    `第一：${top.label}（${mL} ${fmt(top.value)}）· 共 ${firstData.rows.length} 项`);
}
