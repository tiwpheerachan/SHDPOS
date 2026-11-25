"use client";
import { OrderTraceButton } from "@/components/order-trace";

import { Suspense, useEffect, useMemo, useState } from "react";
import { OwSaleBadge, useOwSaleStatus } from "@/components/pos/ow-sale-badge";
import { Download, Search, LayoutDashboard, Store, Tag, Users, ReceiptText, Loader2, AlertTriangle, Cloud, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSalesData } from "@/lib/hooks/use-sales-data";
import { useCatalogProducts } from "@/lib/hooks/use-catalog-products";
import { StaffPerformance } from "@/components/admin/staff-performance";
import { Segmented } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import type { Branch, Brand, Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, KpiTile } from "@/components/ui";
import { FilterBar, useDefaultFilter } from "@/components/admin/filters";
import { applyOrderFilters, summarize, salesSeries, paymentMix, topProducts, byBranch } from "@/lib/analytics";
import { formatTHB, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";
import { BranchRadar, SalesAreaTrend, InsightBars, MixDonut } from "@/components/charts-rich";
import CellColumnTrend from "@/components/ui/cell-column-trend";
import type { ChartConfig } from "@/components/ui/chart";
import { isCountedSale, saleAt, bkkHour } from "@/lib/sales-basis";

type Tab = "overview" | "branch" | "brand" | "staff" | "bills";

export default function AdminSalesPageRoute() {
  // useSearchParams ต้องอยู่ใต้ Suspense (Next app router)
  return <Suspense fallback={null}><AdminSalesPage /></Suspense>;
}

function AdminSalesPage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const router = useRouter(), sp = useSearchParams();
  const [filter, setFilter] = useDefaultFilter();
  // ข้อมูลจริงจากระบบกลางตามช่วงวันที่ (โหมดสาธิต = ข้อมูลในเครื่อง)
  const data = useSalesData({ from: filter.from, to: filter.to });
  const { orders, branches, brands, employees } = data;
  const [products] = useCatalogProducts();
  const [q, setQ] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : ""));
  // ลิงก์จากช่องค้นหาอัจฉริยะ: ?branch= เจาะดูสาขา
  const branchParam = sp.get("branch");
  useEffect(() => { if (branchParam) setFilter({ ...filter, branchIds: [branchParam] }); }, [branchParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab = (sp.get("tab") as Tab) || "overview";
  const setTab = (v: Tab) => { const u = new URLSearchParams(sp.toString()); u.set("tab", v); u.delete("person"); router.replace(`/admin/sales?${u}`, { scroll: false }); };
  const drill = (patch: Partial<typeof filter>, to: Tab = "overview") => { setFilter({ ...filter, ...patch }); setTab(to); };

  const scoped = useMemo(() => {
    if (data.live) return orders; // เซิร์ฟเวอร์ตัดตามสิทธิ์สาขาแล้ว
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches, data.live]);

  // ตัวกรองครบทุกมิติ (แบรนด์/สาขา/จังหวัด/ประเภทร้าน/พนักงานขาย/แคชเชียร์/หมวด/SKU/ชำระ/ช่องทาง/สถานะ/ลูกค้า/เครื่อง/ธง)
  const filtered = useMemo(() => applyOrderFilters(scoped, filter, { branches, products }), [scoped, filter, branches, products]);
  const rows = useMemo(() => {
    const list = filtered;
    const term = q.trim().toLowerCase();
    return term
      ? list.filter((o) => o.order_no.toLowerCase().includes(term) || (o.customer_name ?? "").toLowerCase().includes(term) || (o.customer_phone ?? "").includes(term) || o.items.some((i) => i.sku.toLowerCase().includes(term)))
      : list;
  }, [filtered, q]);

  const totals = summarize(rows);
  const showCost = can(employee, "report.cost");
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  // สถานะคลังกลาง/JST ของบิลที่แสดง (สูงสุด 300 แถว)
  const owStatus = useOwSaleStatus(rows.slice(0, 300).map((o) => o.client_uuid));

  // ── ข้อมูลกราฟใหม่ ──
  const trend = useMemo(() => salesSeries(rows, "day"), [rows]);
  const areaData = useMemo(() => trend.map((s) => ({ label: s.label, value: s.value })), [trend]);
  const areaConfig: ChartConfig = { value: { label: L("ยอดขาย", "Sales", "销售额"), color: "rgb(var(--chart-1))" } };

  const radarData = useMemo(() => {
    const map = new Map<string, { label: string; sales: number; orders: number }>();
    for (const o of rows) {
      if (!isCountedSale(o)) continue;
      const b = branches.find((x) => x.id === o.branch_id);
      const cur = map.get(o.branch_id) ?? { label: b ? (locale === "th" ? b.name_th ?? b.name : b.name) : o.branch_id, sales: 0, orders: 0 };
      cur.sales += o.grand_total; cur.orders += 1;
      map.set(o.branch_id, cur);
    }
    const top = [...map.values()].sort((a, b) => b.sales - a.sales).slice(0, 6);
    const maxS = Math.max(1, ...top.map((b) => b.sales));
    const maxO = Math.max(1, ...top.map((b) => b.orders));
    return top.map((b) => ({ dim: b.label, sales: Math.round((b.sales / maxS) * 100), orders: Math.round((b.orders / maxO) * 100) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, branches, locale]);
  const radarConfig: ChartConfig = {
    sales: { label: L("ยอดขาย", "Sales", "销售额"), color: "rgb(var(--chart-1))" },
    orders: { label: L("จำนวนบิล", "Orders", "订单"), color: "rgb(var(--chart-4))" },
  };

  const pctChange = (vals: number[]) => {
    const a = vals.find((v) => v > 0) ?? 0;
    const b = [...vals].reverse().find((v) => v > 0) ?? 0;
    return a ? ((b - a) / a) * 100 : 0;
  };
  const cellLabels = trend.map((s) => s.label);
  const cellTicks = useMemo(() => {
    if (trend.length <= 6) return trend.map((s) => s.label);
    const step = Math.ceil(trend.length / 6);
    return trend.filter((_, i) => i % step === 0).map((s) => s.label);
  }, [trend]);
  const cellMetrics = [
    { key: "sales", label: L("ยอดขาย", "Sales", "销售额"), values: trend.map((s) => s.value), summary: formatTHB(totals.gross, false), delta: pctChange(trend.map((s) => s.value)), format: (n: number) => formatTHB(n, false) },
    { key: "orders", label: L("จำนวนบิล", "Orders", "订单"), values: trend.map((s) => s.orders), summary: formatInt(totals.orders), delta: pctChange(trend.map((s) => s.orders)), format: (n: number) => formatInt(n) },
  ];

  // ── Insights เชิงพฤติกรรม ──
  const active = useMemo(() => rows.filter(isCountedSale), [rows]);
  const hourAgg = useMemo(() => {
    const a = Array.from({ length: 24 }, (_, h) => ({ h, sales: 0, orders: 0 }));
    for (const o of active) { const h = bkkHour(saleAt(o)); a[h].sales += o.grand_total; a[h].orders += 1; }
    return a;
  }, [active]);
  const peak = useMemo(() => hourAgg.reduce((b, c) => (c.sales > b.sales ? c : b), hourAgg[0]), [hourAgg]);
  const activeHours = useMemo(() => hourAgg.filter((x) => x.orders > 0), [hourAgg]);
  const firstHour = activeHours[0]?.h ?? null;
  const lastHour = activeHours.length ? activeHours[activeHours.length - 1].h : null;
  const hourLabel = (h: number | null) => (h === null ? "—" : `${String(h).padStart(2, "0")}:00`);

  const dayNames = locale === "th" ? ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] : locale === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayAgg = useMemo(() => {
    const a = Array.from({ length: 7 }, (_, d) => ({ d, sales: 0, orders: 0 }));
    for (const o of active) { const d = new Date(o.created_at).getDay(); a[d].sales += o.grand_total; a[d].orders += 1; }
    return a;
  }, [active]);
  const bestDay = useMemo(() => dayAgg.reduce((b, c) => (c.sales > b.sales ? c : b), dayAgg[0]), [dayAgg]);

  const hourBars = activeHours.map((x) => ({ label: String(x.h), value: x.sales, highlight: x.h === peak.h }));
  const dayBars = dayAgg.map((x) => ({ label: dayNames[x.d], value: x.sales, highlight: x.d === bestDay.d }));
  const barConfig: ChartConfig = { value: { label: L("ยอดขาย", "Sales", "销售额"), color: "rgb(var(--chart-1))" } };

  const CHART_C = ["rgb(var(--chart-1))", "rgb(var(--chart-2))", "rgb(var(--chart-3))", "rgb(var(--chart-4))", "rgb(var(--chart-5))"];
  const payList = useMemo(() => paymentMix(active), [active]);
  const paySum = payList.reduce((s, p) => s + p.value, 0) || 1;
  const payData = payList.map((p) => ({ key: p.method, value: p.value }));
  const payConfig: ChartConfig = Object.fromEntries(payList.map((p, i) => [p.method, { label: (t.payment as Record<string, string>)[p.method] ?? p.method, color: CHART_C[i % 5] }]));

  const channelName = (c: string) => {
    const map: Record<string, [string, string, string]> = {
      offline: ["หน้าร้าน", "In-store", "门店"], online_shopee: ["Shopee", "Shopee", "Shopee"], online_lazada: ["Lazada", "Lazada", "Lazada"],
      online_tiktok: ["TikTok", "TikTok", "TikTok"], online_website: ["เว็บไซต์", "Website", "官网"], event: ["อีเวนต์", "Event", "活动"],
      b2b: ["ขายส่ง", "B2B", "批发"], other: ["อื่นๆ", "Other", "其他"],
    };
    const v = map[c]; return v ? L(v[0], v[1], v[2]) : c;
  };
  const chList = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of active) m.set(o.channel, (m.get(o.channel) ?? 0) + o.grand_total);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, value: Math.round(v * 100) / 100 }));
  }, [active]);
  const chSum = chList.reduce((s, c) => s + c.value, 0) || 1;
  const chConfig: ChartConfig = Object.fromEntries(chList.map((c, i) => [c.key, { label: channelName(c.key), color: CHART_C[i % 5] }]));

  const withMember = active.filter((o) => o.customer_id).length;
  const topProd = useMemo(() => topProducts(active, 1)[0], [active]);
  const tags = [
    peak.orders > 0 ? { icon: "🕐", text: `${L("พีค", "Peak", "高峰")} ${peak.h}:00–${peak.h + 1}:00` } : null,
    chList[0] ? { icon: "🛍️", text: `${channelName(chList[0].key)} ${Math.round((chList[0].value / chSum) * 100)}%` } : null,
    payList[0] ? { icon: "💳", text: `${(t.payment as Record<string, string>)[payList[0].method] ?? payList[0].method} ${Math.round((payList[0].value / paySum) * 100)}%` } : null,
    { icon: "🧾", text: `${L("บิลเฉลี่ย", "Avg bill", "客单价")} ${formatTHB(totals.avgBasket, false)}` },
    active.length ? { icon: "⭐", text: `${L("สมาชิก", "Members", "会员")} ${Math.round((withMember / active.length) * 100)}%` } : null,
    bestDay.orders > 0 ? { icon: "📅", text: `${L("ขายดี", "Best", "最佳")} ${dayNames[bestDay.d]}` } : null,
    topProd ? { icon: "🏆", text: topProd.name } : null,
  ].filter(Boolean) as { icon: string; text: string }[];

  function exportCsv() {
    const head = [
      "order_no", "date", "branch", "cashier", "status", "channel",
      "subtotal", "discount", "vat", "grand_total", ...(showCost ? ["cost", "gross_profit"] : []),
    ];
    const lines = rows.map((o) => {
      const b = branches.find((x) => x.id === o.branch_id);
      return [
        o.order_no,
        new Date(o.created_at).toISOString(),
        b?.name ?? "",
        o.cashier_id ?? "",
        o.status,
        o.channel,
        o.subtotal, o.discount_total, o.vat_amount, o.grand_total,
        ...(showCost ? [o.cost_total, o.gross_profit] : []),
      ].join(",");
    });
    const csv = [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `shd-pos-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
        </div>
        <Button variant="ghost" className="h-9" onClick={exportCsv}>
          <Download size={15} /> CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "overview", label: <span className="inline-flex items-center gap-1.5"><LayoutDashboard size={14} />{L("ภาพรวม", "Overview", "总览")}</span> },
          { value: "branch", label: <span className="inline-flex items-center gap-1.5"><Store size={14} />{L("รายสาขา", "Branches", "门店")}</span> },
          { value: "brand", label: <span className="inline-flex items-center gap-1.5"><Tag size={14} />{L("แบรนด์", "Brands", "品牌")}</span> },
          ...(can(employee, "report.employee_perf") ? [{ value: "staff" as Tab, label: <span className="inline-flex items-center gap-1.5"><Users size={14} />{L("ผลงานพนักงาน", "Staff performance", "员工业绩")}</span> }] : []),
          { value: "bills", label: <span className="inline-flex items-center gap-1.5"><ReceiptText size={14} />{L("รายการบิล", "Bills", "账单")}</span> },
        ]} />
        <span className="text-[11px] text-muted inline-flex items-center gap-1.5">
          {data.loading ? <><Loader2 size={12} className="animate-spin" />{L("กำลังโหลดข้อมูล…", "Loading…", "加载中…")}</> : data.live
            ? <><Cloud size={12} />{L(`ข้อมูลจริงจากระบบกลาง · ${formatInt(filtered.length)} จาก ${formatInt(scoped.length)} บิลในช่วงวันที่`, `Central data · ${filtered.length}/${scoped.length} bills`, "中央数据")}</>
            : L("โหมดสาธิต · ข้อมูลในเครื่อง", "Demo · local data", "演示数据")}
        </span>
      </div>
      {data.error ? <p className="rounded-xl bg-danger/8 text-danger text-sm px-4 py-2.5 flex items-center gap-2"><AlertTriangle size={15} />{data.error}</p> : null}
      {data.truncated ? <p className="rounded-xl bg-warn/10 text-[12.5px] px-4 py-2.5">{L("ช่วงวันที่นี้มีบิลมากกว่า 20,000 ใบ — แสดงเฉพาะล่าสุด ให้แคบช่วงวันที่ลงเพื่อดูครบ", "More than 20,000 bills — showing latest only; narrow the date range", "数据过多")}</p> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t.admin.gmv} value={formatTHB(totals.gross)} tone="brand" />
        <KpiTile label={t.admin.orderCount} value={formatInt(totals.orders)} />
        <KpiTile label={t.pos.discount} value={formatTHB(totals.discount)} tone="warn" />
        <KpiTile label={t.pos.vat} value={formatTHB(totals.gross - totals.gross / 1.07)} />
      </div>

      {/* ── กราฟใหม่ ── */}
      {tab === "overview" && rows.length ? (
        <>
          <div className="grid lg:grid-cols-[1.7fr_1fr] gap-4">
            <Card>
              <CardHeader title={L("แนวโน้มยอดขาย", "Sales trend", "销售趋势")} subtitle={L("รายวันในช่วงที่เลือก", "Daily over selected range", "所选范围按日")} />
              <div className="p-4 pt-2">
                <SalesAreaTrend data={areaData} config={areaConfig} valueFormat={(n) => formatTHB(n, false)} />
              </div>
            </Card>
            <Card>
              <CardHeader title={L("เทียบรายสาขา", "Branch comparison", "门店对比")} subtitle={L("ยอดขาย vs จำนวนบิล (สัดส่วน%)", "Sales vs orders (normalized %)", "销售额 vs 订单（归一化%）")} />
              <div className="p-4 pt-2">
                {radarData.length ? (
                  <BranchRadar data={radarData} config={radarConfig} keys={["sales", "orders"]} />
                ) : (
                  <EmptyState title={t.common.empty} />
                )}
              </div>
            </Card>
          </div>

          <CellColumnTrend
            title={L("สุขภาพยอดขาย", "Sales health", "销售概览")}
            caption={L("แตะการ์ดด้านล่างเพื่อสลับเมตริก", "Tap a tile to switch metric", "点击下方卡片切换指标")}
            metrics={cellMetrics}
            labels={cellLabels}
            ticks={cellTicks}
          />

          {/* ── Insights เชิงพฤติกรรม ── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile label={L("ชั่วโมงพีค", "Peak hour", "高峰时段")} value={peak.orders > 0 ? hourLabel(peak.h) : "—"} sub={peak.orders > 0 ? formatTHB(peak.sales, false) : undefined} tone="brand" />
            <KpiTile label={L("ออเดอร์แรก", "First order", "首单")} value={hourLabel(firstHour)} />
            <KpiTile label={L("ออเดอร์สุดท้าย", "Last order", "末单")} value={hourLabel(lastHour)} />
            <KpiTile label={L("วันขายดีสุด", "Best weekday", "最佳星期")} value={bestDay.orders > 0 ? dayNames[bestDay.d] : "—"} sub={bestDay.orders > 0 ? formatTHB(bestDay.sales, false) : undefined} tone="ok" />
            <KpiTile label={L("เฉลี่ย/บิล", "Avg / bill", "客单价")} value={formatTHB(totals.avgBasket, false)} />
          </div>

          {tags.length ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tg, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface2 border border-line text-xs font-medium text-ink">
                  <span aria-hidden>{tg.icon}</span>{tg.text}
                </span>
              ))}
            </div>
          ) : null}

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title={L("ยอดขายรายชั่วโมง", "Sales by hour", "按小时销售")} subtitle={L("แท่งเข้ม = ชั่วโมงพีค", "Dark bar = peak hour", "深色 = 高峰时段")} />
              <div className="p-4 pt-2">
                {hourBars.length ? <InsightBars data={hourBars} config={barConfig} valueFormat={(n) => formatTHB(n, false)} /> : <EmptyState title={t.common.empty} />}
              </div>
            </Card>
            <Card>
              <CardHeader title={L("ยอดขายรายวัน", "Sales by weekday", "按星期销售")} subtitle={L("แท่งเข้ม = วันขายดี", "Dark bar = best day", "深色 = 最佳")} />
              <div className="p-4 pt-2">
                <InsightBars data={dayBars} config={barConfig} valueFormat={(n) => formatTHB(n, false)} />
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title={L("ช่องทางการขาย", "Sales channel", "销售渠道")} subtitle={L("สัดส่วนตามยอดขาย", "Share by sales", "按销售额占比")} />
              <div className="p-4 pt-2">{chList.length ? <MixDonut data={chList} config={chConfig} /> : <EmptyState title={t.common.empty} />}</div>
            </Card>
            <Card>
              <CardHeader title={L("ช่องทางการจ่าย", "Payment method", "付款方式")} subtitle={L("สัดส่วนตามมูลค่า", "Share by amount", "按金额占比")} />
              <div className="p-4 pt-2">{payData.length ? <MixDonut data={payData} config={payConfig} /> : <EmptyState title={t.common.empty} />}</div>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "overview" && !rows.length && !data.loading ? <EmptyState title={L("ไม่มีบิลตามตัวกรอง", "No bills match the filters", "无数据")} body={L("ลองขยายช่วงวันที่หรือล้างตัวกรอง", "Widen the date range or clear filters", "")} /> : null}

      {tab === "branch" ? <BranchView orders={rows} branches={branches} brands={brands} showCost={showCost} L={L} locale={locale} onDrill={(id) => drill({ branchIds: [id] })} /> : null}
      {tab === "brand" ? <BrandView orders={rows} branches={branches} brands={brands} L={L} locale={locale} onDrill={(id) => drill({ brandIds: [id], branchIds: [] }, "branch")} /> : null}
      {tab === "staff" && can(employee, "report.employee_perf") ? <StaffPerformance filtered={rows} employees={employees} branches={branches} brands={brands} initialPerson={sp.get("person")} /> : null}

      {tab === "bills" ? <Card>
        <CardHeader title={t.orders.title} subtitle={`${rows.length} ${t.admin.orderCount}`} />
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.pos.receiptNo}</Th>
                <Th>{t.common.date}</Th>
                <Th>{t.common.branch}</Th>
                <Th>{t.common.customer}</Th>
                <Th align="center">{t.common.status}</Th>
                <Th align="center">{L("คลังกลาง / JST", "OneWarehouse / JST", "中央仓 / JST")}</Th>
                <Th align="right">{t.common.total}</Th>
                {showCost ? <Th align="right">{t.admin.grossProfit}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((o) => {
                const b = branches.find((x) => x.id === o.branch_id);
                return (
                  <tr key={o.id} className="hover:bg-surface2/60">
                    <Td className="font-mono text-xs"><span className="inline-flex items-center gap-1">{o.order_no}<OrderTraceButton clientUuid={o.client_uuid} orderNo={o.order_no} className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted hover:text-brand hover:bg-brand/10" label="" /></span></Td>
                    <Td className="text-xs text-muted">
                      {new Date(o.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Td>
                    <Td className="text-xs truncate max-w-[180px]">{b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—"}</Td>
                    <Td className="text-xs">{o.customer_name ?? "—"}</Td>
                    <Td align="center">
                      {o.status === "voided" ? <Badge tone="danger">{t.orders.voided}</Badge> : o.client_uuid && owStatus[o.client_uuid]?.ow_status === "failed" ? <Badge tone="danger">ยังไม่สมบูรณ์</Badge> : <Badge tone="ok">{t.orders.completed}</Badge>}
                    </Td>
                    <Td align="center"><OwSaleBadge status={o.client_uuid ? owStatus[o.client_uuid] : null} /></Td>
                    <Td align="right" className="font-medium">{formatTHB(o.grand_total, false)}</Td>
                    {showCost ? <Td align="right" className="text-xs text-ok">{formatTHB(o.gross_profit, false)}</Td> : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={t.common.empty} />
        )}
      </Card> : null}
    </div>
  );
}

// ── รายสาขา: ยอด / บิล / เฉลี่ย / ส่วนลด / ยกเลิก / สัดส่วน · กดเพื่อเจาะดูสาขานั้น ──
function BranchView({ orders, branches, brands, showCost, L, locale, onDrill }: { orders: Order[]; branches: Branch[]; brands: Brand[]; showCost: boolean; L: (a: string, b: string, c: string) => string; locale: string; onDrill: (id: string) => void }) {
  const rows = useMemo(() => {
    const m = new Map<string, { sales: number; bills: number; discount: number; voids: number; units: number; gp: number; members: number }>();
    for (const o of orders) {
      const cur = m.get(o.branch_id) ?? { sales: 0, bills: 0, discount: 0, voids: 0, units: 0, gp: 0, members: 0 };
      if (o.status === "voided") cur.voids++;
      else if (isCountedSale(o)) { cur.sales += o.grand_total; cur.bills++; cur.discount += o.discount_total; cur.gp += o.gross_profit; cur.units += o.items.reduce((s, i) => s + i.qty, 0); if (o.customer_id) cur.members++; }
      m.set(o.branch_id, cur);
    }
    const total = [...m.values()].reduce((s, v) => s + v.sales, 0) || 1;
    return [...m.entries()].map(([id, v]) => {
      const b = branches.find((x) => x.id === id);
      return { id, name: b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id, code: (b as Branch & { code?: string })?.code ?? "", brand: brands.find((x) => x.id === b?.brand_id)?.name ?? "—", ...v, share: (v.sales / total) * 100 };
    }).sort((a, b) => b.sales - a.sales);
  }, [orders, branches, brands, locale]);
  const max = Math.max(1, ...rows.map((r) => r.sales));
  if (!rows.length) return <EmptyState title={L("ไม่มีข้อมูลสาขาตามตัวกรอง", "No branch data", "无数据")} />;
  return (
    <Card>
      <CardHeader title={L("ยอดขายรายสาขา", "Sales by branch", "门店销售")} subtitle={L(`${rows.length} สาขา · กดแถวเพื่อดูภาพรวมของสาขานั้น`, `${rows.length} branches · click to drill in`, "点击查看")} />
      <Table>
        <thead><tr><Th>#</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("แบรนด์", "Brand", "品牌")}</Th><Th align="right">{L("ยอดขาย", "Sales", "销售额")}</Th><Th>{L("สัดส่วน", "Share", "占比")}</Th>
          <Th align="right">{L("บิล", "Bills", "单数")}</Th><Th align="right">{L("เฉลี่ย/บิล", "Avg", "客单价")}</Th><Th align="right">{L("ชิ้น", "Units", "件数")}</Th><Th align="right">{L("ส่วนลด", "Discount", "折扣")}</Th>
          <Th align="right">{L("ยกเลิก", "Voids", "作废")}</Th><Th align="right">{L("สมาชิก", "Members", "会员")}</Th>{showCost ? <Th align="right">{L("กำไรขั้นต้น", "GP", "毛利")}</Th> : null}<Th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => onDrill(r.id)}>
            <Td className="text-xs text-muted tnum">{i + 1}</Td>
            <Td className="text-xs font-medium">{r.name}{r.code ? <span className="block text-[10px] text-muted font-mono">{r.code}</span> : null}</Td>
            <Td className="text-xs text-muted">{r.brand}</Td>
            <Td align="right" className="text-sm font-semibold tnum">{formatTHB(r.sales, false)}</Td>
            <Td><div className="flex items-center gap-2 min-w-[120px]"><div className="h-2 flex-1 rounded-full bg-surface2 overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${(r.sales / max) * 100}%` }} /></div><span className="text-[11px] text-muted tnum w-10 text-right">{r.share.toFixed(1)}%</span></div></Td>
            <Td align="right" className="text-xs tnum">{formatInt(r.bills)}</Td>
            <Td align="right" className="text-xs tnum">{formatTHB(r.bills ? r.sales / r.bills : 0, false)}</Td>
            <Td align="right" className="text-xs tnum">{formatInt(r.units)}</Td>
            <Td align="right" className="text-xs tnum text-warn">{formatTHB(r.discount, false)}</Td>
            <Td align="right" className={`text-xs tnum ${r.voids ? "text-danger" : "text-muted"}`}>{r.voids}</Td>
            <Td align="right" className="text-xs tnum">{r.bills ? `${Math.round((r.members / r.bills) * 100)}%` : "—"}</Td>
            {showCost ? <Td align="right" className="text-xs tnum text-ok">{formatTHB(r.gp, false)}</Td> : null}
            <Td><ChevronRight size={14} className="text-muted" /></Td>
          </tr>
        ))}</tbody>
      </Table>
    </Card>
  );
}

