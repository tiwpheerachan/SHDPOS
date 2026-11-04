"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, CheckCircle2 } from "lucide-react";
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

  return (
    <div className="customer-display min-h-screen bg-bg flex flex-col">
      <header className="px-8 py-5 border-b border-line flex items-center gap-4">
        <img src="/logo.png" alt="SHD POS" className="w-11 h-11 object-contain" />
        <div>
          <p className="text-lg font-semibold">SHD Technology</p>
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
        <div className="flex-1 grid lg:grid-cols-[1fr_380px] min-h-0">
          <div className="overflow-y-auto px-8 py-6">
            <h2 className="text-sm font-medium text-muted mb-4">{t.display.yourOrder}</h2>
            <ul className="divide-y divide-line">
              {data.lines.map((l) => (
                <li key={l.lineId} className="py-3.5 flex items-center gap-4">
                  <span className="w-9 h-9 rounded-lg bg-surface2 grid place-items-center text-sm font-semibold tnum shrink-0">
                    {l.qty}
                  </span>
                  <span className="flex-1 text-base">{l.name}</span>
                  <span className="tnum text-base font-medium">{formatTHB(l.qty * l.unit_price, false)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-surface border-l border-line px-8 py-6 flex flex-col justify-end">
            <div className="space-y-2.5">
              <div className="flex justify-between text-base">
                <span className="text-muted">{t.pos.subtotal}</span>
                <span className="tnum">{formatTHB(data.subtotal)}</span>
              </div>
              {data.discount > 0 ? (
                <div className="flex justify-between text-base">
                  <span className="text-muted">{t.pos.discount}</span>
                  <span className="tnum text-danger">-{formatTHB(data.discount)}</span>
                </div>
              ) : null}
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
