"use client";
// ปิดงวดบัญชี (รายเดือน รายสาขา) — UAT F070 · สรุปยอดขายสุทธิ F068 · สมการสต๊อก F064
//   ปิดแล้ว: บันทึกย้อนหลังเข้างวดไม่ได้ · เปิดใหม่ต้องมีสิทธิ์แยก + เหตุผล · ปิดแต่ละครั้งเก็บรายงานเป็น version
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Lock, LockOpen, CheckCircle2, AlertTriangle, FileDown, History, Loader2, Boxes, Wallet, RotateCcw, FileMinus, Ban } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";
import { useToast } from "@/components/toast-host";
import { Button, Badge, Modal, Field, Input, Select, Skeleton } from "@/components/ui";
import { downloadExcel } from "@/lib/export";

type Summary = {
  sales: { bills: number; gross: number; vat: number }; voids: { bills: number; amount: number }; returns: { count: number; amount: number };
  credit_notes: { discount_count: number; discount_amount: number; return_linked_count: number; return_linked_amount: number };
  net_sales: number; net_vat: number; payments: Record<string, number>; cash_movements: Record<string, number>;
  stock: { opening: number; movement: number; closing: number; by_type: Record<string, number>; skus_out_of_balance: number };
  open_items: Record<string, number>; generated_at: string;
};
type Period = { period: string; status: "open" | "closed"; version: number; ended: boolean; closed_by?: string | null; closed_at?: string | null; reopened_by?: string | null; reopened_at?: string | null; reopen_reason?: string | null };
type Data = { branches: { id: string; code: string; name: string; name_th: string | null }[]; branch_id: string; period: string; can_close: boolean; can_reopen: boolean; names: Record<string, string>;
  periods: Period[]; current: Period; live: Summary; versions: { version: number; summary: Summary; closed_by: string | null; closed_at: string; note: string | null }[] };

const baht = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH");
const METHOD = (): Record<string, string> => ({ cash: tr("เงินสด", "Cash", "现金"), credit_card: tr("บัตรเครดิต", "Credit card", "信用卡"), debit_card: tr("บัตรเดบิต", "Debit card", "借记卡"), qr_promptpay: tr("พร้อมเพย์", "PromptPay", "PromptPay"), bank_transfer: tr("โอนเงิน", "Bank transfer", "银行转账"), edc: "EDC", gift_card: tr("บัตรของขวัญ", "Gift card", "礼品卡"), store_credit: tr("เครดิตร้าน", "Store credit", "店铺储值"), installment: tr("ผ่อน", "Installment", "分期"), online_marketplace: tr("มาร์เก็ตเพลส", "Marketplace", "电商平台"), other: tr("อื่น ๆ", "Other", "其他") });
const MOVE = (): Record<string, string> => ({ sale: tr("ขาย", "Sale", "销售"), return: tr("รับคืน", "Return", "退货"), exchange_in: tr("เปลี่ยน (เข้า)", "Exchange (in)", "换货（入）"), exchange_out: tr("เปลี่ยน (ออก)", "Exchange (out)", "换货（出）"), receive: tr("รับเข้า", "Receive", "入库"), transfer_out: tr("โอนออก", "Transfer out", "调出"), transfer_in: tr("โอนเข้า", "Transfer in", "调入"), count_adjust: tr("ปรับจากการนับ", "Count adjustment", "盘点调整"), damage: tr("ของเสีย", "Damaged", "损坏"), claim_out: tr("ส่งเคลม/คืนผู้ขาย", "Claim/return to vendor", "送修/退供应商"), claim_in: tr("รับเคลมกลับ", "Claim returned", "保修返回"), manual_adjust: tr("ปรับมือ", "Manual adjustment", "手动调整"), opening: tr("ยอดยกมา", "Opening balance", "期初结转") });
const CASH = (): Record<string, string> => ({ cash_in: tr("นำเงินเข้า", "Cash in", "存入现金"), cash_out: tr("นำเงินออก/คืนเงิน", "Cash out / refund", "取出现金/退款"), drop: tr("ฝากเงิน", "Cash drop", "存款"), pickup: tr("เบิกเงิน", "Cash pickup", "提款"), open_no_sale: tr("เปิดลิ้นชัก", "Drawer opened", "打开钱箱"), adjust: tr("ปรับยอด", "Adjustment", "调整") });
const OPEN = (): Record<string, string> => ({ open_shifts: tr("กะที่ยังไม่ปิด", "Open shifts", "未关闭班次"), pending_returns: tr("คำขอคืน/ยกเลิกบิลที่รออนุมัติ", "Return/void requests awaiting approval", "待审批的退货/作废申请"), pending_deferred_sales: tr("บิลค้างส่งที่ยังไม่ลงบัญชี", "Deferred-delivery bills not yet posted", "未入账的待发货单据"), open_counts: tr("รอบนับสต๊อกที่ยังไม่ปิด", "Open stock counts", "未关闭的盘点") });

