// =====================================================================
// uuid — สร้าง UUID v4 ที่ถูกต้อง (ฐานข้อมูลคอลัมน์ client_uuid เป็นชนิด uuid)
//   ห้ามใช้ nanoid กับ client_uuid เพราะ cast ::uuid ฝั่ง server จะล้มเหลว
// =====================================================================
export function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback (ไม่ secure context): ประกอบ v4 จาก getRandomValues หรือ Math.random
  const buf = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant
  const h = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
