// =====================================================================
// การรวมยอด (aggregation) สำหรับ dashboard
// คิดจากบิลในเครื่อง — ในโหมด live สามารถสลับไปอ่าน view v_daily_sales
// บน Supabase ได้โดยไม่ต้องแก้ UI (โครงสร้างผลลัพธ์เหมือนกัน)
// =====================================================================

import type { Branch, Employee, Order, Product, StockLevel } from "./types";
import { round2 } from "./money";

export interface Totals {
  gross: number;
  orders: number;
  units: number;
  discount: number;
  cost: number;
  grossProfit: number;
  avgBasket: number;
  gpPercent: number;
}

export function summarize(orders: Order[]): Totals {
  let gross = 0, discount = 0, cost = 0, units = 0;
  let count = 0;
  for (const o of orders) {
    if (o.status === "voided") continue;
    count++;
    gross += o.grand_total;
    discount += o.discount_total;
    cost += o.cost_total;
    for (const it of o.items) units += it.qty;
  }
  const base = gross / 1.07;
  const gp = base - cost;
  return {
    gross: round2(gross),
    orders: count,
    units: round2(units),
    discount: round2(discount),
    cost: round2(cost),
    grossProfit: round2(gp),
    avgBasket: count ? round2(gross / count) : 0,
    gpPercent: gross ? round2((gp / gross) * 100) : 0,
  };
}

export function filterOrders(
  orders: Order[],
  opts: { from?: Date; to?: Date; branchIds?: string[]; brandIds?: string[]; branches: Branch[] }
): Order[] {
  const branchSet = opts.branchIds?.length ? new Set(opts.branchIds) : null;
  const brandSet = opts.brandIds?.length ? new Set(opts.brandIds) : null;
  const branchBrand = new Map(opts.branches.map((b) => [b.id, b.brand_id]));
  const from = opts.from?.toISOString();
  const to = opts.to?.toISOString();

  return orders.filter((o) => {
    if (from && o.created_at < from) return false;
    if (to && o.created_at > to) return false;
    if (branchSet && !branchSet.has(o.branch_id)) return false;
    if (brandSet) {
      const bid = branchBrand.get(o.branch_id);
      if (!bid || !brandSet.has(bid)) return false;
    }
    return true;
  });
}

/**
 * ตัวกรองแบบครอบคลุมทุกมิติสำหรับ Command Center
 * ส่ง criteria เป็น array (ว่าง = ไม่กรอง) พร้อม context (branches, products)
 */
export interface OrderFilter {
  from?: Date;
  to?: Date;
  brandIds?: string[];
  branchIds?: string[];
  provinces?: string[];
  storeTypes?: string[];
  salespersonIds?: string[];
  cashierIds?: string[];
  categoryIds?: string[];
  skus?: string[];
  paymentMethods?: string[];
  channels?: string[];
  orderStatuses?: string[];
  customerTypes?: string[]; // 'walkin' | 'member'
  posIds?: string[];        // terminal_id
  flags?: string[];         // 'discounted' | 'returned'
}

