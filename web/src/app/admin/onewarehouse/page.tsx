"use client";

import { useCatalogProducts } from "@/lib/hooks/use-catalog-products";
import Link from "next/link";
import { SyncControlPanel } from "@/components/admin/sync-control-panel";
import { OwDataPanel } from "@/components/admin/ow-data-panel";
import { OwSalesPanel } from "@/components/admin/ow-sales-panel";
import { OwLinksPanel } from "@/components/admin/ow-links-panel";
import { OwSalesmenPanel } from "@/components/admin/ow-salesmen-panel";
import { OwReconPanel } from "@/components/admin/ow-recon-panel";

// =====================================================================
// คลังกลาง (OneWarehouse) — แมพสินค้าของเรา ↔ สต๊อก/ราคา JST สด (ฟีเจอร์เดียวกับแอป)
//   จับคู่ด้วย SKU · โชว์ สต๊อกเรา vs OW, ราคาเรา vs OW, สถานะ sync
//   List mode uses paginated catalog import; exact-SKU tools below inspect individual items.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Cloud, CloudOff, CloudDownload, Search, RefreshCw, AlertTriangle, CheckCircle2, Boxes } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listProducts, stockAll, listBranches } from "@/lib/data/repo";
import type { Product, StockLevel, Branch } from "@/lib/types";
import { Card, Table, Th, Td, Badge, Input, Button, Select, KpiTile, EmptyState } from "@/components/ui";
import { branchForWarehouseId,loadWarehouseMap } from "@/lib/onewarehouse/warehouse-map";
import { formatTHB, formatInt } from "@/lib/money";
import {
  owStatus, owWarehouses, owStock, owProductBySku, owProducts,
  type OwStatus, type OwWarehouse, type OwProduct,
} from "@/lib/onewarehouse/ow-client";

type Row = { lookup: string; p: Product; ourOnHand: number | null; owQty: number | null; owPrice: number | null };
type JstRow = { sku: string; found: boolean; product: OwProduct | null; qty: number | null };

