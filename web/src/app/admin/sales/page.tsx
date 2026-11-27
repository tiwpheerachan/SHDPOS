"use client";
import { OrderTraceButton } from "@/components/order-trace";

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { OwSaleBadge, useOwSaleStatus } from "@/components/pos/ow-sale-badge";
import { Download, Search, LayoutDashboard, Store, Tag, Users, ReceiptText, Loader2, AlertTriangle, Cloud, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSalesData } from "@/lib/hooks/use-sales-data";
import { useCatalogProducts } from "@/lib/hooks/use-catalog-products";
import { StaffPerformance } from "@/components/admin/staff-performance";
import { BrandView } from "@/components/admin/brand-view";
import { OverviewView, buildOverview } from "@/components/admin/sales-dashboard";
import { SalesSheet, SourceTag } from "@/components/admin/sales-sheet";
import { ViewsMenu, ShareMenu, DownloadMenu, type ReportState } from "@/components/admin/report-actions";
import { rangeToDates, type AdminFilter } from "@/components/admin/filters";
import { listCategories } from "@/lib/data/repo";
import { useRef } from "react";
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
  const tab = (sp.get("tab") as Tab) || "bills";
  const setTab = (v: Tab) => { const u = new URLSearchParams(sp.toString()); u.set("tab", v); u.delete("person"); u.delete("sv"); router.replace(`/admin/sales?${u}`, { scroll: false }); };
  const drill = (patch: Partial<typeof filter>, to: Tab = "overview") => { setFilter({ ...filter, ...patch }); setTab(to); };

  // แหล่งข้อมูล: POS (ระบบนี้) / Lark (ระบบเดิม ดึงจาก Dataverse)
  const [src, setSrc] = useState<"all" | "pos" | "lark">("all");
  // คำนวณตามค่าที่ "หน่วงไว้" — กดตัวกรอง/พิมพ์ค้นหาแล้วหน้าตอบสนองทันที ไม่ค้างระหว่างคำนวณบิลจำนวนมาก
  const dFilter = useDeferredValue(filter), dq = useDeferredValue(q), dSrc = useDeferredValue(src);
  const computing = dFilter !== filter || dq !== q || dSrc !== src;
  const visible = useMemo(() => {
    if (data.live) return orders; // เซิร์ฟเวอร์ตัดตามสิทธิ์สาขาแล้ว
    const ids = new Set(visibleBranchIds(employee, branches.map((b) => b.id)));
    return orders.filter((o) => ids.has(o.branch_id));
  }, [orders, employee, branches, data.live]);
  const bySrc = (list: typeof orders) => (dSrc === "all" ? list : list.filter((o) => (dSrc === "lark" ? o.source === "lark" : o.source !== "lark")));
  const scoped = useMemo(() => bySrc(visible), [visible, dSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ตัวกรองครบทุกมิติ (แบรนด์/สาขา/จังหวัด/ประเภทร้าน/พนักงานขาย/แคชเชียร์/หมวด/SKU/ชำระ/ช่องทาง/สถานะ/ลูกค้า/เครื่อง/ธง)
  // กรองครั้งเดียวทุกแหล่ง → นับป้าย POS/Lark ตามตัวกรองปัจจุบัน แล้วค่อยแยกแหล่ง (ไม่กรองซ้ำ)
  const filteredAll = useMemo(() => applyOrderFilters(visible, dFilter, { branches, products }), [visible, dFilter, branches, products]);
  const srcCount = useMemo(() => { let lark = 0; for (const o of filteredAll) if (o.source === "lark") lark++; return { pos: filteredAll.length - lark, lark }; }, [filteredAll]);
  const hasLark = useMemo(() => orders.some((o) => o.source === "lark"), [orders]);
  const filtered = useMemo(() => bySrc(filteredAll), [filteredAll, dSrc]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const list = filtered;
    const term = dq.trim().toLowerCase();
    return term
      ? list.filter((o) => o.order_no.toLowerCase().includes(term) || (o.customer_name ?? "").toLowerCase().includes(term) || (o.customer_phone ?? "").includes(term) || o.items.some((i) => i.sku.toLowerCase().includes(term)))
      : list;
  }, [filtered, dq]);

  const totals = summarize(rows);
  const showCost = can(employee, "report.cost");
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  // สถานะคลังกลาง/JST ของบิลที่แสดง (สูงสุด 300 แถว)
  const owStatus = useOwSaleStatus(rows.slice(0, 300).map((o) => o.client_uuid));

  // ยอดหักออก/ช่วงก่อนหน้า ให้ผ่านตัวกรองสาขา/แบรนด์/ช่องทางเดียวกับบิล
  const scopeBranch = useMemo(() => {
    const ids = new Set<string>(dFilter.branchIds);
    if (dFilter.brandIds.length) for (const b of branches) if (b.brand_id && dFilter.brandIds.includes(b.brand_id) && (!dFilter.branchIds.length || dFilter.branchIds.includes(b.id))) ids.add(b.id);
    if (dFilter.brandIds.length && dFilter.branchIds.length) for (const id of [...ids]) { const b = branches.find((x) => x.id === id); if (b && !(b.brand_id && dFilter.brandIds.includes(b.brand_id))) ids.delete(id); }
    // สาขาที่ไม่ผูกแบรนด์แต่ขายสินค้าแบรนด์นั้น (คลัง/ร้านรวมแบรนด์) — นับจากบิลที่ผ่านตัวกรองแล้ว
    if (dFilter.brandIds.length) for (const o of filtered) if (!dFilter.branchIds.length || dFilter.branchIds.includes(o.branch_id)) ids.add(o.branch_id);
    return ids.size || dFilter.brandIds.length ? ids : null;
  }, [dFilter.branchIds, dFilter.brandIds, branches, filtered]);
  const adjustments = useMemo(() => data.adjustments.filter((a) => !scopeBranch || scopeBranch.has(a.branch_id)), [data.adjustments, scopeBranch]);
  const prevRows = useMemo(() => data.prev.filter((o) => (!scopeBranch || scopeBranch.has(o.branch_id)) && (!dFilter.channels.length || dFilter.channels.includes(o.channel))), [data.prev, scopeBranch, dFilter.channels]);

  // ── มุมมอง/แชร์: สถานะรายงาน = ตัวกรอง + แท็บ (ช่วงสัมพัทธ์ เช่น 7 วัน คำนวณใหม่ทุกครั้งที่เปิด) ──
  const reportRef = useRef<HTMLDivElement>(null);
  const currentState = (): ReportState => ({ tab, filter: { ...filter, from: filter.from.toISOString(), to: filter.to.toISOString() } });
  const applyState = (st: ReportState) => {
    const f = st.filter as AdminFilter & { from: string; to: string };
    if (f) { const dates = f.range && f.range !== "custom" ? rangeToDates(f.range) : { from: new Date(f.from), to: new Date(f.to) }; setFilter({ ...f, ...dates } as AdminFilter); }
    if (st.tab) setTab(st.tab as Tab);
  };
  const teamUrl = () => { const u = new URL(window.location.href); u.searchParams.set("tab", tab); u.searchParams.set("s", btoa(unescape(encodeURIComponent(JSON.stringify(currentState()))))); u.searchParams.delete("person"); return u.href; };
  useEffect(() => { const raw = new URLSearchParams(window.location.search).get("s"); if (raw) { try { applyState(JSON.parse(decodeURIComponent(escape(atob(raw))))); } catch { /* ลิงก์เสีย */ } } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rangeLabel = `${filter.from.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })} – ${filter.to.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}`;
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filter.brandIds.length) parts.push(`${L("แบรนด์", "Brand", "品牌")}: ${filter.brandIds.map((id) => brands.find((b) => b.id === id)?.name ?? "?").join(", ")}`);
    if (filter.branchIds.length) parts.push(`${L("สาขา", "Branch", "门店")}: ${filter.branchIds.length <= 2 ? filter.branchIds.map((id) => { const b = branches.find((x) => x.id === id); return b ? b.name_th ?? b.name : "?"; }).join(", ") : `${filter.branchIds.length} ${L("สาขา", "branches", "家门店")}`}`);
    const others = (["salespersonIds", "cashierIds", "categoryIds", "skus", "paymentMethods", "channels", "orderStatuses", "customerTypes", "posIds", "flags", "provinces", "storeTypes"] as const).filter((k) => filter[k].length).length;
    if (others) parts.push(`+ ${L("ตัวกรองอื่น", "other filters", "其他筛选")} ${others}`);
    return parts.join(" · ");
  }, [filter, brands, branches, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cats, setCats] = useState<Map<string, string>>(new Map());
  useEffect(() => { void listCategories().then((c) => setCats(new Map(c.map((x) => [x.id, x.name_th])))); }, []);
  const brandName = useMemo(() => new Map(brands.map((b) => [b.id, b.name])), [brands]);
  const productCat = useMemo(() => new Map(products.map((p) => [p.id, p.category_id])), [products]);
  // ภาพรวมคำนวณเฉพาะตอนเปิดแท็บภาพรวม (หรือตอนส่งออก/แชร์) — แท็บอื่นไม่เสียเวลา
  const buildOv = () => buildOverview({ orders: rows, adjustments, prev: prevRows, branches, employees, showCost, range: { from: dFilter.from, to: dFilter.to }, productCat, catName: cats, brandName });
  const overview = useMemo(() => tab !== "overview" ? null : buildOverview({ orders: rows, adjustments, prev: prevRows, branches, employees, showCost, range: { from: dFilter.from, to: dFilter.to }, productCat, catName: cats, brandName }),
    [tab, rows, adjustments, prevRows, branches, employees, showCost, dFilter.from, dFilter.to, productCat, cats, brandName]); // eslint-disable-line react-hooks/exhaustive-deps
  const excelRows = () => {
    const m = overview ?? buildOv(), k = m.kpi, R: { section: string; label: string; value: string | number }[] = [];
    const add = (section: string, label: string, value: string | number) => R.push({ section, label, value });
    add(L("ตัวกรอง", "Filters", "筛选"), L("ช่วงวันที่", "Date range", "日期范围"), rangeLabel); if (filterSummary) add(L("ตัวกรอง", "Filters", "筛选"), L("เงื่อนไข", "Conditions", "条件"), filterSummary);
    add(L("สรุป", "Summary", "汇总"), L("ยอดขาย", "Sales", "销售额"), k.gross); add(L("สรุป", "Summary", "汇总"), L("คืนเงิน", "Refunds", "退款"), k.refunds); add(L("สรุป", "Summary", "汇总"), L("ใบลดหนี้ส่วนลด", "Discount credit notes", "折扣红字发票"), k.cn); add(L("สรุป", "Summary", "汇总"), L("ยอดสุทธิ", "Net sales", "净销售额"), k.net);
    add(L("สรุป", "Summary", "汇总"), L("จำนวนบิล", "Bills", "单据数"), k.bills); add(L("สรุป", "Summary", "汇总"), L("บิลยกเลิก", "Voided bills", "作废单据"), k.voids); add(L("สรุป", "Summary", "汇总"), L("เฉลี่ยต่อบิล", "Avg per bill", "客单价"), Math.round(k.avg * 100) / 100); add(L("สรุป", "Summary", "汇总"), L("ชิ้นที่ขาย", "Units sold", "销售件数"), k.units); add(L("สรุป", "Summary", "汇总"), L("ส่วนลด", "Discounts", "折扣"), k.disc);
    if (k.showCost) add(L("สรุป", "Summary", "汇总"), L("กำไรขั้นต้น", "Gross profit", "毛利"), k.gp);
    if (k.hasPrev) add(L("สรุป", "Summary", "汇总"), L("ยอดขายช่วงก่อนหน้า", "Previous period sales", "上期销售额"), k.pGross);
    m.trend.labels.forEach((l, i) => m.trend.cur[i] && add(m.trend.hourly ? L("รายชั่วโมง", "Hourly", "每小时") : L("รายวัน", "Daily", "每日"), l, m.trend.cur[i]));
    m.pay.forEach((r) => add(L("วิธีรับชำระ", "Payment methods", "付款方式"), r.label, r.value)); m.ch.forEach((r) => add(L("ช่องทางขาย", "Sales channels", "销售渠道"), r.label, r.value));
    m.categories.forEach((r) => add(m.catKind === "brand" ? L("แบรนด์", "Brands", "品牌") : L("หมวดสินค้า", "Categories", "商品类别"), r.label, r.value)); m.basket.forEach((r) => add(L("ขนาดบิล (จำนวนบิล)", "Bill size (bill count)", "单据金额分布（单数）"), r.label, r.value));
    m.topProducts.forEach((p) => add(L("สินค้าขายดี", "Top products", "畅销商品"), `${p.sku} ${p.name} (${p.qty} ${L("ชิ้น", "pcs", "件")})`, p.sales));
    m.topBranches.forEach((b) => add(L("สาขาท็อป", "Top branches", "门店排行"), b.name, b.value)); m.topStaff.forEach((p) => add(L("พนักงานท็อป", "Top staff", "员工排行"), `${p.name} (${p.bills} ${L("บิล", "bills", "单")})`, p.value));
    return { title: `${L("รายงานยอดขาย", "Sales report", "销售报表")} ${rangeLabel}`, rows: R };
  };

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
        <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} hideViews />
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
        </div>
        <ViewsMenu report="sales" current={currentState} onApply={applyState} />
        <ShareMenu canPublic={can(employee, "report.share")} teamUrl={teamUrl} snapshot={() => ({ model: overview ?? buildOv(), meta: { range: rangeLabel, filters: filterSummary, generated_at: new Date().toISOString() } })} title={() => `${L("รายงานยอดขาย", "Sales report", "销售报表")} · ${rangeLabel}${filterSummary ? ` · ${filterSummary}` : ""}`} />
        <DownloadMenu target={() => reportRef.current} filename={() => `sales-${tab}-${filter.from.toISOString().slice(0, 10)}_${filter.to.toISOString().slice(0, 10)}`}
          excel={excelRows} extra={[{ title: L("CSV รายการบิล", "Bills CSV", "单据列表 CSV"), sub: L(`${rows.length} บิลตามตัวกรอง`, `${rows.length} filtered bills`, `筛选后 ${rows.length} 张单据`), onClick: exportCsv }]} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "bills", label: <span className="inline-flex items-center gap-1.5"><ReceiptText size={14} />{L("รายการบิล", "Bills", "账单")}</span> },
          { value: "overview", label: <span className="inline-flex items-center gap-1.5"><LayoutDashboard size={14} />{L("ภาพรวม", "Overview", "总览")}</span> },
          { value: "branch", label: <span className="inline-flex items-center gap-1.5"><Store size={14} />{L("รายสาขา", "Branches", "门店")}</span> },
          { value: "brand", label: <span className="inline-flex items-center gap-1.5"><Tag size={14} />{L("แบรนด์", "Brands", "品牌")}</span> },
          ...(can(employee, "report.employee_perf") ? [{ value: "staff" as Tab, label: <span className="inline-flex items-center gap-1.5"><Users size={14} />{L("ผลงานพนักงาน", "Staff performance", "员工业绩")}</span> }] : []),
        ]} />
        <div className="flex flex-wrap items-center gap-2">
        {hasLark ? (
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs" role="group" aria-label={L("แหล่งข้อมูล", "Source", "数据来源")}>
            {([["all", L("ทุกแหล่ง", "All sources", "全部来源"), srcCount.pos + srcCount.lark], ["pos", "POS", srcCount.pos], ["lark", "Lark", srcCount.lark]] as const).map(([v, label, n]) => (
              <button key={v} type="button" onClick={() => setSrc(v)} aria-pressed={src === v}
                className={`h-7 px-2.5 rounded-md inline-flex items-center gap-1.5 ${src === v ? "bg-ink text-surface" : "text-muted hover:text-ink"}`}>
                {v !== "all" ? <SourceTag source={v} /> : null}{v === "all" ? label : null}<span className="tnum opacity-70">{formatInt(n)}</span>
              </button>
            ))}
          </div>
        ) : null}
        <span className="text-[11px] text-muted inline-flex items-center gap-1.5">
          {data.loading ? <><Loader2 size={12} className="animate-spin" />{L("กำลังโหลดข้อมูล…", "Loading…", "加载中…")}</> : computing ? <><Loader2 size={12} className="animate-spin" />{L("กำลังคำนวณ…", "Updating…", "计算中…")}</> : data.live
            ? <><Cloud size={12} />{L(`ข้อมูลจริงจากระบบกลาง · ${formatInt(filtered.length)} จาก ${formatInt(scoped.length)} บิลในช่วงวันที่`, `Central data · ${filtered.length}/${scoped.length} bills`, "中央数据")}</>
            : L("โหมดสาธิต · ข้อมูลในเครื่อง", "Demo · local data", "演示数据")}
        </span>
        </div>
      </div>
      {data.error ? <p className="rounded-xl bg-danger/8 text-danger text-sm px-4 py-2.5 flex items-center gap-2"><AlertTriangle size={15} />{data.error}</p> : null}
      {data.truncated ? <p className="rounded-xl bg-warn/10 text-[12.5px] px-4 py-2.5">{L("ช่วงวันที่นี้มีบิลมากกว่า 20,000 ใบ — แสดงเฉพาะล่าสุด ให้แคบช่วงวันที่ลงเพื่อดูครบ", "More than 20,000 bills — showing latest only; narrow the date range", "数据过多")}</p> : null}

      <div ref={reportRef} className="space-y-4">
      {tab === "bills" ? <SalesSheet orders={rows} branches={branches} brands={brands} employees={employees} products={products} catName={cats} showCost={showCost} owStatus={owStatus as never} onExportCsv={exportCsv} /> : null}
      {tab === "overview" && overview ? <OverviewView m={overview}
        onDrill={(to, patch) => { if (to === "staff" && patch?.person) { const u = new URLSearchParams(sp.toString()); u.set("tab", "staff"); u.set("person", String(patch.person)); router.push(`/admin/sales?${u}`, { scroll: false }); } else setTab(to); }} /> : null}

      {tab === "branch" ? <BranchView orders={rows} branches={branches} brands={brands} showCost={showCost} L={L} locale={locale} onDrill={(id) => drill({ branchIds: [id] })} /> : null}
      {tab === "brand" ? <BrandView orders={rows} branches={branches} brands={brands} products={products} showCost={showCost} range={{ from: filter.from, to: filter.to }} L={L} locale={locale} onDrill={(id) => drill({ brandIds: [id], branchIds: [] }, "branch")} /> : null}
      {tab === "staff" && can(employee, "report.employee_perf") ? <StaffPerformance filtered={rows} employees={employees} branches={branches} brands={brands} initialPerson={sp.get("person")} positions={data.positions} /> : null}
      </div>

    </div>
  );
}

