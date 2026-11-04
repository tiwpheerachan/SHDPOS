"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TrendingUp, ShoppingBag, Wallet, Coins, RefreshCw, Package, AlertTriangle,
  Clock, ArrowRight, PlayCircle, Radio, ShoppingCart, RotateCcw, Layers, Percent,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import {
  listOrders, listProducts, stockForBranch, getBranch, listEmployees, listReturns,
} from "@/lib/data/repo";
import type { Branch, Order, Product, StockLevel, Employee, ReturnDoc } from "@/lib/types";
import { Card, KpiTile, Badge, EmptyState, Avatar, SectionTitle, LiveDot, Button, Skeleton, Segmented } from "@/components/ui";
import { PosPage, StatChip } from "@/components/pos/page-shell";
import { Columns, Donut, RadialGauge, Sparkline } from "@/components/charts";
import { summarize, hourlySeries, topProducts, paymentMix, byEmployee } from "@/lib/analytics";
import { formatTHB, formatCompact, formatInt } from "@/lib/money";
import { can } from "@/lib/permissions";

type Range = "today" | "yesterday" | "7d" | "mtd";
const REFRESH_MS = 45000;

function rangeDates(r: Range): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  if (r === "today") from.setHours(0, 0, 0, 0);
  else if (r === "yesterday") {
    from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
    const t = new Date(from); t.setHours(23, 59, 59, 999); return { from, to: t };
  } else if (r === "7d") from.setDate(to.getDate() - 7);
  else if (r === "mtd") { from.setDate(1); from.setHours(0, 0, 0, 0); }
  return { from, to };
}

