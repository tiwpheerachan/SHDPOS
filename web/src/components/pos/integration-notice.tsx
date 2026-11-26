"use client";
// แถบสถานะการเชื่อมระบบจริง — บอกตามจริงของ "สาขาที่เลือก" ว่าผูก OneWarehouse แล้วหรือยัง
import { useEffect, useState } from "react";
import { ShieldCheck, Link2, AlertTriangle } from "lucide-react";
import { isLiveMode } from "@/lib/supabase/client";
import { useSession } from "@/lib/store/session";
import { owLinks } from "@/lib/onewarehouse/live";
import { tr } from "@/lib/i18n/tr";
import { useL } from "@/lib/i18n/provider";

type Kind = "transfer" | "return" | "receipt" | "stock";
type Link = "loading" | "linked" | "unlinked" | "error";

const COPY = (): Record<Kind, Record<Exclude<Link, "loading">, string>> => ({
  transfer: {
    linked: tr("สาขานี้เชื่อมคลัง OneWarehouse แล้ว — ใบโอนไปยังสาขาที่เชื่อมแล้วจะส่งเข้า OneWarehouse/JST จริงทุกขั้น (อนุมัติ · สแกนออก · ส่ง · รับเข้า) และปรับสต๊อก/SN ตามผลจริง", "This branch is linked to OneWarehouse — transfers to linked branches go to OneWarehouse/JST at every step (approve · scan out · ship · receive) and stock/SN follow actual results", "本门店已连接 OneWarehouse — 发往已连接门店的调拨单每一步（审批 · 扫描出库 · 发货 · 入库）都会真实提交到 OneWarehouse/JST，并按实际结果调整库存/SN"),
    unlinked: tr("สาขานี้ยังไม่ผูกคลัง OneWarehouse — ใบโอนจริงต้องให้แอดมินผูกสาขาในหน้า คลังกลาง › ผูกสาขา ก่อน", "This branch is not linked to OneWarehouse — an admin must link it under Central warehouse › Link branches before real transfers", "本门店尚未绑定 OneWarehouse — 正式调拨前需管理员在 中央仓 › 绑定门店 中绑定"),
    error: tr("ตรวจสถานะการเชื่อม OneWarehouse ไม่ได้ — กรุณาลองใหม่ก่อนทำใบโอน", "Could not check OneWarehouse link — please retry before transferring", "无法检查 OneWarehouse 连接状态 — 请重试后再调拨"),
  },
  receipt: {
    linked: tr("สาขานี้เชื่อมคลัง OneWarehouse แล้ว — ใบที่คลังกลางส่งมาจะขึ้นในรายการ \"รอรับเข้า\" ให้สแกนรับตามจริง", "This branch is linked to OneWarehouse — shipments from the central warehouse appear under \"Awaiting receipt\" for scanning", "本门店已连接 OneWarehouse — 中央仓发来的单据会显示在“待入库”中，请按实际扫描入库"),
    unlinked: tr("สาขานี้ยังไม่ผูกคลัง OneWarehouse — ยังไม่มีใบส่งจากคลังกลางให้รับเข้า", "This branch is not linked to OneWarehouse — no central shipments to receive", "本门店尚未绑定 OneWarehouse — 暂无中央仓发货单可入库"),
    error: tr("ตรวจสถานะการเชื่อม OneWarehouse ไม่ได้ — กรุณาลองใหม่", "Could not check OneWarehouse link — please retry", "无法检查 OneWarehouse 连接状态 — 请重试"),
  },
  stock: {
    linked: tr("สาขานี้ใช้สต๊อกจากคลังกลาง OneWarehouse — ปรับ/นับ/รับสต๊อกต้องทำใน OneWarehouse (JST) แล้วให้แอดมินกด \"ปรับยอดจาก OW\" (หน้า คลังกลาง › ผูกสาขา) ระบบนี้จึงปิดการแก้ยอดในเครื่อง เพื่อให้ยอดตรงกับ JST เสมอ", "This branch uses OneWarehouse central stock — adjust/count/receive in OneWarehouse (JST), then an admin clicks \"Sync from OW\" (Central warehouse › Link branches). Local stock edits are disabled so totals always match JST", "本门店使用 OneWarehouse 中央仓库存 — 调整/盘点/入库需在 OneWarehouse (JST) 中操作，再由管理员点击“从 OW 同步”（中央仓 › 绑定门店）。本系统已关闭本地修改库存，以确保与 JST 一致"),
    unlinked: tr("สาขานี้ยังไม่ผูกคลังกลาง — ปรับ/นับสต๊อกในระบบนี้ได้ตามปกติ", "This branch is not linked to the central warehouse — adjust/count stock here as usual", "本门店尚未绑定中央仓 — 可在本系统正常调整/盘点库存"),
    error: tr("ตรวจสถานะการเชื่อม OneWarehouse ไม่ได้ — กรุณาลองใหม่ก่อนแก้สต๊อก", "Could not check OneWarehouse link — please retry before editing stock", "无法检查 OneWarehouse 连接状态 — 请重试后再修改库存"),
  },
  return: {
    linked: tr("สาขานี้ผูกคลังกลาง: บิลที่เข้า JST แล้ว สินค้าคืนจะยังไม่กลับเข้าสต๊อกขายจนทีมคลังกลางทำรับคืนใน JST (ระบบสร้างงานให้อัตโนมัติ) · ยอดคืนเงินคิดจากบิลจริง ระบบไม่ได้โอนเงินให้ — ต้องคืนเงินตามช่องทางเอง", "This branch is linked to the central warehouse: for bills already in JST, returned goods won't go back to sellable stock until the warehouse team receives the return in JST (a task is created automatically) · Refund is calculated from the real bill; the system does not transfer money — refund via the original channel yourself", "本门店已绑定中央仓：已进入 JST 的单据，退货在中央仓团队于 JST 完成退货入库前不会回到可售库存（系统自动创建任务）· 退款金额按实际单据计算，系统不会代为转账 — 需自行按渠道退款"),
    unlinked: tr("ยอดคืนเงินคิดจากบิลจริงโดยระบบกลาง และต้องให้ผู้มีสิทธิ์อนุมัติ · ระบบไม่ได้โอนเงินให้ — ต้องคืนเงินตามช่องทางเอง", "Refund is calculated from the real bill by the central system and needs authorised approval · The system does not transfer money — refund via the original channel yourself", "退款金额由中央系统按实际单据计算，并需有权限者审批 · 系统不会代为转账 — 需自行按渠道退款"),
    error: tr("การคืนเงินจริงต้องตรวจผลรับชำระและอนุมัติส่วนกลางก่อน", "Real refunds require payment verification and central approval first", "正式退款需先核查收款结果并经中央审批"),
  },
});

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
  const L = useL();
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
          {kind === "stock" && link === "linked" ? L("สต๊อกจัดการที่คลังกลาง", "Stock managed by central warehouse", "库存由中央仓管理") : link === "linked" && kind !== "return" ? L("เชื่อม OneWarehouse แล้ว", "Linked to OneWarehouse", "已连接 OneWarehouse") : L("สถานะการเชื่อมระบบจริง", "Live integration status", "正式系统连接状态")}
        </p>
        <p className="text-xs leading-relaxed text-muted mt-1">{COPY()[kind][link]}</p>
      </div>
    </div>
  );
}
