"use client";
// =====================================================================
// Admin → การเงิน (Finance) — หน้าเดียวรวม: ภาพรวม + ตัวกรองร่วม (ไม่แยกแท็บหมวด)
//   ซื่อสัตย์ต่อข้อมูล: ไม่เรียก payment ว่า "เงินเข้า", แยก "ไม่ระบุ" จาก 0,
//   settlement ยังไม่เชื่อม → "ยังไม่เชื่อมข้อมูล" ไม่ปั้นเลข
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Wallet, CreditCard, Receipt, AlertTriangle, Landmark, Clock, Store, RotateCcw, ChevronRight, Link2Off, Loader2, TrendingUp, Globe2, MapPin, CalendarRange } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders } from "@/lib/data/repo";
import type { Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, EmptyState, KpiTile, Segmented } from "@/components/ui";
import { ExportShareBar } from "@/components/admin/export-share";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders } from "@/lib/analytics";
import { financeSummary, byPaymentDetail, byAcquirer, financeByBranch, bucketOf, paymentLabel } from "@/lib/finance";
import { formatTHB, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";
import { SalesAreaTrend, InsightBars, RankedBars } from "@/components/charts-rich";
import { Donut, BarList, Sparkline } from "@/components/charts";
import type { ChartConfig } from "@/components/ui/chart";

type Detail = "paid" | "branch" | "refund" | "edc";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const SYSTEM = new Set(["card", "transfer", "qr"]);

interface PayRow { id: string; orderNo: string; at: string; branchId: string; branch: string; method: string; methodLabel: string; amount: number; ref: string | null; bucket: string; fee: number | null }

export default function AdminFinancePage() {
  const { locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Detail>("paid");
  const [view, setView] = useState<"dash" | "table">("dash");
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  useEffect(() => { void listOrders().then((o) => { setOrders(o); setLoading(false); }); }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);
  const rows = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);
  const branchName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id; };

  const pays = useMemo<PayRow[]>(() => {
    const out: PayRow[] = [];
    for (const o of rows) {
      if (o.status === "voided") continue;
      o.payments.forEach((p, i) => {
        const feeRaw = (p as unknown as { fee_amount?: number }).fee_amount;
        out.push({ id: `${o.id}-${i}`, orderNo: o.order_no, at: o.created_at, branchId: o.branch_id, branch: branchName(o.branch_id), method: p.method, methodLabel: paymentLabel(p.method, locale), amount: p.amount, ref: p.reference_no ?? null, bucket: bucketOf(p.method), fee: feeRaw ?? null });
      });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [rows, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = useMemo(() => financeSummary(rows), [rows]);
  // ช่วงก่อนหน้า (เท่ากัน) สำหรับ delta % แบบหน้า dashboard
  const prevSum = useMemo(() => {
    if (!filter.from || !filter.to) return null;
    const len = filter.to.getTime() - filter.from.getTime();
    const pf = new Date(filter.from.getTime() - len - 1), pt = new Date(filter.from.getTime() - 1);
    return financeSummary(filterOrders(scoped, { from: pf, to: pt, branchIds: filter.branchIds, brandIds: filter.brandIds, branches }));
  }, [scoped, filter, branches]);
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const systemPaid = useMemo(() => pays.filter((p) => SYSTEM.has(p.bucket)).reduce((s, p) => s + p.amount, 0), [pays]);
  const toReview = useMemo(() => pays.filter((p) => SYSTEM.has(p.bucket) && !p.ref), [pays]);
  const feeKnown = useMemo(() => { const sysc = pays.filter((p) => SYSTEM.has(p.bucket)); return { known: sysc.filter((p) => p.fee !== null).length, total: sysc.length }; }, [pays]);
  const feeIncomplete = feeKnown.total > 0 && feeKnown.known < feeKnown.total;
  const refunds = useMemo(() => rows.filter((o) => o.status === "voided" || o.status === "refunded" || o.status === "partially_refunded")
    .map((o) => ({ id: o.id, orderNo: o.order_no, at: o.created_at, branch: branchName(o.branch_id), status: o.status, amount: o.grand_total, reason: o.void_reason ?? null }))
    .sort((a, b) => (a.at < b.at ? 1 : -1)), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const byPay = useMemo(() => byPaymentDetail(rows, locale), [rows, locale]);
  const byAcq = useMemo(() => byAcquirer(rows), [rows]);
  const byBr = useMemo(() => financeByBranch(rows, branches, locale), [rows, branches, locale]);
  // ภูมิศาสตร์: โซน (กทม/ปริมณฑล/ต่างจังหวัด) · รายจังหวัด · รายเดือน
  const PERI = useMemo(() => new Set(["นนทบุรี", "สมุทรปราการ", "ปทุมธานี", "สมุทรสาคร", "นครปฐม"]), []);
  const geo = useMemo(() => {
    const provMap = new Map(branches.map((b) => [b.id, b.province ?? "—"]));
    const zoneOf = (p: string) => (p === "กรุงเทพมหานคร" ? L("กรุงเทพฯ", "Bangkok", "曼谷") : PERI.has(p) ? L("ปริมณฑล", "Greater BKK", "周边") : L("ต่างจังหวัด", "Upcountry", "外府"));
    const prov = new Map<string, number>(), zone = new Map<string, number>(), month = new Map<string, number>();
    for (const o of rows) {
      if (o.status === "voided") continue;
      const p = provMap.get(o.branch_id) ?? "—"; const z = zoneOf(p); const m = o.created_at.slice(0, 7);
      prov.set(p, (prov.get(p) ?? 0) + o.grand_total);
      zone.set(z, (zone.get(z) ?? 0) + o.grand_total);
      month.set(m, (month.get(m) ?? 0) + o.grand_total);
    }
    return {
      zone: [...zone.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      province: [...prov.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      month: [...month.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, v]) => ({ label: `${m.slice(5)}/${m.slice(2, 4)}`, value: v })),
    };
  }, [rows, branches, PERI]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => {
    const m = new Map<string, number>();
    pays.forEach((p) => m.set(dayKey(p.at), (m.get(dayKey(p.at)) ?? 0) + p.amount));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => ({ label: d.slice(5), value: v }));
  }, [pays]);

  if (employee && !can(employee, "finance.view")) {
    return <div className="p-6"><EmptyState icon={<Wallet size={28} />} title={L("ไม่มีสิทธิ์ดูการเงิน", "No finance access", "无财务权限")} body={L("ติดต่อเจ้าของกิจการเพื่อขอสิทธิ์ finance.view", "Ask the owner for finance.view", "请向企业主申请 finance.view")} /></div>;
  }

  const nf = (n: number) => formatTHB(n, false);
  const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "K" : String(Math.round(n)));
  const trendCfg: ChartConfig = { value: { label: L("ยอดชำระตามบิล", "Paid (by bill)", "账单收款"), color: "rgb(var(--chart-1))" } };
  const barCfg: ChartConfig = { value: { label: L("ยอดชำระ", "Paid", "收款"), color: "rgb(var(--chart-1))" } };
  const cardTotal = byPay.filter((p) => bucketOf(p.method) === "card").reduce((s, p) => s + p.value, 0);

  const DETAILS: { value: Detail; label: string; count: number }[] = [
    { value: "paid", label: L("รายการชำระ", "Payments", "收款"), count: pays.length },
    { value: "branch", label: L("รายสาขา", "By branch", "按门店"), count: byBr.length },
    { value: "refund", label: L("คืนเงิน", "Refunds", "退款"), count: refunds.length },
    { value: "edc", label: L("EDC / ธนาคาร", "EDC / Bank", "EDC/银行"), count: byAcq.length },
  ];
  const exportConf = (() => {
    if (detail === "branch") return { name: "finance-by-branch", rows: byBr as unknown as Record<string, unknown>[], cols: [
      { key: "label", label: L("สาขา", "Branch", "门店") }, { key: "gross", label: L("ยอดชำระ", "Paid", "收款"), map: (r: typeof byBr[number]) => nf(r.gross) },
      { key: "card", label: L("บัตร/EDC", "Card", "刷卡"), map: (r: typeof byBr[number]) => nf(r.card) }, { key: "transfer", label: L("โอน", "Transfer", "转账"), map: (r: typeof byBr[number]) => nf(r.transfer) },
      { key: "qr", label: "QR", map: (r: typeof byBr[number]) => nf(r.qr) }, { key: "net", label: L("สุทธิ", "Net", "净额"), map: (r: typeof byBr[number]) => nf(r.net) }, { key: "orders", label: L("บิล", "Bills", "单") }] };
    if (detail === "refund") return { name: "finance-refunds", rows: refunds as unknown as Record<string, unknown>[], cols: [
      { key: "at", label: L("วันที่", "Date", "日期"), map: (r: typeof refunds[number]) => dayKey(r.at) }, { key: "orderNo", label: L("บิลเดิม", "Bill", "原单") },
      { key: "branch", label: L("สาขา", "Branch", "门店") }, { key: "status", label: L("สถานะ", "Status", "状态") }, { key: "amount", label: L("ยอด", "Amount", "金额"), map: (r: typeof refunds[number]) => nf(r.amount) }] };
    if (detail === "edc") return { name: "finance-edc", rows: byAcq as unknown as Record<string, unknown>[], cols: [
      { key: "bank", label: L("ผู้รับบัตร/ธนาคาร", "Acquirer", "收单行") }, { key: "value", label: L("ยอดก่อนหัก", "Gross", "总额"), map: (r: typeof byAcq[number]) => nf(r.value) },
      { key: "fee", label: L("ค่าธรรมเนียม", "Fee", "手续费"), map: (r: typeof byAcq[number]) => r.fee ? nf(r.fee) : L("ไม่ระบุ", "N/A", "未知") }, { key: "count", label: L("ธุรกรรม", "Txns", "笔数") }] };
    return { name: "finance-payments", rows: pays as unknown as unknown as Record<string, unknown>[], cols: [
      { key: "at", label: L("วันชำระ", "Date", "日期"), map: (r: PayRow) => dayKey(r.at) }, { key: "orderNo", label: L("บิล", "Bill", "单号") }, { key: "branch", label: L("สาขา", "Branch", "门店") },
      { key: "methodLabel", label: L("วิธีชำระ", "Method", "方式") }, { key: "amount", label: L("ยอด", "Amount", "金额"), map: (r: PayRow) => nf(r.amount) },
      { key: "ref", label: L("เลขอ้างอิง", "Reference", "参考号"), map: (r: PayRow) => r.ref ?? L("ไม่ระบุ", "N/A", "未填") }, { key: "fee", label: L("ค่าธรรมเนียม", "Fee", "手续费"), map: (r: PayRow) => r.fee === null ? L("ไม่ระบุ", "N/A", "未知") : nf(r.fee) }] };
  })();

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      {/* หัว */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-brand/12 grid place-items-center shrink-0"><Landmark size={20} className="text-brand" /></span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{L("การเงิน", "Finance", "财务")}</h1>
            <p className="text-sm text-muted mt-0.5">{L("ยอดรับชำระ สถานะเงิน และรายการที่ต้องติดตาม", "Payments, money status & follow-ups", "收款、资金状态与待跟进")}</p>
          </div>
        </div>
        <ExportShareBar filename={exportConf.name} title={L("การเงิน", "Finance", "财务")} rows={exportConf.rows} columns={exportConf.cols as never} size="sm" />
      </div>

      {/* ตัวกรองร่วม — ตัวเดียวคุมทั้งหน้า */}
      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {loading ? (
        <Card className="p-20 text-center text-muted"><Loader2 className="inline animate-spin mr-2" size={18} /> {L("กำลังเตรียมข้อมูลการเงิน…", "Preparing finance data…", "正在准备财务数据…")}</Card>
      ) : (<>
        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label={L("ยอดชำระตามบิล", "Paid (by bill)", "账单收款")} value={`฿${nf(sum.gross)}`} delta={prevSum ? pct(sum.gross, prevSum.gross) : null} sub={L(`${formatInt(sum.orders)} บิล · เทียบช่วงก่อน`, `${formatInt(sum.orders)} bills · vs prev`, "对比上期")} icon={<Wallet size={15} />} variant="ink" spark={trend.length ? <Sparkline values={trend.map((t) => t.value)} color="rgba(255,255,255,0.92)" fill height={28} /> : undefined} />
          <KpiTile label={L("สุทธิคาดรับ", "Net expected", "预计净收")} value={`฿${nf(sum.net)}`} delta={prevSum ? pct(sum.net, prevSum.net) : null} sub={feeIncomplete ? L(`หักค่าธรรมเนียม ฿${nf(sum.fee)} · ยังไม่ครบ`, `less fee ฿${nf(sum.fee)} · incomplete`, "手续费不全") : L(`หักค่าธรรมเนียม ฿${nf(sum.fee)}`, `less fee ฿${nf(sum.fee)}`, "扣手续费")} icon={<Receipt size={15} />} accent="lavender" />
          <KpiTile label={L("รอเงินเข้า (ยังไม่จับคู่)", "Awaiting settlement", "待入账")} value={`฿${nf(systemPaid)}`} sub={L("ยังไม่เชื่อมข้อมูลธนาคาร", "bank not connected", "未接银行")} icon={<Clock size={16} />} accent="peach" />
          <KpiTile label={L("ต้องตรวจสอบ", "To review", "需核查")} value={`${formatInt(toReview.length)}`} sub={L("ขาดเลขอ้างอิง/หลักฐาน", "missing reference", "缺参考号")} icon={<AlertTriangle size={16} />} accent={toReview.length ? "coral" : "neutral"} />
        </div>

        {/* สวิตช์มุมมอง: Dashboard | คอลัมน์ */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-muted">{filter.branchIds.length ? `${filter.branchIds.length} ${L("สาขา", "branches", "门店")}` : L("ทุกสาขา", "All branches", "全部")} · {formatInt(sum.orders)} {L("บิล", "bills", "单")}</span>
          <Segmented value={view} onChange={(v) => setView(v as "dash" | "table")} options={[{ value: "dash", label: L("Dashboard", "Dashboard", "仪表板") }, { value: "table", label: L("มุมมองคอลัมน์", "Columns", "列视图") }]} />
        </div>

        {view === "dash" ? (<>
        {/* ───────── bento dashboard ───────── */}
        <div className="grid grid-cols-12 gap-4">
          {/* แนวโน้ม (ย่อลง col-8) */}
          <Card className="col-span-12 lg:col-span-8 p-4">
            <CardHeader title={<span className="inline-flex items-center gap-1.5"><TrendingUp size={15} className="text-brand" /> {L("แนวโน้มยอดชำระ", "Payment trend", "收款趋势")}</span>} subtitle={L("รายวัน · บาท", "daily · THB", "每日 · 泰铢")} />
            <div className="mt-2">{trend.length ? <SalesAreaTrend data={trend} config={trendCfg} valueFormat={nf} className="aspect-auto h-44 w-full" /> : <p className="py-10 text-center text-xs text-muted">{L("ไม่มีข้อมูลในช่วงนี้", "No data", "暂无数据")}</p>}</div>
          </Card>
          {/* วิธีรับชำระ */}
          <Card className="col-span-12 lg:col-span-4 p-4">
            <CardHeader title={L("วิธีรับชำระ", "Methods", "方式")} subtitle={L("สัดส่วนตามวิธีจ่าย", "by method", "按方式")} right={<CreditCard size={16} className="text-muted" />} />
            <div className="mt-3">{byPay.length ? <Donut size={148} thickness={20} data={byPay.map((p) => ({ label: p.label, value: p.value }))} centerValue={`฿${compact(sum.gross)}`} centerLabel={L("ยอดรวม", "Total", "合计")} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
          </Card>
          {/* ตามโซน */}
          <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-4">
            <CardHeader title={L("ตามโซน", "By zone", "按区域")} subtitle={L("กทม · ปริมณฑล · ต่างจังหวัด", "BKK · Greater · Upcountry", "曼谷·周边·外府")} right={<Globe2 size={16} className="text-muted" />} />
            <div className="mt-3">{geo.zone.length ? <Donut size={148} thickness={20} data={geo.zone.map((z) => ({ label: z.label, value: z.value }))} centerValue={`${geo.zone.length}`} centerLabel={L("โซน", "zones", "区")} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
          </Card>
          {/* ตามจังหวัด */}
          <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-4">
            <CardHeader title={L("ตามจังหวัด", "By province", "按省")} subtitle={L("ยอดสูงสุด", "top", "排名")} right={<MapPin size={16} className="text-muted" />} />
            <div className="mt-3">{geo.province.length ? <BarList data={geo.province.slice(0, 7).map((p) => ({ label: p.label, value: p.value }))} valueFormat={nf} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
          </Card>
          {/* รายสาขา */}
          <Card className="col-span-12 lg:col-span-4 p-4">
            <CardHeader title={L("ยอดชำระรายสาขา", "By branch", "按门店")} subtitle={L("อันดับสูงสุด", "top", "排名")} right={<Store size={16} className="text-muted" />} />
            <div className="mt-3">{byBr.length ? <RankedBars data={byBr.slice(0, 7).map((b, i) => ({ label: b.label, value: b.gross, highlight: i === 0 }))} valueFormat={nf} onBarClick={() => setDetail("branch")} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
          </Card>
          {/* รายเดือน */}
          <Card className="col-span-12 lg:col-span-8 p-4">
            <CardHeader title={L("ยอดชำระรายเดือน", "Monthly", "按月")} subtitle={L("เทียบแต่ละเดือน", "month by month", "逐月对比")} right={<CalendarRange size={16} className="text-muted" />} />
            <div className="mt-3">{geo.month.length > 1 ? <SalesAreaTrend data={geo.month.map((m) => ({ label: m.label, value: m.value }))} config={trendCfg} valueFormat={nf} className="aspect-auto h-40 w-full" /> : geo.month.length ? <InsightBars data={geo.month.map((m) => ({ label: m.label, value: m.value, highlight: true }))} config={barCfg} valueFormat={nf} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
          </Card>
          {/* ต้องดำเนินการ */}
          <Card className="col-span-12 lg:col-span-4 p-4">
            <CardHeader title={L("ต้องดำเนินการ", "To do", "待处理")} subtitle={L("งานค้างที่ต้องตามต่อ", "Follow-up items", "跟进项")} right={<AlertTriangle size={15} className="text-amber-500" />} />
            <div className="mt-1 divide-y divide-line">
              <button onClick={() => setDetail("paid")} className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:opacity-80">
                <div><p className="text-sm font-medium">{L("เลขอ้างอิง / หลักฐานไม่ครบ", "Missing reference / proof", "缺参考号/凭证")}</p><p className="text-[11px] text-muted">{formatInt(toReview.length)} {L("รายการในตัวกรองนี้", "items in filter", "项")}</p></div>
                <ChevronRight size={16} className="text-muted shrink-0" />
              </button>
              <button onClick={() => setDetail("refund")} className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:opacity-80">
                <div><p className="text-sm font-medium inline-flex items-center gap-1.5"><RotateCcw size={13} className="text-muted" /> {L("คืนเงิน / ยกเลิกบิล", "Refunds / voids", "退款/作废")}</p><p className="text-[11px] text-muted">{formatInt(refunds.length)} {L("รายการ · ฿", "items · ฿", "项 · ฿")}{nf(refunds.reduce((s, r) => s + r.amount, 0))}</p></div>
                <ChevronRight size={16} className="text-muted shrink-0" />
              </button>
              <div className="flex items-center justify-between gap-2 py-2.5">
                <div className="inline-flex items-center gap-1.5"><Link2Off size={14} className="text-muted" /><div><p className="text-sm font-medium text-muted">{L("รอ settlement / จับคู่ธนาคาร", "Awaiting settlement", "待对账")}</p><p className="text-[11px] text-muted">{L("ยังไม่เชื่อมข้อมูลธนาคาร", "bank data not connected", "未接银行")}</p></div></div>
                <Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未接")}</Badge>
              </div>
            </div>
          </Card>
        </div>

        </>) : (
        /* ───────── มุมมองคอลัมน์ (ตาราง) ───────── */
        <Card>
          <div className="p-4 pb-3 flex items-center justify-between gap-3 flex-wrap border-b border-line">
            <h2 className="text-base font-semibold">{L("รายละเอียด", "Details", "明细")}</h2>
            <Segmented value={detail} onChange={(v) => setDetail(v as Detail)} options={DETAILS.map((d) => ({ value: d.value, label: `${d.label} (${formatInt(d.count)})` }))} />
          </div>
          <div className="overflow-x-auto">
            {detail === "paid" && (
              <Table>
                <thead><tr><Th>{L("วันชำระ", "Date", "日期")}</Th><Th>{L("บิล", "Bill", "单号")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("วิธีชำระ", "Method", "方式")}</Th><Th align="right">{L("ยอด", "Amount", "金额")}</Th><Th>{L("เลขอ้างอิง", "Reference", "参考号")}</Th><Th align="right">{L("ค่าธรรมเนียม", "Fee", "手续费")}</Th></tr></thead>
                <tbody>{pays.slice(0, 400).map((p) => (
                  <tr key={p.id}>
                    <Td className="text-xs whitespace-nowrap">{dayKey(p.at)}</Td>
                    <Td className="font-mono text-[11px] text-muted">{p.orderNo}</Td>
                    <Td className="text-xs text-muted">{p.branch}</Td>
                    <Td className="text-xs">{p.methodLabel}</Td>
                    <Td align="right" className="tnum font-medium">{nf(p.amount)}</Td>
                    <Td className="text-xs">{p.ref ? <span className="font-mono">{p.ref}</span> : (SYSTEM.has(p.bucket) ? <Badge tone="warn">{L("ไม่ระบุ", "N/A", "未填")}</Badge> : <span className="text-muted">—</span>)}</Td>
                    <Td align="right" className="text-xs">{p.fee === null ? <span className="text-muted">{L("ไม่ระบุ", "N/A", "未知")}</span> : <span className="tnum">{nf(p.fee)}</span>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
            {detail === "branch" && (
              <Table>
                <thead><tr><Th>{L("สาขา", "Branch", "门店")}</Th><Th align="right">{L("ยอดชำระ", "Paid", "收款")}</Th><Th align="right">{L("บัตร/EDC", "Card", "刷卡")}</Th><Th align="right">{L("โอน", "Transfer", "转账")}</Th><Th align="right">QR</Th><Th align="right">{L("ค่าธรรมเนียม", "Fee", "手续费")}</Th><Th align="right">{L("สุทธิ", "Net", "净额")}</Th><Th align="right">{L("บิล", "Bills", "单")}</Th></tr></thead>
                <tbody>{byBr.map((b) => (
                  <tr key={b.id}>
                    <Td className="text-sm font-medium">{b.label}</Td><Td align="right" className="tnum">{nf(b.gross)}</Td>
                    <Td align="right" className="tnum text-xs">{nf(b.card)}</Td><Td align="right" className="tnum text-xs">{nf(b.transfer)}</Td>
                    <Td align="right" className="tnum text-xs">{nf(b.qr)}</Td><Td align="right" className="tnum text-xs text-danger">{b.fee ? nf(b.fee) : "—"}</Td>
                    <Td align="right" className="tnum font-semibold">{nf(b.net)}</Td><Td align="right" className="tnum text-muted">{formatInt(b.orders)}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
            {detail === "refund" && (refunds.length ? (
              <Table>
                <thead><tr><Th>{L("วันที่", "Date", "日期")}</Th><Th>{L("บิลเดิม", "Bill", "原单")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("สถานะ", "Status", "状态")}</Th><Th align="right">{L("ยอด", "Amount", "金额")}</Th><Th>{L("เหตุผล", "Reason", "原因")}</Th></tr></thead>
                <tbody>{refunds.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-xs whitespace-nowrap">{dayKey(r.at)}</Td><Td className="font-mono text-[11px] text-muted">{r.orderNo}</Td>
                    <Td className="text-xs text-muted">{r.branch}</Td>
                    <Td><Badge tone={r.status === "voided" ? "danger" : "warn"}>{r.status === "voided" ? L("ยกเลิก", "Voided", "作废") : r.status === "refunded" ? L("คืนเต็ม", "Refunded", "全退") : L("คืนบางส่วน", "Partial", "部分退")}</Badge></Td>
                    <Td align="right" className="tnum">{nf(r.amount)}</Td>
                    <Td className="text-xs text-muted"><span className="block max-w-[220px] truncate" title={r.reason ?? ""}>{r.reason ?? "—"}</span></Td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <p className="py-12 text-center text-sm text-muted">{L("ไม่มีรายการคืนเงิน/ยกเลิก", "No refunds/voids", "无退款")}</p>)}
            {detail === "edc" && (byAcq.length ? (
              <Table>
                <thead><tr><Th>{L("ผู้รับบัตร/ธนาคาร", "Acquirer", "收单行")}</Th><Th align="right">{L("ยอดก่อนหัก", "Gross", "总额")}</Th><Th align="right">{L("ค่าธรรมเนียม", "Fee", "手续费")}</Th><Th align="right">{L("ยอดคาดรับ", "Expected net", "预计净")}</Th><Th>{L("วันคาดรับ", "Expected date", "预计日")}</Th><Th>{L("จับคู่", "Match", "对账")}</Th><Th align="right">{L("ธุรกรรม", "Txns", "笔数")}</Th></tr></thead>
                <tbody>{byAcq.map((a) => (
                  <tr key={a.bank}>
                    <Td className="text-sm font-medium">{a.bank}</Td><Td align="right" className="tnum">{nf(a.value)}</Td>
                    <Td align="right" className="text-xs">{a.fee ? <span className="tnum text-danger">{nf(a.fee)}</span> : <span className="text-muted">{L("ไม่ระบุ", "N/A", "未知")}</span>}</Td>
                    <Td align="right" className="tnum font-medium">{nf(a.value - a.fee)}</Td>
                    <Td><Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未接")}</Badge></Td><Td><Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未接")}</Badge></Td>
                    <Td align="right" className="tnum text-muted">{a.count}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <p className="py-12 text-center text-sm text-muted">{L("ไม่มีข้อมูลผู้รับบัตร", "No acquirer data", "无数据")}</p>)}
          </div>
        </Card>
        )}
      </>)}
    </div>
  );
}
