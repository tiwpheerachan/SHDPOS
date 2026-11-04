// แปลงโปรไฟล์ SSO + สิทธิ์ที่ resolve แล้ว (app_user_grants) → Employee ของแอป
import type { Branch, Employee, EmployeeRole, DataScope, PermissionEffect } from "@/lib/types";
import type { AppAuthz, SsoSessionProfile } from "./types";

/** หา branch ในแอปจากชื่อสาขาของ assignment หลัก (เทียบชื่อ) */
export function matchBranch(branches: Branch[], branchName?: string | null): Branch | null {
  if (!branchName) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(branchName);
  return (
    branches.find((b) => norm(b.name_th ?? b.name) === target || norm(b.name) === target) ??
    branches.find((b) => norm(b.name_th ?? b.name).includes(target) || norm(b.name).includes(target)) ??
    null
  );
}

/** สร้าง Employee จากโปรไฟล์ SSO + สิทธิ์จริงจาก app_user_grants */
export function buildSsoEmployee(profile: SsoSessionProfile, authz: AppAuthz, branchId: string): Employee {
  // สาขา: ถ้า grant ระบุไว้ใช้ของ grant, ไม่งั้นใช้สาขาที่เลือกตอนล็อกอิน
  const branchIds = authz.branch_ids?.length ? authz.branch_ids : branchId ? [branchId] : [];
  const homeBranch = authz.branch_ids?.length ? authz.branch_ids[0] : branchId || null;
  return {
    // ใช้ uuid จริงของ employees ถ้ามี (ให้บันทึกขาย/audit ได้) ไม่งั้น fallback sso:
    id: authz.employee_id || `sso:${profile.union_id || profile.email}`,
    employee_code: profile.email || profile.union_id,
    first_name: profile.name,
    last_name: null,
    nickname: profile.name,
    role: authz.role as EmployeeRole,
    data_scope: authz.data_scope as DataScope,
    home_branch_id: homeBranch,
    branch_ids: branchIds,
    brand_ids: authz.brand_ids ?? [],
    max_discount_percent: authz.max_discount_percent ?? 0,
    can_open_drawer: authz.can_open_drawer ?? true,
    status: "active",
    photo_url: profile.avatar_url ?? null,
    email: profile.email,
    permission_overrides: (authz.permission_overrides ?? {}) as Record<string, PermissionEffect>,
  };
}
