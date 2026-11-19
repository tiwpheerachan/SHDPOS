"use client";
// =====================================================================
// วิเคราะห์การใช้คูปอง — ใช้ภายในหน้า /admin/campaigns (แท็บ "วิเคราะห์การใช้งาน")
//   แหล่งข้อมูลเดียวกับการจัดการแคมเปญ (Supabase: campaigns + coupon_redemptions)
// =====================================================================
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Ticket, Download, Share2, SlidersHorizontal, X, Check, TrendingDown, Receipt, Tag, Gift,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useAdminScope } from "@/components/admin/filters";
import { Card, CardHeader, KpiTile, Button, Drawer, Table, Th, Td, Badge, Input, Select, EmptyState, Segmented } from "@/components/ui";
import { BarList } from "@/components/charts";
import { formatTHB } from "@/lib/money";
import { downloadExcel } from "@/lib/export";
import { useToast } from "@/components/toast-host";

type ViewKey = "list" | "campaign" | "product";

interface Usage {
  id: string; order_no: string; at: string; branch_id: string; branch_name: string;
  customer_name: string | null; code: string; campaign_id: string; campaign_name: string;
  promo_type: string; discount: number; bill_total: number; products: { sku: string; name: string; qty: number }[];
}
interface CampaignMeta {
  id: string; code: string | null; name: string; discount_type: string; discount_value: number;
  max_discount: number | null; min_spend: number; active: boolean; promo_type: string;
  starts_at: string | null; ends_at: string | null;
}

