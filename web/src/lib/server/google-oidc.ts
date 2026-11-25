// ตรวจ OIDC token ของ Google Pub/Sub push (Authorization: Bearer <JWT>) — ไม่ต้องลง library
//   ลายเซ็น RS256 กับกุญแจสาธารณะของ Google (JWKS · แคชตาม Cache-Control) · iss = accounts.google.com
//   aud ต้องตรง OW_EVENTS_AUDIENCE · email (service account ที่ push) ต้องตรง OW_EVENTS_SA_EMAIL ถ้าตั้งไว้ · email_verified · exp/iat (คลาดได้ 60 วิ)
import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
type Jwk = JsonWebKey & { kid: string; alg?: string };
let cache: { at: number; ttl: number; keys: Jwk[] } | null = null;

export type OidcClaims = { iss: string; aud: string; email?: string; email_verified?: boolean; exp: number; iat: number; sub: string };
export type OidcResult = { ok: true; claims: OidcClaims } | { ok: false; reason: string };

/** ดึง JWKS (สลับได้ตอนทดสอบ) */
export let fetchJwks = async (): Promise<{ keys: Jwk[]; ttlMs: number }> => {
  const r = await fetch(JWKS_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  return { keys: ((await r.json()) as { keys: Jwk[] }).keys, ttlMs: Math.min(maxAge, 6 * 3600) * 1000 };
};
export function __setJwksFetcher(f: typeof fetchJwks) { fetchJwks = f; cache = null; }

async function keyFor(kid: string): Promise<Jwk | null> {
  const now = Date.now();
  if (!cache || now - cache.at > cache.ttl || !cache.keys.some((k) => k.kid === kid)) {
    // kid ใหม่ = Google หมุนกุญแจ → โหลดใหม่ (กันยิงถี่: อย่างน้อย 30 วิ ต่อครั้งเมื่อแคชยังไม่หมดอายุ)
    if (cache && now - cache.at < 30_000 && now - cache.at <= cache.ttl) return cache.keys.find((k) => k.kid === kid) ?? null;
    const j = await fetchJwks();
    cache = { at: now, ttl: j.ttlMs, keys: j.keys };
  }
  return cache.keys.find((k) => k.kid === kid) ?? null;
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export async function verifyGoogleOidc(token: string, opts: { audience: string; email?: string | null; nowSec?: number }): Promise<OidcResult> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 4096) return { ok: false, reason: "malformed" };
  let header: { alg?: string; kid?: string }, claims: OidcClaims;
  try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { return { ok: false, reason: "malformed" }; }
  if (header.alg !== "RS256" || !header.kid) return { ok: false, reason: "alg" };
  const jwk = await keyFor(header.kid);
  if (!jwk) return { ok: false, reason: "unknown_kid" };
  const v = createVerify("RSA-SHA256");
  v.update(`${parts[0]}.${parts[1]}`);
  if (!v.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"))) return { ok: false, reason: "signature" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) return { ok: false, reason: "iss" };
  if (claims.aud !== opts.audience) return { ok: false, reason: "aud" };
  if (typeof claims.exp !== "number" || claims.exp < now - 60) return { ok: false, reason: "expired" };
  if (typeof claims.iat === "number" && claims.iat > now + 60) return { ok: false, reason: "iat" };
  if (opts.email) {
    if (claims.email_verified !== true || (claims.email ?? "").toLowerCase() !== opts.email.toLowerCase()) return { ok: false, reason: "email" };
  }
  return { ok: true, claims };
}
