"use client";
// สต๊อกสาขา — คงเหลือรายสาขา: สาขาไหนมี SKU/แบรนด์อะไร กี่ชิ้น (ข้อมูลจาก /api/admin/branch-stock)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Building2, ChevronDown, ChevronRight, Download, Filter, Package, RefreshCw, Search, Warehouse, X } from "lucide-react";
import { Badge, Button, EmptyState, Input, Segmented, Select, Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { formatInt } from "@/lib/money";
import { downloadExcel } from "@/lib/export";

interface Branch { id: string; code: string | null; name: string | null; name_th: string | null; brand_id: string | null; branch_type: string | null; province: string | null; brand_ids?: string[] }
interface Product { id: string; sku: string; name_th: string | null; brand_id: string | null; category_id: string | null; price: number | null; is_active: boolean; track_serial: boolean; image_url: string | null }
interface Row { branch_id: string; product_id: string; on_hand: number; available: number; reserved: number; quarantine: number; serials: number }
interface Payload { branches: Branch[]; products: Product[]; brands: { id: string; name: string }[]; categories: { id: string; name: string }[]; rows: Row[]; ow_branch_ids: string[] }
type View = "product" | "branch";

const PAGE = 100;
const branchLabel = (b: Branch) => b.name_th || b.name || b.code || "—";

export function BranchStockTab() {
  const { L, locale } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [cat, setCat] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [onlyStock, setOnlyStock] = useState(true);
  const [view, setView] = useState<View>("product");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/admin/branch-stock", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || `HTTP ${r.status}`);
      setData(j as Payload);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!picker) return;
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPicker(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [picker]);

  useEffect(() => { setPage(0); }, [q, brand, cat, sel, onlyStock, view]);

  // ---------- ดัชนี ----------
  const idx = useMemo(() => {
    const brandName = new Map((data?.brands ?? []).map((b) => [b.id, b.name]));
    const catName = new Map((data?.categories ?? []).map((c) => [c.id, c.name]));
    const prod = new Map((data?.products ?? []).map((p) => [p.id, p]));
    const ow = new Set(data?.ow_branch_ids ?? []);
    const byProduct = new Map<string, Map<string, Row>>();
    const byBranch = new Map<string, Row[]>();
    for (const r of data?.rows ?? []) {
      if (!prod.has(r.product_id)) continue;
      let m = byProduct.get(r.product_id);
      if (!m) byProduct.set(r.product_id, (m = new Map()));
      m.set(r.branch_id, r);
      const l = byBranch.get(r.branch_id);
      if (l) l.push(r); else byBranch.set(r.branch_id, [r]);
    }
    return { brandName, catName, prod, ow, byProduct, byBranch };
  }, [data]);

  // ---------- สรุปรายสาขา ----------
  const summary = useMemo(() => {
    const out = new Map<string, { skus: number; units: number; brands: [string, number][] }>();
    for (const b of data?.branches ?? []) {
      const rows = idx.byBranch.get(b.id) ?? [];
      const bc = new Map<string, number>();
      let skus = 0, units = 0;
      for (const r of rows) {
        if (r.available <= 0) continue;
        skus++; units += r.available;
        const p = idx.prod.get(r.product_id);
        const k = p?.brand_id ?? "";
        bc.set(k, (bc.get(k) ?? 0) + 1);
      }
      out.set(b.id, { skus, units, brands: [...bc.entries()].sort((a, b2) => b2[1] - a[1]) });
    }
    return out;
  }, [data, idx]);

  // สาขาที่แสดงในตาราง: เลือกไว้ → ตามที่เลือก · ไม่เลือก → สาขาที่มีข้อมูลสต๊อก
  const shownBranches = useMemo(() => {
    const all = data?.branches ?? [];
    return sel.size ? all.filter((b) => sel.has(b.id)) : all.filter((b) => idx.byBranch.has(b.id));
  }, [data, sel, idx]);

  const textMatch = useCallback((p: Product) => {
    if (brand && p.brand_id !== brand) return false;
    if (cat && p.category_id !== cat) return false;
    const s = q.trim().toLowerCase();
    if (s && !p.sku.toLowerCase().includes(s) && !(p.name_th ?? "").toLowerCase().includes(s)) return false;
    return true;
  }, [q, brand, cat]);

  // ---------- มุมมองตามสินค้า ----------
  const matrix = useMemo(() => {
    const ids = shownBranches.map((b) => b.id);
    const list: { p: Product; cells: (Row | undefined)[]; total: number }[] = [];
    for (const p of data?.products ?? []) {
      if (!textMatch(p)) continue;
      const m = idx.byProduct.get(p.id);
      if (!m) continue;
      const cells = ids.map((id) => m.get(id));
      if (!cells.some(Boolean)) continue;
      const total = cells.reduce((s, c) => s + (c ? c.available : 0), 0);
      if (onlyStock && !cells.some((c) => c && c.available > 0)) continue;
      list.push({ p, cells, total });
    }
    return list;
  }, [data, shownBranches, idx, textMatch, onlyStock]);

  const colTotals = useMemo(() => shownBranches.map((_, i) => matrix.reduce((s, r) => s + (r.cells[i]?.available ?? 0), 0)), [matrix, shownBranches]);
  const pages = Math.max(1, Math.ceil(matrix.length / PAGE));
  const pageRows = matrix.slice(page * PAGE, page * PAGE + PAGE);

  // ---------- มุมมองตามสาขา ----------
  const grouped = useMemo(() => shownBranches.map((b) => {
    const rows = (idx.byBranch.get(b.id) ?? [])
      .filter((r) => { const p = idx.prod.get(r.product_id); return !!p && textMatch(p) && (!onlyStock || r.available > 0); })
      .sort((a, b2) => (idx.prod.get(a.product_id)!.sku).localeCompare(idx.prod.get(b2.product_id)!.sku));
    return { b, rows, units: rows.reduce((s, r) => s + r.available, 0) };
  }).filter((g) => g.rows.length), [shownBranches, idx, textMatch, onlyStock]);

  const cellTitle = (r: Row) => L(
    `คงเหลือ ${formatInt(r.on_hand)} · จอง ${formatInt(r.reserved)} · กักตรวจ ${formatInt(r.quarantine)} · SN ${formatInt(r.serials)}`,
    `On hand ${formatInt(r.on_hand)} · Reserved ${formatInt(r.reserved)} · Quarantine ${formatInt(r.quarantine)} · SN ${formatInt(r.serials)}`,
    `现有 ${formatInt(r.on_hand)} · 预留 ${formatInt(r.reserved)} · 隔离 ${formatInt(r.quarantine)} · SN ${formatInt(r.serials)}`,
  );
  const tone = (n: number) => n < 0 ? "text-danger font-semibold" : n === 0 ? "text-warn" : "text-ink";

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };

  const exportXlsx = () => {
    const cols = [
      { key: "sku", label: "SKU", map: (r: (typeof matrix)[number]) => r.p.sku },
      { key: "name", label: L("สินค้า", "Product", "商品"), map: (r: (typeof matrix)[number]) => r.p.name_th ?? "" },
      { key: "brand", label: L("แบรนด์", "Brand", "品牌"), map: (r: (typeof matrix)[number]) => idx.brandName.get(r.p.brand_id ?? "") ?? "" },
      { key: "cat", label: L("หมวด", "Category", "类别"), map: (r: (typeof matrix)[number]) => idx.catName.get(r.p.category_id ?? "") ?? "" },
      ...shownBranches.map((b, i) => ({ key: `b${i}`, label: `${b.code ?? ""} ${branchLabel(b)}`.trim(), map: (r: (typeof matrix)[number]) => (r.cells[i] ? r.cells[i]!.available : "") as number | string })),
      { key: "total", label: L("รวม", "Total", "合计"), map: (r: (typeof matrix)[number]) => r.total },
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    downloadExcel(`branch-stock-${stamp}`, cols, matrix, L(`สต๊อกสาขา ณ ${stamp}`, `Branch stock as of ${stamp}`, `门店库存 截至 ${stamp}`));
  };

  // ---------- render ----------
  if (loading && !data) return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-12" /><Skeleton className="h-96" />
    </div>
  );
  if (error && !data) return (
    <div className="card p-4">
      <EmptyState icon={<AlertTriangle size={28} />} title={L("โหลดสต๊อกสาขาไม่สำเร็จ", "Failed to load branch stock", "加载门店库存失败")} body={error} />
      <div className="flex justify-center pb-4"><Button size="sm" onClick={() => void load()}><RefreshCw size={14} />{L("ลองใหม่", "Retry", "重试")}</Button></div>
    </div>
  );
  if (!data || !data.branches.length) return (
    <div className="card"><EmptyState icon={<Building2 size={28} />} title={L("ไม่มีสาขาในขอบเขตของคุณ", "No branches in your scope", "您的范围内没有门店")} /></div>
  );

  const owLabel = L("สต๊อกจากคลังกลาง (OW)", "Central warehouse stock (OW)", "中央仓库存 (OW)");
  const nf = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : "th-TH");

  return (
    <div className="space-y-4">
      {/* a. การ์ดสรุปรายสาขา */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {data.branches.map((b) => {
          const s = summary.get(b.id)!;
          const active = sel.size === 1 && sel.has(b.id);
          return (
            <button key={b.id} type="button" onClick={() => setSel(active ? new Set() : new Set([b.id]))}
              className={`card p-3 text-left transition-shadow hover:shadow-md ${active ? "ring-2 ring-brand" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate" translate="no">{branchLabel(b)}</p>
                  <p className="text-[11px] text-muted truncate" translate="no">{[b.code, b.province].filter(Boolean).join(" · ")}</p>
                </div>
                {idx.ow.has(b.id) ? <Badge tone="info" className="shrink-0"><Warehouse size={11} className="mr-1 inline" />OW</Badge> : null}
              </div>
              <div className="mt-2 flex gap-4 text-xs">
                <div><p className="text-muted">{L("SKU มีของ", "SKUs in stock", "有货 SKU")}</p><p className="text-base font-semibold tnum">{nf.format(s.skus)}</p></div>
                <div><p className="text-muted">{L("รวม (ชิ้น)", "Units", "件数")}</p><p className="text-base font-semibold tnum">{nf.format(s.units)}</p></div>
              </div>
              {(b.brand_ids ?? []).length ? (
                <p className="mt-2 text-[10.5px] text-muted truncate"><span>{L("ขายแบรนด์", "Sells", "在售品牌")}: </span><span className="text-ink font-medium" translate="no">{(b.brand_ids ?? []).map((id) => idx.brandName.get(id) ?? "—").join(", ")}</span></p>
              ) : null}
              {s.brands.some(([id]) => id && (b.brand_ids ?? []).length && !(b.brand_ids ?? []).includes(id)) ? (
                <p className="mt-1 text-[10.5px] text-warn">{L("มีสต๊อกแบรนด์ที่สาขานี้ไม่ได้ขาย", "Holds stock of a brand this branch doesn't sell", "持有本店不销售品牌的库存")}</p>
              ) : null}
              {s.brands.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.brands.slice(0, 5).map(([id, n]) => (
                    <span key={id} className="px-1.5 py-0.5 rounded-md bg-surface2 border border-line text-[10px] text-muted" translate="no">{idx.brandName.get(id) ?? "—"} <span className="tnum text-ink">{n}</span></span>
                  ))}
                  {s.brands.length > 5 ? <span className="text-[10px] text-muted">+{s.brands.length - 5}</span> : null}
                </div>
              ) : <p className="mt-2 text-[11px] text-muted">{L("ไม่มีสต๊อก", "No stock", "无库存")}</p>}
              {idx.ow.has(b.id) ? <p className="mt-1 text-[10px] text-muted">{owLabel}</p> : null}
            </button>
          );
        })}
      </div>

      {/* b. ตัวกรอง */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="!pl-8 !h-9 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อสินค้า", "Search SKU / name", "搜索 SKU / 名称")} />
        </div>
        <Select className="!h-9 text-xs w-auto" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">{L("ทุกแบรนด์", "All brands", "全部品牌")}</option>
          {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select className="!h-9 text-xs w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{L("ทุกหมวด", "All categories", "全部类别")}</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="relative" ref={pickerRef}>
          <Button size="sm" onClick={() => setPicker((v) => !v)}>
            <Filter size={13} />{sel.size ? L(`${sel.size} สาขา`, `${sel.size} branches`, `${sel.size} 个门店`) : L("ทุกสาขา", "All branches", "全部门店")}<ChevronDown size={13} />
          </Button>
          {picker ? (
            <div className="absolute z-30 mt-1 w-72 max-h-80 overflow-auto card p-2 shadow-lg">
              <div className="flex justify-between px-1 pb-2 text-[11px]">
                <button type="button" className="text-brand" onClick={() => setSel(new Set(data.branches.map((b) => b.id)))}>{L("เลือกทั้งหมด", "Select all", "全选")}</button>
                <button type="button" className="text-muted" onClick={() => setSel(new Set())}>{L("ล้าง", "Clear", "清除")}</button>
              </div>
              {data.branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface2 text-xs cursor-pointer">
                  <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(sel, b.id, setSel)} />
                  <span className="truncate" translate="no">{b.code ? `${b.code} · ` : ""}{branchLabel(b)}</span>
                  {idx.ow.has(b.id) ? <Badge tone="info" className="ml-auto">OW</Badge> : null}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink cursor-pointer select-none">
          <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />
          {L("มีสต๊อกเท่านั้น", "In stock only", "仅有库存")}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Segmented size="sm" value={view} onChange={setView} options={[
            { value: "product", label: L("ตามสินค้า", "By product", "按商品") },
            { value: "branch", label: L("ตามสาขา", "By branch", "按门店") },
          ]} />
          <Button size="icon" onClick={() => void load()} title={L("รีเฟรช", "Refresh", "刷新")}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></Button>
          <Button size="sm" onClick={exportXlsx} disabled={!matrix.length}><Download size={13} />Excel</Button>
        </div>
        {sel.size ? (
          <div className="w-full flex flex-wrap gap-1">
            {data.branches.filter((b) => sel.has(b.id)).map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface2 border border-line text-[11px]" translate="no">
                {branchLabel(b)}<button type="button" onClick={() => toggle(sel, b.id, setSel)} className="text-muted hover:text-ink"><X size={11} /></button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {/* c. มุมมองตามสินค้า (สินค้า × สาขา) */}
      {view === "product" ? (
        !matrix.length || !shownBranches.length ? (
          <div className="card"><EmptyState icon={<Package size={28} />} title={L("ไม่พบสต๊อกตามตัวกรอง", "No stock matches the filters", "没有符合筛选的库存")} /></div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-20 bg-surface2 border-b border-line text-left px-3 py-2 font-medium text-muted min-w-[240px]">{L("สินค้า", "Product", "商品")}</th>
                    {shownBranches.map((b) => (
                      <th key={b.id} className="sticky top-0 z-10 bg-surface2 border-b border-line px-2 py-2 font-medium text-muted text-right whitespace-nowrap" title={idx.ow.has(b.id) ? owLabel : undefined}>
                        <span translate="no">{b.code || branchLabel(b)}</span>{idx.ow.has(b.id) ? <span className="ml-1 text-[9px] text-info">OW</span> : null}
                        <div className="text-[10px] font-normal truncate max-w-[110px] ml-auto" translate="no">{b.code ? branchLabel(b) : ""}</div>
                      </th>
                    ))}
                    <th className="sticky top-0 z-10 bg-surface2 border-b border-line px-3 py-2 font-semibold text-ink text-right">{L("รวม", "Total", "合计")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ p, cells, total }) => (
                    <tr key={p.id} className="hover:bg-surface2/60">
                      <td className="sticky left-0 z-[5] bg-surface border-b border-line px-3 py-1.5">
                        <div className="font-medium text-ink tnum" translate="no">{p.sku}</div>
                        <div className="text-muted truncate max-w-[260px]" translate="no">{p.name_th}</div>
                        <div className="text-[10px] text-muted" translate="no">{idx.brandName.get(p.brand_id ?? "") ?? ""}{p.category_id && idx.catName.get(p.category_id) ? ` · ${idx.catName.get(p.category_id)}` : ""}</div>
                      </td>
                      {cells.map((c, i) => (
                        <td key={shownBranches[i].id} className={`border-b border-line px-2 py-1.5 text-right tnum ${c ? tone(c.available) : "text-muted"} ${c && c.available <= 0 ? "bg-warn/5" : ""}`} title={c ? cellTitle(c) : undefined}>
                          {c ? formatInt(c.available) : "—"}
                          {c && c.serials ? <div className="text-[9px] text-muted">SN {formatInt(c.serials)}</div> : null}
                        </td>
                      ))}
                      <td className={`border-b border-line px-3 py-1.5 text-right tnum font-semibold ${tone(total)}`}>{formatInt(total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sticky left-0 bottom-0 z-20 bg-surface2 border-t border-line px-3 py-2 font-semibold">{L(`รวม ${nf.format(matrix.length)} SKU`, `Total ${nf.format(matrix.length)} SKUs`, `合计 ${nf.format(matrix.length)} 个 SKU`)}</td>
                    {colTotals.map((t, i) => <td key={shownBranches[i].id} className={`sticky bottom-0 bg-surface2 border-t border-line px-2 py-2 text-right tnum font-semibold ${tone(t)}`}>{formatInt(t)}</td>)}
                    <td className="sticky bottom-0 bg-surface2 border-t border-line px-3 py-2 text-right tnum font-bold">{formatInt(colTotals.reduce((a, b) => a + b, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {pages > 1 ? (
              <div className="flex items-center justify-between px-3 py-2 border-t border-line text-xs text-muted">
                <span className="tnum">{L(`แสดง ${page * PAGE + 1}–${Math.min(matrix.length, (page + 1) * PAGE)} จาก ${nf.format(matrix.length)}`, `Showing ${page * PAGE + 1}–${Math.min(matrix.length, (page + 1) * PAGE)} of ${nf.format(matrix.length)}`, `显示 ${page * PAGE + 1}–${Math.min(matrix.length, (page + 1) * PAGE)} / 共 ${nf.format(matrix.length)}`)}</span>
                <div className="flex gap-1">
                  <Button size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>{L("ก่อนหน้า", "Prev", "上一页")}</Button>
                  <span className="px-2 self-center tnum">{page + 1}/{pages}</span>
                  <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)}>{L("ถัดไป", "Next", "下一页")}</Button>
                </div>
              </div>
            ) : null}
          </div>
        )
      ) : (
        /* d. มุมมองตามสาขา */
        !grouped.length ? (
          <div className="card"><EmptyState icon={<Package size={28} />} title={L("ไม่พบสต๊อกตามตัวกรอง", "No stock matches the filters", "没有符合筛选的库存")} /></div>
        ) : (
          <div className="space-y-2">
            {grouped.map(({ b, rows, units }) => {
              const isOpen = open.has(b.id);
              const all = more.has(b.id);
              const list = all ? rows : rows.slice(0, PAGE);
              return (
                <div key={b.id} className="card overflow-hidden">
                  <button type="button" onClick={() => toggle(open, b.id, setOpen)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface2/60">
                    {isOpen ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                    <span className="text-sm font-semibold text-ink" translate="no">{branchLabel(b)}</span>
                    {b.code ? <span className="text-[11px] text-muted" translate="no">{b.code}</span> : null}
                    {idx.ow.has(b.id) ? <Badge tone="info">{owLabel}</Badge> : null}
                    <span className="ml-auto text-xs text-muted tnum">{L(`${nf.format(rows.length)} SKU · ${nf.format(units)} ชิ้น`, `${nf.format(rows.length)} SKUs · ${nf.format(units)} units`, `${nf.format(rows.length)} 个 SKU · ${nf.format(units)} 件`)}</span>
                  </button>
                  {isOpen ? (
                    <div className="overflow-auto max-h-[60vh] border-t border-line">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted">
                            {[L("SKU", "SKU", "SKU"), L("สินค้า", "Product", "商品"), L("แบรนด์", "Brand", "品牌")].map((h) => <th key={h} className="sticky top-0 bg-surface2 border-b border-line px-3 py-2 text-left font-medium">{h}</th>)}
                            {[L("คงเหลือ", "On hand", "现有"), L("พร้อมขาย", "Available", "可售"), L("Serial", "Serials", "序列号")].map((h) => <th key={h} className="sticky top-0 bg-surface2 border-b border-line px-3 py-2 text-right font-medium">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r) => {
                            const p = idx.prod.get(r.product_id)!;
                            return (
                              <tr key={r.product_id} className="hover:bg-surface2/60" title={cellTitle(r)}>
                                <td className="border-b border-line px-3 py-1.5 font-medium tnum" translate="no">{p.sku}</td>
                                <td className="border-b border-line px-3 py-1.5 max-w-[320px] truncate" translate="no">{p.name_th}</td>
                                <td className="border-b border-line px-3 py-1.5 text-muted" translate="no">{idx.brandName.get(p.brand_id ?? "") ?? "—"}</td>
                                <td className={`border-b border-line px-3 py-1.5 text-right tnum ${tone(r.on_hand)}`}>{formatInt(r.on_hand)}</td>
                                <td className={`border-b border-line px-3 py-1.5 text-right tnum font-semibold ${tone(r.available)}`}>{formatInt(r.available)}</td>
                                <td className="border-b border-line px-3 py-1.5 text-right tnum text-muted">{p.track_serial ? formatInt(r.serials) : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {rows.length > PAGE && !all ? (
                        <div className="p-2 text-center">
                          <Button size="sm" onClick={() => toggle(more, b.id, setMore)}>{L(`แสดงทั้งหมด (${nf.format(rows.length)})`, `Show all (${nf.format(rows.length)})`, `显示全部 (${nf.format(rows.length)})`)}</Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
