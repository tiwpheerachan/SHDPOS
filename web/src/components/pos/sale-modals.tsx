"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Printer, AlertTriangle, Barcode, Trash2, Plus, Inbox } from "lucide-react";
import { Modal, Button, Input, Field, Segmented, Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB, round2 } from "@/lib/money";
import type { Order, Branch, Employee } from "@/lib/types";

// =====================================================================
// ส่วนลด (รายบรรทัด / ท้ายบิล)
// =====================================================================
export function DiscountModal({
  open,
  onClose,
  base,
  limitPercent,
  title,
  initialPercent = 0,
  initialAmount = 0,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  /** ยอดที่ใช้คำนวณ % */
  base: number;
  /** เพดาน % ที่ทำได้เองโดยไม่ต้องขออนุมัติ */
  limitPercent: number;
  title: string;
  initialPercent?: number;
  initialAmount?: number;
  /** needsApproval = true เมื่อเกินเพดาน */
  onApply: (percent: number, amount: number, needsApproval: boolean) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initialAmount > 0) {
      setMode("amount");
      setValue(String(initialAmount));
    } else {
      setMode("percent");
      setValue(initialPercent ? String(initialPercent) : "");
    }
  }, [open, initialAmount, initialPercent]);

  const num = Number(value || 0);
  const percent = mode === "percent" ? num : base > 0 ? round2((num / base) * 100) : 0;
  const amount = mode === "amount" ? num : round2((base * num) / 100);
  const exceeds = percent > limitPercent;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onApply(0, 0, false)}>
            {t.common.reset}
          </Button>
          <Button variant="primary" disabled={num <= 0 || amount > base} onClick={() => onApply(mode === "percent" ? num : 0, mode === "amount" ? num : 0, exceeds)}>
            {exceeds ? t.approval.title : t.common.apply}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "percent", label: "%" },
            { value: "amount", label: "฿" },
          ]}
        />
        <Input
          autoFocus
          value={value}
          inputMode="decimal"
          onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
          className="text-right text-2xl h-16 font-semibold tnum"
        />
        <div className="grid grid-cols-4 gap-2">
          {(mode === "percent" ? [3, 5, 10, 15] : [50, 100, 200, 500]).map((q) => (
            <button key={q} onClick={() => setValue(String(q))} className="h-10 rounded-lg border border-line bg-surface2 text-sm font-medium tnum">
              {mode === "percent" ? `${q}%` : formatTHB(q, false)}
            </button>
          ))}
        </div>
        <div className="rounded-xl bg-surface2 border border-line px-3.5 py-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted">ยอดก่อนลด</span>
            <span className="tnum">{formatTHB(base)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{t.pos.discount}</span>
            <span className="tnum text-danger">
              -{formatTHB(amount)} ({percent.toFixed(1)}%)
            </span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{t.pos.grandTotal}</span>
            <span className="tnum">{formatTHB(Math.max(base - amount, 0))}</span>
          </div>
        </div>
        {exceeds ? (
          <div className="flex items-start gap-2 text-xs text-warn bg-warn/10 border border-warn/25 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              เกินสิทธิ์ของคุณ ({limitPercent}%) — ต้องให้หัวหน้าอนุมัติ
            </span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// =====================================================================
// สแกน Serial / IMEI
// =====================================================================
export function SerialModal({
  open,
  onClose,
  productName,
  qty,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  qty: number;
  initial: string[];
  onSave: (serials: string[]) => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) {
      setList(initial);
      setDraft("");
    }
  }, [open, initial]);

  function add() {
    const v = draft.trim().toUpperCase();
    if (!v || list.includes(v)) {
      setDraft("");
      return;
    }
    setList((l) => [...l, v]);
    setDraft("");
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.pos.scanSerial}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={() => onSave(list)}>
            {t.common.save} ({list.length}/{qty})
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium">{productName}</p>
        <p className="text-xs text-muted">ต้องสแกนให้ครบ {qty} ชิ้น — ใช้เครื่องสแกนยิงต่อกันได้เลย</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="SN / IMEI"
              className="pl-9 font-mono"
            />
          </div>
          <Button variant="soft" onClick={add}>
            <Plus size={16} />
          </Button>
        </div>
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {list.map((s, i) => (
            <li key={s} className="flex items-center gap-2 bg-surface2 border border-line rounded-lg px-3 py-2">
              <span className="text-[10px] text-muted w-5 tnum">{i + 1}</span>
              <span className="text-xs font-mono flex-1 truncate">{s}</span>
              <button onClick={() => setList((l) => l.filter((x) => x !== s))} className="text-muted hover:text-danger">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {!list.length ? <li className="text-xs text-muted text-center py-6">ยังไม่มี serial</li> : null}
        </ul>
      </div>
    </Modal>
  );
}

// =====================================================================
// หลังขายสำเร็จ — แยก "ขายสำเร็จ" ออกจาก "พิมพ์สลิป" อย่างชัดเจน
// เครื่องพิมพ์พังต้องไม่ทำให้บิลล้ม
// =====================================================================
export type PrintStatus = "idle" | "printing" | "ok" | "failed";

export function ReceiptModal({
  open,
  order,
  branch,
  cashier,
  printStatus,
  printError,
  onRetryPrint,
  onOpenDrawer,
  onNewSale,
  canOpenDrawer,
}: {
  open: boolean;
  order: Order | null;
  branch?: Branch;
  cashier?: Employee;
  printStatus: PrintStatus;
  printError?: string | null;
  onRetryPrint: () => void;
  onOpenDrawer: () => void;
  onNewSale: () => void;
  canOpenDrawer: boolean;
}) {
  const { t } = useI18n();
  if (!order) return null;

  return (
    <Modal open={open} onClose={onNewSale} size="md">
      <div className="text-center py-2">
        <div className="mx-auto w-14 h-14 rounded-full bg-ok/12 grid place-items-center mb-3">
          <CheckCircle2 size={30} className="text-ok" />
        </div>
        <h3 className="text-lg font-semibold">{t.pos.saleCompleted}</h3>
        <p className="text-xs text-muted mt-1">
          {t.pos.receiptNo} <span className="font-mono">{order.order_no}</span>
        </p>
        {order.is_offline_origin ? (
          <div className="mt-2 flex justify-center">
            <Badge tone="warn">{t.offline.offline} · {t.offline.pending}</Badge>
          </div>
        ) : null}

        <div className="mt-5 rounded-xl border border-line bg-surface2 px-4 py-3 text-left space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t.pos.grandTotal}</span>
            <span className="tnum font-semibold">{formatTHB(order.grand_total)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t.pos.received}</span>
            <span className="tnum">{formatTHB(order.paid_total)}</span>
          </div>
          {order.change_amount > 0 ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t.pos.change}</span>
              <span className="tnum font-semibold text-brand text-lg">{formatTHB(order.change_amount)}</span>
            </div>
          ) : null}
        </div>

        {/* สถานะการพิมพ์ — แยกจากสถานะการขาย */}
        <div className="mt-4">
          {printStatus === "printing" ? (
            <p className="text-xs text-muted flex items-center justify-center gap-2">
              <Printer size={14} /> {t.pos.printing}
            </p>
          ) : printStatus === "ok" ? (
            <p className="text-xs text-ok flex items-center justify-center gap-2">
              <Printer size={14} /> {t.common.done}
            </p>
          ) : printStatus === "failed" ? (
            <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
              <p className="text-sm font-medium text-danger flex items-center justify-center gap-2">
                <AlertTriangle size={15} /> {t.pos.printFailed}
              </p>
              {printError ? <p className="text-[11px] text-muted mt-1 break-all">{printError}</p> : null}
              <Button variant="soft" className="mt-2.5 w-full" onClick={onRetryPrint}>
                <Printer size={15} /> {t.common.retry}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onRetryPrint}>
            <Printer size={15} /> {t.pos.reprint}
          </Button>
          <Button variant="ghost" disabled={!canOpenDrawer} onClick={onOpenDrawer}>
            <Inbox size={15} /> {t.pos.openDrawer}
          </Button>
        </div>
        <Button variant="primary" className="w-full mt-2" onClick={onNewSale}>
          {t.pos.newSale}
        </Button>
      </div>
    </Modal>
  );
}
