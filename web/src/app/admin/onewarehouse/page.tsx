"use client";

// =====================================================================
// คลังกลาง (OneWarehouse) — แมพสินค้าของเรา ↔ สต๊อก/ราคา JST สด (ฟีเจอร์เดียวกับแอป)
//   จับคู่ด้วย SKU · โชว์ สต๊อกเรา vs OW, ราคาเรา vs OW, สถานะ sync
//   ⚠️ ปลายทาง JST UAT (test) — SKU จริงเรายังไม่โหลดเข้า (ลองด่วนด้วย MOVA-Z200)
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Cloud, CloudOff, Search, RefreshCw, AlertTriangle, CheckCircle2, Boxes } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listProducts, stockAll, listBranches } from "@/lib/data/repo";
import type { Product, StockLevel, Branch } from "@/lib/types";
import { Card, Table, Th, Td, Badge, Input, Button, Select, KpiTile, EmptyState } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import {
  owStatus, owWarehouses, owStock, owProductBySku,
  type OwStatus, type OwWarehouse,
} from "@/lib/onewarehouse/ow-client";

type Row = { p: Product; ourOnHand: number; owQty: number | null; owPrice: number | null };

export default function AdminOneWarehousePage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [products, setProducts] = useState<Product[]>([]);
  const [ourStock, setOurStock] = useState<(StockLevel & { key: string })[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState<OwStatus | null>(null);
  const [warehouses, setWarehouses] = useState<OwWarehouse[]>([]);
  const [wh, setWh] = useState("33856");
  const [owStockMap, setOwStockMap] = useState<Record<string, number>>({});
  const [owPriceMap, setOwPriceMap] = useState<Record<string, number | null>>({});
  const [owExist, setOwExist] = useState<Record<string, boolean>>({}); // SKU ที่ "มีจริง" ใน OW (ยืนยันด้วย /products)
  const [checkedN, setCheckedN] = useState(0);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "matched" | "missing">("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // โหลดฐานของเรา + สถานะ OW
  useEffect(() => {
    void (async () => {
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
  const ourOnHandBySku = useMemo(() => {
    const byId = new Map<string, number>();
    for (const s of ourStock) byId.set(s.product_id, (byId.get(s.product_id) ?? 0) + (s.qty_on_hand ?? 0));
    const m: Record<string, number> = {};
    for (const p of products) m[p.sku] = byId.get(p.id) ?? 0;
    return m;
  }, [ourStock, products]);

  // ดึงสต๊อก OW สดทุก SKU ของเรา (batch ≤50) + ราคาของ SKU ที่จับคู่ได้
  async function syncFromOw() {
    if (!connected) return;
    setSyncing(true); setCheckedN(0);
    try {
      const skus = products.map((p) => p.sku).filter(Boolean);
      // 1) สต๊อก (batch ≤50) — เลขยอด
      const smap: Record<string, number> = {};
      for (let i = 0; i < skus.length; i += 50) {
        const chunk = skus.slice(i, i + 50);
        const r = await owStock(wh, chunk);
        if (r.ok && r.data) for (const row of r.data) smap[row.sku] = row.qty;
      }
      setOwStockMap(smap);
      // 2) ยืนยัน "มีจริงใน OW" ด้วย /products — เพราะ /stock คืน 0 ให้ SKU ที่ไม่รู้จักด้วย (เลขเดียวเชื่อไม่ได้)
      //    ⚠️ ยังไม่มี bulk/paginated list ฝั่ง OW → ตรวจทีละ SKU (จำกัด 120 ตัว กัน N calls บานปลาย)
      const exist: Record<string, boolean> = {}; const pmap: Record<string, number | null> = {};
      const check = skus.slice(0, 120);
      for (let i = 0; i < check.length; i++) {
        const op = await owProductBySku(check[i]).catch(() => null);
        if (op) { exist[check[i]] = true; pmap[check[i]] = op.sale_price; }
        if (i % 5 === 0) setCheckedN(i + 1);
      }
      setOwExist(exist); setOwPriceMap(pmap); setCheckedN(check.length);
    } finally { setSyncing(false); }
  }
  useEffect(() => { if (connected && products.length) void syncFromOw(); /* eslint-disable-next-line */ }, [connected, products.length, wh]);

  const rows: Row[] = useMemo(() => products.map((p) => ({
    p, ourOnHand: ourOnHandBySku[p.sku] ?? 0,
    // "มีใน OW" = ยืนยันด้วย /products เท่านั้น (ไม่ใช่แค่ /stock คืน 0)
    owQty: owExist[p.sku] ? (owStockMap[p.sku] ?? 0) : null,
    owPrice: owExist[p.sku] ? (owPriceMap[p.sku] ?? null) : null,
  })), [products, ourOnHandBySku, owStockMap, owPriceMap, owExist]);

  const matchedN = useMemo(() => rows.filter((r) => r.owQty !== null).length, [rows]);
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (view === "matched" && r.owQty === null) return false;
      if (view === "missing" && r.owQty !== null) return false;
      if (kw && !(`${r.p.name_th} ${r.p.sku}`.toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [rows, q, view]);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`w-11 h-11 rounded-2xl grid place-items-center ${connected ? "bg-emerald-500/12" : "bg-surface2"}`}>
            {connected ? <Cloud size={22} className="text-emerald-600" /> : <CloudOff size={22} className="text-muted" />}
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("คลังกลาง (OneWarehouse)", "OneWarehouse", "中央仓")}</h1>
            <p className="text-[11px] text-muted">{L("สินค้าของเรา ↔ สต๊อก/ราคาสดจาก JST (จับคู่ด้วย SKU)", "Our catalog ↔ live JST stock/price (matched by SKU)", "商品↔JST实时")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${connected ? "bg-emerald-500/10 text-emerald-600" : "bg-surface2 text-muted"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted/40"}`} />
            {connected ? L("เชื่อมต่อแล้ว (สด)", "Connected (live)", "已连接") : L("ยังไม่เชื่อม", "Not connected", "未连接")}
          </span>
          {syncing && checkedN > 0 ? <span className="text-[11px] text-muted tabular-nums">{L("ตรวจ", "Checking", "检查")} {checkedN}/{Math.min(products.length, 120)}</span> : null}
          <Button variant="soft" loading={syncing || loading} disabled={!connected} onClick={() => void syncFromOw()}><RefreshCw size={14} /> {L("ซิงค์", "Sync", "同步")}</Button>
        </div>
      </div>

      {/* UAT NOTICE */}
      {connected ? (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-50/60 dark:bg-amber-500/5 px-4 py-2.5 flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-300">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>{L("เชื่อมต่อสำเร็จ — แต่ปลายทางเป็น JST UAT (ทดสอบ) ที่ยังไม่มี SKU จริงของเรา จึงจับคู่ได้ 0 ตอนนี้ · พอทีม OW โหลด SKU/สาขาจริงเข้า UAT แล้ว ตัวเลขสต๊อก/ราคา OW จะขึ้นอัตโนมัติ",
            "Connected — but JST UAT (test) has none of our real SKUs yet, so 0 matched. OW stock/price fills in automatically once real SKUs are loaded into UAT.",
            "已连接·当前JST UAT无我方SKU")}</span>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface2 px-4 py-2.5 text-[12px] text-muted">{L("ยังไม่เชื่อมต่อ OneWarehouse — ตั้ง ONEWAREHOUSE_SERVICE_TOKEN ใน env (local/deploy) แล้วรีสตาร์ท", "Not connected — set ONEWAREHOUSE_SERVICE_TOKEN in env", "未连接")}</div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label={L("สินค้าของเรา", "Our products", "商品数")} value={formatInt(products.length)} icon={<Boxes size={16} />} />
        <KpiTile label={L("จับคู่ใน OW", "Matched in OW", "匹配")} value={formatInt(matchedN)} tone={matchedN ? "ok" : undefined} icon={<CheckCircle2 size={16} />} />
        <KpiTile label={L("ยังไม่พบใน OW", "Not in OW", "未匹配")} value={formatInt(products.length - matchedN)} tone={products.length - matchedN ? "warn" : undefined} icon={<AlertTriangle size={16} />} />
        <KpiTile label={L("คลังที่เลือก", "Warehouse", "仓")} value={wh} icon={<Cloud size={16} />} />
      </div>

      {/* CONTROLS */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาชื่อ/SKU", "Search name/SKU", "搜索")} className="pl-9" />
        </div>
        <Select value={view} onChange={(e) => setView(e.target.value as typeof view)} className="w-36">
          <option value="all">{L("ทั้งหมด", "All", "全部")}</option>
          <option value="matched">{L("จับคู่ได้", "Matched", "匹配")}</option>
          <option value="missing">{L("ยังไม่พบ", "Not in OW", "未匹配")}</option>
        </Select>
        <Select value={wh} onChange={(e) => setWh(e.target.value)} className="w-32">
          {(warehouses.length ? warehouses.map((w) => w.warehouse_id) : ["33856", "33857"]).map((id) => <option key={id} value={id}>{L("คลัง", "WH", "仓")} {id}</option>)}
        </Select>
      </div>

      {/* TABLE */}
      <Card>
        <Table>
          <thead>
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
              const diff = owQty !== null && owQty !== r.ourOnHand;
              return (
                <tr key={r.p.id}>
                  <Td>
                    <div className="flex items-center gap-2.5 min-w-0">
                      {r.p.image_url ? <img src={r.p.image_url} alt="" className="w-8 h-8 rounded-lg object-cover border border-line bg-white shrink-0" loading="lazy" /> : <div className="w-8 h-8 rounded-lg border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={13} /></div>}
                      <div className="min-w-0"><p className="text-sm font-medium truncate">{r.p.name_th}</p><p className="text-[10px] text-muted font-mono">{r.p.sku}</p></div>
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatInt(r.ourOnHand)}</Td>
                  <Td className="text-right tabular-nums">{owQty === null ? <span className="text-muted/50">—</span> : <span className={diff ? "text-amber-600 font-semibold" : "text-emerald-600 font-medium"}>{formatInt(owQty)}</span>}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatTHB(r.p.price, false)}</Td>
                  <Td className="text-right tabular-nums">{r.owPrice == null ? <span className="text-muted/50">—</span> : formatTHB(r.owPrice, false)}</Td>
                  <Td className="text-center">
                    {owQty === null ? <Badge tone="neutral">{L("ไม่พบ", "Not in OW", "未匹配")}</Badge>
                      : diff ? <Badge tone="warn">{L("ต่างกัน", "Differs", "不符")}</Badge>
                        : <Badge tone="ok">{L("ตรง", "In sync", "一致")}</Badge>}
                  </Td>
                </tr>
              );
            }) : (
              <tr><td colSpan={6} className="p-6"><EmptyState icon={<Cloud size={24} />} title={L("ไม่มีรายการ", "No rows", "无")} body={connected ? L("ลองกด ซิงค์ หรือเปลี่ยนตัวกรอง", "Try Sync or change filter", "试试同步") : L("เชื่อมต่อ OW ก่อน", "Connect OW first", "先连接")} /></td></tr>
            )}
          </tbody>
        </Table>
      </Card>
      {filtered.length > 300 ? <p className="text-center text-[11px] text-muted">{L(`แสดง 300 จาก ${filtered.length} — ใช้ค้นหา/กรองเพื่อแคบลง`, `Showing 300 of ${filtered.length}`, `显示300/${filtered.length}`)}</p> : null}
    </div>
  );
}
