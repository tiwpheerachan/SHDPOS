"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, AlertTriangle, Download, MapPin } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, stockAll, listBranches } from "@/lib/data/repo";
import type { Branch, Product, StockLevel } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, KpiTile, Segmented } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import { stockView } from "@/lib/stock";
import { can, visibleBranchIds } from "@/lib/permissions";
import { coordOf, haversineKm, fmtKm } from "@/lib/geo";

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

  useEffect(() => {
    void (async () => {
      const [p, s, b] = await Promise.all([listProducts(), stockAll(), listBranches()]);
      setProducts(p);
      setStock(s);
      setBranches(b);
    })();
  }, []);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const pMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  // ค้นหาข้ามสาขา: สินค้า 1 ตัว → สต๊อกทุกสาขา เรียงตามใกล้สาขาฉัน
  const myBranch = useMemo(() => branches.find((b) => b.id === (xRef || sessionBranchId)) || branches.find((b) => b.id === employee?.home_branch_id) || branches.find((b) => allowed.includes(b.id)) || null, [branches, xRef, sessionBranchId, employee, allowed]);
  useEffect(() => { if (!xRef && myBranch) setXRef(myBranch.id); }, [myBranch, xRef]);
  const stockMap = useMemo(() => { const m = new Map<string, StockLevel>(); for (const s of stock) m.set(`${s.branch_id}:${s.product_id}`, s); return m; }, [stock]);
  const xProduct = products.find((p) => p.id === xProductId) || null;
  const xRows = useMemo(() => {
    if (!xProduct) return [] as { b: Branch; onHand: number; avail: number; km: number | null }[];
    const mc = coordOf(myBranch); const seen = new Set<string>();
    return branches
      .filter((b) => b.is_active && allowed.includes(b.id) && !seen.has(b.id) && (seen.add(b.id), true))
      .map((b) => { const s = stockMap.get(`${b.id}:${xProduct.id}`); const sv = s ? stockView(s) : null; const bc = coordOf(b); return { b, onHand: sv?.onHand ?? 0, avail: sv?.available ?? 0, km: mc && bc ? haversineKm(mc, bc) : null }; })
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  }, [xProduct, branches, allowed, stockMap, myBranch]);
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
        <KpiTile label="SKU" value={formatInt(rows.length)} icon={<Boxes size={15} />} />
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
                <Th align="right">{L("พร้อมขาย", "Available", "可售")}</Th>
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
                  <Td align="right" className={`font-semibold tnum ${r.out ? "text-danger" : r.low ? "text-warn" : "text-ok"}`}>{r.avail}</Td>
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
                <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาสินค้าเพื่อดูสต๊อกทุกสาขา (ชื่อ/SKU)", "Search a product to see stock across all branches", "搜索商品查看各店库存")} className="pl-9 h-10" /></div>
                <div className="max-h-[480px] overflow-auto rounded-xl border border-line divide-y divide-line/60">
                  {products.filter((p) => p.kind !== "service").filter((p) => { const term = q.trim().toLowerCase(); return !term || p.name_th.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term); }).slice(0, 50).map((p) => {
                    const total = branches.filter((b) => allowed.includes(b.id)).reduce((s, b) => { const r = stockMap.get(`${b.id}:${p.id}`); return s + (r ? stockView(r).available : 0); }, 0);
                    const nb = branches.filter((b) => allowed.includes(b.id) && (() => { const r = stockMap.get(`${b.id}:${p.id}`); return r && stockView(r).available > 0; })()).length;
                    return (
                      <button key={p.id} onClick={() => setXProductId(p.id)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-brand/5 text-left">
                        {p.image_url ? <img src={p.image_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-line bg-white shrink-0" /> : <div className="w-9 h-9 rounded-lg border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={15} /></div>}
                        <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</p><p className="font-mono text-[10px] text-muted">{p.sku}</p></div>
                        <div className="text-right shrink-0"><p className={`text-sm font-bold tnum ${total > 0 ? "text-ok" : "text-muted"}`}>{total}</p><p className="text-[10px] text-muted">{L("มี", "in", "")} {nb} {L("สาขา", "br.", "店")}</p></div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
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
