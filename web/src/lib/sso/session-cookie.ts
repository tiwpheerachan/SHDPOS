// Session cookie สำหรับ SSO — เซ็นด้วย HMAC-SHA256 (ฝั่งเซิร์ฟเวอร์เท่านั้น)
import crypto from "node:crypto";
import type { SsoSessionProfile } from "./types";

export const SSO_COOKIE = "shd_sso";
export const SSO_STATE_COOKIE = "shd_sso_state";
const MAX_AGE = 60 * 60 * 8; // 8 ชั่วโมง (ประมาณ 1 กะ)

function secret() {
  const s = process.env.SSO_SESSION_SECRET;
  if (!s) throw new Error("SSO_SESSION_SECRET not set");
  return s;
}

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

interface Payload extends SsoSessionProfile {
  iat: number;
  exp: number;
}

/** สร้างค่า cookie ที่เซ็นแล้ว */
export function signSession(profile: SsoSessionProfile): { value: string; maxAge: number } {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { ...profile, iat: now, exp: now + MAX_AGE };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return { value: `${body}.${sig}`, maxAge: MAX_AGE };
}

/** ตรวจลายเซ็น + วันหมดอายุ แล้วคืนโปรไฟล์ */
export function readSession(value: string | undefined | null): SsoSessionProfile | null {
  if (!value || !value.includes(".")) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  // เทียบแบบ constant-time กันจับเวลา
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const { iat, exp, ...profile } = payload;
    return profile;
  } catch {
    return null;
  }
}

/** state (กัน CSRF) — เซ็น state + ปลายทางหลังล็อกอิน */
export function signState(state: string, next: string): string {
  const body = b64url(JSON.stringify({ state, next, t: Date.now() }));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readState(value: string | undefined | null): { state: string; next: string } | null {
  if (!value || !value.includes(".")) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.t !== "number" || Date.now() - p.t > 10 * 60 * 1000) return null; // state อายุ 10 นาที
    return { state: p.state, next: p.next };
  } catch {
    return null;
  }
}
