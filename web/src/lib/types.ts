// =====================================================================
// SHD POS — Domain types (ตรงกับ schema ใน supabase/migrations)
// =====================================================================

export type EmployeeRole = "staff" | "supervisor" | "manager" | "brand_admin" | "hq" | "auditor" | "owner";
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
  logo_url?: string | null;
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
  /** พิกัดที่ตั้ง (ใช้แนะนำสาขาใกล้สุดตอนขอโอน) — ถ้าไม่มีจะ fallback lib/geo seed ตาม code */
  lat?: number | null;
  lng?: number | null;
  // ── ตั้งค่าสาขาแบบละเอียด (optional — ต่อยอดได้) ──
  phone?: string | null;
  email?: string | null;
  address?: string | null;       // ที่อยู่ (บรรทัดเดียว)
  district?: string | null;      // อำเภอ/เขต
  postcode?: string | null;
  open_time?: string | null;     // "10:00"
  close_time?: string | null;    // "21:00"
  manager_id?: string | null;    // employee id ผู้จัดการสาขา
  note?: string | null;
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
  /** อีเมล (ผู้ใช้ SSO ใช้เป็นตัวระบุตัวตนหลัก) */
  email?: string | null;
  /** สิทธิ์เฉพาะคนที่ override ทับ role matrix — { "pos.void": "allow", "report.cost": "deny" } */
  permission_overrides?: Record<string, PermissionEffect> | null;
  /** ข้อมูลจากระบบกลาง (Lark/GoodHR) — เติมด้วย SSO sync */
  union_id?: string | null;
  job_title?: string | null;
  manager_union_id?: string | null;
  central_branch?: string | null;
  central_department?: string | null;
}

/** สิทธิ์รายคนที่เก็บใน Supabase (ตาราง app_user_grants) — ผู้ใช้ SSO */
export interface AppUserGrant {
  email: string;
  union_id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: EmployeeRole;
  data_scope: DataScope;
  branch_ids: string[];
  brand_ids: string[];
  max_discount_percent: number;
  permission_overrides: Record<string, PermissionEffect>;
  is_active: boolean;
  updated_by?: string | null;
  updated_at?: string;
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
  serial_policy_confirmed?: boolean;
  kind_policy_confirmed?: boolean;
  review_version?: number;
  warranty_months: number;
  is_stocked: boolean;
  reorder_point: number;
  barcodes: string[];
  is_active: boolean;
  image_url?: string | null;
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
  /** On Hand — จำนวนที่อยู่จริงในคลังตอนนี้ */
  qty_on_hand: number;
  /** Reserved Out [CO OUT] — จองไว้เพื่อโอนออก (ตั้งแต่สร้าง CO จนรับเข้าปลายทาง) */
  qty_reserved: number;
  /** On the Way Out — สแกนออกจากคลังแล้วแต่ยังไม่ถึงปลายทาง (ยังนับเป็น Stock ต้นทาง) */
  qty_otwo?: number;
  /** Reserved Order — จองตาม order/พักบิล ที่ยังไม่สแกนออก */
  qty_reserved_order?: number;
  /** Quarantine — ของที่รับมาแต่ชำรุด/SN ผิด พักตรวจ ขายไม่ได้ (อยู่ใน on_hand แต่กันออกจาก Available) */
  qty_quarantine?: number;
  reorder_point: number;
  /** วันที่สต๊อกล็อตล่าสุดเข้าคลัง — ใช้คำนวณ "อายุสต๊อก" (เข้ามากี่วันแล้ว) */
  last_in_at?: string | null;
}

export interface CartLine {
  lineId: string;
  product_id: string | null;
  sku: string;
  name: string;
  image_url?: string | null;
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
  /** ของแถม: สินค้าจริง ราคาเรียกเก็บ 0 แต่คิดต้นทุน + ตัดสต๊อก */
  is_gift?: boolean;
  gift_source?: "campaign" | "bundle" | "manual";
  gift_campaign_id?: string | null;
  gift_of_sku?: string | null;
}

