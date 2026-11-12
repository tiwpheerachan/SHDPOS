// แชร์แดชบอร์ดผ่านลิงก์ — เข้ารหัส "สเปก widget เท่านั้น" (ไม่มีข้อมูล/ตัวเลข/PII)
//   ผู้เปิดลิงก์เข้าสู่ระบบแล้ว client คำนวณตัวเลขเองตามสิทธิ์ของผู้เปิด
//   ใช้ร่วมกันระหว่างหน้า /admin/insights (ปุ่มแชร์) และหน้า /dashboard (ดูเดี่ยว)
import type { View, Widget } from "@/lib/ai/engine";

const uid = () => Math.random().toString(36).slice(2, 9);

// base64url (รองรับ UTF-8/ไทย) — ไม่มี +, /, =
export const b64e = (s: string) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64d = (s: string) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

type Payload = { n: string; w: Omit<Widget, "id">[] };

/** เข้ารหัสสเปกแดชบอร์ด → payload สำหรับใส่ท้าย URL (`#d=<payload>`) */
export function encodeDashboard(name: string, widgets: Widget[]): string {
  const payload: Payload = { n: name, w: widgets.map(({ id, ...rest }) => { void id; return rest; }) };
  return b64e(JSON.stringify(payload));
}

/** ลิงก์หน้าแดชบอร์ดเดี่ยว (เหมือนเว็บหนึ่งหน้า) — ใช้ตอนกดปุ่มแชร์ */
export function dashboardShareUrl(name: string, widgets: Widget[], origin?: string): string {
  const o = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${o}/dashboard#d=${encodeDashboard(name, widgets)}`;
}

/** ถอดรหัสจาก hash (`#d=...` หรือ `?d=...`) → View พร้อม id ใหม่ (null ถ้าไม่พบ/พัง) */
export function dashboardFromHash(hash: string): View | null {
  try {
    const m = hash.match(/d=([^&]+)/);
    if (!m) return null;
    const j = JSON.parse(b64d(m[1])) as Payload;
    if (!j || !Array.isArray(j.w)) return null;
    return {
      id: uid(),
      name: j.n || "Shared dashboard",
      prompt: "",
      widgets: j.w.map((w) => ({ ...w, id: uid() })),
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
