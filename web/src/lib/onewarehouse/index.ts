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
  createReverseTransfer as owReverse,
  scanOutTransfer as owScanOut,
  dispatchTransfer as owDispatch,
  receiveTransfer as owReceive,
  closeTransferShort as owCloseShort,
  recordDiscrepancy as owRecordDisc,
  requestResolveDiscrepancy as owRequestResolveDisc,
  resolveDiscrepancy as owResolveDisc,
  openReturn as owOpenReturn,
  requestReturnApproval as owRequestReturnApproval,
  approveReturn as owApproveReturn,
  cancelReturn as owCancelReturn,
  packReturn as owPackReturn,
  dispatchReturn as owDispatchReturn,
  setReturnShipStage as owSetReturnShipStage,
  receiveReturnLines as owReceiveReturnLines,
  closeReturn as owCloseReturn,
  markDiscReplacement as owMarkReplacement,
  advanceShipStage as owShipStage,
  setPickupStage as owSetPickupStage,
  reserveStock as owReserve,
  setTransferAttachments as owSetAttachments,
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
  // ดึงรายชื่อขนส่งจริงจาก OW (/v1/carriers ผ่าน proxy) — client เท่านั้น · ไม่ได้/ยังไม่เชื่อม = ใช้ mock
  if (typeof window !== "undefined") {
    try {
      const r = await fetch("/api/ow/carriers", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { id: string; name: string; enabled: boolean }[];
        if (Array.isArray(j) && j.length) {
          const live = j.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name, enabled: true }));
          // คงตัวเลือก "รับเอง/รถบริษัท" ไว้ (ไม่มีในรายการ OW)
          return [{ id: "self", name: "รถบริษัท/รับเอง", enabled: true }, ...live];
        }
      }
    } catch { /* fallback mock */ }
  }
  return MOCK_CARRIERS.filter((c) => c.enabled);
}
