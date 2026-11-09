"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Users, Banknote, ArrowDownToLine, ArrowUpFromLine, Inbox } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { employeesAtBranch, openShift, closeShift, currentShift, listOrders, writeAudit } from "@/lib/data/repo";
import type { Employee, Order } from "@/lib/types";
import { Button, Card, CardHeader, Input, Field, Badge, Modal, Table, Th, Td } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { can } from "@/lib/permissions";
import { openCashDrawer } from "@/lib/printing/bridge";

export default function ShiftPage() {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const employee = session.employee;
  const branchId = session.branchId;

  const [staff, setStaff] = useState<Employee[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [openingCash, setOpeningCash] = useState("2000");
  const [countedCash, setCountedCash] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    void (async () => {
      setStaff(await employeesAtBranch(branchId));
      const sh = await currentShift(branchId);
      session.setShift(sh ?? null);
      if (sh) {
        const all = await listOrders({ branchIds: [branchId] });
        setOrders(all.filter((o) => o.shift_id === sh.id));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const shift = session.shift;

  async function doOpen() {
    if (!employee || !branchId) return;
    setBusy(true);
    try {
      const sh = await openShift({
        branchId,
        terminalId: session.terminalId,
        employeeId: employee.id,
        memberIds: members,
        openingCash: Number(openingCash || 0),
      });
      session.setShift(sh);
      toast.push({ tone: "ok", title: t.shift.open, body: sh.shift_no });
      router.push("/pos/sell");
    } finally {
      setBusy(false);
    }
  }

  async function doClose() {
    if (!employee || !shift) return;
    setBusy(true);
    try {
      const res = await closeShift(shift.id, Number(countedCash || 0), employee.id);
      session.setShift(null);
      setCloseOpen(false);
      toast.push({
        tone: res && Math.abs(res.variance) < 1 ? "ok" : "warn",
        title: t.shift.close,
        body: res ? `${t.shift.variance}: ${formatTHB(res.variance)}` : undefined,
      });
      router.push("/pos");
    } finally {
      setBusy(false);
    }
  }

  const cashSales = orders
    .filter((o) => o.status !== "voided")
    .reduce((s, o) => s + o.payments.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0), 0);
  const expected = (shift?.opening_cash ?? 0) + cashSales;

  if (!employee || !branchId) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Clock size={18} className="text-brand" /> {t.shift.title}
      </h1>

      {!shift ? (
        <Card className="max-w-lg">
          <CardHeader title={t.shift.open} subtitle={t.shift.openFirst} />
          <div className="p-5 space-y-4">
            <Field label={t.shift.openingCash}>
              <Input
                value={openingCash}
                inputMode="decimal"
                onChange={(e) => setOpeningCash(e.target.value.replace(/[^\d.]/g, ""))}
                className="text-right text-lg tnum"
              />
            </Field>

            <div>
              <label className="label flex items-center gap-1.5">
                <Users size={13} /> {t.shift.members}
              </label>
              <div className="grid sm:grid-cols-2 gap-2">
                {staff
                  .filter((s) => s.id !== employee.id)
                  .map((s) => {
                    const on = members.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => setMembers((m) => (on ? m.filter((x) => x !== s.id) : [...m, s.id]))}
                        className={`text-left rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          on ? "border-brand bg-brand/6" : "border-line bg-surface hover:bg-surface2"
                        }`}
                      >
                        <span className="font-medium">{s.nickname ?? s.first_name}</span>
                        <span className="block text-[11px] text-muted">{s.employee_code}</span>
                      </button>
                    );
                  })}
              </div>
              <p className="text-[11px] text-muted mt-2">
                {L("เลือกพนักงานที่เข้ากะพร้อมกัน — ระบบจะเก็บยอดขายแยกรายคนให้อัตโนมัติ", "Select staff sharing this shift — sales are tracked per person automatically", "选择同班员工 — 系统会自动按人统计销售额")}
              </p>
            </div>

            <Button variant="primary" className="w-full" loading={busy} onClick={() => void doOpen()}>
              {t.shift.open}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <Card>
            <CardHeader
              title={`${t.shift.summary} · ${shift.shift_no}`}
              subtitle={`${t.shift.open}: ${new Date(shift.opened_at).toLocaleString(locale === "th" ? "th-TH" : "en-US")}`}
              right={<Badge tone="ok">{t.approval.approved}</Badge>}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
              {[
                { label: t.shift.totalSales, value: formatTHB(shift.total_sales) },
                { label: t.shift.totalOrders, value: String(shift.total_orders) },
                { label: t.payment.cash, value: formatTHB(cashSales) },
                { label: t.shift.expectedCash, value: formatTHB(expected) },
              ].map((k) => (
                <div key={k.label} className="bg-surface px-4 py-3">
                  <p className="text-[11px] text-muted">{k.label}</p>
                  <p className="text-base font-semibold tnum mt-0.5">{k.value}</p>
                </div>
              ))}
            </div>

            <div className="p-4">
              <p className="text-xs font-medium text-muted mb-2">{t.orders.today}</p>
              <Table>
                <thead>
                  <tr>
                    <Th>{t.pos.receiptNo}</Th>
                    <Th>{t.common.time}</Th>
                    <Th align="right">{t.common.amount}</Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 12).map((o) => (
                    <tr key={o.id}>
                      <Td className="font-mono text-xs">{o.order_no}</Td>
                      <Td className="text-xs text-muted">
                        {new Date(o.created_at).toLocaleTimeString(locale === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                      </Td>
                      <Td align="right">{formatTHB(o.grand_total, false)}</Td>
                    </tr>
                  ))}
                  {!orders.length ? (
                    <tr>
                      <Td className="text-center text-xs text-muted py-6">{t.common.empty}</Td>
                      <Td />
                      <Td />
                    </tr>
                  ) : null}
                </tbody>
              </Table>
            </div>
          </Card>

          <div className="space-y-3">
            <Card className="p-4 space-y-2">
              <p className="text-xs font-medium text-muted flex items-center gap-1.5">
                <Banknote size={13} /> {t.shift.title}
              </p>
              <Button
                variant="ghost"
                className="w-full justify-start"
                disabled={!can(employee, "pos.open_drawer")}
                onClick={() => void openCashDrawer(session.printer)}
              >
                <Inbox size={15} /> {t.shift.noSale}
              </Button>
              <Button variant="ghost" className="w-full justify-start" onClick={() => toast.push({ tone: "info", title: t.shift.cashIn, body: L("บันทึกผ่านหน้าหลังบ้าน", "Record via Back Office", "请在后台记录") })}>
                <ArrowDownToLine size={15} /> {t.shift.cashIn}
              </Button>
              <Button variant="ghost" className="w-full justify-start" onClick={() => toast.push({ tone: "info", title: t.shift.cashOut, body: L("บันทึกผ่านหน้าหลังบ้าน", "Record via Back Office", "请在后台记录") })}>
                <ArrowUpFromLine size={15} /> {t.shift.cashOut}
              </Button>
            </Card>

            <Button variant="danger" className="w-full" onClick={() => setCloseOpen(true)}>
              {t.shift.close}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={t.shift.close}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void doClose()}>
              {t.shift.close}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-surface2 border border-line px-4 py-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted">{t.shift.openingCash}</span>
              <span className="tnum">{formatTHB(shift?.opening_cash ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t.payment.cash}</span>
              <span className="tnum">{formatTHB(cashSales)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-line pt-1.5">
              <span>{t.shift.expectedCash}</span>
              <span className="tnum">{formatTHB(expected)}</span>
            </div>
          </div>
          <Field label={t.shift.countedCash}>
            <Input
              autoFocus
              value={countedCash}
              inputMode="decimal"
              onChange={(e) => setCountedCash(e.target.value.replace(/[^\d.]/g, ""))}
              className="text-right text-xl tnum h-14"
            />
          </Field>
          {countedCash ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t.shift.variance}</span>
              <span className={`tnum font-semibold ${Number(countedCash) - expected < 0 ? "text-danger" : "text-ok"}`}>
                {formatTHB(Number(countedCash) - expected)}
              </span>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
