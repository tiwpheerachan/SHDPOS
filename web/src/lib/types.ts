// =====================================================================
// SHD POS — Domain types (ตรงกับ schema ใน supabase/migrations)
// =====================================================================

export type EmployeeRole = "staff" | "supervisor" | "manager" | "brand_admin" | "hq" | "auditor";
export type DataScope = "own" | "branch" | "brand" | "company";
export type ProductKind = "goods" | "service" | "bundle" | "fee";
export type LineKind = "goods" | "service" | "fee" | "travel" | "claim" | "b2b";
export type OrderStatus = "draft" | "completed" | "voided" | "refunded" | "partially_refunded";
export type SaleChannel =
  | "offline" | "online_shopee" | "online_lazada" | "online_tiktok"
  | "online_website" | "event" | "b2b" | "other";
export type PaymentMethod =
  | "cash" | "credit_card" | "debit_card" | "qr_promptpay" | "bank_transfer"
  | "edc" | "gift_card" | "store_credit" | "installment" | "online_marketplace" | "other";
export type TransferStatus =
  | "draft" | "pending_approval" | "approved" | "picking" | "packed" | "shipped"
  | "in_transit" | "received" | "partial_received" | "completed" | "cancelled" | "rejected";
export type ReturnType = "refund" | "exchange" | "claim";
export type ReturnStatus = "pending_approval" | "approved" | "rejected" | "completed" | "cancelled";
export type ApprovalKind =
  | "discount" | "price_override" | "return" | "void" | "cash_adjust" | "stock_adjust"
  | "transfer" | "reprint" | "shift_force_close" | "permission_change";
export type PermissionEffect = "allow" | "deny" | "approval";

export interface Brand {
  id: string;
  code: string;
  name: string;
  name_th?: string | null;
  name_zh?: string | null;
  color?: string | null;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  name_th?: string | null;
  brand_id: string | null;
  branch_type: string;
  province?: string | null;
  tax_branch_no?: string | null;
  is_active: boolean;
}

export interface Terminal {
  id: string;
  branch_id: string;
  code: string;
  name?: string | null;
  receipt_prefix: string;
  customer_display: boolean;
}

export interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
  nickname?: string | null;
  role: EmployeeRole;
  data_scope: DataScope;
  home_branch_id: string | null;
  branch_ids: string[];
  brand_ids: string[];
  max_discount_percent: number;
  can_open_drawer: boolean;
  status: "active" | "suspended" | "resigned";
  /** ใช้เฉพาะ demo mode — ระบบจริงเก็บ hash ฝั่ง server */
  pin?: string;
  photo_url?: string | null;
}

export interface Product {
  id: string;
  sku: string;
  brand_id: string | null;
  category_id: string | null;
  kind: ProductKind;
  name_th: string;
  name_en?: string | null;
  name_zh?: string | null;
  short_name?: string | null;
  unit: string;
  price: number;
  cost: number;
  vat_rate: number;
  is_discountable: boolean;
  max_discount_percent?: number | null;
  track_serial: boolean;
  warranty_months: number;
  is_stocked: boolean;
  reorder_point: number;
  barcodes: string[];
  is_active: boolean;
}

export interface Category {
  id: string;
  code: string;
  name_th: string;
  name_en?: string | null;
  name_zh?: string | null;
  sort_order: number;
}

export interface StockLevel {
  branch_id: string;
  product_id: string;
  qty_on_hand: number;
  qty_reserved: number;
  reorder_point: number;
}

export interface CartLine {
  lineId: string;
  product_id: string | null;
  sku: string;
  name: string;
  kind: LineKind;
  qty: number;
  unit_price: number;
  /** ราคาเดิมก่อน override — ใช้แสดงราคาขีดฆ่า */
  list_price: number;
  discount_amount: number;
  discount_percent: number;
  unit_cost: number;
  track_serial: boolean;
  serials: string[];
  salesperson_id: string | null;
  note?: string;
}

export interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  acquirer_bank?: string;
  card_brand?: string;
  card_last4?: string;
  approval_code?: string;
  reference_no?: string;
  installment_months?: number;
}

export interface OrderDraft {
  client_uuid: string;
  branch_id: string;
  terminal_id: string | null;
  shift_id: string | null;
  cashier_id: string;
  salesperson_id: string | null;
  customer_id?: string | null;
  customer_name?: string;
  customer_phone?: string;
  channel: SaleChannel;
  items: CartLine[];
  payments: PaymentEntry[];
  subtotal: number;
  discount_total: number;
  discount_percent: number;
  vat_amount: number;
  grand_total: number;
  paid_total: number;
  change_amount: number;
  note?: string;
  is_offline_origin: boolean;
  device_created_at: string;
  discount_approved_by?: string | null;
  tax_invoice?: TaxInvoiceRequest | null;
}

