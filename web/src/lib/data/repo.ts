import { can } from "../permissions";
// =====================================================================
// Repository — ชั้นเดียวที่ UI คุยด้วย
//
// POS ทำงานกับฐานข้อมูลในเครื่อง (Dexie) เสมอ → ขายได้แม้เน็ตหลุด
// เมื่อมี Supabase env: bootstrap จะดึง master data ลงมา และงานเขียน
// จะถูก enqueue ไปซิงก์ต่อ (ดู offline/sync.ts)
// =====================================================================

import { nanoid } from "nanoid";
import { uuidv4 } from "../uuid";
import { db, kvGet, kvSet, stockKey, type HeldBill } from "../offline/db";
import { enqueue, refreshCounts, flush } from "../offline/sync";
import { supabase, isLiveMode } from "../supabase/client";
import {
  DEMO_BRANDS, DEMO_BRANCHES, DEMO_TERMINALS, DEMO_EMPLOYEES, DEMO_PRODUCTS,
  DEMO_CATEGORIES, DEMO_CUSTOMERS, buildDemoStock, buildDemoOrders, buildDemoAudit, buildDemoOrgPositions,
} from "../demo-data";
import { computeTotals, lineTotal, lineDiscount, lineCost, round2, VAT_RATE } from "../money";
import { stockView } from "../stock";
import type {
  Branch, Brand, Category, Employee, Order, OrderDraft, OrderItem, Product,
  Shift, StockLevel, Terminal, AuditEntry, FieldChange, Customer, ReturnDoc, ApprovalRequest,
  CountType, StockCountSession, Transfer, TransferStatus, TransferAttachment, TransferReceipt, TransferDiscrepancy, TransferReturn, RtnLine, RtnOutcome, RtnReason, RtnShipStage, SerialLocated, SerialOutcome,
} from "../types";

const CATALOG_VERSION = "2026-11-19.1";
// เวอร์ชันข้อมูลจำลอง (orders/audit/stock/customers/org) — เปลี่ยนเพื่อรีเฟรช demo ให้เป็นวันที่ล่าสุด
const DEMO_DATA_VERSION = "2026-11-17.2";
const DEMO_ORDER_ID = /^o-\d+-0000-0000-000000000000$/;

// ---------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------
let bootstrapped: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  if (!bootstrapped) bootstrapped = doBootstrap();
  return bootstrapped;
}

// เปลี่ยนค่านี้เพื่อบังคับทุกเครื่องล้าง local ทั้งหมดครั้งเดียว (เอาข้อมูลจำลองออกหมด เหลือแต่ของจริง Supabase)
const OW_RESET_TOKEN = "2026-11-22.ow-clean";

async function doBootstrap(): Promise<void> {
  // Refresh catalog only. Unsynced sales, transfers, held bills and audit must survive an OW refresh.
  if (isLiveMode() && (await kvGet<string>("ow_reset_token", "")) !== OW_RESET_TOKEN) {
    await loadCatalogFromSupabase(true);
    await kvSet("ow_reset_token", OW_RESET_TOKEN);
    await kvSet("catalog_version", CATALOG_VERSION);
  }
  const version = await kvGet<string>("catalog_version", "");
  const productCount = await db().products.count();
  const cached = version === CATALOG_VERSION && productCount > 0;

  if (cached) {
    // แคตตาล็อกมีในเครื่องแล้ว แต่พนักงาน/สาขาเปลี่ยนบ่อย (เพิ่มผู้ใช้ใหม่ ฯลฯ)
    // → รีเฟรชตารางเล็กเหล่านี้ทุกครั้งที่เปิดแอป เพื่อให้ชื่อในรายงานตรงเสมอ
    if (isLiveMode()) {
      try { await refreshDirectory(); } catch { /* ออฟไลน์: ใช้ของเดิมในเครื่องได้ */ }
    }
  } else {
    if (isLiveMode()) {
      await loadCatalogFromSupabase();
    } else {
      await seedDemo();
    }
    await kvSet("catalog_version", CATALOG_VERSION);
  }
  // โหมดจริง (default) = ไม่มีข้อมูลจำลองเลย + ล้างของจำลองเก่าทิ้ง · เปิด demo ได้เฉพาะ NEXT_PUBLIC_DEMO_MODE=1
  if (isDemoMode()) await ensureDemoData();
  else await purgeDemoDataOnce();
}

/** โหมดจำลอง — เปิดเฉพาะเมื่อสั่งชัด (NEXT_PUBLIC_DEMO_MODE=1) · production/ของจริง = ปิดเสมอ */
export function isDemoMode(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEMO_MODE === "1";
}

/** bump เพื่อ re-run purge ทุกเครื่อง (เช่น เพิ่มล้าง demo products) */
const DEMO_PURGE_VERSION = "2026-11-22.ow-only";

/** โหมดจริง: ล้างข้อมูลจำลองที่เคย seed ไว้ (ครั้งเดียวต่อเครื่อง)
 *  - ออเดอร์/ลูกค้า/audit จำลอง
 *  - demo products/categories/brands ที่ค้าง (loadCatalogFromSupabase ใช้ bulkPut จึงไม่ลบของเก่า)
 *  - โหลดแคตตาล็อก+สต๊อกจริงจาก Supabase ใหม่ทั้งชุด (= ข้อมูลจริงเท่านั้น) */
async function purgeDemoDataOnce(): Promise<void> {
  const d = db();
  if ((await kvGet<string>("demo_purged_version", "")) === DEMO_PURGE_VERSION) return;
  const orders = await d.orders.toArray();
  const demoOrderIds = orders.filter((o) => DEMO_ORDER_ID.test(o.id)).map((o) => o.id);
  const demoCustIds = DEMO_CUSTOMERS.map((c) => c.id);
  await d.transaction("rw", [d.orders, d.customers, d.audit], async () => {
    if (demoOrderIds.length) await d.orders.bulkDelete(demoOrderIds);
    await d.customers.bulkDelete(demoCustIds);
    const demoNumbers = new Set(orders.filter(o => DEMO_ORDER_ID.test(o.id)).map(o => o.order_no));
    const demoAudit = (await d.audit.toArray()).filter(a => a.ref_no && demoNumbers.has(a.ref_no));
    if (demoAudit.length) await d.audit.bulkDelete(demoAudit.map(a => a.id));
  });
  // live: ล้างแคตตาล็อก/สต๊อกที่ค้าง (รวม demo products) แล้วโหลดจาก Supabase ใหม่ → เหลือแต่ของจริง
  if (isLiveMode() && supabase()) {
    // Stage and validate the response before replacing any cached catalog.
    try { await loadCatalogFromSupabase(true); } catch { return; }
  }
  await kvSet("demo_purged_version", DEMO_PURGE_VERSION);
}

// สร้าง/รีเฟรชข้อมูลจำลองให้เป็นวันที่ล่าสุด — ปลอดภัยกับข้อมูลจริง (เช็ค id pattern ก่อน)
async function ensureDemoData(): Promise<void> {
  const d = db();
  if ((await kvGet<string>("demo_data_version", "")) === DEMO_DATA_VERSION) return;
  // แตะเฉพาะเมื่อ orders ว่าง หรือเป็น demo ล้วน (กันทับข้อมูลจริงใน production)
  const sample = await d.orders.limit(25).toArray();
  const onlyDemo = sample.length === 0 || sample.every((o) => DEMO_ORDER_ID.test(o.id));
  if (!onlyDemo) { await kvSet("demo_data_version", DEMO_DATA_VERSION); return; }

  const orders = buildDemoOrders(90);
  const audit = buildDemoAudit(orders);
  const stock = buildDemoStock().map((s) => ({ ...s, key: stockKey(s.branch_id, s.product_id) }));
  await d.transaction("rw", [d.orders, d.audit, d.stock, d.customers], async () => {
    await Promise.all([d.orders.clear(), d.audit.clear()]);
    await d.customers.bulkPut(DEMO_CUSTOMERS);
    await d.stock.bulkPut(stock);
    await d.orders.bulkPut(orders);
    await d.audit.bulkPut(audit);
  });
  try {
    if (typeof localStorage !== "undefined") {
      for (const { branchId, rows } of buildDemoOrgPositions()) {
        const k = `shdpos.org.${branchId}`;
        const existing = localStorage.getItem(k);
        if (!existing || existing === "[]") localStorage.setItem(k, JSON.stringify(rows));
      }
    }
  } catch { /* private mode */ }
  await kvSet("demo_data_version", DEMO_DATA_VERSION);
}

/** ดึงเฉพาะ master data ที่เปลี่ยนบ่อย (brands/branches/terminals/employees) ใหม่ */
export async function refreshDirectory(): Promise<void> {
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
  const orders = buildDemoOrders(90);
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

  // ผังองค์กรเริ่มต้นต่อสาขา → localStorage (ไม่ทับของที่ผู้ใช้สร้างไว้)
  try {
    if (typeof localStorage !== "undefined") {
      for (const { branchId, rows } of buildDemoOrgPositions()) {
        const k = `shdpos.org.${branchId}`;
        const existing = localStorage.getItem(k);
        if (!existing || existing === "[]") localStorage.setItem(k, JSON.stringify(rows));
      }
    }
  } catch { /* private mode */ }
  await kvSet("demo_data_version", DEMO_DATA_VERSION);
}

