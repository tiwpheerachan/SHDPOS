// ชั้น UI ร่วมของ "การกำหนดสิทธิ์" — ใช้ทั้ง /admin/permissions และ /admin/org (โฟลเดอร์ทีม)
// รวมนิยามกลุ่มสิทธิ์ ป้ายกำกับ และตัวช่วย เพื่อให้ทุกหน้าที่ตั้งสิทธิ์อ้างอิงชุดเดียวกัน (standard)
import type { EmployeeRole, PermissionEffect } from "@/lib/types";
import { ROLE_MATRIX, type PermissionKey } from "@/lib/permissions";

export type FourState = "inherit" | PermissionEffect;

export const PERM_GROUPS: { th: string; en: string; zh: string; keys: PermissionKey[] }[] = [
  { th: "ขายหน้าร้าน", en: "Store sales", zh: "门店销售", keys: ["pos.sell", "pos.price_override", "pos.void", "pos.reprint", "pos.open_drawer", "pos.quotation"] },
  { th: "คืนสินค้า", en: "Returns", zh: "退货", keys: ["return.create", "return.approve"] },
  { th: "สต็อก", en: "Stock", zh: "库存", keys: ["inventory.view", "inventory.adjust", "inventory.count"] },
  { th: "โอนย้าย", en: "Transfers", zh: "调货", keys: ["transfer.request", "transfer.approve", "transfer.receive"] },
  { th: "กะ & เงินสด", en: "Shift & cash", zh: "班次与现金", keys: ["shift.open", "shift.close", "shift.force_close", "cash.adjust"] },
  { th: "รายงาน", en: "Reports", zh: "报表", keys: ["report.employee_perf", "report.cost", "report.gross_profit"] },
  { th: "แอดมิน", en: "Admin", zh: "管理", keys: ["admin.employee_manage", "admin.permission_manage", "admin.product_manage", "admin.branch_manage", "admin.settings", "audit.view"] },
  { th: "อื่นๆ", en: "Others", zh: "其他", keys: ["customer.manage", "tax.issue_full"] },
];

export const PERM_LABEL: Record<string, { th: string; en: string; zh: string }> = {
  "pos.sell": { th: "ขายสินค้า", en: "Sell", zh: "销售" },
  "pos.price_override": { th: "แก้ราคา", en: "Override price", zh: "改价" },
  "pos.void": { th: "ยกเลิกบิล", en: "Void bill", zh: "作废单据" },
  "pos.reprint": { th: "พิมพ์ซ้ำ", en: "Reprint", zh: "重新打印" },
  "pos.open_drawer": { th: "เปิดลิ้นชัก", en: "Open drawer", zh: "打开钱箱" },
  "pos.quotation": { th: "ใบเสนอราคา", en: "Quotation", zh: "报价单" },
  "return.create": { th: "รับคืนสินค้า", en: "Accept return", zh: "受理退货" },
  "return.approve": { th: "อนุมัติคืน", en: "Approve return", zh: "审批退货" },
  "inventory.view": { th: "ดูสต็อก", en: "View stock", zh: "查看库存" },
  "inventory.adjust": { th: "ปรับสต็อก", en: "Adjust stock", zh: "库存调整" },
  "inventory.count": { th: "นับสต็อก", en: "Count stock", zh: "盘点" },
  "transfer.request": { th: "ขอโอนย้าย", en: "Request transfer", zh: "申请调货" },
  "transfer.approve": { th: "อนุมัติโอน", en: "Approve transfer", zh: "审批调货" },
  "transfer.receive": { th: "รับของโอน", en: "Receive transfer", zh: "接收调货" },
  "shift.open": { th: "เปิดกะ", en: "Open shift", zh: "开班" },
  "shift.close": { th: "ปิดกะ", en: "Close shift", zh: "交班" },
  "shift.force_close": { th: "ปิดกะแทน", en: "Force close shift", zh: "强制交班" },
  "cash.adjust": { th: "ปรับเงินสด", en: "Adjust cash", zh: "现金调整" },
  "report.employee_perf": { th: "ดู performance", en: "View performance", zh: "查看绩效" },
  "report.cost": { th: "ดูต้นทุน", en: "View cost", zh: "查看成本" },
  "report.gross_profit": { th: "ดูกำไร", en: "View profit", zh: "查看利润" },
  "admin.employee_manage": { th: "จัดการพนักงาน", en: "Manage employees", zh: "管理员工" },
  "admin.permission_manage": { th: "กำหนดสิทธิ์ (แอดมิน)", en: "Manage permissions (admin)", zh: "权限管理（管理员）" },
  "admin.product_manage": { th: "จัดการสินค้า", en: "Manage products", zh: "管理商品" },
  "admin.branch_manage": { th: "จัดการสาขา", en: "Manage branches", zh: "管理门店" },
  "admin.settings": { th: "ตั้งค่าระบบ", en: "System settings", zh: "系统设置" },
  "audit.view": { th: "ดู audit log", en: "View audit log", zh: "查看审计日志" },
  "customer.manage": { th: "จัดการลูกค้า", en: "Manage customers", zh: "管理客户" },
  "tax.issue_full": { th: "ออกใบกำกับเต็มรูป", en: "Issue full tax invoice", zh: "开具增值税专用发票" },
};

export const STATE_META: Record<FourState, { th: string; en: string; zh: string; glyph: string }> = {
  inherit: { th: "ตาม role", en: "By role", zh: "按角色", glyph: "–" },
  allow: { th: "อนุญาต", en: "Allow", zh: "允许", glyph: "✓" },
  approval: { th: "อนุมัติก่อน", en: "Needs approval", zh: "需审批", glyph: "~" },
  deny: { th: "ห้าม", en: "Deny", zh: "禁止", glyph: "✕" },
};

export const ALL_KEYS: PermissionKey[] = PERM_GROUPS.flatMap((g) => g.keys);
export const CYCLE: Record<FourState, FourState> = { inherit: "allow", allow: "deny", deny: "inherit", approval: "inherit" };

export function baseEffect(role: EmployeeRole, key: PermissionKey): PermissionEffect {
  return ROLE_MATRIX[role]?.[key]?.effect ?? "deny";
}

/** สถานะที่มีผลจริง = override ถ้าตั้งไว้ ไม่งั้นตกลงมาเป็น baseEffect ตาม role */
export function effectiveEffect(role: EmployeeRole, overrides: Record<string, PermissionEffect> | null | undefined, key: PermissionKey): PermissionEffect {
  const ov = overrides?.[key];
  return ov ?? baseEffect(role, key);
}

/** payload มาตรฐานสำหรับ POST /api/admin/users (ต้อง login SSO-admin จริง) */
export async function saveUserGrant(body: Record<string, unknown>): Promise<Response | null> {
  return fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}
