"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote, CreditCard, QrCode, Landmark, Smartphone, Gift, Wallet, CalendarClock, Plus, Trash2,
} from "lucide-react";
import { Modal, Button, Input, Field, Select, Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB, round2 } from "@/lib/money";
import type { PaymentEntry, PaymentMethod } from "@/lib/types";
import { BANKS, type BankInfo } from "@/lib/banks";
import { BankMark } from "@/components/pos/bank-mark";

const METHODS: { value: PaymentMethod; icon: typeof Banknote; accent: string }[] = [
  { value: "cash", icon: Banknote, accent: "#16a34a" },
  { value: "credit_card", icon: CreditCard, accent: "#6366f1" },
  { value: "qr_promptpay", icon: QrCode, accent: "#2563eb" },
  { value: "debit_card", icon: CreditCard, accent: "#0891b2" },
  { value: "bank_transfer", icon: Landmark, accent: "#7c3aed" },
  { value: "edc", icon: Smartphone, accent: "#db2777" },
  { value: "installment", icon: CalendarClock, accent: "#ea580c" },
  { value: "gift_card", icon: Gift, accent: "#e11d48" },
  { value: "store_credit", icon: Wallet, accent: "#0d9488" },
];

export function PaymentModal({
  open,
  onClose,
  grandTotal,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  grandTotal: number;
  onConfirm: (payments: PaymentEntry[], paid: number, change: number) => void;
  busy?: boolean;
}) {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountText, setAmountText] = useState("");
  const [bank, setBank] = useState<BankInfo>(BANKS[0]);
  const [last4, setLast4] = useState("");
  const [approvalCode, setApprovalCode] = useState("");
  const [months, setMonths] = useState(0);

  const paid = useMemo(() => round2(payments.reduce((s, p) => s + p.amount, 0)), [payments]);
  const remaining = round2(Math.max(grandTotal - paid, 0));
  const change = round2(Math.max(paid - grandTotal, 0));

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    setMethod("cash");
    setAmountText("");
    setLast4("");
    setApprovalCode("");
    setMonths(0);
  }, [open]);

  useEffect(() => {
    if (open) setAmountText(remaining > 0 ? String(remaining) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payments.length]);

  const methodLabel = (m: PaymentMethod) => (t.payment as unknown as Record<string, string>)[m] ?? m;

  const quickCash = useMemo(() => {
    const base = remaining || grandTotal;
    const set = new Set<number>([base]);
    for (const step of [100, 500, 1000]) set.add(Math.ceil(base / step) * step);
    set.add(Math.ceil(base / 1000) * 1000 + 1000);
    return Array.from(set).filter((v) => v >= base).sort((a, b) => a - b).slice(0, 4);
  }, [remaining, grandTotal]);

  function addPayment(amount: number) {
    if (amount <= 0) return;
    const entry: PaymentEntry = { method, amount: round2(amount) };
    if (method === "credit_card" || method === "debit_card" || method === "edc" || method === "installment") {
      entry.acquirer_bank = bank.th;
      if (last4) entry.card_last4 = last4;
      if (approvalCode) entry.approval_code = approvalCode;
      if (method === "installment" && months > 0) entry.installment_months = months;
    }
    if (method === "bank_transfer") entry.acquirer_bank = bank.th;
    setPayments((p) => [...p, entry]);
    setLast4("");
    setApprovalCode("");
  }

  const needsCardFields = ["credit_card", "debit_card", "edc", "installment"].includes(method);
  const canConfirm = paid >= grandTotal && grandTotal > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.payment.title}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="ok"
            className="min-w-[180px]"
            disabled={!canConfirm}
            loading={busy}
            onClick={() => onConfirm(payments, paid, change)}
          >
            {t.common.confirm} · {formatTHB(grandTotal)}
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-[1.15fr_1fr] gap-5">
        {/* ซ้าย: เลือกวิธีชำระ */}
        <div>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = method === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className={`relative flex flex-col items-center justify-center gap-1.5 h-20 rounded-xl border text-xs font-medium transition-all active:scale-95 ${
                    active ? "border-transparent shadow-sm" : "border-line bg-surface hover:bg-surface2 text-ink"
                  }`}
                  style={active ? { background: `${m.accent}14`, color: m.accent, boxShadow: `inset 0 0 0 1.5px ${m.accent}` } : undefined}
                >
                  <span
                    className="grid place-items-center rounded-lg transition-colors"
                    style={{ width: 34, height: 34, background: active ? m.accent : "rgb(var(--c-surface-2))", color: active ? "#fff" : m.accent }}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="text-[11px] text-center leading-tight px-1">{methodLabel(m.value)}</span>
                </button>
              );
            })}
          </div>

          {method === "cash" ? (
            <div className="mt-3">
              <label className="label">{t.payment.quickCash}</label>
              <div className="grid grid-cols-4 gap-2">
                {quickCash.map((v) => (
                  <button
                    key={v}
                    onClick={() => addPayment(v)}
                    className="h-11 rounded-xl border border-line bg-surface2 text-sm font-semibold tnum hover:border-brand"
                  >
                    {formatTHB(v, false)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {(needsCardFields || method === "bank_transfer") ? (
            <div className="mt-3">
              <label className="label">{t.payment.bank}</label>
              <div className="grid grid-cols-5 sm:grid-cols-7 gap-1.5">
                {BANKS.map((b) => {
                  const active = bank.code === b.code;
                  return (
                    <button
                      key={b.code}
                      onClick={() => setBank(b)}
                      title={b.th}
                      className={`flex flex-col items-center gap-1 py-1.5 rounded-xl border transition-all active:scale-95 ${
                        active ? "border-brand bg-brand/8" : "border-transparent hover:bg-surface2"
                      }`}
                    >
                      <BankMark bank={b} size={30} />
                      <span className="text-[9px] leading-none text-muted truncate max-w-[44px]">{b.en}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {needsCardFields ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Field label={t.payment.cardLast4}>
                <Input value={last4} maxLength={4} inputMode="numeric" onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label={t.payment.approvalCode}>
                <Input value={approvalCode} onChange={(e) => setApprovalCode(e.target.value)} />
              </Field>
              {method === "installment" ? (
                <Field label={t.payment.installmentMonths}>
                  <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                    {[0, 3, 6, 10, 12, 18, 24].map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? "-" : `${m}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="label">{t.common.amount}</label>
              <Input
                value={amountText}
                inputMode="decimal"
                onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ""))}
                className="text-right text-lg font-semibold tnum"
              />
            </div>
            <Button variant="primary" onClick={() => addPayment(Number(amountText || 0))}>
              <Plus size={16} /> {t.payment.addPayment}
            </Button>
          </div>
        </div>

        {/* ขวา: สรุป */}
        <div className="rounded-xl border border-line bg-surface2 p-4 flex flex-col">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">{t.pos.grandTotal}</span>
            <span className="text-2xl font-semibold tnum">{formatTHB(grandTotal)}</span>
          </div>

          <div className="mt-4 space-y-2 flex-1 min-h-[120px]">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface border border-line rounded-lg px-3 py-2">
                {p.acquirer_bank ? (
                  <BankMark bank={p.acquirer_bank} size={30} />
                ) : (
                  <span className="grid place-items-center rounded-[28%] shrink-0" style={{ width: 30, height: 30, background: METHODS.find((m) => m.value === p.method)?.accent ?? "#64748b", color: "#fff" }}>
                    {(() => { const Icon = METHODS.find((m) => m.value === p.method)?.icon ?? Banknote; return <Icon size={15} />; })()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{methodLabel(p.method)}</p>
                  <p className="text-[10px] text-muted truncate">
                    {[p.acquirer_bank, p.card_last4 ? `****${p.card_last4}` : "", p.approval_code, p.installment_months ? `${p.installment_months} ${L("งวด", "mo", "期")}` : ""]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <span className="text-sm tnum font-medium">{formatTHB(p.amount, false)}</span>
                <button onClick={() => setPayments((list) => list.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!payments.length ? (
              <p className="text-xs text-muted text-center py-6">{t.payment.mixed} — {t.payment.addPayment}</p>
            ) : null}
          </div>

          <div className="border-t border-line pt-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t.payment.remaining}</span>
              <span className={`tnum font-semibold ${remaining > 0 ? "text-warn" : "text-ok"}`}>{formatTHB(remaining)}</span>
            </div>
            {change > 0 ? (
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t.pos.change}</span>
                <span className="tnum font-semibold text-brand">{formatTHB(change)}</span>
              </div>
            ) : null}
            {payments.length > 1 ? <Badge tone="info">{t.payment.mixed}</Badge> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
