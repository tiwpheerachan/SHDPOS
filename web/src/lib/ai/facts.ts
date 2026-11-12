// =====================================================================
// Fact pack — คำนวณ "ตัวเลขสรุป" จริงด้วยโค้ด (ไม่ให้ LLM คิดเอง)
//   เทียบช่วงปัจจุบัน vs ช่วงก่อนหน้าระยะเท่ากัน (clamp ช่วงที่ยังไม่จบ)
//   ส่งให้ LLM เฉพาะ aggregate + นิยาม + ช่วงเวลา + ขอบเขต (ไม่มี PII ลูกค้า)
// =====================================================================
import type { Order } from "../types";
import type { Ctx, Locale } from "./engine";

const round2 = (n: number) => Math.round(n * 100) / 100;
const live = (o: Order) => o.status !== "voided";
const inRange = (o: Order, a: number, b: number) => { const t = new Date(o.created_at).getTime(); return t >= a && t <= b; };

export interface Trend { cur: number; prev: number; deltaPct: number | null } // deltaPct=null เมื่อฐานก่อนเป็น 0 (กันเข้าใจผิด)
export interface DimRow { name: string; sales: number; deltaPct: number | null; sharePct: number; qty?: number }

export interface FactPack {
  period: { from: string; to: string; days: number; unfinished: boolean };
  prevPeriod: { from: string; to: string };
  scope: { branchesInScope: number; branchesWithSales: number; latestOrder: string | null; ordersInScope: number; note: string };
  totals: {
    sales: Trend; orders: Trend; aov: Trend; gp: Trend; units: Trend; discount: Trend;
    gpPctCur: number; gpPctPrev: number;
  };
  decomposition: { ordersDeltaPct: number | null; aovDeltaPct: number | null }; // ตัวขับเคลื่อนการเปลี่ยนแปลงยอดขาย
  byBranch: DimRow[];
  byBrand: DimRow[];
  byProduct: DimRow[];
  byEmployee: DimRow[];
  byChannel: DimRow[];
  idleBranches: string[];          // สาขาในสิทธิ์ที่ไม่มีการขายในช่วงนี้
  decliners: { name: string; deltaPct: number }[]; // สาขายอดตก >10% เทียบช่วงก่อน
}

const sumSales = (os: Order[]) => os.reduce((s, o) => s + o.grand_total, 0);
const trend = (cur: number, prev: number): Trend => ({ cur: round2(cur), prev: round2(prev), deltaPct: prev > 0 ? round2(((cur - prev) / prev) * 100) : null });

function groupSales(os: Order[], key: (o: Order) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of os) { const k = key(o); if (k == null) continue; m.set(k, (m.get(k) ?? 0) + o.grand_total); }
  return m;
}
function groupItemSales(os: Order[], key: (o: Order, it: Order["items"][number]) => string | null, withQty = false): Map<string, { sales: number; qty: number }> {
  const m = new Map<string, { sales: number; qty: number }>();
  for (const o of os) for (const it of o.items) { const k = key(o, it); if (k == null) continue; const c = m.get(k) ?? { sales: 0, qty: 0 }; c.sales += it.line_total; if (withQty) c.qty += it.qty; m.set(k, c); }
  return m;
}

