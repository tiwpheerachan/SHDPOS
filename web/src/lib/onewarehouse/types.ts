// =====================================================================
// OneWarehouse adapter — ชนิดข้อมูลตาม "สัญญา" ของ engine (Spec §5–7)
//   UI เรียกผ่าน index.ts; หลังบ้านตอนนี้คือ local-engine (Dexie), สลับเป็น REST ภายหลัง
// =====================================================================

/** สถานะตามสัญญา (ฝั่ง UI ใช้ TransferStatus ของ lib/types; status.ts แปลงให้) */
export type OwStatus =
  | "draft" | "submitted" | "reviewed" | "picklist_created"
  | "shipped" | "sn_moved" | "in_transit" | "received" | "closed"
  | "cancelled" | "rejected" | "partial";
export type SyncState = "pending" | "synced" | "failed";
export type TransferDirection = "in" | "out";

/** GET /products */
export interface ProductView {
  sku: string; name: string; short_name?: string | null; barcode?: string | null;
  category?: string | null; brand?: string | null; image_url?: string | null;
  /** true/false/null(ยังไม่จัดประเภท) */
  serial_tracking: boolean | null;
  availableQty: number;
}
/** GET /stock */
export interface StockView { sku: string; warehouseId: string; qty: number }
/** GET /serials/<sn> */
export interface SerialView { serialNo: string; sku: string; warehouseId: string; status: string; lastMovementId?: string | null }
/** GET /carriers */
export interface Carrier { id: string; name: string; enabled: boolean; platformId?: string | null; codEnabled?: boolean }

/** บรรทัดสินค้าใน TransferView (§6) */
export interface OwTransferLine {
  sku: string; qty: number; name: string; note?: string | null;
  isSerialized: boolean | null;
  shippedSerials: { serialNo: string; at: string }[];
  receivedSerials: { serialNo: string; at: string }[];
}
/** TransferView — หน้าจอสแกน (§6) */
export interface TransferView {
  id: string; orderNo: string;
  fromWarehouseId: string; toWarehouseId: string;
  status: OwStatus; direction: TransferDirection;
  syncState: SyncState;
  jstAllocationNo: string | null;
  version: number;
  remark?: string | null; referenceNo?: string | null; expectedDate?: string | null; priority?: string | null;
  lines: OwTransferLine[];
}
/** แถวในลิสต์ (§5) */
export interface TransferListRow {
  id: string; orderNo: string;
  from: { id: string; name: string }; to: { id: string; name: string };
  status: OwStatus; direction: TransferDirection; syncState: SyncState;
  jstAllocationNo: string | null;
  lineCount: number; snProgress?: { scanned: number; total: number };
  createdAt: string;
}
export interface TransferListResult {
  items: TransferListRow[]; total: number; pageSize: number;
  counts: { all: number; active: number; issue: number; done: number };
}
export interface TimelineEvent { at: string; label: string; by?: string | null; status?: OwStatus; tone?: "ok" | "warn" | "danger" | "brand" | "neutral" }
export interface DashboardKpis { toReceive: number; toShip: number; inTransit: number; issues: number; done: number }

/** error ตามสัญญา (§9) */
export interface OwError { code: string; params?: Record<string, unknown>; message: string; statusCode?: number }
export interface ScanProblem { code: string; params?: Record<string, unknown>; message: string }
export interface ScanResult { ok: boolean; problems: ScanProblem[]; view?: TransferView }

export type ListFilter = "all" | "active" | "issue" | "done";
/** พารามิเตอร์ที่ทุก action ต้องส่ง (§7–8) */
export interface OpMeta { opKey: string; expectedVersion?: number }