export function applyOrderFilters(
  orders: Order[],
  f: OrderFilter,
  ctx: { branches: Branch[]; products?: Product[] }
): Order[] {
  const branchBrand = new Map(ctx.branches.map((b) => [b.id, b.brand_id]));
  const branchProv = new Map(ctx.branches.map((b) => [b.id, b.province ?? ""]));
  const branchType = new Map(ctx.branches.map((b) => [b.id, b.branch_type]));
  const catById = new Map((ctx.products ?? []).map((p) => [p.id, p.category_id]));
  const catBySku = new Map((ctx.products ?? []).map((p) => [p.sku, p.category_id]));

  const set = (a?: string[]) => (a && a.length ? new Set(a) : null);
  const brand = set(f.brandIds), branch = set(f.branchIds), prov = set(f.provinces),
    stype = set(f.storeTypes), sp = set(f.salespersonIds), cashier = set(f.cashierIds),
    cat = set(f.categoryIds), sku = set(f.skus), pay = set(f.paymentMethods),
    chan = set(f.channels), status = set(f.orderStatuses), cust = set(f.customerTypes),
    pos = set(f.posIds), flags = set(f.flags);
  const from = f.from?.toISOString(), to = f.to?.toISOString();

  return orders.filter((o) => {
    if (from && o.created_at < from) return false;
    if (to && o.created_at > to) return false;
    if (branch && !branch.has(o.branch_id)) return false;
    if (brand) { const b = branchBrand.get(o.branch_id); if (!b || !brand.has(b)) return false; }
    if (prov && !prov.has(branchProv.get(o.branch_id) ?? "")) return false;
    if (stype && !stype.has(branchType.get(o.branch_id) ?? "")) return false;
    if (cashier && !(o.cashier_id && cashier.has(o.cashier_id))) return false;
    if (sp) {
      const ok = (o.salesperson_id && sp.has(o.salesperson_id)) || o.items.some((it) => it.salesperson_id && sp.has(it.salesperson_id));
      if (!ok) return false;
    }
    if (chan && !chan.has(o.channel)) return false;
    if (status && !status.has(o.status)) return false;
    if (pos && !(o.terminal_id && pos.has(o.terminal_id))) return false;
    if (pay && !o.payments.some((p) => pay.has(p.method))) return false;
    if (cust) {
      const type = o.customer_phone || o.customer_name ? "member" : "walkin";
      if (!cust.has(type)) return false;
    }
    if (cat && !o.items.some((it) => { const c = it.product_id ? catById.get(it.product_id) : catBySku.get(it.sku); return c && cat.has(c); })) return false;
    if (sku && !o.items.some((it) => sku.has(it.sku))) return false;
    if (flags) {
      if (flags.has("discounted") && !(o.discount_total > 0)) return false;
      if (flags.has("returned") && !(o.status === "refunded" || o.status === "partially_refunded")) return false;
    }
    return true;
  });
}

/** ยอดขายรายวัน — เติมวันที่ที่ไม่มีบิลด้วย 0 เพื่อให้กราฟต่อเนื่อง */
export function dailySeries(orders: Order[], from: Date, to: Date): { label: string; value: number; date: string }[] {
  const map = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    const d = new Date(o.created_at).toISOString().slice(0, 10);
    map.set(d, (map.get(d) ?? 0) + o.grand_total);
  }
  const out: { label: string; value: number; date: string }[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({
      date: key,
      label: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
      value: round2(map.get(key) ?? 0),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export type TimeGran = "day" | "month" | "year";

function bucketKey(d: Date, gran: TimeGran): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return gran === "year" ? `${y}` : gran === "month" ? `${y}-${m}` : `${y}-${m}-${day}`;
}
function bucketLabel(key: string, gran: TimeGran): string {
  if (gran === "year") return key;              // YYYY
  if (gran === "month") return key.slice(2);    // YY-MM
  return key.slice(5);                          // MM-DD
}

/**
 * ยอดขายต่อช่วงเวลา (รายวัน/เดือน/ปี)
 *  - ไม่ใส่ employeeId → รวมทั้งหมด (ใช้ grand_total)
 *  - ใส่ employeeId → นับเฉพาะ line_total ของรายการที่คนนั้นเป็นผู้ขาย
 */
export function salesSeries(
  orders: Order[],
  gran: TimeGran,
  employeeId?: string | null
): { label: string; value: number; orders: number }[] {
  const map = new Map<string, { gross: number; ids: Set<string> }>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    const key = bucketKey(new Date(o.created_at), gran);
    const cur = map.get(key) ?? { gross: 0, ids: new Set<string>() };
    if (employeeId) {
      let add = 0, hit = false;
      for (const it of o.items) {
        const eid = it.salesperson_id ?? o.salesperson_id ?? o.cashier_id;
        if (eid === employeeId) { add += it.line_total; hit = true; }
      }
      if (hit) { cur.gross += add; cur.ids.add(o.id); }
    } else {
      cur.gross += o.grand_total; cur.ids.add(o.id);
    }
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => ({ label: bucketLabel(k, gran), value: round2(v.gross), orders: v.ids.size }));
}

export function hourlySeries(orders: Order[]): { label: string; value: number }[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const o of orders) {
    if (o.status === "voided") continue;
    buckets[new Date(o.created_at).getHours()] += o.grand_total;
  }
  return buckets
    .map((v, h) => ({ label: String(h).padStart(2, "0"), value: round2(v) }))
    .filter((_, h) => h >= 8 && h <= 23);
}

