// สาขานี้ใช้สต๊อกจาก OneWarehouse หรือไม่ (ผูกคลังใน pos_warehouse_links)
//   ผูกแล้ว = OW เป็นตัวจริงของสต๊อก → ห้ามปรับ/นับ/รับเข้าแบบแก้ยอดใน POS ตรง ๆ (ยอดจะไม่ตรงกับ OW/JST)
//   อ่านการผูกไม่ได้ → โยน error (ไม่เดาว่า "ไม่ผูก")
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "./ow-gateway";
import { PosError } from "./pos-context";

export async function owWarehouseOf(branchId: string): Promise<string | null> {
  let source: string;
  try { source = owConfig().source; } catch { return null; } // ยังไม่ตั้งค่า OW → ไม่มีสาขาผูก
  const { data, error } = await supabaseAdmin().from("pos_warehouse_links").select("warehouse_id").eq("source", source).eq("branch_id", branchId).maybeSingle();
  if (error) throw new PosError("ตรวจการผูกคลังกลางไม่สำเร็จ กรุณาลองใหม่", 503);
  return (data?.warehouse_id as string | undefined) ?? null;
}

export const OW_STOCK_LOCKED_MSG =
  "สาขานี้ใช้สต๊อกจากคลังกลาง OneWarehouse — การปรับ/นับ/รับสต๊อกต้องทำใน OneWarehouse (JST) แล้วให้แอดมินกด \"ปรับยอดจาก OW\" ในหน้า คลังกลาง › ผูกสาขา เพื่อไม่ให้ยอดในระบบเราไม่ตรงกับ JST";

/** โยน 409 ถ้าสาขาผูกคลังกลาง */
export async function assertNotOwStockBranch(branchId: string): Promise<void> {
  if (await owWarehouseOf(branchId)) throw new PosError(OW_STOCK_LOCKED_MSG, 409);
}