export interface TaxInvoiceRequest {
  full: boolean;
  buyer_name: string;
  buyer_tax_id: string;
  buyer_branch_no?: string;
  buyer_address?: string;
  buyer_email?: string;
}

export interface Order {
  id: string;
  order_no: string;
  client_uuid?: string | null;
  branch_id: string;
  terminal_id?: string | null;
  shift_id?: string | null;
  cashier_id?: string | null;
  salesperson_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: OrderStatus;
  channel: SaleChannel;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  grand_total: number;
  paid_total: number;
  change_amount: number;
  cost_total: number;
  gross_profit: number;
  items: OrderItem[];
  payments: PaymentEntry[];
  is_offline_origin: boolean;
  created_at: string;
  void_reason?: string | null;
}

export interface OrderItem {
  id: string;
  product_id: string | null;
  sku: string;
  name: string;
  kind: LineKind;
  qty: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
  unit_cost: number;
  cost_total: number;
  gross_profit: number;
  serials: string[];
  salesperson_id?: string | null;
  returned_qty: number;
}

export interface Shift {
  id: string;
  shift_no: string;
  branch_id: string;
  terminal_id?: string | null;
  opened_by: string;
  member_ids: string[];
  status: "open" | "closed" | "force_closed";
  opening_cash: number;
  expected_cash?: number | null;
  counted_cash?: number | null;
  cash_variance?: number | null;
  total_sales: number;
  total_orders: number;
  opened_at: string;
  closed_at?: string | null;
}

export interface Transfer {
  id: string;
  transfer_no: string;
  from_branch_id: string;
  to_branch_id: string;
  status: TransferStatus;
  items: { product_id: string; sku: string; name: string; qty_requested: number; qty_shipped: number; qty_received: number }[];
  requested_by?: string | null;
  note?: string | null;
  created_at: string;
}

export interface ReturnDoc {
  id: string;
  return_no: string;
  order_id?: string | null;
  order_no?: string | null;
  branch_id: string;
  type: ReturnType;
  status: ReturnStatus;
  reason_code?: string | null;
  reason_note?: string | null;
  refund_method?: PaymentMethod | null;
  refund_amount: number;
  items: { sku: string; name: string; qty: number; unit_price: number; line_total: number; condition: string }[];
  requested_by?: string | null;
  approved_by?: string | null;
  created_at: string;
}

export interface Quotation {
  id: string;
  quotation_no: string;
  branch_id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: "draft" | "sent" | "accepted" | "converted" | "expired" | "cancelled";
  grand_total: number;
  valid_until?: string | null;
  items: { sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
  created_at: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  branch_id?: string | null;
  ref_table?: string | null;
  ref_no?: string | null;
  amount?: number | null;
  after_data?: Record<string, unknown> | null;
  is_offline: boolean;
  occurred_at: string;
}

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  status: "pending" | "approved" | "rejected" | "expired" | "auto_approved";
  branch_id: string;
  requested_by: string;
  approved_by?: string | null;
  payload: Record<string, unknown>;
  requested_amount?: number | null;
  reason?: string | null;
  created_at: string;
  decided_at?: string | null;
}

export interface NotificationItem {
  id: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  branch_id?: string | null;
  title: string;
  body?: string | null;
  payload: Record<string, unknown>;
  resolved_at?: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  member_code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  tax_id?: string | null;
  tax_name?: string | null;
  tax_address?: string | null;
  points: number;
  store_credit: number;
}

// =====================================================================
// Stock Count Sessions (Phase 6) — นับสต๊อกแบบมีรอบ + workflow
// =====================================================================
export type CountType = "full" | "cycle" | "category" | "brand" | "random" | "serial";
export type CountStatus = "counting" | "submitted" | "completed" | "cancelled";

export interface StockCountLine {
  product_id: string;
  sku: string;
  name: string;
  expected: number;
  counted: number | null;
}

export interface StockCountSession {
  id: string;
  count_no: string;
  branch_id: string;
  zone: string;
  type: CountType;
  status: CountStatus;
  blind: boolean;
  note?: string | null;
  lines: StockCountLine[];
  created_by?: string | null;
  approved_by?: string | null;
  created_at: string;
  submitted_at?: string | null;
  approved_at?: string | null;
}