export default function AdminOneWarehousePage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [products, setProducts] = useCatalogProducts();
  const [ourStock, setOurStock] = useState<(StockLevel & { key: string })[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState<OwStatus | null>(null);
  const [warehouses, setWarehouses] = useState<OwWarehouse[]>([]);
  const [wh, setWh] = useState("33856");
  const [owStockMap, setOwStockMap] = useState<Record<string, number>>({});
  const [owPriceMap, setOwPriceMap] = useState<Record<string, number | null>>({});
  const [owExist, setOwExist] = useState<Record<string, boolean>>({}); // SKU ที่ "มีจริง" ใน OW (ยืนยันด้วย /products)
  const [checkedN, setCheckedN] = useState(0);
  const [lookup, setLookup] = useState<Record<string,string>>({});
  const syncGeneration = useRef(0);
  // ดึงจาก JST ตาม SKU (paste รายการ) — ใช้ exact lookup ที่ OW รองรับ
  const [jstSkus, setJstSkus] = useState("MOVA-Z200");
  const [jstRows, setJstRows] = useState<JstRow[]>([]);
  const [jstBusy, setJstBusy] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "matched" | "missing">("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"match" | "sales" | "recon" | "links" | "salesmen" | "sku" | "source" | "auto">("match");
  // เปิดแท็บตามลิงก์ ?tab=… (อ่านใน effect กัน hydration ไม่ตรง)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q && ["match", "sales", "recon", "links", "salesmen", "sku", "source", "auto"].includes(q)) setTab(q as typeof tab);
  }, []);

  // โหลดฐานของเรา + สถานะ OW
  useEffect(() => {
    void (async () => {
      await loadWarehouseMap().catch(()=>undefined);
      const [p, s, b, st] = await Promise.all([listProducts(), stockAll(), listBranches(), owStatus().catch(() => null)]);
      setProducts(p); setOurStock(s); setBranches(b); setStatus(st);
      if (st?.authConfigured) {
        const w = await owWarehouses().catch(() => null);
        if (w?.ok && w.data?.length) { setWarehouses(w.data); if (!w.data.find((x) => x.warehouse_id === wh)) setWh(w.data[0].warehouse_id); }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, []);

  const connected = !!status?.authConfigured;
  const mappedBranch = branchForWarehouseId(wh);
  const ourOnHandBySku = useMemo(() => {
    const byId = new Map<string, number>();
    if (!mappedBranch) return {} as Record<string,number>;
    for (const s of ourStock.filter(s => s.branch_id === mappedBranch)) byId.set(s.product_id, (byId.get(s.product_id) ?? 0) + (s.qty_on_hand ?? 0));
    return Object.fromEntries(products.map(p => [p.sku,byId.get(p.id) ?? 0]));
  }, [ourStock, products, mappedBranch]);

  // ดึงสต๊อก OW สดทุก SKU ของเรา (batch ≤50) + ราคาของ SKU ที่จับคู่ได้
  async function syncFromOw() {
    if (!connected) return;
    const generation=++syncGeneration.current;
    setSyncing(true); setCheckedN(0); setLookup({}); setOwStockMap({}); setOwExist({});
    try {
      const skus = products.map((p) => p.sku).filter(Boolean);
      // 1) สต๊อก (batch ≤50) — เลขยอด
      const smap: Record<string, number> = {};
      for (let i = 0; i < skus.length; i += 50) {
        const chunk = skus.slice(i, i + 50);
        const r = await owStock(wh, chunk);
        if (r.ok && r.data) for (const row of r.data) smap[row.sku] = row.qty;
      }
      if(generation!==syncGeneration.current)return;
      // 2) ยืนยัน "มีจริงใน OW" ด้วย /products — เพราะ /stock คืน 0 ให้ SKU ที่ไม่รู้จักด้วย (เลขเดียวเชื่อไม่ได้)
      //    ⚠️ ยังไม่มี bulk/paginated list ฝั่ง OW → ตรวจทีละ SKU (จำกัด 120 ตัว กัน N calls บานปลาย)
      const exist: Record<string, boolean> = {}; const pmap: Record<string, number | null> = {};
      const check = skus.slice(0, 120);
      const states:Record<string,string>={};
      for (let i = 0; i < check.length; i++) {
        const result = await owProducts(check[i]);
        if(generation!==syncGeneration.current)return;
        if(!result.ok) {states[check[i]]="error";continue;}
        const op = result.data?.find(p => p.sku.trim().toUpperCase()===check[i].trim().toUpperCase());
        states[check[i]]=op?"found":"missing";
        if(op){exist[check[i]]=true;pmap[check[i]]=op.sale_price;}
        if(i%5===0)setCheckedN(i+1);
      }
      if(generation===syncGeneration.current){setOwStockMap(smap);setLookup(states);setOwExist(exist);setOwPriceMap(pmap);setCheckedN(check.length);}
    } finally { if(generation===syncGeneration.current)setSyncing(false); }
  }
  useEffect(() => { if (connected && products.length) void syncFromOw(); return ()=>{syncGeneration.current++;}; /* eslint-disable-next-line */ }, [connected, products, wh]);

  // ดึงจาก JST ตาม SKU ที่ใส่ (exact lookup + stock) — ของจริงจาก JST ต่อให้ไม่มีในแคตตาล็อกเรา
  async function pullFromJst() {
    const skus = Array.from(new Set(jstSkus.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)));
    if (!skus.length) return;
    setJstBusy(true); setJstRows([]);
    try {
      const out: JstRow[] = [];
      for (const sku of skus) {
        const [p, st] = await Promise.all([owProductBySku(sku).catch(() => null), owStock(wh, [sku]).catch(() => null)]);
        out.push({ sku, found: !!p, product: p, qty: st?.ok && st.data?.length ? st.data[0].qty : null });
        setJstRows([...out]);
      }
    } finally { setJstBusy(false); }
  }

  const rows: Row[] = useMemo(() => products.map((p) => ({
    p, lookup:lookup[p.sku]??"unchecked", ourOnHand:mappedBranch ? (ourOnHandBySku[p.sku] ?? 0) : null,
    // "มีใน OW" = ยืนยันด้วย /products เท่านั้น (ไม่ใช่แค่ /stock คืน 0)
    owQty: owExist[p.sku] ? (owStockMap[p.sku] ?? null) : null,
    owPrice: owExist[p.sku] ? (owPriceMap[p.sku] ?? null) : null,
  })), [products, ourOnHandBySku, owStockMap, owPriceMap, owExist,lookup,mappedBranch]);

  const matchedN = useMemo(() => rows.filter((r) => r.lookup === "found").length, [rows]);
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (view === "matched" && r.lookup !== "found") return false;
      if (view === "missing" && r.lookup !== "missing") return false;
      if (kw && !(`${r.p.name_th} ${r.p.sku}`.toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [rows, q, view]);

  const missingN = rows.filter((r) => r.lookup === "missing").length;
  const diffN = rows.filter((r) => r.owQty !== null && r.ourOnHand !== null && r.owQty !== r.ourOnHand).length;
  const whOptions = warehouses.length ? warehouses.map((w) => w.warehouse_id) : ["33856", "33857"];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* ── หัวแถวเดียว ── */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${connected ? "bg-emerald-500/12" : "bg-surface2"}`}>
            {connected ? <Cloud size={18} className="text-emerald-600" /> : <CloudOff size={18} className="text-muted" />}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight leading-tight">{L("คลังกลาง (OneWarehouse)", "OneWarehouse", "中央仓")}</h1>
            <p className="text-[11px] text-muted">{L("สินค้าของเรา ↔ สต๊อก/ราคาสดจาก JST (จับคู่ด้วย SKU)", "Our catalog ↔ live JST stock/price", "商品↔JST实时")}</p>
          </div>
        </div>
        <nav className="flex rounded-2xl bg-surface/65 border border-line/70 p-1 gap-0.5 overflow-x-auto max-w-full">
          {([
            ["match", L("จับคู่สินค้า", "Matching", "匹配")],
            ["sales", L("ส่งบิลขาย", "Sales to OW", "销售推送")],
            ["recon", L("ตรวจความตรงกัน", "Reconciliation", "核对")],
            ["links", L("ผูกสาขา", "Branch links", "门店绑定")],
            ["salesmen", L("พนักงานขาย JST", "JST salespeople", "JST销售员")],
            ["sku", L("ตรวจ SKU รายตัว", "SKU lookup", "SKU查询")],
            ["source", L("ข้อมูลต้นทาง", "Source data", "源数据")],
            ["auto", L("ซิงก์อัตโนมัติ", "Auto sync", "自动同步")],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`h-8 px-3 rounded-xl text-xs whitespace-nowrap inline-flex items-center gap-1.5 transition ${tab === k ? "bg-brand text-brandInk shadow-sm" : "text-muted hover:bg-surface"}`}>
              {label}
              {k === "match" && diffN ? <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center bg-warn text-white">{diffN}</span> : null}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 ml-auto">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 h-7 rounded-full ${connected ? "bg-emerald-500/10 text-emerald-600" : "bg-surface2 text-muted"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted/40"}`} />
            {connected ? L("เชื่อมต่อแล้ว (สด)", "Connected (live)", "已连接") : L("ยังไม่เชื่อม", "Not connected", "未连接")}
          </span>
          <Link href="/admin/catalog-sync" className="h-9 px-3 rounded-xl bg-brand text-brandInk text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-90">
            <CloudDownload size={14} />{L("นำเข้าแคตตาล็อก", "Catalog import", "目录导入")}
          </Link>
        </div>
      </header>

      {!connected && !loading ? (
        <div className="rounded-xl border border-line bg-surface2 px-4 py-2.5 text-[12px] text-muted">{L("ยังไม่เชื่อมต่อ OneWarehouse — ตั้ง ONEWAREHOUSE_SERVICE_TOKEN ใน env (local/deploy) แล้วรีสตาร์ท", "Not connected — set ONEWAREHOUSE_SERVICE_TOKEN in env", "未连接")}</div>
      ) : null}

      {tab === "match" ? (
        <>
          {/* สรุป + เครื่องมือ (แถวเดียว) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label={L("สินค้าของเรา", "Our products", "商品数")} value={formatInt(products.length)} icon={<Boxes size={16} />} />
            <KpiTile label={L("จับคู่ใน OW", "Matched in OW", "匹配")} value={formatInt(matchedN)} tone={matchedN ? "ok" : undefined} icon={<CheckCircle2 size={16} />} />
            <KpiTile label={L("ยังไม่พบใน OW", "Not in OW", "未匹配")} value={formatInt(missingN)} tone={missingN ? "warn" : undefined} icon={<AlertTriangle size={16} />} />
            <KpiTile label={L("ยอดไม่ตรง", "Qty differs", "数量不符")} value={formatInt(diffN)} tone={diffN ? "warn" : undefined} icon={<RefreshCw size={16} />} />
          </div>
          <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
            <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาชื่อ/SKU", "Search name/SKU", "搜索")} className="pl-9 h-9" />
              </div>
              <div className="flex rounded-xl bg-surface2/70 p-0.5">
                {([["all", L("ทั้งหมด", "All", "全部")], ["matched", L("จับคู่ได้", "Matched", "匹配")], ["missing", L("ยังไม่พบ", "Not in OW", "未匹配")]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setView(k)} className={`h-8 px-3 rounded-lg text-xs ${view === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
                ))}
              </div>
              <Select value={wh} onChange={(e) => setWh(e.target.value)} className="!w-32 h-9">
                {whOptions.map((id) => <option key={id} value={id}>{L("คลัง", "WH", "仓")} {id}</option>)}
              </Select>
              <Button variant="soft" loading={syncing || loading} disabled={!connected} onClick={() => void syncFromOw()}><RefreshCw size={14} />{L("ซิงค์", "Sync", "同步")}</Button>
              <span className="text-[11px] text-muted w-full sm:w-auto">
                {syncing && checkedN > 0 ? `${L("ตรวจ", "Checking", "检查")} ${checkedN}/${Math.min(products.length, 120)} · ` : ""}
                {L("รอตรวจ", "Unchecked", "待检查")} {rows.filter((r) => r.lookup === "unchecked").length} · {L("อ่านไม่สำเร็จ", "Failed", "失败")} {rows.filter((r) => r.lookup === "error").length}
                {!mappedBranch ? <span className="text-warn"> · {L("คลังนี้ยังไม่ผูกสาขา (เทียบยอดเราไม่ได้)", "Warehouse not mapped to a branch", "未映射")}</span> : null}
              </span>
            </div>
            <div className="overflow-auto max-h-[calc(100vh-330px)] min-h-[320px]">
              <Table>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <Th>{L("สินค้า", "Product", "商品")}</Th>
                    <Th className="text-right">{L("สต๊อกเรา", "Our on-hand", "我方现货")}</Th>
                    <Th className="text-right">{L("สต๊อก OW (สด)", "OW on-hand", "OW现货")}</Th>
                    <Th className="text-right">{L("ราคาเรา", "Our price", "我方价")}</Th>
                    <Th className="text-right">{L("ราคา OW", "OW price", "OW价")}</Th>
                    <Th className="text-center">{L("สถานะ", "Sync", "状态")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length ? filtered.slice(0, 300).map((r) => {
                    const owQty = r.owQty;
                    const diff = owQty !== null && r.ourOnHand !== null && owQty !== r.ourOnHand;
                    return (
                      <tr key={r.p.id}>
                        <Td>
                          <div className="flex items-center gap-2.5 min-w-0">
                            {r.p.image_url ? <img src={r.p.image_url} alt="" className="w-9 h-9 rounded-lg object-contain border border-line bg-white shrink-0" loading="lazy" /> : <div className="w-9 h-9 rounded-lg bg-surface2/70 grid place-items-center shrink-0 text-muted/40"><Boxes size={14} /></div>}
                            <div className="min-w-0"><p className="text-sm font-medium truncate max-w-[320px]">{r.p.name_th}</p><p className="text-[10px] text-muted font-mono">{r.p.sku}</p></div>
                          </div>
                        </Td>
                        <Td className="text-right tabular-nums">{r.ourOnHand === null ? "—" : formatInt(r.ourOnHand)}</Td>
                        <Td className="text-right tabular-nums">{owQty === null ? <span className="text-muted/50">—</span> : <span className={diff ? "text-amber-600 font-semibold" : "text-emerald-600 font-medium"}>{formatInt(owQty)}</span>}</Td>
                        <Td className="text-right tabular-nums text-muted">{formatTHB(r.p.price, false)}</Td>
                        <Td className="text-right tabular-nums">{r.owPrice == null ? <span className="text-muted/50">—</span> : formatTHB(r.owPrice, false)}</Td>
                        <Td className="text-center">
                          {owQty === null ? <Badge tone="neutral">{r.lookup === "missing" ? L("ไม่พบจริง", "Not found", "未找到") : r.lookup === "error" ? L("อ่านไม่สำเร็จ", "Read failed", "读取失败") : L("ยังไม่ทราบยอด", "Not verified", "未核实")}</Badge>
                            : r.ourOnHand === null ? <Badge tone="neutral">{L("ยังไม่ผูกคลัง", "Not mapped", "未映射")}</Badge> : diff ? <Badge tone="warn">{L("ต่างกัน", "Differs", "不符")}</Badge>
                              : <Badge tone="ok">{L("ตรง", "In sync", "一致")}</Badge>}
                        </Td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={6} className="p-6"><EmptyState icon={<Cloud size={24} />} title={L("ไม่มีรายการ", "No rows", "无")} body={connected ? L("ลองกด ซิงค์ หรือเปลี่ยนตัวกรอง", "Try Sync or change filter", "试试同步") : L("เชื่อมต่อ OW ก่อน", "Connect OW first", "先连接")} /></td></tr>
                  )}
                </tbody>
              </Table>
            </div>
            {filtered.length > 300 ? <p className="text-center text-[11px] text-muted py-2 border-t border-line">{L(`แสดง 300 จาก ${filtered.length} — ใช้ค้นหา/กรองเพื่อแคบลง`, `Showing 300 of ${filtered.length}`, `显示300/${filtered.length}`)}</p> : null}
          </section>
        </>
      ) : tab === "sku" ? (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="p-4 space-y-3 self-start">
            <p className="text-sm font-semibold inline-flex items-center gap-1.5"><Cloud size={15} className="text-brand" />{L("ดึงจาก JST ตาม SKU", "Pull from JST by SKU", "按SKU拉取")}</p>
            <p className="text-[11.5px] text-muted leading-relaxed">{L("ใส่ SKU ได้หลายตัว คั่นด้วยเว้นวรรค/คอมมา/ขึ้นบรรทัด · ตรวจ exact SKU ทีละรายการ ส่วนการอ่านทั้งหมดใช้หน้านำเข้าแคตตาล็อก", "Multiple SKUs, separated by space/comma/newline", "多个SKU")}</p>
            <textarea value={jstSkus} onChange={(e) => setJstSkus(e.target.value)} rows={6} placeholder="MOVA-Z200, ..." className="w-full rounded-xl bg-surface2 border border-line px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-brand/30 resize-y" />
            <div className="flex gap-2">
              <Select value={wh} onChange={(e) => setWh(e.target.value)} className="!w-32">{whOptions.map((id) => <option key={id} value={id}>{L("คลัง", "WH", "仓")} {id}</option>)}</Select>
              <Button variant="primary" className="flex-1" loading={jstBusy} disabled={!connected} onClick={() => void pullFromJst()}><Search size={15} />{L("ดึงจาก JST", "Pull", "拉取")}</Button>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line text-xs text-muted">{L("ผลลัพธ์", "Results", "结果")} {jstRows.length ? `(${jstRows.filter((r) => r.found).length}/${jstRows.length} ${L("พบ", "found", "找到")})` : ""}</div>
            {jstRows.length ? (
              <div className="divide-y divide-line/60 max-h-[calc(100vh-280px)] overflow-auto">
                {jstRows.map((r) => (
                  <div key={r.sku} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[12px]">
                    <code className="font-mono text-[11px] w-36 shrink-0 truncate">{r.sku}</code>
                    {r.found && r.product ? <>
                      <span className="flex-1 min-w-[160px] truncate font-medium">{r.product.name || "—"}{r.product.brand ? <span className="text-muted font-normal"> · {r.product.brand}</span> : null}</span>
                      <span className="text-muted tabular-nums">{L("ราคา", "price", "价")} {r.product.sale_price == null ? "—" : formatTHB(r.product.sale_price, false)}</span>
                      <span className="tabular-nums">{L("สต๊อก", "stock", "库")} <b className="text-emerald-600">{r.qty ?? "—"}</b></span>
                      <Badge tone={r.product.serial_tracking === true ? "brand" : r.product.serial_tracking === null ? "warn" : "neutral"}>{r.product.serial_tracking === true ? "SN" : r.product.serial_tracking === null ? L("ยังไม่จัด", "?", "?") : L("ไม่มี SN", "no-SN", "无")}</Badge>
                      <Badge tone="ok">{L("พบใน JST", "in JST", "有")}</Badge>
                    </> : <><span className="flex-1 text-muted">—</span><Badge tone="neutral">{L("ไม่พบใน JST", "not in JST", "无")}</Badge></>}
                  </div>
                ))}
              </div>
            ) : <div className="py-16"><EmptyState icon={<Search size={22} />} title={L("ยังไม่มีผลลัพธ์", "No results yet", "暂无结果")} body={L("ใส่ SKU ทางซ้ายแล้วกด ดึงจาก JST", "Enter SKUs on the left and pull", "输入SKU")} /></div>}
          </Card>
        </div>
      ) : tab === "sales" ? (
        <OwSalesPanel />
      ) : tab === "recon" ? (
        <OwReconPanel />
      ) : tab === "links" ? (
        <OwLinksPanel warehouses={warehouses} />
      ) : tab === "salesmen" ? (
        <OwSalesmenPanel />
      ) : tab === "source" ? (
        <OwDataPanel />
      ) : (
        <SyncControlPanel />
      )}
    </div>
  );
}
