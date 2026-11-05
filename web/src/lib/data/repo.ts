// =====================================================================
// Repository — ชั้นเดียวที่ UI คุยด้วย
//
// POS ทำงานกับฐานข้อมูลในเครื่อง (Dexie) เสมอ → ขายได้แม้เน็ตหลุด
// เมื่อมี Supabase env: bootstrap จะดึง master data ลงมา และงานเขียน
// จะถูก enqueue ไปซิงก์ต่อ (ดู offline/sync.ts)
// =====================================================================

import { nanoid } from "nanoid";
import { db, kvGet, kvSet, stockKey, type HeldBill } from "../offline/db";
import { enqueue } from "../offline/sync";
import { supabase, isLiveMode } from "../supabase/client";
import {
  DEMO_BRANDS, DEMO_BRANCHES, DEMO_TERMINALS, DEMO_EMPLOYEES, DEMO_PRODUCTS,
  DEMO_CATEGORIES, DEMO_CUSTOMERS, buildDemoStock, buildDemoOrders, buildDemoAudit,
} from "../demo-data";
import { computeTotals, lineTotal, lineDiscount, lineCost, round2, VAT_RATE } from "../money";
import type {
  Branch, Brand, Category, Employee, Order, OrderDraft, OrderItem, Product,
  Shift, StockLevel, Terminal, AuditEntry, Customer, ReturnDoc, ApprovalRequest,
  CountType, StockCountSession, Transfer, TransferStatus,
} from "../types";

const CATALOG_VERSION = "2026-09-16.1";

// ---------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------
let bootstrapped: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  if (!bootstrapped) bootstrapped = doBootstrap();
  return bootstrapped;
}

async function doBootstrap(): Promise<void> {
  const version = await kvGet<string>("catalog_version", "");
  const productCount = await db().products.count();
  const cached = version === CATALOG_VERSION && productCount > 0;

  if (cached) {
    // แคตตาล็อกมีในเครื่องแล้ว แต่พนักงาน/สาขาเปลี่ยนบ่อย (เพิ่มผู้ใช้ใหม่ ฯลฯ)
    // → รีเฟรชตารางเล็กเหล่านี้ทุกครั้งที่เปิดแอป เพื่อให้ชื่อในรายงานตรงเสมอ
    if (isLiveMode()) {
      try { await refreshDirectory(); } catch { /* ออฟไลน์: ใช้ของเดิมในเครื่องได้ */ }
    }
    return;
  }

  if (isLiveMode()) {
    await loadCatalogFromSupabase();
  } else {
    await seedDemo();
  }
  await kvSet("catalog_version", CATALOG_VERSION);
}

/** ดึงเฉพาะ master data ที่เปลี่ยนบ่อย (brands/branches/terminals/employees) ใหม่ */
async function refreshDirectory(): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const d = db();
  const [brands, branches, terminals, employees] = await Promise.all([
    sb.from("brands").select("*"),
    sb.from("branches").select("*"),
    sb.from("terminals").select("*"),
    sb.from("pos_employees").select("*"),
  ]);
  await d.transaction("rw", [d.brands, d.branches, d.terminals, d.employees], async () => {
    if (brands.data) await d.brands.bulkPut(brands.data as Brand[]);
    if (branches.data) await d.branches.bulkPut(branches.data as Branch[]);
    if (terminals.data) await d.terminals.bulkPut(terminals.data as Terminal[]);
    if (employees.data) {
      await d.employees.bulkPut(
        (employees.data as Record<string, unknown>[]).map((e) => ({
          ...(e as unknown as Employee),
          branch_ids: (e.branch_ids as string[]) ?? [],
          brand_ids: (e.brand_ids as string[]) ?? [],
        }))
      );
    }
  });
}

async function seedDemo(): Promise<void> {
  const d = db();
  const orders = buildDemoOrders(60);
  const audit = buildDemoAudit(orders);
  const stock = buildDemoStock().map((s) => ({ ...s, key: stockKey(s.branch_id, s.product_id) }));

  await d.transaction(
    "rw",
    [d.brands, d.branches, d.terminals, d.employees, d.products, d.categories, d.stock, d.customers, d.orders, d.audit],
    async () => {
      await Promise.all([
        d.brands.clear(), d.branches.clear(), d.terminals.clear(), d.employees.clear(),
        d.products.clear(), d.categories.clear(), d.stock.clear(), d.customers.clear(),
        d.orders.clear(), d.audit.clear(),
      ]);
      await d.brands.bulkPut(DEMO_BRANDS);
      await d.branches.bulkPut(DEMO_BRANCHES);
      await d.terminals.bulkPut(DEMO_TERMINALS);
      await d.employees.bulkPut(DEMO_EMPLOYEES);
      await d.products.bulkPut(DEMO_PRODUCTS);
      await d.categories.bulkPut(DEMO_CATEGORIES);
      await d.customers.bulkPut(DEMO_CUSTOMERS);
      await d.stock.bulkPut(stock);
      await d.orders.bulkPut(orders);
      await d.audit.bulkPut(audit);
    }
  );
}

