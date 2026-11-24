"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote, CreditCard, QrCode, Landmark, Smartphone, Gift, Wallet, CalendarClock, Plus, Trash2,
} from "lucide-react";
import { Modal, Button, Input, Field, Select, Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB, round2 } from "@/lib/money";
import type { PaymentEntry, PaymentMethod } from "@/lib/types";
import { BANKS, type BankInfo } from "@/lib/banks";
import { BankMark } from "@/components/pos/bank-mark";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/components/toast-host";
import { isLiveMode } from "@/lib/supabase/client";
import { useSession } from "@/lib/store/session";
import { promptPayPayload } from "@/lib/promptpay";

const METHODS: { value: PaymentMethod; icon: typeof Banknote; accent: string }[] = [
  { value: "credit_card", icon: CreditCard, accent: "#6366f1" },
  { value: "qr_promptpay", icon: QrCode, accent: "#2563eb" },
  { value: "debit_card", icon: CreditCard, accent: "#0891b2" },
  { value: "bank_transfer", icon: Landmark, accent: "#7c3aed" },
  { value: "edc", icon: Smartphone, accent: "#db2777" },
  { value: "installment", icon: CalendarClock, accent: "#ea580c" },
];

export function PaymentModal({
  open,
  onClose,
  grandTotal,
  onConfirm,
  busy,
  onDisplaySync,
  checkoutId,
  restoredPayments,
  onRecordPayment,
  title,
  confirmLabel,
}: {
  title?: string;
  confirmLabel?: string;
  open: boolean;
  onClose: () => void;
  grandTotal: number;
  onConfirm: (payments: PaymentEntry[], paid: number, change: number) => void;
  busy?: boolean;
  checkoutId?: string | null;
  restoredPayments?: PaymentEntry[];
  onRecordPayment?: (entry:PaymentEntry)=>Promise<void>;
  onDisplaySync?: (info: { method: PaymentMethod; methodLabel: string; qr: string | null; amountDue: number }) => void;
}) {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const toast=useToast();
  const recording=useRef(false);
  const [recordBusy,setRecordBusy]=useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("credit_card");
  const [amountText, setAmountText] = useState("");
  const [bank, setBank] = useState<BankInfo>(BANKS[0]);
  const [last4, setLast4] = useState("");
  const [approvalCode, setApprovalCode] = useState("");
  const [months, setMonths] = useState(0);
  const branchId = useSession(s => s.branchId);
  const [account, setAccount] = useState<{configured:boolean;payeeName?:string;mobile?:string}>({configured:false});
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  useEffect(() => {
    if(!open || !branchId) return;
    let alive=true; setAccount({configured:false}); setAccountError(null);
    fetch(`/api/pos/payment-config?branch_id=${encodeURIComponent(branchId)}`,{cache:"no-store"})
      .then(async r=>{const data=await r.json();if(!r.ok) throw new Error(data.error);return data;})
      .then(data=>{if(alive)setAccount(data);}).catch(e=>{if(alive)setAccountError(e.message);});
    return ()=>{alive=false;};
  },[open,branchId]);

  const paid = useMemo(() => round2(payments.reduce((s, p) => s + p.amount, 0)), [payments]);
  const remaining = round2(Math.max(grandTotal - paid, 0));
  const change = round2(Math.max(paid - grandTotal, 0));

  useEffect(() => {
    if (!open) return;
    let restored: PaymentEntry[] = [];
    try { const value=checkoutId?JSON.parse(localStorage.getItem(`shdpos.payment:${checkoutId}`)||"[]"):[]; if(Array.isArray(value))restored=value; } catch { /* malformed cache: preserve the checkout identity for review */ }
    setPayments(restoredPayments ?? restored); setReference(""); setConfirmed(false);
    setMethod("credit_card");
    setAmountText("");
    setLast4("");
    setApprovalCode("");
    setMonths(0);
  }, [open,checkoutId,restoredPayments]);

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

  async function addPayment(amount: number) {
    if(recording.current)return;
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining || !confirmed || !(reference.trim() || approvalCode.trim())) return;
    if (method === "qr_promptpay" && !account.mobile) return;
    if (method === "installment" && !months) return;
    const entry: PaymentEntry = { method, amount: round2(amount), reference_no: reference.trim() || approvalCode.trim() };
    if (method === "credit_card" || method === "debit_card" || method === "edc" || method === "installment") {
      entry.acquirer_bank = bank.th;
      if (last4) entry.card_last4 = last4;
      if (approvalCode) entry.approval_code = approvalCode;
      if (method === "installment" && months > 0) entry.installment_months = months;
    }
    if (method === "bank_transfer") entry.acquirer_bank = bank.th;
    recording.current=true;setRecordBusy(true);
    try {
    if(onRecordPayment)await onRecordPayment(entry);
    setPayments((p) => {
      if(p.some(x=>x.method===entry.method && x.reference_no===entry.reference_no))return p;
      const next=[...p,entry];
      if(checkoutId)localStorage.setItem(`shdpos.payment:${checkoutId}`,JSON.stringify(next));
      return next;
    });
    setLast4("");
    setApprovalCode(""); setReference(""); setConfirmed(false);
    } catch(error) {toast.push({tone:"danger",title:L("ต้องตรวจสอบรายการรับชำระ","Payment needs review","请核对收款"),body:error instanceof Error?error.message:String(error)});}
    finally{recording.current=false;setRecordBusy(false);}
  }

  const needsCardFields = ["credit_card", "debit_card", "edc", "installment"].includes(method);
  const canAdd = confirmed && Boolean(reference.trim() || approvalCode.trim()) && Number.isFinite(Number(amountText)) && Number(amountText)>0 && Number(amountText)<=remaining && (method!=="qr_promptpay" || Boolean(account.mobile)) && (method!=="installment" || months>0) && (!last4 || last4.length===4);
  const canConfirm = paid === round2(grandTotal) && grandTotal > 0;
  const qrDue = remaining > 0 ? remaining : grandTotal;

  // ส่งบริบทการชำระเงินไปจอลูกค้า (วิธีจ่าย + QR)
  useEffect(() => {
    if (!open) return;
    onDisplaySync?.({
      method,
      methodLabel: methodLabel(method),
      qr: method === "qr_promptpay" && account.mobile ? promptPayPayload(account.mobile, qrDue > 0 ? qrDue : 1) : null,
      amountDue: qrDue,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method, remaining, grandTotal, account.mobile]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title??t.payment.title}
      size="xl"
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
            {confirmLabel??t.common.confirm} · {formatTHB(grandTotal)}
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-[1.15fr_1fr] gap-5">
        {/* ซ้าย: เลือกวิธีชำระ */}
        <div>
          <div className="mb-3 rounded-xl border border-brand/20 bg-brand/5 p-3 text-xs leading-relaxed">
            <p className="font-semibold text-brand">{L("รับชำระแบบไม่ใช้เงินสด", "Cashless checkout", "无现金收款")}</p>
            <p className="text-muted mt-1">{L("ตรวจผลที่เครื่อง EDC หรือบัญชีรับเงินจริงก่อนบันทึก เลขอ้างอิงใช้ติดตามการกระทบยอด การบันทึกนี้ยังไม่ใช่ผลยืนยันอัตโนมัติจากธนาคาร", "Verify the terminal or receiving account before recording. This records a manual confirmation, not an automatic bank result.", "记录前请核实终端或收款账户，本操作非银行自动确认。")}</p>
          </div>
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
              <label className="label">{L("ธนาคารผู้รับชำระ / เครื่อง EDC", "Acquiring / receiving bank", "收单/收款银行")}</label>
              <div className="grid grid-cols-2 gap-2">
                {BANKS.filter(b=>["KBANK","SCB"].includes(b.code)).map((b) => {
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

          <div className="mt-3 space-y-3 rounded-xl border border-line p-3">
            <Field label={L("เลขอ้างอิง / เลขรายการรับชำระ", "Payment reference", "收款参考号")}><Input value={reference} maxLength={150} onChange={e=>setReference(e.target.value)} placeholder={L("จากสลิปหรือรายงานธนาคาร", "From receipt or bank report", "凭证或银行报告")} /></Field>
            <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-0.5 accent-[rgb(var(--c-brand))]" />{L("ตรวจสอบแล้วว่ารายการรับชำระนี้สำเร็จ", "I verified this payment succeeded", "已核实收款成功")}</label>
          </div>
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
            <Button variant="primary" disabled={!canAdd || recordBusy} loading={recordBusy} onClick={() => addPayment(Number(amountText || 0))}>
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

          {method === "qr_promptpay" ? (
            !account.mobile ? (<div className="mt-3 rounded-xl border border-warn/30 bg-surface2 p-4 text-xs text-muted">{accountError || L("ยังไม่มีบัญชีพร้อมเพย์ที่ยืนยันสำหรับสาขานี้ กรุณาให้ผู้ดูแลตั้งค่าก่อน", "No verified PromptPay account for this branch. Ask an administrator to configure it.", "本门店尚未配置已验证的收款账户")}</div>) : remaining <= 0 ? (
              <div className="mt-3 rounded-2xl border border-ok/30 bg-ok/8 py-4 text-center text-sm font-semibold text-ok">{L("ชำระครบแล้ว ✓", "Fully paid ✓", "已付清")}</div>
            ) : (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface py-3.5 px-3">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><QrCode size={14} /> {L("สแกนจ่ายด้วยพร้อมเพย์", "Scan with PromptPay", "扫码支付")}</div>
                <div className="bg-white p-2.5 rounded-xl border border-line">
                  <QRCodeSVG value={promptPayPayload(account.mobile, qrDue > 0 ? qrDue : 1)} size={168} level="M" marginSize={0} />
                </div>
                <p className="text-xl font-extrabold tnum text-ink leading-none">{formatTHB(qrDue)}</p>
                <p className="text-[10.5px] text-muted text-center leading-snug">{L("พร้อมเพย์ร้าน", "Shop PromptPay", "商户")} {account.mobile} · {account.payeeName}<br /><span className="text-amber-600 font-medium">{L("ตรวจชื่อผู้รับก่อนชำระ · ตรวจเงินเข้าจริงก่อนบันทึก", "Verify payee and incoming funds before recording", "请核实收款人及入账")}</span></p>
                <Button variant="primary" className="w-full" disabled={!confirmed || !reference.trim() || recordBusy} loading={recordBusy} onClick={() => addPayment(qrDue)}>{L("ลูกค้าสแกนจ่ายแล้ว — บันทึก", "Customer paid — record", "已支付")}</Button>
              </div>
            )
          ) : null}

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
                <button disabled={isLiveMode()} title={isLiveMode()?"รายการรับเงินที่บันทึกแล้วต้องให้หัวหน้าตรวจแก้ไข":undefined} onClick={() => setPayments((list) => {const next=list.filter((_,idx)=>idx!==i);if(checkoutId)localStorage.setItem(`shdpos.payment:${checkoutId}`,JSON.stringify(next));return next;})} className="text-muted hover:text-danger">
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
