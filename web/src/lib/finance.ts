// =====================================================================
// Finance analytics — "เงินมาจากไหน" รายสาขา/ช่องทาง/วิธีรับเงิน (EDC/สด/โอน)
//   + ตัวสร้างสรุป AI รายวัน (heuristic, 3 ภาษา)
//   อ้างอิงข้อมูลจาก Order.payments (method/amount/acquirer_bank/fee_amount)
//   NOTE: ยังไม่กระทบยอดเงินเข้าธนาคารจริง — หน้านี้ "แสดงว่าเงินมาจากไหน"
//         เท่านั้น (received ตามสลิป/ระบบ ไม่ใช่ statement ธนาคาร)
// =====================================================================
import type { Order, Branch, Employee, PaymentMethod, SaleChannel } from "./types";

export type Locale = "th" | "en" | "zh";
const round2 = (n: number) => Math.round(n * 100) / 100;
const tr = (l: Locale, th: string, en: string, zh: string) => (l === "th" ? th : l === "zh" ? zh : en);

// ── ป้ายกำกับ ──────────────────────────────────────────────────────
export const PAYMENT_LABEL: Record<PaymentMethod, { th: string; en: string; zh: string }> = {
  cash: { th: "เงินสด", en: "Cash", zh: "现金" },
  credit_card: { th: "บัตรเครดิต", en: "Credit card", zh: "信用卡" },
  debit_card: { th: "บัตรเดบิต", en: "Debit card", zh: "借记卡" },
  qr_promptpay: { th: "QR พร้อมเพย์", en: "QR PromptPay", zh: "QR码" },
  bank_transfer: { th: "โอนธนาคาร", en: "Bank transfer", zh: "银行转账" },
  edc: { th: "เครื่อง EDC", en: "EDC", zh: "EDC机" },
  gift_card: { th: "บัตรของขวัญ", en: "Gift card", zh: "礼品卡" },
  store_credit: { th: "เครดิตร้าน", en: "Store credit", zh: "店铺积分" },
  installment: { th: "ผ่อนชำระ", en: "Installment", zh: "分期" },
  online_marketplace: { th: "มาร์เก็ตเพลส", en: "Marketplace", zh: "电商平台" },
  other: { th: "อื่นๆ", en: "Other", zh: "其他" },
};
export const paymentLabel = (m: string, l: Locale) =>
  (PAYMENT_LABEL[m as PaymentMethod] ?? PAYMENT_LABEL.other)[l];

export const CHANNEL_LABEL: Record<SaleChannel, { th: string; en: string; zh: string }> = {
  offline: { th: "หน้าร้าน", en: "In-store", zh: "门店" },
  online_shopee: { th: "Shopee", en: "Shopee", zh: "Shopee" },
  online_lazada: { th: "Lazada", en: "Lazada", zh: "Lazada" },
  online_tiktok: { th: "TikTok", en: "TikTok", zh: "TikTok" },
  online_website: { th: "เว็บไซต์", en: "Website", zh: "官网" },
  event: { th: "ออกบูธ/อีเวนต์", en: "Event", zh: "活动" },
  b2b: { th: "ขายส่ง B2B", en: "B2B", zh: "批发 B2B" },
  other: { th: "อื่นๆ", en: "Other", zh: "其他" },
};
export const channelLabel = (c: string, l: Locale) =>
  (CHANNEL_LABEL[c as SaleChannel] ?? { th: c, en: c, zh: c })[l];

// จัดกลุ่มวิธีรับเงินเป็นถัง (สำหรับตารางรายสาขา)
export type Bucket = "cash" | "card" | "transfer" | "qr" | "other";
export function bucketOf(method: string): Bucket {
  switch (method) {
    case "cash": return "cash";
    case "credit_card": case "debit_card": case "edc": case "installment": return "card";
    case "bank_transfer": return "transfer";
    case "qr_promptpay": return "qr";
    default: return "other";
  }
}
export const BUCKET_LABEL: Record<Bucket, { th: string; en: string; zh: string }> = {
  cash: { th: "เงินสด", en: "Cash", zh: "现金" },
  card: { th: "บัตร/EDC", en: "Card/EDC", zh: "刷卡/EDC" },
  transfer: { th: "โอน", en: "Transfer", zh: "转账" },
  qr: { th: "QR", en: "QR", zh: "QR" },
  other: { th: "อื่นๆ", en: "Other", zh: "其他" },
};

const live = (o: Order) => o.status !== "voided";

