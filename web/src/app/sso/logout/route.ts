import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE } from "@/lib/sso/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

function clear(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/pos", origin(req)));
  res.cookies.delete(SSO_COOKIE);
  return res;
}

export const GET = clear;
export const POST = clear;
