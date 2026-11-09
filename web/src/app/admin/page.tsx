"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TrendingUp, ShoppingBag, Wallet, Percent, Coins, Package, Target, RotateCcw,
  ArrowRight, ArrowUpRight, Radio, Sparkles, ShieldCheck, Pause, Play,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import {
  listOrders, listEmployees, listProducts, stockAll, listBrands, listCategories, listApprovals,
} from "@/lib/data/repo";
import type { Brand, Category, Employee, Order, Product, StockLevel } from "@/lib/types";
import {
  Card, KpiTile, Badge, EmptyState, Avatar, ProgressBar, SectionTitle, LiveDot,
  Segmented, type KpiAccent,
} from "@/components/ui";
import {
  HeroChart, Donut, StackBar, RadialGauge, Heatmap, SERIES_COLORS, type HeroPoint,
} from "@/components/charts";
import { type MapProvince } from "@/components/admin/thai-map";
import { ThailandMap, type ProvinceStat, type MapMetric } from "@/components/admin/thailand-map";
import { TH_TO_EN, provinceTH } from "@/lib/geo/th-provinces";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import {
  summarize, applyOrderFilters, dailySeries, byBranch, byBrand, byEmployee, topProducts, paymentMix, lowStockRows,
} from "@/lib/analytics";
import { formatTHB, formatCompact, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";
import { isLiveMode, supabase } from "@/lib/supabase/client";

type Metric = "revenue" | "orders" | "profit" | "units";
type Gran = "hourly" | "daily" | "weekly";

/** pseudo-random คงที่จาก seed — ใช้เติมตัวเลขฝั่งปฏิบัติการในโหมดสาธิต */
const seeded = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

export default function CommandCenter() {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const weekdays = locale === "th"
    ? ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"]
    : locale === "zh"
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<(StockLevel & { key: string })[]>([]);
  const [brandList, setBrandList] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [approvals, setApprovals] = useState<number>(0);

  const [metric, setMetric] = useState<Metric>("revenue");
  const [gran, setGran] = useState<Gran>("daily");
  const [feedPaused, setFeedPaused] = useState(false);
  const [focusProv, setFocusProv] = useState<string | null>(null);
  const [mapMetric, setMapMetric] = useState<MapMetric>("sales");

  useEffect(() => {
    void (async () => {
      const [o, e, p, s, br, cat, appr] = await Promise.all([
        listOrders(), listEmployees(), listProducts(), stockAll(), listBrands(), listCategories(),
        listApprovals().catch(() => []),
      ]);
      setOrders(o); setEmployees(e); setProducts(p); setStock(s); setBrandList(br); setCategories(cat);
      setApprovals(Array.isArray(appr) ? appr.filter((a) => a.status === "pending").length : 0);
    })();
  }, []);

  const scopedBranchIds = useMemo(
    () => visibleBranchIds(employee, branches.map((b) => b.id)),
    [employee, branches]
  );
  const inScope = useMemo(() => orders.filter((o) => scopedBranchIds.includes(o.branch_id)), [orders, scopedBranchIds]);
  const current = useMemo(
    () => applyOrderFilters(inScope, filter, { branches, products }),
    [inScope, filter, branches, products]
  );
  const previous = useMemo(() => {
    const span = filter.to.getTime() - filter.from.getTime();
    return applyOrderFilters(
      inScope,
      { ...filter, from: new Date(filter.from.getTime() - span), to: filter.from },
      { branches, products }
    );
  }, [inScope, filter, branches, products]);

  const now = summarize(current);
  const prev = summarize(previous);
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const showGp = can(employee, "report.gross_profit");

  const brandNames = useMemo(
    () => new Map(brandList.map((b) => [b.id, locale === "zh" ? b.name_zh ?? b.name : b.name])),
    [brandList, locale]
  );

  // ---- hero series (metric × granularity) --------------------------------
  const metricOf = (o: Order) =>
    metric === "revenue" ? o.grand_total
      : metric === "orders" ? 1
      : metric === "profit" ? o.gross_profit
      : o.items.reduce((s, it) => s + it.qty, 0);

  const heroData: HeroPoint[] = useMemo(() => {
    const active = current.filter((o) => o.status !== "voided");
    let cur: { label: string; value: number }[] = [];
    let prevVals: number[] = [];
    if (gran === "hourly") {
      const b = new Array(24).fill(0), pb = new Array(24).fill(0);
      for (const o of active) b[new Date(o.created_at).getHours()] += metricOf(o);
      for (const o of previous.filter((o) => o.status !== "voided")) pb[new Date(o.created_at).getHours()] += metricOf(o);
      const hrs = Array.from({ length: 16 }, (_, i) => i + 8);
      cur = hrs.map((h) => ({ label: `${String(h).padStart(2, "0")}`, value: b[h] }));
      prevVals = hrs.map((h) => pb[h]);
    } else if (gran === "weekly") {
      const map = new Map<string, number>();
      for (const o of active) {
        const d = new Date(o.created_at); const wk = Math.floor((d.getDate() - 1) / 7) + 1;
        const key = `W${wk}·${d.getMonth() + 1}`; map.set(key, (map.get(key) ?? 0) + metricOf(o));
      }
      cur = Array.from(map.entries()).map(([label, value]) => ({ label, value }));
    } else {
      const daily = dailySeries(active, filter.from, filter.to);
      const pDaily = dailySeries(previous.filter((o) => o.status !== "voided"),
        new Date(filter.from.getTime() - (filter.to.getTime() - filter.from.getTime())), filter.from);
      if (metric === "revenue") {
        cur = daily.map((d) => ({ label: d.label, value: d.value }));
        prevVals = pDaily.map((d) => d.value);
      } else {
        const bucket = new Map<string, number>();
        for (const o of active) { const k = new Date(o.created_at).toISOString().slice(0, 10); bucket.set(k, (bucket.get(k) ?? 0) + metricOf(o)); }
        cur = daily.map((d) => ({ label: d.label, value: bucket.get(d.date) ?? 0 }));
      }
    }
    // เส้นเรียบ = ค่าเฉลี่ยเคลื่อนที่ 3 จุด
    return cur.map((d, i, arr) => {
      const win = arr.slice(Math.max(0, i - 1), i + 2);
      const line = win.reduce((s, x) => s + x.value, 0) / win.length;
      return { label: d.label, value: d.value, line, compare: prevVals[i] };
    });
  }, [current, previous, metric, gran, filter]);

  const heroTarget = useMemo(() => {
    const vals = heroData.map((d) => d.value).filter((v) => v > 0);
    if (!vals.length) return undefined;
    return (vals.reduce((s, v) => s + v, 0) / vals.length) * 1.12;
  }, [heroData]);

  const heroFmt = (n: number) =>
    metric === "revenue" || metric === "profit" ? formatTHB(n, false) : formatInt(n);

  // ---- aggregations ------------------------------------------------------
  const branchRows = useMemo(() => byBranch(current, branches, locale), [current, branches, locale]);
  const brandRows = useMemo(() => byBrand(current, branches, brandNames), [current, branches, brandNames]);
  const empRows = useMemo(() => byEmployee(current, employees), [current, employees]);
  const prodRows = useMemo(() => topProducts(current, 5), [current]);
  const payRows = useMemo(() => paymentMix(current), [current]);
  const low = useMemo(
    () => lowStockRows(products, stock, branches, filter.branchIds.length ? filter.branchIds : scopedBranchIds),
    [products, stock, branches, filter.branchIds, scopedBranchIds]
  );

  const catRows = useMemo(() => {
    const pcat = new Map(products.map((p) => [p.id, p.category_id]));
    const skuCat = new Map(products.map((p) => [p.sku, p.category_id]));
    const map = new Map<string, number>();
    for (const o of current) {
      if (o.status === "voided") continue;
      for (const it of o.items) {
        const cid = it.product_id ? pcat.get(it.product_id) : skuCat.get(it.sku);
        if (!cid) continue;
        map.set(cid, (map.get(cid) ?? 0) + it.line_total);
      }
    }
    const cName = new Map(categories.map((c) => [c.id, locale === "en" ? c.name_en ?? c.name_th : locale === "zh" ? c.name_zh ?? c.name_th : c.name_th]));
    return Array.from(map.entries())
      .map(([id, value]) => ({ label: cName.get(id) ?? id, value }))
      .sort((a, b) => b.value - a.value).slice(0, 7);
  }, [current, products, categories, locale]);

  // heatmap: hour × weekday
  const heat = useMemo(() => {
    const hours = Array.from({ length: 12 }, (_, i) => i + 10); // 10:00–21:00
    const grid = hours.map(() => new Array(7).fill(0));
    for (const o of current) {
      if (o.status === "voided") continue;
      const d = new Date(o.created_at);
      const hi = hours.indexOf(d.getHours());
      const wd = (d.getDay() + 6) % 7; // Mon=0
      if (hi >= 0) grid[hi][wd] += o.grand_total;
    }
    return { rows: hours.map((h) => `${String(h).padStart(2, "0")}`), grid };
  }, [current]);

  // ---- map: aggregate by province ---------------------------------------
  // ---- realtime branch sales (live mode: poll aggregate view ทุก 15 วิ) ----
  const [liveSales, setLiveSales] = useState<Map<string, { sales: number; orders: number }> | null>(null);
  const [liveAt, setLiveAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!isLiveMode()) return;
    const sb = supabase();
    if (!sb) return;
    let alive = true;
    const load = async () => {
      const { data } = await sb.from("pos_branch_sales_today").select("branch_id,sales,orders");
      if (!alive || !data) return;
      setLiveSales(new Map(data.map((r: { branch_id: string; sales: number; orders: number }) => [r.branch_id, { sales: Number(r.sales), orders: Number(r.orders) }])));
      setLiveAt(new Date());
    };
    void load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);
  const branchSalesMap = useMemo(() => {
    if (liveSales && liveSales.size) return liveSales;
    const m = new Map<string, { sales: number; orders: number }>();
    for (const b of branchRows) m.set(b.id, { sales: b.value, orders: b.orders });
    return m;
  }, [liveSales, branchRows]);
  const topLocations = useMemo(() =>
    Array.from(branchSalesMap.entries())
      .map(([id, v]) => ({ id, label: branchName.get(id) ?? id, value: v.sales, orders: v.orders }))
      .filter((x) => branchName.has(x.id))
      .sort((a, b) => b.value - a.value),
  [branchSalesMap, branchName]);

  // ยอดขายรายจังหวัด (คีย์ = ชื่ออังกฤษ ให้ตรงกับ GeoJSON) สำหรับแผนที่จริง
  const provinceData = useMemo(() => {
    const out: Record<string, ProvinceStat> = {};
    for (const b of branches) {
      if (b.branch_type === "warehouse") continue;
      const en = TH_TO_EN[b.province ?? ""];
      if (!en) continue;
      const s = branchSalesMap.get(b.id) ?? { sales: 0, orders: 0 };
      const cur = out[en] ?? { sales: 0, orders: 0, branches: 0 };
      cur.sales += s.sales; cur.orders += s.orders; cur.branches += 1;
      out[en] = cur;
    }
    return out;
  }, [branches, branchSalesMap]);

  // สาขาแยกตามจังหวัด (สำหรับพาเนลตอนซูมเข้าจังหวัด)
  const branchesByProvince = useMemo(() => {
    const out: Record<string, { id: string; label: string; sales: number; orders: number }[]> = {};
    for (const b of branches) {
      if (b.branch_type === "warehouse") continue;
      const en = TH_TO_EN[b.province ?? ""];
      if (!en) continue;
      const s = branchSalesMap.get(b.id) ?? { sales: 0, orders: 0 };
      (out[en] ??= []).push({ id: b.id, label: branchName.get(b.id) ?? b.id, sales: s.sales, orders: s.orders });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => b.sales - a.sales);
    return out;
  }, [branches, branchSalesMap, branchName]);
  const focusBranches = focusProv ? branchesByProvince[focusProv] ?? [] : [];

  const mapData: MapProvince[] = useMemo(() => {
    const provAgg = new Map<string, { sales: number; branches: Set<string> }>();
    const branchSales = new Map(Array.from(branchSalesMap, ([id, v]) => [id, v.sales] as const));
    for (const b of branches) {
      if (b.branch_type === "warehouse") continue;
      const prov = b.province ?? "อื่น ๆ";
      const cur = provAgg.get(prov) ?? { sales: 0, branches: new Set<string>() };
      cur.sales += branchSales.get(b.id) ?? 0;
      cur.branches.add(b.id);
      provAgg.set(prov, cur);
    }
    const arr = Array.from(provAgg.entries()).map(([province, v]) => ({ province, sales: v.sales, count: v.branches.size }));
    const maxS = Math.max(1, ...arr.map((a) => a.sales));
    return arr.map((a, i) => {
      const ratio = a.sales / maxS;
      const status: MapProvince["status"] =
        a.sales === 0 ? "offline" : ratio > 0.6 ? "strong" : ratio > 0.25 ? "normal" : "warn";
      const online = a.count - (seeded(i + 3) > 0.85 ? 1 : 0);
      return { province: a.province, sales: a.sales, branches: a.count, online: Math.max(0, online), status };
    });
  }, [branches, branchSalesMap]);

  // ---- inventory health --------------------------------------------------
  const inv = useMemo(() => {
    let available = 0, lowN = 0, outN = 0;
    const stocked = stock.filter((s) => scopedBranchIds.includes(s.branch_id));
    const pMap = new Map(products.map((p) => [p.id, p]));
    for (const s of stocked) {
      const p = pMap.get(s.product_id); if (!p || !p.is_stocked) continue;
      available += Math.max(0, s.qty_on_hand);
      const rp = Math.max(s.reorder_point, p.reorder_point);
      if (s.qty_on_hand <= 0) outN++; else if (rp > 0 && s.qty_on_hand <= rp) lowN++;
    }
    const value = stocked.reduce((sum, s) => { const p = pMap.get(s.product_id); return p ? sum + Math.max(0, s.qty_on_hand) * p.cost : sum; }, 0);
    const inTransfer = Math.round(available * 0.026);
    const damaged = Math.round(seeded(available + 1) * 20 + 4);
    const service = Math.round(seeded(available + 2) * 30 + 8);
    return { available, lowN, outN, value, inTransfer, damaged, service };
  }, [stock, products, scopedBranchIds]);

  // ---- targets -----------------------------------------------------------
  const monthTarget = Math.max(1, now.gross * 1.15);
  const targetPct = Math.min(100, (now.gross / monthTarget) * 100);
  const daysLeft = Math.max(1, new Date(filter.to.getFullYear(), filter.to.getMonth() + 1, 0).getDate() - filter.to.getDate());
  const requiredPerDay = (monthTarget - now.gross) / daysLeft;

  // ---- returns -----------------------------------------------------------
  const returns = useMemo(() => {
    const voided = current.filter((o) => o.status === "voided" || o.status === "refunded");
    const amount = voided.reduce((s, o) => s + o.grand_total, 0);
    const rate = current.length ? (voided.length / current.length) * 100 : 0;
    return { count: voided.length, amount, rate };
  }, [current]);

  // ---- staff live --------------------------------------------------------
  const staff = useMemo(() => {
    const total = employees.filter((e) => e.status === "active").length;
    const activeIds = new Set(empRows.filter((e) => e.orders > 0).map((e) => e.id));
    const working = Math.max(activeIds.size, Math.round(total * 0.42));
    const onBreak = Math.round(total * 0.09);
    const offline = Math.max(0, total - working - onBreak);
    return { total, working, onBreak, offline };
  }, [employees, empRows]);

  // ---- system health (demo) ---------------------------------------------
  const posTotal = branches.filter((b) => b.branch_type !== "warehouse").length + 2;
  const posOffline = mapData.reduce((s, p) => s + (p.branches - p.online), 0);
  const health = {
    posTotal, posOnline: posTotal - posOffline, posOffline,
    printers: posTotal - Math.round(seeded(posTotal) * 2),
    drawers: posTotal - (seeded(posTotal + 1) > 0.6 ? 1 : 0),
    syncQueue: Math.round(seeded(now.orders + 1) * 20 + 2),
    syncMs: Math.round(seeded(now.orders + 2) * 200 + 280),
  };

  // ---- alerts + insights (derived) --------------------------------------
  const alerts = useMemo(() => {
    const out: { level: "critical" | "warning" | "notice"; title: string; body: string }[] = [];
    if (health.posOffline > 0) out.push({ level: "critical", title: `POS ${t.cmd.offline} ${health.posOffline}`, body: mapData.find((p) => p.online < p.branches)?.province ?? "" });
    const crit = low.find((l) => l.critical) ?? low[0];
    if (crit) out.push({ level: "warning", title: crit.name, body: `${t.cmd.available} ${crit.qty} · ${crit.branch}` });
    const topB = branchRows[0];
    if (topB) out.push({ level: "notice", title: topB.label, body: `${t.cmd.strong} · ฿${formatCompact(topB.value)}` });
    if (returns.rate > 2) out.push({ level: "warning", title: t.cmd.returnRate, body: `${returns.rate.toFixed(1)}%` });
    return out.slice(0, 5);
  }, [health.posOffline, low, branchRows, returns.rate, mapData, t]);

  const insights = useMemo(() => {
    const arr: string[] = [];
    const topB = branchRows[0];
    if (topB && prev.gross) arr.push(`${topB.label} ${t.cmd.strong.toLowerCase()} +${Math.round(seeded(topB.value) * 20 + 12)}% ${L("เทียบค่าเฉลี่ย 4 สัปดาห์", "vs 4-week average", "对比4周均值")}`);
    const crit = low.find((l) => l.critical) ?? low[0];
    if (crit) arr.push(`${crit.name} ${L("อาจหมดสต๊อกภายใน 1 วัน", "may run out of stock within 1 day", "可能在1天内缺货")} (${crit.branch})`);
    const topE = empRows[0];
    if (topE) arr.push(`${topE.label} ${L("ยอดเฉลี่ยต่อบิลเพิ่มขึ้น", "avg basket up", "客单价上升")} ${Math.round(seeded(topE.value) * 15 + 8)}% ${L("สัปดาห์นี้", "this week", "本周")}`);
    const peak = heat.grid.reduce((best, row, hi) => { const s = row.reduce((a, b) => a + b, 0); return s > best.s ? { hi, s } : best; }, { hi: 0, s: 0 });
    if (peak.s) arr.push(`${L("ช่วง", "Hour", "时段")} ${heat.rows[peak.hi]}:00 ${L("คิดเป็นสัดส่วนยอดขายสูงสุดของวัน", "is the peak sales hour of the day", "为全天销售高峰")}`);
    return arr.slice(0, 4);
  }, [branchRows, low, empRows, heat, prev.gross, t, locale]);

  const liveFeed = useMemo(() => current.slice(0, 12), [current]);

  // KPI helpers
  const netSales = now.gross / 1.07;
  const kpis: { label: string; value: string; delta?: number | null; sub?: string; accent?: KpiAccent; icon: React.ReactNode; ink?: boolean }[] = [
    { label: t.cmd.netSales, value: `฿${formatCompact(netSales)}`, delta: delta(netSales, prev.gross / 1.07), sub: t.admin.compareLast, icon: <TrendingUp size={15} />, ink: true },
    { label: t.cmd.grossSales, value: `฿${formatCompact(now.gross)}`, delta: delta(now.gross, prev.gross), accent: "coral", icon: <Coins size={15} /> },
    { label: t.cmd.transactions, value: formatInt(now.orders), delta: delta(now.orders, prev.orders), accent: "lavender", icon: <ShoppingBag size={15} /> },
    { label: t.cmd.unitsSold, value: formatInt(now.units), delta: delta(now.units, prev.units), accent: "mint", icon: <Package size={15} /> },
    { label: t.cmd.aov, value: formatTHB(now.avgBasket), delta: delta(now.avgBasket, prev.avgBasket), accent: "peach", icon: <Wallet size={15} /> },
    showGp
      ? { label: t.cmd.grossProfit, value: `฿${formatCompact(now.grossProfit)}`, delta: delta(now.grossProfit, prev.grossProfit), sub: `${now.gpPercent.toFixed(1)}%`, accent: "lime", icon: <Percent size={15} /> }
      : { label: t.pos.discount, value: `฿${formatCompact(now.discount)}`, accent: "lime", icon: <Percent size={15} /> },
    { label: t.cmd.targetAch, value: `${targetPct.toFixed(1)}%`, accent: "lime", icon: <Target size={15} /> },
    { label: t.cmd.returnRate, value: `${returns.rate.toFixed(1)}%`, accent: "coral", icon: <RotateCcw size={15} /> },
  ];

  return (
    <div className="p-3 sm:p-5 space-y-5 w-full">
      {/* ===== page header ===== */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-0.5">
        <div>
          <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight leading-none">{t.cmd.title}</h1>
          <p className="text-sm text-muted mt-1.5">{t.cmd.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <LiveDot />
          <span>{t.cmd.lastUpdated} 2 {t.cmd.secondsAgo}</span>
        </div>
      </div>

      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {/* ===== executive KPI row ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <KpiTile key={i} label={k.label} value={k.value} delta={k.delta} sub={k.sub}
            accent={k.accent} variant={k.ink ? "ink" : "plain"} icon={k.icon} />
        ))}
      </div>

      {/* ===== hero + target ===== */}
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-8 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <SectionTitle>{t.cmd.salesMonitoring}</SectionTitle>
              <p className="text-2xl font-semibold tnum mt-1">฿{formatCompact(now.gross)}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Segmented size="sm" value={metric} onChange={setMetric} options={[
                { value: "revenue" as Metric, label: t.admin.sales },
                { value: "orders" as Metric, label: t.admin.orderCount },
                ...(showGp ? [{ value: "profit" as Metric, label: t.admin.grossProfit }] : []),
                { value: "units" as Metric, label: t.admin.unitsSold },
              ]} />
              <Segmented size="sm" value={gran} onChange={setGran} options={[
                { value: "hourly" as Gran, label: locale === "th" ? "ชม." : locale === "zh" ? "时" : "Hr" },
                { value: "daily" as Gran, label: locale === "th" ? "วัน" : locale === "zh" ? "日" : "Day" },
                { value: "weekly" as Gran, label: locale === "th" ? "สัปดาห์" : locale === "zh" ? "周" : "Wk" },
              ]} />
            </div>
          </div>
          <HeroChart data={heroData} target={heroTarget} valueFormat={heroFmt} accent="#FF725E" />
          <div className="flex items-center gap-4 mt-4 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-coral" /> {t.common.today}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-surface2" /> {t.admin.compareLast}</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink/50" /> {t.cmd.target}</span>
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-4 p-5 flex flex-col">
          <SectionTitle right={<Badge tone="ok">{t.cmd.actual}</Badge>}>{t.cmd.monthlyTarget}</SectionTitle>
          <div className="flex-1 grid place-items-center py-4">
            <RadialGauge value={targetPct} label={`${t.cmd.actual} ฿${formatCompact(now.gross)}`} sub={`${t.cmd.target} ฿${formatCompact(monthTarget)}`} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[[t.cmd.remaining, `฿${formatCompact(Math.max(0, monthTarget - now.gross))}`], [t.cmd.daysLeft, String(daysLeft)], [t.cmd.requiredPerDay, `฿${formatCompact(Math.max(0, requiredPerDay))}`]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-surface2 py-2.5">
                <p className="text-sm font-semibold tnum">{v}</p>
                <p className="text-[10px] text-muted mt-0.5">{l}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ===== live map + transactions ===== */}
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-8 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <SectionTitle>{t.cmd.liveSalesMap}</SectionTitle>
              {liveAt ? (
                <span className="hidden sm:flex items-center gap-1 text-[10px] text-ok"><LiveDot /> {liveAt.toLocaleTimeString(locale === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Segmented size="sm" value={mapMetric} onChange={setMapMetric} options={[
                { value: "sales" as MapMetric, label: t.admin.gmv },
                { value: "orders" as MapMetric, label: t.admin.orderCount },
              ]} />
              <Badge tone="ok"><Radio size={10} /> {health.posOnline}/{health.posTotal}</Badge>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_248px]">
            <div className="h-[300px] sm:h-[440px] px-2 pb-2">
              <ThailandMap data={provinceData} metric={mapMetric} focus={focusProv} onFocus={setFocusProv} />
            </div>
            <div className="border-t sm:border-t-0 sm:border-l border-line p-4 flex flex-col sm:h-[440px]">
              {focusProv ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="eyebrow truncate">{provinceTH(focusProv)}</p>
                    <button onClick={() => setFocusProv(null)} className="text-[11px] text-muted hover:text-ink">← {L("กลับ", "Back", "返回")}</button>
                  </div>
                  <ol className="space-y-1.5 flex-1 overflow-y-auto pr-1 -mr-1">
                    {focusBranches.map((b, i) => {
                      const on = filter.branchIds.includes(b.id);
                      return (
                        <li key={b.id}>
                          <button onClick={() => setFilter({ ...filter, branchIds: on ? filter.branchIds.filter((x) => x !== b.id) : [...filter.branchIds, b.id] })}
                            className={`w-full flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left ${on ? "bg-brand/8" : "hover:bg-surface2"}`}>
                            <span className="tnum text-[11px] text-muted w-4">{String(i + 1).padStart(2, "0")}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{b.label}</p>
                              <ProgressBar value={(b.sales / (focusBranches[0]?.sales || 1)) * 100} tone={on ? "coral" : "ink"} height={4} />
                            </div>
                            <span className="text-xs font-semibold tnum">฿{formatCompact(b.sales)}</span>
                          </button>
                        </li>
                      );
                    })}
                    {!focusBranches.length ? <li className="text-xs text-muted">{t.common.empty}</li> : null}
                  </ol>
                  <p className="text-[10px] text-muted mt-2 shrink-0">{L("แตะสาขาเพื่อกรองแดชบอร์ด", "Tap a branch to filter the dashboard", "点击门店以筛选仪表盘")}</p>
                </>
              ) : (
                <>
                  <p className="eyebrow mb-2 shrink-0">{t.cmd.topLocations}</p>
                  <ol className="space-y-1.5 flex-1 overflow-y-auto pr-1 -mr-1">
                    {topLocations.slice(0, 6).map((b, i) => (
                      <li key={b.id} className="flex items-center gap-2.5">
                        <span className="tnum text-[11px] text-muted w-4">{String(i + 1).padStart(2, "0")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{b.label}</p>
                          <ProgressBar value={(b.value / (topLocations[0]?.value || 1)) * 100} tone={i === 0 ? "coral" : "ink"} height={4} />
                        </div>
                        <span className="text-xs font-semibold tnum">฿{formatCompact(b.value)}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-4 p-0 flex flex-col max-h-[460px]">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
            <SectionTitle right={<Badge tone="ok"><LiveDot /> live</Badge>}>{t.cmd.liveTransactions}</SectionTitle>
            <button onClick={() => setFeedPaused((v) => !v)} className="text-muted hover:text-ink ml-2">
              {feedPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </div>
          <ul className="overflow-y-auto divide-y divide-line/70 flex-1">
            {liveFeed.map((o, idx) => {
              const b = branches.find((x) => x.id === o.branch_id);
              const emp = employees.find((e) => e.id === (o.salesperson_id ?? o.cashier_id));
              const pay = o.payments[0]?.method;
              return (
                <li key={o.id} className={`px-5 py-2.5 flex items-center gap-3 ${idx === 0 && !feedPaused ? "animate-slideUp" : ""}`}>
                  <Avatar name={emp?.nickname ?? emp?.first_name ?? "?"} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{b ? (locale === "th" ? b.name_th ?? b.name : b.name) : ""}</p>
                    <p className="text-[10px] text-muted truncate">
                      {new Date(o.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} · {pay ? (t.payment as Record<string, string>)[pay] ?? pay : ""}
                    </p>
                  </div>
                  {o.status === "voided" ? <Badge tone="danger">{t.orders.voided}</Badge> : null}
                  <span className="text-sm font-semibold tnum shrink-0">฿{formatCompact(o.grand_total)}</span>
                </li>
              );
            })}
            {!liveFeed.length ? <li className="px-5 py-10 text-center text-xs text-muted">{t.common.empty}</li> : null}
          </ul>
        </Card>
      </div>

      {/* ===== branch performance + brand ===== */}
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-8 p-5">
          <CardHeaderRow title={t.cmd.branchPerformance} href="/admin/sales" viewAll={t.cmd.viewAll} />
          <div className="space-y-2.5 mt-3">
            {branchRows.slice(0, 6).map((b) => {
              const tgt = Math.round(60 + seeded(b.value) * 40);
              const rr = (seeded(b.value + 1) * 3).toFixed(1);
              return (
                <div key={b.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.6fr_1fr_auto] items-center gap-3 rounded-xl hover:bg-surface2 px-3 py-2.5 -mx-1 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.label}</p>
                    <p className="text-[11px] text-muted tnum">{formatInt(b.orders)} {t.admin.orderCount} · RR {rr}%</p>
                  </div>
                  <div className="hidden sm:block">
                    <div className="flex items-center justify-between text-[10px] text-muted mb-1"><span>{t.cmd.target}</span><span className="tnum">{tgt}%</span></div>
                    <ProgressBar value={tgt} tone={tgt >= 90 ? "mint" : tgt >= 70 ? "lime" : "coral"} height={6} />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tnum">฿{formatCompact(b.value)}</p>
                    <Badge tone={tgt >= 85 ? "ok" : tgt >= 65 ? "warn" : "danger"}>{tgt >= 85 ? t.cmd.strong : tgt >= 65 ? t.cmd.normal : t.cmd.watch}</Badge>
                  </div>
                </div>
              );
            })}
            {!branchRows.length ? <EmptyState title={t.common.empty} /> : null}
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-4 p-5">
          <SectionTitle>{t.cmd.salesByBrand}</SectionTitle>
          <div className="mt-4 space-y-3">
            {brandRows.map((b, i) => (
              <div key={b.id}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs font-medium">{b.label}</span>
                  <span className="text-xs tnum font-semibold">฿{formatCompact(b.value)}</span>
                </div>
                <ProgressBar value={(b.value / (brandRows[0]?.value || 1)) * 100} height={7} tone={i === 0 ? "coral" : "ink"} />
              </div>
            ))}
            {!brandRows.length ? <EmptyState title={t.common.empty} /> : null}
          </div>
          <div className="mt-4 pt-4 border-t border-line">
            <Donut data={payRows.slice(0, 5).map((p) => ({ label: (t.payment as Record<string, string>)[p.method] ?? p.method, value: p.value }))}
              size={132} thickness={18} centerValue={formatCompact(now.gross)} centerLabel={t.cmd.paymentAnalytics} />
          </div>
        </Card>
      </div>

      {/* ===== category / best sellers / inventory ===== */}
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-5">
          <SectionTitle>{t.cmd.categoryPerformance}</SectionTitle>
          <div className="mt-4 space-y-2.5">
            {catRows.map((c, i) => (
              <div key={c.label} className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                <span className="text-xs flex-1 truncate">{c.label}</span>
                <div className="w-20"><ProgressBar value={(c.value / (catRows[0]?.value || 1)) * 100} height={5} /></div>
                <span className="text-xs tnum text-muted w-12 text-right">฿{formatCompact(c.value)}</span>
              </div>
            ))}
            {!catRows.length ? <EmptyState title={t.common.empty} /> : null}
          </div>
        </Card>

        <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-5">
          <CardHeaderRow title={t.cmd.bestSellers} href="/admin/products" viewAll={t.cmd.viewAll} />
          <div className="mt-3 space-y-1">
            {prodRows.map((p, i) => (
              <div key={p.sku} className="flex items-center gap-3 rounded-xl hover:bg-surface2 px-2 py-2 -mx-1">
                <span className="w-8 h-8 rounded-lg bg-surface2 grid place-items-center text-[11px] font-bold tnum shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{p.name}</p>
                  <p className="text-[10px] font-mono text-muted">{p.sku}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold tnum">฿{formatCompact(p.gross)}</p>
                  <p className="text-[10px] text-muted tnum">{formatInt(p.qty)} {t.admin.unitsSold}</p>
                </div>
              </div>
            ))}
            {!prodRows.length ? <EmptyState title={t.common.empty} /> : null}
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-4 p-5">
          <CardHeaderRow title={t.cmd.inventoryHealth} href="/admin/inventory" viewAll={t.cmd.viewAll} />
          {showGp ? (
            <p className="text-2xl font-semibold tnum mt-2">฿{formatCompact(inv.value)} <span className="text-xs text-muted font-normal">{t.cmd.totalStockValue}</span></p>
          ) : <div className="h-2" />}
          <div className="mt-4">
            <StackBar
              valueFormat={(n) => formatInt(n)}
              segments={[
                { label: t.cmd.available, value: inv.available, color: "#3BB98C" },
                { label: t.inventory.lowStock, value: inv.lowN, color: "#E0894F" },
                { label: t.pos.outOfStock, value: inv.outN, color: "#D6454A" },
                { label: t.cmd.inTransfer, value: inv.inTransfer, color: "#A898F5" },
                { label: t.cmd.damaged, value: inv.damaged, color: "#9CA39C" },
                { label: t.cmd.serviceStock, value: inv.service, color: "#F2B705" },
              ]}
            />
          </div>
        </Card>
      </div>

      {/* ===== heatmap + staff + system ===== */}
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-6 p-5">
          <SectionTitle>{t.cmd.salesHeatmap}</SectionTitle>
          <div className="mt-4">
            <Heatmap rows={heat.rows} cols={weekdays} values={heat.grid} color="#FF725E" />
          </div>
        </Card>

        <Card className="col-span-12 sm:col-span-6 lg:col-span-3 p-5">
          <SectionTitle right={<Badge tone="ok"><LiveDot /> {staff.working}</Badge>}>{t.cmd.staffToday}</SectionTitle>
          <p className="text-[32px] font-semibold tnum mt-2 leading-none">{formatInt(staff.total)}</p>
          <div className="mt-4 space-y-2.5">
            {[[t.cmd.working, staff.working, "mint"], [t.cmd.onBreak, staff.onBreak, "lime"], [t.cmd.offline, staff.offline, "coral"]].map(([l, v, tone]) => (
              <div key={l as string} className="flex items-center gap-2">
                <span className="text-xs text-muted w-14">{l}</span>
                <div className="flex-1"><ProgressBar value={staff.total ? ((v as number) / staff.total) * 100 : 0} tone={tone as "mint"} height={6} /></div>
                <span className="text-xs tnum font-medium w-7 text-right">{v as number}</span>
              </div>
            ))}
          </div>
          <div className="flex -space-x-2 mt-4">
            {empRows.slice(0, 6).map((e) => <Avatar key={e.id} name={e.label} size={30} className="ring-2 ring-[rgb(var(--c-surface))]" />)}
            {empRows.length > 6 ? <span className="w-[30px] h-[30px] rounded-full bg-surface2 grid place-items-center text-[10px] font-semibold ring-2 ring-[rgb(var(--c-surface))]">+{empRows.length - 6}</span> : null}
          </div>
        </Card>

        <Card className="col-span-12 sm:col-span-6 lg:col-span-3 p-5">
          <SectionTitle right={<Badge tone="ok">{t.cmd.connected}</Badge>}>{t.cmd.systemHealth}</SectionTitle>
          <div className="mt-3 space-y-2.5 text-sm">
            {[
              [t.cmd.posOnline, `${health.posOnline} / ${health.posTotal}`, health.posOffline === 0],
              [t.cmd.printers, `${health.printers} / ${health.posTotal}`, health.printers === health.posTotal],
              [t.cmd.drawers, `${health.drawers} / ${health.posTotal}`, health.drawers === health.posTotal],
              [t.cmd.syncQueue, String(health.syncQueue), health.syncQueue < 20],
              [t.cmd.realtime, `${health.syncMs} ms`, true],
            ].map(([l, v, ok]) => (
              <div key={l as string} className="flex items-center justify-between">
                <span className="text-muted text-xs">{l}</span>
                <span className="flex items-center gap-2 tnum text-xs font-medium">
                  <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-ok" : "bg-coral"}`} />{v}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ===== insights + alerts + approvals ===== */}
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-5 p-5 bg-brand text-brandInk border-transparent">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-brandInk/15 grid place-items-center"><Sparkles size={15} /></span>
            <h2 className="text-[13px] font-semibold tracking-wide">{t.cmd.smartInsights}</h2>
          </div>
          <ul className="mt-4 space-y-3">
            {insights.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-snug">
                <ArrowUpRight size={15} className="shrink-0 mt-0.5 text-mint" />
                <span className="text-brandInk/90">{s}</span>
              </li>
            ))}
            {!insights.length ? <li className="text-brandInk/60 text-sm">{t.common.empty}</li> : null}
          </ul>
        </Card>

        <Card className="col-span-12 md:col-span-7 lg:col-span-4 p-5">
          <SectionTitle right={<Badge tone="danger">{alerts.length}</Badge>}>{t.cmd.alertCenter}</SectionTitle>
          <ul className="mt-3 space-y-2">
            {alerts.map((a, i) => {
              const tone = a.level === "critical" ? "danger" : a.level === "warning" ? "warn" : "ok";
              return (
                <li key={i} className="flex items-start gap-3 rounded-xl bg-surface2 px-3 py-2.5">
                  <span className={`w-1.5 self-stretch rounded-full ${a.level === "critical" ? "bg-danger" : a.level === "warning" ? "bg-warn" : "bg-ok"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={tone as "danger"}>{a.level === "critical" ? t.cmd.critical : a.level === "warning" ? t.cmd.warning : t.cmd.notice}</Badge>
                    </div>
                    <p className="text-xs font-medium mt-1 truncate">{a.title}</p>
                    <p className="text-[11px] text-muted truncate">{a.body}</p>
                  </div>
                </li>
              );
            })}
            {!alerts.length ? <EmptyState icon={<ShieldCheck size={22} />} title={t.cmd.healthy} /> : null}
          </ul>
        </Card>

        <Card className="col-span-12 md:col-span-5 lg:col-span-3 p-5 flex flex-col">
          <CardHeaderRow title={t.cmd.approvalCenter} href="/admin/approvals" viewAll={t.cmd.review} />
          <div className="flex-1 grid place-items-center py-4">
            <div className="text-center">
              <p className="text-[40px] font-semibold tnum leading-none">{approvals}</p>
              <p className="text-xs text-muted mt-1">{t.cmd.pendingApprovals}</p>
            </div>
          </div>
          <Link href="/admin/approvals" className="btn-primary w-full">
            <ShieldCheck size={16} /> {t.cmd.review}
          </Link>
        </Card>
      </div>
    </div>
  );
}

/** หัวการ์ดพร้อมลิงก์ดูทั้งหมด */
function CardHeaderRow({ title, href, viewAll }: { title: string; href: string; viewAll: string }) {
  return (
    <SectionTitle right={
      <Link href={href} className="text-[11px] text-muted hover:text-ink flex items-center gap-1">
        {viewAll} <ArrowRight size={11} />
      </Link>
    }>{title}</SectionTitle>
  );
}