// ── สรุปรวมการเงิน ─────────────────────────────────────────────────
export interface FinanceSummary {
  gross: number;        // ยอดรับชำระรวม (ตามบิล)
  fee: number;          // ค่าธรรมเนียมรวม (EDC/บัตร)
  net: number;          // สุทธิหลังหักค่าธรรมเนียม
  cash: number;         // เงินสด (ต้องนับ/นำฝากเอง)
  system: number;       // รับผ่านระบบ (บัตร/EDC/โอน/QR) — เข้าบัญชี
  orders: number;
}
export function financeSummary(orders: Order[]): FinanceSummary {
  let gross = 0, fee = 0, cash = 0, system = 0, count = 0;
  for (const o of orders) {
    if (!live(o)) continue;
    count++;
    for (const p of o.payments) {
      gross += p.amount;
      const anyP = p as unknown as { fee_amount?: number };
      fee += anyP.fee_amount ?? 0;
      if (p.method === "cash") cash += p.amount;
      else system += p.amount;
    }
  }
  return { gross: round2(gross), fee: round2(fee), net: round2(gross - fee), cash: round2(cash), system: round2(system), orders: count };
}

// ── รายวิธีรับเงิน ─────────────────────────────────────────────────
export function byPaymentDetail(orders: Order[], l: Locale) {
  const map = new Map<string, { value: number; fee: number; count: number }>();
  for (const o of orders) {
    if (!live(o)) continue;
    for (const p of o.payments) {
      const cur = map.get(p.method) ?? { value: 0, fee: 0, count: 0 };
      cur.value += p.amount;
      cur.fee += (p as unknown as { fee_amount?: number }).fee_amount ?? 0;
      cur.count += 1;
      map.set(p.method, cur);
    }
  }
  return Array.from(map.entries())
    .map(([method, v]) => ({ method, label: paymentLabel(method, l), value: round2(v.value), fee: round2(v.fee), net: round2(v.value - v.fee), count: v.count }))
    .sort((a, b) => b.value - a.value);
}

// ── รายช่องทางขาย ──────────────────────────────────────────────────
export function byChannelDetail(orders: Order[], l: Locale) {
  const map = new Map<string, { value: number; count: number }>();
  for (const o of orders) {
    if (!live(o)) continue;
    const cur = map.get(o.channel) ?? { value: 0, count: 0 };
    cur.value += o.grand_total; cur.count += 1;
    map.set(o.channel, cur);
  }
  return Array.from(map.entries())
    .map(([channel, v]) => ({ channel, label: channelLabel(channel, l), value: round2(v.value), count: v.count }))
    .sort((a, b) => b.value - a.value);
}

// ── รายธนาคาร/ผู้รับบัตร (EDC) ─────────────────────────────────────
export function byAcquirer(orders: Order[]) {
  const map = new Map<string, { value: number; fee: number; count: number }>();
  for (const o of orders) {
    if (!live(o)) continue;
    for (const p of o.payments) {
      const bank = (p.acquirer_bank || "").trim();
      if (!bank) continue;
      const cur = map.get(bank) ?? { value: 0, fee: 0, count: 0 };
      cur.value += p.amount;
      cur.fee += (p as unknown as { fee_amount?: number }).fee_amount ?? 0;
      cur.count += 1;
      map.set(bank, cur);
    }
  }
  return Array.from(map.entries())
    .map(([bank, v]) => ({ bank, value: round2(v.value), fee: round2(v.fee), count: v.count }))
    .sort((a, b) => b.value - a.value);
}

// ── รายสาขา แยกถังวิธีรับเงิน ───────────────────────────────────────
export interface FinanceBranchRow {
  id: string; label: string; brandId: string | null;
  gross: number; cash: number; card: number; transfer: number; qr: number; other: number;
  fee: number; net: number; orders: number;
}
export function financeByBranch(orders: Order[], branches: Branch[], l: Locale): FinanceBranchRow[] {
  const map = new Map<string, FinanceBranchRow>();
  for (const o of orders) {
    if (!live(o)) continue;
    const b = branches.find((x) => x.id === o.branch_id);
    const row = map.get(o.branch_id) ?? {
      id: o.branch_id, label: b ? (l === "th" ? b.name_th ?? b.name : b.name) : o.branch_id,
      brandId: b?.brand_id ?? null, gross: 0, cash: 0, card: 0, transfer: 0, qr: 0, other: 0, fee: 0, net: 0, orders: 0,
    };
    row.orders += 1;
    for (const p of o.payments) {
      row.gross += p.amount;
      row[bucketOf(p.method)] += p.amount;
      row.fee += (p as unknown as { fee_amount?: number }).fee_amount ?? 0;
    }
    map.set(o.branch_id, row);
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r, gross: round2(r.gross), cash: round2(r.cash), card: round2(r.card),
      transfer: round2(r.transfer), qr: round2(r.qr), other: round2(r.other),
      fee: round2(r.fee), net: round2(r.gross - r.fee),
    }))
    .sort((a, b) => b.gross - a.gross);
}