async function loadCatalogFromSupabase(replaceCatalog = false): Promise<void> {
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

  for (const result of [brands, branches, terminals, employees, products, categories, stock]) {
    if (result.error || !result.data) throw new Error("โหลดแคตตาล็อกไม่ครบ เก็บข้อมูลเดิมไว้ก่อน");
  }
  const pendingWrites = await d.pending.where("status").notEqual("done").count();
  // ใบโอน OneWarehouse (ow_owned) เซิร์ฟเวอร์เป็นเจ้าของ — sync_state คือสถานะ JST ไม่ใช่งานค้างในเครื่อง → ไม่นับ
  const localTransfers = (await d.transfers.toArray()).some(t => t.sync_state !== "synced" && !t.ow_owned);
  const preserveStock = pendingWrites > 0 || localTransfers;
  await d.transaction("rw", [d.brands, d.branches, d.terminals, d.employees, d.products, d.categories, d.stock], async () => {
    if (replaceCatalog) {
      await Promise.all([d.products.clear(), d.categories.clear(), d.brands.clear()]);
      if (!preserveStock) await d.stock.clear();
    }
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
    if (stock.data && !preserveStock) {
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

/** สร้างสาขาใหม่ (เขียนลง Dexie) + สร้างเครื่อง POS เริ่มต้นให้สาขาที่ขายได้ */
export async function createBranch(input: {
  code: string; name: string; name_th?: string | null; brand_id: string | null;
  branch_type?: string; province?: string | null; lat?: number | null; lng?: number | null; is_active?: boolean;
  phone?: string | null; email?: string | null; address?: string | null; district?: string | null; postcode?: string | null;
  open_time?: string | null; close_time?: string | null; manager_id?: string | null; note?: string | null;
}): Promise<Branch> {
  const d = db();
  const code = input.code.trim().toUpperCase();
  const existing = (await d.branches.toArray()).find((b) => b.code.toUpperCase() === code);
  if (existing) throw new Error(`รหัสสาขา "${code}" มีอยู่แล้ว`);
  const branch: Branch = {
    id: `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    code,
    name: input.name.trim(),
    name_th: input.name_th?.trim() || input.name.trim(),
    brand_id: input.brand_id || null,
    branch_type: input.branch_type || "brand_shop",
    province: input.province?.trim() || null,
    tax_branch_no: String((await d.branches.count()) + 1).padStart(5, "0"),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    district: input.district?.trim() || null,
    postcode: input.postcode?.trim() || null,
    open_time: input.open_time?.trim() || null,
    close_time: input.close_time?.trim() || null,
    manager_id: input.manager_id || null,
    note: input.note?.trim() || null,
    is_active: input.is_active ?? true,
  };
  await d.branches.put(branch);
  // สาขาที่ขายได้ (ไม่ใช่คลัง) → สร้างเครื่อง POS เริ่มต้น 1 เครื่อง
  if (branch.branch_type !== "warehouse") {
    await d.terminals.put({
      id: `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      branch_id: branch.id,
      code: "POS-01",
      name: `${branch.name} เครื่อง 1`,
      receipt_prefix: code.replace(/[^A-Z0-9]/g, "").slice(0, 3) + "1",
      customer_display: true,
    });
  }
  return branch;
}

/** แก้ไขสาขา (ชื่อ/แบรนด์/จังหวัด/เปิด-ปิด) */
export async function updateBranch(id: string, patch: Partial<Branch>): Promise<void> {
  const cur = await db().branches.get(id);
  if (!cur) return;
  await db().branches.put({ ...cur, ...patch, id });
}

/**
 * บันทึกประวัติการแก้ไขหลังบ้าน (activity log) — ใครแก้ฟิลด์อะไร จากค่าไหนเป็นค่าไหน เมื่อไร
 *   เก็บในตาราง audit (action="config") → โชว์ที่ /admin/activity + sync ขึ้นเซิร์ฟเวอร์
 */
export async function logActivity(input: {
  actorId?: string | null;
  actorName?: string | null;
  op: "create" | "update" | "delete";
  entity: string;          // เช่น "branch", "employee", "permission", "store"
  entityLabel: string;     // ชื่อที่คนอ่านเข้าใจ เช่น ชื่อสาขา
  entityId?: string | null;
  branchId?: string | null;
  changes?: FieldChange[];
}): Promise<void> {
  await writeAudit({
    action: "config",
    actor_id: input.actorId ?? null,
    branch_id: input.branchId ?? null,
    ref_table: input.entity,
    ref_no: input.entityLabel,
    amount: null,
    after_data: {
      op: input.op,
      entity: input.entity,
      entityLabel: input.entityLabel,
      entityId: input.entityId ?? null,
      actor_name: input.actorName ?? null,
      changes: input.changes ?? [],
    },
    is_offline: false,
  });
}

/** คำนวณ diff รายฟิลด์ระหว่าง before→after (เฉพาะฟิลด์ที่เปลี่ยน) ตาม label map */
export function diffFields<T extends Record<string, unknown>>(
  before: Partial<T> | null,
  after: Partial<T>,
  labels: Partial<Record<keyof T, string>>
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of Object.keys(labels) as (keyof T)[]) {
    const b = before ? before[key] : undefined;
    const a = after[key];
    const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    if (!before || norm(b) !== norm(a)) {
      out.push({ field: String(key), label: labels[key], before: before ? b ?? null : undefined, after: a ?? null });
    }
  }
  return out;
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
  const now = new Date().toISOString();
  const row = await db().stock.get(key);
  if (!row) {
    await db().stock.put({
      key, branch_id: branchId, product_id: productId,
      qty_on_hand: delta, qty_reserved: 0, reorder_point: 0,
      last_in_at: delta > 0 ? now : null,
    });
    return;
  }
  // ของเข้าใหม่ (delta>0) → รีเซ็ตอายุสต๊อก (ล็อตล่าสุดเข้าวันนี้)
  await db().stock.update(key, { qty_on_hand: round2(row.qty_on_hand + delta), ...(delta > 0 ? { last_in_at: now } : {}) });
}

/**
 * Transfers (Phase 4) — โอนย้ายระหว่างสาขา
 * หลักการ: สต๊อกปลายทางเพิ่มตอน "รับจริง" เท่านั้น (ไม่ใช่ตอนต้นทางกดส่ง)
 */
export async function listTransfersForBranch(branchId: string): Promise<Transfer[]> {
  const rows = await db().transfers.reverse().sortBy("created_at");
  return rows.filter((r) => r.from_branch_id === branchId || r.to_branch_id === branchId);
}
export async function getTransfer(id: string): Promise<Transfer | undefined> {
  return db().transfers.get(id);
}
/** ใบโอนทั้งหมด (สำหรับหน้า admin monitor — กรองด้วย visibleBranchIds ฝั่ง UI) */
export async function listAllTransfers(): Promise<Transfer[]> {
  return db().transfers.reverse().sortBy("created_at");
}
/** timeline ของใบโอน — จาก audit (ref_no = transfer_no) เรียงตามเวลา */
export async function listTransferTimeline(transferNo: string): Promise<AuditEntry[]> {
  const all = await db().audit.toArray();
  return all.filter((a) => a.ref_no === transferNo && a.ref_table === "transfers")
    .sort((a, b) => (a.occurred_at ?? "").localeCompare(b.occurred_at ?? ""));
}

/** จอง/คืนสต๊อก (qty_reserved) — delta บวก=จอง, ลบ=คืน · Available = on_hand − reserved */
export async function reserveStock(branchId: string, productId: string, delta: number): Promise<void> {
  const key = stockKey(branchId, productId);
  const row = await db().stock.get(key);
  if (!row) {
    if (delta > 0) await db().stock.put({ key, branch_id: branchId, product_id: productId, qty_on_hand: 0, qty_reserved: delta, reorder_point: 0 });
    return;
  }
  await db().stock.update(key, { qty_reserved: Math.max(0, round2((row.qty_reserved ?? 0) + delta)) });
}

/** ปรับ On-the-Way-Out (สแกนออกแล้วแต่ยังไม่ถึงปลายทาง) */
export async function adjustOtwo(branchId: string, productId: string, delta: number): Promise<void> {
  const key = stockKey(branchId, productId);
  const row = await db().stock.get(key);
  if (!row) {
    if (delta > 0) await db().stock.put({ key, branch_id: branchId, product_id: productId, qty_on_hand: 0, qty_reserved: 0, qty_otwo: delta, reorder_point: 0 });
    return;
  }
  await db().stock.update(key, { qty_otwo: Math.max(0, round2((row.qty_otwo ?? 0) + delta)) });
}

/** ปรับ Quarantine (ของชำรุด/SN ผิด พักตรวจ — ขายไม่ได้) · delta บวก=พักเพิ่ม, ลบ=ปล่อย/ตัดออก */
export async function quarantineStock(branchId: string, productId: string, delta: number): Promise<void> {
  const key = stockKey(branchId, productId);
  const row = await db().stock.get(key);
  if (!row) {
    if (delta > 0) await db().stock.put({ key, branch_id: branchId, product_id: productId, qty_on_hand: 0, qty_reserved: 0, qty_quarantine: delta, reorder_point: 0 });
    return;
  }
  await db().stock.update(key, { qty_quarantine: Math.max(0, round2((row.qty_quarantine ?? 0) + delta)) });
}

/** ปรับ Reserved Order (จองตาม order/พักบิล ที่ยังไม่สแกนออก) */
export async function reserveOrderStock(branchId: string, productId: string, delta: number): Promise<void> {
  const key = stockKey(branchId, productId);
  const row = await db().stock.get(key);
  if (!row) {
    if (delta > 0) await db().stock.put({ key, branch_id: branchId, product_id: productId, qty_on_hand: 0, qty_reserved: 0, qty_reserved_order: delta, reorder_point: 0 });
    return;
  }
  await db().stock.update(key, { qty_reserved_order: Math.max(0, round2((row.qty_reserved_order ?? 0) + delta)) });
}

/** รัน read-write transaction คลุม transfers+stock+audit — ปรับยอด+ใบโอนสำเร็จพร้อมกัน (error ใดๆ → rollback ทั้งหมด) */
function txTransfer<T>(fn: () => Promise<T>): Promise<T> {
  if (isLiveMode()) throw new Error("การโอนจริงรอ API รับ/ส่งเหตุการณ์จาก OneWarehouse ระบบจะไม่เปลี่ยนยอดเฉพาะในเครื่องให้คลาดกับคลังกลาง");
  return db().transaction("rw", db().transfers, db().stock, db().audit, fn);
}
/** อ่านยอดปัจจุบันของ (สาขา, สินค้า) เพื่อตรวจก่อนจอง/ส่ง */
async function readStockView(branchId: string, productId: string) {
  return stockView(await db().stock.get(stockKey(branchId, productId)));
}
/** อ่านใบโอนสด + เช็ค version ภายใน transaction (กันยอดเปลี่ยนแต่สถานะชน) */
/** สต๊อกฝั่งต้นทางอยู่ในเครื่องเราไหม (ไม่ใช่คลัง และไม่ใช่ใบที่ OW เป็นตัวจริง) */
const srcLocal = (t: Transfer) => t.from_kind !== "warehouse" && !t.ow_owned;

/** อัปเดตฟิลด์ฝั่ง OneWarehouse ของใบโอน (ใช้โดย adapter หลังเขียน OW สำเร็จ) — ไม่แตะสต๊อก */
export async function annotateTransfer(id: string, patch: Partial<Transfer>): Promise<Transfer | undefined> {
  await db().transfers.update(id, patch);
  return db().transfers.get(id);
}
/** นำใบโอนจากเครื่องอื่น (สำเนาใน OW) เข้าเครื่องนี้ — เขียนทับเมื่อเวอร์ชันใหม่กว่าเท่านั้น */
export async function importTransferSnapshot(tr: Transfer): Promise<boolean> {
  const cur = await db().transfers.get(tr.id);
  if (cur && (cur.version ?? 0) >= (tr.version ?? 0)) return false;
  await db().transfers.put(tr);
  return true;
}

async function freshOrThrow(tr: Transfer): Promise<Transfer> {
  if (isLiveMode()) throw new Error("การโอนจริงรอ API รับ/ส่งเหตุการณ์จาก OneWarehouse");
  const fresh = await db().transfers.get(tr.id);
  if (!fresh) throw new Error("transfer_not_found");
  if ((fresh.version ?? 1) !== (tr.version ?? 1)) throw new Error("transfer_version_conflict");
  return fresh;
}
/** put ใบโอน (bump version) ภายใน tx — ไม่เขียน audit/enqueue (ต้องทำนอก tx เพราะแตะ employees/pending) */
async function putTransferTx(base: Transfer, patch: Partial<Transfer>): Promise<Transfer> {
  const next: Transfer = { ...base, ...patch, version: (base.version ?? 1) + 1, sync_state: "pending" };
  await db().transfers.put(next);
  return next;
}
/** เขียน audit ของใบโอน (เรียกหลัง transaction commit) */
function auditTransfer(next: Transfer, employeeId: string, branchId: string, after: Record<string, unknown>): Promise<void> {
  return writeAudit({ action: "transfer", actor_id: employeeId, branch_id: branchId, ref_table: "transfers", ref_no: next.transfer_no, amount: null, after_data: after, is_offline: false });
}

/** เพิ่ม version + บันทึก + audit (concurrency + timeline) — เช็ค stale version → โยน transfer_version_conflict */
async function writeTransfer(tr: Transfer, patch: Partial<Transfer>, employeeId: string, branchId: string, after: Record<string, unknown>): Promise<Transfer> {
  const fresh = await db().transfers.get(tr.id);
  if (fresh && (fresh.version ?? 1) !== (tr.version ?? 1)) throw new Error("transfer_version_conflict");
  const base = fresh ?? tr;
  const next: Transfer = { ...base, ...patch, version: (base.version ?? 1) + 1, sync_state: "pending" };
  await db().transfers.put(next);
  await writeAudit({ action: "transfer", actor_id: employeeId, branch_id: branchId, ref_table: "transfers", ref_no: tr.transfer_no, amount: null, after_data: after, is_offline: false });
  return next;
}

export async function createTransfer(
  fromBranchId: string, toBranchId: string, employeeId: string,
  lines: { product_id: string; sku: string; name: string; qty: number; isSerialized?: boolean | null; serials?: string[] }[],
  note: string, autoApprove: boolean, fromKind: "branch" | "warehouse" = "branch",
  replacementOf?: Transfer["replacement_of"],
  owOwned = false, // OneWarehouse เป็นตัวจริง (สาขาต้นทาง/ปลายทางผูกคลัง OW) → สต๊อกต้นทางให้ OW/JST คุม ไม่จอง/หักในเครื่อง
): Promise<Transfer> {
  const now = new Date().toISOString();
  const tr: Transfer = {
    ow_owned: owOwned || undefined,
    id: uuidv4(),
    transfer_no: `TF-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
    from_branch_id: fromBranchId, to_branch_id: toBranchId, from_kind: fromKind,
    replacement_of: replacementOf ?? null,
    status: autoApprove ? "approved" : "pending_approval",
    // ถ้าสแกน SN มาตั้งแต่เปิดบิล → เก็บเป็น shippedSerials เลย (ไม่ต้องสแกนซ้ำตอนส่งออก)
    items: lines.map((l) => {
      const sns = l.serials ?? [];
      return { product_id: l.product_id, sku: l.sku, name: l.name, qty_requested: l.qty, qty_shipped: sns.length, qty_received: 0, isSerialized: l.isSerialized ?? null, shippedSerials: sns.map((serialNo) => ({ serialNo, at: now })), receivedSerials: [] };
    }),
    requested_by: employeeId, note: note || null, created_at: now,
    version: 1, sync_state: "pending", jst_allocation_no: null,
  };
  await txTransfer(async () => {
    // ตรวจของพร้อมโอน (Available) ก่อนจอง — รวมจำนวนต่อสินค้า (กันบรรทัดซ้ำ) · เฉพาะต้นทางที่เป็นสาขา
    if (fromKind === "branch" && !owOwned) {
      const need: Record<string, number> = {};
      for (const l of lines) need[l.product_id] = (need[l.product_id] ?? 0) + l.qty;
      for (const [pid, qty] of Object.entries(need)) {
        const av = (await readStockView(fromBranchId, pid)).available;
        if (qty > av) throw new Error("insufficient_available");
      }
    }
    await db().transfers.put(tr);
    // จองสต๊อกต้นทาง (เฉพาะโอนจากสาขา — คลัง OneWarehouse จัดการเองฝั่งนั้น)
    if (fromKind === "branch" && !owOwned) for (const l of lines) await reserveStock(fromBranchId, l.product_id, l.qty);
  });
  await auditTransfer(tr, employeeId, fromBranchId, { status: tr.status, to: toBranchId });
  return tr;
}

export async function approveTransfer(tr: Transfer, employeeId: string, note?: string): Promise<Transfer> {
  return writeTransfer(tr, { status: "approved", approved_by: employeeId, approval_note: note || null }, employeeId, tr.from_branch_id, { status: "approved", note: note || null });
}
/** ปฏิเสธ/ยกเลิก → คืน reserved ที่ต้นทาง + บันทึกเหตุผล */
export async function rejectTransfer(tr: Transfer, employeeId: string, cancel = false, reason?: string): Promise<Transfer> {
  const status: TransferStatus = cancel ? "cancelled" : "rejected";
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    // ยกเลิก/ปฏิเสธได้เฉพาะก่อนสแกนออก (ของยังไม่ออกจากคลัง) → ปล่อยจอง; หลังส่งใช้ "โอนกลับ" แทน
    if (!["draft", "pending_approval", "approved", "picking"].includes(fresh.status)) throw new Error("transfer_wrong_status");
    if (srcLocal(fresh)) for (const it of fresh.items) await reserveStock(fresh.from_branch_id, it.product_id, -it.qty_requested);
    return putTransferTx(fresh, { status, approved_by: employeeId, approval_note: reason || null });
  });
  await auditTransfer(next, employeeId, next.from_branch_id, { status, note: reason || null });
  return next;
}

/** โอนกลับ — สร้างใบโอนใหม่ (ปลายทางเดิม → ต้นทางเดิม) สำหรับคืนของหลังรับเข้าแล้ว */
export async function createReverseTransfer(tr: Transfer, employeeId: string): Promise<Transfer> {
  const toBranch = await db().branches.get(tr.to_branch_id);
  const lines = tr.items.map((it) => {
    const serials = it.isSerialized ? (it.receivedSerials ?? []).map((s) => s.serialNo) : undefined;
    const qty = it.isSerialized ? (serials?.length ?? 0) : (it.qty_received || it.qty_requested);
    return { product_id: it.product_id, sku: it.sku, name: it.name, qty, isSerialized: it.isSerialized, serials };
  }).filter((l) => l.qty > 0);
  return createTransfer(tr.to_branch_id, tr.from_branch_id, employeeId, lines, `โอนกลับจาก ${tr.transfer_no}`, false, toBranch?.branch_type === "warehouse" ? "warehouse" : "branch");
}

/** ต้นทางสแกนออก — บันทึก shippedSerials + qty_shipped (ตรวจ SN ครบ/null=บล็อก) → packed */
export async function scanOutTransfer(tr: Transfer, employeeId: string, serialsByProduct: Record<string, string[]>): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    if (!["approved", "picking", "packed"].includes(fresh.status)) throw new Error("transfer_wrong_status");
    const items = fresh.items.map((it) => {
      if (it.isSerialized === null) throw new Error("not_serialized");
      if (it.isSerialized === true) {
        const sns = serialsByProduct[it.product_id] ?? it.shippedSerials?.map((s) => s.serialNo) ?? [];
        if (new Set(sns).size !== sns.length) throw new Error("serial_duplicate");  // ห้าม SN ซ้ำในรอบเดียว
        if (sns.length !== it.qty_requested) throw new Error("serial_count_mismatch");
        return { ...it, qty_shipped: sns.length, shippedSerials: sns.map((serialNo) => ({ serialNo, at: now })) };
      }
      return { ...it, qty_shipped: it.qty_requested };
    });
    return putTransferTx(fresh, { status: "packed", items });
  });
  await auditTransfer(next, employeeId, next.from_branch_id, { status: "packed", shipped: next.items.reduce((s, i) => s + i.qty_shipped, 0) });
  return next;
}

/** ยืนยันส่งออก — ย้าย on_hand → On-the-Way-Out (Stock คงที่, ยัง Reserved Out ไว้) → in_transit */
export async function dispatchTransfer(tr: Transfer, employeeId: string, opts: { carrier?: string | null; tracking?: string | null; shippingCost?: number | null } = {}): Promise<Transfer> {
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    if (fresh.status !== "packed") throw new Error("transfer_wrong_status"); // ต้องสแกนออก/แพ็คก่อน · กันกดส่งซ้ำ
    if (srcLocal(fresh)) {
      // เช็ค On Hand พอก่อน (ทุกบรรทัด) แล้วค่อยย้าย on_hand → OTWO (Stock คงที่, ยัง Reserved Out → Available คงที่)
      for (const it of fresh.items) if (it.qty_shipped > 0 && (await readStockView(fresh.from_branch_id, it.product_id)).onHand < it.qty_shipped) throw new Error("insufficient_on_hand");
      for (const it of fresh.items) if (it.qty_shipped > 0) { await adjustStock(fresh.from_branch_id, it.product_id, -it.qty_shipped); await adjustOtwo(fresh.from_branch_id, it.product_id, it.qty_shipped); }
    }
    return putTransferTx(fresh, {
      status: "in_transit", carrier: opts.carrier ?? null, tracking: opts.tracking ?? null, shipping_cost: opts.shippingCost ?? null,
      // ยืนยันส่งมอบ = ของออกจากคลังจริง/อยู่กับขนส่งแล้ว (ไม่ใช่แค่เรียกรถ) → เริ่มที่ "รถรับของแล้ว"
      ship_stage: "picked_up", shipped_by: employeeId, shipped_at: new Date().toISOString(),
      // ใบที่ OW เป็นตัวจริงใช้เลข allocation จริงจาก OW (adapter ใส่ให้หลังส่ง) — ไม่สร้างเลขสมมติ
      jst_allocation_no: fresh.jst_allocation_no ?? (fresh.ow_owned ? null : `JST-${nanoid(6).toUpperCase()}`),
    });
  });
  await auditTransfer(next, employeeId, next.from_branch_id, { status: "in_transit", carrier: opts.carrier ?? null });
  return next;
}

/** อัปเดตสถานะขนส่งย่อย (เรียกรถ → รถรับของ → กำลังส่ง → ถึงปลายทาง) */
export async function advanceShipStage(tr: Transfer, employeeId: string, stage: NonNullable<Transfer["ship_stage"]>): Promise<Transfer> {
  return writeTransfer(tr, { ship_stage: stage }, employeeId, tr.from_branch_id, { ship_stage: stage });
}

/** ประสานขนส่งก่อนส่งมอบ (ตอน packed) — เรียกรถ/รถมารับ · ยังไม่ตัดยอด (ตัดตอน "ยืนยันส่งมอบ") */
export async function setPickupStage(tr: Transfer, employeeId: string, stage: NonNullable<Transfer["pickup_stage"]>): Promise<Transfer> {
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    if (fresh.status !== "packed") throw new Error("transfer_wrong_status");
    return putTransferTx(fresh, { pickup_stage: stage });
  });
  await auditTransfer(next, employeeId, next.from_branch_id, { pickup_stage: stage });
  return next;
}

/** แนบ/ลบไฟล์เอกสาร-รูปในใบโอน (metadata — ไม่ bump version กันชนกับ action อื่น) */
export async function setTransferAttachments(id: string, attachments: TransferAttachment[]): Promise<Transfer | undefined> {
  const tr = await db().transfers.get(id);
  if (!tr) return undefined;
  const next: Transfer = { ...tr, attachments };
  await db().transfers.put(next);
  return next;
}

export interface ReceiveLineInput { qty?: number; serials?: string[]; /** SN ที่ตรงแต่ชำรุด (OW: stockType damaged → พักตรวจ) */ damaged?: string[]; damagedQty?: number }
export interface ReceiveOpts { located?: Record<string, SerialLocated>; note?: string }
/**
 * ปลายทางรับเข้า — "รับของจริงเข้าครอบครอง" แยกจาก "ปิดผลต่าง"
 *   สแกนทุกชิ้นที่ได้รับจริง แล้วเทียบกับ SN ที่ต้นทางยืนยันส่ง:
 *   • ตรง (อยู่ในใบโอน)      → receivedSerials + on_hand ปลายทาง (ขายได้) + เครดิต in-transit ต้นทาง
 *   • นอกใบโอน (ไม่ได้ส่งมา)  → quarantinedSerials + on_hand&quarantine ปลายทาง (พักตรวจ ขายไม่ได้) + เปิดผลต่าง unexpected_sn ราย SN
 *                              (ไม่เครดิตต้นทาง — ไม่ใช่ของจากใบนี้)
 *   • ขาด (ส่งมาแต่ไม่พบ)     → ไม่รับ คงเป็น partial — ติดตามต่อ (ไม่หายจากระบบ) ปิดเป็น short ราย SN ตอน closeShort
 *   ❗ ไม่ "แทนค่า" SN ที่ขาดด้วย SN ที่เกิน — บันทึกเป็นสองรายการที่เชื่อมใบเดียวกัน
 */
export async function receiveTransfer(tr: Transfer, employeeId: string, received: Record<string, ReceiveLineInput>, note?: string, opts?: ReceiveOpts): Promise<Transfer> {
  const now = new Date().toISOString();
  const located = opts?.located ?? {};
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    if (!["in_transit", "partial_received"].includes(fresh.status)) throw new Error("transfer_wrong_status");
    const receiptLines: TransferReceipt["lines"] = [];
    const extras: { product_id: string; serialNo: string }[] = [];   // SN นอกใบโอน รอบนี้ (→ พักตรวจ + ผลต่าง)
    // รับหลายรอบ: สะสม (append) ไม่ทับของเดิม — ตรวจ SN/จำนวน "ก่อน" เพิ่มสต๊อก (อยู่ใน tx เดียว → error = rollback)
    const items = fresh.items.map((it) => {
      const inp = received[it.product_id] ?? {};
      const target = it.qty_shipped || it.qty_requested;
      if (it.isSerialized === true) {
        const shippedSet = new Set((it.shippedSerials ?? []).map((s) => s.serialNo));
        const prevRecv = new Set((it.receivedSerials ?? []).map((s) => s.serialNo));
        const prevQ = new Set((it.quarantinedSerials ?? []).map((s) => s.serialNo));
        const raw = (inp.serials ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (new Set(raw).size !== raw.length) throw new Error("serial_duplicate");               // กัน SN ซ้ำในรอบเดียว
        const batch = raw.filter((sn) => !prevRecv.has(sn) && !prevQ.has(sn));                   // SN ใหม่รอบนี้ (กดซ้ำ = ไม่เพิ่ม)
        const matched = batch.filter((sn) => shippedSet.has(sn));                                 // ตรงใบโอน → ขายได้
        const extra = batch.filter((sn) => !shippedSet.has(sn));                                  // นอกใบโอน → พักตรวจ
        if (matched.length) receiptLines.push({ product_id: it.product_id, qty: matched.length, serials: matched });
        for (const sn of extra) extras.push({ product_id: it.product_id, serialNo: sn });
        const recvMerged = [...(it.receivedSerials ?? []), ...matched.map((serialNo) => ({ serialNo, at: now, by: employeeId }))];
        const qMerged = [...(it.quarantinedSerials ?? []), ...extra.map((serialNo) => ({ serialNo, at: now, by: employeeId }))];
        return { ...it, qty_received: recvMerged.length, receivedSerials: recvMerged, quarantinedSerials: qMerged };
      }
      const outstanding = Math.max(0, target - (it.qty_received ?? 0));                  // ยอดค้างรับ
      const batchQty = Math.max(0, Math.round(inp.qty ?? 0));                            // จำนวนที่รับ "รอบนี้"
      if (batchQty > outstanding) throw new Error("receive_exceeds_outstanding");         // ห้ามรับเกินยอดค้าง
      if (batchQty) receiptLines.push({ product_id: it.product_id, qty: batchQty });
      return { ...it, qty_received: (it.qty_received ?? 0) + batchQty };
    });
    // สต๊อกต่อรอบ: ปลายทาง += ที่รับตรง · ต้นทาง otwo/reserved -= ที่รับตรง (ของจากใบนี้ที่มาถึงแล้ว)
    for (const rl of receiptLines) {
      await adjustStock(fresh.to_branch_id, rl.product_id, rl.qty);
      if (srcLocal(fresh)) { await adjustOtwo(fresh.from_branch_id, rl.product_id, -rl.qty); await reserveStock(fresh.from_branch_id, rl.product_id, -rl.qty); }
    }
    // SN นอกใบโอน: เข้าปลายทางจริง (on_hand) แต่ถือพักตรวจ (quarantine) → available สุทธิ 0 · เปิดผลต่าง unexpected_sn ราย SN
    const newDiscs: TransferDiscrepancy[] = [];
    for (const ex of extras) {
      await adjustStock(fresh.to_branch_id, ex.product_id, 1);
      await quarantineStock(fresh.to_branch_id, ex.product_id, 1);
      newDiscs.push({ id: nanoid(8), product_id: ex.product_id, kind: "unexpected_sn", qty: 1, serialNo: ex.serialNo, located: located[ex.serialNo] ?? null, status: "open", at: now, by: employeeId });
    }
    // ครบ = ทุกบรรทัด รับครบ และ (serialized) SN ที่ "ส่งมา" ทุกตัวถูกรับ (SN นอกใบโอนไม่นับว่าครบ)
    const complete = items.every((it) => {
      const target = it.qty_shipped || it.qty_requested;
      if (it.isSerialized === true) {
        const recv = new Set((it.receivedSerials ?? []).map((s) => s.serialNo));
        return (it.shippedSerials ?? []).map((s) => s.serialNo).every((sn) => recv.has(sn)) && recv.size >= target;
      }
      return it.qty_received >= target;
    });
    const receipts: TransferReceipt[] = [...(fresh.receipts ?? []), { id: nanoid(8), at: now, by: employeeId, note: note ?? null, lines: receiptLines }];
    const status: TransferStatus = complete ? "completed" : "partial_received";
    const nx = await putTransferTx(fresh, { status, items, receipts, ...(newDiscs.length ? { discrepancies: [...(fresh.discrepancies ?? []), ...newDiscs] } : {}) });
    return { nx, received: receiptLines.reduce((s, r) => s + r.qty, 0), extra: extras.length, round: receipts.length };
  });
  await auditTransfer(next.nx, employeeId, next.nx.to_branch_id, { status: next.nx.status, received: next.received, unexpected_sn: next.extra, round: next.round });
  return next.nx;
}

/** ปิดรับโดยยอมรับส่วนขาด (partial → completed) — ปล่อย otwo/reserved ส่วนที่ไม่มาถึง + บันทึกผลต่าง short */
export async function closeTransferShort(tr: Transfer, employeeId: string, note?: string): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    if (fresh.status !== "partial_received") throw new Error("transfer_wrong_status"); // ปิดได้เฉพาะใบที่รับบางส่วน
    // ข้อ 6: ปิดรับ = "บันทึกส่วนขาด (รอตรวจสอบ)" เท่านั้น — ยังไม่ตัด OTWO/คืนจอง
    //   ยอดส่วนขาดคงค้างเป็น OTWO + Reserved Out จนกว่าหัวหน้าจะอนุมัติปิด (resolveDiscrepancy) จึงเขียนออกจริง
    const discs: TransferDiscrepancy[] = [...(fresh.discrepancies ?? [])];
    const flagged = new Set(discs.filter((d) => d.serialNo).map((d) => `${d.product_id}:${d.serialNo}`)); // กันบันทึก SN ซ้ำ
    for (const it of fresh.items) {
      const target = it.qty_shipped || it.qty_requested;
      if (it.isSerialized === true) {
        // ขาดราย SN — SN ที่ "ส่งมาแต่ยังไม่ถูกรับ" แต่ละตัวเปิดเป็นเคสติดตามแยก (ไม่หายจากระบบ)
        const recv = new Set((it.receivedSerials ?? []).map((s) => s.serialNo));
        const missing = (it.shippedSerials ?? []).map((s) => s.serialNo).filter((sn) => !recv.has(sn));
        for (const sn of missing) {
          if (flagged.has(`${it.product_id}:${sn}`)) continue;
          discs.push({ id: nanoid(8), product_id: it.product_id, kind: "short", qty: 1, serialNo: sn, status: "open", at: now, by: employeeId, note: note ?? null });
        }
        continue;
      }
      const short = Math.max(0, target - (it.qty_received ?? 0));
      if (short > 0) discs.push({ id: nanoid(8), product_id: it.product_id, kind: "short", qty: short, status: "open", at: now, by: employeeId, note: note ?? null });
    }
    return putTransferTx(fresh, { status: "completed", discrepancies: discs });
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { status: "completed", closed_short: true });
  return next;
}

/** บันทึกผลต่าง (ชำรุด/หาย/ผิด SN/ขาด/เกิน) + ผู้รับผิดชอบ · ชำรุด/SN ผิด → พักตรวจ (quarantine) ที่ปลายทาง ขายไม่ได้ */
export async function recordDiscrepancy(tr: Transfer, employeeId: string, disc: Omit<TransferDiscrepancy, "id" | "status" | "at" | "by">): Promise<Transfer> {
  const d: TransferDiscrepancy = { ...disc, id: nanoid(8), status: "open", at: new Date().toISOString(), by: employeeId };
  const now = d.at;
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    let items = fresh.items;
    if ((d.kind === "damaged" || d.kind === "wrong_sn") && d.qty > 0) {
      await quarantineStock(fresh.to_branch_id, d.product_id, d.qty);
      // ถ้าระบุ SN → ย้ายตัวนั้นจาก "รับแล้ว" (ขายได้) ไป "พักตรวจ" (ขายไม่ได้) เพื่อตามรอยถูกตัว
      if (d.serialNo) items = items.map((it) => it.product_id === d.product_id ? {
        ...it,
        receivedSerials: (it.receivedSerials ?? []).filter((s) => s.serialNo !== d.serialNo),
        quarantinedSerials: [...(it.quarantinedSerials ?? []), { serialNo: d.serialNo!, at: now, by: employeeId }],
      } : it);
    }
    return putTransferTx(fresh, { discrepancies: [...(fresh.discrepancies ?? []), d], items });
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { discrepancy: d.kind });
  return next;
}

/** ขออนุมัติปิดผลต่าง (รอตรวจสอบ → รออนุมัติ) + บันทึกวิธีจัดการยอด/เหตุผล */
export async function requestResolveDiscrepancy(tr: Transfer, discId: string, employeeId: string, note?: string): Promise<Transfer> {
  const now = new Date().toISOString();
  const discrepancies = (tr.discrepancies ?? []).map((d) => d.id === discId ? { ...d, status: "pending_approval" as const, requested_by: employeeId, requested_at: now, resolution_note: note ?? d.resolution_note ?? null } : d);
  return writeTransfer(tr, { discrepancies }, employeeId, tr.to_branch_id, { request_resolve_discrepancy: discId });
}

/**
 * ปิดเรื่องผลต่าง (หัวหน้าอนุมัติปิด → แก้ไขแล้ว) — ตัดยอดจริงตอนนี้ (ข้อ 6) · atomic
 *   short/lost → เขียนออกจาก in-transit ต้นทาง (ตัด OTWO + คืน Reserved Out) [confirmed_lost]
 *   damaged/wrong_sn (พักตรวจปลายทาง) → "release"=ปล่อยขาย · "dispose"=ตัดทิ้ง
 *   unexpected_sn (SN นอกใบโอน พักตรวจ) → "accept"=ยอมรับที่ปลายทาง(ขายได้) · "dispose"=ตัดทิ้ง
 *     ❗ การยอมรับ SN นอกใบโอน "ไม่" ทำให้ SN ที่ขาดกลับเข้าสต๊อกต้นทางเอง — เคสขาดยังต้องตรวจแยก
 */
export async function resolveDiscrepancy(tr: Transfer, discId: string, employeeId: string, outcome: "release" | "dispose" | "accept" | "found_source" | "confirmed_lost" = "dispose"): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    const disc = (fresh.discrepancies ?? []).find((d) => d.id === discId);
    if (!disc) throw new Error("transfer_not_found");
    let items = fresh.items;
    let sn_outcome: SerialOutcome | null = null;
    if (disc.status !== "resolved") {
      if (disc.kind === "short" || disc.kind === "lost") {
        // ขาด/สูญหาย — SN ที่ส่งมาแต่ไม่ถึง: ปิด in-transit ที่ต้นทาง (ตัด OTWO + คืน Reserved)
        //  found_source=พบที่ต้นทาง (ของไม่เคยออกจริง) → คืนเข้า on_hand ต้นทาง · confirmed_lost=สูญหายจริง → ไม่คืน
        if (srcLocal(fresh)) {
          await adjustOtwo(fresh.from_branch_id, disc.product_id, -disc.qty);
          await reserveStock(fresh.from_branch_id, disc.product_id, -disc.qty);
          if (outcome === "found_source") await adjustStock(fresh.from_branch_id, disc.product_id, disc.qty);
        }
        sn_outcome = outcome === "found_source" ? "found_source" : "confirmed_lost";
      } else if (disc.kind === "damaged" || disc.kind === "wrong_sn") {
        // ปล่อยจาก quarantine ปลายทาง · ถ้า dispose ตัดออกจาก on_hand ด้วย (ของเสียทิ้ง)
        await quarantineStock(fresh.to_branch_id, disc.product_id, -disc.qty);
        if (outcome === "dispose") await adjustStock(fresh.to_branch_id, disc.product_id, -disc.qty);
        // ย้าย SN กลับ: release=รับเข้าขายได้ · dispose=เอาออก
        if (disc.serialNo) items = items.map((it) => it.product_id === disc.product_id ? {
          ...it,
          quarantinedSerials: (it.quarantinedSerials ?? []).filter((s) => s.serialNo !== disc.serialNo),
          receivedSerials: outcome === "release" ? [...(it.receivedSerials ?? []), { serialNo: disc.serialNo!, at: now, by: employeeId }] : (it.receivedSerials ?? []),
        } : it);
      } else if (disc.kind === "unexpected_sn") {
        // SN นอกใบโอน พักตรวจอยู่ (on_hand+quarantine ปลายทาง) → accept=ปล่อยขาย · dispose=ตัดทิ้ง
        await quarantineStock(fresh.to_branch_id, disc.product_id, -disc.qty);
        if (outcome === "dispose") await adjustStock(fresh.to_branch_id, disc.product_id, -disc.qty);
        sn_outcome = outcome === "dispose" ? "dispose" : "accept";
        // ย้าย SN จากพักตรวจ → รับเข้า (accept) หรือเอาออก (dispose)
        if (disc.serialNo) items = items.map((it) => it.product_id === disc.product_id ? {
          ...it,
          quarantinedSerials: (it.quarantinedSerials ?? []).filter((s) => s.serialNo !== disc.serialNo),
          receivedSerials: outcome === "accept" ? [...(it.receivedSerials ?? []), { serialNo: disc.serialNo!, at: now, by: employeeId }] : (it.receivedSerials ?? []),
        } : it);
      }
    }
    const label = outcome === "release" ? "ปล่อยขาย (ผ่านตรวจ)" : outcome === "accept" ? "ยอมรับที่ปลายทาง (ผ่านตรวจ)" : outcome === "found_source" ? "พบที่ต้นทาง (คืนสต๊อกต้นทาง)" : disc.kind === "short" || disc.kind === "lost" ? "ยืนยันสูญหาย (ตัดยอด)" : "ตัดจำหน่าย";
    const discrepancies = (fresh.discrepancies ?? []).map((d) => d.id === discId ? { ...d, status: "resolved" as const, resolved_by: employeeId, resolved_at: now, sn_outcome: sn_outcome ?? d.sn_outcome ?? null, resolution_note: d.resolution_note ?? label } : d);
    return putTransferTx(fresh, { discrepancies, items });
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { resolved_discrepancy: discId, outcome });
  return next;
}

// ── ส่งคืนจากการรับโอน: ใช้ Return Doc flow ด้านล่าง (openReturn → … → closeReturn) ──

// ====================================================================
// ใบส่งคืนจากการรับโอน (Return Doc) — วงจร 7 ขั้น + สถานะขนส่ง
//   ใช้กับของที่รับเข้าปลายทางแล้ว "พักตรวจ" (quarantine) — ชำรุด/SN ไม่ตรง
//   บัญชี: ย้ายของจริง ปลายทาง on_hand(+quarantine) → ต้นทาง on_hand(+quarantine)
//          ของนับที่เดียวเสมอ · ต้นทางรับแล้ว "ไม่ขายอัตโนมัติ" (เข้าพักตรวจ)
// ====================================================================
function retNo(): string { return `RT-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`; }
function getRet(fresh: Transfer, retId: string): TransferReturn { const r = (fresh.returns ?? []).find((x) => x.id === retId); if (!r) throw new Error("return_not_found"); return r; }
const retTotal = (r: TransferReturn) => (r.lines ?? []).reduce((s, l) => s + l.qty, 0);
const retRecv = (r: TransferReturn) => (r.lines ?? []).reduce((s, l) => s + (l.qty_received ?? 0), 0);
function patchRet(fresh: Transfer, retId: string, patch: Partial<TransferReturn>): Partial<Transfer> {
  return { returns: (fresh.returns ?? []).map((x) => x.id === retId ? { ...x, ...patch } : x) };
}

/** เปิดใบส่งคืน (draft) — ยังไม่แตะสต๊อก (ของยังพักตรวจที่ปลายทาง) + ปิดผลต่างต้นเหตุเป็น "ส่งคืน/ส่งซ่อม" */
export async function openReturn(tr: Transfer, employeeId: string, input: { disc_ids?: string[]; outcome: RtnOutcome; reason_kind: RtnReason; reason?: string | null; lines: RtnLine[]; photos?: string[] }): Promise<Transfer> {
  const now = new Date().toISOString();
  const ret: TransferReturn = {
    id: nanoid(8), return_no: retNo(), disc_ids: input.disc_ids ?? [], outcome: input.outcome,
    reason_kind: input.reason_kind, reason: input.reason ?? null, photos: input.photos ?? [],
    lines: input.lines.map((l) => ({ ...l, qty: Math.max(1, Math.round(l.qty)), qty_received: 0 })),
    status: "draft", created_by: employeeId, created_at: now,
  };
  const outLabel = input.outcome === "repair" ? "ส่งซ่อม" : "ส่งคืนต้นทาง";
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr);
    const ids = new Set(input.disc_ids ?? []);
    // ยังไม่ปิดเคส — ตั้งเป็น "กำลังจัดการด้วยใบส่งคืน" (ปิดจริงตอน closeReturn · ยกเลิกใบ → กลับมา open)
    const discrepancies = (fresh.discrepancies ?? []).map((d) => ids.has(d.id) ? { ...d, status: "handling" as const, handled_by_return: ret.return_no, resolution_note: `${outLabel} (${ret.return_no})` } : d);
    return putTransferTx(fresh, { returns: [...(fresh.returns ?? []), ret], ...(ids.size ? { discrepancies } : {}) });
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { open_return: ret.return_no, outcome: input.outcome });
  return next;
}

/** draft → pending_approval (PC ปลายทางส่งให้หัวหน้าตรวจ) */
export async function requestReturnApproval(tr: Transfer, employeeId: string, retId: string, note?: string): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (r.status !== "draft") throw new Error("return_wrong_status");
    return putTransferTx(fresh, patchRet(fresh, retId, { status: "pending_approval", requested_by: employeeId, requested_at: now, reason: note ?? r.reason }));
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { return_request_approval: retId });
  return next;
}

/** pending_approval → approved (หัวหน้าอนุมัติ) */
export async function approveReturn(tr: Transfer, employeeId: string, retId: string): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (r.status !== "pending_approval") throw new Error("return_wrong_status");
    return putTransferTx(fresh, patchRet(fresh, retId, { status: "approved", approved_by: employeeId, approved_at: now }));
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { return_approved: retId });
  return next;
}

/** ยกเลิกใบส่งคืน — เฉพาะก่อนส่งจริง (ของยังพักตรวจที่ปลายทาง ไม่แตะยอด) */
export async function cancelReturn(tr: Transfer, employeeId: string, retId: string, reason?: string): Promise<Transfer> {
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (!["draft", "pending_approval", "approved", "preparing"].includes(r.status)) throw new Error("return_wrong_status");
    // คืนเคสผลต่างที่ผูกไว้ กลับเป็น "รอตรวจสอบ" (เลือกวิธีจัดการใหม่ได้)
    const ids = new Set(r.disc_ids ?? []);
    const discrepancies = (fresh.discrepancies ?? []).map((d) => ids.has(d.id) && d.status === "handling" ? { ...d, status: "open" as const, handled_by_return: null, resolution_note: null } : d);
    return putTransferTx(fresh, { ...patchRet(fresh, retId, { status: "cancelled", reason: reason ?? r.reason }), ...(ids.size ? { discrepancies } : {}) });
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { return_cancelled: retId });
  return next;
}

/** approved → preparing (สแกน SN/แพ็ค ที่ปลายทาง) */
export async function packReturn(tr: Transfer, employeeId: string, retId: string, snsByProduct: Record<string, string[]>): Promise<Transfer> {
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (!["approved", "preparing"].includes(r.status)) throw new Error("return_wrong_status");
    const lines = (r.lines ?? []).map((l) => ({ ...l, sns_found: snsByProduct[l.product_id] ?? l.sns_found }));
    return putTransferTx(fresh, patchRet(fresh, retId, { status: "preparing", lines }));
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { return_packed: retId });
  return next;
}

/** preparing → returning (ยืนยันส่งคืน + ขนส่ง) → ปลายทาง On Hand − (ออกจากพักตรวจ) + SN ออกจากพักตรวจปลายทาง */
export async function dispatchReturn(tr: Transfer, employeeId: string, retId: string, opts: { carrier?: string | null; tracking?: string | null }): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (!["approved", "preparing"].includes(r.status)) throw new Error("return_wrong_status");
    let items = fresh.items;
    for (const l of r.lines ?? []) {
      const it = fresh.items.find((x) => x.product_id === l.product_id);
      const serialized = it?.isSerialized === true;
      // สินค้ามี SN: ต้อง "สแกนของที่จะส่งจริง" ให้ครบก่อน (packReturn ตั้ง sns_found) — ห้ามใช้ SN ที่คาดหวังแทน
      if (serialized) {
        const sns = (l.sns_found ?? []).map((sn) => sn.trim().toUpperCase()).filter(Boolean);
        if (sns.length !== l.qty) throw new Error("return_serials_required");
        if (new Set(sns).size !== sns.length) throw new Error("serial_duplicate");
        const held = new Set((it?.quarantinedSerials ?? []).map((sn) => sn.serialNo.trim().toUpperCase()));
        if (sns.some((sn) => !held.has(sn))) throw new Error("return_serial_not_quarantined");
        l.sns_found = sns;
      }
      await quarantineStock(fresh.to_branch_id, l.product_id, -l.qty);
      await adjustStock(fresh.to_branch_id, l.product_id, -l.qty);
      if (serialized) { const rm = new Set(l.sns_found ?? []); items = items.map((x) => x.product_id === l.product_id ? { ...x, quarantinedSerials: (x.quarantinedSerials ?? []).filter((s) => !rm.has(s.serialNo)) } : x); }
    }
    return putTransferTx(fresh, { ...patchRet(fresh, retId, { status: "returning", carrier: opts.carrier ?? null, tracking: opts.tracking ?? null, shipped_by: employeeId, shipped_at: now }), items });
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { return_dispatched: retId, carrier: opts.carrier ?? null });
  return next;
}

/** อัปเดตสถานะขนส่งขาส่งคืน — ไม่แตะยอด */
export async function setReturnShipStage(tr: Transfer, employeeId: string, retId: string, stage: RtnShipStage): Promise<Transfer> {
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (r.status !== "returning") throw new Error("return_wrong_status");
    return putTransferTx(fresh, patchRet(fresh, retId, { ship_stage: stage }));
  });
  await auditTransfer(next, employeeId, next.to_branch_id, { return_ship_stage: stage });
  return next;
}

/** ต้นทางรับคืนจริง (บางส่วน/ครบ) → ต้นทาง On Hand + และเข้า "พักตรวจ" (ไม่ขายอัตโนมัติ) */
export async function receiveReturnLines(tr: Transfer, employeeId: string, retId: string, recv: { product_id: string; qty: number; sns_found?: string[] }[]): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (!["returning", "partial_received"].includes(r.status)) throw new Error("return_wrong_status");
    const lines = (r.lines ?? []).map((l) => ({ ...l }));
    for (const rc of recv) {
      const l = lines.find((x) => x.product_id === rc.product_id); if (!l) continue;
      const it = fresh.items.find((x) => x.product_id === l.product_id);
      const serialized = it?.isSerialized === true;
      const remain = l.qty - (l.qty_received ?? 0);
      if (remain <= 0) continue;
      if (serialized) {
        // ต้นทางสแกนรับคืนจริง → ต้องตรงกับ SN ที่ "ส่งคืน" (sns_found) + แยกชุดขารับ (sns_received_back)
        const sent = new Set(l.sns_found ?? []);
        const already = new Set(l.sns_received_back ?? []);
        const scan = (rc.sns_found ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (new Set(scan).size !== scan.length) throw new Error("serial_duplicate");
        const fresh2 = scan.filter((sn) => !already.has(sn));
        for (const sn of fresh2) if (!sent.has(sn)) throw new Error("return_serial_mismatch"); // รับ SN ที่ไม่ได้อยู่ในของที่ส่งคืน
        const accepted = fresh2.slice(0, remain);
        if (!accepted.length) continue;
        await adjustStock(fresh.from_branch_id, l.product_id, accepted.length);
        await quarantineStock(fresh.from_branch_id, l.product_id, accepted.length);
        l.qty_received = (l.qty_received ?? 0) + accepted.length;
        l.sns_received_back = [...(l.sns_received_back ?? []), ...accepted];
      } else {
        const take = Math.max(0, Math.min(remain, Math.round(rc.qty)));
        if (take <= 0) continue;
        await adjustStock(fresh.from_branch_id, l.product_id, take);
        await quarantineStock(fresh.from_branch_id, l.product_id, take);
        l.qty_received = (l.qty_received ?? 0) + take;
      }
    }
    const done = lines.every((l) => (l.qty_received ?? 0) >= l.qty);
    return putTransferTx(fresh, patchRet(fresh, retId, { lines, status: done ? "received" : "partial_received", received_by: employeeId, received_at: now }));
  });
  await auditTransfer(next, employeeId, next.from_branch_id, { return_received: retId });
  return next;
}

/** ปิดงาน — สรุปผลตรวจที่ต้นทางต่อรายการ: release=ปล่อยขาย · repair=คงพักตรวจ(ส่งซ่อม) · dispose=ตัดจำหน่าย */
export async function closeReturn(tr: Transfer, employeeId: string, retId: string, outcomes: Record<string, "release" | "repair" | "dispose">): Promise<Transfer> {
  const now = new Date().toISOString();
  const next = await txTransfer(async () => {
    const fresh = await freshOrThrow(tr); const r = getRet(fresh, retId);
    if (!["received", "partial_received"].includes(r.status)) throw new Error("return_wrong_status");
    const lines = (r.lines ?? []).map((l) => ({ ...l }));
    for (const l of lines) {
      const q = l.qty_received ?? 0; if (q <= 0) continue;
      const oc = outcomes[l.product_id] ?? (r.outcome === "repair" ? "repair" : "release");
      if (oc === "release") { await quarantineStock(fresh.from_branch_id, l.product_id, -q); }
      else if (oc === "dispose") { await quarantineStock(fresh.from_branch_id, l.product_id, -q); await adjustStock(fresh.from_branch_id, l.product_id, -q); }
      // repair: คงพักตรวจไว้ (ไม่แตะยอด)
      l.close_outcome = oc;
    }
    const allDone = lines.every((l) => (l.qty_received ?? 0) >= l.qty);
    // ปิดเคสผลต่างที่ผูกไว้ "ตอนนี้" (ปิดจริงเมื่อใบคืนปิดงาน) — เฉพาะตอนรับคืนครบ
    const ids = new Set(r.disc_ids ?? []);
    const discrepancies = (allDone && ids.size)
      ? (fresh.discrepancies ?? []).map((d) => ids.has(d.id) && d.status !== "resolved"
          ? { ...d, status: "resolved" as const, resolved_by: employeeId, resolved_at: now, sn_outcome: (r.outcome === "repair" ? "return_source" : "return_source") as SerialOutcome, resolution_note: `ส่งคืนต้นทางแล้ว (${r.return_no})` }
          : d)
      : (fresh.discrepancies ?? []);
    return putTransferTx(fresh, { ...patchRet(fresh, retId, { lines, status: "closed", closed_by: employeeId, closed_at: now }), discrepancies });
  });
  await auditTransfer(next, employeeId, next.from_branch_id, { return_closed: retId });
  return next;
}

/** เชื่อม "ใบส่งทดแทน" เข้ากับเคส SN ขาด — บันทึกเลขใบใหม่ + ทำเครื่องหมาย sn_outcome=replaced (ไม่ปิดเคส ติดตาม SN เดิมต่อได้) */
export async function markDiscReplacement(tr: Transfer, discId: string, employeeId: string, replacementNo: string): Promise<Transfer> {
  const discrepancies = (tr.discrepancies ?? []).map((d) => d.id === discId ? { ...d, replacement_no: replacementNo, sn_outcome: "replaced" as SerialOutcome } : d);
  return writeTransfer(tr, { discrepancies }, employeeId, tr.to_branch_id, { disc_replacement: discId, replacement_no: replacementNo });
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
  // opening = นับเปิดระบบ → รวม "ทุกสินค้า is_stocked" แม้ยังไม่มีแถวสต๊อก (ยอดตั้งต้น = ของจริงที่นับได้)
  //  type อื่น → เฉพาะที่มีแถวสต๊อกอยู่แล้ว
  let candidates = products.filter((p) => p.is_stocked && (opts.type === "opening" || stock.has(p.id)));
  if (opts.type === "category" && opts.categoryId) candidates = candidates.filter((p) => p.category_id === opts.categoryId);
  if (opts.type === "brand" && opts.brandId) candidates = candidates.filter((p) => p.brand_id === opts.brandId);
  if (opts.type === "serial") candidates = candidates.filter((p) => p.track_serial);
  if (opts.type === "random") candidates = [...candidates].sort(() => Math.random() - 0.5).slice(0, 15);

  const now = new Date().toISOString();
  const session: StockCountSession = {
    id: nanoid(),
    count_no: `SC-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
    branch_id: branchId, zone: opts.zone, type: opts.type, status: "counting", blind: opts.blind, note: opts.note ?? null,
    lines: candidates.map((p) => ({ product_id: p.id, sku: p.sku, name: p.name_th, expected: stock.get(p.id)?.qty_on_hand ?? 0, counted: null })),
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
  const d = db();
  const emp = await d.employees.get(approverId);
  if (!emp || emp.status !== "active" || !can(emp, "inventory.adjust")) throw new Error("count_approval_forbidden");
  if (isLiveMode()) {
    const fresh=await d.stock_counts.get(session.id);
    if(!fresh || fresh.status!=="submitted") {
      if(fresh?.status==="completed")return;
      throw new Error("count_wrong_status");
    }
    const response=await fetch("/api/pos/count",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(fresh)});
    const result=await response.json();if(!response.ok)throw new Error(result.error);
    await d.stock_counts.update(fresh.id,{status:"completed",approved_by:approverId,approved_at:new Date().toISOString()});
    await (await import("../offline/refresh")).refreshBranchSnapshot();
    return;
  }
  await d.transaction("rw", [d.stock_counts, d.stock, d.audit, d.pending], async () => {
    const fresh = await d.stock_counts.get(session.id);
    if (!fresh) throw new Error("count_not_found");
    if (fresh.status === "completed") return; // Repeated approval must not change stock.
    if (fresh.status !== "submitted") throw new Error("count_wrong_status");
    for (const l of fresh.lines) {
      if (l.counted == null) continue;
      if (!Number.isFinite(l.counted) || l.counted < 0) throw new Error("count_invalid_quantity");
      const current = (await d.stock.get(stockKey(fresh.branch_id, l.product_id)))?.qty_on_hand ?? 0;
      if (current !== l.expected) throw new Error("count_stock_changed: สต๊อกเปลี่ยนระหว่างนับ กรุณาตรวจสอบรอบนับใหม่");
      const delta = round2(l.counted - l.expected);
      if (!delta) continue;
      await adjustStock(fresh.branch_id, l.product_id, delta);
      const row: AuditEntry = {
        id: nanoid(), action: "stock_count", actor_id: approverId,
        actor_name: emp?.nickname ?? emp?.first_name ?? null,
        branch_id: fresh.branch_id, ref_table: "stock_counts", ref_no: fresh.count_no,
        amount: null, occurred_at: new Date().toISOString(), is_offline: false,
        after_data: { sku: l.sku, product_id: l.product_id, before: l.expected, after: l.counted, delta, stock_count_id: fresh.id },
      };
      await d.audit.put(row);
      const { id, actor_name, ...payload } = row;
      await d.pending.add({ op: "audit", client_uuid: id, payload, created_at: row.occurred_at, attempts: 0, status: "pending" });
    }
    await d.stock_counts.update(fresh.id, { status: "completed", approved_by: approverId, approved_at: new Date().toISOString() });
  });
}

/**
 * รับสินค้าเข้า (Goods Receipt) — รับจาก supplier → เพิ่มสต๊อก + เขียน ledger (action "receive")
 */
export async function recordGoodsReceipt(
  branchId: string, employeeId: string, supplier: string, poRef: string, note: string,
  lines: { productId: string; sku: string; name: string; qty: number }[]
): Promise<string> {
  if (isLiveMode()) throw new Error("การรับเข้าจริงต้องอ้างใบส่งจาก OneWarehouse กรุณารอการเชื่อมรายการรอรับ ห้ามเพิ่มยอดด้วยการกรอกจำนวนเอง");
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
  if (isLiveMode()) {
    const response=await fetch("/api/pos/count",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:adjustNo,branch_id:branchId,note:`${reason}: ${note}`,lines:lines.map(l=>({product_id:l.productId,expected:l.before,counted:l.after}))})});
    const result=await response.json();if(!response.ok)throw new Error(result.error);
    await (await import("../offline/refresh")).refreshBranchSnapshot();
    return adjustNo;
  }
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
  const d = db();
  const result = await d.transaction("rw", [d.orders, d.stock, d.shifts, d.audit, d.pending, d.employees, d.products, d.branches, d.terminals, d.customers, d.kv], async () => {
    const existing = await d.orders.where("client_uuid").equals(draft.client_uuid).first();
    if (existing) return { order: existing, offline: existing.is_offline_origin };
    const cashier = await d.employees.get(draft.cashier_id);
    if (!draft.client_uuid) throw new Error("sale_missing_operation_id");
    if (!cashier || cashier.status !== "active" || !can(cashier, "pos.sell")) throw new Error("sale_forbidden");
    const needed = new Map<string, number>();
    for (const item of draft.items) {
      if (!Number.isFinite(item.qty) || item.qty <= 0) throw new Error("sale_invalid_quantity");
      if (item.product_id) needed.set(item.product_id, (needed.get(item.product_id) ?? 0) + item.qty);
    }
    for (const [id, qty] of needed) {
      const product = await d.products.get(id);
      if (!product) throw new Error("product_not_found");
      if (!draft.central_committed && product.is_stocked && (await readStockView(draft.branch_id, id)).available < qty) throw new Error("insufficient_available_stock");
    }
    return commitSaleTx(draft);
  });
  await refreshCounts();
  void flush();
  return result;
}

