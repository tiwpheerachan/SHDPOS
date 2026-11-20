// =====================================================================
// ผูกสาขา POS ↔ รหัสคลัง OneWarehouse/JST (warehouse_id)
//   OW /v1/stock, /v1/serials คืน warehouseId เป็นรหัสคลัง JST (string)
//   ต้องแปลงเป็น branch_id ของ POS เพื่อแสดงผล และกลับกันเพื่อ query สต๊อก
//   ⚠️ TODO: เติม mapping จริงเมื่อ OW ยืนยันว่า warehouse_id ไหน = สาขาไหน
//      ตอนนี้ UAT มี 2 คลัง: 33856, 33857 (ดึงสดได้จาก /v1/warehouses เมื่อมี token)
// =====================================================================

/** รหัสคลัง UAT ที่ OW แจ้ง (ใช้ fallback ตอน /v1/warehouses ยังไม่พร้อม) */
export const OW_WAREHOUSE_IDS_UAT = ["33856", "33857"] as const;

/**
 * mapping สาขา POS → รหัสคลัง OW (เติมเมื่อได้ข้อมูลจริง)
 *   key = branch_id (POS) · value = warehouse_id (OW/JST)
 *   เก็บรหัสต้นทางเป็น "ข้อความ" เสมอ (ห้ามแปลงเป็น number)
 */
export const BRANCH_TO_WAREHOUSE: Record<string, string> = {
  // "<pos-branch-uuid>": "33856",
};

/** รหัสคลัง OW → branch_id POS (อนุพันธ์จาก BRANCH_TO_WAREHOUSE) */
export const WAREHOUSE_TO_BRANCH: Record<string, string> = Object.fromEntries(
  Object.entries(BRANCH_TO_WAREHOUSE).map(([b, w]) => [w, b]),
);

/** หา warehouse_id OW จาก branch POS — null ถ้ายังไม่ผูก */
export function warehouseIdForBranch(branchId: string | null | undefined): string | null {
  if (!branchId) return null;
  return BRANCH_TO_WAREHOUSE[branchId] ?? null;
}

/** หา branch POS จาก warehouse_id OW — null ถ้ายังไม่ผูก (คืนรหัสดิบให้ layer โชว์แทนได้) */
export function branchForWarehouseId(warehouseId: string | null | undefined): string | null {
  if (!warehouseId) return null;
  return WAREHOUSE_TO_BRANCH[warehouseId] ?? null;
}

/** ผูก mapping ครบหรือยัง (ไว้เตือนหน้า admin) */
export function isWarehouseMapReady(): boolean {
  return Object.keys(BRANCH_TO_WAREHOUSE).length > 0;
}
