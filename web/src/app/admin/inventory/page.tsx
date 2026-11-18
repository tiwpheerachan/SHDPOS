"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, AlertTriangle, Download, MapPin, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, stockAll, listBranches, listBrands, listCategories } from "@/lib/data/repo";
import type { Branch, Brand, Category, Product, StockLevel } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, KpiTile, Segmented } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import { stockView } from "@/lib/stock";
import { can, visibleBranchIds } from "@/lib/permissions";
import { coordOf, haversineKm, fmtKm } from "@/lib/geo";
import { AnimatedBox } from "@/components/animated-icons";

export default function AdminInventoryPage() {
  const { t, locale, pick } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee, branchId: sessionBranchId } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<(StockLevel & { key: string })[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "low" | "out">("all");
  const [branchId, setBranchId] = useState<string>("all");
  const [scope, setScope] = useState<"byBranch" | "crossBranch">("byBranch"); // รายสาขา | ค้นหาข้ามสาขา
  const [xProductId, setXProductId] = useState("");
  const [xRef, setXRef] = useState(""); // สาขาอ้างอิงสำหรับวัดระยะทาง
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [xBrand, setXBrand] = useState("all");
  const [xCat, setXCat] = useState("all");

  useEffect(() => {
    void (async () => {
      const [p, s, b, br, cat] = await Promise.all([listProducts(), stockAll(), listBranches(), listBrands(), listCategories()]);
      setProducts(p);
      setStock(s);
      setBranches(b);
      setBrands(br);
      setCategories(cat);
    })();
  }, []);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const pMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  // ค้นหาข้ามสาขา: สินค้า 1 ตัว → สต๊อกทุกสาขา เรียงตามใกล้สาขาฉัน
  const myBranch = useMemo(() => branches.find((b) => b.id === (xRef || sessionBranchId)) || branches.find((b) => b.id === employee?.home_branch_id) || branches.find((b) => allowed.includes(b.id)) || null, [branches, xRef, sessionBranchId, employee, allowed]);
  useEffect(() => { if (!xRef && myBranch) setXRef(myBranch.id); }, [myBranch, xRef]);
  const stockMap = useMemo(() => { const m = new Map<string, StockLevel>(); for (const s of stock) m.set(`${s.branch_id}:${s.product_id}`, s); return m; }, [stock]);
  const uniqBranches = useMemo(() => { const seen = new Set<string>(); return branches.filter((b) => b.is_active && allowed.includes(b.id) && !seen.has(b.id) && (seen.add(b.id), true)); }, [branches, allowed]);
  const brandName = (id?: string | null) => { const b = brands.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : null; };
  // อายุสต๊อก: เข้ามากี่วันแล้ว + สี (ยิ่งนานยิ่งแดง = ค้างนาน/ขายช้า)
  const stockAge = (iso?: string | null) => {
    if (!iso) return null;
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
    const tone = days > 150 ? "text-rose-500 font-semibold" : days > 90 ? "text-amber-600 font-medium" : days > 30 ? "text-ink/70" : "text-ok";
    return { days, dateLabel: new Date(iso).toLocaleDateString(locale === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", year: "2-digit" }), tone };
  };
  const xProduct = products.find((p) => p.id === xProductId) || null;
  // รายการสินค้า (กรองแบรนด์/หมวด/ค้นหา + dedupe) พร้อมยอด available รวมทุกสาขา
  const xProductList = useMemo(() => {
    const term = q.trim().toLowerCase(); const seen = new Set<string>();
    return products
      .filter((p) => p.kind !== "service" && p.is_active !== false && !seen.has(p.id) && (seen.add(p.id), true))
      .filter((p) => xBrand === "all" || p.brand_id === xBrand)
      .filter((p) => xCat === "all" || p.category_id === xCat)
      .filter((p) => { if (!term) return true; return p.name_th.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (brandName(p.brand_id)?.toLowerCase().includes(term) ?? false); })
      .map((p) => { let total = 0, nb = 0; for (const b of uniqBranches) { const r = stockMap.get(`${b.id}:${p.id}`); const av = r ? stockView(r).available : 0; total += av; if (av > 0) nb++; } return { p, total, nb }; });
  }, [products, q, xBrand, xCat, uniqBranches, stockMap, brands, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const xRows = useMemo(() => {
    if (!xProduct) return [] as { b: Branch; onHand: number; avail: number; km: number | null }[];
    const mc = coordOf(myBranch);
    return uniqBranches
      .map((b) => { const s = stockMap.get(`${b.id}:${xProduct.id}`); const sv = s ? stockView(s) : null; const bc = coordOf(b); return { b, onHand: sv?.onHand ?? 0, avail: sv?.available ?? 0, km: mc && bc ? haversineKm(mc, bc) : null }; })
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  }, [xProduct, uniqBranches, stockMap, myBranch]);
  const xTotalAvail = xRows.reduce((s, r) => s + r.avail, 0);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return stock
      .filter((s) => allowed.includes(s.branch_id))
      .filter((s) => (branchId === "all" ? true : s.branch_id === branchId))
      .map((s) => {
        const p = pMap.get(s.product_id);
        if (!p) return null;
        const rp = Math.max(s.reorder_point, p.reorder_point);
        const sv = stockView(s); // Stock = OnHand+OTWO · Available = Stock − ReservedOut − ReservedOrder
        const avail = sv.available;
        return { s, p, rp, sv, avail, low: rp > 0 && avail <= rp, out: avail <= 0 };
      })
      .filter(Boolean)
      .filter((r) => (!term ? true : r!.p.sku.toLowerCase().includes(term) || r!.p.name_th.toLowerCase().includes(term)))
      .filter((r) => (view === "low" ? r!.low : view === "out" ? r!.out : true))
      .sort((a, b) => a!.avail - b!.avail) as {
        s: StockLevel & { key: string }; p: Product; rp: number; sv: ReturnType<typeof stockView>; avail: number; low: boolean; out: boolean;
      }[];
  }, [stock, allowed, branchId, pMap, q, view]);

  const showCost = can(employee, "report.cost");
  const stockValue = rows.reduce((sum, r) => sum + r.s.qty_on_hand * r.p.cost, 0);
  const lowCount = rows.filter((r) => r.low).length;
  const outCount = rows.filter((r) => r.out).length;

  function exportCsv() {
    const head = ["branch", "sku", "name", "qty_on_hand", "reorder_point", "price", ...(showCost ? ["cost", "stock_value"] : [])];
    const lines = rows.map((r) =>
      [
        bMap.get(r.s.branch_id)?.name ?? "",
        r.p.sku,
        `"${r.p.name_th.replace(/"/g, '""')}"`,
        r.s.qty_on_hand,
        r.rp,
        r.p.price,
        ...(showCost ? [r.p.cost, r.s.qty_on_hand * r.p.cost] : []),
      ].join(",")
    );
    const url = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `shd-pos-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="SKU" value={formatInt(rows.length)} icon={<AnimatedBox size={16} />} />
        <KpiTile label={t.inventory.lowStock} value={formatInt(lowCount)} tone="warn" icon={<AlertTriangle size={15} />} />
        <KpiTile label={t.pos.outOfStock} value={formatInt(outCount)} tone="danger" />
        {showCost ? <KpiTile label={L("มูลค่าสต๊อก (ต้นทุน)", "Stock value (cost)", "库存价值（成本）")} value={formatTHB(stockValue)} tone="brand" /> : <KpiTile label={t.common.branch} value={formatInt(allowed.length)} />}
      </div>

      <Card>
        <CardHeader
          title={t.inventory.title}
          right={
            <Button variant="ghost" className="h-9" onClick={exportCsv}>
              <Download size={15} /> CSV
            </Button>
          }
        />
        <div className="px-4 pt-3">
          <Segmented size="sm" value={scope} onChange={setScope}
            options={[{ value: "byBranch" as const, label: L("รายสาขา", "By branch", "按门店") }, { value: "crossBranch" as const, label: L("ค้นหาข้ามสาขา", "Across branches", "跨店查询") }]} />
        </div>
        {scope === "byBranch" ? (<>
        <div className="p-4 flex flex-wrap gap-2">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "all" as const, label: t.common.all },
              { value: "low" as const, label: t.inventory.lowStock },
              { value: "out" as const, label: t.pos.outOfStock },
            ]}
          />
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input h-9 w-56">
            <option value="all">{t.common.all} {t.common.branch}</option>
            {branches
              .filter((b) => allowed.includes(b.id))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {locale === "th" ? b.name_th ?? b.name : b.name}
                </option>
              ))}
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
          </div>
        </div>

        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.branch}</Th>
                <Th>SKU</Th>
                <Th>{t.admin.products}</Th>
                <Th align="right">{t.inventory.onHand}</Th>
                <Th align="right">{L("กำลังส่งออก", "On the way out", "在途出")}</Th>
                <Th align="right">{L("สต๊อกรวม", "Stock", "总库存")}</Th>
                <Th align="right">{L("จอง(โอน)", "Reserved out", "调出预留")}</Th>
                <Th align="right">{L("จอง(ออเดอร์)", "Reserved order", "订单预留")}</Th>
                <Th align="right">{L("พักตรวจ", "Quarantine", "暂扣")}</Th>
                <Th align="right">{L("พร้อมขาย", "Available", "可售")}</Th>
                <Th align="right">{L("อายุสต๊อก", "Stock age", "库龄")}</Th>
                <Th align="right">{t.inventory.reorder}</Th>
                {showCost ? <Th align="right">{L("มูลค่า", "Value", "价值")}</Th> : null}
                <Th align="center">{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r) => (
                <tr key={r.s.key} className={r.out ? "bg-danger/5" : r.low ? "bg-warn/5" : ""}>
                  <Td className="text-xs text-muted truncate max-w-[150px]">
                    {bMap.get(r.s.branch_id) ? (locale === "th" ? bMap.get(r.s.branch_id)!.name_th ?? "" : bMap.get(r.s.branch_id)!.name) : ""}
                  </Td>
                  <Td className="font-mono text-[11px] text-muted">{r.p.sku}</Td>
                  <Td className="text-xs font-medium truncate max-w-[220px]">{pick({ th: r.p.name_th, en: r.p.name_en, zh: r.p.name_zh })}</Td>
                  <Td align="right" className="tnum">{r.sv.onHand}</Td>
                  <Td align="right" className={`tnum text-xs ${r.sv.otwo ? "text-sky-600" : "text-muted"}`}>{r.sv.otwo || "—"}</Td>
                  <Td align="right" className="tnum text-xs font-medium">{r.sv.stock}</Td>
                  <Td align="right" className={`tnum text-xs ${r.sv.reservedOut ? "text-amber-600" : "text-muted"}`}>{r.sv.reservedOut || "—"}</Td>
                  <Td align="right" className={`tnum text-xs ${r.sv.reservedOrder ? "text-violet-600" : "text-muted"}`}>{r.sv.reservedOrder || "—"}</Td>
                  <Td align="right" className={`tnum text-xs ${r.sv.quarantine ? "text-rose-600 font-medium" : "text-muted"}`}>{r.sv.quarantine || "—"}</Td>
                  <Td align="right" className={`font-semibold tnum ${r.out ? "text-danger" : r.low ? "text-warn" : "text-ok"}`}>{r.avail}</Td>
                  <Td align="right" className="text-xs">{(() => { const a = stockAge(r.s.last_in_at); return a ? <span className={`${a.tone} tnum`} title={`${L("เข้าคลังเมื่อ", "received", "入库")} ${a.dateLabel}`}>{a.days} {L("วัน", "d", "天")}</span> : <span className="text-muted/40">—</span>; })()}</Td>
                  <Td align="right" className="text-xs text-muted">{r.rp || "—"}</Td>
                  {showCost ? <Td align="right" className="text-xs">{formatTHB(r.s.qty_on_hand * r.p.cost, false)}</Td> : null}
                  <Td align="center">
                    {r.out ? <Badge tone="danger">{t.pos.outOfStock}</Badge> : r.low ? <Badge tone="warn">{t.inventory.lowStock}</Badge> : <Badge tone="ok">OK</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<Boxes size={26} />} title={t.common.empty} />
        )}
        </>) : (
          /* ── ค้นหาข้ามสาขา: เลือกสินค้า → สต๊อกทุกสาขา เรียงใกล้สาขาฉัน ── */
          <div className="p-4 space-y-3">
            {!xProduct ? (
              <>
                {/* ตัวกรอง: แบรนด์ + หมวด + ค้นหา */}
                <div className="flex flex-wrap gap-2">
                  <select value={xBrand} onChange={(e) => setXBrand(e.target.value)} className="input h-9 w-auto min-w-[150px]">
                    <option value="all">{L("ทุกแบรนด์", "All brands", "所有品牌")}</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
                  </select>
                  <select value={xCat} onChange={(e) => setXCat(e.target.value)} className="input h-9 w-auto min-w-[150px]">
                    <option value="all">{L("ทุกหมวด", "All categories", "所有分类")}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{locale === "th" ? c.name_th : c.name_en ?? c.name_th}</option>)}
                  </select>
                  <div className="relative flex-1 min-w-[180px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาสินค้า (ชื่อ/SKU/แบรนด์)", "Search product (name/SKU/brand)", "搜索商品")} className="pl-9 h-9" /></div>
                </div>
                <p className="text-[11px] text-muted">{L("พบ", "Found", "找到")} {xProductList.length} {L("รายการ", "items", "项")}{(xBrand !== "all" || xCat !== "all" || q.trim()) ? <button onClick={() => { setXBrand("all"); setXCat("all"); setQ(""); }} className="ml-2 text-brand hover:underline">{L("ล้างตัวกรอง", "Clear", "清除")}</button> : null}</p>
                <div className="max-h-[520px] overflow-auto rounded-xl border border-line divide-y divide-line/60">
                  {xProductList.slice(0, 120).map(({ p, total, nb }) => (
                    <button key={p.id} onClick={() => setXProductId(p.id)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-brand/5 text-left">
                      {p.image_url ? <img src={p.image_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-line bg-white shrink-0" /> : <div className="w-9 h-9 rounded-lg border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={15} /></div>}
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</p><p className="text-[10px] text-muted truncate"><span className="font-mono">{p.sku}</span>{brandName(p.brand_id) ? ` · ${brandName(p.brand_id)}` : ""}</p></div>
                      <div className="text-right shrink-0"><p className={`text-sm font-bold tnum ${total > 0 ? "text-ok" : "text-muted"}`}>{total}</p><p className="text-[10px] text-muted">{L("มี", "in", "")} {nb} {L("สาขา", "br.", "店")}</p></div>
                    </button>
                  ))}
                  {!xProductList.length ? <div className="p-6 text-center text-xs text-muted">{t.common.empty}</div> : null}
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setXProductId("")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand/40 transition-colors w-fit">
                  <ArrowLeft size={15} /> {L("ย้อนกลับ", "Back", "返回")}
                </button>
                <div className="flex items-center gap-3 rounded-xl border border-line p-3">
                  {xProduct.image_url ? <img src={xProduct.image_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-line bg-white" /> : <div className="w-12 h-12 rounded-lg border border-line bg-surface grid place-items-center text-muted/40"><Boxes size={18} /></div>}
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{pick({ th: xProduct.name_th, en: xProduct.name_en, zh: xProduct.name_zh })}</p><p className="font-mono text-[10px] text-muted">{xProduct.sku}</p></div>
                  <div className="text-right"><p className="text-lg font-bold text-ok tnum">{xTotalAvail}</p><p className="text-[10px] text-muted">{L("พร้อมขายรวมทุกสาขา", "available all branches", "全店可售")}</p></div>
                  <button onClick={() => setXProductId("")} className="text-xs text-brand hover:underline ml-1">{L("เปลี่ยน", "Change", "更换")}</button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <MapPin size={14} className="text-brand" /> {L("วัดระยะจากสาขา", "Distance from", "距离起点")}:
                  <select value={xRef} onChange={(e) => setXRef(e.target.value)} className="input h-8 w-56">
                    {branches.filter((b) => allowed.includes(b.id) && b.is_active).map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
                  </select>
                </div>
                <Table>
                  <thead><tr><Th>{t.common.branch}</Th><Th>{L("จังหวัด", "Province", "省")}</Th><Th align="right">{L("ระยะทาง", "Distance", "距离")}</Th><Th align="right">{t.inventory.onHand}</Th><Th align="right">{L("พร้อมขาย", "Available", "可售")}</Th></tr></thead>
                  <tbody>
                    {xRows.map((r, i) => (
                      <tr key={r.b.id} className={r.b.id === myBranch?.id ? "bg-brand/5" : ""}>
                        <Td className="text-xs font-medium truncate max-w-[200px]">{r.b.branch_type === "warehouse" ? "🏬 " : ""}{locale === "th" ? r.b.name_th ?? r.b.name : r.b.name}{r.b.id === myBranch?.id ? <Badge tone="brand" className="ml-1">{L("สาขาฉัน", "Mine", "本店")}</Badge> : i === xRows.findIndex((x) => x.avail > 0 && x.b.id !== myBranch?.id) && r.avail > 0 ? <Badge tone="ok" className="ml-1">{L("ใกล้สุด+มีของ", "Nearest", "最近")}</Badge> : null}</Td>
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
          </div>
        )}
      </Card>
    </div>
  );
}