// ── การดำเนินกิจการ (ops summary) ──────────────────────────────────
export interface OpsSummary {
  orders: number; gross: number; aov: number; units: number; gp: number; gpPct: number;
  customers: number; discount: number;
}
export function opsSummary(orders: Order[]): OpsSummary {
  let gross = 0, units = 0, gp = 0, discount = 0, count = 0;
  const custs = new Set<string>();
  for (const o of orders) {
    if (!live(o)) continue;
    count++; gross += o.grand_total; gp += o.gross_profit; discount += o.discount_total;
    if (o.customer_id) custs.add(o.customer_id);
    for (const it of o.items) units += it.qty;
  }
  return {
    orders: count, gross: round2(gross), aov: count ? round2(gross / count) : 0,
    units: round2(units), gp: round2(gp), gpPct: gross ? round2((gp / gross) * 100) : 0,
    customers: custs.size, discount: round2(discount),
  };
}

// ── เจาะลึก: สินค้า × สาขา × พนักงาน ───────────────────────────────
export interface DrillRow { id: string; label: string; qty: number; gross: number; gp: number }
export interface ProdAgg {
  sku: string; name: string; qty: number; gross: number; gp: number; gpPct: number;
  branches: DrillRow[]; employees: DrillRow[];
}
/** รวมยอดต่อสินค้า พร้อม breakdown รายสาขา + รายพนักงาน (เรียงยอด) */
export function productDrill(orders: Order[], branches: Branch[], employees: Employee[], l: Locale): ProdAgg[] {
  const bLabel = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (l === "th" ? b.name_th ?? b.name : b.name) : id; };
  const eLabel = (id: string) => { const e = employees.find((x) => x.id === id); return e ? (e.nickname ?? e.first_name ?? e.employee_code) : id; };
  type Cell = { qty: number; gross: number; gp: number };
  type P = { name: string; qty: number; gross: number; gp: number; br: Map<string, Cell>; em: Map<string, Cell> };
  const map = new Map<string, P>();
  const bump = (m: Map<string, Cell>, k: string, q: number, g: number, p: number) => {
    const c = m.get(k) ?? { qty: 0, gross: 0, gp: 0 }; c.qty += q; c.gross += g; c.gp += p; m.set(k, c);
  };
  for (const o of orders) {
    if (!live(o)) continue;
    for (const it of o.items) {
      const key = it.sku || it.product_id || it.name;
      const cur = map.get(key) ?? { name: it.name, qty: 0, gross: 0, gp: 0, br: new Map(), em: new Map() };
      cur.qty += it.qty; cur.gross += it.line_total; cur.gp += it.gross_profit;
      bump(cur.br, o.branch_id, it.qty, it.line_total, it.gross_profit);
      const eid = it.salesperson_id ?? o.salesperson_id ?? o.cashier_id;
      if (eid) bump(cur.em, eid, it.qty, it.line_total, it.gross_profit);
      map.set(key, cur);
    }
  }
  const toRows = (m: Map<string, Cell>, label: (id: string) => string): DrillRow[] =>
    Array.from(m.entries())
      .map(([id, c]) => ({ id, label: label(id), qty: round2(c.qty), gross: round2(c.gross), gp: round2(c.gp) }))
      .sort((a, b) => b.gross - a.gross);
  return Array.from(map.entries())
    .map(([sku, v]) => ({
      sku, name: v.name, qty: round2(v.qty), gross: round2(v.gross), gp: round2(v.gp),
      gpPct: v.gross ? round2((v.gp / v.gross) * 100) : 0,
      branches: toRows(v.br, bLabel), employees: toRows(v.em, eLabel),
    }))
    .sort((a, b) => b.gross - a.gross);
}

// ── สรุป AI รายวัน (heuristic) ─────────────────────────────────────
export interface BriefBullet { tone: "ok" | "warn" | "info"; text: string }
export interface DailyBrief { headline: string; bullets: BriefBullet[] }

const fmtB = (n: number) => "฿" + Math.round(n).toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);

