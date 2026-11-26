"use client";
// =====================================================================
// สต๊อกสินค้า (หลังบ้าน)
//   หัวแถวเดียว: ชื่อหน้า · [รายสาขา | ค้นหาข้ามสาขา] · [ทั้งหมด | ใกล้หมด | หมด] · สาขา · ค้นหา · CSV
//   รายสาขา: รูปสินค้า + กรองละเอียด (แบรนด์/หมวด/SN/สภาพสต๊อก/อายุ) + เรียง + มุมมอง "รวมสินค้า" หรือ "แยกสาขา"
//   คลิกสินค้า → Drawer รายละเอียด: สต๊อกแยกสาขา + SN รายชิ้น (สถานะ/อยู่ที่ไหน/ไทม์ไลน์)
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, Download, MapPin, ArrowLeft, Package, Filter, ScanLine, Layers, Rows3 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, stockAll, listBranches, listBrands, listCategories } from "@/lib/data/repo";
import type { Branch, Brand, Category, Product, StockLevel } from "@/lib/types";
import { Table, Th, Td, Badge, EmptyState } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import { stockView } from "@/lib/stock";
import { can, visibleBranchIds } from "@/lib/permissions";
import { coordOf, haversineKm, fmtKm } from "@/lib/geo";
import { ProductStockDrawer } from "@/components/admin/product-stock-drawer";

type SRow = StockLevel & { key: string };
type Cond = "quarantine" | "transit" | "reserved" | "aged";
type Sort = "avail_asc" | "avail_desc" | "name" | "age" | "value";

