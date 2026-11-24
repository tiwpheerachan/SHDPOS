// =====================================================================
// แปลงรหัสเก่าจากเครื่อง (nanoid 21 ตัว) เป็น UUID แบบคงที่ — สำหรับตารางที่คอลัมน์ id เป็น uuid
//   เครื่องรุ่นเก่าเปิดกะด้วย nanoid → sync_open_shift ล้มทุกครั้ง (คิวค้าง → บล็อกการดึงสต๊อกสาขา)
//   รหัสเดิม → UUID เดิมเสมอ (sha256) เปิดกะ/ปิดกะ/checkout จึงชี้กะเดียวกัน โดยไม่ต้องล้างข้อมูลในเครื่อง
// =====================================================================
import { createHash } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** UUID อยู่แล้ว → คืนเดิม · nanoid เก่า → UUID คงที่ (รูปแบบ v8 ตาม RFC 9562) · อย่างอื่น → คืนเดิม (ให้ตัวตรวจปลายทางปฏิเสธ) */
export function legacyUuid(scope: string, id: unknown): unknown {
  if (typeof id !== "string" || UUID_RE.test(id) || !LEGACY_RE.test(id)) return id;
  const h = createHash("sha256").update(`${scope}:${id}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
