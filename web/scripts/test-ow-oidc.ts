// ตรวจ OIDC token ของ Pub/Sub push (google-oidc.ts) ด้วยกุญแจทดสอบ — ไม่ต่ออินเทอร์เน็ต
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyGoogleOidc, __setJwksFetcher } from "../src/lib/server/google-oidc";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256", use: "sig" };
let fetches = 0;
__setJwksFetcher(async () => { fetches++; return { keys: [jwk as never], ttlMs: 3600_000 }; });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const AUD = "https://pos.example.test/api/internal/ow-events", SA = "ow-push@ow-uat.iam.gserviceaccount.com";
function jwt(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof privateKey; alg?: string } = {}) {
  const h = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const p = b64({ iss: "https://accounts.google.com", aud: AUD, email: SA, email_verified: true, sub: "1", iat: now, exp: now + 3600, ...claims });
  const s = createSign("RSA-SHA256"); s.update(`${h}.${p}`);
  return `${h}.${p}.${s.sign(opts.key ?? privateKey).toString("base64url")}`;
}
let n = 0;
async function expect(token: string, ok: boolean, reason?: string) {
  const r = await verifyGoogleOidc(token, { audience: AUD, email: SA });
  if (r.ok !== ok || (!r.ok && reason && r.reason !== reason)) throw Error(`expected ${ok ? "ok" : reason} got ${JSON.stringify(r)}`);
  n++;
}
(async () => {
  await expect(jwt({}), true);
  await expect(jwt({ aud: "https://evil.test" }), false, "aud");
  await expect(jwt({ exp: now - 600 }), false, "expired");
  await expect(jwt({ iss: "https://evil.test" }), false, "iss");
  await expect(jwt({ email: "someone@else.test" }), false, "email");
  await expect(jwt({ email_verified: false }), false, "email");
  await expect(jwt({}, { key: other.privateKey }), false, "signature");
  await expect(jwt({}, { kid: "nope" }), false, "unknown_kid");
  await expect(jwt({}, { alg: "none" }), false, "alg");
  await expect("abc.def", false, "malformed");
  // payload ถูกแก้หลังเซ็น (เปลี่ยน aud ให้ตรง) → ลายเซ็นไม่ผ่าน
  const t = jwt({ aud: "x" }).split("."); t[1] = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: AUD, email: SA, email_verified: true, sub: "1", iat: now, exp: now + 3600 })).toString("base64url");
  await expect(t.join("."), false, "signature");
  if (fetches > 2) throw Error(`JWKS fetched ${fetches} times — cache not working`);
  console.log(`PASS: ${n} Pub/Sub OIDC checks (valid, aud, exp, iss, email, verified, forged sig, unknown kid, alg none, malformed, tampered payload; JWKS cached)`);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
