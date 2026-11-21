import { NextRequest } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import type { PermissionKey } from "@/lib/permissions";

export class PosError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function posContext(
  req: NextRequest,
  permission: PermissionKey,
  branchId: string,
) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  const authz = await resolveAuthz(profile);
  if (
    !authz.allowed ||
    !authz.employee_id ||
    !hasPerm(profile.email, authz, permission)
  )
    throw new PosError("ไม่มีสิทธิ์ทำรายการนี้", 403);
  const branches = await visibleBranchIds(authz);
  if (branches !== null && !branches.includes(branchId))
    throw new PosError("ไม่มีสิทธิ์ทำรายการในสาขานี้", 403);
  return { profile, authz, actorId: authz.employee_id };
}
export function requireSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    throw new PosError("คำขอจากแหล่งที่ไม่อนุญาต", 403);
}
