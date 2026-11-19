"use client";
// =====================================================================
// Admin → การเงิน (Finance) — โครงใหม่: 4 หมวด + ตัวกรองร่วม + Dashboard/ตาราง
//   หมวด: เงินรับชำระ | EDC/ธนาคาร | คืนเงิน | รายสาขา
//   ซื่อสัตย์ต่อข้อมูล: ไม่เรียก payment ว่า "เงินเข้า", แยก "ไม่ระบุ" จาก 0,
//   settlement ยังไม่เชื่อม → แสดง "ยังไม่เชื่อมข้อมูล" ไม่ปั้นเลข
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Wallet, CreditCard, Receipt, AlertTriangle, Landmark, Clock, Store, RotateCcw, ChevronRight, Link2Off, Loader2 } from "lucide-react";
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
import { SalesAreaTrend, InsightBars } from "@/components/charts-rich";
import type { ChartConfig } from "@/components/ui/chart";

type Tab = "paid" | "edc" | "refund" | "branch";
type View = "dash" | "table";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const SYSTEM = new Set(["card", "transfer", "qr"]); // ถังที่คาดเข้าบัญชี (ไม่ใช่เงินสด)

interface PayRow { id: string; orderNo: string; at: string; branchId: string; branch: string; method: string; methodLabel: string; amount: number; ref: string | null; bucket: string; fee: number | null }