async function commitSaleTx(draft: OrderDraft): Promise<SaleResult> {
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
      is_gift: l.is_gift ?? false,
      gift_source: l.gift_source,
      gift_campaign_id: l.gift_campaign_id ?? null,
      gift_of_sku: l.gift_of_sku ?? null,
    };
  });

  const order: Order = {
    id: nanoid(),
    order_no: draft.central_order_no || `${prefix}-${now.slice(2, 10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`,
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
    // จองของ/ส่งทีหลัง: ยืนยัน Order แล้วแต่ยังไม่ส่งมอบ → จอง Reserved Order (ตัด On Hand ตอนส่งมอบ)
    fulfillment: draft.reserve ? "reserved" : "immediate",
    reserve_expires_at: draft.reserve ? new Date(Date.now() + (draft.reserve_days ?? 7) * 86400000).toISOString() : null,
    deliveries: [],
  };

  if (draft.central_committed) await kvSet("central_commit_generation", draft.client_uuid);
  // 1) บันทึกบิลลงเครื่องก่อน — ถึงตรงนี้ถือว่าขายสำเร็จแล้ว
  await db().orders.put(order);

  // 2) สต๊อก: ขายทันที=ตัด On Hand · จอง/ส่งทีหลัง=จอง Reserved Order (ยัง On Hand เท่าเดิม, Available ลด)
  for (const it of items) {
    if (!it.product_id) continue;
    const p = await db().products.get(it.product_id);
    if (!p?.is_stocked || draft.central_committed) continue;
    if (draft.reserve) await reserveOrderStock(order.branch_id, it.product_id, it.qty);
    else await adjustStock(order.branch_id, it.product_id, -it.qty);
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

  if (!draft.central_committed) await enqueue("create_order", draft.client_uuid, {
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
    promo_snapshot: draft.promo_snapshot ?? null,
    items: items.map((i) => ({
      product_id: i.product_id, sku: i.sku, name: i.name, kind: i.kind, qty: i.qty,
      unit_price: i.unit_price, discount_amount: i.discount_amount, line_total: i.line_total,
      unit_cost: i.unit_cost, cost_total: i.cost_total, gross_profit: i.gross_profit,
      salesperson_id: i.salesperson_id, serials: i.serials,
      is_gift: i.is_gift ?? false, gift_source: i.gift_source ?? null,
      gift_campaign_id: i.gift_campaign_id ?? null, gift_of_sku: i.gift_of_sku ?? null,
    })),
    payments: draft.payments,
  });

  // 5) ใช้แต้มเป็นส่วนลด → หักแต้มลูกค้า (หลัง create_order เพื่อให้หาเลขบิลจาก client_uuid ได้)
  if (!draft.central_committed && draft.customer_id && (draft.redeem_points ?? 0) > 0) {
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
  if (!draft.central_committed && draft.coupon_code && (draft.coupon_discount ?? 0) > 0) {
    await enqueue("redeem_coupon", `${draft.client_uuid}:coupon`, {
      code: draft.coupon_code,
      customer_id: draft.customer_id ?? null,
      client_uuid: draft.client_uuid,
      discount: draft.coupon_discount,
    });
  }

  return { order, offline: order.is_offline_origin };
}

// ── ออเดอร์จอง/ส่งทีหลัง (Reserved Order) — ส่งมอบ / ยกเลิก / หมดอายุ ──
/** ส่งมอบของออเดอร์จอง (ทั้งหมดหรือบางส่วน) — ตัด On Hand + ปล่อย Reserved Order เฉพาะที่ส่ง · atomic */
export async function deliverOrder(orderId: string, employeeId: string, lines?: { product_id: string; qty: number }[]): Promise<Order> {
  return db().transaction("rw", db().orders, db().stock, db().audit, db().products, async () => {
    const o = await db().orders.get(orderId);
    if (!o) throw new Error("order_not_found");
    if (o.fulfillment !== "reserved" && o.fulfillment !== "partial") throw new Error("order_wrong_status");
    // ค้างส่งต่อสินค้า = qty ที่ขาย − ที่ส่งไปแล้ว
    const deliveredSoFar: Record<string, number> = {};
    for (const d of o.deliveries ?? []) for (const l of d.lines) deliveredSoFar[l.product_id] = (deliveredSoFar[l.product_id] ?? 0) + l.qty;
    const outstanding: Record<string, number> = {};
    for (const it of o.items) if (it.product_id) outstanding[it.product_id] = (outstanding[it.product_id] ?? 0) + it.qty - (deliveredSoFar[it.product_id] ?? 0);
    // เลือกส่ง: ระบุ lines = ส่งบางส่วน · ไม่ระบุ = ส่งที่ค้างทั้งหมด
    const toDeliver = (lines ?? Object.entries(outstanding).map(([product_id, qty]) => ({ product_id, qty }))).filter((l) => l.qty > 0);
    const applied: { product_id: string; qty: number }[] = [];
    for (const l of toDeliver) {
      const cap = Math.min(l.qty, outstanding[l.product_id] ?? 0);
      if (cap <= 0) continue;
      const p = await db().products.get(l.product_id);
      if (p?.is_stocked) { await adjustStock(o.branch_id, l.product_id, -cap); await reserveOrderStock(o.branch_id, l.product_id, -cap); }
      applied.push({ product_id: l.product_id, qty: cap });
    }
    if (!applied.length) throw new Error("order_wrong_status");
    const deliveries = [...(o.deliveries ?? []), { at: new Date().toISOString(), by: employeeId, lines: applied }];
    // ส่งครบทุกตัวหรือยัง
    const after: Record<string, number> = { ...deliveredSoFar };
    for (const a of applied) after[a.product_id] = (after[a.product_id] ?? 0) + a.qty;
    const complete = o.items.every((it) => !it.product_id || (after[it.product_id] ?? 0) >= it.qty);
    const next: Order = { ...o, deliveries, fulfillment: complete ? "delivered" : "partial", synced: false };
    await db().orders.put(next);
    return { next, applied };
  }).then(async ({ next, applied }) => {
    await writeAudit({ action: "order", actor_id: employeeId, branch_id: next.branch_id, ref_table: "orders", ref_no: next.order_no, amount: null, after_data: { deliver: applied, fulfillment: next.fulfillment }, is_offline: false });
    return next;
  });
}

/** ยกเลิกออเดอร์จอง (ก่อนส่งมอบ) — ปล่อย Reserved Order ที่ค้าง (ไม่แตะ On Hand) · atomic */
export async function cancelReservedOrder(orderId: string, employeeId: string, reason?: string): Promise<Order> {
  return db().transaction("rw", db().orders, db().stock, db().audit, db().products, async () => {
    const o = await db().orders.get(orderId);
    if (!o) throw new Error("order_not_found");
    if (o.fulfillment !== "reserved" && o.fulfillment !== "partial") throw new Error("order_wrong_status");
    const deliveredSoFar: Record<string, number> = {};
    for (const d of o.deliveries ?? []) for (const l of d.lines) deliveredSoFar[l.product_id] = (deliveredSoFar[l.product_id] ?? 0) + l.qty;
    for (const it of o.items) {
      if (!it.product_id) continue;
      const remain = it.qty - (deliveredSoFar[it.product_id] ?? 0);
      const p = await db().products.get(it.product_id);
      if (remain > 0 && p?.is_stocked) await reserveOrderStock(o.branch_id, it.product_id, -remain);
    }
    const next: Order = { ...o, fulfillment: "cancelled_reserve", status: "voided", void_reason: reason ?? "ยกเลิกการจอง", synced: false };
    await db().orders.put(next);
    return next;
  }).then(async (next) => {
    await writeAudit({ action: "order", actor_id: employeeId, branch_id: next.branch_id, ref_table: "orders", ref_no: next.order_no, amount: null, after_data: { cancel_reserve: true }, is_offline: false });
    return next;
  });
}

/** ปล่อยจองที่หมดอายุ (เรียกตอนเปิดหน้าขาย) — ออเดอร์จองที่เลยกำหนด → ปล่อย Reserved Order + mark cancelled */
export async function expireReservations(branchId?: string): Promise<number> {
  const now = Date.now();
  const all = await db().orders.toArray();
  const expired = all.filter((o) => (o.fulfillment === "reserved" || o.fulfillment === "partial") && o.reserve_expires_at && new Date(o.reserve_expires_at).getTime() < now && (!branchId || o.branch_id === branchId));
  for (const o of expired) await cancelReservedOrder(o.id, "system", "หมดอายุการจอง").catch(() => undefined);
  return expired.length;
}

/** ออเดอร์จองที่ยังค้างส่งมอบ (reserved/partial) */
export async function listReservedOrders(branchIds?: string[]): Promise<Order[]> {
  const all = await db().orders.toArray();
  return all.filter((o) => (o.fulfillment === "reserved" || o.fulfillment === "partial") && (!branchIds || branchIds.includes(o.branch_id)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function voidOrder(orderId: string, employeeId: string, reason: string): Promise<void> {
  if (isLiveMode()) throw new Error("บิลจริงต้องผ่านการตรวจรายการชำระและกระบวนการยกเลิก/คืนเงินส่วนกลาง ไม่สามารถคืนสต๊อกหรือถือว่าคืนเงินแล้วจากปุ่มนี้");
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
  await enqueue("void_order", nanoid(), { order_client_uuid: order.client_uuid ?? null, order_no: order.order_no, employee_id: employeeId, reason });
}

// ---------------------------------------------------------------------
// ORDERS / REPORTS
// ---------------------------------------------------------------------
/** โหมดจริง: ดึงสถานะบิลจากระบบกลาง (ยกเลิก/คืนเงิน) มาอัปเดตสำเนาในเครื่อง — คืนจำนวนบิลที่เปลี่ยน */
export async function refreshServerOrderStatuses(orders: Order[]): Promise<number> {
  if (!isLiveMode()) return 0;
  const ids = orders.map((o) => o.client_uuid).filter((x): x is string => !!x).slice(0, 300);
  if (!ids.length) return 0;
  try {
    const r = await fetch(`/api/pos/returns?status_of=${ids.join(",")}`, { cache: "no-store" });
    if (!r.ok) return 0;
    const { statuses } = (await r.json()) as { statuses: Record<string, Order["status"]> };
    let n = 0;
    for (const o of orders) {
      const st = o.client_uuid ? statuses[o.client_uuid] : undefined;
      if (st && st !== o.status) { await db().orders.update(o.id, { status: st }); o.status = st; n++; }
    }
    return n;
  } catch { return 0; }
}

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

/** หาบิลเพื่อคืนสินค้า — ลองในเครื่องก่อน, ถ้าไม่เจอหาจาก server (ข้ามเครื่อง) */
export async function findOrderForReturn(orderNo: string): Promise<Order | undefined> {
  const local = await findOrderByNo(orderNo);
  if (local) return local;
  if (!isLiveMode() || (typeof navigator !== "undefined" && !navigator.onLine)) return undefined;
  const sb = supabase();
  if (!sb) return undefined;
  const { data, error } = await sb.rpc("pos_lookup_order", { p_order_no: orderNo.trim() });
  if (error || !data) return undefined;
  const o = data as Record<string, unknown>;
  const items = ((o.items as Record<string, unknown>[]) ?? []).map((it) => ({
    id: String(it.id),
    product_id: (it.product_id as string) ?? null,
    sku: String(it.sku ?? ""),
    name: String(it.name ?? ""),
    kind: (it.kind as OrderItem["kind"]) ?? "goods",
    qty: Number(it.qty ?? 0),
    unit_price: Number(it.unit_price ?? 0),
    discount_amount: 0,
    line_total: Number(it.line_total ?? 0),
    unit_cost: Number(it.unit_cost ?? 0),
    cost_total: 0,
    gross_profit: 0,
    serials: (it.serials as string[]) ?? [],
    returned_qty: Number(it.returned_qty ?? 0),
    is_gift: !!it.is_gift,
    gift_campaign_id: (it.gift_campaign_id as string) ?? null,
  })) as OrderItem[];
  return {
    id: String(o.id),
    order_no: String(o.order_no),
    client_uuid: (o.client_uuid as string) ?? null,
    branch_id: String(o.branch_id),
    status: (o.status as Order["status"]) ?? "completed",
    channel: (o.channel as Order["channel"]) ?? "offline",
    subtotal: Number(o.subtotal ?? 0),
    discount_total: Number(o.discount_total ?? 0),
    vat_amount: 0,
    grand_total: Number(o.grand_total ?? 0),
    paid_total: Number(o.grand_total ?? 0),
    change_amount: 0,
    cost_total: 0,
    gross_profit: 0,
    customer_id: (o.customer_id as string) ?? null,
    customer_name: (o.customer_name as string) ?? null,
    customer_phone: (o.customer_phone as string) ?? null,
    items,
    payments: [],
    is_offline_origin: false,
    created_at: String(o.created_at ?? new Date().toISOString()),
  } as Order;
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
    id: crypto.randomUUID(), // shifts.id บนเซิร์ฟเวอร์เป็น uuid — nanoid ทำให้ sync เปิดกะล้มตลอด
    shift_no: `SH-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
    branch_id: input.branchId,
    terminal_id: input.terminalId,
    opened_by: input.employeeId,
    member_ids: Array.from(new Set([input.employeeId, ...input.memberIds])),
    status: "open",
    opening_cash: isLiveMode() ? 0 : input.openingCash,
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
  // Demo reserves locally; live held bills are drafts, central reservation begins at checkout.
  for (const l of bill.lines) if (!isLiveMode() && l.product_id && l.kind === "goods") await reserveOrderStock(bill.branch_id, l.product_id, l.qty);
}
export async function listHolds(branchId: string): Promise<HeldBill[]> {
  return db().holds.where("branch_id").equals(branchId).reverse().toArray();
}
export async function removeHold(id: string): Promise<void> {
  // คืนจองออเดอร์ตอนเอาบิลพักออก (เรียกคืน/ยกเลิก) — ของกลับไปพร้อมขาย/อยู่ในตะกร้า
  const h = await db().holds.get(id);
  if (h) for (const l of h.lines) if (!isLiveMode() && l.product_id && l.kind === "goods") await reserveOrderStock(h.branch_id, l.product_id, -l.qty);
  await db().holds.delete(id);
}

// ---------------------------------------------------------------------
// RETURNS
// ---------------------------------------------------------------------
export async function createReturn(doc: ReturnDoc, employeeId: string): Promise<void> {
  if (isLiveMode()) throw new Error("รายการจริงต้องผ่านคำขอคืนเงินและตรวจรับสินค้าคืนส่วนกลางก่อน ระบบจะไม่เพิ่มสต๊อกหรือบันทึกคืนเงินสำเร็จอัตโนมัติ");
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

export const getProductBySku = (sku: string) => db().products.where("sku").equals(sku).first();

/** ยอดกระเป๋าแบรนด์ของลูกค้า (แต้ม/เครดิตของแบรนด์นั้น) — live เท่านั้น */
export async function fetchBrandWallet(customerId: string, brandId: string): Promise<{ points: number; store_credit: number; tier: string }> {
  const empty = { points: 0, store_credit: 0, tier: "normal" };
  if (!isLiveMode() || (typeof navigator !== "undefined" && !navigator.onLine)) return empty;
  const sb = supabase();
  if (!sb) return empty;
  const { data, error } = await sb.rpc("pos_brand_wallet", { p_customer_id: customerId, p_brand_id: brandId });
  if (error || !data) return empty;
  const d = data as { points?: number; store_credit?: number; tier?: string };
  return { points: Number(d.points ?? 0), store_credit: Number(d.store_credit ?? 0), tier: d.tier ?? "normal" };
}

export interface GiftCampaign {
  id: string; name: string;
  brand_ids: string[]; eligible_scope: string; eligible_min_qty: number | null;
  eligible_across_sku: boolean; min_spend: number;
  gift_mode: string; gift_per_qty: number; gift_cap: number | null;
  eligible_skus: string[]; gift_skus: { sku: string; gift_qty: number }[];
}

/** แคมเปญของแถมอัตโนมัติที่ใช้ได้กับสาขา/ช่องทางนี้ (live เท่านั้น) */
export async function fetchActiveGiftCampaigns(branchId: string, channel: string, customerId?: string|null): Promise<GiftCampaign[]> {
  if (!isLiveMode() || (typeof navigator !== "undefined" && !navigator.onLine)) return [];
  const params=new URLSearchParams({branch_id:branchId,channel});if(customerId)params.set("customer_id",customerId);
  const response=await fetch("/api/pos/gift-campaigns?"+params,{cache:"no-store"});
  const data=await response.json();
  if(!response.ok||!Array.isArray(data))throw Error(data.error||"อ่านสิทธิ์ของแถมไม่สำเร็จ");
  return data.map((r: unknown) => {
    const c = r as Record<string, unknown>;
    return {
      id: String(c.id), name: String(c.name ?? ""),
      brand_ids: (c.brand_ids as string[]) ?? [],
      eligible_scope: String(c.eligible_scope ?? "all"),
      eligible_min_qty: c.eligible_min_qty == null ? null : Number(c.eligible_min_qty),
      eligible_across_sku: c.eligible_across_sku !== false,
      min_spend: Number(c.min_spend ?? 0),
      gift_mode: String(c.gift_mode ?? "per_bill"),
      gift_per_qty: Number(c.gift_per_qty ?? 1),
      gift_cap: c.gift_cap == null ? null : Number(c.gift_cap),
      eligible_skus: (c.eligible_skus as string[]) ?? [],
      gift_skus: ((c.gift_skus as { sku: string; gift_qty: number }[]) ?? []).map((g) => ({ sku: g.sku, gift_qty: Number(g.gift_qty ?? 1) })),
    };
  });
}

export interface CouponResult {
  valid: boolean;
  reason?: string;
  discount?: number;
  campaign_id?: string;
  name?: string;
}

// ── แคมเปญส่วนลด (เลือกเป็นการ์ดบนหน้า POS — ไม่ต้องพิมพ์โค้ด) ──
export interface PromoCampaign {
  id: string;
  code: string;
  name: string;
  desc?: string | null;
  type: "percent" | "amount";
  value: number;              // % หรือ บาท
  min_spend: number;          // ยอดขั้นต่ำก่อนใช้
  color: string;              // สีเน้น (badge)
  product_sku?: string | null; // SKU สินค้าตัวแทน (โชว์รูปบนการ์ด)
  /** เจาะจงสินค้า: ว่าง = ทั้งบิล/ทุกสินค้า · มี SKU = ใช้เฉพาะเมื่อมีสินค้านั้นในตะกร้า (คิดลดจากสินค้านั้น) */
  target_skus: string[];
  active: boolean;
  until?: string | null;      // หมดเขต (ISO) — null = ไม่จำกัด
  max_discount?: number | null; // เพดานส่วนลด (บาท)
  uses_left?: number | null;    // โควตาที่เหลือ (null = ไม่จำกัด)
  segment?: string | null;      // เฉพาะกลุ่มลูกค้า
}
const DEMO_PROMOS: PromoCampaign[] = [
  // ทั้งบิล (โชว์เสมอ)
  { id: "promo-10pct", code: "SAVE10", name: "ลด 10% ทั้งบิล", desc: "ลดทันที 10% ทุกชิ้น", type: "percent", value: 10, min_spend: 0, color: "#7950D8", product_sku: "70M-A510-1", target_skus: [], active: true, until: null },
  { id: "promo-member5", code: "MEMBER5", name: "สมาชิกลด 5%", desc: "เฉพาะลูกค้าสมาชิก", type: "percent", value: 5, min_spend: 0, color: "#2AA7B8", product_sku: "A2688E41", target_skus: [], active: true, until: null },
  // เจาะจงสินค้า (โชว์เฉพาะเมื่อมีสินค้านั้นในตะกร้า)
  { id: "promo-a510", code: "A510-10", name: "70mai A510 ลด 10%", desc: "เฉพาะ Dash Cam A510", type: "percent", value: 10, min_spend: 0, color: "#E05A29", product_sku: "70M-A510-1", target_skus: ["70M-A510-1"], active: true, until: null },
  { id: "promo-omni", code: "OMNI-1000", name: "70mai Omni ลด 1,000", desc: "เฉพาะ Dash Cam Omni", type: "amount", value: 1000, min_spend: 0, color: "#132436", product_sku: "70M-OMNI-64", target_skus: ["70M-OMNI-64"], active: true, until: null },
  { id: "promo-h12", code: "H12-15", name: "Dreame H12 ลด 15%", desc: "เฉพาะ Dreame H12 Pro", type: "percent", value: 15, min_spend: 0, color: "#EC6B9D", product_sku: "DRM-H12", target_skus: ["DRM-H12"], active: true, until: null },
  { id: "promo-sd", code: "SD-50", name: "เมมโมรี่การ์ด ลด 50", desc: "เฉพาะเมมโมรี่การ์ด Vlnko", type: "amount", value: 50, min_spend: 0, color: "#3BB98C", product_sku: "VLNKO-U3-64", target_skus: ["VLNKO-U3-64", "VLNKO-U3-128"], active: true, until: null },
  { id: "promo-anker", code: "ANKER-20", name: "Anker Charger ลด 20%", desc: "เฉพาะ Anker Prime Charger", type: "percent", value: 20, min_spend: 0, color: "#2AA7B8", product_sku: "A2688E41", target_skus: ["A2688E41"], active: true, until: null },
];
/** แคมเปญส่วนลดที่เลือกได้ (local-first + seed demo) */
export async function listPromoCampaigns(branchId?: string | null, channel?: string | null): Promise<PromoCampaign[]> {
  // live: แคมเปญจริงจากหลังบ้าน (กรองสาขา/ช่องทาง/วันที่/โควตาที่เซิร์ฟเวอร์) — ยอดลดจริงยังคิดที่ /api/pos/checkout
  if (!isDemoMode()) {
    if (!branchId || typeof window === "undefined") return [];
    try {
      const r = await fetch(`/api/pos/campaigns?branch_id=${encodeURIComponent(branchId)}${channel ? `&channel=${encodeURIComponent(channel)}` : ""}`, { cache: "no-store" });
      if (!r.ok) return [];
      return ((await r.json()) as { campaigns?: PromoCampaign[] }).campaigns ?? [];
    } catch { return []; }
  }
  const stored = await kvGet<PromoCampaign[]>("promo_campaigns_v3", []);
  if (stored.length) return stored.filter((p) => p.active);
  await kvSet("promo_campaigns_v3", DEMO_PROMOS);
  return DEMO_PROMOS.filter((p) => p.active);
}
/** คำนวณส่วนลดจากแคมเปญตามยอดบิล */
export function promoDiscount(p: PromoCampaign, subtotal: number): number {
  if (subtotal < p.min_spend) return 0;
  const d = p.type === "percent" ? round2((subtotal * p.value) / 100) : Math.min(p.value, subtotal);
  return p.max_discount != null ? Math.min(d, p.max_discount) : d;
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
  /** YYYY-MM-DD (ไม่บังคับ) — ใช้กับกฎแต้มวันเกิด */
  birth_date?: string | null;
}

/** สร้างลูกค้าใหม่ — เขียนลงเครื่องทันที + ซิงก์ขึ้น server (idempotent ด้วย id) */
export async function createCustomer(input: NewCustomerInput): Promise<Customer> {
  const id = uuidv4();
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
      birth_date: input.birth_date || null,
    });
  }
  return customer;
}
