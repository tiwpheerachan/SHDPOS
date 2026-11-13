// =====================================================================
// OneWarehouse adapter — จุดเดียวที่ UI เรียก (ตอนนี้หลังบ้าน = local engine/Dexie)
//   สลับเป็น REST จริงได้ภายหลังโดยไม่กระทบ UI (เช็ค isOneWarehouseLive())
// =====================================================================
export {
  listTransfersForBranch as owList,
  listAllTransfers as owListAll,
  getTransfer as owGet,
  listTransferTimeline as owTimeline,
  createTransfer as owCreate,
  approveTransfer as owApprove,
  rejectTransfer as owReject,
  scanOutTransfer as owScanOut,
  dispatchTransfer as owDispatch,
  receiveTransfer as owReceive,
  reserveStock as owReserve,
} from "@/lib/data/repo";

export * from "./reconcile";
export * from "./status";
export { owErrorMessage } from "./errors";
export type { Carrier } from "./types";

/** มี REST จริงให้ต่อหรือยัง (base + auth pinned) — ตอนนี้ false ใช้ local engine */
export function isOneWarehouseLive(): boolean {
  return typeof process !== "undefined" && !!process.env.NEXT_PUBLIC_ONEWAREHOUSE_BASE;
}

/** รายชื่อขนส่ง (GET /carriers) — ตอนนี้ mock จนกว่า API จริงจะพร้อม */
const MOCK_CARRIERS = [
  { id: "self", name: "รถบริษัท/รับเอง", enabled: true },
  { id: "kerry", name: "Kerry Express", enabled: true },
  { id: "flash", name: "Flash Express", enabled: true },
  { id: "jt", name: "J&T Express", enabled: true },
  { id: "thaipost", name: "ไปรษณีย์ไทย", enabled: true },
];
export async function owCarriers(): Promise<{ id: string; name: string; enabled: boolean }[]> {
  return MOCK_CARRIERS.filter((c) => c.enabled);
}
