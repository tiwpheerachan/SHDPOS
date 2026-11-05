// =====================================================================
// Avatar — สร้างรูปการ์ตูน (dicebear micah) ในเครื่อง 100%
//   ไม่เรียก external service → ไม่ส่งชื่อ/ข้อมูลลูกค้าออกนอกระบบ (PDPA-safe)
//   ทำงานออฟไลน์ได้ (POS)
// =====================================================================
import { createAvatar } from "@dicebear/core";
import { micah } from "@dicebear/collection";

const cache = new Map<string, string>();

/** คืน data URI ของ avatar การ์ตูนจาก seed (เช่น ชื่อ) — memoized */
export function micahDataUri(seed: string): string {
  const key = (seed || "?").trim();
  const hit = cache.get(key);
  if (hit) return hit;
  const svg = createAvatar(micah, {
    seed: key,
    backgroundColor: ["e9deff", "bceedb", "bdecf0", "c0aede", "b6e3f4"],
    radius: 50,
  }).toString();
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (cache.size > 500) cache.clear();
  cache.set(key, uri);
  return uri;
}
