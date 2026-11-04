import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import type { MeResponse } from "@/lib/sso/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) {
    return NextResponse.json<MeResponse>({ authenticated: false, profile: null, authz: null });
  }
  const authz = await resolveAuthz(profile);
  return NextResponse.json<MeResponse>({ authenticated: true, profile, authz });
}
