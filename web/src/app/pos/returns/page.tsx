"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { RotateCcw, Search, Check, Plus, Trash2, Download, ArrowRight, RefreshCcw, Wallet, Percent } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { findOrderByNo, createReturn, listReturns, listOrders, listProducts } from "@/lib/data/repo";
import { useCart } from "@/lib/store/cart";
import type { Order, PaymentMethod, Product, ReturnDoc, ReturnType } from "@/lib/types";
import { Button, Card, CardHeader, Input, Field, Select, Segmented, Badge, EmptyState, Table, Th, Td, Drawer, DetailRow } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { formatTHB, formatCompact, formatInt, round2 } from "@/lib/money";
import { can, needsApproval } from "@/lib/permissions";
import { ApprovalModal, type ApprovalRequestInput } from "@/components/pos/approval-modal";
import { exportCsv, stampFilename } from "@/lib/export";

const REASONS = [
  { code: "defective", th: "สินค้าชำรุด/เสีย", en: "Defective", zh: "损坏" },
  { code: "wrong_item", th: "ได้สินค้าผิดรุ่น", en: "Wrong item", zh: "错货" },
  { code: "customer_change", th: "ลูกค้าเปลี่ยนใจ", en: "Changed mind", zh: "改主意" },
  { code: "warranty", th: "เคลมประกัน", en: "Warranty", zh: "保修" },
  { code: "price_error", th: "คิดราคาผิด", en: "Price error", zh: "价格错误" },
  { code: "missing_parts", th: "อุปกรณ์ไม่ครบ", en: "Missing parts", zh: "缺件" },
];

interface ReplLine { id: string; sku: string; name: string; qty: number; unit_price: number }