async function loadCatalogFromSupabase(): Promise<void> {
  const sb = supabase();
  if (!sb) return seedDemo();
  const d = db();

  const [brands, branches, terminals, employees, products, categories, stock] = await Promise.all([
    sb.from("brands").select("*"),
    sb.from("branches").select("*"),
    sb.from("terminals").select("*"),
    sb.from("pos_employees").select("*"),
    sb.from("products").select("*, product_barcodes(barcode)"),
    sb.from("categories").select("*"),
    sb.from("stock_levels").select("*"),
  ]);

  await d.transaction("rw", [d.brands, d.branches, d.terminals, d.employees, d.products, d.categories, d.stock], async () => {
    if (brands.data) await d.brands.bulkPut(brands.data as Brand[]);
    if (branches.data) await d.branches.bulkPut(branches.data as Branch[]);
    if (terminals.data) await d.terminals.bulkPut(terminals.data as Terminal[]);
    if (employees.data) {
      await d.employees.bulkPut(
        (employees.data as Record<string, unknown>[]).map((e) => ({
          ...(e as unknown as Employee),
          branch_ids: (e.branch_ids as string[]) ?? [],
          brand_ids: (e.brand_ids as string[]) ?? [],
        }))
      );
    }
    if (products.data) {
      await d.products.bulkPut(
        (products.data as Record<string, unknown>[]).map((p) => ({
          ...(p as unknown as Product),
          barcodes: ((p.product_barcodes as { barcode: string }[]) ?? []).map((b) => b.barcode),
        }))
      );
    }
    if (categories.data) await d.categories.bulkPut(categories.data as Category[]);
    if (stock.data) {
      await d.stock.bulkPut(
        (stock.data as StockLevel[]).map((s) => ({ ...s, key: stockKey(s.branch_id, s.product_id) }))
      );
    }
  });
}

/** ล้างข้อมูลในเครื่องทั้งหมดแล้ว bootstrap ใหม่ (สลับ demo↔live ได้สะอาด) */
export async function resetLocalData(): Promise<void> {
  const d = db();
  await Promise.all([
    d.brands.clear(), d.branches.clear(), d.terminals.clear(), d.employees.clear(),
    d.products.clear(), d.categories.clear(), d.stock.clear(), d.customers.clear(),
    d.orders.clear(), d.returns.clear(), d.quotations.clear(), d.transfers.clear(),
    d.shifts.clear(), d.approvals.clear(), d.audit.clear(), d.holds.clear(),
    d.pending.clear(), d.stock_counts.clear(),
  ]);
  await kvSet("catalog_version", "");
  bootstrapped = null;
  await bootstrap();
}

// ---------------------------------------------------------------------
// MASTER DATA
// ---------------------------------------------------------------------
export const listBrands = () => db().brands.toArray();
export const listBranches = () => db().branches.toArray();
export const listTerminals = () => db().terminals.toArray();
export const listEmployees = () => db().employees.toArray();
export const listCategories = async () =>
  (await db().categories.toArray()).sort((a, b) => a.sort_order - b.sort_order);
export const listProducts = () => db().products.toArray();
export const listCustomers = () => db().customers.toArray();

export async function getBranch(branchId: string): Promise<Branch | undefined> {
  return db().branches.get(branchId);
}

export async function getTerminalForBranch(branchId: string): Promise<Terminal | undefined> {
  return db().terminals.where("branch_id").equals(branchId).first();
}

export async function employeesAtBranch(branchId: string): Promise<Employee[]> {
  const all = await db().employees.toArray();
  return all.filter((e) => e.status === "active" && (e.home_branch_id === branchId || e.branch_ids.includes(branchId)));
}

export async function findEmployeeByCode(code: string): Promise<Employee | undefined> {
  return db().employees.where("employee_code").equalsIgnoreCase(code).first();
}

// ---------------------------------------------------------------------
// STOCK
// ---------------------------------------------------------------------
export async function stockForBranch(branchId: string): Promise<Map<string, StockLevel>> {
  const rows = await db().stock.where("branch_id").equals(branchId).toArray();
  return new Map(rows.map((r) => [r.product_id, r]));
}

