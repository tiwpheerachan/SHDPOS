"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, Check, X, Bookmark, Save, Trash2, Calendar, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listBranches, listBrands, listEmployees, listCategories, listProducts, listTerminals } from "@/lib/data/repo";
import type { Branch, Brand, Category, Employee, Product, Terminal } from "@/lib/types";
import { visibleBranchIds } from "@/lib/permissions";
import { Segmented, Button, Modal, Input } from "@/components/ui";

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "mtd" | "ytd" | "custom";

export interface AdminFilter {
  range: RangeKey;
  from: Date;
  to: Date;
  brandIds: string[];
  branchIds: string[];
  provinces: string[];
  storeTypes: string[];
  salespersonIds: string[];
  cashierIds: string[];
  categoryIds: string[];
  skus: string[];
  paymentMethods: string[];
  channels: string[];
  orderStatuses: string[];
  customerTypes: string[];
  posIds: string[];
  flags: string[];
}

type ArrayKey =
  | "brandIds" | "branchIds" | "provinces" | "storeTypes" | "salespersonIds" | "cashierIds"
  | "categoryIds" | "skus" | "paymentMethods" | "channels" | "orderStatuses" | "customerTypes"
  | "posIds" | "flags";

const EMPTY: Omit<AdminFilter, "range" | "from" | "to"> = {
  brandIds: [], branchIds: [], provinces: [], storeTypes: [], salespersonIds: [], cashierIds: [],
  categoryIds: [], skus: [], paymentMethods: [], channels: [], orderStatuses: [], customerTypes: [],
  posIds: [], flags: [],
};

export function rangeToDates(range: RangeKey, prev?: { from: Date; to: Date }): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  switch (range) {
    case "today": from.setHours(0, 0, 0, 0); break;
    case "yesterday": {
      from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
      const t = new Date(from); t.setHours(23, 59, 59, 999); return { from, to: t };
    }
    case "7d": from.setDate(to.getDate() - 7); break;
    case "30d": from.setDate(to.getDate() - 30); break;
    case "mtd": from.setDate(1); from.setHours(0, 0, 0, 0); break;
    case "ytd": from.setMonth(0, 1); from.setHours(0, 0, 0, 0); break;
    case "custom": return prev ?? { from, to };
  }
  return { from, to };
}

/** ตัวกรองที่จำกัดตามสิทธิ์ของผู้ใช้ */
export function useAdminScope() {
  const { employee } = useSession();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  useEffect(() => {
    void (async () => {
      const [b, br] = await Promise.all([listBranches(), listBrands()]);
      setBranches(b);
      setBrands(br);
    })();
  }, []);

  const allowedBranches = useMemo(() => {
    if (!employee) return [];
    const ids = new Set(visibleBranchIds(employee, branches.map((b) => b.id)));
    return branches.filter((b) => ids.has(b.id) && b.branch_type !== "warehouse");
  }, [branches, employee]);

  const allowedBrands = useMemo(() => {
    if (!employee) return [];
    if (employee.data_scope === "company") return brands;
    if (employee.brand_ids.length) return brands.filter((b) => employee.brand_ids.includes(b.id));
    const ids = new Set(allowedBranches.map((b) => b.brand_id));
    return brands.filter((b) => ids.has(b.id));
  }, [brands, employee, allowedBranches]);

  return { branches: allowedBranches, brands: allowedBrands, allBranches: branches };
}