// ── ทะเบียนรับชำระ EDC (Phase 1: registry + manual) ───────────────
/** ผู้รับชำระ/ธนาคาร — verified=true ถึงจะเปิดให้เลือกตอน checkout อัตโนมัติ */
export interface Acquirer {
  id: string;
  code: string;          // SCB, KBANK, UOB, KSA, CARDX ...
  name: string;
  verified: boolean;     // ยืนยันสัญญา/โปรโตคอลแล้วหรือยัง
  note?: string | null;
  is_demo?: boolean;     // ข้อมูลสาธิต (ล้างได้ แยกจากงานจริง)
}
export type EdcService = "card" | "unionpay" | "thaiqr" | "qr_credit" | "alipay" | "wechat" | "installment";
/** เครื่อง EDC จริง 1 ตัว ผูกสาขา + ผู้รับชำระ + MID/TID + บริการที่เปิด (เก็บเลขมาสก์ได้) */
export interface EdcTerminal {
  id: string;
  asset_code: string;          // device id ภายในของเรา (แยกจาก bank TID)
  acquirer_id: string;
  mid: string | null;          // merchant id (มาสก์/ท้ายเลขได้)
  tid: string | null;          // terminal id (อาจเป็น logical id ของบริการ)
  mer_no?: string | null;
  legal_entity?: string | null;
  shop_name?: string | null;   // ชื่อร้านบนระบบธนาคาร
  branch_id: string | null;
  model?: string | null;
  services: EdcService[];
  installment_months: number[]; // งวดผ่อนที่อนุมัติ เช่น [3,6,10]
  status: "installed" | "spare" | "repair" | "retired";
  verified: boolean;           // ยืนยันหน้างาน/สัญญาแล้ว
  note?: string | null;  is_demo?: boolean;
}

/** แถวรายงานธนาคาร (statement) ที่ import เข้ามา — ใช้จับคู่กับ PaymentTxn */
export interface StatementRow {
  id: string;
  batch_id: string;
  at: string;                  // วัน settlement/รายการในรายงาน
  amount: number;
  approval_code?: string | null;
  ref_no?: string | null;
  acquirer_code?: string | null;
  note?: string | null;
  is_demo?: boolean;
  date_warn?: boolean;         // วันที่อ่านไม่ได้ (ใช้วันนำเข้าแทน)
}
export interface StatementBatch {
  id: string;
  name: string;                // ชื่อไฟล์/งวด
  acquirer_id?: string | null;
  uploaded_at: string;
  count: number;
}