export async function stockAll(): Promise<(StockLevel & { key: string })[]> {
  return db().stock.toArray();
}

export async function adjustStock(
  branchId: string,
  productId: string,
  delta: number
): Promise<void> {
  const key = stockKey(branchId, productId);
  const row = await db().stock.get(key);
  if (!row) {
    await db().stock.put({
      key, branch_id: branchId, product_id: productId,
      qty_on_hand: delta, qty_reserved: 0, reorder_point: 0,
    });
    return;
  }
  await db().stock.update(key, { qty_on_hand: round2(row.qty_on_hand + delta) });
}

/**
 * Transfers (Phase 4) — โอนย้ายระหว่างสาขา
 * หลักการ: สต๊อกปลายทางเพิ่มตอน "รับจริง" เท่านั้น (ไม่ใช่ตอนต้นทางกดส่ง)
 */
export async function listTransfersForBranch(branchId: string): Promise<Transfer[]> {
  const rows = await db().transfers.reverse().sortBy("created_at");
  return rows.filter((r) => r.from_branch_id === branchId || r.to_branch_id === branchId);
}

export async function createTransfer(
  fromBranchId: string, toBranchId: string, employeeId: string,
  lines: { product_id: string; sku: string; name: string; qty: number }[],
  note: string, autoApprove: boolean
): Promise<Transfer> {
  const tr: Transfer = {
    id: nanoid(),
    transfer_no: `TF-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
    from_branch_id: fromBranchId, to_branch_id: toBranchId,
    status: autoApprove ? "approved" : "pending_approval",
    items: lines.map((l) => ({ product_id: l.product_id, sku: l.sku, name: l.name, qty_requested: l.qty, qty_shipped: 0, qty_received: 0 })),
    requested_by: employeeId, note: note || null, created_at: new Date().toISOString(),
  };
  await db().transfers.put(tr);
  await writeAudit({ action: "transfer", actor_id: employeeId, branch_id: fromBranchId, ref_table: "transfers", ref_no: tr.transfer_no, amount: null, after_data: { status: tr.status, to: toBranchId }, is_offline: false });
  return tr;
}

/** ต้นทางจัดส่ง → ตัดสต๊อกต้นทาง + set qty_shipped */
export async function shipTransfer(tr: Transfer, employeeId: string): Promise<void> {
  const items = tr.items.map((it) => ({ ...it, qty_shipped: it.qty_requested }));
  for (const it of items) await adjustStock(tr.from_branch_id, it.product_id, -it.qty_shipped);
  await db().transfers.update(tr.id, { status: "in_transit", items });
  await writeAudit({ action: "transfer", actor_id: employeeId, branch_id: tr.from_branch_id, ref_table: "transfers", ref_no: tr.transfer_no, amount: null, after_data: { status: "in_transit", shipped: items.reduce((s, i) => s + i.qty_shipped, 0) }, is_offline: false });
}

/** ปลายทางสแกนรับของจริง → เพิ่มสต๊อกปลายทางตามที่รับ + set qty_received */
export async function receiveTransfer(tr: Transfer, employeeId: string, received: Record<string, number>): Promise<void> {
  const items = tr.items.map((it) => ({ ...it, qty_received: received[it.product_id] ?? 0 }));
  for (const it of items) if (it.qty_received > 0) await adjustStock(tr.to_branch_id, it.product_id, it.qty_received);
  const complete = items.every((it) => it.qty_received >= (it.qty_shipped || it.qty_requested));
  const status: TransferStatus = complete ? "completed" : "partial_received";
  await db().transfers.update(tr.id, { status, items });
  await writeAudit({ action: "transfer", actor_id: employeeId, branch_id: tr.to_branch_id, ref_table: "transfers", ref_no: tr.transfer_no, amount: null, after_data: { status, received: items.reduce((s, i) => s + i.qty_received, 0) }, is_offline: false });
}

/**
 * Stock Count Sessions (Phase 6) — สร้างรอบนับ + workflow + อนุมัติปรับสต๊อก → ledger
 */
export async function createCountSession(
  branchId: string,
  employeeId: string,
  opts: { zone: string; type: CountType; blind: boolean; categoryId?: string; brandId?: string; note?: string }
): Promise<StockCountSession> {
  const [products, stock] = await Promise.all([db().products.toArray(), stockForBranch(branchId)]);
  let candidates = products.filter((p) => p.is_stocked && stock.has(p.id));
  if (opts.type === "category" && opts.categoryId) candidates = candidates.filter((p) => p.category_id === opts.categoryId);
  if (opts.type === "brand" && opts.brandId) candidates = candidates.filter((p) => p.brand_id === opts.brandId);
  if (opts.type === "serial") candidates = candidates.filter((p) => p.track_serial);
  if (opts.type === "random") candidates = [...candidates].sort(() => Math.random() - 0.5).slice(0, 15);

  const now = new Date().toISOString();
  const session: StockCountSession = {
    id: nanoid(),
    count_no: `SC-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
    branch_id: branchId, zone: opts.zone, type: opts.type, status: "counting", blind: opts.blind, note: opts.note ?? null,
    lines: candidates.map((p) => ({ product_id: p.id, sku: p.sku, name: p.name_th, expected: stock.get(p.id)!.qty_on_hand, counted: null })),
    created_by: employeeId, created_at: now,
  };
  await db().stock_counts.put(session);
  return session;
}

