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
import { useL } from "@/lib/i18n/provider";
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
  const L = useL();
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
  const change = (patch: any) => { if (patch.reason) setReasonErr(false); setForm((f: any) => ({ ...f, ...patch })); };
  // ปุ่มกดได้เสมอ — ถ้าข้อมูลไม่ครบให้บอกชัด ๆ ว่าขาดอะไร (เดิมปุ่มเทาเฉย ๆ ผู้ใช้นึกว่าระบบค้าง)
  const [reasonErr, setReasonErr] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  function validate(): boolean {
    if (total <= 0) { setError(L("ยอดขายเป็น 0 บาท — กรอกราคาขายจริงของแต่ละสินค้าก่อน", "Total is 0 — enter the actual price of each item first", "金额为 0 — 请先填写各商品实际售价")); return false; }
    if (!form?.reason?.trim()) { setReasonErr(true); reasonRef.current?.focus(); return false; }
    return true;
  }
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
      setError(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"));
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
        title={L("ขายก่อน · รอข้อมูลเพื่อปิดบิล", "Sell now · complete details later", "先售 · 待补资料结单")}
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
                {L("ไปที่รายการรอปิดบิล", "Go to pending bills", "前往待结单列表")}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="soft"
                  disabled={busy}
                  onClick={() => void create(false)}
                >
                  {L("เก็บไว้ก่อน", "Save for later", "先保存")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  loading={busy}
                  onClick={() => { if (validate()) void create(true); }}
                >
                  {L("บันทึก / รับชำระ", "Save / Take payment", "保存 / 收款")}
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface2/65 p-3 text-xs leading-relaxed">
            {L("สำหรับรายการที่ขายจริงแต่ข้อมูลยังไม่ครบ เก็บยอดรับชำระและหลักฐานไว้ที่เซิร์ฟเวอร์ แล้วกลับมาเติม SN/แก้ข้อมูลสินค้าที่ “พักบิล → ขายก่อนรอปิดบิล” รายการนี้ยังไม่ใช่บิลขายที่ปิดสมบูรณ์", "For real sales with incomplete data. Payments and evidence are kept on the server; come back to add SN / fix product data under “Hold → Sell now, close later”. This is not yet a completed bill.", "适用于已实际销售但资料不全的项目。收款和凭证保存在服务器，之后可在“挂单 → 先售待结单”补充 SN/修改商品资料。此项目尚未成为完整结单。")}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {record ? (
            <p className="text-sm">
              {L(`บันทึกรายการ ${record.id.slice(0, 8).toUpperCase()} แล้ว กลับมาเติมข้อมูลหรือรับชำระต่อได้ในพักบิล`, `Saved ${record.id.slice(0, 8).toUpperCase()}. Add details or take payment later under Hold.`, `已保存 ${record.id.slice(0, 8).toUpperCase()}，可稍后在挂单中补充资料或继续收款`)}
            </p>
          ) : form ? (
            <>
              <label className="block text-xs">
                {L("วันเวลาขายจริง", "Actual sale date/time", "实际销售时间")}
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
                      <p className="text-sm font-medium" translate="no">{line.name}</p>
                      <p className="text-xs text-muted">
                        <span translate="no">{line.sku}</span> · {line.qty} {L("ชิ้น", "pcs", "件")} · SN{" "}
                        {(line.serials ?? []).length}/{line.qty}
                      </p>
                    </div>
                    <label className="text-xs w-32">
                      {L("ราคาขายจริง/ชิ้น", "Actual price/unit", "实际单价")}
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
                  {L("ยอดขายจริง", "Actual total", "实际销售额")}{form.draft.discount_total > 0 ? <span className="text-muted"> · {L("ส่วนลด", "discount", "折扣")} {formatTHB(form.draft.discount_total)}</span> : null}
                </span>
                <strong>{formatTHB(total)}</strong>
              </div>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.delivered}
                  onChange={(e) => change({ delivered: e.target.checked })}
                />
                {L("ส่งมอบสินค้าให้ลูกค้าแล้ว", "Goods handed to customer", "已向客户交付商品")}
              </label>
              <label className="block text-xs">
                {L("เหตุผลที่ต้องขายก่อน / ข้อมูลที่ยังขาด", "Reason / missing information", "先售原因 / 缺少的资料")}
                <textarea
                  ref={reasonRef}
                  aria-invalid={reasonErr}
                  rows={3}
                  value={form.reason}
                  onChange={(e) => change({ reason: e.target.value })}
                  className={`mt-1 w-full rounded-xl border bg-surface2 p-2 text-xs ${reasonErr ? "border-danger ring-2 ring-danger/20" : "border-line"}`}
                  placeholder={L("เช่น ลูกค้ารับสินค้าแล้ว แต่ SN ยังไม่เข้าระบบ / รอยืนยันราคา", "e.g. customer took the goods but SN not in system / price pending", "例如：客户已取货但 SN 未入系统 / 待确认价格")}
                />
                {reasonErr ? <span role="alert" className="block mt-1 text-[12px] font-medium text-danger">{L("กรุณากรอกเหตุผลก่อน แล้วกด “บันทึก / รับชำระ” อีกครั้ง", "Please enter a reason, then press “Save / Take payment” again", "请先填写原因，然后再次点击“保存 / 收款”")}</span>
                  : <span className="block mt-1 text-[11px] text-muted">{L("* จำเป็นต้องกรอกก่อนรับชำระ", "* Required before taking payment", "* 收款前必填")}</span>}
              </label>
              <p className="text-xs text-muted">
                {L("กันจำนวนในสาขาที่มีรายการสต๊อกไว้ระหว่างรอปิดบิล การปิดบิลภายหลังต้องผ่านการตรวจสต๊อกและ SN จริง ราคาต่างจากราคากลางต้องให้หัวหน้าที่มีสิทธิ์ตรวจ ไม่รองรับใช้แต้ม คูปอง หรือของแถมในโหมดนี้", "Stock is reserved at the branch while pending. Closing later requires real stock and SN checks. Prices differing from list must be reviewed by an authorised supervisor. Points, coupons and gifts are not supported in this mode.", "待结单期间将预留门店库存。之后结单需核对实际库存和 SN。与标准价不同的价格需由有权限的主管审核。此模式不支持积分、优惠券或赠品。")}
              </p>
            </>
          ) : null}
        </div>
      </Modal>
      <PaymentModal
        open={open && pay && !!record}
        title={L("บันทึกเงินรับ · รายการรอปิดบิล", "Record payment · pending bill", "记录收款 · 待结单")}
        confirmLabel={L("เก็บไว้ในรายการรอปิดบิล", "Keep in pending bills", "保存到待结单")}
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
          if (!d || !session.branchId) throw Error(L("ไม่พบรายการ", "Item not found", "未找到项目"));
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