export default function ReturnsPage() {
  const { t, locale, pick } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const cart = useCart();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const reasonLabel = (code: string) => { const r = REASONS.find((x) => x.code === code); return r ? L(r.th, r.en, r.zh) : code; };

  const [orderNo, setOrderNo] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [type, setType] = useState<ReturnType>("refund");
  const [selected, setSelected] = useState<Record<string, { qty: number; condition: string }>>({});
  const [reason, setReason] = useState(REASONS[0].code);
  const [note, setNote] = useState("");
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [approvalReq, setApprovalReq] = useState<ApprovalRequestInput | null>(null);
  const [busy, setBusy] = useState(false);
  // exchange replacement
  const [repl, setRepl] = useState<ReplLine[]>([]);
  const [replPick, setReplPick] = useState("");
  // history
  const [history, setHistory] = useState<ReturnDoc[]>([]);
  const [orders30, setOrders30] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [detail, setDetail] = useState<ReturnDoc | null>(null);

  async function loadHistory() {
    if (!branchId) return;
    const from = new Date(); from.setDate(from.getDate() - 30);
    const [r, o, p] = await Promise.all([listReturns([branchId]), listOrders({ branchIds: [branchId], from }), listProducts()]);
    setHistory(r); setOrders30(o); setProducts(p);
  }
  useEffect(() => { void loadHistory(); /* eslint-disable-next-line */ }, [branchId]);

  async function search() {
    const o = await findOrderByNo(orderNo);
    if (!o) { toast.push({ tone: "warn", title: t.common.empty, body: orderNo }); return; }
    setOrder(o); setSelected({}); setType("refund"); setRepl([]);
  }

  // อัตราส่วนลดท้ายบิล (bill discount + แต้ม + คูปอง) ที่เฉลี่ยลงแต่ละรายการ
  // เพื่อไม่ให้คืนเงินเกินที่ลูกค้าจ่ายจริง
  const billRatio = useMemo(() => {
    if (!order) return 1;
    const afterLines = order.items.reduce((s, it) => s + it.line_total, 0);
    return afterLines > 0 ? order.grand_total / afterLines : 1;
  }, [order]);
  const refundPerItem = (it: { line_total: number; qty: number }, qty: number) =>
    round2((it.line_total / it.qty) * qty * billRatio);
  const refundAmount = round2(Object.entries(selected).reduce((sum, [itemId, sel]) => {
    const it = order?.items.find((i) => i.id === itemId); if (!it) return sum;
    return sum + refundPerItem(it, sel.qty);
  }, 0));
  const replTotal = useMemo(() => round2(repl.reduce((s, l) => s + l.qty * l.unit_price, 0)), [repl]);
  const diff = round2(replTotal - refundAmount); // >0 = เก็บเพิ่ม, <0 = ทอน

  function toggle(itemId: string, maxQty: number) {
    setSelected((s) => { const n = { ...s }; if (n[itemId]) delete n[itemId]; else n[itemId] = { qty: maxQty, condition: "sellable" }; return n; });
  }
  function addRepl() {
    const p = products.find((x) => x.id === replPick); if (!p) return;
    setRepl((l) => [...l, { id: nanoid(), sku: p.sku, name: p.name_th, qty: 1, unit_price: p.price }]); setReplPick("");
  }

  async function submit(approvedBy?: string) {
    if (!order || !employee) return;
    const items = Object.entries(selected).map(([itemId, sel]) => {
      const it = order.items.find((i) => i.id === itemId)!;
      return { sku: it.sku, name: it.name, qty: sel.qty, unit_price: it.unit_price, line_total: refundPerItem(it, sel.qty), condition: sel.condition };
    });
    if (!items.length) return;
    setBusy(true);
    try {
      const isExchange = type === "exchange";
      const exNote = isExchange && repl.length ? ` | ${L("เปลี่ยนเป็น", "Exchange to", "换为")}: ${repl.map((r) => `${r.name}×${r.qty}`).join(", ")} (${diff >= 0 ? L("เก็บเพิ่ม", "collect", "补收") : L("ทอน", "refund", "找零")} ${formatTHB(Math.abs(diff), false)})` : "";
      await createReturn({
        id: nanoid(),
        return_no: `RT-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
        order_id: order.id, order_no: order.order_no, branch_id: order.branch_id,
        type, status: "completed", reason_code: reason, reason_note: note + exNote,
        refund_method: type === "refund" ? refundMethod : null,
        refund_amount: type === "refund" ? refundAmount : isExchange && diff < 0 ? round2(-diff) : 0,
        items, requested_by: employee.id, approved_by: approvedBy ?? employee.id, created_at: new Date().toISOString(),
      }, employee.id);

      if (isExchange && repl.length && diff > 0) {
        cart.clear();
        for (const r of repl) { const p = products.find((x) => x.sku === r.sku); if (p) cart.addProduct(p, r.qty); }
        cart.setCustomer(order.customer_name ?? "", order.customer_phone ?? "");
        toast.push({ tone: "ok", title: t.returns.exchange, body: `${L("เก็บเพิ่ม", "Collect", "补收")} ${formatTHB(diff)} — ${L("ไปหน้าขายเพื่อรับเงิน", "go to sell to charge", "前往收款")}` });
        setOrder(null); setOrderNo(""); setSelected({}); setRepl([]);
        router.push("/pos/sell");
        return;
      }
      toast.push({ tone: "ok", title: t.returns.title, body: isExchange ? t.returns.exchange : formatTHB(refundAmount) });
      setOrder(null); setOrderNo(""); setSelected({}); setRepl([]);
      await loadHistory();
    } finally { setBusy(false); }
  }

  function handleSubmit() {
    if (!employee || !order) return;
    if (needsApproval(employee, "return.create") || !can(employee, "return.create")) {
      setApprovalReq({ kind: "return", minRole: "supervisor", branchId: order.branch_id, requestedBy: employee.id, amount: refundAmount, reason: `${t.returns.title} ${order.order_no}`, payload: { order_no: order.order_no, type } });
      return;
    }
    void submit();
  }

  // ---- analytics ----
  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayRet = history.filter((r) => new Date(r.created_at).toDateString() === today);
    const amount = history.reduce((s, r) => s + r.refund_amount, 0);
    const rate = orders30.length ? (history.length / orders30.length) * 100 : 0;
    const reasonCount = new Map<string, number>();
    for (const r of history) if (r.reason_code) reasonCount.set(r.reason_code, (reasonCount.get(r.reason_code) ?? 0) + 1);
    const topReason = [...reasonCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { today: todayRet.length, amount, rate, topReason };
  }, [history, orders30]);

  if (!employee) return null;

  return (
    <PosPage
      title={t.returns.title}
      icon={<RotateCcw size={18} />}
      actions={
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} placeholder={t.returns.findOrder} className="pl-9 font-mono h-9" />
          </div>
          <Button variant="primary" className="h-9" onClick={() => void search()}>{t.common.search}</Button>
          {order ? <Button variant="ghost" className="h-9" onClick={() => { setOrder(null); setOrderNo(""); }}>{t.common.cancel}</Button> : null}
        </div>
      }
    >
      {order ? (
        <div className="p-4 sm:p-6 grid lg:grid-cols-[1fr_400px] gap-4 items-start">
          <Card>
            <CardHeader title={order.order_no} subtitle={new Date(order.created_at).toLocaleString(locale === "th" ? "th-TH" : "en-US")} right={<Badge tone="neutral">{formatTHB(order.grand_total)}</Badge>} />
            <Table>
              <thead><tr><Th align="center"> </Th><Th>{t.admin.products}</Th><Th align="center">{t.common.qty}</Th><Th>{t.returns.condition}</Th><Th align="right">{t.common.amount}</Th></tr></thead>
              <tbody>
                {order.items.map((it) => {
                  const sel = selected[it.id];
                  return (
                    <tr key={it.id} className={sel ? "bg-brand/5" : ""}>
                      <Td align="center"><button onClick={() => toggle(it.id, it.qty)} className={`w-5 h-5 rounded border grid place-items-center ${sel ? "bg-brand border-brand text-brandInk" : "border-line"}`}>{sel ? <Check size={13} /> : null}</button></Td>
                      <Td><p className="text-xs font-medium">{it.name}</p><p className="text-[10px] font-mono text-muted">{it.sku}{it.serials.length ? ` · SN ${it.serials.join(",")}` : ""}</p></Td>
                      <Td align="center">{sel ? <Input value={sel.qty} inputMode="numeric" onChange={(e) => { const q = Math.min(Number(e.target.value.replace(/\D/g, "") || 0), it.qty); setSelected((s) => ({ ...s, [it.id]: { ...s[it.id], qty: q } })); }} className="h-8 w-16 text-center tnum" /> : <span className="text-xs text-muted tnum">{it.qty}</span>}</Td>
                      <Td>{sel ? <Select value={sel.condition} onChange={(e) => setSelected((s) => ({ ...s, [it.id]: { ...s[it.id], condition: e.target.value } }))} className="h-8 text-xs">
                        <option value="sellable">{t.returns.sellable}</option><option value="opened_box">{t.returns.opened_box}</option><option value="defective">{t.returns.defective}</option><option value="scrap">{t.returns.scrap}</option>
                      </Select> : null}</Td>
                      <Td align="right" className="text-xs">{formatTHB(sel ? refundPerItem(it, sel.qty) : round2(it.line_total * billRatio), false)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="text-[11px] text-muted px-4 py-2.5 border-t border-line">{L("สภาพ \"ขายต่อได้\" เท่านั้นที่คืนเข้าสต๊อก — อื่น ๆ เข้า bucket ชำรุด/บริการ", "Only \"sellable\" restocks — others go to damaged/service bucket", "仅\"可售\"回库")}</p>
          </Card>

          <Card className="p-4 space-y-4 lg:sticky lg:top-4">
            <div>
              <label className="label">{t.common.action}</label>
              <Segmented value={type} onChange={setType} options={[{ value: "refund", label: t.returns.refund }, { value: "exchange", label: t.returns.exchange }, { value: "claim", label: t.returns.claim }]} />
            </div>
            <Field label={t.returns.reason}><Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r.code} value={r.code}>{reasonLabel(r.code)}</option>)}</Select></Field>
            <Field label={t.common.note}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>

            {type === "exchange" ? (
              <div className="rounded-xl border border-line p-3 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5"><RefreshCcw size={13} /> {L("สินค้าที่เปลี่ยนเป็น", "Replacement items", "换购商品")}</p>
                <div className="flex gap-2">
                  <Select value={replPick} onChange={(e) => setReplPick(e.target.value)} className="flex-1 h-9 text-xs"><option value="">{t.common.add}…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</option>)}</Select>
                  <Button variant="soft" className="h-9" onClick={addRepl} disabled={!replPick}><Plus size={15} /></Button>
                </div>
                {repl.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{r.name}</span>
                    <Input value={r.qty} inputMode="numeric" onChange={(e) => setRepl((l) => l.map((x) => x.id === r.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x))} className="h-7 w-12 text-center tnum" />
                    <span className="tnum w-16 text-right">{formatTHB(r.qty * r.unit_price, false)}</span>
                    <button onClick={() => setRepl((l) => l.filter((x) => x.id !== r.id))} className="text-muted hover:text-danger"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ) : null}

            {type === "refund" ? (
              <Field label={t.payment.method}><Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
                <option value="cash">{t.payment.cash}</option><option value="bank_transfer">{t.payment.bank_transfer}</option><option value="credit_card">{t.payment.credit_card}</option><option value="store_credit">{t.payment.store_credit}</option>
              </Select></Field>
            ) : null}

            <div className="rounded-xl bg-surface2 border border-line px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-muted">{L("มูลค่าคืน", "Return value", "退货价值")}</span><span className="tnum">{formatTHB(refundAmount)}</span></div>
              {type === "exchange" ? (
                <>
                  <div className="flex justify-between text-sm"><span className="text-muted">{L("สินค้าใหม่", "New items", "新商品")}</span><span className="tnum">{formatTHB(replTotal)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-line pt-1.5">
                    <span>{diff >= 0 ? L("เก็บเพิ่ม", "Collect", "补收") : L("ทอนคืน", "Refund", "找零")}</span>
                    <span className={`text-lg tnum ${diff > 0 ? "text-coral" : "text-ok"}`}>{formatTHB(Math.abs(diff))}</span>
                  </div>
                </>
              ) : type === "refund" ? (
                <div className="flex justify-between font-semibold border-t border-line pt-1.5"><span>{t.returns.refundAmount}</span><span className="text-lg tnum">{formatTHB(refundAmount)}</span></div>
              ) : null}
            </div>

            {needsApproval(employee, "return.create") ? <p className="text-[11px] text-warn">{t.returns.needApproval}</p> : null}
            <Button variant="primary" className="w-full" loading={busy} disabled={!Object.keys(selected).length || (type === "exchange" && !repl.length)} onClick={handleSubmit}>
              {type === "exchange" && diff > 0 ? `${t.returns.exchange} · ${L("เก็บเพิ่ม", "collect", "补收")} ${formatTHB(diff, false)}` : t.common.confirm}
            </Button>
          </Card>
        </div>
      ) : (
        // ===== history + analytics =====
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatChip label={L("คืน 30 วัน", "Returns 30d", "30天退货")} value={formatInt(history.length)} accent="lavender" icon={<RotateCcw size={16} />} />
            <StatChip label={t.returns.refundAmount} value={`฿${formatCompact(stats.amount)}`} accent="coral" icon={<Wallet size={16} />} />
            <StatChip label={t.cmd.returnRate} value={`${stats.rate.toFixed(1)}%`} accent={stats.rate > 3 ? "coral" : "mint"} icon={<Percent size={16} />} />
            <StatChip label={L("เหตุผลยอดฮิต", "Top reason", "主因")} value={stats.topReason ? reasonLabel(stats.topReason) : "—"} accent="peach" icon={<ArrowRight size={16} />} />
          </div>
          <TablePanel>
            {history.length ? (
              <Table>
                <thead><tr><Th>{L("เลขที่คืน", "Return No.", "退货单")}</Th><Th>{L("บิลเดิม", "Original", "原单")}</Th><Th>{L("ประเภท", "Type", "类型")}</Th><Th>{t.returns.reason}</Th><Th align="right">{t.returns.refundAmount}</Th><Th>{t.common.date}</Th></tr></thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setDetail(r)}>
                      <Td className="font-mono text-xs">{r.return_no}</Td>
                      <Td className="font-mono text-[11px] text-muted">{r.order_no ?? "—"}</Td>
                      <Td><Badge tone={r.type === "exchange" ? "info" : r.type === "claim" ? "warn" : "neutral"}>{r.type === "exchange" ? t.returns.exchange : r.type === "claim" ? t.returns.claim : t.returns.refund}</Badge></Td>
                      <Td className="text-xs">{reasonLabel(r.reason_code ?? "")}</Td>
                      <Td align="right" className="text-xs font-medium">{formatTHB(r.refund_amount, false)}</Td>
                      <Td className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState icon={<RotateCcw size={26} />} title={t.returns.findOrder} body={L("ค้นเลขบิลด้านบนเพื่อเริ่มคืน/เปลี่ยน หรือดูประวัติที่นี่", "Search an invoice above to start, or view history here", "在上方搜索单据")} />}
          </TablePanel>
          {history.length ? <div className="flex justify-end"><Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => exportCsv(stampFilename("returns"), history.map((r) => ({ return_no: r.return_no, order_no: r.order_no ?? "", type: r.type, reason: r.reason_code ?? "", refund: r.refund_amount, date: r.created_at })))}><Download size={14} /> {t.common.export}</Button></div> : null}
        </div>
      )}

      {/* return detail drawer */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="md"
        title={detail ? <span className="font-mono">{detail.return_no}</span> : ""}
        subtitle={detail?.order_no ?? ""}
        badge={detail ? <Badge tone={detail.type === "exchange" ? "info" : "neutral"}>{detail.type === "exchange" ? t.returns.exchange : detail.type === "claim" ? t.returns.claim : t.returns.refund}</Badge> : null}>
        {detail ? (
          <div className="p-5 space-y-4">
            <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
              <DetailRow label={L("บิลเดิม", "Original", "原单")}><span className="font-mono">{detail.order_no ?? "—"}</span></DetailRow>
              <DetailRow label={t.returns.reason}>{reasonLabel(detail.reason_code ?? "")}</DetailRow>
              <DetailRow label={t.payment.method}>{detail.refund_method ? (t.payment as Record<string, string>)[detail.refund_method] ?? detail.refund_method : "—"}</DetailRow>
              <DetailRow label={t.returns.refundAmount}>{formatTHB(detail.refund_amount)}</DetailRow>
              <DetailRow label={t.common.date}>{new Date(detail.created_at).toLocaleString(locale === "th" ? "th-TH" : "en-US")}</DetailRow>
            </div>
            <div className="rounded-2xl border border-line overflow-hidden">
              <table className="w-full text-xs"><thead><tr className="text-[10px] uppercase text-muted"><th className="text-left font-semibold px-3 py-2">{t.admin.products}</th><th className="text-center font-semibold px-3 py-2">{t.common.qty}</th><th className="text-left font-semibold px-3 py-2">{t.returns.condition}</th><th className="text-right font-semibold px-3 py-2">{t.common.amount}</th></tr></thead>
                <tbody>{detail.items.map((it, i) => (<tr key={i} className="border-t border-line/60"><td className="px-3 py-2"><p className="font-medium">{it.name}</p><p className="font-mono text-[10px] text-muted">{it.sku}</p></td><td className="px-3 py-2 text-center tnum">{it.qty}</td><td className="px-3 py-2">{(t.returns as Record<string, string>)[it.condition] ?? it.condition}</td><td className="px-3 py-2 text-right tnum">{formatTHB(it.line_total, false)}</td></tr>))}</tbody>
              </table>
            </div>
            {detail.reason_note ? <div className="rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">{detail.reason_note}</div> : null}
          </div>
        ) : null}
      </Drawer>

      <ApprovalModal request={approvalReq} onClose={() => setApprovalReq(null)} onApproved={(approver) => void submit(approver.id)} />
    </PosPage>
  );
}
