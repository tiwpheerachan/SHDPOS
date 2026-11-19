"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, CheckCircle2, QrCode, CreditCard } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useI18n } from "@/lib/i18n/provider";
import { subscribeDisplay, EMPTY_DISPLAY, type DisplayPayload } from "@/lib/customer-display";
import { formatTHB } from "@/lib/money";

/**
 * จอฝั่งลูกค้า — เปิดเป็นหน้าต่างที่สองแล้วลากไปจอที่ลูกค้าเห็น
 * ซิงก์กับหน้าขายผ่าน BroadcastChannel (ทำงานแม้ออฟไลน์)
 */
export default function CustomerDisplayPage() {
  const { t } = useI18n();
  const [data, setData] = useState<DisplayPayload>(EMPTY_DISPLAY);

  useEffect(() => subscribeDisplay(setData), []);

  const Row = ({ label, value, tone }: { label: string; value: string; tone?: "danger" | "muted" }) => (
    <div className="flex justify-between text-base">
      <span className="text-muted">{label}</span>
      <span className={`tnum ${tone === "danger" ? "text-danger" : ""}`}>{value}</span>
    </div>
  );

  return (
    <div className="customer-display min-h-screen bg-bg flex flex-col">
      <header className="px-8 py-5 border-b border-line flex items-center gap-4">
        {data.brandLogo ? (
          <img src={data.brandLogo} alt={data.brandName ?? ""} className="h-11 max-w-[160px] object-contain" />
        ) : (
          <div className="h-11 px-3 grid place-items-center rounded-xl bg-surface2 text-lg font-bold text-ink">{data.brandName ?? "SHD"}</div>
        )}
        <div>
          {data.brandName ? <p className="text-lg font-semibold">{data.brandName}</p> : null}
          <p className="text-xs text-muted">{data.branchName ?? ""}</p>
        </div>
      </header>

      {data.state === "idle" ? (
        <div className="flex-1 grid place-items-center text-center px-8">
          <div>
            <ShoppingBag size={64} className="mx-auto text-brand/30 mb-6" />
            <h1 className="text-4xl font-semibold">{t.display.welcome}</h1>
            <p className="text-muted mt-3">ยินดีให้บริการ · Welcome · 欢迎光临</p>
          </div>
        </div>
      ) : data.state === "done" ? (
        <div className="flex-1 grid place-items-center text-center px-8">
          <div>
            <CheckCircle2 size={72} className="mx-auto text-ok mb-6" />
            <h1 className="text-4xl font-semibold">{t.display.thankYou}</h1>
            <p className="text-2xl tnum mt-4">{formatTHB(data.grandTotal)}</p>
            {data.change ? (
              <p className="text-xl text-muted mt-2">
                {t.pos.change} <span className="tnum font-semibold text-brand">{formatTHB(data.change)}</span>
              </p>
            ) : null}
            {data.orderNo ? <p className="text-xs font-mono text-muted mt-5">{data.orderNo}</p> : null}
          </div>
        </div>
      ) : (
        <div className="flex-1 grid lg:grid-cols-[1fr_420px] min-h-0">
          {/* ซ้าย: รายการสินค้า */}
          <div className="overflow-y-auto px-8 py-6">
            <h2 className="text-sm font-medium text-muted mb-4">{t.display.yourOrder}</h2>
            <ul className="divide-y divide-line">
              {data.lines.map((l) => (
                <li key={l.lineId} className="py-3.5 flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div className="w-14 h-14 rounded-xl border border-line bg-surface2 grid place-items-center overflow-hidden">
                      {l.image_url ? <img src={l.image_url} alt="" className="w-full h-full object-cover" /> : <ShoppingBag size={20} className="text-muted/40" />}
                    </div>
                    <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-brand text-white grid place-items-center text-xs font-bold tnum">{l.qty}</span>
                  </div>
                  <span className="flex-1 text-base">{l.name}{l.is_gift ? <span className="ml-2 text-xs text-brand font-medium">· ของแถม</span> : null}</span>
                  <span className="tnum text-base font-medium">{formatTHB(l.qty * l.unit_price, false)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ขวา: ชำระเงิน + สรุป */}
          <div className="bg-surface border-l border-line px-8 py-6 flex flex-col">
            {/* ระหว่างชำระเงิน: QR พร้อมเพย์ หรือ วิธีจ่าย */}
            {data.state === "payment" && data.payQr ? (
              <div className="text-center mb-5">
                <p className="text-sm font-semibold inline-flex items-center gap-1.5 mb-3"><QrCode size={16} /> สแกนเพื่อจ่าย · พร้อมเพย์</p>
                <div className="inline-block bg-white p-4 rounded-2xl border border-line shadow-card">
                  <QRCodeSVG value={data.payQr} size={224} level="M" marginSize={0} />
                </div>
                <p className="text-3xl font-bold tnum mt-3">{formatTHB(data.amountDue ?? data.grandTotal)}</p>
                <p className="text-xs text-muted mt-1">สแกนด้วยแอปธนาคาร · ตัวอย่างจำลอง</p>
              </div>
            ) : data.state === "payment" && data.payMethodLabel ? (
              <div className="text-center mb-5 rounded-2xl border border-line bg-surface2 py-6 px-4">
                <CreditCard size={34} className="mx-auto text-brand mb-2" />
                <p className="text-sm text-muted">กำลังรับชำระด้วย</p>
                <p className="text-2xl font-bold mt-1">{data.payMethodLabel}</p>
                <p className="text-3xl font-bold tnum mt-3">{formatTHB(data.amountDue ?? data.grandTotal)}</p>
              </div>
            ) : null}

            {/* สรุปการคิดเงิน (แสดงเสมอ ทั้งตอนตะกร้าและชำระเงิน) */}
            <div className="mt-auto space-y-2.5">
              <Row label={t.pos.subtotal} value={formatTHB(data.subtotal)} />
              {data.discount > 0 ? <Row label={t.pos.discount} value={`-${formatTHB(data.discount)}`} tone="danger" /> : null}
              {(data.coupon ?? 0) > 0 ? <Row label="คูปอง / แคมเปญ" value={`-${formatTHB(data.coupon!)}`} tone="danger" /> : null}
              {(data.redeem ?? 0) > 0 ? <Row label="แลกแต้มสะสม" value={`-${formatTHB(data.redeem!)}`} tone="danger" /> : null}
              {(data.vat ?? 0) > 0 ? <div className="flex justify-between text-sm text-muted"><span>VAT 7% (รวมในยอด)</span><span className="tnum">{formatTHB(data.vat!)}</span></div> : null}
              <div className="border-t border-line pt-4">
                <p className="text-sm text-muted">{t.pos.grandTotal}</p>
                <p className="text-5xl font-semibold tnum mt-1">{formatTHB(data.grandTotal)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
