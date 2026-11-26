"use client";
// สินค้าและราคา — ราคาหลัก (List price) + ราคาช่วงเวลา (Period price) + ค่าคอมมิชชัน
//   • ราคาหลัก: ดึงจากคลังกลาง เป็นฐานเสมอ · แก้ได้เฉพาะสิทธิ์ price.list (หัวหน้าแบรนด์/เจ้าของ) ในแบรนด์ของตัวเอง
//   • ราคาช่วงเวลา: ทับราคาหลักตามช่วงวัน/สาขา · ตั้งเป็นราคา/ลดบาท/ลด% → ระบบคิดอีก 2 ค่า + ปัดเศษ · หน้าร้านใช้อัตโนมัติ
//   • ค่าคอม: ผูกสินค้า/หมวด/แบรนด์ + ขั้นยอดขาย + สาขาที่มีสิทธิ์
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Package, Search, Tag, CalendarRange, Plus, Pencil, Pause, Play, X, Copy, ChevronLeft, ChevronRight, AlertTriangle, Coins, Store, Layers, Boxes, CheckCircle2, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { isLiveMode } from "@/lib/supabase/client";
import { ProductsLegacy } from "@/components/admin/products-legacy";
import { ProductReviewDrawer } from "@/components/admin/product-review-drawer";
import { CommissionTab } from "@/components/admin/commission-tab";
import { Badge, Button, Drawer, EmptyState, Field, Input, Modal, Segmented, Select, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { formatTHB, formatInt } from "@/lib/money";
import { PRICE_TYPE, ROUNDING, bkkEndExclusive, bkkStart, describeRule, ruleValue, toBkkYmd, type PriceMode, type PriceRule, type PriceScope, type PriceType, type Rounding } from "@/lib/pricing/rules";

type P = { id: string; sku: string; name_th: string; name_en: string | null; brand_id: string | null; category_id: string | null; price: number; cost: number | null; is_active: boolean; track_serial: boolean; image_url: string | null;
  current_price: number; rule_id: string | null; rule_name: string | null; price_type: string | null; rule_ends_at: string | null; branch_rules: number };
type Ref = { id: string; name: string };
type BranchRef = { id: string; code: string; name: string; name_th: string | null; brand_id: string | null };
type Data = { products: P[]; brands: Ref[]; categories: Ref[]; branches: BranchRef[]; perms: { list: boolean; period: boolean; cost: boolean; review: boolean; commission: boolean; commission_view: boolean } };
type Tab = "products" | "prices" | "commission";
const baht = (n: number) => formatTHB(n, false);
const pct = (list: number, price: number) => (list > 0 ? Math.round(((list - price) / list) * 1000) / 10 : 0);

export default function ProductsPage() {
  return <Suspense fallback={null}><ProductsInner /></Suspense>;
}

function ProductsInner() {
  if (typeof window !== "undefined" && !isLiveMode()) return <ProductsLegacy />;
  return <ProductsLive />;
}

function ProductsLive() {
  const { L, locale } = useI18n();
  const sp = useSearchParams(), router = useRouter();
  const tab = (sp.get("tab") as Tab) || "products";
  const setTab = (t: Tab) => { const u = new URLSearchParams(sp.toString()); u.set("tab", t); router.replace(`/admin/products?${u}`, { scroll: false }); };
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { const r = await fetch("/api/admin/pricing?view=products", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const [ruleDraft, setRuleDraft] = useState<Partial<PriceRule> | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [listEdit, setListEdit] = useState<P | null>(null);

  const kpi = useMemo(() => {
    const p = data?.products ?? [];
    return { all: p.length, active: p.filter((x) => x.is_active).length, noPrice: p.filter((x) => Number(x.price) <= 0).length, special: p.filter((x) => x.rule_id).length };
  }, [data]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Package size={19} className="text-muted" />{L("สินค้าและราคา", "Products & pricing", "商品与价格")}</h1>
          <p className="text-[12.5px] text-muted mt-0.5">{L("ราคาหลักจากคลังกลางเป็นฐาน · ราคาช่วงเวลาทับราคาหลักตามวันที่และสาขา หน้าร้านใช้ให้อัตโนมัติ", "List price from the central warehouse is the base · period prices override it by date and branch, applied automatically at POS", "以中央仓标价为基准 · 时段价格按日期和门店覆盖标价，门店自动使用")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void load()} title={L("รีเฟรช", "Refresh", "刷新")}><RefreshCw size={15} /></Button>
          {data?.perms.period ? <Button variant="primary" onClick={() => setRuleDraft({})}><Plus size={15} />{L("ตั้งราคาช่วงเวลา", "New period price", "新建时段价格")}</Button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Boxes size={16} />} tint="bg-lavender/25" label={L("สินค้าทั้งหมด", "Products", "商品总数")} value={formatInt(kpi.all)} />
        <Kpi icon={<CheckCircle2 size={16} />} tint="bg-mint/45" label={L("เปิดขาย", "On sale", "在售")} value={formatInt(kpi.active)} sub={kpi.all - kpi.active ? L(`ปิดขาย ${kpi.all - kpi.active}`, `${kpi.all - kpi.active} off sale`, `未上架 ${kpi.all - kpi.active}`) : undefined} />
        <Kpi icon={<AlertTriangle size={16} />} tint="bg-peach/45" label={L("รอตั้งราคา", "Missing price", "待定价")} value={formatInt(kpi.noPrice)} />
        <Kpi icon={<Tag size={16} />} tint="bg-coral/20" label={L("ใช้ราคาช่วงเวลาอยู่", "On period price now", "正在使用时段价")} value={formatInt(kpi.special)} />
      </div>

      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { value: "products", label: <span className="inline-flex items-center gap-1.5"><Package size={14} />{L("สินค้า", "Products", "商品")}</span> },
        { value: "prices", label: <span className="inline-flex items-center gap-1.5"><CalendarRange size={14} />{L("ราคาช่วงเวลา", "Period prices", "时段价格")}</span> },
        ...(data?.perms.commission || data?.perms.commission_view ? [{ value: "commission" as Tab, label: <span className="inline-flex items-center gap-1.5"><Coins size={14} />{L("ค่าคอมมิชชัน", "Commission", "佣金")}</span> }] : []),
      ]} />

      {err ? <p className="rounded-xl bg-danger/8 text-danger text-sm px-4 py-2.5">{err}</p> : null}
      {!data && !err ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : null}
      {data && tab === "products" ? <ProductsTab data={data} onRule={(ids) => setRuleDraft({ scope: "sku", product_ids: ids })} onReview={setReviewId} onListPrice={setListEdit} /> : null}
      {data && tab === "prices" ? <PeriodTab data={data} onEdit={(r) => setRuleDraft(r)} onChanged={load} /> : null}
      {data && tab === "commission" ? <CommissionTab products={data.products} brands={data.brands} categories={data.categories} branches={data.branches} canManage={data.perms.commission} /> : null}

      {ruleDraft && data ? <PriceRuleDrawer data={data} initial={ruleDraft} onClose={() => setRuleDraft(null)} onSaved={() => { setRuleDraft(null); void load(); toast.push({ tone: "ok", title: L("บันทึกราคาช่วงเวลาแล้ว — หน้าร้านจะใช้ราคานี้ตามช่วงที่ตั้ง", "Period price saved — POS will apply it in the set window", "时段价格已保存 — 门店将在设定期间自动使用") }); }} /> : null}
      {listEdit ? <ListPriceModal p={listEdit} onClose={() => setListEdit(null)} onSaved={() => { setListEdit(null); void load(); }} /> : null}
      <ProductReviewDrawer id={reviewId} onClose={() => { setReviewId(null); void load(); }} />
      <span className="hidden">{locale}</span>
    </div>
  );
}

function Kpi({ icon, tint, label, value, sub }: { icon: React.ReactNode; tint: string; label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${tint}`}>{icon}</span>
      <div className="min-w-0"><p className="text-[11px] text-muted truncate">{label}</p><p className="text-lg font-semibold tnum leading-tight">{value}{sub ? <span className="ml-1.5 text-[11px] font-normal text-muted">{sub}</span> : null}</p></div>
    </div>
  );
}

// ═════════════ แท็บสินค้า ═════════════
function ProductsTab({ data, onRule, onReview, onListPrice }: { data: Data; onRule: (ids: string[]) => void; onReview: (id: string) => void; onListPrice: (p: P) => void }) {
  const { L, locale } = useI18n();
  const [q, setQ] = useState(""), [brand, setBrand] = useState(""), [cat, setCat] = useState(""), [status, setStatus] = useState<"all" | "on" | "off" | "noprice" | "special">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { const qq = new URLSearchParams(window.location.search).get("q"); if (qq) setQ(qq); }, []);
  const bn = useMemo(() => new Map(data.brands.map((b) => [b.id, b.name])), [data.brands]);
  const cn = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.products.filter((p) => (!brand || p.brand_id === brand) && (!cat || p.category_id === cat)
      && (status === "all" || (status === "on" ? p.is_active : status === "off" ? !p.is_active : status === "noprice" ? Number(p.price) <= 0 : !!p.rule_id))
      && (!t || p.sku.toLowerCase().includes(t) || p.name_th.toLowerCase().includes(t) || (p.name_en ?? "").toLowerCase().includes(t)));
  }, [data.products, q, brand, cat, status]);
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const dt = (iso: string) => new Date(iso).toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "numeric", month: "short" });
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <div className="relative w-full sm:w-64"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อสินค้า", "Search SKU / name", "搜索 SKU / 名称")} className="pl-9 h-9" /></div>
        <Select value={brand} onChange={(e) => setBrand(e.target.value)} className="h-9 w-auto"><option value="">{L("ทุกแบรนด์", "All brands", "全部品牌")}</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 w-auto"><option value="">{L("ทุกหมวด", "All categories", "全部类别")}</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Segmented size="sm" value={status} onChange={setStatus} options={[
          { value: "all", label: L("ทั้งหมด", "All", "全部") }, { value: "on", label: L("เปิดขาย", "On sale", "在售") }, { value: "off", label: L("ปิดขาย", "Off", "未上架") },
          { value: "noprice", label: L("รอตั้งราคา", "No price", "待定价") }, { value: "special", label: L("ราคาช่วงเวลา", "Period price", "时段价") },
        ]} />
        {sel.size && data.perms.period ? <Button variant="primary" className="ml-auto h-9" onClick={() => onRule([...sel])}><Tag size={14} />{L(`ตั้งราคาช่วงเวลา ${sel.size} รายการ`, `Set period price for ${sel.size}`, `为 ${sel.size} 项设置时段价`)}</Button> : null}
      </div>
      {rows.length ? (
        <div className="overflow-auto max-h-[68vh]">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-surface2 text-[11px] text-muted">
              <tr>
                {data.perms.period ? <th className="border-b border-line pl-4 pr-1 py-2 w-8"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} className="accent-[rgb(var(--c-brand))]" /></th> : null}
                <th className="border-b border-line text-left font-medium px-2 py-2">{L("สินค้า", "Product", "商品")}</th>
                <th className="border-b border-line text-left font-medium px-2 py-2">{L("แบรนด์ / หมวด", "Brand / category", "品牌 / 类别")}</th>
                <th className="border-b border-line text-right font-medium px-2 py-2">{L("ราคาหลัก", "List price", "标价")}</th>
                <th className="border-b border-line text-right font-medium px-2 py-2">{L("ราคาขายตอนนี้", "Selling now", "当前售价")}</th>
                {data.perms.cost ? <th className="border-b border-line text-right font-medium px-2 py-2">{L("ต้นทุน / GP", "Cost / GP", "成本 / 毛利")}</th> : null}
                <th className="border-b border-line text-center font-medium px-2 py-2">{L("สถานะ", "Status", "状态")}</th>
                <th className="border-b border-line px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const special = p.rule_id && p.current_price !== Number(p.price);
                const gp = data.perms.cost && p.cost != null && p.current_price > 0 ? Math.round(((p.current_price / 1.07 - p.cost) / (p.current_price / 1.07)) * 1000) / 10 : null;
                return (
                  <tr key={p.id} className={`hover:bg-brand/[0.035] ${sel.has(p.id) ? "bg-brand/[0.05]" : ""}`}>
                    {data.perms.period ? <td className="border-b border-line/70 pl-4 pr-1 py-2"><input type="checkbox" checked={sel.has(p.id)} onChange={() => { const s = new Set(sel); if (s.has(p.id)) s.delete(p.id); else s.add(p.id); setSel(s); }} className="accent-[rgb(var(--c-brand))]" /></td> : null}
                    <td className="border-b border-line/70 px-2 py-2">
                      <div className="flex items-center gap-2.5 min-w-[220px]">
                        <span className="w-9 h-9 rounded-lg bg-surface2 overflow-hidden grid place-items-center shrink-0">{p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package size={15} className="text-muted/50" />}</span>
                        <span className="min-w-0" translate="no"><span className="block font-medium truncate max-w-[260px]">{p.name_th}</span><span className="block font-mono text-[10.5px] text-muted">{p.sku}{p.track_serial ? " · SN" : ""}</span></span>
                      </div>
                    </td>
                    <td className="border-b border-line/70 px-2 py-2 text-muted"><span translate="no">{(p.brand_id && bnName(bn, p.brand_id)) || "—"}</span><span className="block text-[10.5px]">{(p.category_id && cn.get(p.category_id)) || L("ไม่มีหมวด", "No category", "无类别")}</span></td>
                    <td className="border-b border-line/70 px-2 py-2 text-right tnum whitespace-nowrap">
                      {Number(p.price) > 0 ? <span className={special ? "text-muted line-through" : "font-semibold"}>{baht(Number(p.price))}</span> : <Badge tone="warn">{L("ยังไม่มีราคา", "No price", "无价格")}</Badge>}
                      {data.perms.list ? <button onClick={() => onListPrice(p)} title={L("แก้ราคาหลัก", "Edit list price", "修改标价")} className="ml-1.5 align-middle text-muted hover:text-brand"><Pencil size={12} /></button> : null}
                    </td>
                    <td className="border-b border-line/70 px-2 py-2 text-right whitespace-nowrap">
                      {special ? (
                        <span title={p.rule_name ?? ""}>
                          <span className="font-semibold text-danger tnum">{baht(p.current_price)}</span>
                          <span className="ml-1 text-[10.5px] text-danger tnum">−{pct(Number(p.price), p.current_price)}%</span>
                          <span className={`block mt-0.5 text-[10px] px-1.5 py-px rounded inline-block ${PRICE_TYPE()[(p.price_type ?? "other") as PriceType]?.cls ?? ""}`}>{PRICE_TYPE()[(p.price_type ?? "other") as PriceType]?.label}{p.rule_ends_at ? ` · ${L("ถึง", "until", "至")} ${dt(new Date(new Date(p.rule_ends_at).getTime() - 1).toISOString())}` : ""}</span>
                        </span>
                      ) : <span className="text-muted">{L("ราคาหลัก", "List price", "标价")}</span>}
                      {p.branch_rules ? <span className="block text-[10px] text-muted mt-0.5">+ {L(`ราคาเฉพาะสาขา ${p.branch_rules} กฎ`, `${p.branch_rules} branch-only rule(s)`, `${p.branch_rules} 条门店专属价`)}</span> : null}
                    </td>
                    {data.perms.cost ? <td className="border-b border-line/70 px-2 py-2 text-right tnum whitespace-nowrap">{p.cost != null ? baht(p.cost) : "—"}{gp != null ? <span className={`block text-[10.5px] ${gp < 0 ? "text-danger" : gp < 10 ? "text-warn" : "text-ok"}`}>GP {gp}%</span> : null}</td> : null}
                    <td className="border-b border-line/70 px-2 py-2 text-center">{p.is_active ? <Badge tone="ok">{L("เปิดขาย", "On sale", "在售")}</Badge> : <Badge tone="neutral">{L("ปิดขาย", "Off sale", "未上架")}</Badge>}</td>
                    <td className="border-b border-line/70 px-3 py-2 text-right whitespace-nowrap">
                      {data.perms.period ? <button onClick={() => onRule([p.id])} className="h-7 px-2 rounded-lg border border-line text-[11px] inline-flex items-center gap-1 hover:border-brand/50 hover:text-brand"><Tag size={12} />{L("ราคาช่วงเวลา", "Period price", "时段价")}</button> : null}
                      {data.perms.review ? <button onClick={() => onReview(p.id)} className="ml-1 h-7 px-2 rounded-lg border border-line text-[11px] inline-flex items-center gap-1 hover:border-brand/50 hover:text-brand"><ShieldCheck size={12} />{L("ตรวจ/เปิดขาย", "Review", "审核")}</button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={<Package size={26} />} title={L("ไม่พบสินค้า", "No products", "没有商品")} body={L("ลองเปลี่ยนตัวกรองหรือคำค้นหา", "Try different filters", "请调整筛选条件")} />}
      <div className="px-4 py-2 border-t border-line text-[11px] text-muted">{formatInt(rows.length)} / {formatInt(data.products.length)} {L("รายการ", "items", "项")} · {L("ราคาขายตอนนี้ = ราคาที่ใช้ทุกสาขา (ราคาเฉพาะบางสาขาแสดงเป็นจำนวนกฎ)", "Selling now = price for all branches (branch-only rules shown as a count)", "当前售价 = 所有门店通用价格")}</div>
    </div>
  );
}
const bnName = (m: Map<string, string>, id: string) => m.get(id);

// ═════════════ แท็บราคาช่วงเวลา ═════════════
function PeriodTab({ data, onEdit, onChanged }: { data: Data; onEdit: (r: Partial<PriceRule>) => void; onChanged: () => void }) {
  const { L, locale } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(Date.now() + 7 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; });
  const [rules, setRules] = useState<PriceRule[] | null>(null), [names, setNames] = useState<Record<string, string>>({});
  const range = useMemo(() => { const [y, m] = month.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: bkkStart(`${month}-01`), to: bkkEndExclusive(`${month}-${String(last).padStart(2, "0")}`) }; }, [month]);
  const load = useCallback(async () => {
    setRules(null);
    const r = await fetch(`/api/admin/pricing?view=rules&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { cache: "no-store" });
    const j = await r.json(); if (!r.ok) { toast.push({ tone: "danger", title: j.error }); setRules([]); return; }
    setRules(j.rules); setNames(j.names);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const shift = (d: number) => { const [y, m] = month.split("-").map(Number); const n = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(`${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`); };
  const monthLabel = new Date(`${month}-15T00:00:00Z`).toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { month: "long", year: "numeric" });
  const now = Date.now();
  const phase = (r: PriceRule) => r.status === "paused" ? "paused" : Date.parse(r.ends_at) <= now ? "ended" : Date.parse(r.starts_at) > now ? "upcoming" : "live";
  const PH: Record<string, [string, "ok" | "info" | "neutral" | "warn"]> = { live: [L("กำลังใช้", "Live", "生效中"), "ok"], upcoming: [L("รอเริ่ม", "Upcoming", "待开始"), "info"], ended: [L("หมดแล้ว", "Ended", "已结束"), "neutral"], paused: [L("หยุดชั่วคราว", "Paused", "已暂停"), "warn"] };
  const bn = new Map(data.brands.map((b) => [b.id, b.name])), cn = new Map(data.categories.map((c) => [c.id, c.name])), pn = new Map(data.products.map((p) => [p.id, p]));
  const dt = (iso: string, end = false) => new Date(toBkkYmd(iso, end) + "T00:00:00").toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "numeric", month: "short" });
  async function setStatus(r: PriceRule, status: PriceRule["status"]) {
    const res = await fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_rule", rule: { ...r, status } }) });
    const j = await res.json(); if (!res.ok) { toast.push({ tone: "danger", title: j.error }); return; }
    toast.push({ tone: "ok", title: status === "active" ? L("เปิดใช้ราคาแล้ว", "Price resumed", "价格已恢复") : status === "paused" ? L("หยุดราคาชั่วคราว — หน้าร้านกลับไปใช้ราคาหลัก", "Paused — POS uses list price", "已暂停 — 门店恢复标价") : L("ยกเลิกแล้ว", "Cancelled", "已取消") });
    void load(); onChanged();
  }
  function duplicateNextMonth(r: PriceRule) {
    const s = new Date(r.starts_at), e = new Date(r.ends_at);
    const add = (d: Date) => { const n = new Date(d); n.setUTCMonth(n.getUTCMonth() + 1); return n.toISOString(); };
    onEdit({ ...r, id: undefined, version: undefined, status: "active", name: `${r.name} (${L("ต่อ", "next", "续")})`, starts_at: add(s), ends_at: add(e) });
  }
  const groups = (["live", "upcoming", "paused", "ended"] as const).map((k) => [k, (rules ?? []).filter((r) => phase(r) === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-3">
      <div className="card px-4 py-3 flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className="h-8 w-8 grid place-items-center rounded-lg border border-line hover:bg-surface2"><ChevronLeft size={15} /></button>
        <span className="text-sm font-semibold min-w-[140px] text-center">{monthLabel}</span>
        <button onClick={() => shift(1)} className="h-8 w-8 grid place-items-center rounded-lg border border-line hover:bg-surface2"><ChevronRight size={15} /></button>
        <span className="text-[11.5px] text-muted ml-2">{L("กฎราคาที่มีผลในเดือนนี้ · กฎที่เจาะจงกว่าชนะ (SKU > หมวด > ทั้งแบรนด์)", "Rules active in this month · more specific wins (SKU > category > brand)", "本月生效的价格规则 · 越具体优先（SKU > 类别 > 品牌）")}</span>
      </div>
      {rules === null ? <Skeleton className="h-24" /> : !rules.length ? (
        <div className="card"><EmptyState icon={<CalendarRange size={26} />} title={L("เดือนนี้ยังไม่มีราคาช่วงเวลา", "No period prices this month", "本月暂无时段价格")} body={L("ทุกสินค้าขายตามราคาหลัก", "All products sell at list price", "所有商品按标价销售")} /></div>
      ) : groups.map(([k, list]) => (
        <section key={k} className="space-y-2">
          <p className="text-[11px] font-semibold text-muted px-0.5">{PH[k][0]} · {list.length}</p>
          {list.map((r) => {
            const T = PRICE_TYPE()[r.price_type];
            const target = r.scope === "sku" ? (r.product_ids.length === 1 ? pn.get(r.product_ids[0])?.sku ?? "1 SKU" : L(`${r.product_ids.length} รายการ`, `${r.product_ids.length} SKUs`, `${r.product_ids.length} 个 SKU`))
              : r.scope === "category" ? `${L("หมวด", "Category", "类别")} ${cn.get(r.category_id ?? "") ?? "?"}${r.brand_id ? ` · ${bn.get(r.brand_id) ?? ""}` : ""}` : `${L("ทั้งแบรนด์", "Whole brand", "整个品牌")} ${bn.get(r.brand_id ?? "") ?? "?"}`;
            const sample = r.scope === "sku" ? r.product_ids.slice(0, 3).map((id) => pn.get(id)).filter(Boolean) as P[] : data.products.filter((p) => r.scope === "category" ? p.category_id === r.category_id && (!r.brand_id || p.brand_id === r.brand_id) : p.brand_id === r.brand_id).slice(0, 3);
            return (
              <div key={r.id} className={`card px-4 py-3 flex flex-wrap items-start gap-3 ${k === "ended" ? "opacity-70" : ""}`}>
                <span className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${T.cls}`}><Tag size={17} /></span>
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-semibold flex flex-wrap items-center gap-1.5">{r.name}<span className={`text-[10.5px] px-1.5 py-px rounded ${T.cls}`}>{T.label}</span><Badge tone={PH[k][1]}>{PH[k][0]}</Badge></p>
                  <p className="text-[12px] mt-0.5"><b>{describeRule(r)}</b>{r.mode !== "price" ? <span className="text-muted"> · {ROUNDING()[r.rounding].split(" (")[0]}</span> : null} · <span translate="no">{target}</span></p>
                  <p className="text-[11.5px] text-muted mt-0.5">{dt(r.starts_at)} – {dt(r.ends_at, true)} · {r.branch_ids.length ? L(`${r.branch_ids.length} สาขา`, `${r.branch_ids.length} branches`, `${r.branch_ids.length} 家门店`) : L("ทุกสาขา", "All branches", "所有门店")} · {L("โดย", "by", "由")} {names[r.updated_by ?? r.created_by ?? ""] ?? "—"}</p>
                  {sample.length ? <p className="text-[11px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5" translate="no">{sample.map((p) => { const v = ruleValue(r.mode, Number(r.value), Number(p.price), r.rounding); return <span key={p.id}>{p.sku}: <span className="line-through text-muted">{baht(Number(p.price))}</span> → <b className="text-danger">{v != null ? baht(v) : "—"}</b></span>; })}</p> : null}
                </div>
                {data.perms.period ? (
                  <div className="flex items-center gap-1">
                    {k !== "ended" ? <IconBtn title={L("แก้ไข", "Edit", "编辑")} onClick={() => onEdit(r)}><Pencil size={14} /></IconBtn> : null}
                    <IconBtn title={L("ทำซ้ำเดือนถัดไป", "Duplicate to next month", "复制到下个月")} onClick={() => duplicateNextMonth(r)}><Copy size={14} /></IconBtn>
                    {k === "live" || k === "upcoming" ? <IconBtn title={L("หยุดชั่วคราว", "Pause", "暂停")} onClick={() => void setStatus(r, "paused")}><Pause size={14} /></IconBtn> : null}
                    {k === "paused" ? <IconBtn title={L("ใช้ต่อ", "Resume", "恢复")} onClick={() => void setStatus(r, "active")}><Play size={14} /></IconBtn> : null}
                    {k !== "ended" ? <IconBtn title={L("ยกเลิกกฎ", "Cancel rule", "取消规则")} onClick={() => void setStatus(r, "cancelled")}><X size={14} /></IconBtn> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button title={title} aria-label={title} onClick={onClick} className="h-8 w-8 grid place-items-center rounded-lg border border-line text-muted hover:text-brand hover:border-brand/50">{children}</button>;
}

// ═════════════ ตั้ง/แก้ราคาช่วงเวลา ═════════════
function PriceRuleDrawer({ data, initial, onClose, onSaved }: { data: Data; initial: Partial<PriceRule>; onClose: () => void; onSaved: () => void }) {
  const { L, locale } = useI18n();
  const today = toBkkYmd(new Date().toISOString());
  const monthEnd = (ymd: string) => { const [y, m] = ymd.split("-").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
  const nextMonth1 = () => { const [y, m] = today.split("-").map(Number); const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 10); };
  const first = initial.product_ids?.length ? data.products.find((p) => p.id === initial.product_ids![0]) : undefined;
  const [f, setF] = useState({
    name: initial.name ?? "", price_type: (initial.price_type ?? "monthly") as PriceType, scope: (initial.scope ?? "sku") as PriceScope,
    brand_id: initial.brand_id ?? first?.brand_id ?? data.brands[0]?.id ?? "", category_id: initial.category_id ?? "", product_ids: initial.product_ids ?? [],
    mode: (initial.mode ?? "percent") as PriceMode, value: initial.value != null ? String(initial.value) : "", rounding: (initial.rounding ?? "baht") as Rounding,
    allBranches: !(initial.branch_ids?.length), branch_ids: initial.branch_ids ?? [],
    from: initial.starts_at ? toBkkYmd(initial.starts_at) : today, to: initial.ends_at ? toBkkYmd(initial.ends_at, true) : monthEnd(today), note: initial.note ?? "",
  });
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const targets = useMemo(() => f.scope === "sku" ? data.products.filter((p) => f.product_ids.includes(p.id))
    : data.products.filter((p) => f.scope === "category" ? p.category_id === f.category_id && (!f.brand_id || p.brand_id === f.brand_id) : p.brand_id === f.brand_id), [f.scope, f.product_ids, f.category_id, f.brand_id, data.products]);
  const val = Number(f.value);
  const preview = targets.slice(0, 200).map((p) => ({ p, v: val > 0 ? ruleValue(f.mode, val, Number(p.price), f.rounding) : null }));
  const bad = preview.filter((x) => x.v == null && val > 0).length;
  const belowCost = data.perms.cost ? preview.filter((x) => x.v != null && x.p.cost != null && x.v / 1.07 < (x.p.cost ?? 0)).length : 0;
  const search = q.trim().toLowerCase();
  const pickList = search ? data.products.filter((p) => (p.sku.toLowerCase().includes(search) || p.name_th.toLowerCase().includes(search)) && !f.product_ids.includes(p.id)).slice(0, 30) : [];
  const brandBranches = data.branches.filter((b) => !f.brand_id || !b.brand_id || b.brand_id === f.brand_id);
  // ตั้งราคาเลยกับสินค้า 1 รายการ → โชว์ว่าเท่ากับลดกี่บาท/กี่ %
  const single = targets.length === 1 ? targets[0] : null;
  const valid = f.name.trim().length >= 2 && val > 0 && targets.length > 0 && f.from && f.to && f.to >= f.from && (f.mode !== "percent" || val < 100) && (f.allBranches || f.branch_ids.length > 0);
  async function save() {
    setBusy(true); setErr("");
    try {
      const rule = { id: initial.id, version: initial.version, status: initial.status ?? "active", name: f.name.trim(), price_type: f.price_type, scope: f.scope,
        brand_id: f.scope === "sku" ? (targets[0]?.brand_id ?? null) : f.brand_id || null, category_id: f.scope === "category" ? f.category_id : null, product_ids: f.scope === "sku" ? f.product_ids : [],
        mode: f.mode, value: val, rounding: f.mode === "price" ? "none" : f.rounding, branch_ids: f.allBranches ? [] : f.branch_ids,
        starts_at: bkkStart(f.from), ends_at: bkkEndExclusive(f.to), note: f.note };
      const r = await fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_rule", rule }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const fmtD = (ymd: string) => new Date(ymd + "T00:00:00").toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Drawer open onClose={onClose} width="lg" title={initial.id ? L("แก้ราคาช่วงเวลา", "Edit period price", "编辑时段价格") : L("ตั้งราคาช่วงเวลา", "New period price", "新建时段价格")}
      subtitle={L("ราคานี้ใช้แทนราคาหลักเฉพาะในช่วงวันที่และสาขาที่เลือก · หมดช่วงแล้วกลับเป็นราคาหลักเอง", "Replaces the list price only within the chosen dates and branches · reverts automatically", "仅在所选日期与门店内替代标价 · 到期自动恢复")}
      footer={<div className="flex items-center justify-between gap-2 w-full">
        <span className="text-[11.5px] text-muted">{targets.length ? L(`มีผลกับ ${targets.length} สินค้า`, `Affects ${targets.length} products`, `影响 ${targets.length} 个商品`) : ""}</span>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>{L("บันทึกราคา", "Save price", "保存价格")}</Button></div>
      </div>}>
      <div className="p-5 space-y-5 text-sm">
        <Step n={1} title={L("ชื่อและประเภทราคา", "Name & price type", "名称与价格类型")}>
          <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={L("เช่น โปรเดือน ธ.ค. 70mai", "e.g. December promo", "例如 12月促销")} />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(Object.keys(PRICE_TYPE()) as PriceType[]).map((k) => <button key={k} type="button" onClick={() => set({ price_type: k })} className={`h-8 px-3 rounded-full text-xs border ${f.price_type === k ? "border-brand bg-brand/10 text-brand font-medium" : "border-line hover:bg-surface2"}`}>{PRICE_TYPE()[k].label}</button>)}
          </div>
        </Step>

        <Step n={2} title={L("ใช้กับสินค้าไหน", "Which products", "适用商品")}>
          <Segmented<PriceScope> value={f.scope} onChange={(v) => set({ scope: v })} options={[
            { value: "sku", label: <span className="inline-flex items-center gap-1"><Package size={13} />{L("เลือกสินค้า", "Pick SKUs", "选择商品")}</span> },
            { value: "category", label: <span className="inline-flex items-center gap-1"><Layers size={13} />{L("ทั้งหมวด", "Category", "整个类别")}</span> },
            { value: "brand", label: <span className="inline-flex items-center gap-1"><Store size={13} />{L("ทั้งแบรนด์", "Whole brand", "整个品牌")}</span> },
          ]} />
          {f.scope !== "sku" ? (
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <Field label={L("แบรนด์", "Brand", "品牌")}><Select value={f.brand_id} onChange={(e) => set({ brand_id: e.target.value })}>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
              {f.scope === "category" ? <Field label={L("หมวด", "Category", "类别")}><Select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}><option value="">—</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field> : null}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อ เพื่อเพิ่ม", "Search SKU / name to add", "搜索 SKU / 名称以添加")} className="pl-9" /></div>
              {pickList.length ? <div className="max-h-40 overflow-auto rounded-xl border border-line divide-y divide-line" translate="no">{pickList.map((p) => <button key={p.id} type="button" onClick={() => { set({ product_ids: [...f.product_ids, p.id] }); setQ(""); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface2 flex justify-between"><span><span className="font-mono text-muted">{p.sku}</span> · {p.name_th}</span><span className="tnum">{baht(Number(p.price))}</span></button>)}</div> : null}
              <div className="flex flex-wrap gap-1.5" translate="no">{targets.map((p) => <span key={p.id} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-surface2 text-[11.5px]"><span className="font-mono">{p.sku}</span><button onClick={() => set({ product_ids: f.product_ids.filter((x) => x !== p.id) })} className="h-5 w-5 grid place-items-center rounded-full hover:bg-line"><X size={11} /></button></span>)}</div>
            </div>
          )}
        </Step>

        <Step n={3} title={L("ช่วงเวลา", "Period", "时段")}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Chip onClick={() => set({ from: today, to: monthEnd(today) })}>{L("ถึงสิ้นเดือนนี้", "Until month end", "至本月底")}</Chip>
            <Chip onClick={() => { const s = nextMonth1(); set({ from: s, to: monthEnd(s) }); }}>{L("ทั้งเดือนหน้า", "All next month", "整个下月")}</Chip>
            <Chip onClick={() => { const e = new Date(Date.parse(today + "T00:00:00Z") + 6 * 86400000).toISOString().slice(0, 10); set({ from: today, to: e }); }}>{L("7 วัน", "7 days", "7 天")}</Chip>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={L("เริ่ม (00:00)", "Start (00:00)", "开始 (00:00)")}><Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
            <Field label={L("ถึง (สิ้นวัน)", "End (end of day)", "结束（当日结束）")}><Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          </div>
          <p className="text-[11px] text-muted mt-1">{fmtD(f.from)} 00:00 – {fmtD(f.to)} 23:59 ({L("เวลาไทย", "Bangkok time", "曼谷时间")})</p>
        </Step>

        <Step n={4} title={L("สาขาที่ใช้ราคานี้", "Branches", "适用门店")}>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.allBranches} onChange={(e) => set({ allBranches: e.target.checked })} className="accent-[rgb(var(--c-brand))]" />{L("ทุกสาขา", "All branches", "所有门店")}</label>
          {!f.allBranches ? <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-line p-1.5 grid sm:grid-cols-2 gap-0.5">{brandBranches.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded-lg hover:bg-surface2"><input type="checkbox" checked={f.branch_ids.includes(b.id)} onChange={(e) => set({ branch_ids: e.target.checked ? [...f.branch_ids, b.id] : f.branch_ids.filter((x) => x !== b.id) })} className="accent-[rgb(var(--c-brand))]" /><span className="truncate">{b.name_th ?? b.name}</span></label>
          ))}</div> : null}
        </Step>

        <Step n={5} title={L("ราคา", "Price", "价格")}>
          <Segmented<PriceMode> value={f.mode} onChange={(v) => set({ mode: v, value: "" })} options={[
            { value: "percent", label: L("ลดเป็น %", "% off", "按%减") }, { value: "amount", label: L("ลดเป็นบาท", "Baht off", "按金额减") }, { value: "price", label: L("ตั้งราคาเลย", "Set price", "直接定价") },
          ]} />
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <Field label={f.mode === "percent" ? L("ลดกี่ %", "Percent off", "折扣 %") : f.mode === "amount" ? L("ลดกี่บาท", "Baht off", "减多少元") : L("ราคาขาย (รวม VAT)", "Selling price (incl. VAT)", "售价（含税）")}>
              <Input inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value.replace(/[^\d.]/g, "") })} className="tnum text-base font-semibold" />
            </Field>
            {f.mode !== "price" ? <Field label={L("ปัดเศษ", "Rounding", "取整")}><Select value={f.rounding} onChange={(e) => set({ rounding: e.target.value as Rounding })}>{(Object.keys(ROUNDING()) as Rounding[]).map((k) => <option key={k} value={k}>{ROUNDING()[k]}</option>)}</Select></Field> : null}
          </div>
          {single && val > 0 ? (() => { const v = ruleValue(f.mode, val, Number(single.price), f.rounding); return v != null ? (
            <div className="mt-2 rounded-xl bg-brand/5 border border-brand/25 px-3 py-2 text-[12.5px] tnum">
              {L("ราคาหลัก", "List", "标价")} {baht(Number(single.price))} → <b className="text-danger text-sm">{baht(v)}</b> = {L("ลด", "off", "减")} <b>{baht(Number(single.price) - v)}</b> {L("บาท", "THB", "元")} (<b>{pct(Number(single.price), v)}%</b>)
            </div>) : null; })() : null}
          {bad ? <p className="mt-2 text-[12px] text-danger">{L(`${bad} สินค้าราคาจะติดลบ/เป็นศูนย์ — ระบบจะข้ามและขายราคาหลักแทน`, `${bad} product(s) would go to zero/negative — they keep the list price`, `${bad} 个商品价格将≤0 — 将保持标价`)}</p> : null}
          {belowCost ? <p className="mt-1 text-[12px] text-warn flex items-center gap-1"><AlertTriangle size={13} />{L(`${belowCost} สินค้าราคาต่ำกว่าต้นทุน`, `${belowCost} product(s) below cost`, `${belowCost} 个商品低于成本`)}</p> : null}
        </Step>

        {preview.length && val > 0 ? (
          <div className="rounded-xl border border-line overflow-hidden">
            <p className="px-3 py-2 text-[11.5px] font-semibold bg-surface2">{L("ตัวอย่างราคาที่หน้าร้านจะเห็น", "Preview at POS", "门店价格预览")}{targets.length > 200 ? ` (200/${targets.length})` : ""}</p>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-[10.5px] text-muted"><tr><th className="text-left font-medium px-3 py-1.5">SKU</th><th className="text-right font-medium px-2 py-1.5">{L("ราคาหลัก", "List", "标价")}</th><th className="text-right font-medium px-2 py-1.5">{L("ราคาใหม่", "New", "新价")}</th><th className="text-right font-medium px-2 py-1.5">{L("ลด", "Off", "减")}</th>{data.perms.cost ? <th className="text-right font-medium px-3 py-1.5">GP</th> : null}</tr></thead>
                <tbody className="divide-y divide-line/60" translate="no">
                  {preview.map(({ p, v }) => { const gp = data.perms.cost && v != null && p.cost != null ? Math.round(((v / 1.07 - p.cost) / (v / 1.07)) * 1000) / 10 : null; return (
                    <tr key={p.id}><td className="px-3 py-1.5"><span className="font-mono">{p.sku}</span><span className="block text-[10.5px] text-muted truncate max-w-[200px]">{p.name_th}</span></td>
                      <td className="px-2 py-1.5 text-right tnum text-muted">{baht(Number(p.price))}</td>
                      <td className={`px-2 py-1.5 text-right tnum font-semibold ${v == null ? "text-muted" : "text-danger"}`}>{v != null ? baht(v) : L("ข้าม", "skip", "跳过")}</td>
                      <td className="px-2 py-1.5 text-right tnum">{v != null ? `${pct(Number(p.price), v)}%` : "—"}</td>
                      {data.perms.cost ? <td className={`px-3 py-1.5 text-right tnum ${gp == null ? "" : gp < 0 ? "text-danger" : gp < 10 ? "text-warn" : "text-ok"}`}>{gp != null ? `${gp}%` : "—"}</td> : null}</tr>); })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <Field label={L("หมายเหตุ (ไม่บังคับ)", "Note (optional)", "备注（可选）")}><Input value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        {err ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <section><p className="text-[13px] font-semibold mb-2 flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-brand text-brandInk text-[11px] grid place-items-center">{n}</span>{title}</p>{children}</section>;
}
function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="h-7 px-2.5 rounded-full border border-line text-[11.5px] hover:border-brand/50 hover:text-brand">{children}</button>;
}

// ═════════════ แก้ราคาหลัก ═════════════
function ListPriceModal({ p, onClose, onSaved }: { p: P; onClose: () => void; onSaved: () => void }) {
  const { L } = useI18n();
  const toast = useToast();
  const [price, setPrice] = useState(String(p.price || "")), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const r = await fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_list_price", product_id: p.id, price: Number(price), reason }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error); return; }
    toast.push({ tone: "ok", title: L("เปลี่ยนราคาหลักแล้ว", "List price updated", "标价已更新"), body: `${p.sku}: ${baht(Number(p.price))} → ${baht(Number(price))}` });
    onSaved();
  }
  return (
    <Modal open onClose={onClose} size="sm" title={<span translate="no">{L("ราคาหลัก", "List price", "标价")} · {p.sku}</span>}
      footer={<><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!(Number(price) > 0) || reason.trim().length < 3} onClick={() => void save()}>{L("บันทึก", "Save", "保存")}</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">{L("ราคาหลักคือราคาตั้งต้นที่หน้าร้านใช้เมื่อไม่มีราคาช่วงเวลา · ราคาช่วงเวลาแบบลด % / ลดบาท จะคิดจากราคาหลักใหม่ทันที", "The list price is used when no period price applies · %/baht-off period prices recalculate from it immediately", "无时段价时门店使用标价 · 按%/金额减的时段价会立即按新标价重算")}</p>
        <Field label={L("ราคาหลัก (รวม VAT)", "List price (incl. VAT)", "标价（含税）")}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className="tnum text-base font-semibold" autoFocus /></Field>
        <Field label={L("เหตุผล (บังคับ · เก็บในประวัติ)", "Reason (required · kept in history)", "原因（必填 · 记录在历史中）")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {p.cost != null && Number(price) > 0 ? <p className="text-[11.5px] text-muted tnum">GP {Math.round(((Number(price) / 1.07 - p.cost) / (Number(price) / 1.07)) * 1000) / 10}% ({L("ต้นทุน", "cost", "成本")} {baht(p.cost)})</p> : null}
        {err ? <p role="alert" className="text-[12.5px] text-danger">{err}</p> : null}
      </div>
    </Modal>
  );
}