export async function listCountSessions(branchId: string): Promise<StockCountSession[]> {
  const rows = await db().stock_counts.reverse().sortBy("created_at");
  return rows.filter((r) => r.branch_id === branchId);
}

export async function saveCountSession(session: StockCountSession): Promise<void> {
  await db().stock_counts.put(session);
}

/** อนุมัติรอบนับ → ปรับสต๊อกตามส่วนต่าง + เขียน ledger (audit) + ปิดรอบ */
export async function approveCountSession(session: StockCountSession, approverId: string): Promise<void> {
  for (const l of session.lines) {
    if (l.counted == null) continue;
    const delta = round2(l.counted - l.expected);
    if (delta === 0) continue;
    await adjustStock(session.branch_id, l.product_id, delta);
    await writeAudit({
      action: "stock_count",
      actor_id: approverId,
      branch_id: session.branch_id,
      ref_table: "stock_counts",
      ref_no: session.count_no,
      amount: null,
      after_data: { sku: l.sku, product_id: l.product_id, before: l.expected, after: l.counted, delta, stock_count_id: session.id },
      is_offline: false,
    });
  }
  await db().stock_counts.update(session.id, { status: "completed", approved_by: approverId, approved_at: new Date().toISOString() });
}

/**
 * รับสินค้าเข้า (Goods Receipt) — รับจาก supplier → เพิ่มสต๊อก + เขียน ledger (action "receive")
 */
export async function recordGoodsReceipt(
  branchId: string, employeeId: string, supplier: string, poRef: string, note: string,
  lines: { productId: string; sku: string; name: string; qty: number }[]
): Promise<string> {
  const grNo = `GR-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`;
  for (const l of lines) {
    if (l.qty <= 0) continue;
    await adjustStock(branchId, l.productId, l.qty);
    await writeAudit({
      action: "receive", actor_id: employeeId, branch_id: branchId,
      ref_table: "stock", ref_no: grNo, amount: null,
      after_data: { sku: l.sku, product_id: l.productId, qty: l.qty, delta: l.qty, supplier, po_ref: poRef, note },
      is_offline: false,
    });
  }
  return grNo;
}

/**
 * ปรับสต๊อกด้วยตนเอง (Stock Adjustment) — ปรับจำนวน + บันทึกเหตุผล
 * เขียน audit ต่อบรรทัด (มี sku/before/after/delta) เพื่อให้โผล่ใน Inventory Ledger
 */
export async function recordAdjustment(
  branchId: string,
  employeeId: string,
  reason: string,
  note: string,
  lines: { productId: string; sku: string; before: number; after: number }[]
): Promise<string> {
  const adjustNo = `ADJ-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`;
  for (const l of lines) {
    const delta = round2(l.after - l.before);
    if (delta === 0) continue;
    await adjustStock(branchId, l.productId, delta);
    await writeAudit({
      action: "adjustment",
      actor_id: employeeId,
      branch_id: branchId,
      ref_table: "stock",
      ref_no: adjustNo,
      amount: null,
      after_data: { sku: l.sku, product_id: l.productId, before: l.before, after: l.after, delta, reason, note },
      is_offline: false,
    });
  }
  return adjustNo;
}

// ---------------------------------------------------------------------
// การขาย — หัวใจของระบบ
// ลำดับสำคัญ: บันทึกบิล → ตัดสต๊อก → (ค่อยพิมพ์สลิปทีหลังใน UI)
// ---------------------------------------------------------------------
export interface SaleResult {
  order: Order;
  offline: boolean;
}

