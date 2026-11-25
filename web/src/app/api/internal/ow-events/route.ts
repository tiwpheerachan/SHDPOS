// POST /api/internal/ow-events — ปลายทาง Pub/Sub push ของ OneWarehouse (ใบโอน/คลัง)
//   ยืนยันตัว (ตามที่ทีม OW ขอ — ไม่ใส่ token ใน URL เพราะจะไปอยู่ใน log):
//     • หลัก: OIDC token ของ Pub/Sub push → Authorization: Bearer <JWT ของ Google>
//       ตั้ง OW_EVENTS_AUDIENCE (= audience ที่ตั้งใน subscription) และ OW_EVENTS_SA_EMAIL (service account ที่ push)
//     • สำรอง (ทดสอบเอง/ยังไม่ตั้ง OIDC): Authorization: Bearer <OW_EVENTS_SECRET ≥32 ตัว> — ปิดอัตโนมัติเมื่อตั้ง OW_EVENTS_AUDIENCE
//     • ?token= ใน URL ไม่รับแล้ว
//   ตอบ 200 เสมอเมื่อรับได้ (รวมซ้ำ/ไม่เกี่ยว) เพื่อไม่ให้ Pub/Sub ส่งซ้ำวน · ข้อมูลผิดรูป = 400 · ไม่มีสิทธิ์ = 401
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseOwEvent, handleOwEvent } from "@/lib/server/ow-events";
import { verifyGoogleOidc } from "@/lib/server/google-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorized(req: NextRequest): Promise<{ ok: boolean; reason?: string }> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!bearer) return { ok: false, reason: req.nextUrl.searchParams.has("token") ? "query_token_not_accepted" : "missing" };
  const audience = process.env.OW_EVENTS_AUDIENCE ?? "";
  if (audience) {
    const r = await verifyGoogleOidc(bearer, { audience, email: process.env.OW_EVENTS_SA_EMAIL || null });
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }
  const key = process.env.OW_EVENTS_SECRET ?? "";
  if (key.length < 32) return { ok: false, reason: "not_configured" };
  const a = Buffer.from(bearer), b = Buffer.from(key);
  return { ok: a.length === b.length && timingSafeEqual(a, b), reason: "secret" };
}

export async function POST(req: NextRequest) {
  const auth = await authorized(req).catch(() => ({ ok: false, reason: "jwks_unavailable" }));
  // ไม่ log ตัว token — บอกแค่เหตุผล
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: auth.reason === "jwks_unavailable" ? 503 : 401 });
  const e = parseOwEvent(await req.json().catch(() => null));
  if (!e) return NextResponse.json({ error: "bad_event" }, { status: 400 });
  try {
    const r = await handleOwEvent(e);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    // บันทึกไม่ได้ (DB ล่ม) → 503 ให้ Pub/Sub ส่งใหม่ภายหลัง
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 503 });
  }
}
