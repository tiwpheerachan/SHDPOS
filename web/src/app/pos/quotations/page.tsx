"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2, ArrowRightLeft, Download, Copy, CheckCircle2, XCircle, Clock, Percent } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listProducts } from "@/lib/data/repo";
import { db } from "@/lib/offline/db";
import { useCart } from "@/lib/store/cart";
import type { Product, Quotation } from "@/lib/types";
import { Button, Input, Field, Select, Table, Th, Td, Badge, EmptyState, Modal, Drawer, DetailRow } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { formatTHB, formatCompact, formatInt, round2 } from "@/lib/money";
import { can } from "@/lib/permissions";
import { exportCsv, stampFilename } from "@/lib/export";

interface DraftLine { id: string; product_id: string; sku: string; name: string; qty: number; unit_price: number }
type EffStatus = Quotation["status"] | "expired";

export default function QuotationsPage() {
  const { t, locale, pick } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const session = useSession();
  const cart = useCart();
  const employee = session.employee;
  const branchId = session.branchId;
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [products, setProducts] = useState<Product[]>([]);
  const [list, setList] = useState<Quotation[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Quotation | null>(null);
  const [statusF, setStatusF] = useState<EffStatus | "all">("all");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickId, setPickId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [validDays, setValidDays] = useState("7");

  async function reload() {
    if (!branchId) return;
    const rows = await db().quotations.reverse().sortBy("created_at");
    setList(rows.filter((r) => r.branch_id === branchId));
  }
  useEffect(() => {
    void (async () => { setProducts(await listProducts()); await reload(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const today0 = new Date(new Date().toDateString());
  const eff = (q: Quotation): EffStatus =>
    q.valid_until && new Date(q.valid_until) < today0 && ["draft", "sent", "accepted"].includes(q.status) ? "expired" : q.status;

  const statusMeta: Record<EffStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "info" | "brand" }> = {
    draft: { label: L("ร่าง", "Draft", "草稿"), tone: "neutral" },
    sent: { label: L("ส่งแล้ว", "Sent", "已发送"), tone: "info" },
    accepted: { label: L("ตอบรับ", "Accepted", "已接受"), tone: "brand" },
    converted: { label: L("แปลงเป็นบิล", "Converted", "已成交"), tone: "ok" },
    expired: { label: L("หมดอายุ", "Expired", "已过期"), tone: "danger" },
    cancelled: { label: L("ยกเลิก", "Cancelled", "已取消"), tone: "neutral" },
  };

  const total = useMemo(() => round2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0)), [lines]);

  const summary = useMemo(() => {
    const converted = list.filter((q) => q.status === "converted").length;
    const engaged = list.filter((q) => q.status !== "draft").length; // ส่งออกไปแล้ว
    return {
      count: list.length,
      value: list.reduce((s, q) => s + q.grand_total, 0),
      converted,
      rate: engaged ? (converted / engaged) * 100 : 0,
    };
  }, [list]);

  const filtered = useMemo(() => (statusF === "all" ? list : list.filter((q) => eff(q) === statusF)), [list, statusF]);

  function addLine() {
    const p = products.find((x) => x.id === pickId);
    if (!p) return;
    setLines((l) => [...l, { id: nanoid(), product_id: p.id, sku: p.sku, name: p.name_th, qty: 1, unit_price: p.price }]);
    setPickId("");
  }

  async function save() {
    if (!branchId || !lines.length) return;
    const now = new Date();
    const valid = new Date(now); valid.setDate(now.getDate() + Number(validDays || 7));
    const q: Quotation = {
      id: nanoid(),
      quotation_no: `QT-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
      branch_id: branchId, customer_name: customerName || null, customer_phone: customerPhone || null,
      status: "sent", grand_total: total, valid_until: valid.toISOString().slice(0, 10),
      items: lines.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, unit_price: l.unit_price, line_total: round2(l.qty * l.unit_price) })),
      created_at: now.toISOString(),
    };
    await db().quotations.put(q);
    setOpen(false); setLines([]); setCustomerName(""); setCustomerPhone("");
    await reload();
    toast.push({ tone: "ok", title: t.quotation.title, body: q.quotation_no });
  }

  async function setStatus(q: Quotation, status: Quotation["status"]) {
    await db().quotations.update(q.id, { status });
    await reload();
    setDetail((d) => (d && d.id === q.id ? { ...d, status } : d));
  }

  async function duplicate(q: Quotation) {
    const now = new Date();
    const valid = new Date(now); valid.setDate(now.getDate() + 7);
    const copy: Quotation = {
      ...q, id: nanoid(),
      quotation_no: `QT-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
      status: "draft", valid_until: valid.toISOString().slice(0, 10), created_at: now.toISOString(),
    };
    await db().quotations.put(copy);
    await reload();
    setDetail(copy);
    toast.push({ tone: "ok", title: L("ทำสำเนา (แก้ราคาใหม่)", "Duplicated (new revision)", "已复制"), body: copy.quotation_no });
  }

  async function convert(q: Quotation) {
    cart.clear();
    for (const it of q.items) { const p = products.find((x) => x.sku === it.sku); if (p) cart.addProduct(p, it.qty); }
    cart.setCustomer(q.customer_name ?? "", q.customer_phone ?? "");
    await db().quotations.update(q.id, { status: "converted" });
    toast.push({ tone: "ok", title: t.quotation.convert, body: `${L("ที่มา", "Source", "来源")}: ${q.quotation_no}` });
    router.push("/pos/sell");
  }

  const onExport = () => exportCsv(stampFilename("quotations"), filtered.map((q) => ({
    quotation_no: q.quotation_no, customer: q.customer_name ?? "", phone: q.customer_phone ?? "",
    valid_until: q.valid_until ?? "", total: q.grand_total, status: eff(q), created_at: q.created_at,
  })));

  if (!employee) return null;
  if (!can(employee, "pos.quotation")) return <div className="p-8 text-center text-sm text-muted">{L("ไม่มีสิทธิ์ใช้งานส่วนนี้", "No permission", "无权限")}</div>;

  const PIPELINE: Quotation["status"][] = ["draft", "sent", "accepted", "converted"];

  return (
    <PosPage
      title={t.quotation.title}
      icon={<FileText size={18} />}
      actions={
        <>
          <Segmentedish value={statusF} onChange={setStatusF} L={L} statusMeta={statusMeta} />
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onExport} disabled={!filtered.length}><Download size={14} /> {t.common.export}</Button>
          <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> {t.common.add}</Button>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatChip label={t.quotation.title} value={formatInt(summary.count)} accent="lavender" icon={<FileText size={16} />} />
          <StatChip label={t.common.total} value={`฿${formatCompact(summary.value)}`} accent="coral" icon={<Percent size={16} />} />
          <StatChip label={statusMeta.converted.label} value={formatInt(summary.converted)} accent="mint" icon={<CheckCircle2 size={16} />} />
          <StatChip label={L("อัตราปิดการขาย", "Conversion Rate", "成交率")} value={`${summary.rate.toFixed(0)}%`} accent="lime" icon={<ArrowRightLeft size={16} />} />
        </div>

        <TablePanel>
          {filtered.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t.quotation.title}</Th><Th>{t.common.customer}</Th><Th>{t.quotation.validUntil}</Th>
                  <Th align="right">{t.common.total}</Th><Th align="center">{t.common.status}</Th><Th align="right">{t.common.action}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => {
                  const e = eff(q);
                  return (
                    <tr key={q.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setDetail(q)}>
                      <Td className="font-mono text-xs">{q.quotation_no}</Td>
                      <Td className="text-xs">{q.customer_name ?? "—"}</Td>
                      <Td className="text-xs text-muted">{q.valid_until}</Td>
                      <Td align="right" className="font-medium">{formatTHB(q.grand_total, false)}</Td>
                      <Td align="center"><Badge tone={statusMeta[e].tone}>{statusMeta[e].label}</Badge></Td>
                      <Td align="right">
                        {e !== "converted" && e !== "cancelled" ? (
                          <button onClick={(ev) => { ev.stopPropagation(); void convert(q); }} className="p-1.5 rounded-lg hover:bg-surface2 text-muted" title={t.quotation.convert}>
                            <ArrowRightLeft size={14} />
                          </button>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={<FileText size={26} />} title={t.common.empty} body={L("ออกใบเสนอราคาสำหรับสินค้ามูลค่าสูง แล้วแปลงเป็นบิลขายภายหลัง", "Create a quote and convert it to a sale later", "创建报价后可转为销售")} />}
        </TablePanel>
      </div>

      {/* ===== Detail Drawer ===== */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="lg"
        title={detail ? <span className="font-mono">{detail.quotation_no}</span> : ""}
        subtitle={detail?.customer_name ?? ""}
        badge={detail ? <Badge tone={statusMeta[eff(detail)].tone}>{statusMeta[eff(detail)].label}</Badge> : null}
        footer={detail ? (
          <>
            {eff(detail) === "sent" ? <Button variant="soft" onClick={() => void setStatus(detail, "accepted")}><CheckCircle2 size={15} /> {statusMeta.accepted.label}</Button> : null}
            <Button variant="soft" onClick={() => void duplicate(detail)}><Copy size={15} /> {L("ทำสำเนา", "Duplicate", "复制")}</Button>
            {eff(detail) !== "converted" && eff(detail) !== "cancelled" ? <Button variant="ghost" onClick={() => void setStatus(detail, "cancelled")}><XCircle size={15} /> {L("ยกเลิก", "Cancel", "取消")}</Button> : null}
            {eff(detail) !== "converted" && eff(detail) !== "cancelled" ? <Button variant="primary" className="ml-auto" onClick={() => void convert(detail)}><ArrowRightLeft size={15} /> {t.quotation.convert}</Button> : null}
          </>
        ) : null}>
        {detail ? (
          <div className="p-5 space-y-4">
            {/* pipeline stepper */}
            <div className="flex items-center gap-1">
              {PIPELINE.map((st, i) => {
                const idx = PIPELINE.indexOf(detail.status === "converted" ? "converted" : detail.status as Quotation["status"]);
                const done = i <= (idx < 0 ? -1 : idx) && eff(detail) !== "expired" && eff(detail) !== "cancelled";
                return (
                  <div key={st} className="flex items-center gap-1 flex-1">
                    <div className={`flex-1 text-center rounded-full py-1 text-[10px] font-medium ${done ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>{statusMeta[st].label}</div>
                    {i < PIPELINE.length - 1 ? <span className={`w-2 h-px ${done ? "bg-brand" : "bg-line"}`} /> : null}
                  </div>
                );
              })}
            </div>
            {eff(detail) === "expired" ? <div className="rounded-xl bg-danger/10 border border-danger/25 text-danger text-xs px-3 py-2 flex items-center gap-2"><Clock size={13} /> {L("ใบเสนอราคานี้หมดอายุแล้ว", "This quotation has expired", "此报价已过期")}</div> : null}

            <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
              <DetailRow label={t.common.customer}>{detail.customer_name ?? "—"}</DetailRow>
              <DetailRow label={L("โทรศัพท์", "Phone", "电话")}>{detail.customer_phone ?? "—"}</DetailRow>
              <DetailRow label={t.quotation.validUntil}>{detail.valid_until ?? "—"}</DetailRow>
              <DetailRow label={L("สร้างเมื่อ", "Created", "创建")}>{new Date(detail.created_at).toLocaleString(locale === "th" ? "th-TH" : "en-US")}</DetailRow>
            </div>

            <div className="rounded-2xl border border-line overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase text-muted"><th className="text-left font-semibold px-3 py-2">{t.admin.products}</th><th className="text-center font-semibold px-3 py-2">{t.common.qty}</th><th className="text-right font-semibold px-3 py-2">{t.common.price}</th><th className="text-right font-semibold px-3 py-2">{t.common.total}</th></tr></thead>
                <tbody>
                  {detail.items.map((it, i) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="px-3 py-2"><p className="font-medium">{it.name}</p><p className="font-mono text-[10px] text-muted">{it.sku}</p></td>
                      <td className="px-3 py-2 text-center tnum">{it.qty}</td>
                      <td className="px-3 py-2 text-right tnum">{formatTHB(it.unit_price, false)}</td>
                      <td className="px-3 py-2 text-right tnum font-medium">{formatTHB(it.line_total, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center rounded-2xl bg-surface2 px-4 py-3">
              <span className="text-sm text-muted">{t.pos.grandTotal}</span>
              <span className="text-lg font-semibold tnum">{formatTHB(detail.grand_total)}</span>
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* create modal (เดิม) */}
      <Modal open={open} onClose={() => setOpen(false)} title={t.quotation.title} size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button variant="primary" disabled={!lines.length} onClick={() => void save()}>{t.common.save} · {formatTHB(total)}</Button></>}>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t.common.customer}><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></Field>
            <Field label={L("โทรศัพท์", "Phone", "电话")}><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></Field>
            <Field label={`${t.quotation.validUntil} (${L("วัน", "days", "天")})`}><Input value={validDays} inputMode="numeric" onChange={(e) => setValidDays(e.target.value.replace(/\D/g, ""))} /></Field>
          </div>
          <div className="flex gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-1">
              <option value="">{t.common.add}...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</option>)}
            </Select>
            <Button variant="soft" onClick={addLine} disabled={!pickId}><Plus size={16} /></Button>
          </div>
          <Table>
            <thead><tr><Th>{t.admin.products}</Th><Th align="center">{t.common.qty}</Th><Th align="right">{t.common.price}</Th><Th align="right">{t.common.total}</Th><Th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td className="text-xs">{l.name}</Td>
                  <Td align="center"><Input value={l.qty} inputMode="numeric" onChange={(e) => setLines((list) => list.map((x) => (x.id === l.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x)))} className="h-8 w-16 text-center tnum" /></Td>
                  <Td align="right"><Input value={l.unit_price} inputMode="decimal" onChange={(e) => setLines((list) => list.map((x) => (x.id === l.id ? { ...x, unit_price: Number(e.target.value.replace(/[^\d.]/g, "") || 0) } : x)))} className="h-8 w-24 text-right tnum" /></Td>
                  <Td align="right" className="text-xs">{formatTHB(l.qty * l.unit_price, false)}</Td>
                  <Td align="right"><button onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))} className="text-muted hover:text-danger"><Trash2 size={14} /></button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Modal>
    </PosPage>
  );
}

/** ตัวกรองสถานะแบบ dropdown เล็ก ๆ */
function Segmentedish({ value, onChange, L, statusMeta }: {
  value: EffStatus | "all"; onChange: (v: EffStatus | "all") => void;
  L: (th: string, en: string, zh: string) => string;
  statusMeta: Record<EffStatus, { label: string; tone: string }>;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as EffStatus | "all")} className="w-36 h-9">
      <option value="all">{L("ทุกสถานะ", "All status", "全部状态")}</option>
      {(["draft", "sent", "accepted", "converted", "expired", "cancelled"] as EffStatus[]).map((s) => (
        <option key={s} value={s}>{statusMeta[s].label}</option>
      ))}
    </Select>
  );
}