/** วิเคราะห์ยอดวันนี้เทียบเมื่อวาน + ชี้จุดเด่น/จุดต้องระวัง (3 ภาษา) */
export function dailyBrief(today: Order[], yesterday: Order[], branches: Branch[], l: Locale): DailyBrief {
  const t = financeSummary(today);
  const y = financeSummary(yesterday);
  const growth = pct(t.gross, y.gross);
  const bullets: BriefBullet[] = [];

  // 1) เติบโต
  const up = growth >= 0;
  bullets.push({
    tone: up ? "ok" : "warn",
    text: tr(l,
      `ยอดรับชำระวันนี้ ${fmtB(t.gross)} จาก ${t.orders} บิล ${up ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(growth)}% เทียบเมื่อวาน (${fmtB(y.gross)})`,
      `Today ${fmtB(t.gross)} from ${t.orders} bills, ${up ? "up" : "down"} ${Math.abs(growth)}% vs yesterday (${fmtB(y.gross)})`,
      `今日收款 ${fmtB(t.gross)}，${t.orders} 单，环比${up ? "增长" : "下降"} ${Math.abs(growth)}%（昨日 ${fmtB(y.gross)}）`),
  });

  // 2) เงินสด vs เข้าระบบ
  if (t.gross > 0) {
    const cashPct = Math.round((t.cash / t.gross) * 100);
    bullets.push({
      tone: cashPct > 60 ? "warn" : "info",
      text: tr(l,
        `เงินสด ${cashPct}% (${fmtB(t.cash)}) ต้องนับ/นำฝากเอง · เข้าระบบอัตโนมัติ ${fmtB(t.system)}${cashPct > 60 ? " — สัดส่วนเงินสดสูง ควรตรวจการนำฝาก" : ""}`,
        `Cash ${cashPct}% (${fmtB(t.cash)}) needs manual deposit · auto-to-bank ${fmtB(t.system)}${cashPct > 60 ? " — high cash ratio, verify deposits" : ""}`,
        `现金 ${cashPct}%（${fmtB(t.cash)}）需人工存入 · 自动入账 ${fmtB(t.system)}${cashPct > 60 ? " — 现金占比高，请核对存款" : ""}`),
    });
  }

  // 3) ค่าธรรมเนียม
  if (t.fee > 0) {
    bullets.push({
      tone: "info",
      text: tr(l,
        `ค่าธรรมเนียมบัตร/EDC วันนี้ ${fmtB(t.fee)} → รับสุทธิ ${fmtB(t.net)}`,
        `Card/EDC fees today ${fmtB(t.fee)} → net ${fmtB(t.net)}`,
        `今日刷卡/EDC手续费 ${fmtB(t.fee)} → 净收 ${fmtB(t.net)}`),
    });
  }

  // 4) สาขาเด่น + สาขาที่ยังไม่มีขาย
  const rows = financeByBranch(today, branches, l);
  if (rows.length) {
    const top = rows[0];
    bullets.push({
      tone: "ok",
      text: tr(l,
        `สาขาทำยอดสูงสุด: ${top.label} ${fmtB(top.gross)} (${top.orders} บิล)`,
        `Top branch: ${top.label} ${fmtB(top.gross)} (${top.orders} bills)`,
        `最高门店：${top.label} ${fmtB(top.gross)}（${top.orders} 单）`),
    });
  }
  const selling = new Set(rows.map((r) => r.id));
  const idle = branches.filter((b) => !selling.has(b.id));
  if (branches.length > 1 && idle.length) {
    bullets.push({
      tone: "warn",
      text: tr(l,
        `${idle.length} สาขายังไม่มีการขายวันนี้: ${idle.slice(0, 3).map((b) => b.name_th ?? b.name).join(", ")}${idle.length > 3 ? "…" : ""}`,
        `${idle.length} branch(es) no sales today: ${idle.slice(0, 3).map((b) => b.name).join(", ")}${idle.length > 3 ? "…" : ""}`,
        `${idle.length} 家门店今日无销售：${idle.slice(0, 3).map((b) => b.name).join("、")}${idle.length > 3 ? "…" : ""}`),
    });
  }

  const headline = up
    ? tr(l, `วันนี้ไปได้ดี · โต ${growth}%`, `Good day · +${growth}%`, `今天不错 · +${growth}%`)
    : tr(l, `วันนี้ชะลอ · ${growth}%`, `Slower day · ${growth}%`, `今天放缓 · ${growth}%`);
  return { headline, bullets };
}
