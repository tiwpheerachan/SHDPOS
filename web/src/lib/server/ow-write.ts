// =====================================================================
// OneWarehouse /v1 — ตัวเรียกฝั่งเขียน (server only, แนบ 2 headers, ไม่ส่ง token ไป browser)
//   กติกาจาก UAT handoff:
//   • ทุกคำสั่งเขียนต้องมี opKey — ลองใหม่ด้วย key เดิมปลอดภัย (replay ไม่ซ้ำ)
//   • ส่ง expectedVersion จากการอ่านล่าสุด — 409 *_version_conflict = มีคนแก้ก่อน ให้โหลดใหม่
//   • 401 token/sub ผิด · 403 ไม่มีสิทธิ์ · 503 ระบบสิทธิ์ล่ม (fail closed) · ธุรกิจ = {code,message,params}
// =====================================================================
import { createHash } from "node:crypto";
import { owConfig } from "./ow-gateway";

export interface OwApiError { code: string; message: string; params?: Record<string, unknown>; statusCode?: number }
export interface OwResult<T> { ok: boolean; status: number; data?: T; error?: OwApiError }

/** opKey คงที่ต่อ "การกระทำเดียว" — สร้างจากส่วนประกอบ (ลองใหม่ได้ key เดิมเสมอ) */
export function opKey(...parts: (string | number | null | undefined)[]): string {
  const raw = parts.map((p) => String(p ?? "")).join("|");
  return "pos-" + createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export async function owCall<T = unknown>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, timeoutMs = 30_000): Promise<OwResult<T>> {
  const c = owConfig();
  let res: Response;
  try {
    res = await fetch(`${c.base}/v1/${path.replace(/^\/+/, "")}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        "X-Service-Token": c.token,
        "X-On-Behalf-Of-Sub": c.sub,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: 0, error: { code: "network", message: "เชื่อมคลังกลางไม่สำเร็จ" } };
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  const j = (json ?? {}) as Partial<OwApiError> & { error?: string };
  return {
    ok: false,
    status: res.status,
    error: {
      code: j.code ?? (res.status === 401 ? "unauthorized" : res.status === 403 ? "forbidden" : res.status === 503 ? "unavailable" : `http_${res.status}`),
      message: j.message ?? j.error ?? `OneWarehouse ตอบ HTTP ${res.status}`,
      params: j.params,
      statusCode: res.status,
    },
  };
}

/** ควรลองใหม่ภายหลังไหม (เครือข่าย/ระบบล่ม/ชนเวอร์ชันชั่วคราว) — 4xx ธุรกิจอื่นไม่ลองซ้ำ */
export function isRetryable(r: OwResult<unknown>): boolean {
  if (r.ok) return false;
  if (r.status === 0 || r.status >= 500 || r.status === 429) return true;
  return ["sale_concurrency", "transfer_concurrency", "unavailable"].includes(r.error?.code ?? "");
}

/** เวลาไทยแบบ ISO-8601 มี offset (+07:00) ตามที่ OW ต้องการ */
export function bkkIso(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return d.toISOString().replace(/\.\d{3}Z$/, "+07:00");
}
