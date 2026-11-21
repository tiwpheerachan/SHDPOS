import type { PermissionKey } from "@/lib/permissions";
export const OPERATION_POLICY: Record<
  string,
  { permission: PermissionKey; rpc?: string; table?: string }
> = {
  audit: { permission: "inventory.view", rpc: "sync_audit" },
  open_shift: { permission: "shift.open", rpc: "sync_open_shift" },
  close_shift: { permission: "shift.close", rpc: "close_shift" },
  void_order: { permission: "pos.void", rpc: "pos_void_order" },
  create_return: { permission: "return.create", rpc: "sync_return" },
  create_customer: {
    permission: "customer.manage",
    rpc: "pos_customer_upsert",
  },
  redeem_points: { permission: "pos.sell", rpc: "pos_redeem_points" },
  redeem_coupon: { permission: "pos.sell", rpc: "pos_redeem_coupon" },
  create_quotation: { permission: "pos.quotation", table: "quotations" },
};
