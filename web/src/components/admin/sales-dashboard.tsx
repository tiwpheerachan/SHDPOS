"use client";
// แดชบอร์ดหน้ายอดขาย (กะทัดรัด) + รายการบิล — ข้อมูลจริงจากระบบกลาง
//   ภาพรวม: KPI เทียบช่วงก่อนหน้า · ยอดสุทธิหลังหักคืน/ลดหนี้ · แนวโน้ม (ซ้อนช่วงก่อนหน้า) · ชำระ/ช่องทาง · แผนที่ความร้อน วัน×ชั่วโมง · สินค้า/สาขา/พนักงานท็อป
import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, Clock, Users, Store, Package, RotateCcw, ReceiptText } from "lucide-react";
import type { Branch, Employee, Order } from "@/lib/types";
import type { Adjustment, PrevOrder } from "@/lib/hooks/use-sales-data";
import { formatTHB, formatInt } from "@/lib/money";
import { isCountedSale, saleAt, bkkHour, bkkDay } from "@/lib/sales-basis";
import { OrderTraceButton } from "@/components/order-trace";
import { OwSaleBadge } from "@/components/pos/ow-sale-badge";
import { Segmented } from "@/components/ui";

const PAY: Record<string, string> = { cash: "เงินสด", credit_card: "บัตรเครดิต", debit_card: "บัตรเดบิต", qr_promptpay: "พร้อมเพย์", bank_transfer: "โอนเงิน", edc: "EDC", installment: "ผ่อนชำระ", gift_card: "บัตรของขวัญ", store_credit: "เครดิตร้าน", online_marketplace: "มาร์เก็ตเพลส", other: "อื่น ๆ" };
const CH: Record<string, string> = { offline: "หน้าร้าน", online_shopee: "Shopee", online_lazada: "Lazada", online_tiktok: "TikTok", online_website: "เว็บไซต์", event: "อีเวนต์", b2b: "ขายส่ง", other: "อื่น ๆ" };
const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const baht = (n: number) => formatTHB(n, false);
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);
const empName = (e?: Employee) => (e ? e.nickname || [e.first_name, (e as Employee & { last_name?: string }).last_name].filter(Boolean).join(" ") : "—");

function Delta({ v, show }: { v: number; show: boolean }) {
  if (!show) return null;
  const up = v > 0.5, down = v < -0.5;
  const I = up ? TrendingUp : down ? TrendingDown : Minus;
  return <span className={`inline-flex items-center gap-0.5 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md ${up ? "bg-ok/12 text-ok" : down ? "bg-danger/10 text-danger" : "bg-surface2 text-muted"}`}><I size={11} />{Math.abs(v) >= 1000 ? ">999" : Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%</span>;
}
function Kpi({ label, value, sub, delta, showDelta, tone }: { label: string; value: string; sub?: string; delta?: number; showDelta?: boolean; tone?: "brand" | "ok" | "warn" }) {
  return (
    <div className={`card px-3.5 py-3 min-w-0 ${tone === "brand" ? "ring-1 ring-brand/25 bg-brand/[0.04]" : ""}`}>
      <div className="flex items-center justify-between gap-1"><p className="text-[11px] text-muted truncate">{label}</p><Delta v={delta ?? 0} show={!!showDelta} /></div>
      <p className={`text-lg font-bold tnum leading-tight mt-1 truncate ${tone === "brand" ? "text-brand" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : ""}`}>{value}</p>
      {sub ? <p className="text-[10.5px] text-muted truncate mt-0.5">{sub}</p> : null}
    </div>
  );
}
function Panel({ title, icon, action, children, className = "" }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3"><p className="text-[13px] font-semibold flex items-center gap-1.5">{icon}{title}</p>{action}</div>
      {children}
    </div>
  );
}
function Bars({ rows, total, color = "bg-brand" }: { rows: { label: string; value: number; sub?: string }[]; total: number; color?: string }) {
  if (!rows.length) return <p className="text-xs text-muted">ไม่มีข้อมูล</p>;
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
          <b>{labels[hover]}</b> · {baht(cur[hover])}{prev[hover] ? <span className="text-muted"> · ก่อนหน้า {baht(prev[hover])}</span> : null}
        </div>
      ) : null}
      <div className="flex justify-between text-[10px] text-muted mt-1 tnum">{ticks.map((i) => <span key={i}>{labels[i]}</span>)}</div>
    </div>
  );
}

