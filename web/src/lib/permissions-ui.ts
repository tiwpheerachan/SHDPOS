// ชั้น UI ร่วมของ "การกำหนดสิทธิ์" — ใช้ทั้ง /admin/permissions และ /admin/org (โฟลเดอร์ทีม)
// รวมนิยามกลุ่มสิทธิ์ ป้ายกำกับ และตัวช่วย เพื่อให้ทุกหน้าที่ตั้งสิทธิ์อ้างอิงชุดเดียวกัน (standard)
import type { EmployeeRole, PermissionEffect } from "@/lib/types";
import { ROLE_MATRIX, PERMISSION_KEYS, type PermissionKey } from "@/lib/permissions";

export type FourState = "inherit" | PermissionEffect;

export const PERM_GROUPS: { th: string; en: string; zh: string; keys: PermissionKey[] }[] = [
  { th: "เมนูหลังบ้าน", en: "Back-office menus", zh: "后台菜单", keys: ["dashboard.view", "work.view", "sales.view", "sales.trace", "product.view", "document.view", "approval.view"] },
  { th: "ขายหน้าร้าน", en: "Store sales", zh: "门店销售", keys: ["pos.sell", "pos.discount", "pos.price_override", "pos.void", "pos.reprint", "pos.open_drawer", "pos.quotation", "deferred_sale.manage"] },
  { th: "คืนสินค้า", en: "Returns", zh: "退货", keys: ["return.create", "return.approve"] },
  { th: "สต็อก", en: "Stock", zh: "库存", keys: ["inventory.view", "inventory.adjust", "inventory.count", "inventory.count_approve"] },
  { th: "โอนย้าย", en: "Transfers", zh: "调货", keys: ["transfer.request", "transfer.approve", "transfer.receive"] },
  { th: "กะ & เงินสด", en: "Shift & cash", zh: "班次与现金", keys: ["shift.open", "shift.close", "shift.force_close", "cash.adjust"] },
  { th: "การตลาด & ลูกค้า", en: "Marketing & customers", zh: "营销与客户", keys: ["customer.manage", "campaign.manage", "loyalty.manage", "display.manage"] },
  { th: "รายงาน & การเงิน", en: "Reports & finance", zh: "报表与财务", keys: ["report.employee_perf", "report.cost", "report.gross_profit", "report.discount", "finance.view"] },
  { th: "แอดมิน", en: "Admin", zh: "管理", keys: ["admin.employee_manage", "admin.permission_manage", "admin.product_manage", "admin.branch_manage", "admin.settings", "integration.manage", "integration.reconcile", "audit.view"] },
  { th: "เอกสารภาษี", en: "Tax documents", zh: "税务单据", keys: ["tax.issue_full", "tax.credit_note"] },
];

// Record<PermissionKey,…> → ถ้าเพิ่มคีย์ใหม่ใน permissions.ts แต่ลืมใส่ป้ายตรงนี้ TypeScript จะ error ทันที
export const PERM_LABEL: Record<PermissionKey, { th: string; en: string; zh: string }> = {
  "pos.discount": { th: "ให้ส่วนลด", en: "Give discount", zh: "折扣" },
  "finance.view": { th: "ดูการเงิน / รับชำระ", en: "View finance / payments", zh: "查看财务" },
  "dashboard.view": { th: "แดชบอร์ด", en: "Dashboard", zh: "仪表盘" },
  "work.view": { th: "งานของฉัน + ปฏิทินขาย", en: "My work + sales calendar", zh: "我的工作" },
  "sales.view": { th: "หน้ายอดขาย", en: "Sales page", zh: "销售页" },
  "sales.trace": { th: "ดูแผนภาพที่มาของบิล (ที่มา→โปร→ชำระ→สต๊อก→JST→แต้ม→คืน)", en: "Order trace diagram", zh: "订单来源图" },
  "product.view": { th: "ดูรายการสินค้า", en: "View products", zh: "查看商品" },
  "document.view": { th: "เอกสาร", en: "Documents", zh: "单据" },
  "approval.view": { th: "รายการรออนุมัติ", en: "Approvals inbox", zh: "待审批" },
  "deferred_sale.manage": { th: "บิลรอปิด", en: "Deferred sales", zh: "待结单据" },
  "campaign.manage": { th: "แคมเปญ / คูปอง", en: "Campaigns / coupons", zh: "活动/优惠券" },
  "loyalty.manage": { th: "ตั้งค่าแต้มสะสม (รายแบรนด์/กฎพิเศษ)", en: "Loyalty points rules", zh: "积分规则" },
  "display.manage": { th: "จอลูกค้า / แบนเนอร์", en: "Customer display", zh: "客显屏" },
  "integration.manage": { th: "เชื่อมคลังกลาง (OneWarehouse)", en: "OneWarehouse integration", zh: "中央仓对接" },
  "integration.reconcile": { th: "ตรวจความตรงกัน POS↔คลังกลาง↔JST", en: "POS↔OW↔JST reconciliation", zh: "POS↔中央仓↔JST 核对" },
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
  "inventory.count_approve": { th: "อนุมัติผลนับสต็อก (ปรับยอด)", en: "Approve stock count", zh: "审批盘点" },
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
  "report.discount": { th: "ประวัติส่วนลดรายบิล (แคมเปญ/คูปอง/พนักงาน → JST)", en: "Discount history per bill", zh: "折扣明细" },
  "admin.employee_manage": { th: "จัดการพนักงาน", en: "Manage employees", zh: "管理员工" },
  "admin.permission_manage": { th: "กำหนดสิทธิ์ (แอดมิน)", en: "Manage permissions (admin)", zh: "权限管理（管理员）" },
  "admin.product_manage": { th: "จัดการสินค้า", en: "Manage products", zh: "管理商品" },
  "admin.branch_manage": { th: "จัดการสาขา", en: "Manage branches", zh: "管理门店" },
  "admin.settings": { th: "ตั้งค่าระบบ", en: "System settings", zh: "系统设置" },
  "audit.view": { th: "ดู audit log", en: "View audit log", zh: "查看审计日志" },
  "customer.manage": { th: "จัดการลูกค้า", en: "Manage customers", zh: "管理客户" },
  "tax.issue_full": { th: "ออกใบกำกับเต็มรูป", en: "Issue full tax invoice", zh: "开具增值税专用发票" },
  "tax.credit_note": { th: "ออกใบลดหนี้ (ลดราคา/คืนเงินหลังขาย)", en: "Issue credit note", zh: "开具红字发票" },
};

export const STATE_META: Record<FourState, { th: string; en: string; zh: string; glyph: string }> = {
  inherit: { th: "ตาม role", en: "By role", zh: "按角色", glyph: "–" },
  allow: { th: "อนุญาต", en: "Allow", zh: "允许", glyph: "✓" },
  approval: { th: "อนุมัติก่อน", en: "Needs approval", zh: "需审批", glyph: "~" },
  deny: { th: "ห้าม", en: "Deny", zh: "禁止", glyph: "✕" },
};

export const ALL_KEYS: PermissionKey[] = PERM_GROUPS.flatMap((g) => g.keys);
/** คีย์ที่มีใน permissions.ts แต่ยังไม่อยู่ในกลุ่มใดในหน้าสิทธิ์ (ควรว่างเสมอ — มีเทสต์เช็ก) */
export const UNGROUPED_KEYS: PermissionKey[] = PERMISSION_KEYS.filter((k) => !ALL_KEYS.includes(k));
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