// ── แบรนด์: ยอดรวม / สาขาที่ขายได้ / สาขาท็อป · กดเพื่อดูรายสาขาในแบรนด์ ──
function BrandView({ orders, branches, brands, L, locale, onDrill }: { orders: Order[]; branches: Branch[]; brands: Brand[]; L: (a: string, b: string, c: string) => string; locale: string; onDrill: (id: string) => void }) {
  const rows = useMemo(() => {
    const br = new Map(branches.map((b) => [b.id, b]));
    const m = new Map<string, { sales: number; bills: number; units: number; branchSales: Map<string, number> }>();
    for (const o of orders) {
      if (!isCountedSale(o)) continue;
      const bid = br.get(o.branch_id)?.brand_id ?? "none";
      const cur = m.get(bid) ?? { sales: 0, bills: 0, units: 0, branchSales: new Map() };
      cur.sales += o.grand_total; cur.bills++; cur.units += o.items.reduce((s, i) => s + i.qty, 0);
      cur.branchSales.set(o.branch_id, (cur.branchSales.get(o.branch_id) ?? 0) + o.grand_total);
      m.set(bid, cur);
    }
    const total = [...m.values()].reduce((s, v) => s + v.sales, 0) || 1;
    return [...m.entries()].map(([id, v]) => {
      const b = brands.find((x) => x.id === id);
      const top = [...v.branchSales.entries()].sort((a, c) => c[1] - a[1])[0];
      const tb = top ? br.get(top[0]) : null;
      return { id, name: b ? (locale === "zh" ? (b as Brand & { name_zh?: string }).name_zh ?? b.name : b.name) : L("ไม่ระบุแบรนด์", "No brand", "无品牌"), ...v, share: (v.sales / total) * 100,
        branchCount: v.branchSales.size, top: tb ? `${locale === "th" ? tb.name_th ?? tb.name : tb.name} · ${formatTHB(top![1], false)}` : "—" };
    }).sort((a, b) => b.sales - a.sales);
  }, [orders, branches, brands, locale, L]);
  if (!rows.length) return <EmptyState title={L("ไม่มีข้อมูลแบรนด์ตามตัวกรอง", "No brand data", "无数据")} />;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.map((r) => (
        <button key={r.id} onClick={() => r.id !== "none" && onDrill(r.id)} className="card p-4 text-left hover:ring-1 hover:ring-brand/30 transition">
          <div className="flex items-center justify-between gap-2"><p className="font-semibold truncate">{r.name}</p><span className="text-xs text-muted tnum">{r.share.toFixed(1)}%</span></div>
          <p className="text-2xl font-bold tnum mt-1">{formatTHB(r.sales, false)}</p>
          <div className="h-1.5 rounded-full bg-surface2 overflow-hidden mt-2"><div className="h-full bg-brand rounded-full" style={{ width: `${r.share}%` }} /></div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <span><span className="block text-muted">{L("บิล", "Bills", "单数")}</span><b className="tnum">{formatInt(r.bills)}</b></span>
            <span><span className="block text-muted">{L("เฉลี่ย/บิล", "Avg", "客单价")}</span><b className="tnum">{formatTHB(r.bills ? r.sales / r.bills : 0, false)}</b></span>
            <span><span className="block text-muted">{L("สาขาที่ขาย", "Branches", "门店")}</span><b className="tnum">{r.branchCount}</b></span>
          </div>
          <p className="text-[11px] text-muted mt-2 truncate">{L("สาขาท็อป", "Top branch", "最佳门店")}: {r.top}</p>
        </button>
      ))}
    </div>
  );
}