export function CouponAnalytics({ initialCampaign }: { initialCampaign?: string }) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { branches } = useAdminScope();
  const toast = useToast();

  const [campaigns, setCampaigns] = useState<CampaignMeta[]>([]);
  const [usages, setUsages] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);
  const [authErr, setAuthErr] = useState(false);
  const [view, setView] = useState<ViewKey>("list");
  const [filterOpen, setFilterOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const todayISO = new Date().toISOString().slice(0, 10);
  const ago = (d: number) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
  const [fFrom, setFFrom] = useState(ago(90));
  const [fTo, setFTo] = useState(todayISO);
  const [fCampaign, setFCampaign] = useState(initialCampaign ?? "");
  const [fBranch, setFBranch] = useState("");
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

  const scoped = useMemo(() => usages.filter((u) => {
    const d = dtDate(u.at);
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    if (fBranch && u.branch_id !== fBranch) return false;
    if (fMinDiscount && u.discount < Number(fMinDiscount)) return false;
    if (fProduct) { const kw = fProduct.toLowerCase(); if (!u.products.some((p) => `${p.name} ${p.sku}`.toLowerCase().includes(kw))) return false; }
    return true;
  }), [usages, fFrom, fTo, fBranch, fMinDiscount, fProduct]);

  const filtered = useMemo(() => scoped.filter((u) => !fCampaign || u.campaign_id === fCampaign), [scoped, fCampaign]);
  const activeFilters = (fCampaign ? 1 : 0) + (fBranch ? 1 : 0) + (fProduct ? 1 : 0) + (fMinDiscount ? 1 : 0);

  const kpi = useMemo(() => {
    const uses = filtered.length;
    const discount = filtered.reduce((s, u) => s + u.discount, 0);
    const bill = filtered.reduce((s, u) => s + u.bill_total, 0);
    return { uses, discount, bill, avg: uses ? discount / uses : 0 };
  }, [filtered]);

  const BUCKETS = 14;
  const perCoupon = useMemo(() => {
    const fromT = new Date(fFrom).getTime();
    const toT = new Date(fTo + "T23:59:59").getTime();
    const span = Math.max(1, toT - fromT);
    return campaigns.map((c) => {
      const rows = scoped.filter((u) => u.campaign_id === c.id);
      const uses = rows.length;
      const discount = rows.reduce((s, u) => s + u.discount, 0);
      const revenue = rows.reduce((s, u) => s + u.bill_total, 0);
      const customers = new Set(rows.map((u) => u.customer_name || u.order_no)).size;
      const lastUsed = rows.reduce((m, u) => (u.at > m ? u.at : m), "");
      const trend = new Array(BUCKETS).fill(0) as number[];
      for (const u of rows) { const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((new Date(u.at).getTime() - fromT) / span) * BUCKETS))); trend[i]++; }
      const prodCount = new Map<string, number>();
      for (const u of rows) for (const p of u.products) prodCount.set(p.name, (prodCount.get(p.name) ?? 0) + p.qty);
      const topProduct = [...prodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { c, uses, discount, revenue, avg: uses ? discount / uses : 0, customers, lastUsed, trend, topProduct };
    }).sort((a, b) => b.uses - a.uses);
  }, [campaigns, scoped, fFrom, fTo]);

  const topCampaigns = useMemo(() => perCoupon.filter((p) => p.uses > 0).map((p) => ({ name: p.c.name, count: p.uses, discount: p.discount })), [perCoupon]);
  const byCampaign = useMemo(() => perCoupon.filter((p) => p.uses > 0).map((p) => ({ name: p.c.name, count: p.uses, discount: p.discount, bill: p.revenue })), [perCoupon]);
  const byProduct = useMemo(() => {
    const m = new Map<string, { sku: string; name: string; orders: number; qty: number }>();
    filtered.forEach((u) => u.products.forEach((p) => { const cur = m.get(p.sku) ?? { sku: p.sku, name: p.name, orders: 0, qty: 0 }; cur.orders++; cur.qty += p.qty; m.set(p.sku, cur); }));
    return [...m.values()].sort((a, b) => b.orders - a.orders);
  }, [filtered]);

  function exportXls() {
    const stamp = `${fFrom}_${fTo}`;
    if (view === "campaign") {
      downloadExcel(`coupons-campaign-${stamp}`, [
        { key: "name", label: L("แคมเปญ", "Campaign", "活动") },
        { key: "count", label: L("จำนวนใช้", "Uses", "次数") },
        { key: "discount", label: L("ส่วนลดรวม", "Total discount", "总折扣"), map: (r) => formatTHB(r.discount, false) },
        { key: "bill", label: L("ยอดบิลรวม", "Total bill", "总额"), map: (r) => formatTHB(r.bill, false) },
      ], byCampaign, L("สรุปการใช้คูปอง รายแคมเปญ", "Coupon usage by campaign", "按活动"));
    } else if (view === "product") {
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

  if (authErr) {
    return (
      <Card className="p-6">
        <EmptyState icon={<Ticket size={26} />} title={L("ยังเข้าถึงข้อมูลไม่ได้ (เซสชันหมดสิทธิ์)", "Not authorized", "无权限")}
          body={L("ในเครื่อง dev เปิด /api/dev/login หนึ่งครั้งเพื่อเชื่อมเซสชัน แล้วรีเฟรช", "Open /api/dev/login once (dev), then refresh", "开发环境先打开 /api/dev/login")} />
        <div className="flex justify-center"><Button variant="primary" onClick={() => { window.location.href = "/api/dev/login?next=/admin/campaigns"; }}>{L("เชื่อมเซสชัน dev แล้วกลับมา", "Dev login & return", "开发登录")}</Button></div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* actions */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Button variant="ghost" className="h-9" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={15} /> {L("ตัวกรอง", "Filters", "筛选")}{activeFilters ? <span className="ml-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-brand text-white text-[10px] font-bold">{activeFilters}</span> : null}</Button>
        <Button variant="ghost" className="h-9" onClick={shareLink}>{copied ? <Check size={15} /> : <Share2 size={15} />} {L("แชร์", "Share", "分享")}</Button>
        <Button variant="primary" className="h-9" onClick={exportXls}><Download size={15} /> {L("ดาวน์โหลด Excel", "Export Excel", "导出")}</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("จำนวนการใช้", "Total uses", "使用次数")} value={kpi.uses.toLocaleString()} icon={<Ticket size={16} />} accent="lavender" />
        <KpiTile label={L("ส่วนลดรวม", "Total discount", "总折扣")} value={formatTHB(kpi.discount, false)} icon={<TrendingDown size={16} />} accent="peach" />
        <KpiTile label={L("ยอดขายที่เกิด", "Revenue driven", "带动销售")} value={formatTHB(kpi.bill, false)} icon={<Receipt size={16} />} accent="mint" />
        <KpiTile label={L("เฉลี่ยส่วนลด/บิล", "Avg discount/bill", "均折扣")} value={formatTHB(kpi.avg, false)} icon={<Tag size={16} />} accent="coral" />
      </div>

      {fCampaign ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted">{L("กรองเฉพาะ", "Filtered", "筛选")}:</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/10 text-brand font-medium"><Ticket size={12} /> {campById.get(fCampaign)?.name ?? ""}
            <button onClick={() => setFCampaign("")} className="ml-0.5 hover:opacity-70"><X size={12} /></button>
          </span>
        </div>
      ) : null}

      {/* Top แคมเปญ */}
      {topCampaigns.length ? (
        <Card className="p-4">
          <CardHeader title={L("Top แคมเปญ (ตามส่วนลดรวม)", "Top campaigns (by discount)", "活动排行")} subtitle={`${fFrom} → ${fTo}`} />
          <div className="mt-3">
            <BarList data={[...topCampaigns].sort((a, b) => b.discount - a.discount).slice(0, 8).map((c) => ({ label: c.name, value: c.discount, sub: `${c.count} ${L("ครั้ง", "uses", "次")}` }))} valueFormat={(n) => formatTHB(n, false)} />
          </div>
        </Card>
      ) : null}

      {/* มุมมอง + ตาราง */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Segmented value={view} onChange={(v) => setView(v as ViewKey)} options={[
            { value: "list", label: L("รายการใช้", "Usage log", "明细") },
            { value: "campaign", label: L("รายแคมเปญ", "By campaign", "按活动") },
            { value: "product", label: L("ตามสินค้า", "By product", "按商品") },
          ]} />
          <span className="text-xs text-muted">{filtered.length} {L("รายการ", "records", "条")}{fCampaign ? ` · ${campById.get(fCampaign)?.name ?? ""}` : ""}</span>
        </div>

        {loading ? <p className="text-center text-sm text-muted py-8">{L("กำลังโหลด…", "Loading…", "加载中…")}</p>
          : !filtered.length ? <EmptyState icon={<Ticket size={26} />} title={L("ไม่มีการใช้คูปองในช่วงนี้", "No coupon usage", "无数据")} />
            : view === "list" ? (
              <div className="overflow-x-auto">
                <Table>
                  <thead><tr>
                    <Th>{L("วัน-เวลา", "Date-time", "时间")}</Th><Th>{L("เลขบิล", "Order", "单号")}</Th><Th>{L("แคมเปญ", "Campaign", "活动")}</Th>
                    <Th>{L("สินค้า", "Products", "商品")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("ลูกค้า", "Customer", "客户")}</Th>
                    <Th align="right">{L("ส่วนลด", "Discount", "折扣")}</Th><Th align="right">{L("ยอดสุทธิ", "Net", "净额")}</Th>
                  </tr></thead>
                  <tbody>
                    {filtered.slice(0, 300).map((u) => (
                      <tr key={u.id}>
                        <Td className="text-xs whitespace-nowrap">{dtDate(u.at)} <span className="text-muted">{dtTime(u.at)}</span></Td>
                        <Td className="font-mono text-[11px] text-muted">{u.order_no}</Td>
                        <Td className="text-xs"><span className="inline-flex items-center gap-1.5">{u.promo_type === "gift" ? <Gift size={11} className="text-ink" /> : <Ticket size={11} className="text-ink" />} {u.campaign_name} <Badge tone="neutral">{u.code}</Badge></span></Td>
                        <Td className="text-xs"><span className="block max-w-[220px] truncate" title={u.products.map((p) => `${p.name}×${p.qty}`).join(", ")}>{u.products.map((p) => `${p.name}×${p.qty}`).join(", ") || "—"}</span></Td>
                        <Td className="text-xs text-muted">{u.branch_name}</Td>
                        <Td className="text-xs text-muted">{u.customer_name ?? "—"}</Td>
                        <Td align="right" className="tnum text-danger font-medium">-{formatTHB(u.discount, false)}</Td>
                        <Td align="right" className="tnum">{formatTHB(u.bill_total, false)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : view === "campaign" ? (
              <div className="overflow-x-auto">
                <Table>
                  <thead><tr><Th>{L("แคมเปญ", "Campaign", "活动")}</Th><Th align="right">{L("จำนวนใช้", "Uses", "次数")}</Th><Th align="right">{L("ส่วนลดรวม", "Discount", "总折扣")}</Th><Th align="right">{L("ยอดบิลรวม", "Bill total", "总额")}</Th></tr></thead>
                  <tbody>{byCampaign.map((c) => (
                    <tr key={c.name}><Td className="text-sm font-medium">{c.name}</Td><Td align="right" className="tnum">{c.count}</Td><Td align="right" className="tnum text-danger font-medium">-{formatTHB(c.discount, false)}</Td><Td align="right" className="tnum">{formatTHB(c.bill, false)}</Td></tr>
                  ))}</tbody>
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
      <Drawer open={filterOpen} onClose={() => setFilterOpen(false)} title={L("ตัวกรองละเอียด", "Detailed filters", "筛选")} subtitle={L("กรองแล้วใช้กับทั้งหน้า + ไฟล์ Excel", "Applies to screen + Excel", "应用于页面与Excel")} width="md">
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
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("แคมเปญ", "Campaign", "活动")}</p>
            <Select value={fCampaign} onChange={(e) => setFCampaign(e.target.value)} className="h-10 w-full"><option value="">{L("ทุกแคมเปญ", "All campaigns", "全部")}</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">{L("สาขา", "Branch", "门店")}</p>
            <Select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="h-10 w-full"><option value="">{L("ทุกสาขา", "All branches", "全部")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name_th || b.name}</option>)}</Select>
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
            <Button variant="ghost" className="flex-1" onClick={() => { setFCampaign(""); setFBranch(""); setFProduct(""); setFMinDiscount(""); setFFrom(ago(90)); setFTo(todayISO); }}><X size={15} /> {L("ล้างตัวกรอง", "Clear", "清除")}</Button>
            <Button variant="primary" className="flex-1" onClick={() => setFilterOpen(false)}><Check size={15} /> {L(`ใช้ (${filtered.length})`, `Apply (${filtered.length})`, `应用 (${filtered.length})`)}</Button>
          </div>
          <Button variant="soft" className="w-full" onClick={exportXls}><Download size={15} /> {L("ดาวน์โหลด Excel ตามตัวกรองนี้", "Download Excel (filtered)", "导出Excel")}</Button>
        </div>
      </Drawer>
    </div>
  );
}
