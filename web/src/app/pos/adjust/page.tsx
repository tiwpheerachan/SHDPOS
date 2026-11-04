"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Search, Save } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listProducts, stockForBranch, recordAdjustment } from "@/lib/data/repo";
import type { Product, StockLevel } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, EmptyState, Badge } from "@/components/ui";
import { PosPage, TablePanel } from "@/components/pos/page-shell";
import { can } from "@/lib/permissions";

export default function StockAdjustPage() {
  const { t, locale, pick } = useI18n();
  const toast = useToast();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, StockLevel>>(new Map());
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("correction");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const REASONS = [
    { code: "correction", label: L("แก้ให้ตรงจริง", "Correction", "更正") },
    { code: "damaged", label: L("ชำรุด/เสียหาย", "Damaged", "损坏") },
    { code: "found", label: L("พบสินค้าเพิ่ม", "Found", "盘盈") },
    { code: "lost", label: L("สูญหาย", "Lost / shrinkage", "丢失") },
    { code: "transfer_error", label: L("โอนผิดพลาด", "Transfer error", "调拨差错") },
    { code: "other", label: L("อื่น ๆ", "Other", "其他") },
  ];

  async function reload() {
    if (!branchId) return;
    const [p, s] = await Promise.all([listProducts(), stockForBranch(branchId)]);
    setProducts(p); setStock(s);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [branchId]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => p.is_stocked && stock.has(p.id))
      .filter((p) => (!term ? true : p.sku.toLowerCase().includes(term) || p.name_th.toLowerCase().includes(term) || (p.name_en ?? "").toLowerCase().includes(term)))
      .map((p) => ({ p, s: stock.get(p.id)! }));
  }, [products, stock, q]);

  const changed = useMemo(() => Object.entries(values).filter(([pid, v]) => {
    const s = stock.get(pid);
    return v !== "" && s && Number(v) !== s.qty_on_hand;
  }), [values, stock]);

  async function submit() {
    if (!employee || !branchId || !changed.length) return;
    setBusy(true);
    try {
      const lines = changed.map(([pid, v]) => {
        const s = stock.get(pid)!;
        const p = products.find((x) => x.id === pid)!;
        return { productId: pid, sku: p.sku, before: s.qty_on_hand, after: Number(v) };
      });
      const no = await recordAdjustment(branchId, employee.id, reason, note, lines);
      await reload();
      setValues({}); setNote("");
      toast.push({ tone: "ok", title: t.cmd.stockAdjust, body: `${no} · ${L("ปรับ", "adjusted", "调整")} ${lines.length} ${L("รายการ", "items", "项")}` });
    } finally {
      setBusy(false);
    }
  }

  if (!employee) return null;
  if (!can(employee, "inventory.adjust")) {
    return <div className="p-8 text-center text-sm text-muted">{L("ไม่มีสิทธิ์ปรับสต๊อก", "No permission to adjust stock", "无库存调整权限")}</div>;
  }

  return (
    <PosPage
      title={t.cmd.stockAdjust}
      icon={<SlidersHorizontal size={18} />}
      actions={
        <>
          {changed.length ? <Badge tone="warn">{changed.length} {L("รายการ", "items", "项")}</Badge> : null}
          <Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-40 h-9">
            {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </Select>
          <div className="relative w-full sm:w-56">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
          </div>
          <Button variant="primary" loading={busy} disabled={!changed.length} onClick={() => void submit()}>
            <Save size={15} /> {t.common.save}
          </Button>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("หมายเหตุ (แนบทุกบรรทัดที่ปรับ)", "Note (attached to this adjustment)", "备注")} className="h-9 max-w-md" />
        </div>
        <TablePanel>
          {rows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>{t.admin.products}</Th>
                  <Th align="right">{L("คงเหลือปัจจุบัน", "Current", "当前")}</Th>
                  <Th align="center">{L("ปรับเป็น", "Adjust to", "调整为")}</Th>
                  <Th align="right">{t.inventory.difference}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, s }) => {
                  const v = values[p.id] ?? "";
                  const diff = v === "" ? null : Number(v) - s.qty_on_hand;
                  return (
                    <tr key={p.id} className={diff ? "bg-warn/5" : ""}>
                      <Td className="font-mono text-[11px] text-muted">{p.sku}</Td>
                      <Td className="text-xs">{pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</Td>
                      <Td align="right" className="text-xs tnum">{s.qty_on_hand}</Td>
                      <Td align="center">
                        <Input value={v} inputMode="numeric"
                          onChange={(e) => setValues((c) => ({ ...c, [p.id]: e.target.value.replace(/[^\d]/g, "") }))}
                          className="h-8 w-20 text-center tnum" placeholder={String(s.qty_on_hand)} />
                      </Td>
                      <Td align="right" className={`tnum font-semibold ${diff === null ? "text-muted" : diff === 0 ? "text-muted" : diff < 0 ? "text-danger" : "text-ok"}`}>
                        {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={<SlidersHorizontal size={26} />} title={t.common.empty} />}
        </TablePanel>
      </div>
    </PosPage>
  );
}