export async function commitSale(draft: OrderDraft): Promise<SaleResult> {
  // ยอดเงินเชื่อถือจาก draft (หน้าขายคำนวณรวมส่วนลดท้ายบิล + ส่วนลดจากแต้มแล้ว)
  // computeTotals ใช้แค่คิดต้นทุน/กำไรระดับบรรทัด
  const lineAgg = computeTotals(draft.items);
  const grandTotal = round2(draft.grand_total);
  const baseAmount = round2((grandTotal * 100) / (100 + VAT_RATE));
  const totals = {
    subtotal: round2(draft.subtotal),
    discountTotal: round2(draft.discount_total),
    grandTotal,
    vatAmount: round2(grandTotal - baseAmount),
    costTotal: lineAgg.costTotal,
    grossProfit: round2(baseAmount - lineAgg.costTotal),
  };
  const now = new Date().toISOString();
  const branch = await getBranch(draft.branch_id);
  const terminal = draft.terminal_id ? await db().terminals.get(draft.terminal_id) : undefined;
  const prefix = terminal?.receipt_prefix ?? branch?.code.slice(0, 3) ?? "POS";

  const seqKey = `seq:${prefix}:${now.slice(2, 10).replace(/-/g, "")}`;
  const seq = (await kvGet<number>(seqKey, 0)) + 1;
  await kvSet(seqKey, seq);

  const items: OrderItem[] = draft.items.map((l) => {
    const total = lineTotal(l);
    const cost = lineCost(l);
    return {
      id: nanoid(),
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      kind: l.kind,
      qty: l.qty,
      unit_price: l.unit_price,
      discount_amount: lineDiscount(l),
      line_total: total,
      unit_cost: l.unit_cost,
      cost_total: cost,
      gross_profit: round2(total / 1.07 - cost),
      serials: l.serials,
      salesperson_id: l.salesperson_id ?? draft.salesperson_id,
      returned_qty: 0,
    };
  });

  const order: Order = {
    id: nanoid(),
    order_no: `${prefix}-${now.slice(2, 10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`,
    client_uuid: draft.client_uuid,
    branch_id: draft.branch_id,
    terminal_id: draft.terminal_id,
    shift_id: draft.shift_id,
    cashier_id: draft.cashier_id,
    salesperson_id: draft.salesperson_id,
    customer_id: draft.customer_id ?? null,
    customer_name: draft.customer_name ?? null,
    customer_phone: draft.customer_phone ?? null,
    status: "completed",
    channel: draft.channel,
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    vat_amount: totals.vatAmount,
    grand_total: totals.grandTotal,
    paid_total: draft.paid_total,
    change_amount: draft.change_amount,
    cost_total: totals.costTotal,
    gross_profit: totals.grossProfit,
    items,
    payments: draft.payments,
    is_offline_origin: typeof navigator !== "undefined" ? !navigator.onLine : false,
    created_at: now,
  };

  // 1) บันทึกบิลลงเครื่องก่อน — ถึงตรงนี้ถือว่าขายสำเร็จแล้ว
  await db().orders.put(order);

  // 2) ตัดสต๊อก
  for (const it of items) {
    if (!it.product_id) continue;
    const p = await db().products.get(it.product_id);
    if (p?.is_stocked) await adjustStock(order.branch_id, it.product_id, -it.qty);
  }

  // 3) อัปเดตยอดกะ
  if (draft.shift_id) {
    const sh = await db().shifts.get(draft.shift_id);
    if (sh) {
      await db().shifts.update(draft.shift_id, {
        total_sales: round2(sh.total_sales + order.grand_total),
        total_orders: sh.total_orders + 1,
      });
    }
  }

  // 4) audit + คิวซิงก์
  await writeAudit({
    action: "sale",
    actor_id: draft.cashier_id,
    branch_id: draft.branch_id,
    ref_table: "orders",
    ref_no: order.order_no,
    amount: order.grand_total,
    after_data: { items: items.length, channel: order.channel, discount: totals.discountTotal },
    is_offline: order.is_offline_origin,
  });

  await enqueue("create_order", draft.client_uuid, {
    client_uuid: draft.client_uuid,
    branch_id: draft.branch_id,
    terminal_id: draft.terminal_id,
    shift_id: draft.shift_id,
    cashier_id: draft.cashier_id,
    salesperson_id: draft.salesperson_id,
    customer_id: draft.customer_id ?? null,
    customer_name: draft.customer_name ?? null,
    customer_phone: draft.customer_phone ?? null,
    channel: draft.channel,
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    discount_percent: totals.subtotal ? round2((totals.discountTotal / totals.subtotal) * 100) : 0,
    vat_amount: totals.vatAmount,
    grand_total: totals.grandTotal,
    paid_total: draft.paid_total,
    change_amount: draft.change_amount,
    is_offline_origin: order.is_offline_origin,
    device_created_at: now,
    discount_approved_by: draft.discount_approved_by ?? null,
    items: items.map((i) => ({
      product_id: i.product_id, sku: i.sku, name: i.name, kind: i.kind, qty: i.qty,
      unit_price: i.unit_price, discount_amount: i.discount_amount, line_total: i.line_total,
      unit_cost: i.unit_cost, cost_total: i.cost_total, gross_profit: i.gross_profit,
      salesperson_id: i.salesperson_id, serials: i.serials,
    })),
    payments: draft.payments,
  });

  // 5) ใช้แต้มเป็นส่วนลด → หักแต้มลูกค้า (หลัง create_order เพื่อให้หาเลขบิลจาก client_uuid ได้)
  if (draft.customer_id && (draft.redeem_points ?? 0) > 0) {
    // อัปเดตแคชแต้มในเครื่องทันที
    const c = await db().customers.get(draft.customer_id);
    if (c) await db().customers.put({ ...c, points: Math.max(0, (c.points ?? 0) - draft.redeem_points!) });
    await enqueue("redeem_points", `${draft.client_uuid}:redeem`, {
      customer_id: draft.customer_id,
      points: draft.redeem_points,
      client_uuid: draft.client_uuid,
    });
  }

  // 6) ใช้คูปอง → บันทึกการใช้ (วัดผลแคมเปญ)
  if (draft.coupon_code && (draft.coupon_discount ?? 0) > 0) {
    await enqueue("redeem_coupon", `${draft.client_uuid}:coupon`, {
      code: draft.coupon_code,
      customer_id: draft.customer_id ?? null,
      client_uuid: draft.client_uuid,
      discount: draft.coupon_discount,
    });
  }

  return { order, offline: order.is_offline_origin };
}

