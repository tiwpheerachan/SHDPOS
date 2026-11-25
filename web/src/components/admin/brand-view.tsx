"use client";
// แท็บ "แบรนด์" ในหน้ายอดขาย — แบรนด์นับจาก "สินค้าที่ขาย" (สาขาคลัง/ร้านรวมหลายแบรนด์ไม่มีแบรนด์ที่สาขา)
//   ยอดต่อบรรทัด = หลังกระจายส่วนลดท้ายบิล (lineNet) → รวมทุกแบรนด์แล้วเท่ายอดขายจริงพอดี
import { useMemo } from "react";
import { ChevronRight, PieChart, BarChart3, Package, Store, Tag } from "lucide-react";
import type { Branch, Brand, Order, Product } from "@/lib/types";
import { lineNet } from "@/lib/analytics";
import { isCountedSale, saleAt, bkkDay, bkkHour } from "@/lib/sales-basis";
import { formatTHB, formatInt } from "@/lib/money";
import { EmptyState } from "@/components/ui";
import { Panel, Donut, Spark, COLORS } from "@/components/admin/sales-dashboard";

type Agg = { id: string; name: string; sales: number; gp: number; units: number; bills: Set<string>; branches: Map<string, number>; products: Map<string, { name: string; qty: number; sales: number }>; buckets: Map<string, number> };
const baht = (n: number) => formatTHB(n, false);
const OTHER = "#94a3b8";

