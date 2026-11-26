"use client";
// ประวัติส่วนลดรายบิล — ส่วนลดแต่ละก้อนมาจากไหน (พนักงาน/คูปอง/แต้ม/ของแถมจากแคมเปญ) ใครให้ ส่งไป JST เป็นแบบไหน และ JST รับหรือยัง
//   JST รับส่วนลดได้ 2 ระดับ: รายสินค้า (lineDiscount) · ทั้งบิล (billDiscount) — แคมเปญ/คูปองคำนวณในระบบเรา แล้วบอกที่มาในหมายเหตุบิล
import { Fragment, useEffect, useMemo, useState } from "react";
import { BadgePercent, Search, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { useL } from "@/lib/i18n/provider";
import { formatTHB } from "@/lib/money";
import { OwSaleBadge } from "@/components/pos/ow-sale-badge";
import type { DiscountBreakdown } from "@/lib/discount-breakdown";

type Row = {
  order_no: string; branch_id: string; status: string; sale_at: string; grand_total: number; breakdown: DiscountBreakdown; cashier: string | null; approved_by: string | null;
  jst: { state: string; ow_status: string | null; sale_no: string | null; jst_order_no: string | null; sent_line_discount: number | null; sent_bill_discount: number | null; remark: string | null; consistent: boolean | null } | null;
};
type Data = { from: string; to: string; rows: Row[]; summary: { bills: number; total: number; line: number; line_campaign?: number; bill_manual: number; coupon: number; points: number; gifts: number } };
const SOURCES = [["all", "ทุกที่มา", "All sources", "所有来源"], ["line", "ส่วนลดรายการ", "Line discount", "单品折扣"], ["bill", "ส่วนลดท้ายบิล", "Bill discount", "整单折扣"], ["promo", "โปรรายสินค้า", "Product promo", "商品促销"], ["coupon", "คูปอง/แคมเปญ", "Coupon/campaign", "优惠券/活动"], ["points", "ใช้แต้ม", "Points redeemed", "积分抵扣"], ["gift", "ของแถม", "Gifts", "赠品"]] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function DiscountHistoryPage() {
  const L = useL();
  const [days, setDays] = useState(30), [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const [q, setQ] = useState(""), [src, setSrc] = useState<(typeof SOURCES)[number][0]>("all"), [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    fetch(`/api/admin/discounts?from=${encodeURIComponent(from)}`, { cache: "no-store" }).then(async (r) => {
      const j = await r.json(); if (!alive) return; if (!r.ok) { setError(j.error ?? L("อ่านข้อมูลไม่สำเร็จ", "Failed to read data", "读取数据失败")); return; } setData(j); setError("");
    }).catch(() => alive && setError(L("เชื่อมเซิร์ฟเวอร์ไม่ได้", "Cannot reach server", "无法连接服务器")));
    return () => { alive = false; };
  }, [days]);
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => {
    const b = r.breakdown;
    if (q && !r.order_no.toLowerCase().includes(q.toLowerCase()) && !(b.coupon?.code ?? "").toLowerCase().includes(q.toLowerCase()) && !(b.lineCampaigns ?? []).some((x) => x.code.toLowerCase().includes(q.toLowerCase()))) return false;
    if (src === "line") return b.lineTotal > 0;
    if (src === "bill") return b.billManual > 0;
    if (src === "promo") return (b.lineCampaignTotal ?? 0) > 0;
    if (src === "coupon") return !!b.coupon || (b.lineCampaignTotal ?? 0) > 0;
    if (src === "points") return !!b.points;
    if (src === "gift") return b.gifts.length > 0;
    return true;
  }), [data, q, src]);
  const s = data?.summary;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="h-10 w-10 grid place-items-center rounded-2xl bg-brand/10 text-brand"><BadgePercent size={18} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{L("ประวัติส่วนลด", "Discount history", "折扣记录")}</h1>
          <p className="text-[11px] text-muted">{L("รายบิล: ที่มาของส่วนลด · ใครให้ · ส่งไป JST เป็นส่วนลดรายสินค้า/ทั้งบิล · JST รับแล้วหรือยัง", "Per bill: discount source · who gave it · sent to JST as line/bill discount · whether JST received it", "按单据：折扣来源 · 谁给的 · 以单品/整单折扣发送到 JST · JST 是否已接收")}</p>
        </div>
        <div className="ml-auto flex rounded-xl bg-surface2/70 p-0.5">
          {[1, 7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`h-8 px-3 rounded-lg text-xs ${days === d ? "bg-surface shadow-sm font-medium" : "text-muted"}`}>{d === 1 ? L("วันนี้", "Today", "今天") : `${d} ${L("วัน", "days", "天")}`}</button>)}
        </div>
      </header>
      {error ? <p role="alert" className="rounded-xl px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {([[L("บิลที่มีส่วนลด", "Discounted bills", "有折扣的单据"), s ? String(s.bills) : "—"], [L("ส่วนลดรวม", "Total discount", "折扣总额"), s ? formatTHB(s.total) : "—"], [L("ส่วนลดรายการ", "Line discount", "单品折扣"), s ? formatTHB(s.line) : "—"], [L("ส่วนลดท้ายบิล", "Bill discount", "整单折扣"), s ? formatTHB(s.bill_manual) : "—"], [L("โปร/คูปอง + แต้ม", "Promo/coupon + points", "促销/优惠券 + 积分"), s ? formatTHB(s.coupon + (s.line_campaign ?? 0) + s.points) : "—"], [L("ของแถม (รายการ)", "Gifts (lines)", "赠品（行）"), s ? String(s.gifts) : "—"]] as const).map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-line/70 bg-surface p-4"><p className="text-[11px] text-muted">{l}</p><p className="text-lg font-semibold tnum mt-1">{v}</p></div>
        ))}
      </div>

      <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นเลขบิล / รหัสคูปอง", "Search bill no. / coupon code", "搜索单号 / 优惠码")} className="h-8 w-56 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none" />
          </div>
          <div className="flex flex-wrap rounded-xl bg-surface2/70 p-0.5">
            {SOURCES.map(([k, th, en, zh]) => <button key={k} onClick={() => setSrc(k)} className={`h-8 px-3 rounded-lg text-xs ${src === k ? "bg-surface shadow-sm font-medium" : "text-muted"}`}>{L(th, en, zh)}</button>)}
          </div>
          <span className="ml-auto text-[11px] text-muted">{rows.length} {L("บิล", "bills", "单")}</span>
        </div>
        <div className="max-h-[calc(100vh-360px)] min-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0 z-10"><tr>
              {["", L("บิล", "Bill", "单据"), L("เวลา", "Time", "时间"), L("ส่วนลดรายการ", "Line discount", "单品折扣"), L("ส่วนลดท้ายบิล", "Bill discount", "整单折扣"), L("โปร/คูปอง/แต้ม", "Promo/coupon/points", "促销/优惠券/积分"), L("ของแถม", "Gifts", "赠品"), L("รวมส่วนลด", "Total discount", "折扣合计"), L("ยอดสุทธิ", "Net total", "净额"), L("ผู้ให้ส่วนลด", "Given by", "折扣给予人"), "JST"].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => {
                const b = r.breakdown, isOpen = open === r.order_no;
                return (
                  <Fragment key={r.order_no}>
                    <tr className="hover:bg-surface2/40 cursor-pointer" onClick={() => setOpen(isOpen ? null : r.order_no)}>
                      <td className="pl-3 w-6 text-muted">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap" translate="no">{r.order_no}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{fmt(r.sale_at)}</td>
                      <td className="px-3 py-2 tnum">{b.lineTotal ? formatTHB(b.lineTotal) : "—"}</td>
                      <td className="px-3 py-2 tnum">{b.billManual ? formatTHB(b.billManual) : "—"}</td>
                      <td className="px-3 py-2">{(b.lineCampaigns ?? []).map((x, i) => <span key={i} className="block whitespace-nowrap"><span translate="no">{x.code} ({x.sku})</span> · {formatTHB(x.amount)}</span>)}{b.coupon ? <span className="whitespace-nowrap"><span translate="no">{b.coupon.code}</span> · {formatTHB(b.coupon.amount)}</span> : null}{b.points ? <span className="block whitespace-nowrap">{b.points.points} {L("แต้ม", "pts", "积分")} · {formatTHB(b.points.value)}</span> : null}{!b.coupon && !b.points && !(b.lineCampaigns ?? []).length ? "—" : null}</td>
                      <td className="px-3 py-2" translate="no">{b.gifts.length ? b.gifts.map((g) => `${g.sku}×${g.qty}`).join(", ") : "—"}</td>
                      <td className="px-3 py-2 tnum font-medium text-danger">{formatTHB(b.total)}</td>
                      <td className="px-3 py-2 tnum">{formatTHB(r.grand_total)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.cashier ?? "—"}{r.approved_by ? <span className="block text-[10px] text-muted">{L("อนุมัติ", "Approved", "审批")}: {r.approved_by}</span> : null}</td>
                      <td className="px-3 py-2"><OwSaleBadge status={r.jst ? { state: r.jst.state, reason: null, ow_status: r.jst.ow_status, sale_no: r.jst.sale_no, jst_order_no: r.jst.jst_order_no, sent_at: null } : null} /></td>
                    </tr>
                    {isOpen ? (
                      <tr><td colSpan={11} className="bg-surface2/40 px-4 py-3">
                        <div className="grid sm:grid-cols-2 gap-3 text-[11px]">
                          <div className="rounded-xl bg-surface p-3 space-y-1">
                            <p className="font-medium text-xs mb-1">{L("ที่มาของส่วนลด (ระบบเรา)", "Discount sources (our system)", "折扣来源（本系统）")}</p>
                            <p>{L("ยอดก่อนลด", "Before discount", "折前金额")}: <span className="tnum">{formatTHB(b.gross)}</span></p>
                            {b.lines.map((l, i) => <p key={i}>{L("ส่วนลดรายการ", "Line discount", "单品折扣")} <span translate="no">{l.sku}</span>: <span className="tnum text-danger">-{formatTHB(l.amount)}</span> <span className="text-muted">({L("พนักงาน", "staff", "员工")})</span></p>)}
                            {(b.lineCampaigns ?? []).map((x, i) => <p key={`lc${i}`}>{L("โปรรายสินค้า", "Product promo", "商品促销")} <span translate="no">{x.code}</span>{x.campaign ? ` · ${x.campaign}` : ""} (<span translate="no">{x.sku}</span>): <span className="tnum text-danger">-{formatTHB(x.amount)}</span> <span className="text-muted">({L("แคมเปญ", "campaign", "活动")})</span></p>)}
                            {b.billManual ? <p>{L("ส่วนลดท้ายบิล", "Bill discount", "整单折扣")}: <span className="tnum text-danger">-{formatTHB(b.billManual)}</span> <span className="text-muted">({L("พนักงาน", "staff", "员工")})</span></p> : null}
                            {b.coupon ? <p>{L("คูปอง", "Coupon", "优惠券")} <span translate="no">{b.coupon.code}</span>{b.coupon.campaign ? ` · ${L("แคมเปญ", "campaign", "活动")} ${b.coupon.campaign}` : ""}: <span className="tnum text-danger">-{formatTHB(b.coupon.amount)}</span></p> : null}
                            {b.points ? <p>{L("ใช้แต้ม", "Points redeemed", "使用积分")} {b.points.points}: <span className="tnum text-danger">-{formatTHB(b.points.value)}</span></p> : null}
                            {b.gifts.map((g, i) => <p key={i}>{L("ของแถม", "Gift", "赠品")} <span translate="no">{g.sku}</span>×{g.qty}{g.campaign ? ` · ${g.campaign}` : ""} ({L("ราคา 0", "price 0", "价格 0")})</p>)}
                            <p className="font-medium pt-1 border-t border-line/60">{L("ยอดสุทธิ", "Net total", "净额")}: <span className="tnum">{formatTHB(r.grand_total)}</span></p>
                          </div>
                          <div className="rounded-xl bg-surface p-3 space-y-1">
                            <p className="font-medium text-xs mb-1 flex items-center gap-1.5">{L("ที่ส่งไป JST", "Sent to JST", "已发送到 JST")} {r.jst?.consistent === true ? <CheckCircle2 size={13} className="text-ok" /> : r.jst?.consistent === false ? <AlertTriangle size={13} className="text-danger" /> : null}</p>
                            {r.jst ? <>
                              <p>{L("ส่วนลดรายสินค้า", "Line discount", "单品折扣")} (lineDiscount): <span className="tnum">{r.jst.sent_line_discount != null ? formatTHB(r.jst.sent_line_discount) : "—"}</span> <span className="text-muted">{L("ควรเป็น", "expected", "应为")} {formatTHB(b.jst.lineDiscount)}</span></p>
                              <p>{L("ส่วนลดทั้งบิล", "Bill discount", "整单折扣")} (billDiscount): <span className="tnum">{r.jst.sent_bill_discount != null ? formatTHB(r.jst.sent_bill_discount) : "—"}</span> <span className="text-muted">{L("ควรเป็น", "expected", "应为")} {formatTHB(b.jst.billDiscount)}</span></p>
                              <p>{L("ของแถม (บรรทัดราคา 0)", "Gifts (zero-price lines)", "赠品（0 价行）")}: {b.jst.freebieLines}</p>
                              <p className="break-words">{L("หมายเหตุบิลใน JST", "JST bill remark", "JST 单据备注")}: <span className="text-muted">{r.jst.remark ?? "—"}</span></p>
                              <p>{L("คลังกลาง", "Central warehouse", "中央仓")}: <span className="font-mono" translate="no">{r.jst.sale_no ?? "—"}</span> · JST: <span className="font-mono" translate="no">{r.jst.jst_order_no ?? "—"}</span></p>
                            </> : <p className="text-muted">{L("บิลนี้ไม่ได้ส่งคลังกลาง (สาขายังไม่ผูก)", "Not sent to central warehouse (branch not linked)", "此单据未发送到中央仓（门店未绑定）")}</p>}
                          </div>
                        </div>
                      </td></tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <p className="text-center text-xs text-muted py-12">{data ? L("ไม่มีบิลที่มีส่วนลดในช่วงนี้", "No discounted bills in this period", "此期间没有有折扣的单据") : L("กำลังโหลด…", "Loading…", "加载中…")}</p> : null}
        </div>
      </section>
    </div>
  );
}
