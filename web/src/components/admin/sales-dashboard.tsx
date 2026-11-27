"use client";
// แดชบอร์ดหน้ายอดขาย (กะทัดรัด) + รายการบิล — ข้อมูลจริงจากระบบกลาง
//   ภาพรวม: KPI เทียบช่วงก่อนหน้า · ยอดสุทธิหลังหักคืน/ลดหนี้ · แนวโน้ม (ซ้อนช่วงก่อนหน้า) · ชำระ/ช่องทาง · แผนที่ความร้อน วัน×ชั่วโมง · สินค้า/สาขา/พนักงานท็อป
import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, Clock, Users, Store, Package, RotateCcw, ReceiptText } from "lucide-react";
import type { Branch, Employee, Order } from "@/lib/types";
import type { Adjustment, PrevOrder } from "@/lib/hooks/use-sales-data";
import { formatTHB, formatInt } from "@/lib/money";
import { isCountedSale, saleAt, bkkHour, bkkDay, bkkWeekday } from "@/lib/sales-basis";
import { OrderTraceDrawer } from "@/components/order-trace";
import { useSession } from "@/lib/store/session";
import { can } from "@/lib/permissions";
import { ChevronRight } from "lucide-react";
import { OwSaleBadge } from "@/components/pos/ow-sale-badge";
import { Segmented } from "@/components/ui";
import { tr } from "@/lib/i18n/tr";

const PAY = (): Record<string, string> => ({ cash: tr("เงินสด", "Cash", "现金"), credit_card: tr("บัตรเครดิต", "Credit card", "信用卡"), debit_card: tr("บัตรเดบิต", "Debit card", "借记卡"), qr_promptpay: tr("พร้อมเพย์", "PromptPay", "PromptPay"), bank_transfer: tr("โอนเงิน", "Bank transfer", "银行转账"), edc: "EDC", installment: tr("ผ่อนชำระ", "Installment", "分期付款"), gift_card: tr("บัตรของขวัญ", "Gift card", "礼品卡"), store_credit: tr("เครดิตร้าน", "Store credit", "店铺余额"), online_marketplace: tr("มาร์เก็ตเพลส", "Marketplace", "电商平台"), online_payment: tr("ชำระออนไลน์", "Online payment", "线上支付"), unspecified: tr("ไม่ระบุ", "Not specified", "未注明"), other: tr("อื่น ๆ", "Other", "其他") });
const CH = (): Record<string, string> => ({ offline: tr("หน้าร้าน", "In-store", "门店"), online_shopee: "Shopee", online_lazada: "Lazada", online_tiktok: "TikTok", online_website: tr("เว็บไซต์", "Website", "官网"), event: tr("อีเวนต์", "Event", "活动"), b2b: tr("ขายส่ง", "Wholesale", "批发"), other: tr("อื่น ๆ", "Other", "其他") });
const DAYS = () => tr("อา|จ|อ|พ|พฤ|ศ|ส", "Sun|Mon|Tue|Wed|Thu|Fri|Sat", "日|一|二|三|四|五|六").split("|");
const baht = (n: number) => formatTHB(n, false);
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);
const empName = (e?: Employee) => (e ? e.nickname || [e.first_name, (e as Employee & { last_name?: string }).last_name].filter(Boolean).join(" ") : "—");

