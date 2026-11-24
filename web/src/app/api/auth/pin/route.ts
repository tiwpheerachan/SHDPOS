import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveAuthz } from "@/lib/sso/grants";
import { SSO_COOKIE, signSession } from "@/lib/sso/session-cookie";
import type { SsoSessionProfile } from "@/lib/sso/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  // Only the same-origin JSON login form may create a browser session.
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin || !req.headers.get("content-type")?.startsWith("application/json"))
    return reply({ error: "invalid_origin" }, 403);
  let body;
  try { body = await req.json(); } catch { return reply({ error: "invalid_request" }, 400); }
  if (!body || typeof body.pin !== "string" || !/^\d{4,6}$/.test(body.pin) ||
      (body.employee_id != null && (typeof body.employee_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.employee_id))))
    return reply({ error: "invalid_request" }, 400);
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("pos_login_by_pin", { p_branch_id: null, p_pin: body.pin });
    if (error) throw error;
    const profiles = Array.isArray(data) ? data : [];
    if (!profiles.length) return reply({ error: "invalid_credentials" }, 401);
    // Recheck application access: old PIN RPC versions only filter employee status.
    const access = await sb.from("employees").select("id,email,status,app_access").in("id", profiles.map(p => p.id));
    if (access.error) throw access.error;
    const active = (access.data ?? []).filter(p => p.status === "active" && p.app_access !== false);
    const matches = profiles.filter(p => active.some(e => e.id === p.id));
    if (!body.employee_id) return matches.length ? reply({ matches }) : reply({ error: "invalid_credentials" }, 401);
    const employee = matches.find(p => p.id === body.employee_id);
    const account = active.find(p => p.id === body.employee_id);
    if (!employee || !account) return reply({ error: "invalid_credentials" }, 401);
    const profile: SsoSessionProfile = {
      email: account.email ?? "", union_id: `pos-pin:${account.id}`, pin_employee_id: account.id,
      name: employee.nickname || [employee.first_name, employee.last_name].filter(Boolean).join(" "),
    };
    const authz = await resolveAuthz(profile);
    if (!authz.allowed || authz.employee_id !== account.id) return reply({ error: "access_denied" }, 403);
    const { value, maxAge } = signSession(profile);
    const response = reply({ employee, authz });
    response.cookies.set(SSO_COOKIE, value, { httpOnly: true, sameSite: "lax", path: "/", maxAge,
      secure: req.nextUrl.protocol === "https:" });
    return response;
  } catch {
    return reply({ error: "login_unavailable" }, 503);
  }
}
