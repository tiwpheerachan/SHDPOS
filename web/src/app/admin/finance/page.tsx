"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Banknote, CreditCard, Receipt, Sparkles, AlertTriangle, CircleCheck, Info, Landmark } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders } from "@/lib/data/repo";
import type { Order, Employee } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, EmptyState, KpiTile, Segmented } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders, salesSeries, topProducts, byEmployee } from "@/lib/analytics";
import {
  financeSummary, byPaymentDetail, byChannelDetail, byAcquirer, financeByBranch,
  opsSummary, dailyBrief, type BriefBullet,
} from "@/lib/finance";
import { formatTHB, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";
import { MixDonut, SalesAreaTrend, InsightBars } from "@/components/charts-rich";
import type { ChartConfig } from "@/components/ui/chart";

type Tab = "money" | "daily" | "ops";

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD local

export default function AdminFinancePage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<Tab>("money");
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  useEffect(() => { void listOrders().then(setOrders); }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);

  const rows = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);

  // สิทธิ์: ต้องมี finance.view
  if (employee && !can(employee, "finance.view")) {
    return (
      <div className="p-6">
        <EmptyState icon={<Wallet size={28} />} title={L("ไม่มีสิทธิ์ดูการเงิน", "No finance access", "无财务权限")}
          body={L("ติดต่อเจ้าของกิจการเพื่อขอสิทธิ์ finance.view", "Ask the owner for finance.view", "请向企业主申请 finance.view")} />
      </div>
    );
  }

  const TABS: { value: Tab; label: string }[] = [
    { value: "money", label: L("เงินเข้า & ช่องทาง", "Money & channels", "资金与渠道") },
    { value: "daily", label: L("สรุปรายวัน (AI)", "Daily (AI)", "每日 (AI)") },
    { value: "ops", label: L("การดำเนินกิจการ", "Operations", "经营概况") },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Landmark size={20} className="text-brand" />{L("การเงิน", "Finance", "财务")}</h1>
          <p className="text-sm text-muted">{L("เงินมาจากไหน เข้าช่องทางไหน รายสาขา/แบรนด์", "Where money comes from, by channel, branch & brand", "资金来源 · 渠道 · 门店与品牌")}</p>
        </div>
        <Segmented value={tab} options={TABS} onChange={setTab} />
      </div>

      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {tab === "money" && <MoneyTab rows={rows} branches={branches} locale={locale} L={L} />}
      {tab === "daily" && <DailyTab scoped={scoped} branches={branches} locale={locale} L={L} />}
      {tab === "ops" && <OpsTab rows={rows} branches={branches} employee={employee} locale={locale} L={L} t={t} />}

      <p className="text-[11px] text-muted flex items-center gap-1.5 pt-1">
        <Info size={13} />
        {L("ยอด \"เข้าระบบ\" อ้างอิงจากสลิป/บิลในระบบ — ยังไม่ได้กระทบยอดกับ statement ธนาคารจริง (เฟสถัดไป)",
           "\"To-bank\" figures are from POS slips — not yet reconciled with real bank statements (next phase)",
           "\"入账\"金额来自POS单据 — 尚未与银行对账单核对（下一阶段）")}
      </p>
    </div>
  );
}

type LFn = (th: string, en: string, zh: string) => string;

