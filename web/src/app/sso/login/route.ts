import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authorizeUrl, clientId } from "@/lib/sso/central";
import { SSO_STATE_COOKIE, signState } from "@/lib/sso/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export function GET(req: NextRequest) {
  if (!clientId()) {
    return NextResponse.json({ error: "SSO ยังไม่ได้ตั้งค่า (SSO_CLIENT_ID)" }, { status: 500 });
  }
  const nextParam = req.nextUrl.searchParams.get("next") || "/pos";
  // รับเฉพาะ path ภายใน (กัน open redirect)
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/pos";

  const redirectUri = `${origin(req)}/sso/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const res = NextResponse.redirect(authorizeUrl(redirectUri, state));
  res.cookies.set(SSO_STATE_COOKIE, signState(state, next), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