export default function PosDashboard() {
  const { t, locale, pick } = useI18n();
  const router = useRouter();
  const { employee, branchId, shift } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, StockLevel>>(new Map());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [returns, setReturns] = useState<ReturnDoc[]>([]);
  const [branch, setBranch] = useState<Branch>();
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("today");
  const [updated, setUpdated] = useState<Date | null>(null);
  const firstLoad = useRef(true);

  async function reload() {
    if (!branchId) return;
    if (firstLoad.current) setLoading(true);
    const from = new Date(); from.setDate(from.getDate() - 35);
    const [o, p, s, e, r, b] = await Promise.all([
      listOrders({ branchIds: [branchId], from }),
      listProducts(),
      stockForBranch(branchId),
      listEmployees(),
      listReturns([branchId]).catch(() => []),
      getBranch(branchId),
    ]);
    setAllOrders(o); setProducts(p); setStock(s); setEmployees(e); setReturns(r); setBranch(b);
    setUpdated(new Date());
    setLoading(false);
    firstLoad.current = false;
  }

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // ---- range windows ----
  const { rangeOrders, prevOrders, rangeReturns } = useMemo(() => {
    const { from, to } = rangeDates(range);
    const span = to.getTime() - from.getTime();
    const pFrom = new Date(from.getTime() - span).toISOString();
    const f = from.toISOString(), tt = to.toISOString();
    const inR = (d: string) => d >= f && d <= tt;
    const inP = (d: string) => d >= pFrom && d < f;
    return {
      rangeOrders: allOrders.filter((o) => inR(o.created_at)),
      prevOrders: allOrders.filter((o) => inP(o.created_at)),
      rangeReturns: returns.filter((r) => inR(r.created_at)),
    };
  }, [allOrders, returns, range]);

  const cur = useMemo(() => summarize(rangeOrders), [rangeOrders]);
  const prev = useMemo(() => summarize(prevOrders), [prevOrders]);
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

  const hourly = useMemo(() => hourlySeries(rangeOrders), [rangeOrders]);
  const prods = useMemo(() => topProducts(rangeOrders, 5), [rangeOrders]);
  const pay = useMemo(() => paymentMix(rangeOrders), [rangeOrders]);
  const staff = useMemo(() => byEmployee(rangeOrders, employees).slice(0, 5), [rangeOrders, employees]);
  const cashToday = useMemo(() => pay.find((p) => p.method === "cash")?.value ?? 0, [pay]);
  const sparkVals = useMemo(() => hourly.map((h) => h.value), [hourly]);
  const recent = useMemo(() => rangeOrders.slice(0, 6), [rangeOrders]);
  const upt = cur.orders ? cur.units / cur.orders : 0;
  const returnAmt = useMemo(() => rangeReturns.reduce((s, r) => s + r.refund_amount, 0), [rangeReturns]);
  const achievement = prev.gross ? Math.min(150, (cur.gross / prev.gross) * 100) : 100;

  const low = useMemo(() => {
    const out: { p: Product; s: StockLevel }[] = [];
    for (const p of products) {
      const s = stock.get(p.id);
      if (!p.is_stocked || !s) continue;
      const rp = Math.max(s.reorder_point, p.reorder_point);
      if (rp > 0 && s.qty_on_hand <= rp) out.push({ p, s });
    }
    return out.sort((a, b) => a.s.qty_on_hand - b.s.qty_on_hand);
  }, [products, stock]);

  const showGp = employee ? can(employee, "report.gross_profit") : false;
  const drawer = (shift?.opening_cash ?? 0) + cashToday;

  if (!employee) return null;

  const quickActions = [
    { href: "/pos/sell", icon: ShoppingCart, label: t.pos.sell, primary: true },
    { href: "/pos/shift", icon: Clock, label: t.shift.title },
    { href: "/pos/returns", icon: RotateCcw, label: t.returns.title },
  ];

  return (
    <PosPage
      title={t.admin.dashboard}
      icon={<TrendingUp size={18} />}
      actions={
        <>
          <Segmented size="sm" value={range} onChange={setRange} options={[
            { value: "today" as Range, label: t.common.today },
            { value: "yesterday" as Range, label: t.common.yesterday },
            { value: "7d" as Range, label: "7D" },
            { value: "mtd" as Range, label: "MTD" },
          ]} />
          {shift ? <Badge tone="ok"><LiveDot /> {t.shift.title}</Badge> : <Link href="/pos/shift"><Badge tone="warn">{t.shift.noShift}</Badge></Link>}
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => void reload()}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {t.common.refresh}
          </Button>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
        {/* subtitle + quick actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 -mt-1">
          <p className="text-sm text-muted">
            {branch ? pick({ th: branch.name_th, en: branch.name, zh: branch.name }) : "—"} ·{" "}
            {new Date().toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US", { weekday: "long", day: "numeric", month: "long" })}
            {updated ? <span className="ml-2 text-[11px]"><LiveDot /> {L("อัปเดต", "Updated", "更新")} {updated.toLocaleTimeString(locale === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> : null}
          </p>
          <div className="flex items-center gap-2">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <Link key={a.href} href={a.href}
                  className={a.primary ? "btn-primary h-9 px-3 text-xs" : "btn-ghost h-9 px-3 text-xs"}>
                  <Icon size={14} /> {a.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* KPI */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-[22px]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
            <KpiTile label={t.pos.sell} value={`฿${formatCompact(cur.gross)}`} variant="ink" icon={<TrendingUp size={15} />}
              delta={delta(cur.gross, prev.gross)} spark={<Sparkline values={sparkVals} color="#FF725E" fill />} />
            <KpiTile label={t.admin.orderCount} value={formatInt(cur.orders)} accent="lavender" icon={<ShoppingBag size={15} />}
              delta={delta(cur.orders, prev.orders)} />
            <KpiTile label={t.admin.avgBasket} value={formatTHB(cur.avgBasket)} accent="peach" icon={<Wallet size={15} />}
              delta={delta(cur.avgBasket, prev.avgBasket)} />
            <KpiTile label={L("เงินสดรับ", "Cash received", "现金收入")} value={`฿${formatCompact(cashToday)}`} accent="mint" icon={<Coins size={15} />}
              sub={shift ? `${t.shift.expectedCash} ฿${formatCompact(drawer)}` : undefined} />
          </div>
        )}

        {/* secondary stats */}
        {!loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatChip label={t.admin.unitsSold} value={formatInt(cur.units)} accent="lavender" icon={<Layers size={16} />} />
            <StatChip label="UPT" value={upt.toFixed(2)} accent="peach" icon={<ShoppingBag size={16} />} />
            <StatChip label={t.returns.title} value={`${formatInt(rangeReturns.length)} · ฿${formatCompact(returnAmt)}`} accent={rangeReturns.length ? "coral" : "mint"} icon={<RotateCcw size={16} />} />
            <StatChip label={t.pos.discount} value={`฿${formatCompact(cur.discount)}`} accent="lime" icon={<Percent size={16} />} />
          </div>
        ) : null}

        <div className="grid grid-cols-12 gap-3">
          {/* hourly */}
          <Card className="col-span-12 lg:col-span-8 p-5">
            <SectionTitle right={<Link href="/pos/orders" className="text-[11px] text-muted hover:text-ink flex items-center gap-1">{t.orders.title} <ArrowRight size={11} /></Link>}>
              {t.admin.hourly}
            </SectionTitle>
            <div className="mt-4">
              {loading ? <Skeleton className="h-[140px]" /> : hourly.some((h) => h.value) ? (
                <Columns data={hourly} valueFormat={(n) => `฿${formatCompact(n)}`} />
              ) : <EmptyState title={t.common.empty} />}
            </div>
          </Card>

          {/* comparison gauge */}
          <Card className="col-span-12 lg:col-span-4 p-5 flex flex-col">
            <SectionTitle>{t.admin.compareLast}</SectionTitle>
            <div className="flex-1 grid place-items-center py-2">
              {loading ? <Skeleton className="w-[150px] h-[150px] rounded-full" /> : (
                <RadialGauge value={achievement} color={achievement >= 100 ? "#3BB98C" : "#FF725E"}
                  label={`${L("ช่วงนี้", "This", "本期")} ฿${formatCompact(cur.gross)}`} sub={`${L("ก่อนหน้า", "Prev", "上期")} ฿${formatCompact(prev.gross)}`} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-surface2 py-2">
                <p className="text-sm font-semibold tnum">{prev.gross ? `${delta(cur.gross, prev.gross)! >= 0 ? "+" : ""}${delta(cur.gross, prev.gross)!.toFixed(1)}%` : "—"}</p>
                <p className="text-[10px] text-muted">{t.admin.compareLast}</p>
              </div>
              <div className="rounded-xl bg-surface2 py-2">
                <p className="text-sm font-semibold tnum">{showGp ? `฿${formatCompact(cur.grossProfit)}` : `${cur.gpPercent.toFixed(0)}%`}</p>
                <p className="text-[10px] text-muted">{showGp ? t.admin.grossProfit : t.admin.gpPercent}</p>
              </div>
            </div>
          </Card>

          {/* payment breakdown */}
          <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-5">
            <SectionTitle>{t.admin.paymentMix}</SectionTitle>
            <div className="mt-4">
              {loading ? <Skeleton className="h-[150px]" /> : pay.length ? (
                <>
                  <Donut size={132} thickness={18}
                    data={pay.slice(0, 6).map((p) => ({ label: (t.payment as Record<string, string>)[p.method] ?? p.method, value: p.value }))}
                    centerValue={formatCompact(cur.gross)} centerLabel={t.pos.sell} />
                </>
              ) : <EmptyState title={t.common.empty} />}
            </div>
          </Card>

          {/* top products */}
          <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-5">
            <SectionTitle right={<Link href="/pos/stock" className="text-[11px] text-muted hover:text-ink flex items-center gap-1">{t.inventory.title} <ArrowRight size={11} /></Link>}>
              {t.admin.topProducts}
            </SectionTitle>
            <div className="mt-3 space-y-1">
              {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)
                : prods.length ? prods.map((p, i) => (
                <div key={p.sku} className="flex items-center gap-3 rounded-xl hover:bg-surface2 px-2 py-2 -mx-1">
                  <span className="w-7 h-7 rounded-lg bg-surface2 grid place-items-center text-[11px] font-bold tnum shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{p.name}</p>
                    <p className="text-[10px] font-mono text-muted">{p.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold tnum">฿{formatCompact(p.gross)}</p>
                    <p className="text-[10px] text-muted tnum">{formatInt(p.qty)} {t.admin.unitsSold}</p>
                  </div>
                </div>
              )) : <EmptyState title={t.common.empty} />}
            </div>
          </Card>

          {/* low stock */}
          <Card className="col-span-12 md:col-span-6 lg:col-span-4 p-5">
            <SectionTitle right={low.length ? <Badge tone="warn">{low.length}</Badge> : <Badge tone="ok">OK</Badge>}>
              {t.inventory.lowStock}
            </SectionTitle>
            <div className="mt-3 space-y-1.5">
              {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)
                : low.length ? low.slice(0, 6).map(({ p, s }) => {
                const out = s.qty_on_hand <= 0;
                return (
                  <div key={p.id} className="flex items-center gap-2 text-xs">
                    <AlertTriangle size={13} className={out ? "text-danger" : "text-warn"} />
                    <span className="flex-1 truncate">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</span>
                    <span className={`tnum font-semibold ${out ? "text-danger" : "text-warn"}`}>{s.qty_on_hand}</span>
                  </div>
                );
              }) : <EmptyState icon={<Package size={22} />} title={t.common.empty} />}
            </div>
          </Card>

          {/* recent bills */}
          <Card className="col-span-12 lg:col-span-8 p-0">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
              <SectionTitle right={<Badge tone="ok"><Radio size={10} /> live</Badge>}>{t.admin.liveFeed}</SectionTitle>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : recent.length ? (
              <ul className="divide-y divide-line/70">
                {recent.map((o) => {
                  const emp = employees.find((e) => e.id === (o.salesperson_id ?? o.cashier_id));
                  return (
                    <li key={o.id} className="px-5 py-2.5 flex items-center gap-3">
                      <Avatar name={emp?.nickname ?? emp?.first_name ?? "?"} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium font-mono truncate">{o.order_no}</p>
                        <p className="text-[10px] text-muted">{new Date(o.created_at).toLocaleTimeString(locale === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })} · {o.items.length} {t.common.qty}</p>
                      </div>
                      {o.status === "voided" ? <Badge tone="danger">{t.orders.voided}</Badge> : null}
                      <span className="text-sm font-semibold tnum">฿{formatCompact(o.grand_total)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState icon={<ShoppingBag size={22} />} title={t.common.empty} />}
          </Card>

          {/* shift / staff */}
          <Card className="col-span-12 lg:col-span-4 p-5">
            <SectionTitle right={<Link href="/pos/shift" className="text-[11px] text-muted hover:text-ink flex items-center gap-1">{t.shift.title} <ArrowRight size={11} /></Link>}>
              {t.shift.title}
            </SectionTitle>
            {shift ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted text-xs flex items-center gap-1.5"><Clock size={13} /> {t.common.time}</span><span className="tnum text-xs">{new Date(shift.opened_at).toLocaleTimeString(locale === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}</span></div>
                <div className="flex justify-between"><span className="text-muted text-xs">{t.shift.openingCash}</span><span className="tnum text-xs">{formatTHB(shift.opening_cash, false)}</span></div>
                <div className="flex justify-between"><span className="text-muted text-xs">{L("เงินสดขาย", "Cash sales", "现金销售")}</span><span className="tnum text-xs">{formatTHB(cashToday, false)}</span></div>
                <div className="flex justify-between border-t border-line pt-1.5"><span className="text-muted text-xs font-medium">{t.shift.expectedCash}</span><span className="tnum font-semibold">{formatTHB(drawer, false)}</span></div>
              </div>
            ) : (
              <div className="mt-4 text-center">
                <PlayCircle size={26} className="mx-auto text-muted mb-2" />
                <p className="text-xs text-muted mb-3">{t.shift.openFirst}</p>
                <Button variant="primary" className="w-full" onClick={() => router.push("/pos/shift")}>{t.shift.open}</Button>
              </div>
            )}
            {staff.length ? (
              <div className="mt-4 pt-4 border-t border-line">
                <p className="eyebrow mb-2">{t.admin.topEmployees}</p>
                <div className="space-y-2">
                  {staff.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <Avatar name={e.label} size={26} />
                      <span className="text-xs flex-1 truncate">{e.label}</span>
                      <span className="text-xs tnum font-medium">฿{formatCompact(e.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </PosPage>
  );
}
