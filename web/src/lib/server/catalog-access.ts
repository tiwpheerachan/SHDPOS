import { NextRequest } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { PosError } from "./pos-context";
export async function catalogAccess(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  if (
    !authz.allowed ||
    !authz.employee_id ||
    !hasPerm(profile.email, authz, "admin.product_manage") ||
    !hasPerm(profile.email, authz, "report.cost") ||
    (!authz.isSuperadmin && authz.data_scope !== "company")
  )
    throw new PosError("ต้องมีสิทธิ์จัดการสินค้าและต้นทุนระดับบริษัท", 403);
  return { profile, authz, actorId: authz.employee_id };
}