export async function voidOrder(orderId: string, employeeId: string, reason: string): Promise<void> {
  const order = await db().orders.get(orderId);
  if (!order || order.status === "voided") return;

  let unitsRestocked = 0;
  for (const it of order.items) {
    if (!it.product_id) continue;
    const p = await db().products.get(it.product_id);
    if (p?.is_stocked) { await adjustStock(order.branch_id, it.product_id, it.qty); unitsRestocked += it.qty; }
  }
  await db().orders.update(orderId, { status: "voided", void_reason: reason });

  await writeAudit({
    action: "void",
    actor_id: employeeId,
    branch_id: order.branch_id,
    ref_table: "orders",
    ref_no: order.order_no,
    amount: order.grand_total,
    after_data: {
      reason,
      was_paid: order.paid_total > 0,
      payment_reversed: order.paid_total,
      units_restocked: unitsRestocked,
      methods: order.payments.map((p) => p.method),
    },
    is_offline: false,
  });
  await enqueue("void_order", nanoid(), { order_id: orderId, employee_id: employeeId, reason });
}

// ---------------------------------------------------------------------
// ORDERS / REPORTS
// ---------------------------------------------------------------------
export async function listOrders(opts: {
  branchIds?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
} = {}): Promise<Order[]> {
  let rows = await db().orders.orderBy("created_at").reverse().toArray();
  if (opts.branchIds?.length) {
    const set = new Set(opts.branchIds);
    rows = rows.filter((o) => set.has(o.branch_id));
  }
  if (opts.from) {
    const f = opts.from.toISOString();
    rows = rows.filter((o) => o.created_at >= f);
  }
  if (opts.to) {
    const t = opts.to.toISOString();
    rows = rows.filter((o) => o.created_at <= t);
  }
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

export async function getOrder(orderId: string): Promise<Order | undefined> {
  return db().orders.get(orderId);
}

export async function findOrderByNo(orderNo: string): Promise<Order | undefined> {
  return db().orders.where("order_no").equalsIgnoreCase(orderNo.trim()).first();
}

// ---------------------------------------------------------------------
// SHIFTS
// ---------------------------------------------------------------------
export async function openShift(input: {
  branchId: string;
  terminalId: string | null;
  employeeId: string;
  memberIds: string[];
  openingCash: number;
}): Promise<Shift> {
  const now = new Date();
  const shift: Shift = {
    id: nanoid(),
    shift_no: `SH-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
    branch_id: input.branchId,
    terminal_id: input.terminalId,
    opened_by: input.employeeId,
    member_ids: Array.from(new Set([input.employeeId, ...input.memberIds])),
    status: "open",
    opening_cash: input.openingCash,
    total_sales: 0,
    total_orders: 0,
    opened_at: now.toISOString(),
  };
  await db().shifts.put(shift);
  await writeAudit({
    action: "shift_open", actor_id: input.employeeId, branch_id: input.branchId,
    ref_table: "shifts", ref_no: shift.shift_no, amount: input.openingCash,
    after_data: { members: shift.member_ids.length }, is_offline: false,
  });
  await enqueue("open_shift", shift.id, shift);
  return shift;
}

export async function currentShift(branchId: string): Promise<Shift | undefined> {
  const rows = await db().shifts.where("branch_id").equals(branchId).toArray();
  return rows.find((s) => s.status === "open");
}

export async function closeShift(shiftId: string, countedCash: number, employeeId: string, note?: string) {
  const shift = await db().shifts.get(shiftId);
  if (!shift) return null;

  const orders = (await db().orders.where("branch_id").equals(shift.branch_id).toArray())
    .filter((o) => o.shift_id === shiftId && o.status !== "voided");
  const cashSales = round2(
    orders.reduce((s, o) => s + o.payments.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0), 0)
  );
  const expected = round2(shift.opening_cash + cashSales);

  await db().shifts.update(shiftId, {
    status: "closed",
    closed_at: new Date().toISOString(),
    expected_cash: expected,
    counted_cash: countedCash,
    cash_variance: round2(countedCash - expected),
  });

  await writeAudit({
    action: "shift_close", actor_id: employeeId, branch_id: shift.branch_id,
    ref_table: "shifts", ref_no: shift.shift_no, amount: countedCash,
    after_data: { expected, counted: countedCash, variance: round2(countedCash - expected) },
    is_offline: false,
  });
  await enqueue("close_shift", nanoid(), {
    shift_id: shiftId, counted_cash: countedCash, employee_id: employeeId, note,
  });

  return { expected, counted: countedCash, variance: round2(countedCash - expected), cashSales, orders: orders.length };
}

// ---------------------------------------------------------------------
// HOLD BILLS (พักบิล)
// ---------------------------------------------------------------------
export async function holdBill(bill: HeldBill): Promise<void> {
  await db().holds.put(bill);
}
export async function listHolds(branchId: string): Promise<HeldBill[]> {
  return db().holds.where("branch_id").equals(branchId).reverse().toArray();
}
export async function removeHold(id: string): Promise<void> {
  await db().holds.delete(id);
}

// ---------------------------------------------------------------------
// RETURNS
// ---------------------------------------------------------------------
export async function createReturn(doc: ReturnDoc, employeeId: string): Promise<void> {
  await db().returns.put(doc);
  if (doc.status === "completed" || doc.status === "approved") {
    for (const it of doc.items) {
      if (it.condition !== "sellable") continue;
      const product = (await db().products.where("sku").equals(it.sku).first());
      if (product?.is_stocked) await adjustStock(doc.branch_id, product.id, it.qty);
    }
  }
  await writeAudit({
    action: doc.type === "exchange" ? "exchange" : "refund",
    actor_id: employeeId, branch_id: doc.branch_id,
    ref_table: "returns", ref_no: doc.return_no, amount: doc.refund_amount,
    after_data: { type: doc.type, items: doc.items.length, reason: doc.reason_code },
    is_offline: false,
  });
  await enqueue("create_return", doc.id, doc);
}

export async function listReturns(branchIds?: string[]): Promise<ReturnDoc[]> {
  const rows = await db().returns.reverse().sortBy("created_at");
  if (!branchIds?.length) return rows;
  const set = new Set(branchIds);
  return rows.filter((r) => set.has(r.branch_id));
}

// ---------------------------------------------------------------------
// APPROVALS
// ---------------------------------------------------------------------
export async function createApproval(req: ApprovalRequest): Promise<void> {
  await db().approvals.put(req);
}
export async function listApprovals(branchIds?: string[]): Promise<ApprovalRequest[]> {
  const rows = await db().approvals.reverse().sortBy("created_at");
  if (!branchIds?.length) return rows;
  const set = new Set(branchIds);
  return rows.filter((r) => set.has(r.branch_id));
}
export async function decideApproval(id: string, approverId: string, approved: boolean): Promise<void> {
  await db().approvals.update(id, {
    status: approved ? "approved" : "rejected",
    approved_by: approverId,
    decided_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// AUDIT
// ---------------------------------------------------------------------
export async function writeAudit(entry: Omit<AuditEntry, "id" | "occurred_at" | "actor_name">): Promise<void> {
  const emp = entry.actor_id ? await db().employees.get(entry.actor_id) : undefined;
  const row: AuditEntry = {
    ...entry,
    id: nanoid(),
    actor_name: emp?.nickname ?? emp?.first_name ?? null,
    occurred_at: new Date().toISOString(),
  };
  await db().audit.put(row);
  await enqueue("audit", row.id, {
    action: row.action, actor_id: row.actor_id, branch_id: row.branch_id,
    ref_table: row.ref_table, ref_no: row.ref_no, amount: row.amount,
    after_data: row.after_data, is_offline: row.is_offline, occurred_at: row.occurred_at,
  });
}

export async function listAudit(opts: { branchIds?: string[]; limit?: number; action?: string } = {}): Promise<AuditEntry[]> {
  let rows = await db().audit.orderBy("occurred_at").reverse().toArray();
  if (opts.branchIds?.length) {
    const set = new Set(opts.branchIds);
    rows = rows.filter((a) => !a.branch_id || set.has(a.branch_id));
  }
  if (opts.action) rows = rows.filter((a) => a.action === opts.action);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

// ---------------------------------------------------------------------
// CUSTOMERS
// ---------------------------------------------------------------------
export async function upsertCustomer(c: Customer): Promise<void> {
  await db().customers.put(c);
}

function normalizeCustomer(r: Record<string, unknown>): Customer {
  return {
    id: String(r.id),
    member_code: (r.member_code as string) ?? null,
    name: String(r.name ?? ""),
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    tax_id: (r.tax_id as string) ?? null,
    tax_name: (r.tax_name as string) ?? null,
    tax_address: (r.tax_address as string) ?? null,
    points: Number(r.points ?? 0),
    store_credit: Number(r.store_credit ?? 0),
    tier: (r.tier as string) ?? null,
    source: (r.source as string) ?? null,
    note: (r.note as string) ?? null,
  };
}

/** ค้นหาลูกค้าด้วยชื่อ/เบอร์โทร/รหัสสมาชิก — live: RPC, demo/offline: เครื่อง */
export async function searchCustomers(q: string): Promise<Customer[]> {
  const term = q.trim();
  if (!term) return [];

  if (isLiveMode() && typeof navigator !== "undefined" && navigator.onLine) {
    const sb = supabase();
    if (sb) {
      const { data, error } = await sb.rpc("pos_customer_search", { p_q: term });
      if (!error && Array.isArray(data)) {
        const rows = data.map((r) => normalizeCustomer(r as Record<string, unknown>));
        // แคชลงเครื่องไว้ค้นตอนออฟไลน์
        if (rows.length) await db().customers.bulkPut(rows);
        return rows;
      }
    }
  }

  const lower = term.toLowerCase();
  const all = await db().customers.toArray();
  return all
    .filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.phone ?? "").includes(term) ||
        (c.member_code ?? "").toLowerCase().includes(lower)
    )
    .slice(0, 20);
}

export interface CouponResult {
  valid: boolean;
  reason?: string;
  discount?: number;
  campaign_id?: string;
  name?: string;
}

/** ตรวจคูปองก่อนใช้ — live: RPC, demo/offline: ใช้ไม่ได้ */
export async function validateCoupon(code: string, customerId: string | null, subtotal: number): Promise<CouponResult> {
  if (!code.trim()) return { valid: false, reason: "กรอกรหัสคูปอง" };
  if (!isLiveMode() || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return { valid: false, reason: "ใช้คูปองได้เมื่อออนไลน์" };
  }
  const sb = supabase();
  if (!sb) return { valid: false, reason: "ใช้คูปองได้เมื่อออนไลน์" };
  const { data, error } = await sb.rpc("pos_validate_coupon", {
    p_code: code.trim(),
    p_customer_id: customerId,
    p_subtotal: subtotal,
  });
  if (error) return { valid: false, reason: error.message };
  return (data ?? { valid: false, reason: "ไม่พบคูปอง" }) as CouponResult;
}

export interface NewCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  tax_name?: string;
  tax_address?: string;
  source?: string;
  first_branch_id?: string | null;
  note?: string;
}

/** สร้างลูกค้าใหม่ — เขียนลงเครื่องทันที + ซิงก์ขึ้น server (idempotent ด้วย id) */
export async function createCustomer(input: NewCustomerInput): Promise<Customer> {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : nanoid();
  const customer: Customer = {
    id,
    member_code: null,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    tax_id: input.tax_id?.trim() || null,
    tax_name: input.tax_name?.trim() || null,
    tax_address: input.tax_address?.trim() || null,
    points: 0,
    store_credit: 0,
    tier: "normal",
    source: input.source ?? "walk_in",
    note: input.note?.trim() || null,
  };
  await db().customers.put(customer);

  if (isLiveMode()) {
    await enqueue("create_customer", id, {
      id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      tax_id: customer.tax_id,
      tax_name: customer.tax_name,
      tax_address: customer.tax_address,
      source: customer.source,
      first_branch_id: input.first_branch_id ?? null,
      note: customer.note,
    });
  }
  return customer;
}
