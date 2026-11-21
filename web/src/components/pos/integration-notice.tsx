"use client";
import { ShieldCheck, Link2 } from "lucide-react";
import { isLiveMode } from "@/lib/supabase/client";
export function IntegrationNotice({
  kind,
}: {
  kind: "transfer" | "return" | "receipt";
}) {
  if (!isLiveMode()) return null;
  const copy = {
    transfer:
      "การโอนจริงต้องเชื่อมใบส่งและเหตุการณ์ SN กับ OneWarehouse ก่อน ระบบยังไม่อนุญาตเปลี่ยนยอดเฉพาะในเครื่อง",
    return:
      "การคืนเงินจริงต้องตรวจผลรับชำระและอนุมัติส่วนกลางก่อน การกดบันทึกในหน้าร้านจะไม่ถูกถือว่าธนาคารคืนเงินแล้ว",
    receipt:
      "รับเข้าจริงต้องอ้างใบส่งจาก OneWarehouse และสแกนเทียบสินค้าที่ส่งมา ขณะนี้ยังรอ API รายการรอรับ",
  };
  return (
    <div
      role="status"
      className="mx-4 my-3 sm:mx-6 rounded-xl border border-brand/20 bg-brand/5 p-4 flex gap-3"
    >
      <span className="h-9 w-9 shrink-0 grid place-items-center rounded-lg bg-brand/10 text-brand">
        <Link2 size={18} />
      </span>
      <div>
        <p className="text-xs font-semibold text-brand flex gap-1.5 items-center">
          <ShieldCheck size={13} />
          สถานะการเชื่อมระบบจริง
        </p>
        <p className="text-xs leading-relaxed text-muted mt-1">{copy[kind]}</p>
      </div>
    </div>
  );
}