export default function PeriodsPage() {
  const { locale } = useI18n();
  const L = useI18n().L;
  const toast = useToast();
  const METHODL = METHOD(), MOVEL = MOVE(), CASHL = CASH(), OPENL = OPEN();
  const monthLabel = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US", { month: "long", year: "numeric" }); };
  const when = (s?: string | null) => (s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState("");
  const [branch, setBranch] = useState(""), [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false), [closeOpen, setCloseOpen] = useState(false), [reopenOpen, setReopenOpen] = useState(false), [text, setText] = useState(""), [viewV, setViewV] = useState<number | null>(null);

  const load = useCallback(async (b?: string, p?: string) => {
    const q = new URLSearchParams(); if (b) q.set("branch_id", b); if (p) q.set("period", p);
    try {
      const r = await fetch(`/api/admin/periods?${q}`, { cache: "no-store" }); const j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j); setBranch(j.branch_id); setPeriod(j.period); setErr(""); setViewV(null);
    } catch (e) { setErr(e instanceof Error ? e.message : L("โหลดไม่สำเร็จ", "Failed to load", "加载失败")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(action: "close" | "reopen") {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, branch_id: branch, period, note: text, reason: text }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: action === "close" ? L(`ปิดงวด ${monthLabel(period)} แล้ว (version ${j.version})`, `Closed ${monthLabel(period)} (version ${j.version})`, `${monthLabel(period)} 已结账（version ${j.version}）`) : L(`เปิดงวด ${monthLabel(period)} แล้ว — บันทึกย้อนหลังได้จนกว่าจะปิดอีกครั้ง`, `Reopened ${monthLabel(period)} — backdated entries allowed until closed again`, `${monthLabel(period)} 已重新开启 — 再次结账前可补录`) });
      setCloseOpen(false); setReopenOpen(false); setText(""); await load(branch, period);
    } catch (e) { toast.push({ tone: "danger", title: action === "close" ? L("ปิดงวดไม่สำเร็จ", "Failed to close period", "结账失败") : L("เปิดงวดไม่สำเร็จ", "Failed to reopen period", "重新开启失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  const shown: Summary | null = useMemo(() => (viewV ? data?.versions.find((v) => v.version === viewV)?.summary ?? null : data?.live ?? null), [data, viewV]);
  const lastSnap = data?.versions[0]?.summary;
  const drift = data && lastSnap && data.current.status === "open" && data.current.version > 0 ? Number(data.live.net_sales) - Number(lastSnap.net_sales) : 0;
  const openCount = shown ? Object.values(shown.open_items).reduce((a, b) => a + Number(b), 0) : 0;
  const cur = data?.current;
  const curEnded = data?.periods.find((p) => p.period === period)?.ended ?? true;

  function exportXls() {
    if (!shown || !data) return;
    const b = data.branches.find((x) => x.id === branch);
    const rows: { k: string; v: string | number }[] = [
      { k: L("สาขา", "Branch", "门店"), v: `${b?.code ?? ""} ${b?.name_th ?? b?.name ?? ""}` }, { k: L("งวด", "Period", "期间"), v: monthLabel(period) }, { k: L("สถานะ", "Status", "状态"), v: cur?.status === "closed" ? `${L("ปิดแล้ว", "Closed", "已结账")} v${cur.version}` : L("เปิด", "Open", "开启") },
      { k: L("รายงาน", "Report", "报告"), v: viewV ? `snapshot version ${viewV}` : `${L("ยอดสด ณ", "Live as of", "实时数据截至")} ${when(shown.generated_at)}` },
      { k: L("บิลขาย (ไม่รวมยกเลิก)", "Sales bills (excl. voids)", "销售单据（不含作废）"), v: shown.sales.bills }, { k: L("ยอดขายรวม", "Gross sales", "销售总额"), v: Number(shown.sales.gross) },
      { k: L("หัก คืนเงินจากการรับคืน", "Less: refunds from returns", "减：退货退款"), v: -Number(shown.returns.amount) }, { k: L("หัก ใบลดหนี้ส่วนลด", "Less: discount credit notes", "减：折扣贷项单"), v: -Number(shown.credit_notes.discount_amount) },
      { k: L("ยอดขายสุทธิ", "Net sales", "销售净额"), v: Number(shown.net_sales) }, { k: L("ภาษีขายสุทธิ", "Net output VAT", "销项税净额"), v: Number(shown.net_vat) },
      { k: L("บิลยกเลิก (แยก ไม่นับในยอดขาย)", "Voided bills (separate, not in sales)", "作废单据（单列，不计入销售）"), v: `${shown.voids.bills} ${L("บิล", "bills", "单")} · ${baht(shown.voids.amount)}` },
      { k: L("ใบลดหนี้จากการรับคืน (อ้างอิง ไม่หักซ้ำ)", "Return credit notes (reference, not deducted twice)", "退货贷项单（仅供参考，不重复扣减）"), v: Number(shown.credit_notes.return_linked_amount) },
      ...Object.entries(shown.payments).map(([m, v]) => ({ k: `${L("รับชำระ", "Payment", "收款")}: ${METHODL[m] ?? m}`, v: Number(v) })),
      { k: L("สต๊อกยกมา (ชิ้น)", "Opening stock (units)", "期初库存（件）"), v: Number(shown.stock.opening) }, ...Object.entries(shown.stock.by_type).map(([t, v]) => ({ k: `${L("สต๊อก", "Stock", "库存")}: ${MOVEL[t] ?? t}`, v: Number(v) })),
      { k: L("สต๊อกคงเหลือ (ชิ้น)", "Closing stock (units)", "期末库存（件）"), v: Number(shown.stock.closing) },
    ];
    downloadExcel(`period-${b?.code ?? "branch"}-${period}${viewV ? `-v${viewV}` : ""}.xls`, [{ key: "k", label: L("รายการ", "Item", "项目") }, { key: "v", label: L("ค่า", "Value", "数值") }], rows, `${L("สรุปงวด", "Period summary", "期间汇总")} ${monthLabel(period)}`);
  }

  if (err) return <div className="p-4 sm:p-6"><p className="rounded-xl bg-danger/8 text-danger text-sm px-4 py-3">{err}</p></div>;
  if (!data || !shown) return <div className="p-4 sm:p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center"><CalendarCheck size={19} /></span>
          <div><h1 className="text-lg font-semibold">{L("ปิดงวดบัญชี", "Period close", "会计期间结账")}</h1><p className="text-xs text-muted">{L("ปิดแล้วบันทึกย้อนหลังเข้างวดไม่ได้ · รายการคืน/ลดหนี้วันนี้ลงงวดปัจจุบัน · ทุกครั้งที่ปิดเก็บรายงานเป็น version", "Once closed, no backdated entries · today’s returns/credit notes go to the current period · each close saves a report version", "结账后不能补录 · 今日退货/贷项单计入当前期间 · 每次结账保存一个报告 version")}</p></div>
        </div>
        <div className="ml-auto w-full sm:w-72">
          <Select value={branch} onChange={(e) => void load(e.target.value, period)}>
            {data.branches.map((b) => <option key={b.id} value={b.id} translate="no">{b.code} · {b.name_th ?? b.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-5 items-start">
        {/* รายการงวด */}
        <div className="card p-2 space-y-1">
          {data.periods.map((p) => (
            <button key={p.period} onClick={() => void load(branch, p.period)} className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-2.5 transition ${p.period === period ? "bg-brand/8 ring-1 ring-brand/30" : "hover:bg-surface2"}`}>
              <span className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${p.status === "closed" ? "bg-ok/12 text-ok" : p.ended ? "bg-warn/12 text-warn" : "bg-surface2 text-muted"}`}>{p.status === "closed" ? <Lock size={14} /> : p.ended ? <LockOpen size={14} /> : <CalendarCheck size={14} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{monthLabel(p.period)}</span>
                <span className="block text-[11px] text-muted">{p.status === "closed" ? L(`ปิดแล้ว · v${p.version}`, `Closed · v${p.version}`, `已结账 · v${p.version}`) : p.ended ? (p.version ? L(`เปิดใหม่หลัง v${p.version} · รอปิด`, `Reopened after v${p.version} · awaiting close`, `v${p.version} 后重新开启 · 待结账`) : L("จบเดือนแล้ว · รอปิด", "Month ended · awaiting close", "月份已结束 · 待结账")) : L("งวดปัจจุบัน", "Current period", "当前期间")}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-4 min-w-0">
          {/* หัวงวด */}
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold flex items-center gap-2">{monthLabel(period)}
                {cur?.status === "closed" ? <Badge tone="ok"><Lock size={11} /> {L("ปิดแล้ว", "Closed", "已结账")} v{cur.version}</Badge> : curEnded ? <Badge tone="warn">{L("ยังไม่ปิด", "Not closed", "未结账")}</Badge> : <Badge tone="neutral">{L("งวดปัจจุบัน", "Current period", "当前期间")}</Badge>}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {cur?.status === "closed" ? `${L("ปิดโดย", "Closed by", "结账人")} ${data.names[cur.closed_by ?? ""] ?? "—"} · ${when(cur.closed_at)}` : cur?.reopened_at ? `${L("เปิดใหม่โดย", "Reopened by", "重新开启人")} ${data.names[cur.reopened_by ?? ""] ?? "—"} · ${when(cur.reopened_at)} — “${cur.reopen_reason}”` : L("ยังไม่เคยปิด", "Never closed", "从未结账")}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" onClick={exportXls}><FileDown size={15} /> Excel</Button>
              {cur?.status !== "closed" && data.can_close ? <Button variant="primary" disabled={!curEnded} title={!curEnded ? L("ปิดได้หลังสิ้นเดือน", "Can close after month end", "月末后才能结账") : undefined} onClick={() => { setText(""); setCloseOpen(true); }}><Lock size={15} /> {L("ปิดงวด", "Close period", "结账")}</Button> : null}
              {cur?.status === "closed" && data.can_reopen ? <Button variant="soft" onClick={() => { setText(""); setReopenOpen(true); }}><LockOpen size={15} /> {L("เปิดงวดใหม่", "Reopen period", "重新开启")}</Button> : null}
            </div>
          </div>

          {drift ? <div className="rounded-xl border border-warn/40 bg-warn/8 px-4 py-3 text-[13px] flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5 text-warn" />{L("ยอดขายสุทธิสดต่างจากรายงานที่ปิดไว้", "Live net sales differ from the closed report", "实时销售净额与已结账报告不同")} (v{data.versions[0].version}) {drift > 0 ? "+" : ""}{baht(drift)} {L("บาท — ปิดงวดอีกครั้งเพื่อออกรายงาน version ใหม่", "THB — close again to issue a new report version", "泰铢 — 请再次结账以生成新 version 报告")}</div> : null}
          {viewV ? <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-2.5 text-[13px] flex items-center gap-2"><History size={15} />{L(`กำลังดูรายงานที่ปิดไว้ version ${viewV} (ภาพ ณ ตอนปิด)`, `Viewing closed report version ${viewV} (snapshot at close)`, `正在查看已结账报告 version ${viewV}（结账时快照）`)} <button className="ml-auto underline text-xs" onClick={() => setViewV(null)}>{L("กลับไปดูยอดสด", "Back to live figures", "返回实时数据")}</button></div> : null}

          {/* ยอดขายสุทธิ */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Tile icon={<Wallet size={16} />} label={L(`ยอดขาย · ${qty(shown.sales.bills)} บิล`, `Sales · ${qty(shown.sales.bills)} bills`, `销售 · ${qty(shown.sales.bills)} 单`)} value={baht(shown.sales.gross)} />
            <Tile icon={<RotateCcw size={16} />} label={L(`หัก คืนเงิน · ${qty(shown.returns.count)} ใบ`, `Less refunds · ${qty(shown.returns.count)} docs`, `减 退款 · ${qty(shown.returns.count)} 张`)} value={Number(shown.returns.amount) ? `−${baht(shown.returns.amount)}` : baht(0)} tone={Number(shown.returns.amount) ? "danger" : undefined} />
            <Tile icon={<FileMinus size={16} />} label={L(`หัก ใบลดหนี้ส่วนลด · ${qty(shown.credit_notes.discount_count)} ใบ`, `Less discount credit notes · ${qty(shown.credit_notes.discount_count)}`, `减 折扣贷项单 · ${qty(shown.credit_notes.discount_count)} 张`)} value={Number(shown.credit_notes.discount_amount) ? `−${baht(shown.credit_notes.discount_amount)}` : baht(0)} tone={Number(shown.credit_notes.discount_amount) ? "danger" : undefined} />
            <Tile icon={<CheckCircle2 size={16} />} label={L("ยอดขายสุทธิ", "Net sales", "销售净额")} value={baht(shown.net_sales)} strong sub={`${L("ภาษีขายสุทธิ", "Net output VAT", "销项税净额")} ${baht(shown.net_vat)}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4 space-y-2 text-sm">
              <p className="font-semibold">{L("รายละเอียดที่ไม่ถูกหักซ้ำ", "Not deducted twice", "不重复扣减的明细")}</p>
              <Row k={<span className="inline-flex items-center gap-1.5"><Ban size={13} />{L("บิลยกเลิก (ไม่นับในยอดขาย)", "Voided bills (not in sales)", "作废单据（不计入销售）")}</span>} v={`${qty(shown.voids.bills)} ${L("บิล", "bills", "单")} · ${baht(shown.voids.amount)}`} />
              <Row k={L("ใบลดหนี้จากการรับคืน (อ้างอิง เงินคืนอยู่ในใบรับคืนแล้ว)", "Return credit notes (reference; refund already in the return doc)", "退货贷项单（参考，退款已含在退货单中）")} v={`${qty(shown.credit_notes.return_linked_count)} ${L("ใบ", "docs", "张")} · ${baht(shown.credit_notes.return_linked_amount)}`} />
              <p className="font-semibold pt-2">{L("รับชำระตามช่องทาง", "Payments by method", "按方式收款")}</p>
              {Object.keys(shown.payments).length ? Object.entries(shown.payments).map(([m, v]) => <Row key={m} k={METHODL[m] ?? m} v={baht(v)} />) : <p className="text-xs text-muted">{L("ไม่มี", "None", "无")}</p>}
              {Object.keys(shown.cash_movements).length ? <><p className="font-semibold pt-2">{L("เงินเข้า-ออกลิ้นชัก", "Drawer cash in/out", "钱箱进出")}</p>{Object.entries(shown.cash_movements).map(([m, v]) => <Row key={m} k={CASHL[m] ?? m} v={baht(v)} />)}</> : null}
            </div>
            <div className="card p-4 space-y-2 text-sm">
              <p className="font-semibold flex items-center gap-1.5"><Boxes size={15} /> {L("สมการสต๊อก (ชิ้น)", "Stock equation (units)", "库存等式（件）")}</p>
              <Row k={L("ยกมาต้นงวด", "Opening", "期初")} v={qty(shown.stock.opening)} />
              {Object.entries(shown.stock.by_type).map(([t, v]) => <Row key={t} k={`${Number(v) >= 0 ? "+" : "−"} ${MOVEL[t] ?? t}`} v={qty(Math.abs(Number(v)))} muted />)}
              <div className="border-t border-line pt-2"><Row k={<b>{L("คงเหลือปลายงวด", "Closing", "期末结余")}</b>} v={<b>{qty(shown.stock.closing)}</b>} /></div>
              <p className={`text-[11px] ${Number(shown.stock.opening) + Number(shown.stock.movement) === Number(shown.stock.closing) ? "text-ok" : "text-danger"}`}>
                {qty(shown.stock.opening)} {Number(shown.stock.movement) >= 0 ? "+" : "−"} {qty(Math.abs(Number(shown.stock.movement)))} = {qty(shown.stock.closing)} {Number(shown.stock.opening) + Number(shown.stock.movement) === Number(shown.stock.closing) ? `✓ ${L("สมดุล", "Balanced", "平衡")}` : `✗ ${L("ไม่สมดุล", "Out of balance", "不平衡")}`}
              </p>
              {Number(shown.stock.skus_out_of_balance) ? <p className="text-[11px] text-warn">{qty(shown.stock.skus_out_of_balance)} {L("SKU ที่ยอดคงเหลือปัจจุบันไม่ตรงกับ stock card (ยอดตั้งต้น/ดึงจากคลังกลางโดยไม่มีรายการเคลื่อนไหว)", "SKUs whose current balance doesn’t match the stock card (initial/central-warehouse balance without movements)", "个 SKU 当前结余与库存卡不符（期初/中央仓同步但无变动记录）")}</p> : null}
            </div>
          </div>

          {/* รายการค้างก่อนปิด */}
          {cur?.status !== "closed" && curEnded ? (
            <div className={`card p-4 text-sm ${openCount ? "border-warn/40" : ""}`}>
              <p className="font-semibold mb-2">{L("ตรวจก่อนปิดงวด", "Pre-close checks", "结账前检查")}</p>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {Object.entries(shown.open_items).map(([k, v]) => (
                  <p key={k} className={`flex items-center gap-2 text-[13px] ${Number(v) ? "text-warn" : "text-ok"}`}>{Number(v) ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{OPENL[k] ?? k}: {qty(v)}</p>
                ))}
              </div>
              {openCount ? <p className="text-[11px] text-muted mt-2">{L("ต้องเคลียร์ให้ครบก่อนปิด (ปิดกะ / อนุมัติหรือปฏิเสธคำขอคืน / ลงบัญชีบิลค้างส่ง / ปิดรอบนับ)", "Clear all before closing (close shifts / approve or reject returns / post deferred bills / close counts)", "结账前须全部处理（关闭班次 / 审批或拒绝退货 / 入账待发货单据 / 关闭盘点）")}</p> : null}
            </div>
          ) : null}

          {/* ประวัติ version */}
          <div className="card p-4">
            <p className="font-semibold text-sm flex items-center gap-1.5 mb-2"><History size={15} /> {L("รายงานที่ปิดไว้ (version)", "Closed reports (version)", "已结账报告（version）")}</p>
            {data.versions.length ? (
              <div className="divide-y divide-line">
                {data.versions.map((v) => (
                  <button key={v.version} onClick={() => setViewV(viewV === v.version ? null : v.version)} className={`w-full text-left py-2.5 flex items-center gap-3 text-sm ${viewV === v.version ? "text-brand" : ""}`}>
                    <Badge tone={v.version === data.versions[0].version ? "ok" : "neutral"}>v{v.version}</Badge>
                    <span className="flex-1 min-w-0 truncate">{L("ยอดขายสุทธิ", "Net sales", "销售净额")} {baht(v.summary.net_sales)} · {L("ปิดโดย", "closed by", "结账人")} {data.names[v.closed_by ?? ""] ?? "—"} · {when(v.closed_at)}{v.note ? ` — ${v.note}` : ""}</span>
                    <span className="text-[11px] text-muted">{viewV === v.version ? L("กำลังดู", "Viewing", "查看中") : L("ดู", "View", "查看")}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-xs text-muted">{L("ยังไม่เคยปิดงวดนี้", "This period has never been closed", "此期间从未结账")}</p>}
          </div>
        </div>
      </div>

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title={L(`ปิดงวด ${monthLabel(period)}`, `Close ${monthLabel(period)}`, `结账 ${monthLabel(period)}`)} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCloseOpen(false)}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={openCount > 0} onClick={() => void act("close")}><Lock size={15} /> {L("ยืนยันปิดงวด", "Confirm close", "确认结账")}</Button></>}>
        <div className="space-y-3 text-sm">
          <p>{L("หลังปิด: บิล/การเคลื่อนไหวสต๊อก/เงินลิ้นชักที่ลงวันที่ในงวดนี้ บันทึกเพิ่มไม่ได้ · ระบบเก็บรายงานนี้เป็น version", "After closing: bills/stock movements/drawer cash dated in this period can’t be added · this report is saved as version", "结账后：日期在本期间的单据/库存变动/钱箱现金不能再录入 · 本报告保存为 version")} {(cur?.version ?? 0) + 1}</p>
          <div className="rounded-xl bg-surface2 px-3 py-2 tnum">{L("ยอดขายสุทธิ", "Net sales", "销售净额")} <b>{baht(data.live.net_sales)}</b> · {L("ภาษีขายสุทธิ", "Net output VAT", "销项税净额")} {baht(data.live.net_vat)}</div>
          {openCount ? <p className="text-warn text-xs">{L(`ยังมีรายการค้าง ${openCount} รายการ — เคลียร์ก่อนจึงปิดได้`, `${openCount} open items — clear them before closing`, `还有 ${openCount} 项待处理 — 处理后才能结账`)}</p> : null}
          <Field label={L("หมายเหตุ (ไม่บังคับ)", "Note (optional)", "备注（可选）")}><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
        </div>
      </Modal>
      <Modal open={reopenOpen} onClose={() => setReopenOpen(false)} title={L(`เปิดงวด ${monthLabel(period)} ใหม่`, `Reopen ${monthLabel(period)}`, `重新开启 ${monthLabel(period)}`)} size="sm"
        footer={<><Button variant="ghost" onClick={() => setReopenOpen(false)}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="danger" loading={busy} disabled={text.trim().length < 5} onClick={() => void act("reopen")}><LockOpen size={15} /> {L("ยืนยันเปิดงวด", "Confirm reopen", "确认重新开启")}</Button></>}>
        <div className="space-y-3 text-sm">
          <p>{L(`เปิดแล้วบันทึกย้อนหลังเข้างวดนี้ได้จนกว่าจะปิดอีกครั้ง (รายงานเดิม v${cur?.version} ยังเก็บไว้ · ปิดใหม่จะได้ v${(cur?.version ?? 0) + 1}) · บันทึกเหตุผลใน log`, `Once reopened, backdated entries are allowed until closed again (old report v${cur?.version} is kept · next close becomes v${(cur?.version ?? 0) + 1}) · reason is logged`, `重新开启后可补录直至再次结账（原报告 v${cur?.version} 保留 · 再次结账为 v${(cur?.version ?? 0) + 1}）· 原因记入日志`)}</p>
          <Field label={L("เหตุผล (บังคับ)", "Reason (required)", "原因（必填）")}><Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={L("เช่น ลงบิลตกหล่นของวันที่ 28", "e.g. post a missed bill from the 28th", "例如 补录 28 日漏记的单据")} /></Field>
        </div>
      </Modal>
      {busy ? <span className="sr-only"><Loader2 /></span> : null}
    </div>
  );
}

function Tile({ icon, label, value, sub, tone, strong }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "danger"; strong?: boolean }) {
  return (
    <div className={`card px-4 py-3 ${strong ? "ring-1 ring-brand/30 bg-brand/5" : ""}`}>
      <p className="text-[11px] text-muted flex items-center gap-1.5">{icon}{label}</p>
      <p className={`text-xl font-semibold tnum mt-0.5 ${tone === "danger" ? "text-danger" : strong ? "text-brand" : ""}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}
function Row({ k, v, muted }: { k: React.ReactNode; v: React.ReactNode; muted?: boolean }) {
  return <p className={`flex items-center justify-between gap-3 ${muted ? "text-muted text-[13px]" : ""}`}><span className="min-w-0">{k}</span><span className="tnum shrink-0">{v}</span></p>;
}
