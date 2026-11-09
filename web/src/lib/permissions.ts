// =====================================================================
// RBAC — ฝั่ง client ใช้ซ่อน/ปิดปุ่มเท่านั้น
// การบังคับจริงอยู่ที่ RLS + RPC ฝั่ง Supabase (0007_rls.sql)
// =====================================================================

import type { Employee, EmployeeRole, PermissionEffect } from "./types";

export const PERMISSION_KEYS = [
  "pos.sell", "pos.discount", "pos.price_override", "pos.void", "pos.reprint",
  "pos.open_drawer", "pos.quotation",
  "return.create", "return.approve",
  "inventory.view", "inventory.adjust", "inventory.count",
  "transfer.request", "transfer.approve", "transfer.receive",
  "shift.open", "shift.close", "shift.force_close", "cash.adjust",
  "report.employee_perf", "report.cost", "report.gross_profit",
  "admin.employee_manage", "admin.permission_manage", "admin.product_manage",
  "admin.branch_manage", "admin.settings", "audit.view",
  "customer.manage", "tax.issue_full",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

type Rule = { effect: PermissionEffect; limit?: number };

/**
 * ตาราง permission ตาม role — ตรงกับ seed.sql (role_permissions)
 * ค่าที่ไม่ได้ระบุ = deny
 */
export const ROLE_MATRIX: Record<EmployeeRole, Partial<Record<PermissionKey, Rule>>> = {
  staff: {
    "pos.sell": { effect: "allow" },
    "pos.discount": { effect: "allow", limit: 5 },
    "pos.void": { effect: "approval" },
    "pos.reprint": { effect: "approval" },
    "pos.quotation": { effect: "allow" },
    "return.create": { effect: "approval" },
    "inventory.view": { effect: "allow" },
    "inventory.count": { effect: "allow" },
    "shift.open": { effect: "allow" },
    "shift.close": { effect: "allow" },
    "report.employee_perf": { effect: "allow" },
    "customer.manage": { effect: "allow" },
    "tax.issue_full": { effect: "allow" },
  },
  supervisor: {
    "pos.sell": { effect: "allow" },
    "pos.discount": { effect: "allow", limit: 10 },
    "pos.price_override": { effect: "approval" },
    "pos.void": { effect: "allow" },
    "pos.reprint": { effect: "allow" },
    "pos.open_drawer": { effect: "allow" },
    "pos.quotation": { effect: "allow" },
    "return.create": { effect: "allow" },
    "return.approve": { effect: "allow" },
    "inventory.view": { effect: "allow" },
    "inventory.count": { effect: "allow" },
    "transfer.request": { effect: "allow" },
    "transfer.receive": { effect: "allow" },
    "shift.open": { effect: "allow" },
    "shift.close": { effect: "allow" },
    "cash.adjust": { effect: "approval" },
    "report.employee_perf": { effect: "allow" },
    "report.gross_profit": { effect: "allow" },
    "customer.manage": { effect: "allow" },
    "tax.issue_full": { effect: "allow" },
  },
  manager: {
    "pos.sell": { effect: "allow" },
    "pos.discount": { effect: "allow", limit: 20 },
    "pos.price_override": { effect: "allow" },
    "pos.void": { effect: "allow" },
    "pos.reprint": { effect: "allow" },
    "pos.open_drawer": { effect: "allow" },
    "pos.quotation": { effect: "allow" },
    "return.create": { effect: "allow" },
    "return.approve": { effect: "allow" },
    "inventory.view": { effect: "allow" },
    "inventory.adjust": { effect: "allow" },
    "inventory.count": { effect: "allow" },
    "transfer.request": { effect: "allow" },
    "transfer.approve": { effect: "allow" },
    "transfer.receive": { effect: "allow" },
    "shift.open": { effect: "allow" },
    "shift.close": { effect: "allow" },
    "shift.force_close": { effect: "allow" },
    "cash.adjust": { effect: "allow" },
    "report.employee_perf": { effect: "allow" },
    "report.cost": { effect: "allow" },
    "report.gross_profit": { effect: "allow" },
    "admin.employee_manage": { effect: "allow" },
    "customer.manage": { effect: "allow" },
    "audit.view": { effect: "allow" },
    "tax.issue_full": { effect: "allow" },
  },
  brand_admin: {
    "return.approve": { effect: "allow" },
    "inventory.view": { effect: "allow" },
    "inventory.adjust": { effect: "allow" },
    "transfer.request": { effect: "allow" },
    "transfer.approve": { effect: "allow" },
    "report.employee_perf": { effect: "allow" },
    "report.cost": { effect: "allow" },
    "report.gross_profit": { effect: "allow" },
    "admin.product_manage": { effect: "allow" },
    "admin.employee_manage": { effect: "allow" },
    "admin.permission_manage": { effect: "allow" },
    "audit.view": { effect: "allow" },
  },
  hq: Object.fromEntries(
    PERMISSION_KEYS.map((k) => [k, { effect: "allow", limit: k === "pos.discount" ? 100 : undefined }])
  ) as Partial<Record<PermissionKey, Rule>>,
  // เจ้าของกิจการ — สิทธิ์เต็มทุกอย่าง เห็นทุกแบรนด์ทุกสาขา (เทียบเท่า/สูงกว่า HQ)
  owner: Object.fromEntries(
    PERMISSION_KEYS.map((k) => [k, { effect: "allow", limit: k === "pos.discount" ? 100 : undefined }])
  ) as Partial<Record<PermissionKey, Rule>>,
  auditor: {
    "inventory.view": { effect: "allow" },
    "report.employee_perf": { effect: "allow" },
    "report.cost": { effect: "allow" },
    "report.gross_profit": { effect: "allow" },
    "audit.view": { effect: "allow" },
  },
};

/** อีเมลผู้ดูแลสูงสุด (เข้าถึงทุกอย่าง + จัดการสิทธิ์ได้เสมอ) — bootstrap กันล็อกตัวเองออก */
export const SUPERADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_SUPERADMIN_EMAILS || "tiw.pheerachan@shd-technology.co.th"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isSuperadmin(email?: string | null): boolean {
  return !!email && SUPERADMIN_EMAILS.includes(email.toLowerCase());
}

export function ruleFor(employee: Employee | null, key: PermissionKey): Rule {
  if (!employee) return { effect: "deny" };
  // ผู้ดูแลสูงสุด = อนุญาตทุกอย่าง (ส่วนลดเต็ม 100%)
  if (isSuperadmin(employee.email)) {
    return { effect: "allow", limit: key === "pos.discount" ? 100 : undefined };
  }
  const base = ROLE_MATRIX[employee.role]?.[key];
  const override = employee.permission_overrides?.[key] as PermissionEffect | undefined;

  if (key === "pos.discount") {
    // ส่วนลด: คุมด้วยเพดาน % รายคน (override role)
    const limit = employee.max_discount_percent ?? base?.limit ?? 0;
    return { effect: limit > 0 ? "allow" : "deny", limit };
  }

  // override รายคนมาก่อนเสมอ (อนุญาต/ห้าม/อนุมัติ) — ทับ role matrix
  if (override) {
    return { effect: override, limit: base?.limit };
  }
  if (key === "pos.open_drawer" && employee.can_open_drawer) return { effect: "allow" };
  return base ?? { effect: "deny" };
}

export function can(employee: Employee | null, key: PermissionKey): boolean {
  return ruleFor(employee, key).effect === "allow";
}

export function needsApproval(employee: Employee | null, key: PermissionKey): boolean {
  return ruleFor(employee, key).effect === "approval";
}

export function discountLimit(employee: Employee | null): number {
  return ruleFor(employee, "pos.discount").limit ?? 0;
}

/** ส่วนลด % นี้ ต้องให้ใครอนุมัติ */
export function discountApprovalLevel(percent: number): EmployeeRole | null {
  if (percent <= 5) return null;
  if (percent <= 10) return "supervisor";
  if (percent <= 20) return "manager";
  return "hq";
}

/** สาขาที่พนักงานคนนี้มองเห็น */
export function visibleBranchIds(employee: Employee | null, allBranchIds: string[]): string[] {
  if (!employee) return [];
  // เจ้าของ/HQ/ผู้ดูแลสูงสุด หรือ scope ระดับบริษัท → เห็นทุกสาขา
  if (
    employee.data_scope === "company" ||
    employee.role === "owner" ||
    employee.role === "hq" ||
    isSuperadmin(employee.email)
  ) {
    return allBranchIds;
  }
  return employee.branch_ids.length ? employee.branch_ids : (employee.home_branch_id ? [employee.home_branch_id] : []);
}

export const ROLE_LABEL: Record<EmployeeRole, { th: string; en: string; zh: string }> = {
  staff: { th: "พนักงานขาย", en: "Staff", zh: "店员" },
  supervisor: { th: "หัวหน้ากะ", en: "Supervisor", zh: "主管" },
  manager: { th: "ผู้จัดการร้าน", en: "Store Manager", zh: "店长" },
  brand_admin: { th: "แอดมินแบรนด์", en: "Brand Admin", zh: "品牌管理员" },
  hq: { th: "สำนักงานใหญ่", en: "HQ", zh: "总部" },
  auditor: { th: "ผู้ตรวจสอบ", en: "Auditor", zh: "审计" },
  owner: { th: "เจ้าของกิจการ", en: "Owner", zh: "企业主" },
};
