"use client";
// =====================================================================
// วิเคราะห์การใช้คูปอง — ใช้ 2 ที่: แท็บ "วิเคราะห์การใช้งาน" (ทุกแคมเปญ)
//   และ drawer รายงานรายแคมเปญ (lockCampaign). แหล่งเดียว /api/admin/coupons
//   Breakdown 5 มิติ: แคมเปญ / สาขา / แบรนด์ / พนักงาน / ช่วงเวลา + กรองได้ + ดาวน์โหลด
// =====================================================================
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Ticket, Download, Share2, SlidersHorizontal, X, Check, TrendingDown, Receipt, Tag, Gift,
  Store, Layers, UserRound, CalendarDays, BarChart3,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useAdminScope } from "@/components/admin/filters";
import { Card, CardHeader, KpiTile, Button, Drawer, Table, Th, Td, Badge, Input, Select, EmptyState, Segmented } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { downloadExcel } from "@/lib/export";
import { useToast } from "@/components/toast-host";

type ViewKey = "list" | "product";
type DimKey = "campaign" | "branch" | "brand" | "employee" | "time";

interface Usage {
  id: string; order_no: string; at: string; branch_id: string; branch_name: string;
  brand_id: string; brand_name: string; employee_id: string; employee_name: string;
  customer_name: string | null; code: string; campaign_id: string; campaign_name: string;
  promo_type: string; discount: number; bill_total: number; products: { sku: string; name: string; qty: number }[];
}
interface CampaignMeta {
  id: string; code: string | null; name: string; discount_type: string; discount_value: number;
  max_discount: number | null; min_spend: number; active: boolean; promo_type: string;
  starts_at: string | null; ends_at: string | null;
}