/** สร้าง fact pack จาก orders ที่อยู่ในสิทธิ์แล้ว (scoped) + ช่วงเวลา filter */
export function buildFactPack(scoped: Order[], ctx: Ctx, filter: { from: Date; to: Date }, l: Locale): FactPack {
  const all = scoped.filter(live);
  const now = Date.now();
  const from = filter.from.getTime();
  const toRaw = filter.to.getTime();
  const to = Math.min(toRaw, now);
  const len = Math.max(1, to - from);
  const prevTo = from - 1;
  const prevFrom = prevTo - len;
  const unfinished = toRaw > now + 1000;

  const cur = all.filter((o) => inRange(o, from, to));
  const prev = all.filter((o) => inRange(o, prevFrom, prevTo));

  const agg = (os: Order[]) => {
    let sales = 0, gp = 0, discount = 0, units = 0; const ids = new Set<string>();
    for (const o of os) { sales += o.grand_total; gp += o.gross_profit; discount += o.discount_total; ids.add(o.id); for (const it of o.items) units += it.qty; }
    return { sales, gp, discount, units, orders: ids.size, aov: ids.size ? sales / ids.size : 0 };
  };
  const a = agg(cur), p = agg(prev);

  const bName = (id: string) => { const b = ctx.branches.find((x) => x.id === id); return b ? (l === "th" ? b.name_th ?? b.name : b.name) : id; };
  const eName = (id: string) => { const e = ctx.employees.find((x) => x.id === id); return e ? (e.nickname ?? e.first_name ?? e.employee_code) : id; };
  const brandOf = new Map(ctx.branches.map((b) => [b.id, b.brand_id]));
  const brandName = (id: string) => ctx.brands.find((x) => x.id === id)?.name ?? id;
  const CHAN: Record<string, string> = { offline: "หน้าร้าน", online_shopee: "Shopee", online_lazada: "Lazada", online_tiktok: "TikTok", online_website: "เว็บไซต์", event: "อีเวนต์", b2b: "B2B", other: "อื่นๆ" };

  const mkDim = (curMap: Map<string, number>, prevMap: Map<string, number>, label: (k: string) => string, qtyMap?: Map<string, { sales: number; qty: number }>, top = 8): DimRow[] => {
    const total = Array.from(curMap.values()).reduce((s, v) => s + v, 0) || 1;
    return Array.from(curMap.entries())
      .map(([k, sales]) => { const pv = prevMap.get(k) ?? 0; return { name: label(k), sales: round2(sales), deltaPct: pv > 0 ? round2(((sales - pv) / pv) * 100) : null, sharePct: round2((sales / total) * 100), qty: qtyMap ? round2(qtyMap.get(k)?.qty ?? 0) : undefined }; })
      .sort((x, y) => y.sales - x.sales).slice(0, top);
  };

  // รายสาขา (+ delta เทียบช่วงก่อน)
  const curBr = groupSales(cur, (o) => o.branch_id), prevBr = groupSales(prev, (o) => o.branch_id);
  const byBranch = mkDim(curBr, prevBr, bName);
  // รายแบรนด์
  const curBd = groupSales(cur, (o) => brandOf.get(o.branch_id) ?? null), prevBd = groupSales(prev, (o) => brandOf.get(o.branch_id) ?? null);
  const byBrand = mkDim(curBd, prevBd, brandName);
  // ช่องทาง
  const curCh = groupSales(cur, (o) => o.channel), prevCh = groupSales(prev, (o) => o.channel);
  const byChannel = mkDim(curCh, prevCh, (k) => CHAN[k] ?? k, undefined, 6);
  // สินค้า (item-level, + qty)
  const curPr = groupItemSales(cur, (_o, it) => it.sku || it.product_id || it.name, true);
  const prevPr = groupItemSales(prev, (_o, it) => it.sku || it.product_id || it.name);
  const curPrS = new Map(Array.from(curPr, ([k, v]) => [k, v.sales]));
  const prevPrS = new Map(Array.from(prevPr, ([k, v]) => [k, v.sales]));
  const nameByKey = new Map<string, string>(); for (const o of cur) for (const it of o.items) nameByKey.set(it.sku || it.product_id || it.name, it.name);
  const byProduct = mkDim(curPrS, prevPrS, (k) => nameByKey.get(k) ?? k, curPr, 8);
  // พนักงาน (item-level)
  const curEm = groupItemSales(cur, (o, it) => it.salesperson_id ?? o.salesperson_id ?? o.cashier_id ?? null);
  const prevEm = groupItemSales(prev, (o, it) => it.salesperson_id ?? o.salesperson_id ?? o.cashier_id ?? null);
  const byEmployee = mkDim(new Map(Array.from(curEm, ([k, v]) => [k, v.sales])), new Map(Array.from(prevEm, ([k, v]) => [k, v.sales])), eName, undefined, 8);

  // สาขาที่ไม่มีการขาย + สาขายอดตก
  const sellingBranchIds = new Set(cur.map((o) => o.branch_id));
  const idleBranches = ctx.branches.filter((b) => !sellingBranchIds.has(b.id)).map((b) => l === "th" ? b.name_th ?? b.name : b.name);
  const decliners = Array.from(curBr.entries())
    .map(([id, sales]) => { const pv = prevBr.get(id) ?? 0; return { name: bName(id), deltaPct: pv > 0 ? round2(((sales - pv) / pv) * 100) : 0, hasPrev: pv > 0 }; })
    .filter((d) => d.hasPrev && d.deltaPct <= -10).sort((x, y) => x.deltaPct - y.deltaPct).slice(0, 5)
    .map(({ name, deltaPct }) => ({ name, deltaPct }));

  const latest = all.reduce<string | null>((m, o) => (!m || o.created_at > m ? o.created_at : m), null);
  const iso = (ms: number) => new Date(ms).toISOString();

  return {
    period: { from: iso(from), to: iso(to), days: round2(len / 86400000), unfinished },
    prevPeriod: { from: iso(prevFrom), to: iso(prevTo) },
    scope: {
      branchesInScope: ctx.branches.length, branchesWithSales: sellingBranchIds.size,
      latestOrder: latest, ordersInScope: a.orders,
      note: "Local synced data only — totals reflect orders synced to this device within the user's permission scope; not guaranteed company-wide unless all branches are synced.",
    },
    totals: {
      sales: trend(a.sales, p.sales), orders: trend(a.orders, p.orders), aov: trend(a.aov, p.aov),
      gp: trend(a.gp, p.gp), units: trend(a.units, p.units), discount: trend(a.discount, p.discount),
      gpPctCur: a.sales ? round2((a.gp / a.sales) * 100) : 0, gpPctPrev: p.sales ? round2((p.gp / p.sales) * 100) : 0,
    },
    decomposition: {
      ordersDeltaPct: p.orders > 0 ? round2(((a.orders - p.orders) / p.orders) * 100) : null,
      aovDeltaPct: p.aov > 0 ? round2(((a.aov - p.aov) / p.aov) * 100) : null,
    },
    byBranch, byBrand, byProduct, byEmployee, byChannel, idleBranches, decliners,
  };
}