export default function AdminFinancePage() {
  const { locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("paid");
  const [view, setView] = useState<View>("dash");
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  useEffect(() => { void listOrders().then((o) => { setOrders(o); setLoading(false); }); }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);
  const rows = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);
  const branchName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id; };

  // ── payment-level (เฉพาะบิลที่ไม่ voided) ──
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
  const systemPaid = useMemo(() => pays.filter((p) => SYSTEM.has(p.bucket)).reduce((s, p) => s + p.amount, 0), [pays]);
  // รายการที่ต้องตรวจสอบ: จ่ายผ่านระบบแต่ไม่มีเลขอ้างอิง (ขาดหลักฐานจับคู่)
  const toReview = useMemo(() => pays.filter((p) => SYSTEM.has(p.bucket) && !p.ref), [pays]);
  const feeKnown = useMemo(() => { const sysc = pays.filter((p) => SYSTEM.has(p.bucket)); return { known: sysc.filter((p) => p.fee !== null).length, total: sysc.length }; }, [pays]);
  const feeIncomplete = feeKnown.total > 0 && feeKnown.known < feeKnown.total;

  const refunds = useMemo(() => rows.filter((o) => o.status === "voided" || o.status === "refunded" || o.status === "partially_refunded")
    .map((o) => ({ id: o.id, orderNo: o.order_no, at: o.created_at, branch: branchName(o.branch_id), status: o.status, amount: o.grand_total, reason: o.void_reason ?? null }))
    .sort((a, b) => (a.at < b.at ? 1 : -1)), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const byPay = useMemo(() => byPaymentDetail(rows, locale), [rows, locale]);
  const byAcq = useMemo(() => byAcquirer(rows), [rows]);
  const byBr = useMemo(() => financeByBranch(rows, branches, locale), [rows, branches, locale]);

  // แนวโน้มยอดชำระรายวัน
  const trend = useMemo(() => {
    const m = new Map<string, number>();
    pays.forEach((p) => m.set(dayKey(p.at), (m.get(dayKey(p.at)) ?? 0) + p.amount));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => ({ label: d.slice(5), value: v }));
  }, [pays]);

  if (employee && !can(employee, "finance.view")) {
    return <div className="p-6"><EmptyState icon={<Wallet size={28} />} title={L("ไม่มีสิทธิ์ดูการเงิน", "No finance access", "无财务权限")} body={L("ติดต่อเจ้าของกิจการเพื่อขอสิทธิ์ finance.view", "Ask the owner for finance.view", "请向企业主申请 finance.view")} /></div>;
  }

  const TABS: { value: Tab; label: string }[] = [
    { value: "paid", label: L("เงินรับชำระ", "Payments", "收款") },
    { value: "edc", label: L("EDC / ธนาคาร", "EDC / Bank", "EDC/银行") },
    { value: "refund", label: L("คืนเงิน", "Refunds", "退款") },
    { value: "branch", label: L("รายสาขา", "By branch", "按门店") },
  ];
  const nf = (n: number) => formatTHB(n, false);
  const trendCfg: ChartConfig = { value: { label: L("ยอดชำระตามบิล", "Paid (by bill)", "账单收款"), color: "rgb(var(--chart-1))" } };
  const barCfg: ChartConfig = { value: { label: L("ยอดชำระ", "Paid", "收款"), color: "rgb(var(--chart-1))" } };

  // export rows ตามหมวด/มุมมองปัจจุบัน
  const exportConf = (() => {
    if (tab === "paid") return { name: "payments", rows: pays, cols: [
      { key: "at", label: L("วันชำระ", "Date", "日期"), map: (r: PayRow) => dayKey(r.at) },
      { key: "orderNo", label: L("บิล", "Bill", "单号") }, { key: "branch", label: L("สาขา", "Branch", "门店") },
      { key: "methodLabel", label: L("วิธีชำระ", "Method", "方式") }, { key: "amount", label: L("ยอด", "Amount", "金额"), map: (r: PayRow) => nf(r.amount) },
      { key: "ref", label: L("เลขอ้างอิง", "Reference", "参考号"), map: (r: PayRow) => r.ref ?? L("ไม่ระบุ", "N/A", "未填") },
      { key: "fee", label: L("ค่าธรรมเนียม", "Fee", "手续费"), map: (r: PayRow) => r.fee === null ? L("ไม่ระบุ", "N/A", "未知") : nf(r.fee) },
    ] };
    if (tab === "edc") return { name: "edc-bank", rows: byAcq, cols: [
      { key: "bank", label: L("ผู้รับบัตร/ธนาคาร", "Acquirer", "收单行") }, { key: "value", label: L("ยอดก่อนหัก", "Gross", "总额"), map: (r: typeof byAcq[number]) => nf(r.value) },
      { key: "fee", label: L("ค่าธรรมเนียม", "Fee", "手续费"), map: (r: typeof byAcq[number]) => r.fee ? nf(r.fee) : L("ไม่ระบุ", "N/A", "未知") },
      { key: "count", label: L("ธุรกรรม", "Txns", "笔数") },
    ] };
    if (tab === "refund") return { name: "refunds", rows: refunds, cols: [
      { key: "at", label: L("วันที่", "Date", "日期"), map: (r: typeof refunds[number]) => dayKey(r.at) }, { key: "orderNo", label: L("บิลเดิม", "Bill", "原单") },
      { key: "branch", label: L("สาขา", "Branch", "门店") }, { key: "status", label: L("สถานะ", "Status", "状态") },
      { key: "amount", label: L("ยอด", "Amount", "金额"), map: (r: typeof refunds[number]) => nf(r.amount) }, { key: "reason", label: L("เหตุผล", "Reason", "原因"), map: (r: typeof refunds[number]) => r.reason ?? "-" },
    ] };
    return { name: "by-branch", rows: byBr, cols: [
      { key: "label", label: L("สาขา", "Branch", "门店") }, { key: "gross", label: L("ยอดชำระ", "Paid", "收款"), map: (r: typeof byBr[number]) => nf(r.gross) },
      { key: "card", label: L("บัตร/EDC", "Card", "刷卡"), map: (r: typeof byBr[number]) => nf(r.card) }, { key: "transfer", label: L("โอน", "Transfer", "转账"), map: (r: typeof byBr[number]) => nf(r.transfer) },
      { key: "qr", label: "QR", map: (r: typeof byBr[number]) => nf(r.qr) }, { key: "fee", label: L("ค่าธรรมเนียม", "Fee", "手续费"), map: (r: typeof byBr[number]) => nf(r.fee) },
      { key: "net", label: L("สุทธิ", "Net", "净额"), map: (r: typeof byBr[number]) => nf(r.net) }, { key: "orders", label: L("บิล", "Bills", "单") },
    ] };
  })();

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      {/* หัว */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Finance / Overview</p>
          <h1 className="text-xl font-bold flex items-center gap-2"><Landmark size={20} className="text-brand" /> {L("การเงิน", "Finance", "财务")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("ยอดรับชำระ สถานะเงิน และรายการที่ต้องติดตาม", "Payments, money status & items to follow up", "收款、资金状态与待跟进")}</p>
        </div>
        <ExportShareBar filename={exportConf.name} title={L("การเงิน", "Finance", "财务")} rows={exportConf.rows as Record<string, unknown>[]} columns={exportConf.cols as never} size="sm" />
      </div>

      {/* แท็บหมวด */}
      <div className="border-b border-line flex gap-1 overflow-x-auto">
        {TABS.map((tb) => (
          <button key={tb.value} onClick={() => setTab(tb.value)} className={`px-3.5 h-10 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === tb.value ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>{tb.label}</button>
        ))}
      </div>

      {/* ตัวกรองร่วม */}
      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {/* สวิตช์มุมมอง */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted">{filter.branchIds.length ? `${filter.branchIds.length} ${L("สาขา", "branches", "门店")}` : L("ทุกสาขา", "All branches", "全部门店")} · {(tab === "paid" ? pays.length : tab === "edc" ? byAcq.length : tab === "refund" ? refunds.length : byBr.length)} {L("รายการ", "records", "条")}</span>
        <Segmented value={view} onChange={(v) => setView(v as View)} options={[{ value: "dash", label: L("Dashboard", "Dashboard", "仪表板") }, { value: "table", label: L("ตารางรายการ", "Table", "明细表") }]} />
      </div>

      {loading ? (
        <Card className="p-16 text-center text-muted"><Loader2 className="inline animate-spin mr-2" size={18} /> {L("กำลังเตรียมข้อมูลการเงิน…", "Preparing finance data…", "正在准备财务数据…")}</Card>
      ) : (<>

      {/* ───────── เงินรับชำระ ───────── */}
      {tab === "paid" && (view === "dash" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label={L("ยอดชำระตามบิล", "Paid (by bill)", "账单收款")} value={`฿${nf(sum.gross)}`} sub={L("ตามรายการที่เลือก · ไม่ใช่ยอด statement", "Selected records · not statement", "按所选 · 非对账单")} icon={<Wallet size={16} />} accent="mint" />
            <KpiTile label={L("สุทธิคาดรับ", "Net expected", "预计净收")} value={`฿${nf(sum.net)}`} sub={feeIncomplete ? L(`หักค่าธรรมเนียม ฿${nf(sum.fee)} · ข้อมูลยังไม่ครบ`, `fee ฿${nf(sum.fee)} · incomplete`, `手续费不全`) : L(`หักค่าธรรมเนียม ฿${nf(sum.fee)}`, `less fee ฿${nf(sum.fee)}`, `扣手续费`)} icon={<Receipt size={16} />} accent="lavender" />
            <KpiTile label={L("รอเงินเข้า (ยังไม่จับคู่)", "Awaiting settlement", "待入账")} value={`฿${nf(systemPaid)}`} sub={L("ยังไม่เชื่อมข้อมูลธนาคาร", "bank not connected", "未接银行")} icon={<Clock size={16} />} accent="peach" />
            <KpiTile label={L("ต้องตรวจสอบ", "To review", "需核查")} value={`${toReview.length} ${L("รายการ", "items", "项")}`} sub={L("ขาดเลขอ้างอิง/หลักฐาน", "missing reference", "缺参考号")} icon={<AlertTriangle size={16} />} accent={toReview.length ? "coral" : "neutral"} />
          </div>

          <Card className="p-4">
            <CardHeader title={L("แนวโน้มยอดชำระ", "Payment trend", "收款趋势")} subtitle={L("ยอดชำระตามบิล รายวัน · บาท", "Paid by bill, daily · THB", "每日账单收款 · 泰铢")} />
            <div className="mt-2">{trend.length ? <SalesAreaTrend data={trend} config={trendCfg} valueFormat={nf} /> : <p className="py-10 text-center text-xs text-muted">{L("ไม่มีข้อมูลในช่วงนี้", "No data", "暂无数据")}</p>}</div>
          </Card>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card className="p-4">
              <CardHeader title={L("วิธีรับชำระ", "Payment methods", "收款方式")} subtitle={L("กดช่องทางเพื่อดูรายการ", "Tap a method to view records", "点击查看明细")} right={<CreditCard size={16} className="text-muted" />} />
              <div className="mt-3">{byPay.length ? <InsightBars data={byPay.map((p, i) => ({ label: p.label, value: p.value, highlight: i === 0 }))} config={barCfg} valueFormat={nf} onBarClick={() => setView("table")} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
            </Card>
            <Card className="p-4">
              <CardHeader title={L("ต้องดำเนินการ", "To do", "待处理")} subtitle={L("งานค้างที่ต้องตามต่อ", "Follow-up items", "跟进项")} right={<AlertTriangle size={15} className="text-amber-500" />} />
              <div className="mt-2 divide-y divide-line">
                <button onClick={() => setView("table")} className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:opacity-80">
                  <div><p className="text-sm font-medium">{L("เลขอ้างอิง / หลักฐานไม่ครบ", "Missing reference / proof", "缺参考号/凭证")}</p><p className="text-[11px] text-muted">{toReview.length} {L("รายการในตัวกรองนี้", "items in filter", "项")}</p></div>
                  <ChevronRight size={16} className="text-muted shrink-0" />
                </button>
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <div className="inline-flex items-center gap-1.5"><Link2Off size={14} className="text-muted" /><div><p className="text-sm font-medium text-muted">{L("รอ settlement / จับคู่ธนาคาร", "Awaiting settlement", "待对账")}</p><p className="text-[11px] text-muted">{L("ยังไม่เชื่อมข้อมูลธนาคาร", "bank data not connected", "未接银行数据")}</p></div></div>
                  <Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未接")}</Badge>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="overflow-x-auto">
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
          {!pays.length ? <p className="py-10 text-center text-sm text-muted">{L("ไม่มีรายการ", "No records", "无记录")}</p> : null}
        </Card>
      ))}

      {/* ───────── EDC / ธนาคาร ───────── */}
      {tab === "edc" && (view === "dash" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label={L("ยอดบัตร/EDC", "Card/EDC", "刷卡/EDC")} value={`฿${nf(byPay.filter((p) => bucketOf(p.method) === "card").reduce((s, p) => s + p.value, 0))}`} icon={<CreditCard size={16} />} accent="lavender" />
            <KpiTile label={L("ค่าธรรมเนียมรวม", "Total fees", "总手续费")} value={feeKnown.known ? `฿${nf(sum.fee)}` : L("ไม่ระบุ", "N/A", "未知")} sub={feeIncomplete ? L("ข้อมูลยังไม่ครบ", "incomplete", "不全") : undefined} icon={<Receipt size={16} />} accent="peach" />
            <KpiTile label={L("รอ settlement", "Awaiting settlement", "待对账")} value={L("ยังไม่เชื่อม", "N/A", "未接")} sub={L("ต้องเชื่อมข้อมูลผู้รับบัตร", "connect acquirer data", "需接收单数据")} icon={<Link2Off size={16} />} accent="neutral" />
            <KpiTile label={L("จับคู่แล้ว", "Matched", "已对账")} value={L("ยังไม่เชื่อม", "N/A", "未接")} icon={<Landmark size={16} />} accent="neutral" />
          </div>
          <Card className="p-4">
            <CardHeader title={L("ยอดตามผู้รับบัตร/ธนาคาร", "By acquirer/bank", "按收单行")} subtitle={L("จากข้อมูล EDC ในบิล", "From EDC data on bills", "来自账单 EDC")} />
            <div className="mt-3">{byAcq.length ? <InsightBars data={byAcq.map((a, i) => ({ label: a.bank, value: a.value, highlight: i === 0 }))} config={barCfg} valueFormat={nf} /> : <EmptyState icon={<CreditCard size={22} />} title={L("ไม่มีข้อมูลผู้รับบัตร", "No acquirer data", "无收单数据")} body={L("บิลยังไม่ระบุธนาคารผู้รับบัตร", "Bills have no acquirer bank yet", "账单未填收单行")} />}</div>
          </Card>
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <thead><tr><Th>{L("ผู้รับบัตร/ธนาคาร", "Acquirer", "收单行")}</Th><Th align="right">{L("ยอดก่อนหัก", "Gross", "总额")}</Th><Th align="right">{L("ค่าธรรมเนียม", "Fee", "手续费")}</Th><Th align="right">{L("ยอดคาดรับ", "Expected net", "预计净")}</Th><Th>{L("วันคาดรับ", "Expected date", "预计日")}</Th><Th>{L("จับคู่", "Match", "对账")}</Th><Th align="right">{L("ธุรกรรม", "Txns", "笔数")}</Th></tr></thead>
            <tbody>{byAcq.map((a) => (
              <tr key={a.bank}>
                <Td className="text-sm font-medium">{a.bank}</Td>
                <Td align="right" className="tnum">{nf(a.value)}</Td>
                <Td align="right" className="text-xs">{a.fee ? <span className="tnum text-danger">{nf(a.fee)}</span> : <span className="text-muted">{L("ไม่ระบุ", "N/A", "未知")}</span>}</Td>
                <Td align="right" className="tnum font-medium">{nf(a.value - a.fee)}</Td>
                <Td><Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未接")}</Badge></Td>
                <Td><Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未接")}</Badge></Td>
                <Td align="right" className="tnum text-muted">{a.count}</Td>
              </tr>
            ))}</tbody>
          </Table>
          {!byAcq.length ? <p className="py-10 text-center text-sm text-muted">{L("ไม่มีข้อมูลผู้รับบัตร", "No acquirer data", "无数据")}</p> : null}
        </Card>
      ))}

      {/* ───────── คืนเงิน ───────── */}
      {tab === "refund" && (view === "dash" ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label={L("จำนวนคืนเงิน/ยกเลิก", "Refunds/voids", "退款/作废")} value={`${refunds.length}`} icon={<RotateCcw size={16} />} accent="coral" />
          <KpiTile label={L("ยอดที่เกี่ยวข้อง", "Amount affected", "涉及金额")} value={`฿${nf(refunds.reduce((s, r) => s + r.amount, 0))}`} sub={L("ยอดบิลที่คืน/ยกเลิก", "voided/refunded bills", "退/作废账单")} icon={<Receipt size={16} />} accent="peach" />
          <KpiTile label={L("ผลจากผู้ให้บริการ", "Provider result", "服务商结果")} value={L("ยังไม่เชื่อม", "N/A", "未接")} icon={<Link2Off size={16} />} accent="neutral" />
          <KpiTile label={L("รอผลคืนเงิน", "Pending refund", "待退款")} value={L("ยังไม่เชื่อม", "N/A", "未接")} icon={<Clock size={16} />} accent="neutral" />
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <thead><tr><Th>{L("วันที่", "Date", "日期")}</Th><Th>{L("บิลเดิม", "Bill", "原单")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("สถานะ", "Status", "状态")}</Th><Th align="right">{L("ยอด", "Amount", "金额")}</Th><Th>{L("เหตุผล", "Reason", "原因")}</Th></tr></thead>
            <tbody>{refunds.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs whitespace-nowrap">{dayKey(r.at)}</Td>
                <Td className="font-mono text-[11px] text-muted">{r.orderNo}</Td>
                <Td className="text-xs text-muted">{r.branch}</Td>
                <Td><Badge tone={r.status === "voided" ? "danger" : "warn"}>{r.status === "voided" ? L("ยกเลิก", "Voided", "作废") : r.status === "refunded" ? L("คืนเต็ม", "Refunded", "全退") : L("คืนบางส่วน", "Partial", "部分退")}</Badge></Td>
                <Td align="right" className="tnum">{nf(r.amount)}</Td>
                <Td className="text-xs text-muted"><span className="block max-w-[220px] truncate" title={r.reason ?? ""}>{r.reason ?? "—"}</span></Td>
              </tr>
            ))}</tbody>
          </Table>
          {!refunds.length ? <p className="py-10 text-center text-sm text-muted">{L("ไม่มีรายการคืนเงิน/ยกเลิก", "No refunds/voids", "无退款")}</p> : null}
        </Card>
      ))}

      {/* ───────── รายสาขา ───────── */}
      {tab === "branch" && (view === "dash" ? (
        <Card className="p-4">
          <CardHeader title={L("ยอดชำระรายสาขา", "Paid by branch", "按门店收款")} subtitle={L("จัดอันดับตามยอดชำระ", "Ranked by paid", "按收款排名")} right={<Store size={16} className="text-muted" />} />
          <div className="mt-3">{byBr.length ? <InsightBars data={byBr.map((b, i) => ({ label: b.label, value: b.gross, highlight: i === 0 }))} config={barCfg} valueFormat={nf} /> : <p className="py-8 text-center text-xs text-muted">{L("ไม่มีข้อมูล", "No data", "暂无")}</p>}</div>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <thead><tr><Th>{L("สาขา", "Branch", "门店")}</Th><Th align="right">{L("ยอดชำระ", "Paid", "收款")}</Th><Th align="right">{L("บัตร/EDC", "Card", "刷卡")}</Th><Th align="right">{L("โอน", "Transfer", "转账")}</Th><Th align="right">QR</Th><Th align="right">{L("ค่าธรรมเนียม", "Fee", "手续费")}</Th><Th align="right">{L("สุทธิ", "Net", "净额")}</Th><Th align="right">{L("บิล", "Bills", "单")}</Th></tr></thead>
            <tbody>{byBr.map((b) => (
              <tr key={b.id}>
                <Td className="text-sm font-medium">{b.label}</Td>
                <Td align="right" className="tnum">{nf(b.gross)}</Td>
                <Td align="right" className="tnum text-xs">{nf(b.card)}</Td>
                <Td align="right" className="tnum text-xs">{nf(b.transfer)}</Td>
                <Td align="right" className="tnum text-xs">{nf(b.qr)}</Td>
                <Td align="right" className="tnum text-xs text-danger">{b.fee ? nf(b.fee) : "—"}</Td>
                <Td align="right" className="tnum font-semibold">{nf(b.net)}</Td>
                <Td align="right" className="tnum text-muted">{formatInt(b.orders)}</Td>
              </tr>
            ))}</tbody>
          </Table>
          {!byBr.length ? <p className="py-10 text-center text-sm text-muted">{L("ไม่มีข้อมูล", "No data", "无数据")}</p> : null}
        </Card>
      ))}

      </>)}
    </div>
  );
}
