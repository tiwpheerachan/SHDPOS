// =====================================================================
// พิกัดสาขา + ระยะทาง — ใช้แนะนำสาขาที่ "ใกล้ที่สุดและมีของ" ตอนเปิดคำขอโอน
//   ค่า seed เป็นพิกัดโดยประมาณ (กรุงเทพฯ/ปริมณฑล) แทนที่ได้ด้วย branch.lat/lng จาก Supabase
//   หรือแก้ตารางนี้เมื่อได้พิกัดจริง (เจ้าของจะส่งพิกัดให้ภายหลัง)
// =====================================================================
import type { Branch } from "@/lib/types";

export interface LatLng { lat: number; lng: number }

/** พิกัดเดโม่ต่อสาขา (คีย์ = branch.code) */
export const BRANCH_COORDS: Record<string, LatLng> = {
  "70MAI-KANJANA": { lat: 13.712, lng: 100.401 },
  "70MAI-CHONBURI": { lat: 13.361, lng: 100.984 },
  "70MAI-THAPHRA": { lat: 13.715, lng: 100.476 },
  "70MAI-RANGSIT": { lat: 13.958, lng: 100.617 },
  "70MAI-RATCHA": { lat: 13.866, lng: 100.457 },
  "70MAI-RAMINTRA": { lat: 13.873, lng: 100.672 },
  "ANKER-KHONKAEN": { lat: 16.439, lng: 102.829 },
  "ANKER-CTPARK": { lat: 13.733, lng: 100.540 },
  "ANKER-PINKLAO": { lat: 13.777, lng: 100.476 },
  "ANKER-RAMA9": { lat: 13.758, lng: 100.565 },
  "ANKER-CTW": { lat: 13.747, lng: 100.539 },
  "ANKER-NGAMWONG": { lat: 13.864, lng: 100.527 },
  "ANKER-BANGKAPI": { lat: 13.766, lng: 100.643 },
  "ANKER-NORTHVILLE": { lat: 13.862, lng: 100.668 },
  "ANKER-FASHION": { lat: 13.868, lng: 100.675 },
  "ANKER-VD-SIAM": { lat: 13.746, lng: 100.534 },
  "ANKER-VD-BANGNA": { lat: 13.646, lng: 100.682 },
  "DDPAI-PINKLAO": { lat: 13.780, lng: 100.471 },
  "DREAME-SEACON": { lat: 13.690, lng: 100.646 },
  "DREAME-BANGNA": { lat: 13.668, lng: 100.605 },
  "DREAME-PINKLAO": { lat: 13.777, lng: 100.477 },
  "DREAME-RAMA2": { lat: 13.666, lng: 100.436 },
  "DREAME-WESTGATE": { lat: 13.875, lng: 100.414 },
  "DREAME-NGAMWONG": { lat: 13.864, lng: 100.528 },
  "DREAME-NORTHVILLE": { lat: 13.861, lng: 100.668 },
  "DREAME-MEGA": { lat: 13.646, lng: 100.682 },
  "DREAME-EASTVILLE": { lat: 13.802, lng: 100.629 },
  "DREAME-HAPPITAT": { lat: 13.805, lng: 100.558 },
  "HQ-WAREHOUSE": { lat: 13.745, lng: 100.552 },
};

/** พิกัดของสาขา: ใช้ค่าจาก DB (lat/lng) ก่อน ถ้าไม่มีค่อยดูตาราง seed ตาม code */
export function coordOf(b?: Branch | null): LatLng | null {
  if (!b) return null;
  if (typeof b.lat === "number" && typeof b.lng === "number") return { lat: b.lat, lng: b.lng };
  return BRANCH_COORDS[b.code] ?? null;
}

/** ระยะทางเส้นตรง (กม.) สูตร Haversine */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** ระยะระหว่าง 2 สาขา (กม.) — null เมื่อไม่มีพิกัดฝั่งใดฝั่งหนึ่ง */
export function branchDistanceKm(a?: Branch | null, b?: Branch | null): number | null {
  const ca = coordOf(a), cb = coordOf(b);
  if (!ca || !cb) return null;
  return haversineKm(ca, cb);
}

/** รูปแบบระยะทางอ่านง่าย */
export function fmtKm(km: number | null): string {
  if (km == null) return "—";
  if (km < 1) return `${Math.round(km * 1000)} ม.`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} กม.`;
}
