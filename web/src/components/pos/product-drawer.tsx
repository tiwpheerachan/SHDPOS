"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Boxes, TrendingDown, RotateCcw, ArrowLeftRight, Package, ClipboardList, PackagePlus,
  MapPin, ScrollText, Hash, Gauge, CalendarClock,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listOrders, listReturns, stockAll, listBranches, listAudit } from "@/lib/data/repo";
import { db } from "@/lib/offline/db";
import type { AuditEntry, Branch, Order, Product, ReturnDoc, StockLevel, Transfer } from "@/lib/types";
import { Drawer, DrawerTabs, DetailRow, Badge, EmptyState, Skeleton } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/store/session";

type Tab = "overview" | "location" | "ledger" | "serial";
type Ledger = { time: string; type: string; delta: number; ref: string; tone: string; icon: React.ReactNode };

export function ProductDrawer({
  product, branchId, onHand, onClose,
}: {
  product: Product | null;
  branchId: string | null;
  onHand: number;
  onClose: () => void;
}) {
  const { t, locale, pick } = useI18n();
  const { employee } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const showCost = employee ? can(employee, "report.cost") : false;

  const [tab, setTab] = useState<Tab>("overview");
  const [orders, setOrders] = useState<Order[]>([]);
  const [returns, setReturns] = useState<ReturnDoc[]>([]);
  const [allStock, setAllStock] = useState<(StockLevel & { key: string })[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product || !branchId) return;
    setTab("overview"); setLoading(true);
    void (async () => {
      const from = new Date(); from.setDate(from.getDate() - 90);
      const [o, r, s, tr, b, a] = await Promise.all([
        listOrders({ branchIds: [branchId], from }),
        listReturns([branchId]),
        stockAll(),
        db().transfers.reverse().sortBy("created_at") as Promise<Transfer[]>,
        listBranches(),
        listAudit({ branchIds: [branchId] }),
      ]);
      setOrders(o); setReturns(r); setAllStock(s); setTransfers(tr); setBranches(b);
      setAudits(a.filter((x) => x.action === "adjustment" || x.action === "stock_count" || x.action === "receive"));
      setLoading(false);
    })();
  }, [product, branchId]);

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);

  // ----- ledger (branch-scoped) -----
  const ledger = useMemo<Ledger[]>(() => {
    if (!product) return [];
    const ev: Ledger[] = [];
    for (const o of orders) {
      if (o.status === "voided") continue;
      const q = o.items.filter((it) => it.sku === product.sku).reduce((s, it) => s + it.qty, 0);
      if (q) ev.push({ time: o.created_at, type: "SALE", delta: -q, ref: o.order_no, tone: "danger", icon: <TrendingDown size={13} /> });
    }
    for (const r of returns) {
      const q = r.items.filter((it) => it.sku === product.sku && it.condition === "sellable").reduce((s, it) => s + it.qty, 0);
      if (q) ev.push({ time: r.created_at, type: r.type === "exchange" ? "EXCHANGE" : "RETURN", delta: q, ref: r.return_no, tone: "warn", icon: <RotateCcw size={13} /> });
    }
    for (const tr of transfers) {
      const line = tr.items.find((it) => it.sku === product.sku);
      if (!line) continue;
      if (tr.to_branch_id === branchId && line.qty_received) ev.push({ time: tr.created_at, type: "TRANSFER IN", delta: line.qty_received, ref: tr.transfer_no, tone: "info", icon: <ArrowLeftRight size={13} /> });
      if (tr.from_branch_id === branchId && line.qty_shipped) ev.push({ time: tr.created_at, type: "TRANSFER OUT", delta: -line.qty_shipped, ref: tr.transfer_no, tone: "info", icon: <ArrowLeftRight size={13} /> });
    }
    for (const a of audits) {
      const d = a.after_data as { sku?: string; delta?: number } | null;
      if (d?.sku === product.sku && typeof d.delta === "number" && d.delta !== 0)
        ev.push({ time: a.occurred_at, type: a.action === "stock_count" ? "COUNT" : a.action === "receive" ? "RECEIVE" : "ADJUSTMENT", delta: d.delta, ref: a.ref_no ?? "-", tone: a.action === "receive" ? "info" : "warn", icon: a.action === "receive" ? <PackagePlus size={13} /> : <ClipboardList size={13} /> });
    }
    ev.sort((a, b) => a.time.localeCompare(b.time));
    // running balance ที่จบลงตรงกับยอดคงเหลือปัจจุบัน
    const totalDelta = ev.reduce((s, e) => s + e.delta, 0);
    let bal = onHand - totalDelta;
    return ev.map((e) => { bal += e.delta; return { ...e, balance: bal } as Ledger & { balance: number }; }).reverse();
  }, [product, orders, returns, transfers, audits, branchId, onHand]);

  // ----- stock by location -----
  const byLocation = useMemo(() => {
    if (!product) return [];
    return allStock
      .filter((s) => s.product_id === product.id)
      .map((s) => ({ branch: branchName.get(s.branch_id) ?? s.branch_id, qty: s.qty_on_hand, reserved: s.qty_reserved, isHere: s.branch_id === branchId }))
      .sort((a, b) => b.qty - a.qty);
  }, [product, allStock, branchName, branchId]);
  const totalOnHand = byLocation.reduce((s, l) => s + l.qty, 0);

  // ----- velocity / DOS / serial -----
  const stats = useMemo(() => {
    if (!product) return { velocity: 0, dos: 0, latestSale: null as string | null, sold30: 0 };
    const from30 = Date.now() - 30 * 86400000;
    let sold30 = 0; let latestSale: string | null = null;
    for (const o of orders) {
      if (o.status === "voided") continue;
      const q = o.items.filter((it) => it.sku === product.sku).reduce((s, it) => s + it.qty, 0);
      if (!q) continue;
      if (!latestSale || o.created_at > latestSale) latestSale = o.created_at;
      if (new Date(o.created_at).getTime() >= from30) sold30 += q;
    }
    const velocity = sold30 / 30;
    return { velocity, dos: velocity > 0 ? onHand / velocity : Infinity, latestSale, sold30 };
  }, [product, orders, onHand]);

  const serials = useMemo(() => {
    if (!product?.track_serial) return [];
    const out: { serial: string; order: string; date: string }[] = [];
    for (const o of orders) {
      if (o.status === "voided") continue;
      for (const it of o.items) if (it.sku === product.sku) for (const sn of it.serials) out.push({ serial: sn, order: o.order_no, date: o.created_at });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [product, orders]);

  if (!product) return null;
  const rp = product.reorder_point;
  const clock = (iso: string) => new Date(iso).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const tabs: { value: Tab; label: React.ReactNode }[] = [
    { value: "overview", label: L("ภาพรวม", "Overview", "概览") },
    { value: "location", label: `${L("ตามสาขา", "By Location", "按门店")} (${byLocation.length})` },
    { value: "ledger", label: `Ledger (${ledger.length})` },
    ...(product.track_serial ? [{ value: "serial" as Tab, label: `Serial (${serials.length})` }] : []),
  ];

  const stockBadge = onHand <= 0 ? <Badge tone="danger">{t.pos.outOfStock}</Badge>
    : onHand <= rp ? <Badge tone="warn">{t.inventory.lowStock}</Badge> : <Badge tone="ok">OK</Badge>;

  return (
    <Drawer open={Boolean(product)} onClose={onClose} width="lg"
      title={pick({ th: product.name_th, en: product.name_en, zh: product.name_zh })}
      subtitle={<span className="font-mono">{product.sku}</span>}
      badge={stockBadge}>
      <DrawerTabs value={tab} options={tabs} onChange={setTab} />
      <div className="p-5">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : tab === "overview" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                [L("คงเหลือ (สาขานี้)", "On hand", "本店库存"), formatInt(onHand), <Boxes size={15} key="a" />],
                [L("ขาย/วัน", "Sales/day", "日均"), stats.velocity.toFixed(1), <Gauge size={15} key="b" />],
                [L("พอขาย", "Days of stock", "可售天数"), stats.dos === Infinity ? "∞" : `${Math.round(stats.dos)}${L(" วัน", "d", "天")}`, <CalendarClock size={15} key="c" />],
              ].map(([label, val, ic], i) => (
                <div key={i} className="rounded-xl bg-surface2 px-3 py-2.5">
                  <span className="text-muted">{ic}</span>
                  <p className="text-lg font-semibold tnum mt-1 leading-none">{val as string}</p>
                  <p className="text-[10px] text-muted mt-1">{label as string}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
              <DetailRow label={L("หมวดหมู่", "Category", "品类")}>{product.category_id ?? "—"}</DetailRow>
              <DetailRow label={t.common.price}>{formatTHB(product.price)}</DetailRow>
              {showCost ? <DetailRow label={L("ต้นทุน", "Cost", "成本")}>{formatTHB(product.cost)}</DetailRow> : null}
              <DetailRow label={L("จุดสั่งซื้อ (Reorder)", "Reorder point", "补货点")}>{rp || "—"}</DetailRow>
              <DetailRow label={L("รวมทุกสาขา", "All branches", "全门店")}>{formatInt(totalOnHand)}</DetailRow>
              <DetailRow label={L("ขาย 30 วัน", "Sold 30d", "30天销量")}>{formatInt(stats.sold30)}</DetailRow>
              <DetailRow label={L("ขายล่าสุด", "Latest sale", "最近销售")}>{stats.latestSale ? clock(stats.latestSale) : "—"}</DetailRow>
              <DetailRow label={L("รับประกัน", "Warranty", "保修")}>{product.warranty_months ? `${product.warranty_months} ${L("เดือน", "mo", "月")}` : "—"}</DetailRow>
              <DetailRow label="Serial / IMEI">{product.track_serial ? L("ติดตาม", "Tracked", "跟踪") : "—"}</DetailRow>
            </div>
            {onHand <= rp && stats.velocity > 0 ? (
              <div className="rounded-xl bg-warn/10 border border-warn/25 px-4 py-3 text-xs text-warn flex items-start gap-2">
                <Package size={14} className="mt-0.5 shrink-0" />
                <span>{L("คาดหมดภายใน", "Est. stockout in", "预计缺货")} ~{Math.max(0, Math.round(stats.dos))} {L("วัน", "days", "天")} · {L("แนะนำเติมสต๊อก/ขอโอนจากสาขาที่มีมากที่สุด", "consider restock or transfer from the branch with the most stock", "建议补货或调拨")}</span>
              </div>
            ) : null}
          </div>
        ) : tab === "location" ? (
          <div className="space-y-1.5">
            {byLocation.map((l, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${l.isHere ? "border-brand/40 bg-brand/5" : "border-line"}`}>
                <MapPin size={14} className="text-muted shrink-0" />
                <span className="text-xs flex-1 truncate">{l.branch}{l.isHere ? ` · ${L("สาขานี้", "here", "本店")}` : ""}</span>
                {l.reserved ? <span className="text-[10px] text-muted">{L("จอง", "rsv", "预留")} {l.reserved}</span> : null}
                <span className={`text-sm font-semibold tnum ${l.qty <= 0 ? "text-danger" : ""}`}>{formatInt(l.qty)}</span>
              </div>
            ))}
            {!byLocation.length ? <EmptyState title={t.common.empty} /> : null}
          </div>
        ) : tab === "ledger" ? (
          ledger.length ? (
            <div className="rounded-2xl border border-line overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-muted">
                    <th className="text-left font-semibold px-3 py-2">{t.common.time}</th>
                    <th className="text-left font-semibold px-3 py-2">{L("ประเภท", "Type", "类型")}</th>
                    <th className="text-left font-semibold px-3 py-2">Ref</th>
                    <th className="text-right font-semibold px-3 py-2">Δ</th>
                    <th className="text-right font-semibold px-3 py-2">{L("คงเหลือ", "Balance", "余额")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e, i) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{clock(e.time)}</td>
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-1"><span className={e.tone === "danger" ? "text-danger" : e.tone === "warn" ? "text-warn" : "text-info"}>{e.icon}</span>{e.type}</span></td>
                      <td className="px-3 py-2 font-mono text-[10px]">{e.ref}</td>
                      <td className={`px-3 py-2 text-right tnum font-semibold ${e.delta < 0 ? "text-danger" : "text-ok"}`}>{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                      <td className="px-3 py-2 text-right tnum">{(e as Ledger & { balance: number }).balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={<ScrollText size={22} />} title={L("ยังไม่มีความเคลื่อนไหว", "No movement", "暂无变动")} />
        ) : tab === "serial" ? (
          serials.length ? (
            <div className="space-y-1.5">
              {serials.map((s, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                  <Hash size={13} className="text-muted shrink-0" />
                  <span className="font-mono text-xs flex-1 truncate">{s.serial}</span>
                  <Badge tone="neutral">{L("ขายแล้ว", "Sold", "已售")}</Badge>
                  <span className="text-[10px] text-muted font-mono">{s.order}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<Hash size={22} />} title={L("ยังไม่มี Serial ที่ขาย", "No sold serials", "暂无已售序列号")} />
        ) : null}
      </div>
    </Drawer>
  );
}
