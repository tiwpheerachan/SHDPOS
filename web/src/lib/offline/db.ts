// =====================================================================
// ฐานข้อมูลในเครื่อง (IndexedDB ผ่าน Dexie)
// POS อ่าน/เขียนที่นี่เสมอ — ทำให้ขายได้แม้เน็ตหลุด
// การซิงก์ขึ้น Supabase เป็นงานเบื้องหลัง (ดู sync.ts)
// =====================================================================

import Dexie, { type Table } from "dexie";
import type {
  Brand, Branch, Terminal, Employee, Product, Category, StockLevel,
  Order, Shift, AuditEntry, Customer, ReturnDoc, Quotation, CartLine, ApprovalRequest, Transfer,
  StockCountSession,
} from "../types";

export interface PendingOp {
  id?: number;
  /** ชนิดงานที่ต้องส่งขึ้น server */
  op: "create_order" | "void_order" | "create_return" | "open_shift" | "close_shift"
    | "cash_movement" | "audit" | "stock_count" | "create_quotation" | "create_customer" | "redeem_points" | "redeem_coupon";
  /** uuid ที่ client สร้าง — ใช้กันบิลซ้ำฝั่ง server */
  client_uuid: string;
  payload: unknown;
  created_at: string;
  attempts: number;
  last_error?: string | null;
  status: "pending" | "syncing" | "failed" | "done";
}

export interface HeldBill {
  id: string;
  branch_id: string;
  label: string;
  lines: CartLine[];
  customer_name?: string;
  created_at: string;
}

export interface KVRow {
  key: string;
  value: unknown;
  updated_at: string;
}

class ShdPosDb extends Dexie {
  brands!: Table<Brand, string>;
  branches!: Table<Branch, string>;
  terminals!: Table<Terminal, string>;
  employees!: Table<Employee, string>;
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  stock!: Table<StockLevel & { key: string }, string>;
  customers!: Table<Customer, string>;
  orders!: Table<Order, string>;
  returns!: Table<ReturnDoc, string>;
  quotations!: Table<Quotation, string>;
  transfers!: Table<Transfer, string>;
  shifts!: Table<Shift, string>;
  approvals!: Table<ApprovalRequest, string>;
  audit!: Table<AuditEntry, string>;
  pending!: Table<PendingOp, number>;
  holds!: Table<HeldBill, string>;
  stock_counts!: Table<StockCountSession, string>;
  kv!: Table<KVRow, string>;

  constructor() {
    super("shd_pos");
    this.version(1).stores({
      brands: "id, code",
      branches: "id, code, brand_id",
      terminals: "id, branch_id",
      employees: "id, employee_code, home_branch_id, role",
      products: "id, sku, brand_id, category_id",
      categories: "id, code",
      stock: "key, branch_id, product_id",
      customers: "id, phone, member_code",
      orders: "id, order_no, branch_id, created_at, status, client_uuid",
      returns: "id, return_no, branch_id, created_at",
      quotations: "id, quotation_no, branch_id, created_at",
      transfers: "id, transfer_no, from_branch_id, to_branch_id, status, created_at",
      shifts: "id, branch_id, status, opened_at",
      approvals: "id, branch_id, status, created_at",
      audit: "id, branch_id, occurred_at, action",
      pending: "++id, status, created_at, client_uuid",
      holds: "id, branch_id, created_at",
      kv: "key",
    });
    this.version(2).stores({
      stock_counts: "id, count_no, branch_id, status, created_at",
    });
  }
}

let _db: ShdPosDb | null = null;

/** คืน instance ของ Dexie — เรียกได้เฉพาะฝั่ง browser */
export function db(): ShdPosDb {
  if (typeof window === "undefined") {
    throw new Error("local db is browser-only");
  }
  if (!_db) _db = new ShdPosDb();
  return _db;
}

export const stockKey = (branchId: string, productId: string) => `${branchId}:${productId}`;

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await db().kv.get(key);
    return row ? (row.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await db().kv.put({ key, value, updated_at: new Date().toISOString() });
  } catch {
    /* quota / private mode — ไม่ให้ล้มทั้งแอป */
  }
}
