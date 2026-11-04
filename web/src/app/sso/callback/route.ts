import { NextRequest, NextResponse } from "next/server";
import { verifyCode, getDirectoryUser } from "@/lib/sso/central";
import { SSO_COOKIE, SSO_STATE_COOKIE, readState, signSession } from "@/lib/sso/session-cookie";
import type { SsoSessionProfile } from "@/lib/sso/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

function fail(req: NextRequest, reason: string) {
  const url = new URL("/pos", origin(req));
  url.searchParams.set("sso_error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete(SSO_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const returnedState = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  if (err) return fail(req, err);
  if (!code || !returnedState) return fail(req, "missing_code");

  // ตรวจ state กัน CSRF
  const stateCookie = req.cookies.get(SSO_STATE_COOKIE)?.value;
  const saved = readState(stateCookie);
  if (!saved || saved.state !== returnedState) return fail(req, "bad_state");

  const redirectUri = `${origin(req)}/sso/callback`;

  let identity;
  try {
    identity = await verifyCode(code, redirectUri);
  } catch (e: any) {
    return fail(req, "verify_failed");
  }

  // เติมโปรไฟล์จาก directory (ชื่อ/รูป/แผนก) ด้วย email หรือ union_id
  let person = null;
  if (identity.email || identity.union_id) {
    person = await getDirectoryUser({ email: identity.email, union_id: identity.union_id });
  }

  const email = identity.email ?? person?.email;
  const union_id = identity.union_id ?? person?.union_id;
  if (!email && !union_id) return fail(req, "no_identity");

  const profile: SsoSessionProfile = {
    email: email ?? "",
    union_id: union_id ?? "",
    name: person?.name ?? identity.name ?? email ?? "ผู้ใช้",
    avatar_url: person?.avatar_url ?? identity.avatar_url,
    department: person?.departments?.[0],
  };

  const { value, maxAge } = signSession(profile);
  const dest = new URL(saved.next || "/pos", origin(req));
  dest.searchParams.set("sso", "1");
  const res = NextResponse.redirect(dest);
  res.cookies.set(SSO_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  res.cookies.delete(SSO_STATE_COOKIE);
  return res;
}
