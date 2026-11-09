"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, stockForBranch, listCategories } from "@/lib/data/repo";
import type { Category, Product, StockLevel } from "@/lib/types";
import { Input, Select, Table, Th, Td, Badge, EmptyState, Segmented, SkeletonTable } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { ProductDrawer } from "@/components/pos/product-drawer";
import { XCircle } from "lucide-react";
import { formatTHB, formatInt } from "@/lib/money";
import { can } from "@/lib/permissions";

export default function PosStockPage() {
  const { t, pick, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const session = useSession();
  const employee = session.employee;
  const branchId = session.branchId;

  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, StockLevel>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "low" | "out">("all");
  const [catId, setCatId] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Product | null>(null);

  useEffect(() => {
    if (!branchId) return;
    void (async () => {
      setLoading(true);
      const [p, s, c] = await Promise.all([listProducts(), stockForBranch(branchId), listCategories()]);
      setProducts(p);
      setStock(s);
      setCategories(c);
      setLoading(false);
    })();
  }, [branchId]);

  // เปิด drawer อัตโนมัติเมื่อมาจาก Command Search (?focus=SKU)
  useEffect(() => {
    if (loading || !products.length) return;
    const sku = new URLSearchParams(window.location.search).get("focus");
    if (sku) { const p = products.find((x) => x.sku === sku); if (p) setSelected(p); }
  }, [loading, products]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; key: string };
      if (d?.kind === "product") { const p = products.find((x) => x.sku === d.key); if (p) setSelected(p); }
    };
    window.addEventListener("shd:focus", h);
    return () => window.removeEventListener("shd:focus", h);
  }, [products]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => stock.has(p.id))
      .map((p) => ({ p, s: stock.get(p.id)! }))
      .filter(({ p }) => (catId ? p.category_id === catId : true))
      .filter(({ p }) =>
        !term ? true : p.sku.toLowerCase().includes(term) || p.name_th.toLowerCase().includes(term) || (p.name_en ?? "").toLowerCase().includes(term)
      )
      .filter(({ p, s }) =>
        view === "low" ? s.qty_on_hand <= Math.max(s.reorder_point, p.reorder_point)
          : view === "out" ? s.qty_on_hand <= 0
          : true
      )
      .sort((a, b) => a.s.qty_on_hand - b.s.qty_on_hand);
  }, [products, stock, q, view, catId]);

  const counts = useMemo(() => {
    let total = 0, low = 0, out = 0;
    for (const p of products) {
      const s = stock.get(p.id);
      if (!s) continue;
      total++;
      if (s.qty_on_hand <= 0) out++;
      else if (s.qty_on_hand <= Math.max(s.reorder_point, p.reorder_point)) low++;
    }
    return { total, low, out };
  }, [products, stock]);

  if (!employee) return null;
  const showCost = can(employee, "report.cost");

  return (
    <PosPage
      title={t.inventory.title}
      icon={<Boxes size={18} />}
      actions={
        <>
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "all", label: t.common.all },
              { value: "low", label: t.inventory.lowStock },
              { value: "out", label: t.pos.outOfStock },
            ]}
          />
          <Select value={catId} onChange={(e) => setCatId(e.target.value)} className="w-40 h-9">
            <option value="">{t.common.all} · {t.admin.products}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{pick({ th: c.name_th, en: c.name_en, zh: c.name_zh })}</option>
            ))}
          </Select>
          <div className="relative w-full sm:w-60">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
          </div>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatChip label="SKU" value={formatInt(counts.total)} accent="lavender" icon={<Boxes size={16} />} />
        <StatChip label={t.inventory.lowStock} value={formatInt(counts.low)} accent={counts.low ? "peach" : "mint"} icon={<AlertTriangle size={16} />} />
        <StatChip label={t.pos.outOfStock} value={formatInt(counts.out)} accent={counts.out ? "coral" : "mint"} icon={<XCircle size={16} />} />
      </div>
      <TablePanel>
        {loading ? (
          <SkeletonTable rows={8} cols={showCost ? 7 : 6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>{t.admin.products}</Th>
                <Th align="right">{t.inventory.onHand}</Th>
                <Th align="right">{t.inventory.reorder}</Th>
                <Th align="right">{t.common.price}</Th>
                {showCost ? <Th align="right">{L("ต้นทุน", "Cost", "成本")}</Th> : null}
                <Th align="center">{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, s }) => {
                const rp = Math.max(s.reorder_point, p.reorder_point);
                const out = s.qty_on_hand <= 0;
                const low = !out && s.qty_on_hand <= rp;
                return (
                  <tr key={p.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setSelected(p)}>
                    <Td className="font-mono text-[11px] text-muted">{p.sku}</Td>
                    <Td className="text-xs font-medium">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</Td>
                    <Td align="right" className={`font-semibold ${out ? "text-danger" : low ? "text-warn" : ""}`}>
                      {s.qty_on_hand}
                    </Td>
                    <Td align="right" className="text-xs text-muted">{rp || "—"}</Td>
                    <Td align="right" className="text-xs">{formatTHB(p.price, false)}</Td>
                    {showCost ? <Td align="right" className="text-xs text-muted">{formatTHB(p.cost, false)}</Td> : null}
                    <Td align="center">
                      {out ? (
                        <Badge tone="danger">{t.pos.outOfStock}</Badge>
                      ) : low ? (
                        <Badge tone="warn">
                          <AlertTriangle size={9} /> {t.inventory.lowStock}
                        </Badge>
                      ) : (
                        <Badge tone="ok">OK</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<Boxes size={26} />} title={t.common.empty} />
        )}
      </TablePanel>
      </div>

      <ProductDrawer
        product={selected}
        branchId={branchId}
        onHand={selected ? stock.get(selected.id)?.qty_on_hand ?? 0 : 0}
        onClose={() => setSelected(null)}
      />
    </PosPage>
  );
}