/** รายการชำระ EDC 1 ครั้ง (Phase 2) — สร้างก่อนเรียกเก็บ, เก็บผล, กันซ้ำด้วย op_key */
export interface PaymentTxn {
  id: string;
  op_key: string;              // idempotency key — กันเรียกเก็บซ้ำ
  at: string;
  resolved_at?: string | null;
  order_no: string | null;
  terminal_id: string | null;
  acquirer_id: string | null;
  method: EdcService;
  amount: number;
  installment_months?: number | null;
  status: "pending" | "approved" | "declined" | "error" | "voided";
  approval_code?: string | null;  // รหัสอนุมัติจากเครื่อง
  ref_no?: string | null;
  branch_id: string | null;
  cashier_name?: string | null;
  note?: string | null;  is_demo?: boolean;
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
  /** เลขบิลจาก Checkout กลาง (โหมดจริง) — ใช้บนใบเสร็จให้ตรงเลขในระบบกลาง/OneWarehouse/JST */
  central_order_no?: string | null;
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
  /** จองของ/ส่งทีหลัง: จอง Reserved Order แทนตัด On Hand ทันที (ส่งมอบภายหลัง) */
  reserve?: boolean;
  reserve_days?: number;
  /** Server already committed the sale; local persistence must not deduct stock a second time. */
  central_committed?: boolean;
  is_offline_origin: boolean;
  device_created_at: string;
  discount_approved_by?: string | null;
  tax_invoice?: TaxInvoiceRequest | null;
  /** จำนวนแต้มที่ลูกค้าใช้เป็นส่วนลดกับบิลนี้ (หักที่ server) */
  redeem_points?: number;
  /** คูปองที่ใช้ (บันทึกการใช้ที่ server เพื่อวัดผล) */
  coupon_code?: string | null;
  coupon_discount?: number;
  coupon_campaign_id?: string | null;
  /** snapshot กติกาโปรโมชันที่ใช้จริง เก็บกับบิล (แก้แคมเปญทีหลังไม่กระทบประวัติ) */
  promo_snapshot?: unknown;
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
  customer_id?: string | null;
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
  /** การส่งมอบ: immediate=ขายรับของทันที (default) · reserved=จองของ ส่งทีหลัง · partial=ส่งบางส่วน · delivered=ส่งครบ · cancelled_reserve=ยกเลิกจอง */
  fulfillment?: "immediate" | "reserved" | "partial" | "delivered" | "cancelled_reserve";
  /** ประวัติการส่งมอบ (สำหรับออเดอร์จอง/ส่งทีหลัง) */
  deliveries?: { at: string; by?: string | null; lines: { product_id: string; qty: number }[] }[];
  /** วันหมดอายุการจอง (ปล่อย Reserved Order อัตโนมัติเมื่อเลยกำหนด) */
  reserve_expires_at?: string | null;
  /** ซิงก์ขึ้น server แล้วหรือยัง + เลขบิลที่ server ออกให้ (อ้างอิงข้ามเครื่อง) */
  synced?: boolean;
  server_order_no?: string | null;
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
  is_gift?: boolean;
  gift_source?: "campaign" | "bundle" | "manual";
  gift_campaign_id?: string | null;
  gift_of_sku?: string | null;
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

/** Serial ที่สแกน (ออก/เข้า) พร้อมเวลา + ผู้ทำ */
export interface TransferSerial { serialNo: string; at: string; by?: string | null }
export interface TransferItem {
  product_id: string;
  sku: string;
  name: string;
  qty_requested: number;
  qty_shipped: number;
  qty_received: number;
  /** true=ต้องสแกน SN ให้ครบ · false=นับจำนวน · null=ยังไม่จัดประเภท → BLOCKED ห้ามส่ง */
  isSerialized?: boolean | null;
  shippedSerials?: TransferSerial[];
  receivedSerials?: TransferSerial[];
  /** SN ที่สแกนรับได้แต่ "ไม่อยู่ในใบโอน" (นอกใบโอน) → พักตรวจที่ปลายทาง ยังไม่ขาย ต้องพิสูจน์ที่มา */
  quarantinedSerials?: TransferSerial[];
  note?: string | null;
}
export interface Transfer {
  id: string;
  transfer_no: string;
  from_branch_id: string;
  to_branch_id: string;
  /** ต้นทางเป็นคลัง (OneWarehouse) หรือสาขา */
  from_kind?: "branch" | "warehouse";
  status: TransferStatus;
  items: TransferItem[];
  requested_by?: string | null;
  /** ผู้อนุมัติ + เหตุผล/หมายเหตุการอนุมัติ-ปฏิเสธ */
  approved_by?: string | null;
  approval_note?: string | null;
  /** ประวัติการรับเข้าหลายรอบ (ใบรับย่อย) */
  receipts?: TransferReceipt[];
  /** ผลต่าง (ขาด/เกิน/ชำรุด/หาย/ผิด SN) + ผู้รับผิดชอบ + สถานะปิดเรื่อง */
  discrepancies?: TransferDiscrepancy[];
  /** การปฏิเสธรับ → ส่งคืน (อ้างอิงใบนี้) */
  returns?: TransferReturn[];
  /** ใบนี้สร้างเพื่อ "ส่งทดแทน" SN ที่ขาด/ส่งผิด (เชื่อมเคสเดิม) */
  replacement_of?: { transfer_no: string; disc_id?: string | null; serialNo?: string | null } | null;
  note?: string | null;
  created_at: string;
  /** concurrency — เพิ่มทุกการเขียน */
  version?: number;
  /** สถานะซิงค์กับ OneWarehouse/JST */
  sync_state?: "pending" | "synced" | "failed";
  /** OneWarehouse เป็นตัวจริง (ต้นทาง+ปลายทางผูกคลัง OW) — 1 สินค้า = 1 ใบ OW */
  ow_owned?: boolean;
  /** SKU → OW transfer id (JST 1 SKU/ใบ) */
  ow_ids?: Record<string, string>;
  /** สถานะฝั่ง OW ล่าสุดต่อใบ OW (status/version/syncState/jstAllocationNo/orderNo) */
  ow_state?: Record<string, { ow_id: string; status: string; version: number; syncState: string | null; jstAllocationNo: string | null; orderNo: string }>;
  /** ข้อผิดพลาดล่าสุดจาก OW (ถ้ามี) */
  ow_error?: string | null;
  /** สถานะการเชื่อม OW (แยกจากสถานะธุรกิจ): ok | creating | partially_created | recovery_required | checking */
  ow_link_state?: string;
  jst_allocation_no?: string | null;
  carrier?: string | null;
  tracking?: string | null;
  shipping_cost?: number | null;
  /** ผู้สแกนของออก (แพ็กครบ) + เวลา */
  packed_by?: string | null;
  packed_at?: string | null;
  /** ผู้รับเข้าครบ (ปลายทาง) + เวลา */
  received_by?: string | null;
  received_at?: string | null;
  /** ผู้ส่งมอบสินค้าให้ขนส่ง/ออกจากคลังจริง + เวลา (จุด On Hand → OTWO) */
  shipped_by?: string | null;
  shipped_at?: string | null;
  /** ประสานขนส่งก่อนส่งมอบ (ตอน packed ยังไม่ตัดยอด): called=เรียกรถแล้ว · arrived=รถมารับ/รอส่งมอบ */
  pickup_stage?: "called" | "arrived" | null;
  /** สถานะขนส่งย่อย (ระหว่าง in_transit): เรียกรถ → รถรับของ → กำลังส่ง → ถึงปลายทาง */
  ship_stage?: "requested" | "picked_up" | "in_delivery" | "arrived" | null;
  expected_date?: string | null;
  reference_no?: string | null;
  priority?: "normal" | "high" | null;
  /** ไฟล์/รูปแนบ (รูปสินค้า, เอกสาร) — ไม่จำกัดจำนวน */
  attachments?: TransferAttachment[];
}

/** ไฟล์แนบในใบโอนย้าย (รูป/เอกสาร) — เก็บ data URL ในโหมด demo */
export interface TransferAttachment {
  id: string;
  name: string;
  type: string;       // MIME
  url: string;        // data URL (หรือ URL จริงเมื่อต่อ storage)
  size: number;
  at: string;
  by?: string | null;
  /** สถานะใบตอนที่แนบไฟล์ — ใช้บอกว่า "มาจากฟอร์ม/ขั้นตอนไหน" */
  stage?: TransferStatus | null;
}

/** การปฏิเสธรับ + ส่งคืน (อ้างอิงใบโอนเดิม) — ปฏิเสธ → ส่งคืน → ต้นทางรับคืน
 *  บัญชี: ของที่ปฏิเสธคงเป็น OTWO+Reserved ของต้นทางตลอดทางกลับ (ไม่เครดิตจนต้นทางรับจริง) */
/** วงจรใบส่งคืน 7 ขั้น + ยกเลิก */
export type RtnStatus = "draft" | "pending_approval" | "approved" | "preparing" | "returning" | "partial_received" | "received" | "closed" | "cancelled";
export type RtnReason = "damaged" | "wrong_sn" | "wrong_item" | "other";
/** ส่งคืนต้นทาง / ส่งซ่อม */
export type RtnOutcome = "return_source" | "repair";
/** สถานะขนส่งขาส่งคืน */
export type RtnShipStage = "called" | "picked_up" | "handed";
export interface RtnLine {
  product_id: string;
  qty: number;
  sns_expected?: string[];   // SN ที่คาดว่าจะส่งคืน (ของเดิม)
  sns_found?: string[];      // SN ที่สแกนจริงตอน "แพ็ค/ส่งคืน" (ขาส่ง) — เก็บทั้งคู่ ห้ามเขียนทับ
  sns_received_back?: string[]; // SN ที่ต้นทาง "สแกนรับคืน" จริง (ขารับ) — แยกจากขาส่ง
  qty_received?: number;     // ต้นทางรับคืนจริงกี่ชิ้น (คืนบางส่วน)
  close_outcome?: "release" | "repair" | "dispose" | null;  // ผลตรวจสภาพที่ต้นทาง
}
/** ใบส่งคืน — เอกสารแยกแต่ฝังในใบโอนเดิม เชื่อมกับผลต่างการรับ */
export interface TransferReturn {
  id: string;
  return_no?: string;                 // RT-YYMMDD-XXXX
  disc_ids?: string[];                // ผลต่างที่เป็นต้นเหตุ
  reason_kind?: RtnReason;
  reason?: string | null;
  outcome?: RtnOutcome;            // return_source | repair
  lines?: RtnLine[];               // คืนได้หลายชิ้น/บางส่วน
  photos?: string[];
  status: RtnStatus | "rejected";  // "rejected" = ข้อมูลเก่า (back-compat)
  carrier?: string | null;
  tracking?: string | null;
  ship_stage?: RtnShipStage | null;
  created_by?: string | null; created_at?: string;
  requested_by?: string | null; requested_at?: string | null;
  approved_by?: string | null; approved_at?: string | null;
  shipped_by?: string | null; shipped_at?: string | null;
  closed_by?: string | null; closed_at?: string | null;
  // ── ฟิลด์เก่า (ข้อมูลที่สร้างก่อนเวอร์ชันใบส่งคืน) ──
  product_id?: string; qty?: number; serials?: string[];
  by?: string | null; at?: string;
  returned_by?: string | null; returned_at?: string | null;
  received_by?: string | null; received_at?: string | null;
}

/** ใบรับย่อยหนึ่งรอบ (รับหลายรอบต่อ 1 ใบโอน) */
export interface TransferReceipt {
  id: string;
  at: string;
  by?: string | null;
  note?: string | null;
  lines: { product_id: string; qty: number; serials?: string[] }[];
}

//  short=ขาด(SN ที่ส่งมาแต่ไม่พบ) · over=เกินจำนวน · damaged=ชำรุด · lost=ยืนยันสูญหาย
//  wrong_sn=SN ผิด(ของเดิม) · unexpected_sn=พบ SN นอกใบโอน(ไม่ได้ส่งมา) → พักตรวจ
export type DiscrepancyKind = "short" | "over" | "damaged" | "lost" | "wrong_sn" | "unexpected_sn";
/** ผลตรวจที่อยู่ของ SN ในระบบ ณ เวลาที่รายงาน — กัน SN เดียวอยู่สองสาขา */
export interface SerialLocated { where: "in_stock" | "in_transit" | "sold" | "unknown"; branchId?: string | null; refNo?: string | null }
/** เส้นทางปิดเคสราย SN:
 *  unexpected: accept=ยอมรับที่ปลายทาง · return_source=ส่งคืน · dispose=ตัดทิ้ง
 *  missing(short): found_source=พบที่ต้นทาง · tracking=ติดตามต่อ · confirmed_lost=ยืนยันสูญหาย · replaced=ส่งทดแทนแล้ว */
export type SerialOutcome = "accept" | "return_source" | "dispose" | "found_source" | "tracking" | "confirmed_lost" | "replaced";
/** ผลต่าง 1 รายการ — มีผู้รับผิดชอบ + ขั้นปิดเรื่อง */
export interface TransferDiscrepancy {
  id: string;
  product_id: string;
  kind: DiscrepancyKind;
  qty: number;
  serialNo?: string | null;
  /** ผลตรวจที่มาของ SN ตอนรับเข้า (unexpected_sn) — โชว์ว่า SN นี้รู้จักในระบบไหม อยู่ไหน */
  located?: SerialLocated | null;
  /** เส้นทาง/ผลสรุปปิดเคสราย SN */
  sn_outcome?: SerialOutcome | null;
  /** ใบส่งทดแทนที่สร้างจากเคสนี้ (SN ขาด) */
  replacement_no?: string | null;
  /** เลขใบส่งคืนที่กำลังจัดการเคสนี้ (status=handling) — ปิดจริงเมื่อใบคืนปิดงาน */
  handled_by_return?: string | null;
  note?: string | null;
  responsible_by?: string | null;   // ผู้รับผิดชอบ
  /** วงจรผลต่าง: open=รอตรวจสอบ · handling=กำลังจัดการด้วยใบส่งคืน · pending_approval=รออนุมัติปิด · resolved=แก้ไขแล้ว */
  status: "open" | "handling" | "pending_approval" | "resolved";
  /** ผู้ขออนุมัติปิด (open → pending_approval) + เวลา + เหตุผล/วิธีจัดการ */
  requested_by?: string | null;
  requested_at?: string | null;
  resolution_note?: string | null;  // เหตุผล/วิธีจัดการยอด ตอนขอปิด
  resolved_by?: string | null;
  resolved_at?: string | null;
  at: string;
  by?: string | null;               // ผู้บันทึก
}

export interface ReturnDoc {
  id: string;
  /** uuid กันซ้ำ + อ้างอิงข้ามเครื่อง */
  client_uuid?: string;
  return_no: string;
  order_id?: string | null;
  order_no?: string | null;
  /** client_uuid ของบิลต้นทาง — ให้ server resolve order ข้ามเครื่องได้ */
  order_client_uuid?: string | null;
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

/** การเปลี่ยนแปลงรายฟิลด์ (เก็บใน after_data.changes ของ activity log) */
export interface FieldChange {
  field: string;
  label?: string;
  before?: unknown;
  after?: unknown;
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
  tier?: string | null;
  source?: string | null;
  note?: string | null;
}

// =====================================================================
// Stock Count Sessions (Phase 6) — นับสต๊อกแบบมีรอบ + workflow
// =====================================================================
//  opening = นับสต๊อกเปิดระบบ (เริ่มใช้งานจริง) — รวมทุกสินค้า ตั้งยอดตั้งต้นจากของจริงหน้าร้าน
export type CountType = "full" | "cycle" | "category" | "brand" | "random" | "serial" | "opening";
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
