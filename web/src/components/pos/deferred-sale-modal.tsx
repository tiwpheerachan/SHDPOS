"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, Input, Badge } from "@/components/ui";
import { PaymentModal } from "./payment-modal";
import { deferredRequest, type DeferredSale } from "@/lib/deferred-sales";
import { useSession } from "@/lib/store/session";
import type { CartLine } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";
import { formatTHB, round2 } from "@/lib/money";
const localDate = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function DeferredSaleModal({
  open,
  onClose,
  lines,
  discountTotal,
  customer,
  channel,
  couponCode,
  redeemPoints,
  salespersonId,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  discountTotal: number;
  customer: { id: string | null; name: string; phone: string };
  channel: string;
  couponCode: string | null;
  redeemPoints: number;
  salespersonId: string | null;
  onRegistered: () => void;
}) {
  const session = useSession(),
    router = useRouter(),
    [form, setForm] = useState<any>(null),
    [record, setRecord] = useState<DeferredSale | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pay, setPay] = useState(false);
  const recordRef = useRef<DeferredSale | null>(null);
  const key = `shdpos.deferred-create:${session.employee?.id}:${session.branchId}`;
  useEffect(() => {
    if (!open) return;
    setError("");
    setRecord(null);
    recordRef.current = null;
    setPay(false);
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) || "null");
    } catch {}
    setForm(
      saved ?? {
        id: uuidv4(),
        occurred: localDate(),
        reason: "",
        delivered: true,
        draft: {
          items: structuredClone(lines),
          discount_total: discountTotal,
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: customer.phone,
          channel,
          salesperson_id: salespersonId,
          coupon_code: couponCode,
          redeem_points: redeemPoints,
        },
      },
    );
  }, [open]);
  const change = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const total = form
    ? round2(
        form.draft.items.reduce(
          (n: number, i: any) => n + i.qty * Number(i.unit_price),
          0,
        ) - form.draft.discount_total,
      )
    : 0;
  function update(d: DeferredSale) {
    recordRef.current = d;
    setRecord(d);
  }
  async function create(collect: boolean) {
    if (!form || !session.branchId) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        draft: {
          ...form.draft,
          subtotal: round2(total + form.draft.discount_total),
          grand_total: total,
        },
      };
      localStorage.setItem(key, JSON.stringify(payload));
      const r = await deferredRequest("create", form.id, session.branchId, {
        draft: payload.draft,
        occurred_at: new Date(form.occurred).toISOString(),
        reason: form.reason,
        delivered: form.delivered,
      });
      update(r.item);
      localStorage.removeItem(key);
      onRegistered();
      if (collect) setPay(true);
      else {
        onClose();
        router.push("/pos/holds");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Modal
        open={open && !pay}
        onClose={() => {
          if (!busy) onClose();
        }}
        title="ขายก่อน · รอข้อมูลเพื่อปิดบิล"
        size="lg"
        footer={
          <>
            {record ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onClose();
                  router.push("/pos/holds");
                }}
              >
                ไปที่รายการรอปิดบิล
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="soft"
                  disabled={busy}
                  onClick={() => void create(false)}
                >
                  เก็บไว้ก่อน
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !form?.reason?.trim() || total <= 0}
                  loading={busy}
                  onClick={() => void create(true)}
                >
                  บันทึก / รับชำระ
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface2/65 p-3 text-xs leading-relaxed">
            สำหรับรายการที่ขายจริงแต่ข้อมูลยังไม่ครบ
            เก็บยอดรับชำระและหลักฐานไว้ที่เซิร์ฟเวอร์ แล้วกลับมาเติม
            SN/แก้ข้อมูลสินค้าที่ “พักบิล → ขายก่อนรอปิดบิล”
            รายการนี้ยังไม่ใช่บิลขายที่ปิดสมบูรณ์
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {record ? (
            <p className="text-sm">
              บันทึกรายการ {record.id.slice(0, 8).toUpperCase()} แล้ว
              กลับมาเติมข้อมูลหรือรับชำระต่อได้ในพักบิล
            </p>
          ) : form ? (
            <>
              <label className="block text-xs">
                วันเวลาขายจริง
                <input
                  type="datetime-local"
                  value={form.occurred}
                  onChange={(e) => change({ occurred: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-line bg-surface2 p-2 text-xs"
                />
              </label>
              <div className="divide-y divide-line">
                {form.draft.items.map((line: any, index: number) => (
                  <div
                    key={line.lineId ?? index}
                    className="py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-muted">
                        {line.sku} · {line.qty} ชิ้น · SN{" "}
                        {(line.serials ?? []).length}/{line.qty}
                      </p>
                    </div>
                    <label className="text-xs w-32">
                      ราคาขายจริง/ชิ้น
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.unit_price}
                        onChange={(e) => {
                          const items = form.draft.items.map(
                            (i: any, n: number) =>
                              n === index
                                ? { ...i, unit_price: Number(e.target.value) }
                                : i,
                          );
                          change({ draft: { ...form.draft, items } });
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-surface2 p-3 flex justify-between text-sm">
                <span>
                  ยอดขายจริงหลังส่วนลด {formatTHB(form.draft.discount_total)}
                </span>
                <strong>{formatTHB(total)}</strong>
              </div>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.delivered}
                  onChange={(e) => change({ delivered: e.target.checked })}
                />
                ส่งมอบสินค้าให้ลูกค้าแล้ว
              </label>
              <label className="block text-xs">
                เหตุผลที่ต้องขายก่อน / ข้อมูลที่ยังขาด
                <textarea
                  rows={3}
                  value={form.reason}
                  onChange={(e) => change({ reason: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-line bg-surface2 p-2 text-xs"
                  placeholder="เช่น ลูกค้ารับสินค้าแล้ว แต่ SN ยังไม่เข้าระบบ / รอยืนยันราคา"
                />
              </label>
              <p className="text-xs text-muted">
                กันจำนวนในสาขาที่มีรายการสต๊อกไว้ระหว่างรอปิดบิล
                การปิดบิลภายหลังต้องผ่านการตรวจสต๊อกและ SN จริง
                ราคาต่างจากราคากลางต้องให้หัวหน้าที่มีสิทธิ์ตรวจ
                ไม่รองรับใช้แต้ม คูปอง หรือของแถมในโหมดนี้
              </p>
            </>
          ) : null}
        </div>
      </Modal>
      <PaymentModal
        open={open && pay && !!record}
        title="บันทึกเงินรับ · รายการรอปิดบิล"
        confirmLabel="เก็บไว้ในรายการรอปิดบิล"
        onClose={() => {
          setPay(false);
          onClose();
          router.push("/pos/holds");
        }}
        checkoutId={record?.id}
        grandTotal={Number(record?.agreed_total ?? 0)}
        restoredPayments={record?.payments}
        onRecordPayment={async (payment) => {
          const d = recordRef.current;
          if (!d || !session.branchId) throw Error("ไม่พบรายการ");
          const r = await deferredRequest("record", d.id, session.branchId, {
            version: d.version,
            payment,
          });
          update(r.item);
        }}
        onConfirm={() => {
          setPay(false);
          onClose();
          router.push("/pos/holds");
        }}
      />
    </>
  );
}