export default function AdminInventoryPage() {
  const { t, locale, pick } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee, branchId: sessionBranchId } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<SRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "low" | "out">("all");
  const [branchId, setBranchId] = useState("all");
  const [scope, setScope] = useState<"byBranch" | "crossBranch">("byBranch");
  const [group, setGroup] = useState<"product" | "branch">("product");
  const [fBrand, setFBrand] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fSn, setFSn] = useState<"all" | "yes" | "no">("all");
  const [conds, setConds] = useState<Cond[]>([]);
  const [sort, setSort] = useState<Sort>("avail_asc");
  const [detailId, setDetailId] = useState<string | null>(null);
  // ค้นหาข้ามสาขา
  const [xProductId, setXProductId] = useState("");
  const [xRef, setXRef] = useState("");

  useEffect(() => {
    void (async () => {
      const [p, s, b, br, cat] = await Promise.all([listProducts(), stockAll(), listBranches(), listBrands(), listCategories()]);
      setProducts(p); setStock(s); setBranches(b); setBrands(br); setCategories(cat); setLoading(false);
    })();
  }, []);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const pMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const uniqBranches = useMemo(() => { const seen = new Set<string>(); return branches.filter((b) => b.is_active && allowed.includes(b.id) && !seen.has(b.id) && (seen.add(b.id), true)); }, [branches, allowed]);
  const brandName = (id?: string | null) => { const b = brands.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : null; };
  const branchLabel = (id: string) => { const b = bMap.get(id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : ""; };
  const ageDays = (iso?: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);
  const ageTone = (d: number) => (d > 150 ? "text-rose-500 font-semibold" : d > 90 ? "text-amber-600 font-medium" : d > 30 ? "text-ink/70" : "text-ok");
  const showCost = can(employee, "report.cost");

  // ── แถวรายสาขา (หลังกรอง) ──
  const branchRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return stock
      .filter((s) => allowed.includes(s.branch_id) && (branchId === "all" || s.branch_id === branchId))
      .map((s) => {
        const p = pMap.get(s.product_id);
        if (!p) return null;
        const rp = Math.max(s.reorder_point, p.reorder_point);
        const sv = stockView(s);
        return { s, p, rp, sv, avail: sv.available, low: rp > 0 && sv.available <= rp && sv.available > 0, out: sv.available <= 0, age: ageDays(s.last_in_at) };
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .filter((r) => !term || r.p.sku.toLowerCase().includes(term) || r.p.name_th.toLowerCase().includes(term) || (brandName(r.p.brand_id)?.toLowerCase().includes(term) ?? false))
      .filter((r) => fBrand === "all" || r.p.brand_id === fBrand)
      .filter((r) => fCat === "all" || r.p.category_id === fCat)
      .filter((r) => fSn === "all" || (fSn === "yes") === !!r.p.track_serial)
      .filter((r) => conds.every((c) => c === "quarantine" ? r.sv.quarantine > 0 : c === "transit" ? r.sv.otwo > 0 : c === "reserved" ? r.sv.reservedOut + r.sv.reservedOrder > 0 : (r.age ?? 0) > 90));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock, allowed, branchId, pMap, q, fBrand, fCat, fSn, conds, brands]);

  // ── รวมตามสินค้า ──
  const productRows = useMemo(() => {
    const m = new Map<string, { p: Product; onHand: number; avail: number; quarantine: number; otwo: number; reserved: number; branches: number; rp: number; age: number | null }>();
    for (const r of branchRows) {
      const cur = m.get(r.p.id) ?? { p: r.p, onHand: 0, avail: 0, quarantine: 0, otwo: 0, reserved: 0, branches: 0, rp: 0, age: null };
      cur.onHand += r.sv.onHand; cur.avail += r.sv.available; cur.quarantine += r.sv.quarantine; cur.otwo += r.sv.otwo;
      cur.reserved += r.sv.reservedOut + r.sv.reservedOrder; cur.rp += r.rp; if (r.sv.onHand > 0) cur.branches++;
      if (r.age !== null) cur.age = Math.max(cur.age ?? 0, r.age);
      m.set(r.p.id, cur);
    }
    return [...m.values()].map((x) => ({ ...x, low: x.rp > 0 && x.avail <= x.rp && x.avail > 0, out: x.avail <= 0 }));
  }, [branchRows]);

  const cmp = (a: { avail: number; p: Product; age: number | null; value: number }, b: typeof a) =>
    sort === "avail_desc" ? b.avail - a.avail : sort === "name" ? a.p.name_th.localeCompare(b.p.name_th, "th")
      : sort === "age" ? (b.age ?? -1) - (a.age ?? -1) : sort === "value" ? b.value - a.value : a.avail - b.avail;
  const statusOk = (x: { low: boolean; out: boolean }) => (view === "low" ? x.low : view === "out" ? x.out : true);
  const shownProducts = useMemo(() => productRows.filter(statusOk).map((x) => ({ ...x, value: x.onHand * x.p.cost })).sort(cmp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productRows, view, sort]);
  const shownBranchRows = useMemo(() => branchRows.filter(statusOk).map((r) => ({ ...r, value: r.s.qty_on_hand * r.p.cost })).sort(cmp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchRows, view, sort]);

  const kpi = useMemo(() => ({
    sku: productRows.length,
    low: productRows.filter((x) => x.low).length,
    out: productRows.filter((x) => x.out).length,
    quarantine: productRows.reduce((s, x) => s + x.quarantine, 0),
    value: productRows.reduce((s, x) => s + x.onHand * x.p.cost, 0),
    units: productRows.reduce((s, x) => s + x.onHand, 0),
  }), [productRows]);

  const activeFilters = (fBrand !== "all" ? 1 : 0) + (fCat !== "all" ? 1 : 0) + (fSn !== "all" ? 1 : 0) + conds.length + (q ? 1 : 0);
  const clear = () => { setFBrand("all"); setFCat("all"); setFSn("all"); setConds([]); setQ(""); setView("all"); };

  function exportCsv() {
    const head = ["branch", "sku", "name", "brand", "on_hand", "available", "quarantine", "on_the_way", "reorder_point", "stock_age_days", "price", ...(showCost ? ["cost", "stock_value"] : [])];
    const lines = shownBranchRows.map((r) => [
      `"${branchLabel(r.s.branch_id).replace(/"/g, '""')}"`, r.p.sku, `"${r.p.name_th.replace(/"/g, '""')}"`, `"${brandName(r.p.brand_id) ?? ""}"`,
      r.sv.onHand, r.sv.available, r.sv.quarantine, r.sv.otwo, r.rp, r.age ?? "", r.p.price, ...(showCost ? [r.p.cost, r.s.qty_on_hand * r.p.cost] : []),
    ].join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `shd-pos-stock-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // ── ค้นหาข้ามสาขา ──
  const myBranch = useMemo(() => branches.find((b) => b.id === (xRef || sessionBranchId)) || branches.find((b) => b.id === employee?.home_branch_id) || branches.find((b) => allowed.includes(b.id)) || null, [branches, xRef, sessionBranchId, employee, allowed]);
  useEffect(() => { if (!xRef && myBranch) setXRef(myBranch.id); }, [myBranch, xRef]);
  const stockMap = useMemo(() => { const m = new Map<string, StockLevel>(); for (const s of stock) m.set(`${s.branch_id}:${s.product_id}`, s); return m; }, [stock]);
  const xProduct = products.find((p) => p.id === xProductId) || null;
  const xProductList = useMemo(() => {
    const term = q.trim().toLowerCase(); const seen = new Set<string>();
    return products
      .filter((p) => p.kind !== "service" && !seen.has(p.id) && (seen.add(p.id), true)) // รวมสินค้าปิดขาย (รอตรวจ) ด้วย — ติดป้าย
      .filter((p) => fBrand === "all" || p.brand_id === fBrand)
      .filter((p) => fCat === "all" || p.category_id === fCat)
      .filter((p) => !term || p.name_th.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (brandName(p.brand_id)?.toLowerCase().includes(term) ?? false))
      .map((p) => { let total = 0, nb = 0; for (const b of uniqBranches) { const r = stockMap.get(`${b.id}:${p.id}`); const av = r ? stockView(r).available : 0; total += av; if (av > 0) nb++; } return { p, total, nb }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, q, fBrand, fCat, uniqBranches, stockMap, brands, locale]);
  const xRows = useMemo(() => {
    if (!xProduct) return [] as { b: Branch; onHand: number; avail: number; km: number | null }[];
    const mc = coordOf(myBranch);
    return uniqBranches.map((b) => { const s = stockMap.get(`${b.id}:${xProduct.id}`); const sv = s ? stockView(s) : null; const bc = coordOf(b); return { b, onHand: sv?.onHand ?? 0, avail: sv?.available ?? 0, km: mc && bc ? haversineKm(mc, bc) : null }; })
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  }, [xProduct, uniqBranches, stockMap, myBranch]);
  const xTotalAvail = xRows.reduce((s, r) => s + r.avail, 0);

  const detailProduct = detailId ? pMap.get(detailId) ?? null : null;
  const Img = ({ p, size = 40 }: { p: Product; size?: number }) => p.image_url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.image_url} alt="" className="rounded-lg object-contain bg-white border border-line/70 shrink-0" style={{ width: size, height: size }} />
    : <div className="rounded-lg bg-surface2/70 grid place-items-center shrink-0 text-muted/40" style={{ width: size, height: size }}><Package size={Math.round(size * 0.42)} /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* ── หัวแถวเดียว ── */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <h1 className="text-xl font-semibold flex items-center gap-2 whitespace-nowrap"><Boxes size={19} className="text-muted" />{L("สต๊อกสินค้า", "Stock", "库存")}</h1>
        <Seg value={scope} onChange={setScope} options={[["byBranch", L("รายสาขา", "By branch", "按门店")], ["crossBranch", L("ค้นหาข้ามสาขา", "Across branches", "跨店查询")]]} />
        {scope === "byBranch" ? (
          <Seg value={view} onChange={setView} options={[["all", L("ทั้งหมด", "All", "全部")], ["low", `${L("ใกล้หมด", "Low", "低库存")} ${kpi.low}`], ["out", `${L("สินค้าหมด", "Out", "缺货")} ${kpi.out}`]]} />
        ) : null}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {scope === "byBranch" ? (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`h-9 px-2.5 rounded-xl border text-xs outline-none max-w-[200px] ${branchId !== "all" ? "border-brand/40 bg-brand/5" : "border-line bg-surface2/70 text-muted"}`}>
              <option value="all">{L("ทุกสาขา", "All branches", "全部门店")}</option>
              {uniqBranches.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
            </select>
          ) : null}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา ชื่อ / SKU / แบรนด์", "Search name / SKU / brand", "搜索")} className="h-9 w-56 pl-9 pr-3 rounded-xl bg-surface2/70 border border-line text-sm outline-none focus:ring-2 focus:ring-brand/25" />
          </div>
          {scope === "byBranch" ? (
            <button onClick={exportCsv} className="h-9 px-3 rounded-xl border border-line text-xs text-muted hover:text-ink hover:bg-surface2 inline-flex items-center gap-1.5"><Download size={14} />CSV</button>
          ) : null}
        </div>
      </header>

      {scope === "byBranch" ? (
        <>
          {/* ── สรุป ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi hero label={L("สินค้า (SKU)", "SKUs", "SKU")} value={formatInt(kpi.sku)} hint={L(`รวม ${formatInt(kpi.units)} ชิ้น`, `${formatInt(kpi.units)} units`, `${kpi.units} 件`)} />
            <Kpi label={L("ใกล้หมด", "Low stock", "低库存")} value={formatInt(kpi.low)} tone="text-warn" onClick={() => setView("low")} />
            <Kpi label={L("สินค้าหมด", "Out of stock", "缺货")} value={formatInt(kpi.out)} tone="text-danger" onClick={() => setView("out")} />
            <Kpi label={L("พักตรวจ (ชิ้น)", "Quarantine", "暂扣")} value={formatInt(kpi.quarantine)} tone={kpi.quarantine ? "text-warn" : undefined} onClick={() => setConds((c) => c.includes("quarantine") ? c : [...c, "quarantine"])} />
            {showCost ? <Kpi label={L("มูลค่าสต๊อก (ทุน)", "Stock value", "库存价值")} value={formatTHB(kpi.value)} /> : <Kpi label={L("สาขาที่เห็น", "Branches", "门店")} value={formatInt(uniqBranches.length)} />}
          </div>

          {/* ── ตัวกรองละเอียด ── */}
          <section className="rounded-2xl border border-line/70 bg-surface p-3 flex flex-wrap items-center gap-2">
            <Filter size={13} className="text-muted" />
            <Sel value={fBrand} onChange={setFBrand} label={L("แบรนด์", "Brand", "品牌")}>
              <option value="all">{L("ทุกแบรนด์", "All brands", "所有品牌")}</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
            </Sel>
            <Sel value={fCat} onChange={setFCat} label={L("หมวด", "Category", "分类")}>
              <option value="all">{L("ทุกหมวด", "All categories", "所有分类")}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{locale === "th" ? c.name_th : c.name_en ?? c.name_th}</option>)}
            </Sel>
            <Sel value={fSn} onChange={(v) => setFSn(v as typeof fSn)} label="SN">
              <option value="all">{L("SN: ทั้งหมด", "SN: all", "SN 全部")}</option>
              <option value="yes">{L("ติดตาม SN", "Tracks SN", "追踪 SN")}</option>
              <option value="no">{L("ไม่ใช้ SN", "No SN", "无 SN")}</option>
            </Sel>
            {([["quarantine", L("มีพักตรวจ", "Has quarantine", "有暂扣")], ["transit", L("มีระหว่างทาง", "On the way", "在途")], ["reserved", L("มีจอง", "Reserved", "已预留")], ["aged", L("ค้างเกิน 90 วัน", "Aged > 90d", "库龄>90天")]] as const).map(([k, l]) => {
              const on = conds.includes(k);
              return <button key={k} onClick={() => setConds((c) => on ? c.filter((x) => x !== k) : [...c, k])} className={`h-8 px-2.5 rounded-full text-[11px] ${on ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>{l}</button>;
            })}
            <Sel value={sort} onChange={(v) => setSort(v as Sort)} label={L("เรียง", "Sort", "排序")}>
              <option value="avail_asc">{L("เรียง: พร้อมขายน้อย→มาก", "Sort: available ↑", "可售↑")}</option>
              <option value="avail_desc">{L("เรียง: พร้อมขายมาก→น้อย", "Sort: available ↓", "可售↓")}</option>
              <option value="age">{L("เรียง: ค้างนานสุด", "Sort: oldest stock", "库龄")}</option>
              {showCost ? <option value="value">{L("เรียง: มูลค่าสูงสุด", "Sort: value", "价值")}</option> : null}
              <option value="name">{L("เรียง: ชื่อ", "Sort: name", "名称")}</option>
            </Sel>
            <div className="inline-flex rounded-xl bg-surface2/70 p-0.5 ml-auto">
              {([["product", Layers, L("รวมสินค้า", "By product", "按商品")], ["branch", Rows3, L("แยกสาขา", "By branch", "按门店")]] as const).map(([k, Icon, l]) => (
                <button key={k} onClick={() => setGroup(k)} className={`h-8 px-2.5 rounded-lg text-xs inline-flex items-center gap-1 ${group === k ? "bg-surface text-ink shadow-sm" : "text-muted"}`}><Icon size={13} />{l}</button>
              ))}
            </div>
            {activeFilters || view !== "all" ? <button onClick={clear} className="text-[11px] text-brand hover:underline">{L("ล้างตัวกรอง", "Clear", "清除")}</button> : null}
          </section>

          {/* ── ตาราง ── */}
          <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
            <div className="px-4 py-2 border-b border-line text-[11px] text-muted flex justify-between">
              <span>{group === "product" ? L(`${shownProducts.length} สินค้า`, `${shownProducts.length} products`, `${shownProducts.length} 商品`) : L(`${shownBranchRows.length} แถว (สินค้า×สาขา)`, `${shownBranchRows.length} rows`, `${shownBranchRows.length} 行`)}</span>
              <span>{L("คลิกสินค้าเพื่อดูสต๊อกแยกสาขาและ SN รายชิ้น", "Click a product for per-branch stock and serials", "点击查看 SN")}</span>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-14 rounded-xl bg-surface2/60 animate-pulse" />)}</div>
            ) : group === "product" ? (
              shownProducts.length ? (
                <Table>
                  <thead><tr>
                    <Th>{L("สินค้า", "Product", "商品")}</Th>
                    <Th align="right">{L("มีอยู่", "On hand", "在库")}</Th>
                    <Th align="right">{L("พร้อมขาย", "Available", "可售")}</Th>
                    <Th align="right">{L("จอง", "Reserved", "预留")}</Th>
                    <Th align="right">{L("ระหว่างทาง", "On the way", "在途")}</Th>
                    <Th align="right">{L("พักตรวจ", "Quarantine", "暂扣")}</Th>
                    <Th align="right">{L("สาขาที่มี", "Branches", "门店")}</Th>
                    <Th align="right">{L("ค้างนานสุด", "Oldest", "库龄")}</Th>
                    {showCost ? <Th align="right">{L("มูลค่า", "Value", "价值")}</Th> : null}
                    <Th align="center">{L("สถานะ", "Status", "状态")}</Th>
                  </tr></thead>
                  <tbody>
                    {shownProducts.slice(0, 400).map((x) => (
                      <tr key={x.p.id} onClick={() => setDetailId(x.p.id)} className={`cursor-pointer hover:bg-surface2/50 ${x.out ? "bg-danger/[0.04]" : x.low ? "bg-warn/[0.05]" : ""}`}>
                        <Td>
                          <div className="flex items-center gap-3 min-w-0">
                            <Img p={x.p} size={44} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate max-w-[280px]">{pick({ th: x.p.name_th, en: x.p.name_en, zh: x.p.name_zh })}</p>
                              <p className="text-[11px] text-muted truncate"><span className="font-mono">{x.p.sku}</span>{brandName(x.p.brand_id) ? ` · ${brandName(x.p.brand_id)}` : ""}{x.p.track_serial ? <span className="ml-1.5 inline-flex items-center gap-0.5 text-sky-600"><ScanLine size={10} />SN</span> : null}</p>
                            </div>
                          </div>
                        </Td>
                        <Td align="right" className="tnum">{x.onHand}</Td>
                        <Td align="right" className={`tnum font-semibold ${x.out ? "text-danger" : x.low ? "text-warn" : "text-ok"}`}>{x.avail}</Td>
                        <Td align="right" className={`tnum text-xs ${x.reserved ? "text-violet-600" : "text-muted"}`}>{x.reserved || "—"}</Td>
                        <Td align="right" className={`tnum text-xs ${x.otwo ? "text-sky-600" : "text-muted"}`}>{x.otwo || "—"}</Td>
                        <Td align="right" className={`tnum text-xs ${x.quarantine ? "text-rose-600 font-medium" : "text-muted"}`}>{x.quarantine || "—"}</Td>
                        <Td align="right" className="tnum text-xs text-muted">{x.branches}</Td>
                        <Td align="right" className="text-xs">{x.age !== null ? <span className={`${ageTone(x.age)} tnum`}>{x.age} {L("วัน", "d", "天")}</span> : <span className="text-muted/40">—</span>}</Td>
                        {showCost ? <Td align="right" className="text-xs tnum">{formatTHB(x.onHand * x.p.cost, false)}</Td> : null}
                        <Td align="center">{x.out ? <Badge tone="danger">{L("หมด", "Out", "缺货")}</Badge> : x.low ? <Badge tone="warn">{L("ใกล้หมด", "Low", "低")}</Badge> : <Badge tone="ok">OK</Badge>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : <div className="py-14"><EmptyState icon={<Boxes size={26} />} title={L("ไม่พบสินค้าตามตัวกรอง", "No items match", "无匹配")} body={activeFilters ? L("ลองล้างตัวกรอง", "Try clearing filters", "请清除筛选") : L("ยังไม่มีสต๊อกในสาขาที่เห็น — เริ่มจากนับสต๊อกเปิดระบบ", "No stock yet — start with an opening count", "暂无库存")} /></div>
            ) : shownBranchRows.length ? (
              <Table>
                <thead><tr>
                  <Th>{L("สินค้า", "Product", "商品")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th>
                  <Th align="right">{L("มีอยู่", "On hand", "在库")}</Th><Th align="right">{L("พร้อมขาย", "Available", "可售")}</Th>
                  <Th align="right">{L("จอง", "Reserved", "预留")}</Th><Th align="right">{L("ระหว่างทาง", "On the way", "在途")}</Th>
                  <Th align="right">{L("พักตรวจ", "Quarantine", "暂扣")}</Th><Th align="right">{L("อายุสต๊อก", "Age", "库龄")}</Th>
                  <Th align="right">{L("จุดสั่งซื้อ", "Reorder", "补货点")}</Th>{showCost ? <Th align="right">{L("มูลค่า", "Value", "价值")}</Th> : null}
                </tr></thead>
                <tbody>
                  {shownBranchRows.slice(0, 500).map((r) => (
                    <tr key={r.s.key} onClick={() => setDetailId(r.p.id)} className={`cursor-pointer hover:bg-surface2/50 ${r.out ? "bg-danger/[0.04]" : r.low ? "bg-warn/[0.05]" : ""}`}>
                      <Td>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Img p={r.p} size={36} />
                          <div className="min-w-0"><p className="text-xs font-medium truncate max-w-[240px]">{pick({ th: r.p.name_th, en: r.p.name_en, zh: r.p.name_zh })}</p><p className="text-[10px] text-muted font-mono">{r.p.sku}</p></div>
                        </div>
                      </Td>
                      <Td className="text-xs text-muted truncate max-w-[160px]">{branchLabel(r.s.branch_id)}</Td>
                      <Td align="right" className="tnum">{r.sv.onHand}</Td>
                      <Td align="right" className={`tnum font-semibold ${r.out ? "text-danger" : r.low ? "text-warn" : "text-ok"}`}>{r.avail}</Td>
                      <Td align="right" className="tnum text-xs text-muted">{r.sv.reservedOut + r.sv.reservedOrder || "—"}</Td>
                      <Td align="right" className={`tnum text-xs ${r.sv.otwo ? "text-sky-600" : "text-muted"}`}>{r.sv.otwo || "—"}</Td>
                      <Td align="right" className={`tnum text-xs ${r.sv.quarantine ? "text-rose-600 font-medium" : "text-muted"}`}>{r.sv.quarantine || "—"}</Td>
                      <Td align="right" className="text-xs">{r.age !== null ? <span className={`${ageTone(r.age)} tnum`}>{r.age} {L("วัน", "d", "天")}</span> : <span className="text-muted/40">—</span>}</Td>
                      <Td align="right" className="text-xs text-muted">{r.rp || "—"}</Td>
                      {showCost ? <Td align="right" className="text-xs tnum">{formatTHB(r.s.qty_on_hand * r.p.cost, false)}</Td> : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <div className="py-14"><EmptyState icon={<Boxes size={26} />} title={L("ไม่พบสินค้าตามตัวกรอง", "No items match", "无匹配")} /></div>}
          </section>
        </>
      ) : (
        /* ── ค้นหาข้ามสาขา ── */
        <section className="rounded-2xl border border-line/70 bg-surface p-4 space-y-3">
          {!xProduct ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Sel value={fBrand} onChange={setFBrand} label={L("แบรนด์", "Brand", "品牌")}>
                  <option value="all">{L("ทุกแบรนด์", "All brands", "所有品牌")}</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
                </Sel>
                <Sel value={fCat} onChange={setFCat} label={L("หมวด", "Category", "分类")}>
                  <option value="all">{L("ทุกหมวด", "All categories", "所有分类")}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{locale === "th" ? c.name_th : c.name_en ?? c.name_th}</option>)}
                </Sel>
                <span className="text-[11px] text-muted ml-auto">{L("พบ", "Found", "找到")} {xProductList.length} {L("รายการ", "items", "项")}</span>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[600px] overflow-auto">
                {xProductList.slice(0, 150).map(({ p, total, nb }) => (
                  <button key={p.id} onClick={() => setXProductId(p.id)} className="flex items-center gap-3 p-2.5 rounded-xl border border-line/70 hover:border-brand/40 hover:bg-brand/5 text-left">
                    <Img p={p} size={48} />
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</p><p className="text-[10px] text-muted truncate"><span className="font-mono" translate="no">{p.sku}</span>{brandName(p.brand_id) ? ` · ${brandName(p.brand_id)}` : ""}{p.is_active === false ? <span className="ml-1.5 px-1.5 rounded bg-surface2 text-muted">{L("ปิดขาย", "Inactive", "停售")}</span> : null}</p></div>
                    <div className="text-right shrink-0"><p className={`text-base font-bold tnum ${total > 0 ? "text-ok" : "text-muted"}`}>{total}</p><p className="text-[10px] text-muted">{nb} {L("สาขา", "br.", "店")}</p></div>
                  </button>
                ))}
                {!xProductList.length ? <div className="p-6 text-center text-xs text-muted col-span-full">{t.common.empty}</div> : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setXProductId("")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line text-sm text-muted hover:text-brand"><ArrowLeft size={15} />{L("ย้อนกลับ", "Back", "返回")}</button>
                <Img p={xProduct} size={52} />
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{pick({ th: xProduct.name_th, en: xProduct.name_en, zh: xProduct.name_zh })}</p><p className="font-mono text-[10px] text-muted">{xProduct.sku}</p></div>
                <div className="text-right"><p className="text-lg font-bold text-ok tnum">{xTotalAvail}</p><p className="text-[10px] text-muted">{L("พร้อมขายรวมทุกสาขา", "available all branches", "全店可售")}</p></div>
                <button onClick={() => setDetailId(xProduct.id)} className="h-9 px-3 rounded-lg border border-line text-xs text-muted hover:text-brand inline-flex items-center gap-1"><ScanLine size={13} />{L("ดู SN", "Serials", "SN")}</button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <MapPin size={14} className="text-brand" /> {L("วัดระยะจากสาขา", "Distance from", "距离起点")}:
                <select value={xRef} onChange={(e) => setXRef(e.target.value)} className="h-8 px-2 rounded-lg border border-line bg-surface2/70 text-xs">
                  {uniqBranches.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
                </select>
              </div>
              <Table>
                <thead><tr><Th>{t.common.branch}</Th><Th>{L("จังหวัด", "Province", "省")}</Th><Th align="right">{L("ระยะทาง", "Distance", "距离")}</Th><Th align="right">{L("มีอยู่", "On hand", "在库")}</Th><Th align="right">{L("พร้อมขาย", "Available", "可售")}</Th></tr></thead>
                <tbody>
                  {xRows.map((r, i) => (
                    <tr key={r.b.id} className={r.b.id === myBranch?.id ? "bg-brand/5" : ""}>
                      <Td className="text-xs font-medium truncate max-w-[220px]">{locale === "th" ? r.b.name_th ?? r.b.name : r.b.name}{r.b.id === myBranch?.id ? <Badge tone="brand" className="ml-1">{L("สาขาฉัน", "Mine", "本店")}</Badge> : i === xRows.findIndex((x) => x.avail > 0 && x.b.id !== myBranch?.id) && r.avail > 0 ? <Badge tone="ok" className="ml-1">{L("ใกล้สุด+มีของ", "Nearest", "最近")}</Badge> : null}</Td>
                      <Td className="text-xs text-muted">{r.b.province ?? "—"}</Td>
                      <Td align="right" className="text-xs text-muted tnum">{r.b.id === myBranch?.id ? "—" : fmtKm(r.km)}</Td>
                      <Td align="right" className="tnum text-xs text-muted">{r.onHand || "—"}</Td>
                      <Td align="right" className={`font-bold tnum ${r.avail > 0 ? "text-ok" : "text-muted"}`}>{r.avail || "0"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </section>
      )}

      <ProductStockDrawer
        product={detailProduct}
        open={!!detailProduct}
        onClose={() => setDetailId(null)}
        branches={uniqBranches}
        stock={stock}
        brandName={detailProduct ? brandName(detailProduct.brand_id) : null}
        showCost={showCost}
      />
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <div className="flex rounded-2xl bg-surface/65 border border-line/70 p-1 gap-0.5 overflow-x-auto max-w-full">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} className={`h-8 px-3 rounded-xl text-xs whitespace-nowrap transition ${value === k ? "bg-brand text-brandInk shadow-sm" : "text-muted hover:bg-surface"}`}>{l}</button>
      ))}
    </div>
  );
}
function Sel({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  const active = value !== "all" && value !== "avail_asc";
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`h-8 px-2.5 rounded-xl border text-xs outline-none ${active ? "border-brand/40 bg-brand/5 text-ink" : "border-line bg-surface2/70 text-muted"}`}>{children}</select>;
}
function Kpi({ label, value, hint, tone, hero, onClick }: { label: string; value: string; hint?: string; tone?: string; hero?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={`text-left rounded-[20px] p-4 transition ${onClick ? "hover:-translate-y-0.5" : "cursor-default"} ${hero ? "bg-brand text-brandInk shadow-sm" : "bg-surface border border-line/70"}`}>
      <p className={`text-[11px] ${hero ? "opacity-70" : "text-muted"}`}>{label}</p>
      <p className={`text-2xl font-semibold tnum mt-1.5 ${tone ?? ""}`}>{value}</p>
      {hint ? <p className={`text-[10px] mt-1 ${hero ? "opacity-60" : "text-muted"}`}>{hint}</p> : null}
    </button>
  );
}
