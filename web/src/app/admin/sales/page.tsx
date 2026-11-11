"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders } from "@/lib/data/repo";
import type { Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, KpiTile } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders, summarize, salesSeries, paymentMix, topProducts } from "@/lib/analytics";
import { formatTHB, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";
import { BranchRadar, SalesAreaTrend, InsightBars, MixDonut } from "@/components/charts-rich";
import CellColumnTrend from "@/components/ui/cell-column-trend";
import type { ChartConfig } from "@/components/ui/chart";

export default function AdminSalesPage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    void listOrders().then(setOrders);
  }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);

  const rows = useMemo(() => {
    const list = filterOrders(scoped, { ...filter, branches });
    const term = q.trim().toLowerCase();
    return term
      ? list.filter((o) => o.order_no.toLowerCase().includes(term) || (o.customer_name ?? "").toLowerCase().includes(term))
      : list;
  }, [scoped, filter, branches, q]);

  const totals = summarize(rows);
  const showCost = can(employee, "report.cost");
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  // ── ข้อมูลกราฟใหม่ ──
  const trend = useMemo(() => salesSeries(rows, "day"), [rows]);
  const areaData = useMemo(() => trend.map((s) => ({ label: s.label, value: s.value })), [trend]);
  const areaConfig: ChartConfig = { value: { label: L("ยอดขาย", "Sales", "销售额"), color: "rgb(var(--chart-1))" } };

  const radarData = useMemo(() => {
    const map = new Map<string, { label: string; sales: number; orders: number }>();
    for (const o of rows) {
      if (o.status === "voided") continue;
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
  const active = useMemo(() => rows.filter((o) => o.status !== "voided"), [rows]);
  const hourAgg = useMemo(() => {
    const a = Array.from({ length: 24 }, (_, h) => ({ h, sales: 0, orders: 0 }));
    for (const o of active) { const h = new Date(o.created_at).getHours(); a[h].sales += o.grand_total; a[h].orders += 1; }
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t.admin.gmv} value={formatTHB(totals.gross)} tone="brand" />
        <KpiTile label={t.admin.orderCount} value={formatInt(totals.orders)} />
        <KpiTile label={t.pos.discount} value={formatTHB(totals.discount)} tone="warn" />
        <KpiTile label={t.pos.vat} value={formatTHB(totals.gross - totals.gross / 1.07)} />
      </div>

      {/* ── กราฟใหม่ ── */}
      {rows.length ? (
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

      <Card>
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
                <Th align="right">{t.common.total}</Th>
                {showCost ? <Th align="right">{t.admin.grossProfit}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((o) => {
                const b = branches.find((x) => x.id === o.branch_id);
                return (
                  <tr key={o.id} className="hover:bg-surface2/60">
                    <Td className="font-mono text-xs">{o.order_no}</Td>
                    <Td className="text-xs text-muted">
                      {new Date(o.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Td>
                    <Td className="text-xs truncate max-w-[180px]">{b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—"}</Td>
                    <Td className="text-xs">{o.customer_name ?? "—"}</Td>
                    <Td align="center">
                      {o.status === "voided" ? <Badge tone="danger">{t.orders.voided}</Badge> : <Badge tone="ok">{t.orders.completed}</Badge>}
                    </Td>
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
      </Card>
    </div>
  );
}
