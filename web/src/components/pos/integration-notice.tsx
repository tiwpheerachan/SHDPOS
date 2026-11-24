"use client";
// แถบสถานะการเชื่อมระบบจริง — บอกตามจริงของ "สาขาที่เลือก" ว่าผูก OneWarehouse แล้วหรือยัง
import { useEffect, useState } from "react";
import { ShieldCheck, Link2, AlertTriangle } from "lucide-react";
import { isLiveMode } from "@/lib/supabase/client";
import { useSession } from "@/lib/store/session";
import { owLinks } from "@/lib/onewarehouse/live";

type Kind = "transfer" | "return" | "receipt" | "stock";
type Link = "loading" | "linked" | "unlinked" | "error";

const COPY: Record<Kind, Record<Exclude<Link, "loading">, string>> = {
  transfer: {
    linked: "สาขานี้เชื่อมคลัง OneWarehouse แล้ว — ใบโอนไปยังสาขาที่เชื่อมแล้วจะส่งเข้า OneWarehouse/JST จริงทุกขั้น (อนุมัติ · สแกนออก · ส่ง · รับเข้า) และปรับสต๊อก/SN ตามผลจริง",
    unlinked: "สาขานี้ยังไม่ผูกคลัง OneWarehouse — ใบโอนจริงต้องให้แอดมินผูกสาขาในหน้า คลังกลาง › ผูกสาขา ก่อน",
    error: "ตรวจสถานะการเชื่อม OneWarehouse ไม่ได้ — กรุณาลองใหม่ก่อนทำใบโอน",
  },
  receipt: {
    linked: "สาขานี้เชื่อมคลัง OneWarehouse แล้ว — ใบที่คลังกลางส่งมาจะขึ้นในรายการ \"รอรับเข้า\" ให้สแกนรับตามจริง",
    unlinked: "สาขานี้ยังไม่ผูกคลัง OneWarehouse — ยังไม่มีใบส่งจากคลังกลางให้รับเข้า",
    error: "ตรวจสถานะการเชื่อม OneWarehouse ไม่ได้ — กรุณาลองใหม่",
  },
  stock: {
    linked: "สาขานี้ใช้สต๊อกจากคลังกลาง OneWarehouse — ปรับ/นับ/รับสต๊อกต้องทำใน OneWarehouse (JST) แล้วให้แอดมินกด \"ปรับยอดจาก OW\" (หน้า คลังกลาง › ผูกสาขา) ระบบนี้จึงปิดการแก้ยอดในเครื่อง เพื่อให้ยอดตรงกับ JST เสมอ",
    unlinked: "สาขานี้ยังไม่ผูกคลังกลาง — ปรับ/นับสต๊อกในระบบนี้ได้ตามปกติ",
    error: "ตรวจสถานะการเชื่อม OneWarehouse ไม่ได้ — กรุณาลองใหม่ก่อนแก้สต๊อก",
  },
  return: {
    linked: "การคืนเงินจริงต้องตรวจผลรับชำระและอนุมัติส่วนกลางก่อน การกดบันทึกในหน้าร้านจะไม่ถูกถือว่าธนาคารคืนเงินแล้ว",
    unlinked: "การคืนเงินจริงต้องตรวจผลรับชำระและอนุมัติส่วนกลางก่อน การกดบันทึกในหน้าร้านจะไม่ถูกถือว่าธนาคารคืนเงินแล้ว",
    error: "การคืนเงินจริงต้องตรวจผลรับชำระและอนุมัติส่วนกลางก่อน",
  },
};

/** สถานะการผูกคลังกลางของสาขาที่เลือก: loading | linked | unlinked | error */
export function useOwBranchLink(): Link {
  const branchId = useSession((s) => s.branchId);
  const [link, setLink] = useState<Link>("loading");
  useEffect(() => {
    let alive = true;
    if (!isLiveMode()) return;
    void owLinks().then((l) => {
      if (!alive) return;
      if (l.status === "error") setLink("error");
      else setLink(l.configured && branchId && l.links[branchId] ? "linked" : "unlinked");
    });
    return () => { alive = false; };
  }, [branchId]);
  return isLiveMode() ? link : "unlinked";
}

export function IntegrationNotice({ kind }: { kind: Kind }) {
  const link = useOwBranchLink();
  if (!isLiveMode() || link === "loading") return null;
  // stock: ผูกแล้ว = ล็อกการแก้ยอด (แสดงสีเตือน) · อื่น ๆ: ผูกแล้ว = ปกติ
  const ok = kind === "stock" ? link === "unlinked" : link === "linked" || kind === "return";
  return (
    <div role="status" className={`mx-4 my-3 sm:mx-6 rounded-xl border p-4 flex gap-3 ${ok ? "border-brand/20 bg-brand/5" : "border-warn/30 bg-warn/5"}`}>
      <span className={`h-9 w-9 shrink-0 grid place-items-center rounded-lg ${ok ? "bg-brand/10 text-brand" : "bg-warn/10 text-warn"}`}>
        {ok ? <Link2 size={18} /> : <AlertTriangle size={18} />}
      </span>
      <div>
        <p className={`text-xs font-semibold flex gap-1.5 items-center ${ok ? "text-brand" : "text-warn"}`}>
          <ShieldCheck size={13} />
          {kind === "stock" && link === "linked" ? "สต๊อกจัดการที่คลังกลาง" : link === "linked" && kind !== "return" ? "เชื่อม OneWarehouse แล้ว" : "สถานะการเชื่อมระบบจริง"}
        </p>
        <p className="text-xs leading-relaxed text-muted mt-1">{COPY[kind][link]}</p>
      </div>
    </div>
  );
}