export function SalesOverview({ orders, adjustments, prev, branches, employees, showCost, range, onDrill }: {
  orders: Order[]; adjustments: Adjustment[]; prev: PrevOrder[]; branches: Branch[]; employees: Employee[]; showCost: boolean; range: { from: Date; to: Date };
  onDrill: (tab: "branch" | "staff" | "bills", patch?: Record<string, unknown>) => void;
}) {
  const sold = useMemo(() => orders.filter(isCountedSale), [orders]);
  const k = useMemo(() => {
    const gross = sold.reduce((s, o) => s + o.grand_total, 0), bills = sold.length;
    const units = sold.reduce((s, o) => s + o.items.reduce((a, i) => a + (i.is_gift ? 0 : i.qty), 0), 0);
    const disc = sold.reduce((s, o) => s + o.discount_total, 0), gp = sold.reduce((s, o) => s + o.gross_profit, 0);
    const members = sold.filter((o) => o.customer_id).length;
    const refunds = adjustments.filter((a) => a.kind === "return").reduce((s, a) => s + a.amount, 0);
    const cn = adjustments.filter((a) => a.kind === "credit_note").reduce((s, a) => s + a.amount, 0);
    const voids = orders.filter((o) => o.status === "voided");
    const pSold = prev.filter((o) => o.status === "completed" || o.status === "partially_refunded");
    const pGross = pSold.reduce((s, o) => s + o.grand_total, 0);
    return { gross, bills, units, disc, gp, members, refunds, cn, net: gross - refunds - cn, voids: voids.length, voidAmt: voids.reduce((s, o) => s + o.grand_total, 0),
      avg: bills ? gross / bills : 0, pGross, pBills: pSold.length, pAvg: pSold.length ? pGross / pSold.length : 0, hasPrev: prev.length > 0 };
  }, [sold, orders, adjustments, prev]);

  // แนวโน้ม: ช่วง ≤ 2 วัน = รายชั่วโมง · นอกนั้นรายวัน · ช่วงก่อนหน้าจัดตำแหน่งเดียวกัน
  const trend = useMemo(() => {
    const spanDays = Math.max(1, Math.round((+range.to - +range.from) / 86400_000));
    if (spanDays <= 2) {
      const cur = Array(24).fill(0), pv = Array(24).fill(0);
      for (const o of sold) cur[bkkHour(saleAt(o))] += o.grand_total;
      for (const o of prev) if (o.status !== "voided") pv[bkkHour(o.created_at)] += o.grand_total;
      return { cur, prev: pv, labels: cur.map((_, h) => `${String(h).padStart(2, "0")}:00`) };
    }
    const days: string[] = [];
    for (let d = new Date(range.from); d <= range.to && days.length < 400; d = new Date(+d + 86400_000)) days.push(bkkDay(d.toISOString()));
    const idx = new Map(days.map((d, i) => [d, i]));
    const cur = Array(days.length).fill(0), pv = Array(days.length).fill(0);
    for (const o of sold) { const i = idx.get(bkkDay(saleAt(o))); if (i !== undefined) cur[i] += o.grand_total; }
    const shift = +range.to - +range.from + 1;
    for (const o of prev) { if (o.status === "voided") continue; const i = idx.get(bkkDay(new Date(+new Date(o.created_at) + shift).toISOString())); if (i !== undefined) pv[i] += o.grand_total; }
    return { cur, prev: pv, labels: days.map((d) => { const [, m, dd] = d.split("-"); return `${+dd}/${+m}`; }) };
  }, [sold, prev, range]);

  const pay = useMemo(() => { const m = new Map<string, number>(); for (const o of sold) for (const p of o.payments) m.set(p.method, (m.get(p.method) ?? 0) + p.amount); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([kk, v]) => ({ label: PAY[kk] ?? kk, value: v })); }, [sold]);
  const ch = useMemo(() => { const m = new Map<string, number>(); for (const o of sold) m.set(o.channel, (m.get(o.channel) ?? 0) + o.grand_total); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([kk, v]) => ({ label: CH[kk] ?? kk, value: v })); }, [sold]);
  const heat = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const o of sold) { const t = new Date(saleAt(o)); const bkk = new Date(t.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })); g[bkk.getDay()][bkk.getHours()] += o.grand_total; }
    const max = Math.max(1, ...g.flat()); let peak = { d: 0, h: 0, v: 0 };
    g.forEach((row, d) => row.forEach((v, h) => { if (v > peak.v) peak = { d, h, v }; }));
    return { g, max, peak };
  }, [sold]);
  const hours = useMemo(() => { const hs = heat.g.flatMap((row) => row.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0); return hs.length ? [Math.min(8, ...hs), Math.max(21, ...hs)] : [8, 21]; }, [heat]); // แสดงช่วงเวลาทำการเต็มเสมอ
  const topProducts = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; sales: number }>();
    for (const o of sold) for (const i of o.items) { if (i.is_gift) continue; const c = m.get(i.sku) ?? { name: i.name, qty: 0, sales: 0 }; c.qty += i.qty; c.sales += i.line_total; m.set(i.sku, c); }
    return [...m.entries()].map(([sku, v]) => ({ sku, ...v })).sort((a, b) => b.sales - a.sales).slice(0, 6);
  }, [sold]);
  const topBranches = useMemo(() => {
    const m = new Map<string, number>(); for (const o of sold) m.set(o.branch_id, (m.get(o.branch_id) ?? 0) + o.grand_total);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => { const b = branches.find((x) => x.id === id); return { id, name: b ? b.name_th ?? b.name : id, value: v }; });
  }, [sold, branches]);
  const topStaff = useMemo(() => {
    const m = new Map<string, { v: number; n: number }>();
    for (const o of sold) { const id = o.salesperson_id ?? o.cashier_id; if (!id) continue; const c = m.get(id) ?? { v: 0, n: 0 }; c.v += o.grand_total; c.n++; m.set(id, c); }
    return [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 5).map(([id, c]) => ({ id, name: empName(employees.find((e) => e.id === id)), value: c.v, bills: c.n }));
  }, [sold, employees]);

  const payTotal = pay.reduce((s, r) => s + r.value, 0), chTotal = ch.reduce((s, r) => s + r.value, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="ยอดขาย" value={baht(k.gross)} delta={pct(k.gross, k.pGross)} showDelta={k.hasPrev} sub={k.hasPrev ? `ช่วงก่อน ${baht(k.pGross)}` : undefined} tone="brand" />
        <Kpi label="ยอดสุทธิ (หลังคืน/ลดหนี้)" value={baht(k.net)} sub={k.refunds || k.cn ? `คืน ${baht(k.refunds)} · ลดหนี้ ${baht(k.cn)}` : "ไม่มีคืนเงิน/ลดหนี้"} />
        <Kpi label="จำนวนบิล" value={formatInt(k.bills)} delta={pct(k.bills, k.pBills)} showDelta={k.hasPrev} sub={k.voids ? `ยกเลิก ${k.voids} บิล · ${baht(k.voidAmt)}` : "ไม่มีบิลยกเลิก"} />
        <Kpi label="เฉลี่ยต่อบิล" value={baht(k.avg)} delta={pct(k.avg, k.pAvg)} showDelta={k.hasPrev && k.pBills > 0} sub={`${formatInt(k.units)} ชิ้น · ${k.bills ? (k.units / k.bills).toFixed(1) : 0} ชิ้น/บิล`} />
        <Kpi label="ส่วนลด" value={baht(k.disc)} sub={`${k.gross + k.disc > 0 ? ((k.disc / (k.gross + k.disc)) * 100).toFixed(1) : 0}% ของยอดก่อนลด`} tone="warn" />
        {showCost ? <Kpi label="กำไรขั้นต้น" value={baht(k.gp)} sub={`GP ${k.gross ? ((k.gp / (k.gross / 1.07)) * 100).toFixed(1) : 0}% ของยอดก่อน VAT`} tone="ok" />
          : <Kpi label="ลูกค้าสมาชิก" value={`${k.bills ? Math.round((k.members / k.bills) * 100) : 0}%`} sub={`${formatInt(k.members)} จาก ${formatInt(k.bills)} บิล`} />}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2" title={trend.labels.length === 24 && trend.cur.length === 24 && +range.to - +range.from <= 2 * 86400_000 ? "ยอดขายรายชั่วโมง" : "แนวโน้มยอดขายรายวัน"} icon={<TrendingUp size={14} className="text-brand" />}
          action={<span className="text-[10.5px] text-muted inline-flex items-center gap-3"><span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-brand rounded" />ช่วงนี้</span><span className="inline-flex items-center gap-1"><span className="w-3 border-t border-dashed border-muted" />ช่วงก่อนหน้า</span></span>}>
          {sold.length ? <Trend cur={trend.cur} prev={trend.prev} labels={trend.labels} /> : <p className="text-xs text-muted py-10 text-center">ไม่มียอดขายในช่วงนี้</p>}
        </Panel>
        <Panel title="รับชำระ & ช่องทางขาย" icon={<ReceiptText size={14} className="text-brand" />}>
          <Bars rows={pay.slice(0, 5)} total={payTotal} />
          <div className="border-t border-line my-3" />
          <Bars rows={ch.slice(0, 4)} total={chTotal} color="bg-[rgb(var(--chart-4))]" />
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2" title="ช่วงเวลาขายดี (วัน × ชั่วโมง)" icon={<Clock size={14} className="text-brand" />}
          action={heat.peak.v ? <span className="text-[10.5px] text-muted">พีค {DAYS[heat.peak.d]} {String(heat.peak.h).padStart(2, "0")}:00 · {baht(heat.peak.v)}</span> : null}>
          <div className="overflow-x-auto">
            <div className="grid gap-[3px] min-w-[420px]" style={{ gridTemplateColumns: `28px repeat(${hours[1] - hours[0] + 1}, minmax(0,1fr))` }}>
              <span />
              {Array.from({ length: hours[1] - hours[0] + 1 }, (_, i) => <span key={i} className="text-[9px] text-muted text-center tnum">{(hours[0] + i) % 3 === 0 ? hours[0] + i : ""}</span>)}
              {heat.g.map((row, d) => [
                <span key={`d${d}`} className="text-[10px] text-muted self-center">{DAYS[d]}</span>,
                ...row.slice(hours[0], hours[1] + 1).map((v, i) => (
                  <span key={`${d}-${i}`} title={`${DAYS[d]} ${hours[0] + i}:00 · ${baht(v)}`} className="h-5 rounded-[4px]"
                    style={{ background: v ? `rgb(var(--c-brand) / ${0.12 + (v / heat.max) * 0.88})` : "rgb(var(--c-surface-2))" }} />
                )),
              ])}
            </div>
          </div>
        </Panel>
        <Panel title="สินค้าขายดี" icon={<Package size={14} className="text-brand" />}>
          {topProducts.length ? <ol className="space-y-2">{topProducts.map((p, i) => (
            <li key={p.sku} className="flex items-center gap-2.5 text-xs">
              <span className={`w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold shrink-0 ${i < 3 ? "bg-brand/12 text-brand" : "bg-surface2 text-muted"}`}>{i + 1}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block text-[10px] text-muted font-mono truncate">{p.sku}</span></span>
              <span className="text-right shrink-0 tnum"><span className="block font-semibold">{baht(p.sales)}</span><span className="block text-[10px] text-muted">{formatInt(p.qty)} ชิ้น</span></span>
            </li>))}</ol> : <p className="text-xs text-muted">ไม่มีข้อมูล</p>}
        </Panel>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="สาขาท็อป" icon={<Store size={14} className="text-brand" />} action={<button onClick={() => onDrill("branch")} className="text-[11px] text-brand inline-flex items-center gap-0.5">ดูทุกสาขา<ArrowUpRight size={12} /></button>}>
          <Bars rows={topBranches.map((b) => ({ label: b.name, value: b.value }))} total={k.gross} />
        </Panel>
        <Panel title="พนักงานท็อป" icon={<Users size={14} className="text-brand" />} action={<button onClick={() => onDrill("staff")} className="text-[11px] text-brand inline-flex items-center gap-0.5">ผลงานทั้งหมด<ArrowUpRight size={12} /></button>}>
          {topStaff.length ? <div className="space-y-2">{topStaff.map((s, i) => (
            <button key={s.id} onClick={() => onDrill("staff", { person: s.id })} className="w-full flex items-center gap-2.5 text-xs text-left hover:bg-surface2/60 rounded-lg -mx-1 px-1 py-0.5">
              <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold shrink-0 ${i === 0 ? "bg-warn/20 text-warn" : "bg-surface2 text-muted"}`}>{i + 1}</span>
              <span className="flex-1 truncate">{s.name}</span><span className="text-muted tnum">{s.bills} บิล</span><span className="font-semibold tnum w-24 text-right">{baht(s.value)}</span>
            </button>))}</div> : <p className="text-xs text-muted">ไม่มีข้อมูล</p>}
        </Panel>
      </div>
      {k.refunds || k.cn || k.voids ? (
        <p className="text-[11px] text-muted flex items-center gap-1.5"><RotateCcw size={12} />ยอดสุทธิ = ยอดขาย − คืนเงินจากใบรับคืน − ใบลดหนี้ส่วนลด (ลงตามวันที่เกิด) · บิลยกเลิกไม่นับในยอดขาย</p>
      ) : null}
    </div>
  );
}

// ── รายการบิล (แท็บแรก) ───────────────────────────────────────
type BillStatus = "all" | "sold" | "refund" | "void";
export function BillsView({ orders, branches, employees, showCost, owStatus, onExport }: {
  orders: Order[]; branches: Branch[]; employees: Employee[]; showCost: boolean; owStatus: Record<string, { ow_status?: string } | undefined>; onExport: () => void;
}) {
  const [st, setSt] = useState<BillStatus>("all"), [sort, setSort] = useState<"new" | "amount">("new"), [page, setPage] = useState(0);
  const PER = 50;
  const counts = useMemo(() => ({ all: orders.length, sold: orders.filter((o) => o.status === "completed").length, refund: orders.filter((o) => o.status === "refunded" || o.status === "partially_refunded").length, void: orders.filter((o) => o.status === "voided").length }), [orders]);
  const list = useMemo(() => {
    const f = orders.filter((o) => st === "all" || (st === "sold" ? o.status === "completed" : st === "refund" ? o.status === "refunded" || o.status === "partially_refunded" : o.status === "voided"));
    return sort === "amount" ? [...f].sort((a, b) => b.grand_total - a.grand_total) : [...f].sort((a, b) => saleAt(b).localeCompare(saleAt(a)));
  }, [orders, st, sort]);
  const pages = Math.max(1, Math.ceil(list.length / PER)), cur = Math.min(page, pages - 1);
  const shown = list.slice(cur * PER, cur * PER + PER);
  const bName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? b.name_th ?? b.name : "—"; };
  const STATUS: Record<string, [string, string]> = { completed: ["ขายแล้ว", "bg-ok/12 text-ok"], partially_refunded: ["คืนบางส่วน", "bg-warn/15 text-warn"], refunded: ["คืนครบ", "bg-warn/15 text-warn"], voided: ["ยกเลิก", "bg-danger/10 text-danger"] };
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <Segmented<BillStatus> size="sm" value={st} onChange={(v) => { setSt(v); setPage(0); }} options={[
          { value: "all", label: `ทั้งหมด ${formatInt(counts.all)}` }, { value: "sold", label: `ขายแล้ว ${formatInt(counts.sold)}` },
          { value: "refund", label: `คืนเงิน ${formatInt(counts.refund)}` }, { value: "void", label: `ยกเลิก ${formatInt(counts.void)}` }]} />
        <Segmented<"new" | "amount"> size="sm" value={sort} onChange={setSort} options={[{ value: "new", label: "ล่าสุด" }, { value: "amount", label: "ยอดสูงสุด" }]} />
        <button onClick={onExport} className="ml-auto text-xs text-muted hover:text-ink">ส่งออก CSV</button>
      </div>
      {shown.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2/50 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">เลขบิล</th><th className="text-left font-medium px-2 py-2">เวลา</th><th className="text-left font-medium px-2 py-2">สาขา</th>
              <th className="text-left font-medium px-2 py-2">พนักงาน</th><th className="text-left font-medium px-2 py-2">ลูกค้า</th><th className="text-left font-medium px-2 py-2">สินค้า</th>
              <th className="text-left font-medium px-2 py-2">ชำระ</th><th className="text-center font-medium px-2 py-2">สถานะ</th><th className="text-center font-medium px-2 py-2">JST</th>
              <th className="text-right font-medium px-2 py-2">ยอด</th>{showCost ? <th className="text-right font-medium px-4 py-2">กำไร</th> : null}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {shown.map((o) => {
                const s = STATUS[o.status] ?? [o.status, "bg-surface2 text-muted"];
                const items = o.items.filter((i) => !i.is_gift);
                const staff = employees.find((e) => e.id === (o.salesperson_id ?? o.cashier_id));
                return (
                  <tr key={o.id} className="hover:bg-surface2/50">
                    <td className="px-4 py-2 font-mono whitespace-nowrap"><span className="inline-flex items-center gap-1">{o.order_no}<OrderTraceButton clientUuid={o.client_uuid} orderNo={o.order_no} label="" className="h-6 w-6 grid place-items-center rounded-md border border-line hover:border-brand/50 hover:bg-brand/5" /></span></td>
                    <td className="px-2 py-2 text-muted whitespace-nowrap tnum">{new Date(saleAt(o)).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-2 py-2 max-w-[160px] truncate">{bName(o.branch_id)}</td>
                    <td className="px-2 py-2 max-w-[120px] truncate">{empName(staff)}</td>
                    <td className="px-2 py-2 max-w-[130px] truncate">{o.customer_name || <span className="text-muted">ทั่วไป</span>}</td>
                    <td className="px-2 py-2 max-w-[200px] truncate" title={items.map((i) => `${i.sku} ×${i.qty}`).join(", ")}>{items[0]?.name ?? "—"}{items.length > 1 ? <span className="text-muted"> +{items.length - 1}</span> : null}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{[...new Set(o.payments.map((p) => PAY[p.method] ?? p.method))].join(" + ") || "—"}</td>
                    <td className="px-2 py-2 text-center"><span className={`inline-block px-1.5 py-0.5 rounded-md text-[10.5px] font-medium ${s[1]}`}>{s[0]}</span></td>
                    <td className="px-2 py-2 text-center"><OwSaleBadge status={(o.client_uuid ? owStatus[o.client_uuid] : null) as never} /></td>
                    <td className={`px-2 py-2 text-right font-semibold tnum whitespace-nowrap ${o.status === "voided" ? "line-through text-muted" : ""}`}>{baht(o.grand_total)}</td>
                    {showCost ? <td className="px-4 py-2 text-right tnum text-ok whitespace-nowrap">{baht(o.gross_profit)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted text-center py-10">ไม่มีบิลตามตัวกรอง</p>}
      {pages > 1 ? (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-line text-xs">
          <span className="text-muted">{formatInt(cur * PER + 1)}–{formatInt(Math.min(list.length, cur * PER + PER))} จาก {formatInt(list.length)}</span>
          <span className="flex gap-1"><button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="h-7 px-2.5 rounded-lg border border-line disabled:opacity-40">ก่อนหน้า</button><button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="h-7 px-2.5 rounded-lg border border-line disabled:opacity-40">ถัดไป</button></span>
        </div>
      ) : null}
    </div>
  );
}
