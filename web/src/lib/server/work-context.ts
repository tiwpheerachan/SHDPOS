import { NextRequest } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { visibleBranchIds } from "@/lib/sso/scope";
import { PosError } from "./pos-context";
export async function workContext(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id)
    throw new PosError("ไม่มีสิทธิ์ใช้งาน", 403);
  const branches = await visibleBranchIds(authz);
  return {
    profile,
    authz,
    actor: authz.employee_id,
    branches,
    manager:
      ["supervisor", "manager", "brand_admin", "hq", "owner"].includes(
        authz.role,
      ) || authz.isSuperadmin,
  };
}
export function workBranch(branch: string, allowed: string[] | null) {
  if (allowed !== null && !allowed.includes(branch))
    throw new PosError("ไม่มีสิทธิ์สาขานี้", 403);
}
