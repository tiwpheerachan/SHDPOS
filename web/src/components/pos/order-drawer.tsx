"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Printer, FileText, RotateCcw, Ban, ReceiptText, Boxes, ShoppingCart, Percent,
  CreditCard, Package, Clock, ShieldCheck, FileDown,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listEmployees, listTerminals, listReturns, listAudit } from "@/lib/data/repo";
import type { AuditEntry, Branch, Employee, Order, ReturnDoc, Terminal } from "@/lib/types";
import { Drawer, DrawerTabs, DetailRow, Badge, Button, Avatar, EmptyState } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { BankMark } from "@/components/pos/bank-mark";

type Tab = "overview" | "items" | "timeline" | "docs" | "audit";

export function OrderDrawer({
  order, branch, employee, showGp, onClose, onReprint, onVoid,
}: {
  order: Order | null;
  branch?: Branch;
  employee: Employee | null;
  showGp: boolean;
  onClose: () => void;
  onReprint: (o: Order) => void;
  onVoid: (o: Order) => void;
}) {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [tab, setTab] = useState<Tab>("overview");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [returns, setReturns] = useState<ReturnDoc[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!order) return;
    setTab("overview");
    void (async () => {
      const [e, tm, r, a] = await Promise.all([
        listEmployees(), listTerminals(),
        listReturns([order.branch_id]), listAudit({ branchIds: [order.branch_id] }),
      ]);
      setEmployees(e); setTerminals(tm);
      setReturns(r.filter((x) => x.order_id === order.id || x.order_no === order.order_no));
      setAudits(a.filter((x) => x.ref_no === order.order_no));
    })();
  }, [order]);

  const empName = useMemo(() => new Map(employees.map((e) => [e.id, `${e.nickname ?? e.first_name} · ${e.employee_code}`])), [employees]);
  const termName = useMemo(() => new Map(terminals.map((tm) => [tm.id, tm.name ?? tm.code])), [terminals]);

  const fmtTime = (iso: string) => new Date(iso).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" });
  const payLabel = (m: string) => (t.payment as Record<string, string>)[m] ?? m;
  const chanLabel = (c: string) => ({
    offline: L("หน้าร้าน", "Offline", "门店"), online_shopee: "Shopee", online_lazada: "Lazada",
    online_tiktok: "TikTok", online_website: L("เว็บไซต์", "Website", "官网"), event: L("อีเวนต์", "Event", "活动"), b2b: "B2B", other: L("อื่นๆ", "Other", "其他"),
  } as Record<string, string>)[c] ?? c;

  // ----- synthesized timeline -----
  const timeline = useMemo(() => {
    if (!order) return [];
    const base = new Date(order.created_at).getTime();
    const mk = (offsetMin: number, iso: string | null, label: string, by?: string | null, icon?: React.ReactNode, tone?: string) =>
      ({ time: iso ?? new Date(base + offsetMin * 60000).toISOString(), label, by, icon, tone });
    const cashier = order.cashier_id ? empName.get(order.cashier_id) : undefined;
    const ev: { time: string; label: string; by?: string | null; icon?: React.ReactNode; tone?: string }[] = [
      mk(-7, null, L("เปิดตะกร้า", "Cart created", "创建购物车"), cashier, <ShoppingCart size={13} />),
    ];
    if (order.discount_total > 0) ev.push(mk(-4, null, `${L("ใส่ส่วนลด", "Discount applied", "应用折扣")} ${formatTHB(order.discount_total, false)}`, cashier, <Percent size={13} />, "warn"));
    ev.push(mk(0, order.created_at, `${L("รับชำระ", "Payment captured", "收款")} · ${order.payments.map((p) => payLabel(p.method)).join(", ")}`, cashier, <CreditCard size={13} />, "ok"));
    ev.push(mk(0, order.created_at, L("ตัดสต๊อก", "Stock deducted", "扣减库存"), null, <Package size={13} />));
    ev.push(mk(1, null, L("พิมพ์ใบเสร็จ", "Receipt printed", "打印小票"), cashier, <Printer size={13} />));
    for (const a of audits) {
      if (a.action === "void") {
        const d = (a.after_data ?? {}) as { was_paid?: boolean; payment_reversed?: number; units_restocked?: number };
        ev.push({ time: a.occurred_at, label: L("ยกเลิกบิล", "Order voided", "作废订单"), by: a.actor_name, icon: <Ban size={13} />, tone: "danger" });
        if (d.was_paid) ev.push({ time: a.occurred_at, label: `${L("ยกเลิกการชำระ (reversal)", "Payment reversed", "支付冲销")} ${formatTHB(d.payment_reversed ?? 0, false)}`, by: a.actor_name, icon: <CreditCard size={13} />, tone: "danger" });
        if (d.units_restocked) ev.push({ time: a.occurred_at, label: `${L("คืนสต๊อก", "Stock reversed", "库存冲销")} ${d.units_restocked} ${L("ชิ้น", "units", "件")}`, by: null, icon: <Package size={13} />, tone: "warn" });
      }
    }
    for (const r of returns) {
      ev.push({ time: r.created_at, label: `${r.type === "exchange" ? L("เปลี่ยนสินค้า", "Exchange", "换货") : L("คืนเงิน", "Refund", "退款")} ${formatTHB(r.refund_amount, false)}`, by: r.approved_by ? empName.get(r.approved_by) : null, icon: <RotateCcw size={13} />, tone: "warn" });
    }
    return ev.sort((a, b) => a.time.localeCompare(b.time));
  }, [order, audits, returns, empName]);

  if (!order) return null;
  const base = order.subtotal;
  const voided = order.status === "voided";

  const statusBadge = voided ? <Badge tone="danger">{t.orders.voided}</Badge>
    : order.status === "refunded" || order.status === "partially_refunded" ? <Badge tone="warn">{L("มีการคืน", "Returned", "已退")}</Badge>
    : <Badge tone="ok">{t.orders.completed}</Badge>;

  const tabs: { value: Tab; label: string }[] = [
    { value: "overview", label: L("ภาพรวม", "Overview", "概览") },
    { value: "items", label: `${L("รายการ", "Items", "商品")} (${order.items.length})` },
    { value: "timeline", label: "Timeline" },
    { value: "docs", label: L("เอกสาร", "Documents", "文档") },
    { value: "audit", label: `Audit (${audits.length})` },
  ];

  return (
    <Drawer open={Boolean(order)} onClose={onClose} width="lg"
      title={<span className="font-mono">{order.order_no}</span>}
      subtitle={`${fmtTime(order.created_at)} · ${branch ? (locale === "th" ? branch.name_th ?? branch.name : branch.name) : ""}`}
      badge={statusBadge}
      footer={
        <>
          <Button variant="soft" onClick={() => onReprint(order)}><Printer size={15} /> {t.pos.reprint}</Button>
          <Button variant="soft" onClick={() => window.print()}><FileDown size={15} /> PDF</Button>
          <Link href={`/pos/returns?order=${encodeURIComponent(order.order_no)}`} className="btn-soft"><RotateCcw size={15} /> {t.returns.title}</Link>
          {!voided ? <Button variant="danger" className="ml-auto" onClick={() => onVoid(order)}><Ban size={15} /> {t.orders.void}</Button> : null}
        </>
      }>
      <DrawerTabs value={tab} options={tabs} onChange={setTab} />

      <div className="p-5">
        {tab === "overview" ? (
          <div className="space-y-4">
            {voided ? (
              <div className="rounded-xl bg-danger/10 border border-danger/25 px-4 py-3 text-xs text-danger">
                <p className="font-semibold flex items-center gap-1.5"><Ban size={13} /> {t.orders.voided}</p>
                {order.void_reason ? <p className="mt-1">{L("เหตุผล", "Reason", "原因")}: {order.void_reason}</p> : null}
                <p className="mt-0.5 opacity-80">{L("คืนเงิน + คืนสต๊อกเรียบร้อย · บิลยังอยู่ในระบบเพื่อการตรวจสอบ (ไม่ถูกลบ)", "Payment & stock reversed · record retained for audit (not deleted)", "已冲销支付与库存·保留记录供审计")}</p>
              </div>
            ) : null}
            <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
              <DetailRow label={L("เลขที่ใบเสร็จ", "Invoice No.", "发票号")}><span className="font-mono">{order.order_no}</span></DetailRow>
              <DetailRow label={L("วันที่ / เวลา", "Date / Time", "日期/时间")}>{fmtTime(order.created_at)}</DetailRow>
              <DetailRow label={t.common.branch}>{branch ? (locale === "th" ? branch.name_th ?? branch.name : branch.name) : "—"}</DetailRow>
              <DetailRow label={L("เครื่อง POS", "POS / Register", "收银机")}>{order.terminal_id ? termName.get(order.terminal_id) ?? "—" : "—"}</DetailRow>
              <DetailRow label={L("แคชเชียร์", "Cashier", "收银员")}>{order.cashier_id ? empName.get(order.cashier_id) ?? "—" : "—"}</DetailRow>
              <DetailRow label={L("พนักงานขาย", "Salesperson", "销售员")}>{order.salesperson_id ? empName.get(order.salesperson_id) ?? "—" : "—"}</DetailRow>
              <DetailRow label={t.common.customer}>{order.customer_name || order.customer_phone || L("ลูกค้าทั่วไป", "Walk-in", "散客")}</DetailRow>
              <DetailRow label={L("ช่องทางขาย", "Channel", "渠道")}>{chanLabel(order.channel)}</DetailRow>
            </div>

            <div className="rounded-2xl bg-surface2 px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-muted">{t.pos.subtotal}</span><span className="tnum">{formatTHB(base)}</span></div>
              {order.discount_total > 0 ? <div className="flex justify-between text-sm"><span className="text-muted">{t.pos.discount}</span><span className="tnum text-danger">-{formatTHB(order.discount_total)}</span></div> : null}
              <div className="flex justify-between text-sm"><span className="text-muted">{t.pos.vat}</span><span className="tnum">{formatTHB(order.vat_amount)}</span></div>
              <div className="flex justify-between font-semibold border-t border-line pt-1.5"><span>{t.pos.grandTotal}</span><span className="tnum text-base">{formatTHB(order.grand_total)}</span></div>
            </div>

            <div>
              <p className="eyebrow mb-2">{t.payment.method}</p>
              <div className="space-y-1.5">
                {order.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                    <span className="text-xs flex items-center gap-2">
                      {p.acquirer_bank ? <BankMark bank={p.acquirer_bank} size={22} /> : <CreditCard size={13} className="text-muted" />}
                      <span>
                        {payLabel(p.method)}
                        {p.acquirer_bank || p.card_last4 ? (
                          <span className="text-[10px] text-muted ml-1">{[p.acquirer_bank, p.card_last4 ? `****${p.card_last4}` : ""].filter(Boolean).join(" · ")}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tnum">{formatTHB(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "items" ? (
          <div className="space-y-2">
            {order.items.map((it) => {
              const margin = it.line_total ? (it.gross_profit / it.line_total) * 100 : 0;
              return (
                <div key={it.id} className="rounded-xl border border-line px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{it.name}</p>
                      <p className="text-[10px] font-mono text-muted">{it.sku}{it.serials.length ? ` · SN ${it.serials.join(", ")}` : ""}</p>
                    </div>
                    <span className="text-sm font-semibold tnum shrink-0">{formatTHB(it.line_total, false)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-muted tnum">
                    <span>{L("จำนวน", "Qty", "数量")} {it.qty}</span>
                    <span>@ {formatTHB(it.unit_price, false)}</span>
                    {it.discount_amount > 0 ? <span className="text-danger">-{formatTHB(it.discount_amount, false)}</span> : null}
                    {showGp ? <><span>{L("ต้นทุน", "Cost", "成本")} {formatTHB(it.cost_total, false)}</span><span className="text-ok">GP {formatTHB(it.gross_profit, false)} · {margin.toFixed(0)}%</span></> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === "timeline" ? (
          <ol className="relative border-l border-line ml-2 space-y-4 py-1">
            {timeline.map((ev, i) => (
              <li key={i} className="ml-4">
                <span className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full grid place-items-center ${ev.tone === "danger" ? "bg-danger" : ev.tone === "warn" ? "bg-warn" : ev.tone === "ok" ? "bg-ok" : "bg-brand"}`}>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] tnum text-muted w-12 shrink-0">{clock(ev.time)}</span>
                  <span className="text-muted">{ev.icon}</span>
                  <span className="text-xs font-medium">{ev.label}</span>
                </div>
                {ev.by ? <p className="text-[10px] text-muted ml-14">{ev.by}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}

        {tab === "docs" ? (
          <div className="space-y-2">
            <DocRow icon={<ReceiptText size={15} />} title={L("ใบเสร็จต้นฉบับ", "Original Receipt", "原始小票")} sub={order.order_no} onClick={() => onReprint(order)} action={t.pos.reprint} />
            <DocRow icon={<FileText size={15} />} title={L("ใบกำกับภาษีเต็มรูป", "Full Tax Invoice", "完整税票")} sub={L("ออกได้ตามคำขอ", "On request", "按需开具")} />
            {returns.map((r) => (
              <DocRow key={r.id} icon={<RotateCcw size={15} />} title={`${r.type === "exchange" ? L("ใบเปลี่ยนสินค้า", "Exchange", "换货单") : L("ใบคืนสินค้า", "Return Note", "退货单")} · ${r.return_no}`} sub={`${formatTHB(r.refund_amount, false)} · ${fmtTime(r.created_at)}`} tone="warn" />
            ))}
            <DocRow icon={<Boxes size={15} />} title={L("ความเคลื่อนไหวสต๊อก", "Stock Movement", "库存变动")} sub={`${order.items.reduce((s, it) => s + it.qty, 0)} ${L("ชิ้นถูกตัด", "units deducted", "件已扣减")}`} />
          </div>
        ) : null}

        {tab === "audit" ? (
          audits.length ? (
            <div className="space-y-2">
              {audits.map((a) => (
                <div key={a.id} className="rounded-xl border border-line px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-muted" />
                    <span className="text-xs font-semibold uppercase">{a.action}</span>
                    <span className="ml-auto text-[10px] text-muted tnum">{fmtTime(a.occurred_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {a.actor_name ? <Avatar name={a.actor_name} size={22} /> : null}
                    <span className="text-[11px] text-muted">{a.actor_name ?? "—"}{a.amount != null ? ` · ${formatTHB(a.amount, false)}` : ""}</span>
                  </div>
                  {a.after_data ? <pre className="mt-1.5 text-[10px] text-muted bg-surface2 rounded-lg px-2 py-1.5 overflow-x-auto">{JSON.stringify(a.after_data)}</pre> : null}
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<Clock size={22} />} title={L("ยังไม่มีบันทึก", "No audit entries", "暂无记录")} />
        ) : null}
      </div>
    </Drawer>
  );
}

function DocRow({ icon, title, sub, action, onClick, tone }: {
  icon: React.ReactNode; title: string; sub?: string; action?: string; onClick?: () => void; tone?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
      <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${tone === "warn" ? "bg-warn/12 text-warn" : "bg-surface2 text-muted"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{title}</p>
        {sub ? <p className="text-[10px] text-muted truncate">{sub}</p> : null}
      </div>
      {action && onClick ? <button onClick={onClick} className="text-[11px] text-brand hover:underline shrink-0">{action}</button> : null}
    </div>
  );
}