export function BrandView({ orders, branches, brands, products, showCost, range, L, locale, onDrill }: {
  orders: Order[]; branches: Branch[]; brands: Brand[]; products: Product[]; showCost: boolean; range: { from: Date; to: Date };
  L: (a: string, b: string, c: string) => string; locale: string; onDrill: (id: string) => void;
}) {
  const model = useMemo(() => {
    const brOf = new Map(branches.map((b) => [b.id, b]));
    const prodBrand = new Map(products.map((p) => [p.id, p.brand_id]));
    const sold = orders.filter(isCountedSale);
    // ช่วงเวลา: ข้อมูลวันเดียว → รายชั่วโมง, ไม่งั้นรายวัน
    const daySet = [...new Set(sold.map((o) => bkkDay(saleAt(o))))].sort();
    const hourly = daySet.length <= 1;
    const keys: string[] = hourly ? Array.from({ length: 24 }, (_, h) => String(h)) : (() => {
      const out: string[] = [];
      for (let d = new Date(range.from); d <= range.to && out.length < 400; d = new Date(+d + 86400_000)) out.push(bkkDay(d.toISOString()));
      return out;
    })();
    const keyOf = (o: Order) => (hourly ? String(bkkHour(saleAt(o))) : bkkDay(saleAt(o)));
    const m = new Map<string, Agg>();
    for (const o of sold) {
      const k = keyOf(o);
      for (const it of o.items) {
        const bid = it.brand_id ?? (it.product_id ? prodBrand.get(it.product_id) : null) ?? brOf.get(o.branch_id)?.brand_id ?? "none";
        const b = brands.find((x) => x.id === bid);
        const a = m.get(bid) ?? { id: bid, name: b ? (locale === "zh" ? (b as Brand & { name_zh?: string }).name_zh ?? b.name : b.name) : L("ไม่ระบุแบรนด์", "No brand", "无品牌"), sales: 0, gp: 0, units: 0, bills: new Set(), branches: new Map(), products: new Map(), buckets: new Map() };
        const ln = lineNet(o, it);
        a.sales += ln.net; a.gp += ln.gp; a.bills.add(o.id);
        if (!it.is_gift) a.units += it.qty;
        a.branches.set(o.branch_id, (a.branches.get(o.branch_id) ?? 0) + ln.net);
        if (!it.is_gift) { const p = a.products.get(it.sku) ?? { name: it.name, qty: 0, sales: 0 }; p.qty += it.qty; p.sales += ln.net; a.products.set(it.sku, p); }
        a.buckets.set(k, (a.buckets.get(k) ?? 0) + ln.net);
        m.set(bid, a);
      }
    }
    const list = [...m.values()].sort((a, b) => b.sales - a.sales);
    const total = list.reduce((s, a) => s + a.sales, 0) || 1;
    const top = list.slice(0, 5);
    const color = (id: string) => { const i = top.findIndex((a) => a.id === id); return i >= 0 ? COLORS[i % 5] : OTHER; };
    // ข้อมูลกราฟแท่งซ้อน: ช่วงเวลาที่มีข้อมูล (ตัดหัว/ท้ายที่ว่างออกเมื่อเป็นรายชั่วโมง)
    let ks = keys;
    if (hourly) { const used = keys.filter((k) => list.some((a) => a.buckets.get(k))); const lo = Math.min(9, ...used.map(Number)), hi = Math.max(20, ...used.map(Number)); ks = keys.filter((k) => +k >= lo && +k <= hi); }
    const stacks = ks.map((k) => ({ key: k, label: hourly ? k : `${+k.split("-")[2]}/${+k.split("-")[1]}`, parts: top.map((a) => ({ id: a.id, v: a.buckets.get(k) ?? 0 })).concat([{ id: "_other", v: list.slice(5).reduce((s, a) => s + (a.buckets.get(k) ?? 0), 0) }]) }));
    return { list, total, top, color, stacks, hourly, brOf };
  }, [orders, branches, brands, products, range.from, range.to, locale, L]);

  if (!model.list.length) return <EmptyState title={L("ไม่มีข้อมูลแบรนด์ตามตัวกรอง", "No brand data", "无数据")} />;
  const { list, total, color, stacks, hourly, brOf } = model;
  const stackMax = Math.max(1, ...stacks.map((s) => s.parts.reduce((a, p) => a + p.v, 0)));
  const leader = list[0];
  const bName = (id: string) => { const b = brOf.get(id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—"; };
  const labelEvery = Math.max(1, Math.ceil(stacks.length / 14));

  return (
    <div className="space-y-4">
      {/* สรุปสั้น */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: L("แบรนด์ที่มียอดขาย", "Brands with sales", "有销售的品牌"), value: formatInt(list.filter((a) => a.id !== "none").length), sub: `${formatInt(list.reduce((s, a) => s + a.units, 0))} ${L("ชิ้น", "pcs", "件")}` },
          { label: L("แบรนด์อันดับ 1", "Top brand", "第一品牌"), value: leader.name, sub: `${baht(leader.sales)} · ${((leader.sales / total) * 100).toFixed(1)}%` },
          { label: L("ยอดขายรวม", "Total sales", "总销售额"), value: baht(list.reduce((s, a) => s + a.sales, 0)), sub: L("หลังส่วนลดท้ายบิล", "after bill discounts", "扣除整单折扣后") },
          showCost ? { label: L("กำไรขั้นต้นรวม", "Gross profit", "毛利"), value: baht(list.reduce((s, a) => s + a.gp, 0)), sub: L("ทุกแบรนด์", "all brands", "全部品牌") }
            : { label: L("สาขาที่ขาย", "Selling branches", "门店"), value: formatInt(new Set(list.flatMap((a) => [...a.branches.keys()])).size), sub: L("สาขาที่มีบิล", "with bills", "有单门店") },
        ].map((k) => (
          <div key={k.label} className="card px-3.5 py-3 min-w-0">
            <p className="text-[11px] text-muted truncate">{k.label}</p>
            <p className="text-lg font-semibold tnum leading-tight mt-1 truncate">{k.value}</p>
            <p className="text-[10.5px] text-muted truncate mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* กราฟ: สัดส่วน + ยอดตามเวลาแยกแบรนด์ */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title={L("สัดส่วนยอดขายตามแบรนด์", "Share by brand", "品牌占比")} icon={<PieChart size={14} className="text-brand" />}>
          <Donut rows={list.map((a) => ({ label: a.name, value: a.sales }))} />
        </Panel>
        <Panel className="lg:col-span-2" title={hourly ? L("ยอดขายรายชั่วโมงแยกแบรนด์", "Hourly sales by brand", "按小时品牌销售") : L("ยอดขายรายวันแยกแบรนด์", "Daily sales by brand", "按日品牌销售")} icon={<BarChart3 size={14} className="text-brand" />}
          action={<span className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">{model.top.map((a) => <span key={a.id} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(a.id) }} />{a.name}</span>)}{list.length > 5 ? <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: OTHER }} />{L("อื่น ๆ", "Others", "其他")}</span> : null}</span>}>
          <div className="flex items-end gap-[3px] h-[170px]">
            {stacks.map((s, i) => {
              const sum = s.parts.reduce((a, p) => a + p.v, 0);
              return (
                <div key={s.key} className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0" title={`${s.label}${hourly ? ":00" : ""} · ${baht(sum)}`}>
                  <div className="w-full flex flex-col-reverse rounded-t-[4px] overflow-hidden" style={{ height: `${(sum / stackMax) * 88}%` }}>
                    {s.parts.filter((p) => p.v > 0).map((p) => <div key={p.id} style={{ height: `${(p.v / (sum || 1)) * 100}%`, background: p.id === "_other" ? OTHER : color(p.id) }} />)}
                  </div>
                  <span className="text-[9.5px] text-muted tnum h-3">{i % labelEvery === 0 ? s.label : ""}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* ตารางแบรนด์ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2"><Tag size={14} className="text-brand" /><p className="text-sm font-semibold">{L("ยอดขายรายแบรนด์", "Sales by brand", "品牌销售")}</p><span className="text-[11px] text-muted">· {L("กดแถวเพื่อดูสาขาของแบรนด์นั้น", "click a row to see its branches", "点击查看门店")}</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2/50 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">{L("แบรนด์", "Brand", "品牌")}</th>
              <th className="text-right font-medium px-2 py-2">{L("ยอดขาย", "Sales", "销售额")}</th>
              <th className="text-left font-medium px-2 py-2 w-[150px]">{L("สัดส่วน", "Share", "占比")}</th>
              <th className="text-left font-medium px-2 py-2">{L("แนวโน้ม", "Trend", "趋势")}</th>
              <th className="text-right font-medium px-2 py-2">{L("บิล", "Bills", "单数")}</th>
              <th className="text-right font-medium px-2 py-2">{L("ชิ้น", "Units", "件数")}</th>
              <th className="text-right font-medium px-2 py-2">{L("เฉลี่ย/บิล", "Avg", "客单价")}</th>
              {showCost ? <th className="text-right font-medium px-2 py-2">{L("กำไรขั้นต้น", "GP", "毛利")}</th> : null}
              <th className="text-left font-medium px-2 py-2">{L("สินค้าขายดี", "Top product", "畅销商品")}</th>
              <th className="text-left font-medium px-2 py-2">{L("สาขาท็อป", "Top branch", "最佳门店")}</th>
              <th className="w-6" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {list.map((a) => {
                const can = a.id !== "none", share = (a.sales / total) * 100;
                const topP = [...a.products.values()].sort((x, y) => y.sales - x.sales)[0];
                const topB = [...a.branches.entries()].sort((x, y) => y[1] - x[1])[0];
                const spark = stacks.map((s) => a.buckets.get(s.key) ?? 0);
                return (
                  <tr key={a.id} onClick={() => can && onDrill(a.id)} className={`group ${can ? "cursor-pointer hover:bg-brand/[0.045]" : ""}`}>
                    <td className="px-4 py-2.5"><span className="inline-flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color(a.id) }} /><span className={can ? "" : "text-muted"}>{a.name}</span></span></td>
                    <td className="px-2 py-2.5 text-right font-semibold tnum whitespace-nowrap">{baht(a.sales)}</td>
                    <td className="px-2 py-2.5"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-surface2 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${share}%`, background: color(a.id) }} /></div><span className="text-[11px] text-muted tnum w-11 text-right">{share.toFixed(1)}%</span></div></td>
                    <td className="px-2 py-2.5">{spark.filter(Boolean).length >= 2 ? <Spark values={spark} /> : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2.5 text-right tnum">{formatInt(a.bills.size)}</td>
                    <td className="px-2 py-2.5 text-right tnum">{formatInt(a.units)}</td>
                    <td className="px-2 py-2.5 text-right tnum">{baht(a.bills.size ? a.sales / a.bills.size : 0)}</td>
                    {showCost ? <td className="px-2 py-2.5 text-right tnum text-ok">{baht(a.gp)}</td> : null}
                    <td className="px-2 py-2.5 max-w-[180px]"><span className="block truncate">{topP?.name ?? "—"}</span>{topP ? <span className="block text-[10.5px] text-muted">{formatInt(topP.qty)} {L("ชิ้น", "pcs", "件")}</span> : null}</td>
                    <td className="px-2 py-2.5 max-w-[200px]"><span className="block truncate">{topB ? bName(topB[0]) : "—"}</span><span className="block text-[10.5px] text-muted">{a.branches.size} {L("สาขา", "branches", "门店")}</span></td>
                    <td className="pr-3 pl-1 py-2.5 text-muted">{can ? <ChevronRight size={14} className="opacity-30 group-hover:opacity-100 group-hover:text-brand transition" /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* สินค้าขายดี + สาขา ของแบรนด์ท็อป */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {model.top.slice(0, 3).map((a) => {
          const prods = [...a.products.values()].sort((x, y) => y.sales - x.sales).slice(0, 5);
          const brs = [...a.branches.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
          return (
            <Panel key={a.id} title={a.name} icon={<span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(a.id) }} />}
              action={<span className="text-[10.5px] text-muted tnum">{baht(a.sales)}</span>}>
              <p className="text-[10.5px] font-semibold text-muted mb-1.5 inline-flex items-center gap-1"><Package size={11} />{L("สินค้าขายดี", "Top products", "畅销商品")}</p>
              <div className="space-y-1.5">
                {prods.map((p) => (
                  <div key={p.name} className="text-xs">
                    <div className="flex items-center gap-2"><span className="flex-1 truncate">{p.name}</span><span className="text-muted tnum">{formatInt(p.qty)}</span><span className="font-semibold tnum w-20 text-right">{baht(p.sales)}</span></div>
                    <div className="mt-0.5 h-1 rounded-full bg-surface2 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(p.sales / (prods[0]?.sales || 1)) * 100}%`, background: color(a.id) }} /></div>
                  </div>
                ))}
              </div>
              <p className="text-[10.5px] font-semibold text-muted mt-3 mb-1 inline-flex items-center gap-1"><Store size={11} />{L("สาขาที่ขาย", "Branches", "门店")}</p>
              {brs.map(([id, v]) => <p key={id} className="text-xs flex items-center gap-2"><span className="flex-1 truncate">{bName(id)}</span><span className="tnum text-muted">{baht(v)}</span></p>)}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
