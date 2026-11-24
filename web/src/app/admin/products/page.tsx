"use client";

import { ProductReviewDrawer } from "@/components/admin/product-review-drawer";
import { useCatalogProducts } from "@/lib/hooks/use-catalog-products";

import { useEffect, useMemo, useState } from "react";
import { Package, Search, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listProducts, listBrands, listCategories } from "@/lib/data/repo";
import type { Brand, Category, Product } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, Select } from "@/components/ui";
import { ExportShareBar } from "@/components/admin/export-share";
import { formatTHB } from "@/lib/money";
import { can } from "@/lib/permissions";

export default function AdminProductsPage() {
  const { t, pick, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee } = useSession();
  const [products, setProducts] = useCatalogProducts();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviewId,setReviewId]=useState<string|null>(null);
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
          subtitle={L(
            `${rows.length} SKU ในแคตตาล็อก POS รวมสินค้านำเข้าจาก OW · ยังไม่เปิดใช้งาน ${products.filter(p=>!p.is_active).length} รายการ`,
            `${rows.length} SKUs in the POS catalog, including OW imports`,
            `${rows.length} 个 SKU — 真实商品数据将从您的数据库导入（见 docs/08-api-reference.md）`
          )}
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
          <ExportShareBar
            filename="products"
            title={t.admin.products}
            rows={rows}
            size="sm"
            columns={[
              { key: "sku", label: "SKU" },
              { key: "name_th", label: L("ชื่อสินค้า", "Product", "商品") },
              { key: "brand", label: t.common.brand, map: (p) => brands.find((b) => b.id === p.brand_id)?.name ?? "—" },
              { key: "category", label: L("หมวด", "Category", "分类"), map: (p) => catName(p.category_id) },
              { key: "price", label: t.common.price, map: (p) => formatTHB(p.price, false) },
              ...(showCost ? [
                { key: "cost", label: L("ต้นทุน", "Cost", "成本"), map: (p: typeof rows[number]) => formatTHB(p.cost, false) },
                { key: "gp", label: "GP%", map: (p: typeof rows[number]) => { const base = p.price / 1.07; return p.cost > 0 && base > 0 ? `${(((base - p.cost) / base) * 100).toFixed(1)}%` : "—"; } },
              ] : []),
              { key: "serial", label: "Serial", map: (p) => (p.serial_policy_confirmed === false ? L("ยังไม่ยืนยัน", "Unconfirmed", "未确认") : p.track_serial ? L("ใช่", "Yes", "是") : L("ไม่", "No", "否")) },
            ]}
          />
        </div>

        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th className="w-14">{L("รูป", "Image", "图")}</Th>
                <Th>SKU</Th>
                <Th>{t.admin.products}</Th>
                <Th>{t.common.brand}</Th>
                <Th>{L("หมวด", "Category", "分类")}</Th>
                <Th align="right">{t.common.price}</Th>
                {showCost ? <Th align="right">{L("ต้นทุน", "Cost", "成本")}</Th> : null}
                {showCost ? <Th align="right">GP%</Th> : null}
                <Th align="center">Serial</Th><Th>สถานะ</Th><Th>ตรวจสินค้า</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const base = p.price / 1.07;
                const gp = base > 0 ? ((base - p.cost) / base) * 100 : 0;
                return (
                  <tr key={p.id} className="hover:bg-surface2/60">
                    <Td>
                      <div className="w-11 h-11 rounded-lg border border-line bg-surface2 overflow-hidden grid place-items-center shrink-0" title={p.image_url ? undefined : L("ยังไม่มีรูป", "No image yet", "暂无图片")}>
                        {p.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.image_url} alt={p.name_th} className="w-full h-full object-cover" />
                          : <Package size={16} className="text-muted/40" />}
                      </div>
                    </Td>
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
                      {p.serial_policy_confirmed === false ? <Badge tone="warn">ยังไม่ยืนยัน SN</Badge> : p.track_serial ? <Badge tone="info">SN ทุกชิ้น</Badge> : <Badge tone="neutral">ไม่ใช้ SN</Badge>}
                    </Td>
                    <Td><Badge tone={p.is_active?"ok":"warn"}>{p.is_active?"เปิดใช้งาน":"รอตรวจ / ปิดขาย"}</Badge></Td>
                    <Td>{can(employee,"admin.product_manage")&&showCost?<Button variant="soft" onClick={()=>setReviewId(p.id)}>ตรวจและตั้งค่า</Button>:null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<Package size={26} />} title={t.common.empty} />
        )}
      </Card>
      <ProductReviewDrawer id={reviewId} onClose={()=>setReviewId(null)}/>
    </div>
  );
}
