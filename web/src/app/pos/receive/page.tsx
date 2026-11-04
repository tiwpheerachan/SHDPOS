"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { PackagePlus, Search, Plus, Trash2, Save } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listProducts, stockForBranch, recordGoodsReceipt, listAudit } from "@/lib/data/repo";
import type { AuditEntry, Product, StockLevel } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, EmptyState, Badge, Field, Skeleton } from "@/components/ui";
import { PosPage, TablePanel } from "@/components/pos/page-shell";
import { formatInt } from "@/lib/money";
import { can } from "@/lib/permissions";

interface Line { id: string; product_id: string; sku: string; name: string; qty: number }

export default function GoodsReceivePage() {
  const { t, locale, pick } = useI18n();
  const toast = useToast();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, StockLevel>>(new Map());
  const [recent, setRecent] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplier, setSupplier] = useState("");
  const [poRef, setPoRef] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pickId, setPickId] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!branchId) return;
    setLoading(true);
    const [p, s, a] = await Promise.all([listProducts(), stockForBranch(branchId), listAudit({ branchIds: [branchId] })]);
    setProducts(p); setStock(s); setRecent(a.filter((x) => x.action === "receive").slice(0, 60)); setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [branchId]);

  function addLine() {
    const p = products.find((x) => x.id === pickId); if (!p) return;
    setLines((l) => [...l, { id: nanoid(), product_id: p.id, sku: p.sku, name: p.name_th, qty: 1 }]); setPickId("");
  }
  const totalUnits = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

  async function submit() {
    if (!branchId || !employee || !lines.length) return;
    setBusy(true);
    try {
      const grNo = await recordGoodsReceipt(branchId, employee.id, supplier, poRef, note, lines.map((l) => ({ productId: l.product_id, sku: l.sku, name: l.name, qty: l.qty })));
      setLines([]); setSupplier(""); setPoRef(""); setNote("");
      await reload();
      toast.push({ tone: "ok", title: t.cmd.goodsReceipt, body: `${grNo} · +${totalUnits} ${L("ชิ้น", "units", "件")}` });
    } finally { setBusy(false); }
  }

  // group recent receipts by GR no
  const recentDocs = useMemo(() => {
    const map = new Map<string, { ref: string; time: string; supplier: string; qty: number; lines: number }>();
    for (const a of recent) {
      const d = (a.after_data ?? {}) as { qty?: number; supplier?: string };
      const key = a.ref_no ?? a.id;
      const cur = map.get(key) ?? { ref: key, time: a.occurred_at, supplier: d.supplier ?? "", qty: 0, lines: 0 };
      cur.qty += d.qty ?? 0; cur.lines += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.time.localeCompare(a.time));
  }, [recent]);

  const opts = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => p.is_stocked && (!term || p.sku.toLowerCase().includes(term) || p.name_th.toLowerCase().includes(term)));
  }, [products, q]);

  if (!employee) return null;
  if (!can(employee, "inventory.adjust")) return <div className="p-8 text-center text-sm text-muted">{L("ไม่มีสิทธิ์รับสินค้าเข้า", "No permission", "无权限")}</div>;

  return (
    <PosPage
      title={t.cmd.goodsReceipt}
      icon={<PackagePlus size={18} />}
      actions={
        <>
          {lines.length ? <Badge tone="ok">+{totalUnits} {L("ชิ้น", "units", "件")}</Badge> : null}
          <Button variant="primary" loading={busy} disabled={!lines.length} onClick={() => void submit()}><Save size={15} /> {L("รับเข้าสต๊อก", "Receive", "入库")}</Button>
        </>
      }
    >
      <div className="p-4 sm:p-6 grid lg:grid-cols-[1fr_360px] gap-4 items-start">
        {/* left: build receipt */}
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={L("ผู้จัดจำหน่าย / Supplier", "Supplier", "供应商")}><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={L("เช่น Anker Thailand", "e.g. Anker Thailand", "供应商")} /></Field>
            <Field label={L("เลข PO / อ้างอิง", "PO / Reference", "采购单号")}><Input value={poRef} onChange={(e) => setPoRef(e.target.value)} /></Field>
            <Field label={t.common.note}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
            </div>
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-[2] h-9 text-xs">
              <option value="">{t.common.add}…</option>
              {opts.slice(0, 300).map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</option>)}
            </Select>
            <Button variant="soft" className="h-9" onClick={addLine} disabled={!pickId}><Plus size={16} /></Button>
          </div>
          <TablePanel>
            {lines.length ? (
              <Table>
                <thead><tr><Th>SKU</Th><Th>{t.admin.products}</Th><Th align="right">{L("คงเหลือ", "On hand", "现有")}</Th><Th align="center">{L("รับเข้า", "Receive qty", "入库量")}</Th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <Td className="font-mono text-[11px] text-muted">{l.sku}</Td>
                      <Td className="text-xs">{l.name}</Td>
                      <Td align="right" className="text-xs tnum text-muted">{stock.get(l.product_id)?.qty_on_hand ?? 0}</Td>
                      <Td align="center">
                        <div className="flex items-center gap-1.5 justify-center">
                          <Input value={l.qty} inputMode="numeric" onChange={(e) => setLines((list) => list.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x))} className="h-8 w-20 text-center tnum" />
                          <button onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))} className="text-muted hover:text-danger"><Trash2 size={14} /></button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState icon={<PackagePlus size={26} />} title={L("เพิ่มสินค้าที่รับเข้า", "Add items to receive", "添加入库商品")} body={L("เลือกสินค้า + จำนวน แล้วกดรับเข้าสต๊อก — สต๊อกจะเพิ่มและบันทึกใน Ledger", "Pick items & qty, then receive — stock increases and logs to the ledger", "选择商品后入库")} />}
          </TablePanel>
        </div>

        {/* right: recent receipts */}
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="eyebrow mb-2">{L("รับเข้าล่าสุด", "Recent receipts", "最近入库")}</p>
          {loading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            : recentDocs.length ? (
              <ul className="space-y-1.5">
                {recentDocs.map((d) => (
                  <li key={d.ref} className="flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2">
                    <PackagePlus size={14} className="text-ok shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono truncate">{d.ref}</p>
                      <p className="text-[10px] text-muted truncate">{d.supplier || "—"} · {new Date(d.time).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <span className="text-xs tnum font-semibold text-ok">+{formatInt(d.qty)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-center text-xs text-muted py-6">{t.common.empty}</p>}
        </div>
      </div>
    </PosPage>
  );
}