// ─────────────────────────────────────────────────────────────────────
// แท็บ 1: เงินเข้า & ช่องทาง
// ─────────────────────────────────────────────────────────────────────
function MoneyTab({ rows, branches, locale, L }: { rows: Order[]; branches: ReturnType<typeof useAdminScope>["branches"]; locale: "th" | "en" | "zh"; L: LFn }) {
  const sum = useMemo(() => financeSummary(rows), [rows]);
  const byPay = useMemo(() => byPaymentDetail(rows, locale), [rows, locale]);
  const byChan = useMemo(() => byChannelDetail(rows, locale), [rows, locale]);
  const byBank = useMemo(() => byAcquirer(rows), [rows]);
  const byBr = useMemo(() => financeByBranch(rows, branches, locale), [rows, branches, locale]);

  const payData = byPay.map((p) => ({ key: p.method, value: p.value }));
  const payConfig: ChartConfig = Object.fromEntries(byPay.map((p, i) => [p.method, { label: p.label, color: `rgb(var(--chart-${(i % 5) + 1}))` }]));
  const chanData = byChan.map((c) => ({ key: c.channel, value: c.value }));
  const chanConfig: ChartConfig = Object.fromEntries(byChan.map((c, i) => [c.channel, { label: c.label, color: `rgb(var(--chart-${(i % 5) + 1}))` }]));

  const cashPct = sum.gross > 0 ? Math.round((sum.cash / sum.gross) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label={L("ยอดรับชำระ", "Payments in", "收款总额")} value={formatTHB(sum.gross)} variant="ink" icon={<Wallet size={15} />} />
        <KpiTile label={L("เงินสด", "Cash", "现金")} value={formatTHB(sum.cash)} sub={`${cashPct}% · ${L("นับ/นำฝากเอง", "manual deposit", "人工存款")}`} tone="warn" icon={<Banknote size={15} />} />
        <KpiTile label={L("เข้าระบบ (บัตร/โอน/QR)", "To-bank (card/transfer)", "入账")} value={formatTHB(sum.system)} tone="brand" icon={<CreditCard size={15} />} />
        <KpiTile label={L("ค่าธรรมเนียม", "Fees", "手续费")} value={formatTHB(sum.fee)} tone="danger" icon={<Receipt size={15} />} />
        <KpiTile label={L("รับสุทธิ", "Net received", "净收")} value={formatTHB(sum.net)} tone="ok" icon={<CircleCheck size={15} />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <CardHeader title={L("สัดส่วนวิธีรับเงิน", "Payment methods", "收款方式占比")} />
          {payData.length ? <MixDonut data={payData} config={payConfig} /> : <EmptyState title={L("ยังไม่มีข้อมูล", "No data", "暂无数据")} />}
        </Card>
        <Card className="p-4">
          <CardHeader title={L("สัดส่วนช่องทางขาย", "Sales channels", "销售渠道占比")} />
          {chanData.length ? <MixDonut data={chanData} config={chanConfig} /> : <EmptyState title={L("ยังไม่มีข้อมูล", "No data", "暂无数据")} />}
        </Card>
      </div>

      <Card className="p-4">
        <CardHeader title={L("เงินเข้ารายสาขา", "Money in by branch", "各门店资金")}
          subtitle={L("แยกตามวิธีรับเงิน — เงินสดต้องนำฝาก, ส่วนที่เหลือเข้าบัญชี", "By method — cash to deposit, rest to bank", "按方式 — 现金需存入")} />
        {byBr.length ? (
          <div className="overflow-x-auto">
            <Table>
              <thead><tr>
                <Th>{L("สาขา", "Branch", "门店")}</Th>
                <Th align="right">{L("เงินสด", "Cash", "现金")}</Th>
                <Th align="right">{L("บัตร/EDC", "Card/EDC", "刷卡")}</Th>
                <Th align="right">{L("โอน", "Transfer", "转账")}</Th>
                <Th align="right">QR</Th>
                <Th align="right">{L("ค่าธรรมเนียม", "Fees", "手续费")}</Th>
                <Th align="right">{L("รับสุทธิ", "Net", "净收")}</Th>
                <Th align="right">{L("บิล", "Bills", "单")}</Th>
              </tr></thead>
              <tbody>
                {byBr.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.label}</Td>
                    <Td align="right" className="tnum">{formatTHB(r.cash, false)}</Td>
                    <Td align="right" className="tnum">{formatTHB(r.card, false)}</Td>
                    <Td align="right" className="tnum">{formatTHB(r.transfer, false)}</Td>
                    <Td align="right" className="tnum">{formatTHB(r.qr, false)}</Td>
                    <Td align="right" className="tnum text-danger">{r.fee ? formatTHB(r.fee, false) : "—"}</Td>
                    <Td align="right" className="tnum font-semibold">{formatTHB(r.net, false)}</Td>
                    <Td align="right" className="tnum text-muted">{formatInt(r.orders)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : <EmptyState title={L("ยังไม่มีข้อมูล", "No data", "暂无数据")} />}
      </Card>

      {byBank.length ? (
        <Card className="p-4">
          <CardHeader title={L("รายธนาคาร/ผู้รับบัตร (EDC)", "By acquirer bank (EDC)", "按收单行 (EDC)")}
            subtitle={L("ปลายทางที่เงินบัตรควรเข้า", "Where card money should land", "刷卡资金去向")} />
          <div className="overflow-x-auto">
            <Table>
              <thead><tr>
                <Th>{L("ธนาคาร/ผู้รับบัตร", "Acquirer", "收单行")}</Th>
                <Th align="right">{L("ยอดรับ", "Amount", "金额")}</Th>
                <Th align="right">{L("ค่าธรรมเนียม", "Fees", "手续费")}</Th>
                <Th align="right">{L("รายการ", "Txns", "笔数")}</Th>
              </tr></thead>
              <tbody>
                {byBank.map((b) => (
                  <tr key={b.bank}>
                    <Td><Badge tone="brand">{b.bank}</Badge></Td>
                    <Td align="right" className="tnum">{formatTHB(b.value, false)}</Td>
                    <Td align="right" className="tnum text-danger">{b.fee ? formatTHB(b.fee, false) : "—"}</Td>
                    <Td align="right" className="tnum text-muted">{formatInt(b.count)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// แท็บ 2: สรุปรายวัน (AI)
// ─────────────────────────────────────────────────────────────────────
function DailyTab({ scoped, branches, locale, L }: { scoped: Order[]; branches: ReturnType<typeof useAdminScope>["branches"]; locale: "th" | "en" | "zh"; L: LFn }) {
  const { today, yest } = useMemo(() => {
    const now = new Date();
    const tKey = now.toLocaleDateString("en-CA");
    const yKey = new Date(now.getTime() - 86400000).toLocaleDateString("en-CA");
    return {
      today: scoped.filter((o) => dayKey(o.created_at) === tKey),
      yest: scoped.filter((o) => dayKey(o.created_at) === yKey),
    };
  }, [scoped]);

  const brief = useMemo(() => dailyBrief(today, yest, branches, locale), [today, yest, branches, locale]);
  const sumT = useMemo(() => financeSummary(today), [today]);

  // แนวโน้ม 14 วันล่าสุด
  const trend = useMemo(() => salesSeries(scoped, "day").slice(-14), [scoped]);
  const areaData = trend.map((s) => ({ label: s.label, value: s.value }));
  const areaConfig: ChartConfig = { value: { label: L("ยอดขาย", "Sales", "销售额"), color: "rgb(var(--chart-1))" } };

  const toneIcon = (tone: BriefBullet["tone"]) =>
    tone === "ok" ? <CircleCheck size={16} className="text-ok shrink-0" /> :
    tone === "warn" ? <AlertTriangle size={16} className="text-danger shrink-0" /> :
    <Info size={16} className="text-brand shrink-0" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("ยอดวันนี้", "Today", "今日")} value={formatTHB(sumT.gross)} variant="ink" />
        <KpiTile label={L("บิลวันนี้", "Bills today", "今日单数")} value={formatInt(sumT.orders)} />
        <KpiTile label={L("เงินสดวันนี้", "Cash today", "今日现金")} value={formatTHB(sumT.cash)} tone="warn" />
        <KpiTile label={L("เข้าระบบวันนี้", "To-bank today", "今日入账")} value={formatTHB(sumT.system)} tone="brand" />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full grid place-items-center bg-brand/12 text-brand"><Sparkles size={15} /></span>
          <div>
            <p className="text-sm font-semibold">{L("สรุป AI รายวัน", "AI daily brief", "AI 每日简报")}</p>
            <p className="text-xs text-muted">{brief.headline}</p>
          </div>
          <Badge tone="brand" className="ml-auto">AI</Badge>
        </div>
        <ul className="space-y-2">
          {brief.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              {toneIcon(b.tone)}
              <span className={b.tone === "warn" ? "text-ink" : "text-ink"}>{b.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted mt-3 pt-3 border-t border-line">
          {L("วิเคราะห์อัตโนมัติจากข้อมูลในระบบ · ต่อยอดเป็น LLM สรุปเชิงลึกได้ในเฟสถัดไป",
             "Auto-generated from live data · can upgrade to LLM deep-dive next phase",
             "基于实时数据自动生成 · 下阶段可升级为 LLM 深度分析")}
        </p>
      </Card>

      <Card className="p-4">
        <CardHeader title={L("แนวโน้มยอดขาย 14 วัน", "14-day sales trend", "14天销售趋势")} />
        {areaData.length ? <SalesAreaTrend data={areaData} config={areaConfig} valueFormat={(n) => formatTHB(n, false)} />
          : <EmptyState title={L("ยังไม่มีข้อมูล", "No data", "暂无数据")} />}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// แท็บ 3: การดำเนินกิจการ
// ─────────────────────────────────────────────────────────────────────
function OpsTab({ rows, branches, employee, locale, L, t }: {
  rows: Order[]; branches: ReturnType<typeof useAdminScope>["branches"];
  employee: Employee | null; locale: "th" | "en" | "zh"; L: LFn; t: ReturnType<typeof useI18n>["t"];
}) {
  const ops = useMemo(() => opsSummary(rows), [rows]);
  const showGp = can(employee, "report.gross_profit");
  const top = useMemo(() => topProducts(rows, 8), [rows]);
  const staff = useMemo(() => byEmployee(rows, []).slice(0, 8), [rows]);

  const brandName = (bid: string | null) => branches.find((b) => b.id === bid)?.name ?? "";
  void brandName; void t;

  const barData = top.map((p) => ({ label: p.name.slice(0, 10), value: p.gross, highlight: false }));
  const barConfig: ChartConfig = { value: { label: L("ยอดขาย", "Sales", "销售额"), color: "rgb(var(--chart-1))" } };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("จำนวนบิล", "Orders", "订单")} value={formatInt(ops.orders)} variant="ink" />
        <KpiTile label={L("เฉลี่ย/บิล", "Avg bill", "客单价")} value={formatTHB(ops.aov)} />
        <KpiTile label={L("จำนวนชิ้น", "Units", "件数")} value={formatInt(ops.units)} />
        <KpiTile label={L("ลูกค้า (มีโปรไฟล์)", "Customers", "客户")} value={formatInt(ops.customers)} />
        <KpiTile label={L("ส่วนลดรวม", "Discounts", "折扣")} value={formatTHB(ops.discount)} tone="warn" />
        {showGp ? <KpiTile label={L("กำไรขั้นต้น", "Gross profit", "毛利")} value={formatTHB(ops.gp)} tone="ok" sub={`${ops.gpPct}%`} /> : null}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <CardHeader title={L("สินค้าขายดี (ยอดเงิน)", "Top products (sales)", "热销商品")} />
          {barData.length ? <InsightBars data={barData} config={barConfig} valueFormat={(n) => formatTHB(n, false)} /> : <EmptyState title={L("ยังไม่มีข้อมูล", "No data", "暂无数据")} />}
        </Card>
        <Card className="p-4">
          <CardHeader title={L("พนักงานขายสูงสุด", "Top sellers", "销售冠军")} />
          {staff.length ? (
            <div className="overflow-x-auto">
              <Table>
                <thead><tr><Th>{L("พนักงาน", "Staff", "员工")}</Th><Th align="right">{L("ยอดขาย", "Sales", "销售")}</Th><Th align="right">{L("บิล", "Bills", "单")}</Th></tr></thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id}><Td>{s.label}</Td><Td align="right" className="tnum">{formatTHB(s.value, false)}</Td><Td align="right" className="tnum text-muted">{formatInt(s.orders)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : <EmptyState title={L("ยังไม่มีข้อมูล", "No data", "暂无数据")} />}
        </Card>
      </div>
    </div>
  );
}