// ── บทวิเคราะห์ในเครื่อง (เมื่อไม่มี LLM) — อ้างตัวเลขจริงจาก fact pack ──
export interface Insight { text: string; tone: "ok" | "warn" | "info" }
const fB = (n: number) => "฿" + Math.round(n).toLocaleString("en-US");
const pct = (n: number | null) => (n == null ? "—" : (n >= 0 ? "+" : "") + n + "%");

export function localInsights(f: FactPack, l: Locale): Insight[] {
  const th = l === "th";
  const out: Insight[] = [];
  const g = f.totals.sales.deltaPct;
  out.push({
    tone: g == null ? "info" : g >= 0 ? "ok" : "warn",
    text: th
      ? `ยอดขาย ${fB(f.totals.sales.cur)} (${pct(g)} เทียบช่วงก่อน ${fB(f.totals.sales.prev)}) · ขับเคลื่อนโดยจำนวนบิล ${pct(f.decomposition.ordersDeltaPct)} และยอดเฉลี่ย/บิล ${pct(f.decomposition.aovDeltaPct)}`
      : `Sales ${fB(f.totals.sales.cur)} (${pct(g)} vs prev ${fB(f.totals.sales.prev)}) · driven by bills ${pct(f.decomposition.ordersDeltaPct)} and AOV ${pct(f.decomposition.aovDeltaPct)}`,
  });
  out.push({
    tone: "info",
    text: th
      ? `กำไรขั้นต้น ${fB(f.totals.gp.cur)} (${f.totals.gpPctCur}% ของยอด · ช่วงก่อน ${f.totals.gpPctPrev}%)`
      : `Gross profit ${fB(f.totals.gp.cur)} (${f.totals.gpPctCur}% of sales · prev ${f.totals.gpPctPrev}%)`,
  });
  if (f.byBranch[0]) out.push({ tone: "ok", text: th ? `สาขาสูงสุด: ${f.byBranch[0].name} ${fB(f.byBranch[0].sales)} (${pct(f.byBranch[0].deltaPct)})` : `Top branch: ${f.byBranch[0].name} ${fB(f.byBranch[0].sales)} (${pct(f.byBranch[0].deltaPct)})` });
  if (f.decliners.length) out.push({ tone: "warn", text: th ? `สาขายอดตก: ${f.decliners.map((d) => `${d.name} ${d.deltaPct}%`).join(", ")} — ควรตรวจ (สมมติฐาน)` : `Declining: ${f.decliners.map((d) => `${d.name} ${d.deltaPct}%`).join(", ")} — to check` });
  else if (f.idleBranches.length) out.push({ tone: "warn", text: th ? `${f.idleBranches.length} สาขายังไม่มีการขายในช่วงนี้: ${f.idleBranches.slice(0, 3).join(", ")}${f.idleBranches.length > 3 ? "…" : ""}` : `${f.idleBranches.length} branch(es) no sales: ${f.idleBranches.slice(0, 3).join(", ")}` });
  return out.slice(0, 4);
}
