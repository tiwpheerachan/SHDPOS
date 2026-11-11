// ตรวจสิทธิ์แอดมินฝั่งเซิร์ฟเวอร์ — ใช้กับ /api/admin/*
import { NextRequest } from "next/server";
import { SSO_COOKIE, readSession } from "./session-cookie";
import { resolveAuthz } from "./grants";
import { isSuperadmin, ROLE_MATRIX, type PermissionKey } from "@/lib/permissions";
import type { AppAuthz, SsoSessionProfile } from "./types";
import type { EmployeeRole } from "@/lib/types";

/** คนนี้จัดการสิทธิ์ได้ไหม (superadmin หรือมีสิทธิ์ admin.permission_manage) */
export function canManagePermissions(email: string | undefined, authz: AppAuthz | null): boolean {
  if (isSuperadmin(email)) return true;
  if (!authz || !authz.allowed) return false;
  const override = authz.permission_overrides?.["admin.permission_manage"];
  if (override) return override === "allow";
  const base = ROLE_MATRIX[authz.role as EmployeeRole]?.["admin.permission_manage" as PermissionKey];
  return base?.effect === "allow";
}

export interface AdminContext {
  profile: SsoSessionProfile;
  authz: AppAuthz;
}

/** คืน context ถ้าผู้เรียกเป็นแอดมินจัดการสิทธิ์ ไม่งั้นคืน null */
export async function requireAdmin(req: NextRequest): Promise<AdminContext | null> {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!canManagePermissions(profile.email, authz)) return null;
  return { profile, authz };
}

/** คนนี้มีสิทธิ์ตามคีย์ที่ระบุไหม (superadmin ผ่านเสมอ) */
export function hasPerm(email: string | undefined, authz: AppAuthz | null, key: PermissionKey): boolean {
  if (isSuperadmin(email)) return true;
  if (!authz || !authz.allowed) return false;
  const override = authz.permission_overrides?.[key];
  if (override) return override === "allow";
  return ROLE_MATRIX[authz.role as EmployeeRole]?.[key]?.effect === "allow";
}

/** คืน context ถ้าผู้เรียกจัดการพนักงานได้ (admin.employee_manage) — ใช้กับผังองค์กร */
export async function requireEmployeeAdmin(req: NextRequest): Promise<AdminContext | null> {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "admin.employee_manage")) return null;
  return { profile, authz };
}
