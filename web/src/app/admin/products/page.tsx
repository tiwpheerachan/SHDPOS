"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Search, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, listBrands, listCategories } from "@/lib/data/repo";
import type { Brand, Category, Product } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, Select } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { can } from "@/lib/permissions";

export default function AdminProductsPage() {
  const { t, pick } = useI18n();
  const { employee } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [brandId, setBrandId] = useState("all");

  useEffect(() => {
    void (async () => {
      const [p, b, c] = await Promise.all([listProducts(), listBrands(), listCategories()]);
      setProducts(p);
      setBrands(b);
      setCategories(c);
    })();
  }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => (brandId === "all" ? true : p.brand_id === brandId))
      .filter((p) => (!term ? true : p.sku.toLowerCase().includes(term) || p.name_th.toLowerCase().includes(term) || p.barcodes.some((b) => b.includes(term))));
  }, [products, q, brandId]);

  const showCost = can(employee, "report.cost");
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name_th ?? "—";

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Card>
        <CardHeader
          title={t.admin.products}
          subtitle={`${rows.length} SKU — ข้อมูลสินค้าจริงจะ import จากฐานข้อมูลของคุณ (ดู docs/08-api-reference.md)`}
        />
        <div className="p-4 flex flex-wrap gap-2">
          <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="h-9 w-44">
            <option value="all">{t.common.all} {t.common.brand}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t.common.search} SKU / ${t.admin.products} / barcode`} className="pl-9 h-9" />
          </div>
        </div>

        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>{t.admin.products}</Th>
                <Th>{t.common.brand}</Th>
                <Th>หมวด</Th>
                <Th align="right">{t.common.price}</Th>
                {showCost ? <Th align="right">ต้นทุน</Th> : null}
                {showCost ? <Th align="right">GP%</Th> : null}
                <Th align="center">Serial</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const base = p.price / 1.07;
                const gp = base > 0 ? ((base - p.cost) / base) * 100 : 0;
                return (
                  <tr key={p.id} className="hover:bg-surface2/60">
                    <Td className="font-mono text-[11px] text-muted">{p.sku}</Td>
                    <Td>
                      <p className="text-xs font-medium">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</p>
                      <p className="text-[10px] font-mono text-muted">{p.barcodes[0] ?? ""}</p>
                    </Td>
                    <Td className="text-xs">{brands.find((b) => b.id === p.brand_id)?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{catName(p.category_id)}</Td>
                    <Td align="right" className="font-medium">{formatTHB(p.price, false)}</Td>
                    {showCost ? <Td align="right" className="text-xs text-muted">{formatTHB(p.cost, false)}</Td> : null}
                    {showCost ? (
                      <Td align="right" className={`text-xs ${gp >= 35 ? "text-ok" : gp >= 20 ? "text-warn" : "text-danger"}`}>
                        {p.cost > 0 ? `${gp.toFixed(1)}%` : "—"}
                      </Td>
                    ) : null}
                    <Td align="center">
                      {p.track_serial ? <Badge tone="info">SN</Badge> : p.kind !== "goods" ? <Badge tone="neutral">{p.kind}</Badge> : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<Package size={26} />} title={t.common.empty} />
        )}
      </Card>
    </div>
  );
}