export function CouponAnalytics({ initialCampaign, lockCampaign }: { initialCampaign?: string; lockCampaign?: boolean }) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { branches } = useAdminScope();
  const toast = useToast();

  const [campaigns, setCampaigns] = useState<CampaignMeta[]>([]);
  const [usages, setUsages] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);
  const [authErr, setAuthErr] = useState(false);
  const [view, setView] = useState<ViewKey>("list");
  const [dim, setDim] = useState<DimKey>(lockCampaign ? "branch" : "campaign");
  const [filterOpen, setFilterOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const todayISO = new Date().toISOString().slice(0, 10);
  const ago = (d: number) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
  const [fFrom, setFFrom] = useState(ago(90));
  const [fTo, setFTo] = useState(todayISO);
  const [fCampaign, setFCampaign] = useState(initialCampaign ?? "");
  const [fBranch, setFBranch] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fEmployee, setFEmployee] = useState("");
  const [fProduct, setFProduct] = useState("");
  const [fMinDiscount, setFMinDiscount] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setAuthErr(false);
    try {
      const r = await fetch("/api/admin/coupons", { cache: "no-store" });
      if (r.status === 403) { setAuthErr(true); setCampaigns([]); setUsages([]); return; }
      const j = await r.json();
      setCampaigns(Array.isArray(j.campaigns) ? j.campaigns : []);
      setUsages(Array.isArray(j.usages) ? j.usages : []);
    } catch { setAuthErr(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dtDate = (iso: string) => iso.slice(0, 10);
  const dtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  const campById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const brandOpts = useMemo(() => { const m = new Map<string, string>(); usages.forEach((u) => { if (u.brand_id) m.set(u.brand_id, u.brand_name); }); return [...m.entries()]; }, [usages]);
  const empOpts = useMemo(() => { const m = new Map<string, string>(); usages.forEach((u) => { if (u.employee_id) m.set(u.employee_id, u.employee_name); }); return [...m.entries()]; }, [usages]);

  const filtered = useMemo(() => usages.filter((u) => {
    const d = dtDate(u.at);
    if (lockCampaign && initialCampaign && u.campaign_id !== initialCampaign) return false;
    if (!lockCampaign && fCampaign && u.campaign_id !== fCampaign) return false;
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    if (fBranch && u.branch_id !== fBranch) return false;
    if (fBrand && u.brand_id !== fBrand) return false;
    if (fEmployee && u.employee_id !== fEmployee) return false;
    if (fMinDiscount && u.discount < Number(fMinDiscount)) return false;
    if (fProduct) { const kw = fProduct.toLowerCase(); if (!u.products.some((p) => `${p.name} ${p.sku}`.toLowerCase().includes(kw))) return false; }
    return true;
  }), [usages, lockCampaign, initialCampaign, fCampaign, fFrom, fTo, fBranch, fBrand, fEmployee, fMinDiscount, fProduct]);

  const activeFilters = (fBranch ? 1 : 0) + (fBrand ? 1 : 0) + (fEmployee ? 1 : 0) + (fProduct ? 1 : 0) + (fMinDiscount ? 1 : 0) + (!lockCampaign && fCampaign ? 1 : 0);

  const kpi = useMemo(() => {
    const uses = filtered.length;
    const discount = filtered.reduce((s, u) => s + u.discount, 0);
    const bill = filtered.reduce((s, u) => s + u.bill_total, 0);
    return { uses, discount, bill, avg: uses ? discount / uses : 0 };
  }, [filtered]);

  // ── Breakdown ตามมิติ ─────────────────────────────────────────────
  const keyOf = (u: Usage): [string, string] =>
    dim === "branch" ? [u.branch_id, u.branch_name]
      : dim === "brand" ? [u.brand_id, u.brand_name]
        : dim === "employee" ? [u.employee_id, u.employee_name]
          : [u.campaign_id, u.campaign_name];
  const dimRows = useMemo(() => {
    const m = new Map<string, { name: string; uses: number; discount: number; revenue: number }>();
    filtered.forEach((u) => { const [k, name] = keyOf(u); const cur = m.get(k) ?? { name, uses: 0, discount: 0, revenue: 0 }; cur.uses++; cur.discount += u.discount; cur.revenue += u.bill_total; m.set(k, cur); });
    return [...m.values()].sort((a, b) => b.discount - a.discount);
  }, [filtered, dim]); // eslint-disable-line react-hooks/exhaustive-deps
  const daily = useMemo(() => {
    const m = new Map<string, { uses: number; discount: number }>();
    filtered.forEach((u) => { const d = u.at.slice(0, 10); const cur = m.get(d) ?? { uses: 0, discount: 0 }; cur.uses++; cur.discount += u.discount; m.set(d, cur); });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [filtered]);

  const byProduct = useMemo(() => {
    const m = new Map<string, { sku: string; name: string; orders: number; qty: number }>();
    filtered.forEach((u) => u.products.forEach((p) => { const cur = m.get(p.sku) ?? { sku: p.sku, name: p.name, orders: 0, qty: 0 }; cur.orders++; cur.qty += p.qty; m.set(p.sku, cur); }));
    return [...m.values()].sort((a, b) => b.orders - a.orders);
  }, [filtered]);

  const dimLabel: Record<DimKey, string> = {
    campaign: L("แคมเปญ", "Campaign", "活动"), branch: L("สาขา", "Branch", "门店"),
    brand: L("แบรนด์", "Brand", "品牌"), employee: L("พนักงาน", "Staff", "员工"), time: L("ช่วงเวลา", "Time", "时间"),
  };

  function downloadBreakdown() {
    const stamp = `${fFrom}_${fTo}`;
    if (dim === "time") {
      downloadExcel(`coupons-by-time-${stamp}`, [
        { key: "d", label: L("วันที่", "Date", "日期"), map: (r: [string, { uses: number; discount: number }]) => r[0] },
        { key: "uses", label: L("จำนวนใช้", "Uses", "次数"), map: (r: [string, { uses: number; discount: number }]) => String(r[1].uses) },
        { key: "discount", label: L("ส่วนลดรวม", "Discount", "折扣"), map: (r: [string, { uses: number; discount: number }]) => formatTHB(r[1].discount, false) },
      ], daily, `${L("ตามช่วงเวลา", "By time", "按时间")}`);
    } else {
      downloadExcel(`coupons-by-${dim}-${stamp}`, [
        { key: "name", label: dimLabel[dim] },
        { key: "uses", label: L("จำนวนใช้", "Uses", "次数") },
        { key: "discount", label: L("ส่วนลดรวม", "Discount", "折扣"), map: (r) => formatTHB(r.discount, false) },
        { key: "revenue", label: L("ยอดขาย", "Revenue", "销售"), map: (r) => formatTHB(r.revenue, false) },
      ], dimRows, `${L("สรุปตาม", "By", "按")}${dimLabel[dim]}`);
    }
    toast.push({ tone: "ok", title: L("ดาวน์โหลด Excel แล้ว", "Excel downloaded", "已下载") });
  }

  function exportLog() {
    const stamp = `${fFrom}_${fTo}`;
    if (view === "product") {
      downloadExcel(`coupons-product-${stamp}`, [
        { key: "sku", label: "SKU" }, { key: "name", label: L("สินค้า", "Product", "商品") },
        { key: "orders", label: L("จำนวนบิล", "Orders", "单数") }, { key: "qty", label: L("จำนวนชิ้น", "Qty", "件数") },
      ], byProduct, L("การใช้คูปอง ตามสินค้า", "Coupon usage by product", "按商品"));
    } else {
      downloadExcel(`coupons-usage-${stamp}`, [
        { key: "at", label: L("วันที่", "Date", "日期"), map: (r) => dtDate(r.at) },
        { key: "time", label: L("เวลา", "Time", "时间"), map: (r) => dtTime(r.at) },
        { key: "order_no", label: L("เลขบิล", "Order", "单号") },
        { key: "campaign_name", label: L("แคมเปญ", "Campaign", "活动") },
        { key: "code", label: L("โค้ด", "Code", "码") },
        { key: "products", label: L("สินค้า", "Products", "商品"), map: (r) => r.products.map((p) => `${p.name}×${p.qty}`).join(", ") },
        { key: "branch_name", label: L("สาขา", "Branch", "门店") },
        { key: "brand_name", label: L("แบรนด์", "Brand", "品牌") },
        { key: "employee_name", label: L("พนักงาน", "Staff", "员工") },
        { key: "customer_name", label: L("ลูกค้า", "Customer", "客户"), map: (r) => r.customer_name ?? "-" },
        { key: "discount", label: L("ส่วนลด", "Discount", "折扣"), map: (r) => formatTHB(r.discount, false) },
        { key: "bill_total", label: L("ยอดสุทธิ", "Net", "净额"), map: (r) => formatTHB(r.bill_total, false) },
      ], filtered, L("รายการใช้คูปอง", "Coupon usage log", "使用明细"));
    }
    toast.push({ tone: "ok", title: L("ดาวน์โหลด Excel แล้ว", "Excel downloaded", "已下载"), body: `${filtered.length} ${L("รายการ", "rows", "行")}` });
  }

  function shareLink() {
    const url = `${window.location.origin}/share/coupons`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); toast.push({ tone: "ok", title: L("คัดลอกลิงก์แชร์แล้ว", "Share link copied", "已复制"), body: url }); }).catch(() => undefined);
  }

  function clearFilters() { setFBranch(""); setFBrand(""); setFEmployee(""); setFProduct(""); setFMinDiscount(""); if (!lockCampaign) setFCampaign(""); setFFrom(ago(90)); setFTo(todayISO); }

  if (authErr) {
    return (
      <Card className="p-6">
        <EmptyState icon={<Ticket size={26} />} title={L("ยังเข้าถึงข้อมูลไม่ได้ (เซสชันหมดสิทธิ์)", "Not authorized", "无权限")}
          body={L("ในเครื่อง dev เปิด /api/dev/login หนึ่งครั้งเพื่อเชื่อมเซสชัน แล้วรีเฟรช", "Open /api/dev/login once (dev), then refresh", "开发环境先打开 /api/dev/login")} />
        <div className="flex justify-center"><Button variant="primary" onClick={() => { window.location.href = "/api/dev/login?next=/admin/campaigns"; }}>{L("เชื่อมเซสชัน dev แล้วกลับมา", "Dev login & return", "开发登录")}</Button></div>
      </Card>
    );
  }

  const dimOpts = (lockCampaign ? (["branch", "brand", "employee", "time"] as DimKey[]) : (["campaign", "branch", "brand", "employee", "time"] as DimKey[]));
  const dimIcon: Record<DimKey, React.ReactNode> = { campaign: <Ticket size={13} />, branch: <Store size={13} />, brand: <Layers size={13} />, employee: <UserRound size={13} />, time: <CalendarDays size={13} /> };
  const maxDisc = Math.max(1, ...daily.map((d) => d[1].discount));

  return (
    <div className="space-y-4">
      {/* actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {activeFilters ? <span className="text-muted">{L("กรองอยู่", "Filtered", "筛选")} {activeFilters} • </span> : null}
          <span className="text-muted">{filtered.length} {L("รายการ", "records", "条")} · {fFrom} → {fTo}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-9" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={15} /> {L("ตัวกรอง", "Filters", "筛选")}{activeFilters ? <span className="ml-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-brand text-white text-[10px] font-bold">{activeFilters}</span> : null}</Button>
          {!lockCampaign && <Button variant="ghost" className="h-9" onClick={shareLink}>{copied ? <Check size={15} /> : <Share2 size={15} />} {L("แชร์", "Share", "分享")}</Button>}
          <Button variant="primary" className="h-9" onClick={exportLog}><Download size={15} /> {L("ดาวน์โหลด Excel", "Export Excel", "导出")}</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("จำนวนการใช้", "Total uses", "使用次数")} value={kpi.uses.toLocaleString()} icon={<Ticket size={16} />} accent="lavender" />
        <KpiTile label={L("ส่วนลดรวม", "Total discount", "总折扣")} value={formatTHB(kpi.discount, false)} icon={<TrendingDown size={16} />} accent="peach" />
        <KpiTile label={L("ยอดขายที่เกิด", "Revenue driven", "带动销售")} value={formatTHB(kpi.bill, false)} icon={<Receipt size={16} />} accent="mint" />
        <KpiTile label={L("เฉลี่ยส่วนลด/บิล", "Avg discount/bill", "均折扣")} value={formatTHB(kpi.avg, false)} icon={<Tag size={16} />} accent="coral" />
      </div>

      {/* Breakdown ตามมิติ (เลือกด้วย dropdown · กระชับ 2 คอลัมน์) */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold inline-flex items-center gap-1.5 shrink-0"><BarChart3 size={15} /> {L("แยกตาม", "Breakdown", "按维度")}</span>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{dimIcon[dim]}</span>
              <Select value={dim} onChange={(e) => setDim(e.target.value as DimKey)} className="h-9 pl-8 pr-8 text-sm font-medium">
                {dimOpts.map((d) => <option key={d} value={d}>{dimLabel[d]}</option>)}
              </Select>
            </div>
          </div>
          <button onClick={downloadBreakdown} className="text-xs text-brand hover:underline inline-flex items-center gap-1 shrink-0"><Download size={13} /> {L("ดาวน์โหลด", "Download", "下载")}</button>
        </div>

        {loading ? <p className="text-center text-sm text-muted py-6">{L("กำลังโหลด…", "Loading…", "加载中…")}</p>
          : !filtered.length ? <EmptyState icon={<Ticket size={24} />} title={L("ไม่มีข้อมูลในช่วง/ตัวกรองนี้", "No data", "无数据")} />
            : dim === "time" ? (
              <div>
                <div className="flex items-end gap-[3px] h-28 rounded-xl border border-line bg-surface2/30 p-2">
                  {daily.map(([d, v]) => (
                    <div key={d} className="flex-1 min-w-[2px] bg-brand/70 hover:bg-brand rounded-t transition-colors" style={{ height: `${Math.max(3, (v.discount / maxDisc) * 100)}%` }} title={`${d} · ${v.uses} ${L("ครั้ง", "uses", "次")} · ฿${v.discount.toLocaleString()}`} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted mt-1"><span>{daily[0]?.[0]}</span><span>{daily.length} {L("วัน", "days", "天")}</span><span>{daily[daily.length - 1]?.[0]}</span></div>
              </div>
            ) : (() => {
              const top = dimRows.slice(0, 8);
              const maxV = Math.max(1, ...top.map((r) => r.discount));
              return (
                <>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                    {top.map((r, i) => (
                      <div key={r.name + i} className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] text-muted w-4 text-right tnum shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink truncate" title={r.name}>{r.name}</span>
                            <span className="text-xs tnum text-danger font-semibold shrink-0">-{formatTHB(r.discount, false)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface2 mt-1 overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${(r.discount / maxV) * 100}%` }} /></div>
                          <div className="text-[10px] text-muted mt-0.5">{r.uses} {L("ครั้ง", "uses", "次")} · {L("ยอด", "rev", "")} {formatTHB(r.revenue, false)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {dimRows.length > 8 ? <p className="text-[11px] text-muted mt-3 text-center">+{dimRows.length - 8} {L("รายการ — ดาวน์โหลดเพื่อดูทั้งหมด", "more — download for full list", "更多")}</p> : null}
                </>
              );
            })()}
      </Card>

      {/* ตาราง: รายการใช้ / ตามสินค้า */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Segmented value={view} onChange={(v) => setView(v as ViewKey)} options={[
            { value: "list", label: L("รายการใช้", "Usage log", "明细") },
            { value: "product", label: L("ตามสินค้า", "By product", "按商品") },
          ]} />
          <span className="text-xs text-muted">{filtered.length} {L("รายการ", "records", "条")}</span>
        </div>

        {loading ? <p className="text-center text-sm text-muted py-8">{L("กำลังโหลด…", "Loading…", "加载中…")}</p>
          : !filtered.length ? <EmptyState icon={<Ticket size={26} />} title={L("ไม่มีการใช้คูปองในช่วงนี้", "No coupon usage", "无数据")} />
            : view === "list" ? (
              <div className="overflow-x-auto">
                <Table>
                  <thead><tr>
                    <Th>{L("วัน-เวลา", "Date-time", "时间")}</Th><Th>{L("เลขบิล", "Order", "单号")}</Th><Th>{L("แคมเปญ", "Campaign", "活动")}</Th>
                    <Th>{L("สินค้า", "Products", "商品")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("แบรนด์", "Brand", "品牌")}</Th><Th>{L("พนักงาน", "Staff", "员工")}</Th>
                    <Th align="right">{L("ส่วนลด", "Discount", "折扣")}</Th><Th align="right">{L("ยอดสุทธิ", "Net", "净额")}</Th>
                  </tr></thead>
                  <tbody>
                    {filtered.slice(0, 300).map((u) => (
                      <tr key={u.id}>
                        <Td className="text-xs whitespace-nowrap">{dtDate(u.at)} <span className="text-muted">{dtTime(u.at)}</span></Td>
                        <Td className="font-mono text-[11px] text-muted">{u.order_no}</Td>
                        <Td className="text-xs"><span className="inline-flex items-center gap-1.5">{u.promo_type === "gift" ? <Gift size={11} className="text-ink" /> : <Ticket size={11} className="text-ink" />} {u.campaign_name} <Badge tone="neutral">{u.code}</Badge></span></Td>
                        <Td className="text-xs"><span className="block max-w-[200px] truncate" title={u.products.map((p) => `${p.name}×${p.qty}`).join(", ")}>{u.products.map((p) => `${p.name}×${p.qty}`).join(", ") || "—"}</span></Td>
                        <Td className="text-xs text-muted">{u.branch_name}</Td>
                        <Td className="text-xs text-muted">{u.brand_name}</Td>
                        <Td className="text-xs text-muted">{u.employee_name}</Td>
                        <Td align="right" className="tnum text-danger font-medium">-{formatTHB(u.discount, false)}</Td>
                        <Td align="right" className="tnum">{formatTHB(u.bill_total, false)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <thead><tr><Th>SKU</Th><Th>{L("สินค้า", "Product", "商品")}</Th><Th align="right">{L("จำนวนบิล", "Orders", "单数")}</Th><Th align="right">{L("จำนวนชิ้น", "Qty", "件数")}</Th></tr></thead>
                  <tbody>{byProduct.map((p) => (
                    <tr key={p.sku}><Td className="font-mono text-[11px] text-muted">{p.sku}</Td><Td className="text-sm">{p.name}</Td><Td align="right" className="tnum">{p.orders}</Td><Td align="right" className="tnum">{p.qty}</Td></tr>
                  ))}</tbody>
                </Table>
              </div>
            )}
      </Card>

      {/* ตัวกรองละเอียด (drawer ขวา) */}
      <Drawer open={filterOpen} onClose={() => setFilterOpen(false)} title={L("ตัวกรองละเอียด", "Detailed filters", "筛选")} subtitle={L("กรองแล้วใช้กับกราฟ ตาราง และไฟล์ Excel", "Applies to charts, tables & Excel", "应用于图表/表格/Excel")} width="md">
        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("ช่วงวันที่", "Date range", "日期范围")}</p>
            <div className="flex items-center gap-2">
              <Input type="date" value={fFrom} max={fTo} onChange={(e) => setFFrom(e.target.value)} className="h-10" />
              <span className="text-muted">→</span>
              <Input type="date" value={fTo} min={fFrom} max={todayISO} onChange={(e) => setFTo(e.target.value)} className="h-10" />
            </div>
            <div className="flex gap-1.5 mt-2">
              {[["7", L("7 วัน", "7d", "7天")], ["30", L("30 วัน", "30d", "30天")], ["90", L("90 วัน", "90d", "90天")]].map(([d, lbl]) => (
                <button key={d} onClick={() => { setFFrom(ago(Number(d))); setFTo(todayISO); }} className="text-[11px] px-2.5 h-7 rounded-lg border border-line text-muted hover:text-brand hover:border-brand/40">{lbl}</button>
              ))}
            </div>
          </div>
          {!lockCampaign && (
            <div>
              <p className="text-xs font-medium text-muted mb-1.5">{L("แคมเปญ", "Campaign", "活动")}</p>
              <Select value={fCampaign} onChange={(e) => setFCampaign(e.target.value)} className="h-10 w-full"><option value="">{L("ทุกแคมเปญ", "All campaigns", "全部")}</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("สาขา", "Branch", "门店")}</p>
            <Select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="h-10 w-full"><option value="">{L("ทุกสาขา", "All branches", "全部")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name_th || b.name}</option>)}</Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("แบรนด์", "Brand", "品牌")}</p>
            <Select value={fBrand} onChange={(e) => setFBrand(e.target.value)} className="h-10 w-full"><option value="">{L("ทุกแบรนด์", "All brands", "全部")}</option>{brandOpts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("พนักงาน", "Staff", "员工")}</p>
            <Select value={fEmployee} onChange={(e) => setFEmployee(e.target.value)} className="h-10 w-full"><option value="">{L("ทุกคน", "Everyone", "全部")}</option>{empOpts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("ค้นหาสินค้า (ชื่อ/SKU)", "Product (name/SKU)", "商品")}</p>
            <Input value={fProduct} onChange={(e) => setFProduct(e.target.value)} placeholder={L("เช่น A510, เมมโมรี่", "e.g. A510", "如 A510")} className="h-10 w-full" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("ส่วนลดขั้นต่ำ (บาท)", "Min discount (฿)", "最低折扣")}</p>
            <Input type="number" min={0} value={fMinDiscount} onChange={(e) => setFMinDiscount(e.target.value)} placeholder="0" className="h-10 w-40" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={clearFilters}><X size={15} /> {L("ล้างตัวกรอง", "Clear", "清除")}</Button>
            <Button variant="primary" className="flex-1" onClick={() => setFilterOpen(false)}><Check size={15} /> {L(`ใช้ (${filtered.length})`, `Apply (${filtered.length})`, `应用 (${filtered.length})`)}</Button>
          </div>
          <Button variant="soft" className="w-full" onClick={exportLog}><Download size={15} /> {L("ดาวน์โหลด Excel ตามตัวกรองนี้", "Download Excel (filtered)", "导出Excel")}</Button>
        </div>
      </Drawer>
    </div>
  );
}
