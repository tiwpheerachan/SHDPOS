// =====================================================================
// Dev-only login — เซ็ต shd_sso cookie จาก session demo (localStorage)
//   • ใช้ได้เฉพาะ NODE_ENV!=="production" และ host เป็น localhost เท่านั้น
//   • จุดประสงค์: ให้หน้า /api/admin/* (แคมเปญ/คูปอง/ลูกค้า ฯลฯ) ทำงานได้
//     ตอนพัฒนาในเครื่อง โดยไม่ต้องวิ่งผ่าน SSO จริง
//   • production ปิดสนิท (คืน 404 เหมือนไม่มี route)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, signSession } from "@/lib/sso/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLocalDev(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_DEMO_MODE !== "1") return false;
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

function defaultEmail(): string {
  const list = (process.env.NEXT_PUBLIC_SUPERADMIN_EMAILS || "tiw.pheerachan@shd-technology.co.th").split(",");
  return (list[0] || "tiw.pheerachan@shd-technology.co.th").trim();
}

async function handle(req: NextRequest) {
  // นอก dev/localhost → ทำเหมือนไม่มี route นี้
  if (!isLocalDev(req)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const email = (req.nextUrl.searchParams.get("email") || defaultEmail()).trim();
  const name = req.nextUrl.searchParams.get("name") || "Dev Login";
  const requestedNext = req.nextUrl.searchParams.get("next") || "/admin/campaigns";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/pos";

  let value: string, maxAge: number;
  try {
    ({ value, maxAge } = signSession({ email, union_id: "dev-login", name }));
  } catch {
    return NextResponse.json({ error: "SSO_SESSION_SECRET not set — ตั้งค่าใน .env.local ก่อน" }, { status: 500 });
  }

  // GET → redirect ไปหน้าถัดไป (เปิดใน address bar ได้เลย) · POST → คืน JSON
  const res = req.method === "POST"
    ? NextResponse.json({ ok: true, email })
    : NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(SSO_COOKIE, value, { httpOnly: true, sameSite: "lax", path: "/", maxAge, secure: false });
  return res;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
