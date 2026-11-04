"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, AlertTriangle, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, stockAll, listBranches } from "@/lib/data/repo";
import type { Branch, Product, StockLevel } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, KpiTile, Segmented } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";

export default function AdminInventoryPage() {
  const { t, locale, pick } = useI18n();
  const { employee } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<(StockLevel & { key: string })[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "low" | "out">("all");
  const [branchId, setBranchId] = useState<string>("all");

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

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return stock
      .filter((s) => allowed.includes(s.branch_id))
      .filter((s) => (branchId === "all" ? true : s.branch_id === branchId))
      .map((s) => {
        const p = pMap.get(s.product_id);
        if (!p) return null;
        const rp = Math.max(s.reorder_point, p.reorder_point);
        return { s, p, rp, low: rp > 0 && s.qty_on_hand <= rp, out: s.qty_on_hand <= 0 };
      })
      .filter(Boolean)
      .filter((r) => (!term ? true : r!.p.sku.toLowerCase().includes(term) || r!.p.name_th.toLowerCase().includes(term)))
      .filter((r) => (view === "low" ? r!.low : view === "out" ? r!.out : true))
      .sort((a, b) => a!.s.qty_on_hand - b!.s.qty_on_hand) as {
        s: StockLevel & { key: string }; p: Product; rp: number; low: boolean; out: boolean;
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
        {showCost ? <KpiTile label="มูลค่าสต๊อก (ต้นทุน)" value={formatTHB(stockValue)} tone="brand" /> : <KpiTile label={t.common.branch} value={formatInt(allowed.length)} />}
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
                <Th align="right">{t.inventory.reorder}</Th>
                {showCost ? <Th align="right">มูลค่า</Th> : null}
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
                  <Td align="right" className={`font-semibold ${r.out ? "text-danger" : r.low ? "text-warn" : ""}`}>{r.s.qty_on_hand}</Td>
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
      </Card>
    </div>
  );
}
