// ลิงก์แชร์เอกสาร — token ลงลายเซ็น HMAC (แก้ค่า/ปลอมไม่ได้) + วันหมดอายุ · ไม่เก็บในฐานข้อมูล
//   secret: DOC_SHARE_SECRET (แนะนำ) หรือ SSO_SESSION_SECRET · ต้องยาว ≥ 32 ตัว
import { createHmac, timingSafeEqual } from "node:crypto";

export type DocKind = "receipt" | "tax_invoice" | "return" | "warranty" | "trace" | "transfer_out" | "transfer_in" | "transfer_diff";
export type DocTokenPayload = { k: DocKind; id: string; e: number };
export const INTERNAL_KINDS: DocKind[] = ["trace", "transfer_out", "transfer_in", "transfer_diff"];
const KINDS: DocKind[] = ["receipt", "tax_invoice", "return", "warranty", "trace", "transfer_out", "transfer_in", "transfer_diff"];

function secret(): string {
  const s = process.env.DOC_SHARE_SECRET || process.env.SSO_SESSION_SECRET || "";
  if (s.length < 32) throw new Error("ยังไม่ได้ตั้งค่า DOC_SHARE_SECRET (≥ 32 ตัวอักษร) สำหรับลิงก์แชร์เอกสาร");
  return s;
}
const b64 = (b: Buffer) => b.toString("base64url");
const sign = (body: string) => b64(createHmac("sha256", secret()).update(`doc:${body}`).digest()).slice(0, 32);

export function signDocToken(k: DocKind, id: string, days = 90): string {
  const body = b64(Buffer.from(JSON.stringify({ k, id, e: Math.floor(Date.now() / 1000) + days * 86400 } satisfies DocTokenPayload)));
  return `${body}.${sign(body)}`;
}

export function verifyDocToken(token: string): DocTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || token.length > 400) return null;
  const want = sign(body);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DocTokenPayload;
    if (!KINDS.includes(p.k) || typeof p.id !== "string" || !Number.isFinite(p.e) || p.e < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