export function byBranch(orders: Order[], branches: Branch[], locale: "th" | "en" | "zh" = "th") {
  const map = new Map<string, { gross: number; orders: number; gp: number }>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    const cur = map.get(o.branch_id) ?? { gross: 0, orders: 0, gp: 0 };
    cur.gross += o.grand_total;
    cur.orders += 1;
    cur.gp += o.gross_profit;
    map.set(o.branch_id, cur);
  }
  return Array.from(map.entries())
    .map(([id, v]) => {
      const b = branches.find((x) => x.id === id);
      return {
        id,
        label: b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id,
        value: round2(v.gross),
        orders: v.orders,
        grossProfit: round2(v.gp),
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function byBrand(orders: Order[], branches: Branch[], brandNames: Map<string, string>) {
  const branchBrand = new Map(branches.map((b) => [b.id, b.brand_id]));
  const map = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    const bid = branchBrand.get(o.branch_id);
    if (!bid) continue;
    map.set(bid, (map.get(bid) ?? 0) + o.grand_total);
  }
  return Array.from(map.entries())
    .map(([id, v]) => ({ id, label: brandNames.get(id) ?? id, value: round2(v) }))
    .sort((a, b) => b.value - a.value);
}

export function byEmployee(orders: Order[], employees: Employee[]) {
  const map = new Map<string, { gross: number; orders: Set<string>; units: number; gp: number }>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    for (const it of o.items) {
      const eid = it.salesperson_id ?? o.salesperson_id ?? o.cashier_id;
      if (!eid) continue;
      const cur = map.get(eid) ?? { gross: 0, orders: new Set<string>(), units: 0, gp: 0 };
      cur.gross += it.line_total;
      cur.units += it.qty;
      cur.gp += it.gross_profit;
      cur.orders.add(o.id);
      map.set(eid, cur);
    }
  }
  return Array.from(map.entries())
    .map(([id, v]) => {
      const e = employees.find((x) => x.id === id);
      return {
        id,
        label: e ? e.nickname ?? e.first_name : id,
        code: e?.employee_code ?? "",
        branchId: e?.home_branch_id ?? null,
        value: round2(v.gross),
        orders: v.orders.size,
        units: round2(v.units),
        grossProfit: round2(v.gp),
        avgBasket: v.orders.size ? round2(v.gross / v.orders.size) : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function topProducts(orders: Order[], limit = 10) {
  const map = new Map<string, { name: string; qty: number; gross: number; gp: number }>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    for (const it of o.items) {
      const cur = map.get(it.sku) ?? { name: it.name, qty: 0, gross: 0, gp: 0 };
      cur.qty += it.qty;
      cur.gross += it.line_total;
      cur.gp += it.gross_profit;
      map.set(it.sku, cur);
    }
  }
  return Array.from(map.entries())
    .map(([sku, v]) => ({ sku, ...v, gross: round2(v.gross), gp: round2(v.gp) }))
    .sort((a, b) => b.gross - a.gross)
    .slice(0, limit);
}

export function paymentMix(orders: Order[]) {
  const map = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "voided") continue;
    for (const p of o.payments) map.set(p.method, (map.get(p.method) ?? 0) + p.amount);
  }
  return Array.from(map.entries())
    .map(([method, amount]) => ({ method, value: round2(amount) }))
    .sort((a, b) => b.value - a.value);
}

export function lowStockRows(products: Product[], stock: (StockLevel & { key: string })[], branches: Branch[], branchIds?: string[]) {
  const pMap = new Map(products.map((p) => [p.id, p]));
  const bMap = new Map(branches.map((b) => [b.id, b]));
  const set = branchIds?.length ? new Set(branchIds) : null;
  return stock
    .filter((s) => !set || set.has(s.branch_id))
    .map((s) => {
      const p = pMap.get(s.product_id);
      if (!p || !p.is_stocked) return null;
      const rp = Math.max(s.reorder_point, p.reorder_point);
      if (rp <= 0 || s.qty_on_hand > rp) return null;
      return {
        key: s.key,
        sku: p.sku,
        name: p.name_th,
        branch: bMap.get(s.branch_id)?.name_th ?? "",
        branchId: s.branch_id,
        qty: s.qty_on_hand,
        reorder: rp,
        critical: s.qty_on_hand <= 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.qty - b!.qty)) as {
      key: string; sku: string; name: string; branch: string; branchId: string;
      qty: number; reorder: number; critical: boolean;
    }[];
}