function Delta({ v, show }: { v: number; show: boolean }) {
  if (!show) return null;
  const up = v > 0.5, down = v < -0.5;
  const I = up ? TrendingUp : down ? TrendingDown : Minus;
  return <span className={`inline-flex items-center gap-0.5 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md ${up ? "bg-ok/12 text-ok" : down ? "bg-danger/10 text-danger" : "bg-surface2 text-muted"}`}><I size={11} />{Math.abs(v) >= 1000 ? ">999" : Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%</span>;
}
export function Kpi({ label, value, sub, delta, showDelta, tone }: { label: string; value: string; sub?: string; delta?: number; showDelta?: boolean; tone?: "brand" | "ok" | "warn" }) {
  return (
    <div className={`card px-3.5 py-3 min-w-0 ${tone === "brand" ? "ring-1 ring-brand/25 bg-brand/[0.04]" : ""}`}>
      <div className="flex items-center justify-between gap-1"><p className="text-[11px] text-muted truncate">{label}</p><Delta v={delta ?? 0} show={!!showDelta} /></div>
      <p className={`text-lg font-bold tnum leading-tight mt-1 truncate ${tone === "brand" ? "text-brand" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : ""}`}>{value}</p>
      {sub ? <p className="text-[10.5px] text-muted truncate mt-0.5">{sub}</p> : null}
    </div>
  );
}
export function Panel({ title, icon, action, children, className = "" }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3"><p className="text-[13px] font-semibold flex items-center gap-1.5">{icon}{title}</p>{action}</div>
      {children}
    </div>
  );
}
export function Bars({ rows, total, color = "bg-brand" }: { rows: { label: string; value: number; sub?: string }[]; total: number; color?: string }) {
  if (!rows.length) return <p className="text-xs text-muted">{tr("ไม่มีข้อมูล", "No data", "暂无数据")}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="text-xs">
          <div className="flex items-center justify-between gap-2"><span className="truncate">{r.label}</span><span className="tnum text-muted shrink-0">{baht(r.value)} · {total ? Math.round((r.value / total) * 100) : 0}%</span></div>
          <div className="h-1.5 rounded-full bg-surface2 overflow-hidden mt-1"><div className={`h-full rounded-full ${color}`} style={{ width: `${total ? (r.value / total) * 100 : 0}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

// กราฟแนวโน้มขนาดเล็ก (SVG) — ช่วงปัจจุบันเป็นพื้นที่ · ช่วงก่อนหน้าเป็นเส้นประ
function Trend({ cur, prev, labels }: { cur: number[]; prev: number[]; labels: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 150, P = 6, n = cur.length;
  const max = Math.max(1, ...cur, ...prev);
  const x = (i: number) => (n <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P - 10);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = n ? `${path(cur)} L${x(n - 1)},${H - P} L${x(0)},${H - P} Z` : "";
  const ticks = n <= 8 ? labels.map((_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.28" /><stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke="rgb(var(--c-line))" strokeDasharray="3 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {prev.some((v) => v > 0) ? <path d={path(prev)} fill="none" stroke="rgb(var(--c-muted))" strokeOpacity="0.55" strokeDasharray="4 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}
        {n ? <path d={area} fill="url(#trendFill)" /> : null}
        {n ? <path d={path(cur)} fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2.2" vectorEffect="non-scaling-stroke" /> : null}
        {cur.map((v, i) => <rect key={i} x={x(i) - W / Math.max(n, 1) / 2} y={0} width={W / Math.max(n, 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover !== null ? <><line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="rgb(var(--c-brand))" strokeOpacity="0.3" vectorEffect="non-scaling-stroke" /><circle cx={x(hover)} cy={y(cur[hover])} r="3.5" fill="rgb(var(--c-brand))" /></> : null}
      </svg>
      {hover !== null ? (
        <div className="absolute top-0 right-0 rounded-lg bg-surface border border-line shadow-sm px-2.5 py-1.5 text-[11px] tnum pointer-events-none">
          <b>{labels[hover]}</b> · {baht(cur[hover])}{prev[hover] ? <span className="text-muted"> · {tr("ก่อนหน้า", "Previous", "上期")} {baht(prev[hover])}</span> : null}
        </div>
      ) : null}
      <div className="flex justify-between text-[10px] text-muted mt-1 tnum">{ticks.map((i) => <span key={i}>{labels[i]}</span>)}</div>
    </div>
  );
}

// ── โมเดลภาพรวม (ตัวเลขที่สรุปแล้ว · JSON ล้วน) — ใช้ทั้งหน้ายอดขาย และลิงก์แชร์ภาพนิ่ง (ไม่มีข้อมูลส่วนตัวลูกค้า) ──
export type OverviewModel = {
  kpi: { gross: number; net: number; bills: number; units: number; disc: number; gp: number; members: number; refunds: number; cn: number; voids: number; voidAmt: number; avg: number; pGross: number; pBills: number; pAvg: number; hasPrev: boolean; showCost: boolean };
  spark: number[];
  trend: { cur: number[]; prev: number[]; labels: string[]; hourly: boolean; monthly?: boolean };
  pay: { label: string; value: number }[]; ch: { label: string; value: number }[];
  heat: { noTimeLark?: boolean; g: number[][]; max: number; peak: { d: number; h: number; v: number }; hours: [number, number] };
  weekday: { label: string; cur: number; prev: number }[];
  basket: { label: string; value: number }[];
  categories: { label: string; value: number }[];
  /** "category" = หมวดสินค้า · "brand" = ใช้แบรนด์แทนเมื่อสินค้ายังไม่ได้ตั้งหมวด */
  catKind?: "category" | "brand";
  topProducts: { sku: string; name: string; qty: number; sales: number }[];
  topBranches: { id: string; name: string; value: number }[];
  topStaff: { id: string; name: string; value: number; bills: number }[];
};

export function buildOverview({ orders, adjustments, prev, branches, employees, showCost, range, productCat, catName, brandName }: {
  orders: Order[]; adjustments: Adjustment[]; prev: PrevOrder[]; branches: Branch[]; employees: Employee[]; showCost: boolean; range: { from: Date; to: Date };
  productCat?: Map<string, string | null>; catName?: Map<string, string>; brandName?: Map<string, string>;
}): OverviewModel {
  const sold = orders.filter(isCountedSale);
  const gross = sold.reduce((s, o) => s + o.grand_total, 0), bills = sold.length;
  const units = sold.reduce((s, o) => s + o.items.reduce((a, i) => a + (i.is_gift ? 0 : i.qty), 0), 0);
  const disc = sold.reduce((s, o) => s + o.discount_total, 0), gp = sold.reduce((s, o) => s + o.gross_profit, 0);
  const refunds = adjustments.filter((a) => a.kind === "return").reduce((s, a) => s + a.amount, 0);
  const cn = adjustments.filter((a) => a.kind === "credit_note").reduce((s, a) => s + a.amount, 0);
  const voids = orders.filter((o) => o.status === "voided");
  const pSold = prev.filter((o) => o.status === "completed" || o.status === "partially_refunded");
  const pGross = pSold.reduce((s, o) => s + o.grand_total, 0);
  const pBills = pSold.reduce((s, o) => s + (o.n ?? 1), 0); // ระบบเดิมส่งช่วงก่อนเป็นยอดรวมรายวัน (n = จำนวนบิล)
  // บิลระบบเดิม (Lark) ไม่มีเวลาขาย → ไม่เอาไปคิดรายชั่วโมง/แผนที่ความร้อน
  const timed = sold.filter((o) => o.source !== "lark");
  const kpi = { gross, net: gross - refunds - cn, bills, units, disc, gp, members: sold.filter((o) => o.customer_id).length, refunds, cn, voids: voids.length,
    voidAmt: voids.reduce((s, o) => s + o.grand_total, 0), avg: bills ? gross / bills : 0, pGross, pBills, pAvg: pBills ? pGross / pBills : 0, hasPrev: prev.length > 0, showCost };

  const spanDays = Math.max(1, Math.round((+range.to - +range.from) / 86400_000));
  let trend: OverviewModel["trend"];
  if (spanDays <= 2) {
    const cur = Array(24).fill(0), pv = Array(24).fill(0);
    for (const o of timed) cur[bkkHour(saleAt(o))] += o.grand_total;
    for (const o of pSold) if (o.source !== "lark") pv[bkkHour(o.created_at)] += o.grand_total;
    trend = { cur, prev: pv, labels: cur.map((_, h) => `${String(h).padStart(2, "0")}:00`), hourly: true };
  } else if (spanDays > 120) {
    // ช่วงยาว (เช่นย้อนหลังทั้งปี) → รายเดือน
    const months: string[] = [];
    for (let d = new Date(bkkDay(range.from.toISOString()).slice(0, 7) + "-01T00:00:00Z"); d.toISOString().slice(0, 7) <= bkkDay(range.to.toISOString()).slice(0, 7) && months.length < 60; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d.toISOString().slice(0, 7));
    const idx = new Map(months.map((m, i) => [m, i]));
    const cur = Array(months.length).fill(0), pv = Array(months.length).fill(0);
    for (const o of sold) { const i = idx.get(bkkDay(saleAt(o)).slice(0, 7)); if (i !== undefined) cur[i] += o.grand_total; }
    const shift = +range.to - +range.from + 1;
    for (const o of pSold) { const i = idx.get(bkkDay(new Date(+new Date(o.created_at) + shift).toISOString()).slice(0, 7)); if (i !== undefined) pv[i] += o.grand_total; }
    trend = { cur, prev: pv, labels: months.map((m) => { const [y, mm] = m.split("-"); return `${+mm}/${y.slice(2)}`; }), hourly: false, monthly: true };
  } else {
    const days: string[] = [];
    for (let d = new Date(range.from); d <= range.to && days.length < 400; d = new Date(+d + 86400_000)) days.push(bkkDay(d.toISOString()));
    const idx = new Map(days.map((d, i) => [d, i]));
    const cur = Array(days.length).fill(0), pv = Array(days.length).fill(0);
    for (const o of sold) { const i = idx.get(bkkDay(saleAt(o))); if (i !== undefined) cur[i] += o.grand_total; }
    const shift = +range.to - +range.from + 1;
    for (const o of pSold) { const i = idx.get(bkkDay(new Date(+new Date(o.created_at) + shift).toISOString())); if (i !== undefined) pv[i] += o.grand_total; }
    trend = { cur, prev: pv, labels: days.map((d) => { const [, m, dd] = d.split("-"); return `${+dd}/${+m}`; }), hourly: false };
  }
  const agg = (pairs: [string, number][]) => { const m = new Map<string, number>(); for (const [k, v] of pairs) m.set(k, (m.get(k) ?? 0) + v); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })); };
  const pay = agg(sold.flatMap((o) => o.payments.map((p) => [PAY()[p.method] ?? p.method, p.amount] as [string, number])));
  const ch = agg(sold.map((o) => [CH()[o.channel] ?? o.channel, o.grand_total]));
  const g = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const o of timed) g[bkkWeekday(saleAt(o))][bkkHour(saleAt(o))] += o.grand_total;
  let peak = { d: 0, h: 0, v: 0 }; g.forEach((row, d) => row.forEach((v, h) => { if (v > peak.v) peak = { d, h, v }; }));
  const hs = g.flatMap((row) => row.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0);
  const heat = { noTimeLark: timed.length < sold.length, g, max: Math.max(1, ...g.flat()), peak, hours: (hs.length ? [Math.min(8, ...hs), Math.max(21, ...hs)] : [8, 21]) as [number, number] };
  const wd = Array.from({ length: 7 }, (_, d) => ({ label: DAYS()[d], cur: 0, prev: 0 }));
  for (const o of sold) wd[bkkWeekday(saleAt(o))].cur += o.grand_total;
  for (const o of pSold) wd[bkkWeekday(o.created_at)].prev += o.grand_total;
  const BUCKETS: [string, number][] = [["< 500", 500], ["500–1K", 1000], ["1K–3K", 3000], ["3K–5K", 5000], ["5K–10K", 10000], ["10K–20K", 20000], ["20K+", Infinity]];
  const basket = BUCKETS.map(([label]) => ({ label, value: 0 }));
  for (const o of sold) basket[BUCKETS.findIndex(([, lim]) => o.grand_total < lim)].value++;
  const noCat = tr("ไม่ระบุหมวด", "Uncategorized", "未分类"), noBrand = tr("ไม่ระบุแบรนด์", "No brand", "未指定品牌");
  let categories = agg(sold.flatMap((o) => o.items.filter((i) => !i.is_gift).map((i) => [catName?.get((i.product_id && productCat?.get(i.product_id)) || "") ?? noCat, i.line_total] as [string, number]))).slice(0, 7);
  let catKind: "category" | "brand" = "category";
  if (categories.length === 1 && categories[0].label === noCat && brandName) {
    const byBrand = agg(sold.flatMap((o) => o.items.filter((i) => !i.is_gift).map((i) => [(i.brand_id && brandName.get(i.brand_id)) || noBrand, i.line_total] as [string, number]))).slice(0, 7);
    if (byBrand.some((r) => r.label !== noBrand)) { categories = byBrand; catKind = "brand"; }
  }
  const pm = new Map<string, { name: string; qty: number; sales: number }>();
  for (const o of sold) for (const i of o.items) { if (i.is_gift) continue; const c = pm.get(i.sku) ?? { name: i.name, qty: 0, sales: 0 }; c.qty += i.qty; c.sales += i.line_total; pm.set(i.sku, c); }
  const topProducts = [...pm.entries()].map(([sku, v]) => ({ sku, ...v })).sort((a, b) => b.sales - a.sales).slice(0, 7);
  const topBranches = agg(sold.map((o) => [o.branch_id, o.grand_total])).slice(0, 6).map((r) => { const b = branches.find((x) => x.id === r.label); return { id: r.label, name: b ? b.name_th ?? b.name : r.label, value: r.value }; });
  const sm = new Map<string, { v: number; n: number }>();
  for (const o of sold) { const id = o.salesperson_id ?? o.cashier_id; if (!id) continue; const c = sm.get(id) ?? { v: 0, n: 0 }; c.v += o.grand_total; c.n++; sm.set(id, c); }
  const topStaff = [...sm.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 6).map(([id, c]) => ({ id, name: empName(employees.find((e) => e.id === id)), value: c.v, bills: c.n }));
  const sparkN = Math.min(trend.cur.length, 30);
  return { kpi, spark: trend.cur.slice(-sparkN), trend, pay, ch, heat, weekday: wd, basket, categories, catKind, topProducts, topBranches, topStaff };
}

export const COLORS = ["rgb(var(--chart-1))", "rgb(var(--chart-2))", "rgb(var(--chart-3))", "rgb(var(--chart-4))", "rgb(var(--chart-5))"];
export function Donut({ rows }: { rows: { label: string; value: number }[] }) {
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="w-[110px] h-[110px] shrink-0 -rotate-90">
        <circle cx="55" cy="55" r={R} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth="16" />
        {rows.slice(0, 5).map((r, i) => { const len = (r.value / total) * C; const el = <circle key={r.label} cx="55" cy="55" r={R} fill="none" stroke={COLORS[i % 5]} strokeWidth="16" strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`} strokeDashoffset={-acc} />; acc += len; return el; })}
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {rows.slice(0, 5).map((r, i) => (
          <p key={r.label} className="text-xs flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % 5] }} /><span className="truncate flex-1">{r.label}</span><span className="tnum text-muted">{Math.round((r.value / total) * 100)}%</span></p>
        ))}
      </div>
    </div>
  );
}
export function Columns({ rows, fmt, highlightMax }: { rows: { label: string; value: number; prev?: number }[]; fmt?: (n: number) => string; highlightMax?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.prev ?? 0)));
  const top = Math.max(...rows.map((r) => r.value));
  return (
    <div className="flex items-end gap-1.5 h-[120px]">
      {rows.map((r) => (
        <div key={r.label} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full justify-end" title={`${r.label}: ${fmt ? fmt(r.value) : r.value}${r.prev !== undefined ? ` · ${tr("ก่อนหน้า", "Previous", "上期")} ${fmt ? fmt(r.prev) : r.prev}` : ""}`}>
          <div className="w-full flex items-end gap-[2px] h-full">
            {r.prev !== undefined ? <div className="flex-1 rounded-t-[3px] bg-muted/25" style={{ height: `${(r.prev / max) * 100}%` }} /> : null}
            <div className={`flex-1 rounded-t-[3px] ${highlightMax && r.value === top && top > 0 ? "bg-brand" : "bg-brand/55"}`} style={{ height: `${(r.value / max) * 100}%`, minHeight: r.value ? 2 : 0 }} />
          </div>
          <span className="text-[9.5px] text-muted truncate max-w-full">{r.label}</span>
        </div>
      ))}
    </div>
  );
}
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values), W = 80, H = 22;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i * W) / (values.length - 1)).toFixed(1)},${(H - (v / max) * (H - 2) - 1).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-20 h-[22px]" preserveAspectRatio="none"><path d={d} fill="none" stroke="rgb(var(--c-brand))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}
// จากยอดก่อนลด → สุทธิ (waterfall แนวนอนอ่านง่าย)
function Flow({ k }: { k: OverviewModel["kpi"] }) {
  const before = k.gross + k.disc;
  const rows = [
    { label: tr("ยอดก่อนส่วนลด", "Before discount", "折扣前金额"), value: before, tone: "bg-brand/40", sign: "" },
    { label: tr("หักส่วนลด", "Less discounts", "减折扣"), value: -k.disc, tone: "bg-warn", sign: "−" },
    { label: tr("ยอดขาย", "Sales", "销售额"), value: k.gross, tone: "bg-brand", sign: "" },
    { label: tr("หักคืนเงิน", "Less refunds", "减退款"), value: -k.refunds, tone: "bg-danger", sign: "−" },
    { label: tr("หักใบลดหนี้", "Less credit notes", "减红字发票"), value: -k.cn, tone: "bg-danger/70", sign: "−" },
    { label: tr("ยอดสุทธิ", "Net sales", "净销售额"), value: k.net, tone: "bg-ok", sign: "" },
  ];
  const max = Math.max(1, before);
  let run = before;
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const neg = r.value < 0; const start = neg ? run + r.value : 0; const w = Math.abs(r.value);
        if (neg) run += r.value; else if (i) run = r.value;
        return (
          <div key={r.label} className="grid grid-cols-[88px_1fr_76px] items-center gap-2 text-[11px]">
            <span className={`truncate ${r.sign ? "text-muted" : "font-medium"}`}>{r.label}</span>
            <div className="relative h-4 rounded bg-surface2/60"><div className={`absolute top-0 h-4 rounded ${r.tone}`} style={{ left: `${(start / max) * 100}%`, width: `${Math.max((w / max) * 100, w ? 0.8 : 0)}%` }} /></div>
            <span className={`tnum text-right ${neg ? "text-danger" : ""}`}>{r.sign}{baht(Math.abs(r.value))}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OverviewView({ m, onDrill }: { m: OverviewModel; onDrill?: (tab: "branch" | "staff" | "bills", patch?: Record<string, unknown>) => void }) {
  const k = m.kpi;
  const payTotal = m.pay.reduce((s, r) => s + r.value, 0), chTotal = m.ch.reduce((s, r) => s + r.value, 0);
  const { g, max, peak, hours } = m.heat;
  const drill = onDrill ?? (() => undefined);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="card px-3.5 py-3 min-w-0 ring-1 ring-brand/25 bg-brand/[0.04] col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between gap-1"><p className="text-[11px] text-muted">{tr("ยอดขาย", "Sales", "销售额")}</p><Delta v={pct(k.gross, k.pGross)} show={k.hasPrev} /></div>
          <div className="flex items-end justify-between gap-2 mt-1"><p className="text-lg font-bold tnum leading-tight text-brand truncate">{baht(k.gross)}</p><Spark values={m.spark} /></div>
          <p className="text-[10.5px] text-muted truncate mt-0.5">{k.hasPrev ? tr(`ช่วงก่อน ${baht(k.pGross)}`, `Prev. ${baht(k.pGross)}`, `上期 ${baht(k.pGross)}`) : "—"}</p>
        </div>
        <Kpi label={tr("ยอดสุทธิ (หลังคืน/ลดหนี้)", "Net (after refunds/credits)", "净额（扣除退款/红字）")} value={baht(k.net)} sub={k.refunds || k.cn ? tr(`คืน ${baht(k.refunds)} · ลดหนี้ ${baht(k.cn)}`, `Refunds ${baht(k.refunds)} · credits ${baht(k.cn)}`, `退款 ${baht(k.refunds)} · 红字 ${baht(k.cn)}`) : tr("ไม่มีคืนเงิน/ลดหนี้", "No refunds/credits", "无退款/红字")} />
        <Kpi label={tr("จำนวนบิล", "Bills", "单据数")} value={formatInt(k.bills)} delta={pct(k.bills, k.pBills)} showDelta={k.hasPrev} sub={k.voids ? tr(`ยกเลิก ${k.voids} บิล · ${baht(k.voidAmt)}`, `${k.voids} voided · ${baht(k.voidAmt)}`, `作废 ${k.voids} 张 · ${baht(k.voidAmt)}`) : tr("ไม่มีบิลยกเลิก", "No voided bills", "无作废单据")} />
        <Kpi label={tr("เฉลี่ยต่อบิล", "Avg per bill", "客单价")} value={baht(k.avg)} delta={pct(k.avg, k.pAvg)} showDelta={k.hasPrev && k.pBills > 0} sub={tr(`${formatInt(k.units)} ชิ้น · ${k.bills ? (k.units / k.bills).toFixed(1) : 0} ชิ้น/บิล`, `${formatInt(k.units)} units · ${k.bills ? (k.units / k.bills).toFixed(1) : 0} per bill`, `${formatInt(k.units)} 件 · ${k.bills ? (k.units / k.bills).toFixed(1) : 0} 件/单`)} />
        <Kpi label={tr("ส่วนลด", "Discounts", "折扣")} value={baht(k.disc)} sub={`${k.gross + k.disc > 0 ? ((k.disc / (k.gross + k.disc)) * 100).toFixed(1) : 0}% ${tr("ของยอดก่อนลด", "of pre-discount", "占折前金额")}`} tone="warn" />
        {k.showCost ? <Kpi label={tr("กำไรขั้นต้น", "Gross profit", "毛利")} value={baht(k.gp)} sub={`GP ${k.gross ? ((k.gp / (k.gross / 1.07)) * 100).toFixed(1) : 0}% ${tr("ของยอดก่อน VAT", "of pre-VAT", "占税前金额")}`} tone="ok" />
          : <Kpi label={tr("ลูกค้าสมาชิก", "Member customers", "会员顾客")} value={`${k.bills ? Math.round((k.members / k.bills) * 100) : 0}%`} sub={tr(`${formatInt(k.members)} จาก ${formatInt(k.bills)} บิล`, `${formatInt(k.members)} of ${formatInt(k.bills)} bills`, `${formatInt(k.bills)} 单中 ${formatInt(k.members)} 单`)} />}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2" title={m.trend.hourly ? tr("ยอดขายรายชั่วโมง", "Hourly sales", "每小时销售额") : m.trend.monthly ? tr("แนวโน้มยอดขายรายเดือน", "Monthly sales trend", "每月销售趋势") : tr("แนวโน้มยอดขายรายวัน", "Daily sales trend", "每日销售趋势")} icon={<TrendingUp size={14} className="text-brand" />}
          action={<span className="text-[10.5px] text-muted inline-flex items-center gap-3"><span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-brand rounded" />{tr("ช่วงนี้", "This period", "本期")}</span><span className="inline-flex items-center gap-1"><span className="w-3 border-t border-dashed border-muted" />{tr("ช่วงก่อนหน้า", "Previous period", "上期")}</span></span>}>
          {k.bills ? <Trend cur={m.trend.cur} prev={m.trend.prev} labels={m.trend.labels} /> : <p className="text-xs text-muted py-10 text-center">{tr("ไม่มียอดขายในช่วงนี้", "No sales in this period", "此期间暂无销售")}</p>}
        </Panel>
        <Panel title={tr("จากยอดก่อนลด → ยอดสุทธิ", "Pre-discount → net", "折前金额 → 净额")} icon={<ReceiptText size={14} className="text-brand" />}><Flow k={k} /></Panel>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel title={tr("วิธีรับชำระ", "Payment methods", "付款方式")} icon={<ReceiptText size={14} className="text-brand" />}>{payTotal ? <Donut rows={m.pay} /> : <p className="text-xs text-muted">{tr("ไม่มีข้อมูล", "No data", "暂无数据")}</p>}</Panel>
        <Panel title={tr("ช่องทางขาย", "Sales channels", "销售渠道")} icon={<Store size={14} className="text-brand" />}><Bars rows={m.ch.slice(0, 5)} total={chTotal} color="bg-[rgb(var(--chart-4))]" /></Panel>
        <Panel title={m.catKind === "brand" ? tr("สัดส่วนตามแบรนด์", "Share by brand", "品牌占比") : tr("หมวดสินค้า", "Categories", "商品类别")} icon={<Package size={14} className="text-brand" />} action={m.catKind === "brand" ? <span className="text-[10px] text-muted">{tr("สินค้ายังไม่ตั้งหมวด", "Products not categorized", "商品未设类别")}</span> : null}>{m.categories.length ? <Donut rows={m.categories} /> : <p className="text-xs text-muted">{tr("ไม่มีข้อมูล", "No data", "暂无数据")}</p>}</Panel>
        <Panel title={tr("ขนาดบิล (จำนวนบิล)", "Bill size (bill count)", "单据金额分布（单数）")} icon={<ReceiptText size={14} className="text-brand" />}><Columns rows={m.basket} highlightMax /></Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2" title={tr("ช่วงเวลาขายดี (วัน × ชั่วโมง)", "Peak times (day × hour)", "销售高峰（日 × 时）")} icon={<Clock size={14} className="text-brand" />}
          action={<span className="text-[10.5px] text-muted">{peak.v ? <>{tr("พีค", "Peak", "高峰")} {DAYS()[peak.d]} {String(peak.h).padStart(2, "0")}:00 · {baht(peak.v)}</> : null}{m.heat.noTimeLark ? <>{peak.v ? " · " : ""}{tr("ไม่รวมบิล Lark (ระบบเดิมไม่มีเวลาขาย)", "Excludes Lark bills (no sale time)", "不含 Lark 单据（无销售时间）")}</> : null}</span>}>
          <div className="overflow-x-auto">
            <div className="grid gap-[3px] min-w-[420px]" style={{ gridTemplateColumns: `28px repeat(${hours[1] - hours[0] + 1}, minmax(0,1fr))` }}>
              <span />
              {Array.from({ length: hours[1] - hours[0] + 1 }, (_, i) => <span key={i} className="text-[9px] text-muted text-center tnum">{(hours[0] + i) % 3 === 0 ? hours[0] + i : ""}</span>)}
              {g.map((row, d) => [
                <span key={`d${d}`} className="text-[10px] text-muted self-center">{DAYS()[d]}</span>,
                ...row.slice(hours[0], hours[1] + 1).map((v, i) => (
                  <span key={`${d}-${i}`} title={`${DAYS()[d]} ${hours[0] + i}:00 · ${baht(v)}`} className="h-5 rounded-[4px]" style={{ background: v ? `rgb(var(--c-brand) / ${0.12 + (v / max) * 0.88})` : "rgb(var(--c-surface-2))" }} />
                )),
              ])}
            </div>
          </div>
        </Panel>
        <Panel title={tr("รายวันในสัปดาห์", "By weekday", "按星期")} icon={<TrendingUp size={14} className="text-brand" />} action={k.hasPrev ? <span className="text-[10px] text-muted">{tr("เทา = ช่วงก่อนหน้า", "Grey = previous period", "灰色 = 上期")}</span> : null}>
          <Columns rows={m.weekday.map((w) => ({ label: w.label, value: w.cur, prev: k.hasPrev ? w.prev : undefined }))} fmt={baht} highlightMax />
        </Panel>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Panel title={tr("สินค้าขายดี", "Top products", "畅销商品")} icon={<Package size={14} className="text-brand" />}>
          {m.topProducts.length ? <ol className="space-y-2">{m.topProducts.map((p, i) => (
            <li key={p.sku} className="flex items-center gap-2.5 text-xs">
              <span className={`w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold shrink-0 ${i < 3 ? "bg-brand/12 text-brand" : "bg-surface2 text-muted"}`}>{i + 1}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block text-[10px] text-muted font-mono truncate">{p.sku}</span></span>
              <span className="text-right shrink-0 tnum"><span className="block font-semibold">{baht(p.sales)}</span><span className="block text-[10px] text-muted">{formatInt(p.qty)} {tr("ชิ้น", "pcs", "件")}</span></span>
            </li>))}</ol> : <p className="text-xs text-muted">{tr("ไม่มีข้อมูล", "No data", "暂无数据")}</p>}
        </Panel>
        <Panel title={tr("สาขาท็อป", "Top branches", "门店排行")} icon={<Store size={14} className="text-brand" />} action={onDrill ? <button onClick={() => drill("branch")} className="text-[11px] text-brand inline-flex items-center gap-0.5">{tr("ดูทุกสาขา", "All branches", "全部门店")}<ArrowUpRight size={12} /></button> : null}>
          <Bars rows={m.topBranches.map((b) => ({ label: b.name, value: b.value }))} total={k.gross} />
        </Panel>
        <Panel title={tr("พนักงานท็อป", "Top staff", "员工排行")} icon={<Users size={14} className="text-brand" />} action={onDrill ? <button onClick={() => drill("staff")} className="text-[11px] text-brand inline-flex items-center gap-0.5">{tr("ผลงานทั้งหมด", "All performance", "全部业绩")}<ArrowUpRight size={12} /></button> : null}>
          {m.topStaff.length ? <div className="space-y-2">{m.topStaff.map((st, i) => (
            <button key={st.id} disabled={!onDrill} onClick={() => drill("staff", { person: st.id })} className="w-full flex items-center gap-2.5 text-xs text-left hover:bg-surface2/60 rounded-lg -mx-1 px-1 py-0.5 disabled:hover:bg-transparent">
              <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold shrink-0 ${i === 0 ? "bg-warn/20 text-warn" : "bg-surface2 text-muted"}`}>{i + 1}</span>
              <span className="flex-1 truncate" translate="no">{st.name}</span><span className="text-muted tnum">{st.bills} {tr("บิล", "bills", "单")}</span><span className="font-semibold tnum w-24 text-right">{baht(st.value)}</span>
            </button>))}</div> : <p className="text-xs text-muted">{tr("ไม่มีข้อมูล", "No data", "暂无数据")}</p>}
        </Panel>
      </div>
      {k.refunds || k.cn || k.voids ? <p className="text-[11px] text-muted flex items-center gap-1.5"><RotateCcw size={12} />{tr("ยอดสุทธิ = ยอดขาย − คืนเงินจากใบรับคืน − ใบลดหนี้ส่วนลด (ลงตามวันที่เกิด) · บิลยกเลิกไม่นับในยอดขาย", "Net = sales − return refunds − discount credit notes (by occurrence date) · voided bills excluded", "净额 = 销售额 − 退货退款 − 折扣红字发票（按发生日期）· 作废单据不计入")}</p> : null}
    </div>
  );
}

export function SalesOverview(props: Parameters<typeof buildOverview>[0] & { onDrill: (tab: "branch" | "staff" | "bills", patch?: Record<string, unknown>) => void; onModel?: (m: OverviewModel) => void }) {
  const { onDrill, onModel, ...args } = props;
  const m = useMemo(() => buildOverview(args), [args.orders, args.adjustments, args.prev, args.branches, args.employees, args.showCost, args.range.from, args.range.to, args.productCat, args.catName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onModel?.(m); }, [m]); // eslint-disable-line react-hooks/exhaustive-deps
  return <OverviewView m={m} onDrill={onDrill} />;
}

// ── รายการบิล (แท็บแรก) ───────────────────────────────────────
type BillStatus = "all" | "sold" | "refund" | "void";
export function BillsView({ orders, branches, employees, showCost, owStatus, onExport }: {
  orders: Order[]; branches: Branch[]; employees: Employee[]; showCost: boolean; owStatus: Record<string, { ow_status?: string } | undefined>; onExport: () => void;
}) {
  const [st, setSt] = useState<BillStatus>("all"), [sort, setSort] = useState<"new" | "amount">("new"), [page, setPage] = useState(0);
  const [openBill, setOpenBill] = useState<Order | null>(null);
  const { employee } = useSession();
  const canTrace = !employee || can(employee, "sales.trace");
  const PER = 50;
  const counts = useMemo(() => ({ all: orders.length, sold: orders.filter((o) => o.status === "completed").length, refund: orders.filter((o) => o.status === "refunded" || o.status === "partially_refunded").length, void: orders.filter((o) => o.status === "voided").length }), [orders]);
  const list = useMemo(() => {
    const f = orders.filter((o) => st === "all" || (st === "sold" ? o.status === "completed" : st === "refund" ? o.status === "refunded" || o.status === "partially_refunded" : o.status === "voided"));
    return sort === "amount" ? [...f].sort((a, b) => b.grand_total - a.grand_total) : [...f].sort((a, b) => saleAt(b).localeCompare(saleAt(a)));
  }, [orders, st, sort]);
  const pages = Math.max(1, Math.ceil(list.length / PER)), cur = Math.min(page, pages - 1);
  const shown = list.slice(cur * PER, cur * PER + PER);
  const bName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? b.name_th ?? b.name : "—"; };
  const STATUS: Record<string, [string, string]> = { completed: [tr("ขายแล้ว", "Sold", "已售"), "bg-ok/12 text-ok"], partially_refunded: [tr("คืนบางส่วน", "Partly refunded", "部分退款"), "bg-warn/15 text-warn"], refunded: [tr("คืนครบ", "Refunded", "全额退款"), "bg-warn/15 text-warn"], voided: [tr("ยกเลิก", "Voided", "已作废"), "bg-danger/10 text-danger"] };
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <Segmented<BillStatus> size="sm" value={st} onChange={(v) => { setSt(v); setPage(0); }} options={[
          { value: "all", label: `${tr("ทั้งหมด", "All", "全部")} ${formatInt(counts.all)}` }, { value: "sold", label: `${tr("ขายแล้ว", "Sold", "已售")} ${formatInt(counts.sold)}` },
          { value: "refund", label: `${tr("คืนเงิน", "Refunds", "退款")} ${formatInt(counts.refund)}` }, { value: "void", label: `${tr("ยกเลิก", "Voided", "已作废")} ${formatInt(counts.void)}` }]} />
        <Segmented<"new" | "amount"> size="sm" value={sort} onChange={setSort} options={[{ value: "new", label: tr("ล่าสุด", "Latest", "最新") }, { value: "amount", label: tr("ยอดสูงสุด", "Highest", "金额最高") }]} />
        <button onClick={onExport} className="ml-auto text-xs text-muted hover:text-ink">{tr("ส่งออก CSV", "Export CSV", "导出 CSV")}</button>
      </div>
      {shown.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2/50 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">{tr("เลขบิล", "Bill no.", "单号")}</th><th className="text-left font-medium px-2 py-2">{tr("เวลา", "Time", "时间")}</th><th className="text-left font-medium px-2 py-2">{tr("สาขา", "Branch", "门店")}</th>
              <th className="text-left font-medium px-2 py-2">{tr("พนักงาน", "Staff", "员工")}</th><th className="text-left font-medium px-2 py-2">{tr("ลูกค้า", "Customer", "顾客")}</th><th className="text-left font-medium px-2 py-2">{tr("สินค้า", "Products", "商品")}</th>
              <th className="text-left font-medium px-2 py-2">{tr("ชำระ", "Payment", "付款")}</th><th className="text-center font-medium px-2 py-2">{tr("สถานะ", "Status", "状态")}</th><th className="text-center font-medium px-2 py-2">JST</th>
              <th className="text-right font-medium px-2 py-2">{tr("ยอด", "Amount", "金额")}</th>{showCost ? <th className="text-right font-medium px-2 py-2">{tr("กำไร", "Profit", "利润")}</th> : null}<th className="w-6" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {shown.map((o) => {
                const s = STATUS[o.status] ?? [o.status, "bg-surface2 text-muted"];
                const items = o.items.filter((i) => !i.is_gift);
                const staff = employees.find((e) => e.id === (o.salesperson_id ?? o.cashier_id));
                return (
                  <tr key={o.id} tabIndex={canTrace ? 0 : -1} onClick={canTrace ? () => setOpenBill(o) : undefined} onKeyDown={(e) => { if (canTrace && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpenBill(o); } }}
                    title={canTrace ? tr("กดเพื่อดูรายละเอียดและที่มาของบิล", "Click to view bill details and trace", "点击查看单据详情与来源") : undefined}
                    className={`group transition-colors ${canTrace ? "cursor-pointer hover:bg-brand/[0.045] focus-visible:outline-none focus-visible:bg-brand/[0.07]" : ""} ${openBill?.id === o.id ? "bg-brand/[0.07]" : ""}`}>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><span className={`w-1 h-4 rounded-full transition-colors ${openBill?.id === o.id ? "bg-brand" : "bg-transparent group-hover:bg-brand/40"}`} />{o.order_no}</span></td>
                    <td className="px-2 py-2 text-muted whitespace-nowrap tnum">{new Date(saleAt(o)).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-2 py-2 max-w-[160px] truncate">{bName(o.branch_id)}</td>
                    <td className="px-2 py-2 max-w-[120px] truncate">{empName(staff)}</td>
                    <td className="px-2 py-2 max-w-[130px] truncate">{o.customer_name ? <span translate="no">{o.customer_name}</span> : <span className="text-muted">{tr("ทั่วไป", "Walk-in", "散客")}</span>}</td>
                    <td className="px-2 py-2 max-w-[200px] truncate" title={items.map((i) => `${i.sku} ×${i.qty}`).join(", ")}>{items[0]?.name ?? "—"}{items.length > 1 ? <span className="text-muted"> +{items.length - 1}</span> : null}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{[...new Set(o.payments.map((p) => PAY()[p.method] ?? p.method))].join(" + ") || "—"}</td>
                    <td className="px-2 py-2 text-center"><span className={`inline-block px-1.5 py-0.5 rounded-md text-[10.5px] font-medium ${s[1]}`}>{s[0]}</span></td>
                    <td className="px-2 py-2 text-center"><OwSaleBadge status={(o.client_uuid ? owStatus[o.client_uuid] : null) as never} /></td>
                    <td className={`px-2 py-2 text-right font-semibold tnum whitespace-nowrap ${o.status === "voided" ? "line-through text-muted" : ""}`}>{baht(o.grand_total)}</td>
                    {showCost ? <td className="px-2 py-2 text-right tnum text-ok whitespace-nowrap">{baht(o.gross_profit)}</td> : null}
                    <td className="pr-3 pl-1 py-2 w-6 text-muted">{canTrace ? <ChevronRight size={14} className="opacity-30 group-hover:opacity-100 group-hover:text-brand group-hover:translate-x-0.5 transition" /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted text-center py-10">{tr("ไม่มีบิลตามตัวกรอง", "No bills match the filter", "没有符合筛选的单据")}</p>}
      {openBill ? <OrderTraceDrawer key={openBill.id} clientUuid={openBill.client_uuid} orderNo={openBill.order_no} onClose={() => setOpenBill(null)} /> : null}
      {pages > 1 ? (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-line text-xs">
          <span className="text-muted">{formatInt(cur * PER + 1)}–{formatInt(Math.min(list.length, cur * PER + PER))} {tr("จาก", "of", "/")} {formatInt(list.length)}</span>
          <span className="flex gap-1"><button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="h-7 px-2.5 rounded-lg border border-line disabled:opacity-40">{tr("ก่อนหน้า", "Prev", "上一页")}</button><button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="h-7 px-2.5 rounded-lg border border-line disabled:opacity-40">{tr("ถัดไป", "Next", "下一页")}</button></span>
        </div>
      ) : null}
    </div>
  );
}