// ---------------------------------------------------------------------
type Opt = { value: string; label: string };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function FilterBar({
  value,
  onChange,
  branches,
  brands,
}: {
  value: AdminFilter;
  onChange: (f: AdminFilter) => void;
  branches: Branch[];
  brands: Brand[];
}) {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const [open, setOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);

  useEffect(() => {
    void (async () => {
      const [e, c, p, tm] = await Promise.all([listEmployees(), listCategories(), listProducts(), listTerminals()]);
      setEmployees(e); setCategories(c); setProducts(p); setTerminals(tm);
    })();
  }, []);

  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const pk = (o: { name_th?: string | null; name_en?: string | null; name_zh?: string | null; name?: string }) =>
    locale === "th" ? o.name_th ?? o.name ?? "" : locale === "zh" ? o.name_zh ?? o.name ?? "" : o.name_en ?? o.name ?? "";

  // ----- option lists -----
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, `${e.nickname ?? e.first_name} · ${e.employee_code}`])), [employees]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, pk(c)])), [categories, locale]);
  const prodName = useMemo(() => new Map(products.map((p) => [p.sku, `${p.sku} · ${locale === "th" ? p.name_th : p.name_en ?? p.name_th}`])), [products, locale]);
  const termName = useMemo(() => new Map(terminals.map((tm) => [tm.id, tm.name ?? tm.code])), [terminals]);

  const opt = {
    brand: brands.map((b) => ({ value: b.id, label: locale === "zh" ? b.name_zh ?? b.name : b.name })),
    branch: branches.map((b) => ({ value: b.id, label: branchName.get(b.id) ?? b.id })),
    province: Array.from(new Set(branches.map((b) => b.province).filter(Boolean))).map((p) => ({ value: p as string, label: p as string })),
    storeType: [
      { value: "brand_shop", label: L("ร้านสาขา", "Brand Shop", "品牌店") },
      { value: "vending", label: L("ตู้ขายอัตโนมัติ", "Vending", "自动售货") },
    ],
    employee: employees.map((e) => ({ value: e.id, label: empName.get(e.id) ?? e.id })),
    category: categories.map((c) => ({ value: c.id, label: catName.get(c.id) ?? c.id })),
    product: products.map((p) => ({ value: p.sku, label: prodName.get(p.sku) ?? p.sku })),
    pos: terminals.map((tm) => ({ value: tm.id, label: termName.get(tm.id) ?? tm.id })),
    payment: [
      ["cash", t.payment.cash], ["qr_promptpay", t.payment.qr_promptpay ?? "QR"], ["credit_card", t.payment.credit_card],
      ["debit_card", t.payment.debit_card ?? "Debit"], ["bank_transfer", t.payment.bank_transfer], ["edc", "EDC"],
      ["gift_card", t.payment.gift_card ?? "Gift"], ["store_credit", t.payment.store_credit ?? "Credit"],
    ].map(([value, label]) => ({ value: value as string, label: label as string })),
    channel: [
      { value: "offline", label: L("หน้าร้าน", "Offline", "门店") },
      { value: "online_shopee", label: "Shopee" }, { value: "online_lazada", label: "Lazada" },
      { value: "online_tiktok", label: "TikTok" }, { value: "online_website", label: L("เว็บไซต์", "Website", "官网") },
      { value: "event", label: L("อีเวนต์", "Event", "活动") }, { value: "b2b", label: "B2B" },
    ],
    status: [
      { value: "completed", label: t.orders.completed }, { value: "voided", label: t.orders.voided },
      { value: "refunded", label: L("คืนเงิน", "Refunded", "已退款") },
      { value: "partially_refunded", label: L("คืนบางส่วน", "Partial refund", "部分退款") },
    ],
    customer: [
      { value: "walkin", label: L("ลูกค้าทั่วไป", "Walk-in", "散客") },
      { value: "member", label: L("สมาชิก", "Member", "会员") },
    ],
    flag: [
      { value: "discounted", label: L("มีส่วนลด/โปรฯ", "Discounted / Promo", "有折扣/促销") },
      { value: "returned", label: L("มีการคืนสินค้า", "Has return", "有退货") },
    ],
  };

  // ----- dimension config for chips & modal -----
  const DIMS: { key: ArrayKey; label: string; opts: Opt[]; search?: boolean; group: string }[] = [
    { key: "brandIds", label: t.common.brand, opts: opt.brand, group: "biz" },
    { key: "branchIds", label: t.common.branch, opts: opt.branch, search: true, group: "biz" },
    { key: "provinces", label: L("จังหวัด", "Province", "省份"), opts: opt.province, search: true, group: "biz" },
    { key: "storeTypes", label: L("ประเภทร้าน", "Store type", "门店类型"), opts: opt.storeType, group: "biz" },
    { key: "salespersonIds", label: L("พนักงานขาย", "Salesperson", "销售员"), opts: opt.employee, search: true, group: "biz" },
    { key: "cashierIds", label: L("แคชเชียร์", "Cashier", "收银员"), opts: opt.employee, search: true, group: "biz" },
    { key: "posIds", label: L("เครื่อง POS", "POS / Register", "收银机"), opts: opt.pos, search: true, group: "biz" },
    { key: "categoryIds", label: L("หมวดหมู่", "Category", "品类"), opts: opt.category, search: true, group: "prod" },
    { key: "skus", label: L("สินค้า / SKU", "Product / SKU", "商品/SKU"), opts: opt.product, search: true, group: "prod" },
    { key: "paymentMethods", label: t.admin.paymentMix, opts: opt.payment, group: "txn" },
    { key: "channels", label: L("ช่องทางขาย", "Sales channel", "销售渠道"), opts: opt.channel, group: "txn" },
    { key: "orderStatuses", label: L("สถานะบิล", "Order status", "订单状态"), opts: opt.status, group: "txn" },
    { key: "flags", label: L("โปรฯ / คืนสินค้า", "Promo / Return", "促销/退货"), opts: opt.flag, group: "txn" },
    { key: "customerTypes", label: L("ประเภทลูกค้า", "Customer type", "客户类型"), opts: opt.customer, group: "cust" },
  ];
  const GROUPS: { id: string; label: string }[] = [
    { id: "biz", label: L("ธุรกิจ / สาขา", "Business", "业务") },
    { id: "prod", label: L("สินค้า", "Product", "商品") },
    { id: "txn", label: L("ธุรกรรม", "Transaction", "交易") },
    { id: "cust", label: L("ลูกค้า", "Customer", "客户") },
  ];
  const labelOf = (key: ArrayKey, v: string) => DIMS.find((d) => d.key === key)?.opts.find((o) => o.value === v)?.label ?? v;

  const setRange = (range: RangeKey) => {
    if (range === "custom") { onChange({ ...value, range }); return; }
    const { from, to } = rangeToDates(range);
    onChange({ ...value, range, from, to });
  };
  const toggle = (key: ArrayKey, v: string) => {
    const list = value[key];
    onChange({ ...value, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
  };
  const clearAll = () => {
    const { from, to } = rangeToDates("30d");
    onChange({ range: "30d", from, to, ...EMPTY });
  };

  const activeCount = DIMS.reduce((s, d) => s + value[d.key].length, 0);
  const activeChips = DIMS.flatMap((d) => value[d.key].map((v) => ({ key: d.key, v, label: labelOf(d.key, v) })));

  const DATE_PRESETS: { value: RangeKey; label: string }[] = [
    { value: "today", label: t.common.today },
    { value: "yesterday", label: t.common.yesterday },
    { value: "7d", label: "7D" },
    { value: "30d", label: "30D" },
    { value: "mtd", label: "MTD" },
    { value: "ytd", label: "YTD" },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={value.range === "custom" ? "30d" : value.range} onChange={setRange} options={DATE_PRESETS} />
        <button
          onClick={() => setRange(value.range === "custom" ? "30d" : "custom")}
          className={`chip h-9 ${value.range === "custom" ? "border-ink text-ink bg-surface2" : ""}`}
        >
          <Calendar size={13} /> {L("กำหนดเอง", "Custom", "自定义")}
        </button>
        {value.range === "custom" ? (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={iso(value.from)} onChange={(e) => onChange({ ...value, range: "custom", from: new Date(e.target.value) })} className="h-9 w-[140px]" />
            <span className="text-muted text-xs">–</span>
            <Input type="date" value={iso(value.to)} onChange={(e) => { const d = new Date(e.target.value); d.setHours(23, 59, 59, 999); onChange({ ...value, range: "custom", to: d }); }} className="h-9 w-[140px]" />
          </div>
        ) : null}

        <div className="w-px h-6 bg-line mx-0.5 hidden sm:block" />

        <Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => setOpen(true)}>
          <Filter size={14} /> {t.common.filter}
          {activeCount ? <span className="ml-1 px-1.5 rounded-full bg-brand text-brandInk text-[10px] tnum">{activeCount}</span> : null}
        </Button>
        <Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => setViewsOpen(true)}>
          <Bookmark size={14} /> {L("มุมมอง", "Views", "视图")}
        </Button>
        {activeCount ? (
          <button onClick={clearAll} className="text-xs text-muted hover:text-ink">{L("ล้างทั้งหมด", "Clear all", "清除")}</button>
        ) : null}
      </div>

      {/* active chips */}
      {activeChips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((c, i) => (
            <button key={`${c.key}-${c.v}-${i}`} onClick={() => toggle(c.key, c.v)}
              className="chip h-7 hover:border-ink/40 group max-w-[220px]">
              <span className="truncate">{c.label}</span>
              <X size={11} className="text-muted group-hover:text-ink" />
            </button>
          ))}
        </div>
      ) : null}

      {/* ===== Filter modal ===== */}
      <Modal open={open} onClose={() => setOpen(false)} title={t.common.filter} size="xl"
        footer={
          <>
            <button onClick={clearAll} className="text-xs text-muted hover:text-ink mr-auto">{L("ล้างทั้งหมด", "Clear all", "清除")}</button>
            <Button variant="primary" onClick={() => setOpen(false)}>{t.common.apply} {activeCount ? `(${activeCount})` : ""}</Button>
          </>
        }>
        <div className="space-y-6">
          {GROUPS.map((g) => (
            <div key={g.id}>
              <p className="eyebrow mb-2.5">{g.label}</p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                {DIMS.filter((d) => d.group === g.id).map((d) => (
                  <DimField key={d.key} dim={d} selected={value[d.key]} onToggle={(v) => toggle(d.key, v)} searchLabel={t.common.search} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* ===== Saved Views ===== */}
      <SavedViewsModal
        open={viewsOpen}
        onClose={() => setViewsOpen(false)}
        userId={employee?.id ?? "anon"}
        current={value}
        onLoad={(f) => { onChange(f); setViewsOpen(false); }}
        L={L}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Dimension field — chips (เล็ก) หรือ checklist ค้นหาได้ (ใหญ่)
// ---------------------------------------------------------------------
function DimField({ dim, selected, onToggle, searchLabel }: {
  dim: { key: ArrayKey; label: string; opts: Opt[]; search?: boolean };
  selected: string[];
  onToggle: (v: string) => void;
  searchLabel: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? dim.opts.filter((o) => o.label.toLowerCase().includes(term)) : dim.opts;
  }, [dim.opts, q]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-ink">{dim.label}</p>
        {selected.length ? <span className="text-[10px] text-muted tnum">{selected.length}</span> : null}
      </div>
      {dim.search ? (
        <>
          <div className="relative mb-1.5">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} className="h-8 pl-8 text-xs" />
          </div>
          <div className="max-h-40 overflow-y-auto rounded-xl border border-line divide-y divide-line/60">
            {filtered.slice(0, 200).map((o) => {
              const on = selected.includes(o.value);
              return (
                <button key={o.value} onClick={() => onToggle(o.value)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs ${on ? "bg-brand/8 text-ink" : "hover:bg-surface2"}`}>
                  <span className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${on ? "bg-brand border-brand text-brandInk" : "border-line"}`}>
                    {on ? <Check size={11} /> : null}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
            {!filtered.length ? <p className="px-2.5 py-3 text-center text-[11px] text-muted">—</p> : null}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {dim.opts.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button key={o.value} onClick={() => onToggle(o.value)}
                className={`chip ${on ? "border-brand text-brand bg-brand/8" : ""}`}>
                {on ? <Check size={11} /> : null}{o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Saved Views — บันทึกมุมมองตัวกรองต่อผู้ใช้ (localStorage)
// ---------------------------------------------------------------------
interface SavedView { id: string; name: string; filter: AdminFilter }

function loadViews(userId: string): SavedView[] {
  try {
    const raw = localStorage.getItem(`shdpos.views.${userId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw) as (Omit<SavedView, "filter"> & { filter: Omit<AdminFilter, "from" | "to"> & { from: string; to: string } })[];
    return arr.map((v) => ({ ...v, filter: { ...v.filter, from: new Date(v.filter.from), to: new Date(v.filter.to) } }));
  } catch {
    return [];
  }
}
function persistViews(userId: string, views: SavedView[]) {
  try {
    localStorage.setItem(`shdpos.views.${userId}`, JSON.stringify(views.map((v) => ({ ...v, filter: { ...v.filter, from: v.filter.from.toISOString(), to: v.filter.to.toISOString() } }))));
  } catch { /* ignore */ }
}

function SavedViewsModal({ open, onClose, userId, current, onLoad, L }: {
  open: boolean; onClose: () => void; userId: string; current: AdminFilter;
  onLoad: (f: AdminFilter) => void; L: (th: string, en: string, zh: string) => string;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");

  useEffect(() => { if (open) setViews(loadViews(userId)); }, [open, userId]);

  const save = () => {
    if (!name.trim()) return;
    const next = [...views, { id: `${Date.now()}`, name: name.trim(), filter: current }];
    setViews(next); persistViews(userId, next); setName("");
  };
  const remove = (id: string) => {
    const next = views.filter((v) => v.id !== id);
    setViews(next); persistViews(userId, next);
  };

  return (
    <Modal open={open} onClose={onClose} title={L("มุมมองที่บันทึก", "Saved Views", "已保存视图")} size="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={L("ตั้งชื่อมุมมองปัจจุบัน…", "Name current view…", "命名当前视图…")}
            onKeyDown={(e) => e.key === "Enter" && save()} />
          <Button variant="primary" disabled={!name.trim()} onClick={save}><Save size={15} /> {L("บันทึก", "Save", "保存")}</Button>
        </div>
        {views.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-2 px-3 py-2.5">
                <Bookmark size={14} className="text-muted shrink-0" />
                <button onClick={() => onLoad(v.filter)} className="flex-1 text-left text-sm font-medium hover:text-brand truncate">{v.name}</button>
                <button onClick={() => remove(v.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-xs text-muted py-6">{L("ยังไม่มีมุมมองที่บันทึก", "No saved views yet", "暂无已保存视图")}</p>
        )}
      </div>
    </Modal>
  );
}

export function useDefaultFilter(): [AdminFilter, (f: AdminFilter) => void] {
  const { from, to } = rangeToDates("30d");
  const [filter, setFilter] = useState<AdminFilter>({ range: "30d", from, to, ...EMPTY });
  return [filter, setFilter];
}