// ── รายสาขา: ยอด / บิล / เฉลี่ย / ส่วนลด / ยกเลิก / สัดส่วน · กดเพื่อเจาะดูสาขานั้น ──
function BranchView({ orders, branches, brands, showCost, L, locale, onDrill }: { orders: Order[]; branches: Branch[]; brands: Brand[]; showCost: boolean; L: (a: string, b: string, c: string) => string; locale: string; onDrill: (id: string) => void }) {
  const rows = useMemo(() => {
    const m = new Map<string, { sales: number; bills: number; discount: number; voids: number; units: number; gp: number; members: number; soldBrands: Set<string> }>();
    for (const o of orders) {
      const cur = m.get(o.branch_id) ?? { sales: 0, bills: 0, discount: 0, voids: 0, units: 0, gp: 0, members: 0, soldBrands: new Set<string>() };
      for (const it of o.items) if (it.brand_id) cur.soldBrands.add(it.brand_id);
      if (o.status === "voided") cur.voids++;
      else if (isCountedSale(o)) { cur.sales += o.grand_total; cur.bills++; cur.discount += o.discount_total; cur.gp += o.gross_profit; cur.units += o.items.reduce((s, i) => s + i.qty, 0); if (o.customer_id) cur.members++; }
      m.set(o.branch_id, cur);
    }
    const total = [...m.values()].reduce((s, v) => s + v.sales, 0) || 1;
    return [...m.entries()].map(([id, v]) => {
      const b = branches.find((x) => x.id === id);
      return { id, name: b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id, code: (b as Branch & { code?: string })?.code ?? "", brand: brands.find((x) => x.id === b?.brand_id)?.name ?? ([...v.soldBrands].map((id) => brands.find((x) => x.id === id)?.name).filter(Boolean).join(", ") || "—"), ...v, share: (v.sales / total) * 100 };
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

