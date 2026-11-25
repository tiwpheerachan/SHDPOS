// POST /api/internal/ow-events — ปลายทาง Pub/Sub push ของ OneWarehouse (ใบโอน/คลัง)
//   ยืนยันตัวด้วย OW_EVENTS_SECRET (≥32 ตัว): header "Authorization: Bearer <secret>" หรือ ?token=<secret> (Pub/Sub push ใส่ใน URL)
//   ตอบ 200 เสมอเมื่อรับได้ (รวมซ้ำ/ไม่เกี่ยว) เพื่อไม่ให้ Pub/Sub ส่งซ้ำวน · ข้อมูลผิดรูป = 400 · ไม่มีสิทธิ์ = 401
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseOwEvent, handleOwEvent } from "@/lib/server/ow-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const key = process.env.OW_EVENTS_SECRET ?? "";
  if (key.length < 32) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("token") ?? "";
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
