// เรียกบริการระบบสิทธิ์กลาง — ฝั่งเซิร์ฟเวอร์เท่านั้น (ถือ secret/API key)
// ⚠️ ห้าม import ไฟล์นี้จาก client component — key จะหลุดไปเบราว์เซอร์
import type { CentralEffective, CentralPerson } from "./types";

function base() {
  return process.env.CENTRAL_SSO_BASE || "https://sso.shd-technology.co.th";
}
function apiKey() {
  const k = process.env.CENTRAL_API_KEY;
  if (!k) throw new Error("CENTRAL_API_KEY not set");
  return k;
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" };
}

export function clientId() {
  return process.env.SSO_CLIENT_ID || "";
}

/** สร้าง URL ส่งผู้ใช้ไปล็อกอินที่ระบบกลาง */
export function authorizeUrl(redirectUri: string, state: string) {
  const u = new URL(`${base()}/api/v1/sso/authorize`);
  u.searchParams.set("client_id", clientId());
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

export interface VerifyResult {
  email?: string;
  union_id?: string;
  name?: string;
  avatar_url?: string;
  raw: unknown;
}

/** แลก code ที่ได้จาก callback เป็นตัวตน (back-channel ใช้ client_secret) */
export async function verifyCode(code: string, redirectUri: string): Promise<VerifyResult> {
  const secret = process.env.SSO_CLIENT_SECRET;
  if (!secret) throw new Error("SSO_CLIENT_SECRET not set");
  const r = await fetch(`${base()}/api/v1/sso/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId(), client_secret: secret, code, redirect_uri: redirectUri }),
    cache: "no-store",
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error || `verify failed (${r.status})`);
  }
  // รองรับหลายรูปแบบคำตอบ: {user:{...}} / {person:{...}} / ฟิลด์ระดับบนสุด
  const id = data?.user ?? data?.person ?? data ?? {};
  return {
    email: id.email,
    union_id: id.union_id ?? id.unionId,
    name: id.name,
    avatar_url: id.avatar_url ?? id.avatarUrl,
    raw: data,
  };
}

/** โปรไฟล์รายคน (ด้วย email หรือ union_id) */
export async function getDirectoryUser(opts: { email?: string; union_id?: string }): Promise<CentralPerson | null> {
  const u = new URL(`${base()}/api/v1/directory/user`);
  if (opts.email) u.searchParams.set("email", opts.email);
  else if (opts.union_id) u.searchParams.set("union_id", opts.union_id);
  else return null;
  const r = await fetch(u, { headers: authHeaders(), cache: "no-store" });
  if (!r.ok) return null;
  const data: any = await r.json().catch(() => ({}));
  return (data?.person as CentralPerson) ?? null;
}

/** ดึงสิทธิ์ทั้งหมดของผู้ใช้ */
export async function getEffective(user: string, body?: Record<string, unknown>): Promise<CentralEffective | null> {
  const r = await fetch(`${base()}/api/v1/authz/effective`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ user, ...(body ?? {}) }),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as CentralEffective | null;
}

/** เช็คสิทธิ์รายการเดียว */
export async function authzCheck(user: string, action: string, resource: string): Promise<{ allow: boolean; level?: string }> {
  const r = await fetch(`${base()}/api/v1/authz/check`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ user, action, resource }),
    cache: "no-store",
  });
  if (!r.ok) return { allow: false };
  const data: any = await r.json().catch(() => ({}));
  return { allow: !!data?.allow, level: data?.level };
}

/** ค้นหาพนักงาน (ต้องมี scope directory:read:people) */
export async function searchDirectory(q: string, limit = 20): Promise<CentralPerson[]> {
  if (!q || q.length < 2) return [];
  const u = new URL(`${base()}/api/v1/directory/search`);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(limit));
  const r = await fetch(u, { headers: authHeaders(), cache: "no-store" });
  if (!r.ok) return [];
  const data: any = await r.json().catch(() => ({}));
  return (data?.items as CentralPerson[]) ?? [];
}
