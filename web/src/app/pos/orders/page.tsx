"use client";

import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Printer, Ban, Search, Wallet, Download } from "lucide-react";
import { exportCsv, stampFilename } from "@/lib/export";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listOrders, voidOrder, getBranch } from "@/lib/data/repo";
import type { Branch, Order } from "@/lib/types";
import { Button, Input, Modal, Table, Th, Td, Badge, EmptyState, Field, Segmented, SkeletonTable } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { formatTHB, formatInt, formatCompact } from "@/lib/money";
import { can, needsApproval } from "@/lib/permissions";
import { ApprovalModal, type ApprovalRequestInput } from "@/components/pos/approval-modal";
import { OrderDrawer } from "@/components/pos/order-drawer";
import { buildReceipt } from "@/lib/printing/receipt";
import { printEscPos } from "@/lib/printing/bridge";

const COMPANY = {
  name_th: "บริษัท เอส เอช ดี เทคโนโลยี จำกัด",
  tax_id: "0000000000000",
  address: "กรุงเทพมหานคร",
  phone: "02-000-0000",
};

export default function PosOrdersPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const session = useSession();
  const employee = session.employee;
  const branchId = session.branchId;

  const [orders, setOrders] = useState<Order[]>([]);
  const [branch, setBranch] = useState<Branch>();
  const [range, setRange] = useState<"today" | "7d">("today");
  const [status, setStatus] = useState<"all" | "completed" | "voided">("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Order | null>(null);
  const [voidTarget, setVoidTarget] = useState<Order | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [approvalReq, setApprovalReq] = useState<ApprovalRequestInput | null>(null);

  async function reload() {
    if (!branchId) return;
    setLoading(true);
    const from = new Date();
    if (range === "today") from.setHours(0, 0, 0, 0);
    else from.setDate(from.getDate() - 7);
    setOrders(await listOrders({ branchIds: [branchId], from }));
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    if (branchId) void getBranch(branchId).then(setBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, range]);

  // เปิด drawer อัตโนมัติเมื่อมาจาก Command Search (?focus=order_no)
  useEffect(() => {
    if (loading || !orders.length) return;
    const no = new URLSearchParams(window.location.search).get("focus");
    if (no) { const o = orders.find((x) => x.order_no === no); if (o) setDetail(o); }
  }, [loading, orders]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; key: string };
      if (d?.kind === "order") { const o = orders.find((x) => x.order_no === d.key); if (o) setDetail(o); }
    };
    window.addEventListener("shd:focus", h);
    return () => window.removeEventListener("shd:focus", h);
  }, [orders]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (status === "voided" && o.status !== "voided") return false;
      if (status === "completed" && o.status === "voided") return false;
      if (!term) return true;
      return o.order_no.toLowerCase().includes(term) || (o.customer_name ?? "").toLowerCase().includes(term);
    });
  }, [orders, q, status]);

  const summary = useMemo(() => {
    const valid = filtered.filter((o) => o.status !== "voided");
    return {
      count: filtered.length,
      total: valid.reduce((s, o) => s + o.grand_total, 0),
      voided: filtered.filter((o) => o.status === "voided").length,
    };
  }, [filtered]);

  async function reprint(o: Order) {
    const res = await printEscPos(
      session.printer,
      buildReceipt({ order: o, branch, cashier: employee ?? undefined, company: COMPANY, width: session.printer.width, copyLabel: "สำเนา / REPRINT" })
    );
    toast.push(
      res.ok
        ? { tone: "ok", title: t.pos.reprint }
        : { tone: "danger", title: t.pos.printFailed, body: res.error ?? undefined }
    );
  }

  function askVoid(o: Order) {
    if (!employee) return;
    if (needsApproval(employee, "pos.void")) {
      setVoidTarget(o);
      setApprovalReq({
        kind: "void",
        minRole: "supervisor",
        branchId: branchId!,
        requestedBy: employee.id,
        amount: o.grand_total,
        reason: `ยกเลิกบิล ${o.order_no}`,
        payload: { order_no: o.order_no },
      });
      return;
    }
    setVoidTarget(o);
  }

  async function doVoid() {
    if (!voidTarget || !employee) return;
    await voidOrder(voidTarget.id, employee.id, voidReason || "-");
    setVoidTarget(null);
    setVoidReason("");
    await reload();
    toast.push({ tone: "warn", title: t.orders.void, body: voidTarget.order_no });
  }

  if (!employee) return null;
  const showGp = can(employee, "report.gross_profit");

  return (
    <PosPage
      title={t.orders.title}
      icon={<ReceiptText size={18} />}
      actions={
        <>
          <Segmented
            size="sm"
            value={range}
            onChange={setRange}
            options={[
              { value: "today", label: t.common.today },
              { value: "7d", label: t.common.week },
            ]}
          />
          <Segmented
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: t.common.all },
              { value: "completed", label: t.orders.completed },
              { value: "voided", label: t.orders.voided },
            ]}
          />
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
          </div>
          <Button variant="ghost" className="h-9 px-3 text-xs" disabled={!filtered.length}
            onClick={() => exportCsv(stampFilename("orders"), filtered.map((o) => ({
              order_no: o.order_no, time: o.created_at, customer: o.customer_name ?? "",
              items: o.items.length, subtotal: o.subtotal, discount: o.discount_total,
              vat: o.vat_amount, total: o.grand_total, payment: o.payments.map((p) => p.method).join("+"), status: o.status,
            })))}>
            <Download size={14} /> {t.common.export}
          </Button>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatChip label={t.orders.title} value={formatInt(summary.count)} accent="lavender" icon={<ReceiptText size={16} />} />
        <StatChip label={t.common.total} value={`฿${formatCompact(summary.total)}`} accent="coral" icon={<Wallet size={16} />} />
        <StatChip label={t.orders.voided} value={formatInt(summary.voided)} accent={summary.voided ? "peach" : "mint"} icon={<Ban size={16} />} />
      </div>
      <TablePanel>
        {loading ? (
          <SkeletonTable rows={8} cols={7} />
        ) : filtered.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.pos.receiptNo}</Th>
                <Th>{t.common.time}</Th>
                <Th>{t.common.customer}</Th>
                <Th align="center">{t.common.qty}</Th>
                <Th align="right">{t.common.total}</Th>
                <Th align="center">{t.common.status}</Th>
                <Th align="right">{t.common.action}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="hover:bg-surface2/60">
                  <Td>
                    <button onClick={() => setDetail(o)} className="font-mono text-xs text-brand hover:underline">
                      {o.order_no}
                    </button>
                  </Td>
                  <Td className="text-xs text-muted">
                    {new Date(o.created_at).toLocaleString(locale === "th" ? "th-TH" : "en-US", {
                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </Td>
                  <Td className="text-xs">{o.customer_name ?? "—"}</Td>
                  <Td align="center" className="text-xs">{o.items.length}</Td>
                  <Td align="right" className="font-medium">{formatTHB(o.grand_total, false)}</Td>
                  <Td align="center">
                    {o.status === "voided" ? (
                      <Badge tone="danger">{t.orders.voided}</Badge>
                    ) : o.is_offline_origin ? (
                      <Badge tone="warn">{t.offline.pending}</Badge>
                    ) : (
                      <Badge tone="ok">{t.orders.completed}</Badge>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => void reprint(o)}
                        className="p-1.5 rounded-lg hover:bg-surface2 text-muted"
                        title={t.pos.reprint}
                      >
                        <Printer size={14} />
                      </button>
                      {o.status !== "voided" ? (
                        <button
                          onClick={() => askVoid(o)}
                          className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger"
                          title={t.orders.void}
                        >
                          <Ban size={14} />
                        </button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<ReceiptText size={26} />} title={t.common.empty} />
        )}
      </TablePanel>
      </div>

      {/* Transaction Center — รายละเอียดบิลแบบเต็ม */}
      <OrderDrawer
        order={detail}
        branch={branch}
        employee={employee}
        showGp={showGp}
        onClose={() => setDetail(null)}
        onReprint={(o) => void reprint(o)}
        onVoid={(o) => { setDetail(null); askVoid(o); }}
      />

      {/* ยกเลิกบิล */}
      <Modal
        open={Boolean(voidTarget) && !approvalReq}
        onClose={() => setVoidTarget(null)}
        title={t.orders.void}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidTarget(null)}>{t.common.cancel}</Button>
            <Button variant="danger" disabled={!voidReason.trim()} onClick={() => void doVoid()}>{t.orders.void}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            {voidTarget?.order_no} · <span className="tnum font-semibold">{formatTHB(voidTarget?.grand_total ?? 0)}</span>
          </p>
          <p className="text-xs text-muted">สินค้าจะถูกคืนเข้าสต๊อกอัตโนมัติ และบันทึกลง audit log</p>
          <Field label={t.orders.voidReason}>
            <Input autoFocus value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ApprovalModal
        request={approvalReq}
        onClose={() => setApprovalReq(null)}
        onApproved={() => toast.push({ tone: "ok", title: t.approval.approved })}
      />
    </PosPage>
  );
}
