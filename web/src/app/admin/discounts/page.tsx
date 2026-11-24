"use client";
// ประวัติส่วนลดรายบิล — ส่วนลดแต่ละก้อนมาจากไหน (พนักงาน/คูปอง/แต้ม/ของแถมจากแคมเปญ) ใครให้ ส่งไป JST เป็นแบบไหน และ JST รับหรือยัง
//   JST รับส่วนลดได้ 2 ระดับ: รายสินค้า (lineDiscount) · ทั้งบิล (billDiscount) — แคมเปญ/คูปองคำนวณในระบบเรา แล้วบอกที่มาในหมายเหตุบิล
import { Fragment, useEffect, useMemo, useState } from "react";
import { BadgePercent, Search, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB } from "@/lib/money";
import { OwSaleBadge } from "@/components/pos/ow-sale-badge";
import type { DiscountBreakdown } from "@/lib/discount-breakdown";

type Row = {
  order_no: string; branch_id: string; status: string; sale_at: string; grand_total: number; breakdown: DiscountBreakdown; cashier: string | null; approved_by: string | null;
  jst: { state: string; ow_status: string | null; sale_no: string | null; jst_order_no: string | null; sent_line_discount: number | null; sent_bill_discount: number | null; remark: string | null; consistent: boolean | null } | null;
};
type Data = { from: string; to: string; rows: Row[]; summary: { bills: number; total: number; line: number; bill_manual: number; coupon: number; points: number; gifts: number } };
const SOURCES = [["all", "ทุกที่มา"], ["line", "ส่วนลดรายการ"], ["bill", "ส่วนลดท้ายบิล"], ["coupon", "คูปอง/แคมเปญ"], ["points", "ใช้แต้ม"], ["gift", "ของแถม"]] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function DiscountHistoryPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string) => (locale === "th" ? th : en);
  const [days, setDays] = useState(30), [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const [q, setQ] = useState(""), [src, setSrc] = useState<(typeof SOURCES)[number][0]>("all"), [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    fetch(`/api/admin/discounts?from=${encodeURIComponent(from)}`, { cache: "no-store" }).then(async (r) => {
      const j = await r.json(); if (!alive) return; if (!r.ok) { setError(j.error ?? "อ่านข้อมูลไม่สำเร็จ"); return; } setData(j); setError("");
    }).catch(() => alive && setError("เชื่อมเซิร์ฟเวอร์ไม่ได้"));
    return () => { alive = false; };
  }, [days]);
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => {
    const b = r.breakdown;
    if (q && !r.order_no.toLowerCase().includes(q.toLowerCase()) && !(b.coupon?.code ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (src === "line") return b.lineTotal > 0;
    if (src === "bill") return b.billManual > 0;
    if (src === "coupon") return !!b.coupon;
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
          <h1 className="text-xl font-semibold tracking-tight">{L("ประวัติส่วนลด", "Discount history")}</h1>
          <p className="text-[11px] text-muted">{L("รายบิล: ที่มาของส่วนลด · ใครให้ · ส่งไป JST เป็นส่วนลดรายสินค้า/ทั้งบิล · JST รับแล้วหรือยัง", "Per bill: source · who · what JST received")}</p>
        </div>
        <div className="ml-auto flex rounded-xl bg-surface2/70 p-0.5">
          {[1, 7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`h-8 px-3 rounded-lg text-xs ${days === d ? "bg-surface shadow-sm font-medium" : "text-muted"}`}>{d === 1 ? L("วันนี้", "Today") : `${d} ${L("วัน", "days")}`}</button>)}
        </div>
      </header>
      {error ? <p role="alert" className="rounded-xl px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {([["บิลที่มีส่วนลด", s ? String(s.bills) : "—"], ["ส่วนลดรวม", s ? formatTHB(s.total) : "—"], ["ส่วนลดรายการ", s ? formatTHB(s.line) : "—"], ["ส่วนลดท้ายบิล", s ? formatTHB(s.bill_manual) : "—"], ["คูปอง + แต้ม", s ? formatTHB(s.coupon + s.points) : "—"], ["ของแถม (รายการ)", s ? String(s.gifts) : "—"]] as const).map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-line/70 bg-surface p-4"><p className="text-[11px] text-muted">{l}</p><p className="text-lg font-semibold tnum mt-1">{v}</p></div>
        ))}
      </div>

      <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นเลขบิล / รหัสคูปอง", "Bill no. / coupon")} className="h-8 w-56 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none" />
          </div>
          <div className="flex flex-wrap rounded-xl bg-surface2/70 p-0.5">
            {SOURCES.map(([k, l]) => <button key={k} onClick={() => setSrc(k)} className={`h-8 px-3 rounded-lg text-xs ${src === k ? "bg-surface shadow-sm font-medium" : "text-muted"}`}>{l}</button>)}
          </div>
          <span className="ml-auto text-[11px] text-muted">{rows.length} {L("บิล", "bills")}</span>
        </div>
        <div className="max-h-[calc(100vh-360px)] min-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0 z-10"><tr>
              {["", "บิล", "เวลา", "ส่วนลดรายการ", "ส่วนลดท้ายบิล", "คูปอง/แต้ม", "ของแถม", "รวมส่วนลด", "ยอดสุทธิ", "ผู้ให้ส่วนลด", "JST"].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => {
                const b = r.breakdown, isOpen = open === r.order_no;
                return (
                  <Fragment key={r.order_no}>
                    <tr className="hover:bg-surface2/40 cursor-pointer" onClick={() => setOpen(isOpen ? null : r.order_no)}>
                      <td className="pl-3 w-6 text-muted">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{r.order_no}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{fmt(r.sale_at)}</td>
                      <td className="px-3 py-2 tnum">{b.lineTotal ? formatTHB(b.lineTotal) : "—"}</td>
                      <td className="px-3 py-2 tnum">{b.billManual ? formatTHB(b.billManual) : "—"}</td>
                      <td className="px-3 py-2">{b.coupon ? <span className="whitespace-nowrap">{b.coupon.code} · {formatTHB(b.coupon.amount)}</span> : null}{b.points ? <span className="block whitespace-nowrap">{b.points.points} แต้ม · {formatTHB(b.points.value)}</span> : null}{!b.coupon && !b.points ? "—" : null}</td>
                      <td className="px-3 py-2">{b.gifts.length ? b.gifts.map((g) => `${g.sku}×${g.qty}`).join(", ") : "—"}</td>
                      <td className="px-3 py-2 tnum font-medium text-danger">{formatTHB(b.total)}</td>
                      <td className="px-3 py-2 tnum">{formatTHB(r.grand_total)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.cashier ?? "—"}{r.approved_by ? <span className="block text-[10px] text-muted">อนุมัติ: {r.approved_by}</span> : null}</td>
                      <td className="px-3 py-2"><OwSaleBadge status={r.jst ? { state: r.jst.state, reason: null, ow_status: r.jst.ow_status, sale_no: r.jst.sale_no, jst_order_no: r.jst.jst_order_no, sent_at: null } : null} /></td>
                    </tr>
                    {isOpen ? (
                      <tr><td colSpan={11} className="bg-surface2/40 px-4 py-3">
                        <div className="grid sm:grid-cols-2 gap-3 text-[11px]">
                          <div className="rounded-xl bg-surface p-3 space-y-1">
                            <p className="font-medium text-xs mb-1">ที่มาของส่วนลด (ระบบเรา)</p>
                            <p>ยอดก่อนลด: <span className="tnum">{formatTHB(b.gross)}</span></p>
                            {b.lines.map((l, i) => <p key={i}>ส่วนลดรายการ {l.sku}: <span className="tnum text-danger">-{formatTHB(l.amount)}</span> <span className="text-muted">(พนักงาน)</span></p>)}
                            {b.billManual ? <p>ส่วนลดท้ายบิล: <span className="tnum text-danger">-{formatTHB(b.billManual)}</span> <span className="text-muted">(พนักงาน)</span></p> : null}
                            {b.coupon ? <p>คูปอง {b.coupon.code}{b.coupon.campaign ? ` · แคมเปญ ${b.coupon.campaign}` : ""}: <span className="tnum text-danger">-{formatTHB(b.coupon.amount)}</span></p> : null}
                            {b.points ? <p>ใช้แต้ม {b.points.points}: <span className="tnum text-danger">-{formatTHB(b.points.value)}</span></p> : null}
                            {b.gifts.map((g, i) => <p key={i}>ของแถม {g.sku}×{g.qty}{g.campaign ? ` · ${g.campaign}` : ""} (ราคา 0)</p>)}
                            <p className="font-medium pt-1 border-t border-line/60">ยอดสุทธิ: <span className="tnum">{formatTHB(r.grand_total)}</span></p>
                          </div>
                          <div className="rounded-xl bg-surface p-3 space-y-1">
                            <p className="font-medium text-xs mb-1 flex items-center gap-1.5">ที่ส่งไป JST {r.jst?.consistent === true ? <CheckCircle2 size={13} className="text-ok" /> : r.jst?.consistent === false ? <AlertTriangle size={13} className="text-danger" /> : null}</p>
                            {r.jst ? <>
                              <p>ส่วนลดรายสินค้า (lineDiscount): <span className="tnum">{r.jst.sent_line_discount != null ? formatTHB(r.jst.sent_line_discount) : "—"}</span> <span className="text-muted">ควรเป็น {formatTHB(b.jst.lineDiscount)}</span></p>
                              <p>ส่วนลดทั้งบิล (billDiscount): <span className="tnum">{r.jst.sent_bill_discount != null ? formatTHB(r.jst.sent_bill_discount) : "—"}</span> <span className="text-muted">ควรเป็น {formatTHB(b.jst.billDiscount)}</span></p>
                              <p>ของแถม (บรรทัดราคา 0): {b.jst.freebieLines}</p>
                              <p className="break-words">หมายเหตุบิลใน JST: <span className="text-muted">{r.jst.remark ?? "—"}</span></p>
                              <p>คลังกลาง: <span className="font-mono">{r.jst.sale_no ?? "—"}</span> · JST: <span className="font-mono">{r.jst.jst_order_no ?? "—"}</span></p>
                            </> : <p className="text-muted">บิลนี้ไม่ได้ส่งคลังกลาง (สาขายังไม่ผูก)</p>}
                          </div>
                        </div>
                      </td></tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <p className="text-center text-xs text-muted py-12">{data ? L("ไม่มีบิลที่มีส่วนลดในช่วงนี้", "No discounted bills") : L("กำลังโหลด…", "Loading…")}</p> : null}
        </div>
      </section>
    </div>
  );
}
