"use client";

// =====================================================================
// ReceiptPreview — ตัวอย่างบิลก่อนพิมพ์ (แผงลอยด้านขวา) พับ/ย่อได้
//   • ย่อเป็นแท็บเล็กมุมจอ กันเผลอปิด → กดกลับมาดูได้
//   • แสดงบิลเสมือน (80mm) พร้อมโลโก้แบรนด์ + พิมพ์จริง (ESC/POS) / พิมพ์เบราว์เซอร์
// =====================================================================
import { useEffect, useState } from "react";
import { Printer, Inbox, Receipt, X, ChevronDown, AlertTriangle, CheckCircle2, Loader2, FileText } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { Order, Branch, Employee } from "@/lib/types";
import { formatTHB } from "@/lib/money";
import type { PrintStatus } from "@/components/pos/sale-modals";

interface Company { name_th: string; tax_id: string; address?: string; phone?: string }

export function ReceiptPreview({
  order, branch, cashier, company, logoUrl, pointsEarned,
  printStatus, printError, onPrint, onBrowserPrint, onOpenDrawer, onNewSale, canOpenDrawer,
}: {
  order: Order | null;
  branch?: Branch;
  cashier?: Employee;
  company: Company;
  logoUrl?: string | null;
  pointsEarned?: number;
  printStatus: PrintStatus;
  printError?: string | null;
  onPrint: () => void;
  onBrowserPrint: () => void;
  onOpenDrawer: () => void;
  onNewSale: () => void;
  canOpenDrawer: boolean;
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [min, setMin] = useState(false);
  useEffect(() => { if (order) setMin(false); }, [order?.id]);
  if (!order) return null;

  // ย่อ → แท็บลอยมุมล่างขวา
  if (min) {
    return (
      <button onClick={() => setMin(false)}
        className="fixed bottom-4 right-4 z-40 h-12 px-4 rounded-2xl glass shadow-pop flex items-center gap-2 text-sm font-semibold text-ink animate-slideUp">
        <Receipt size={17} className="text-brand" />
        {L("ตัวอย่างบิล", "Receipt preview", "小票预览")} <span className="font-mono text-muted">{order.order_no}</span>
      </button>
    );
  }

  const dt = new Date(order.created_at);
  const dateStr = dt.toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setMin(true)} />
      <div className="relative w-full max-w-[400px] h-full bg-surface border-l border-line shadow-pop flex flex-col drawer-in">
        {/* หัวค้างบน */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-ok" />
            <span className="font-semibold text-sm">{L("ขายสำเร็จ · ตัวอย่างบิล", "Sale completed · Receipt preview", "交易完成 · 小票预览")}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setMin(true)} title={L("ย่อ (เก็บไว้ดูทีหลัง)", "Minimize (keep for later)", "最小化（稍后查看）")} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><ChevronDown size={17} /></button>
            <button onClick={onNewSale} title={L("ปิด / ขายใหม่", "Close / new sale", "关闭 / 新订单")} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><X size={17} /></button>
          </div>
        </div>

        {/* สถานะพิมพ์ */}
        {printStatus !== "idle" && (
          <div className="px-4 pt-2 shrink-0">
            {printStatus === "printing" && <p className="text-xs text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> {L("กำลังพิมพ์…", "Printing…", "打印中…")}</p>}
            {printStatus === "ok" && <p className="text-xs text-ok flex items-center gap-1.5"><Printer size={13} /> {L("พิมพ์แล้ว", "Printed", "已打印")}</p>}
            {printStatus === "failed" && (
              <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2">
                <p className="text-xs font-medium text-danger flex items-center gap-1.5"><AlertTriangle size={13} /> {L("พิมพ์ไม่สำเร็จ", "Print failed", "打印失败")}</p>
                {printError && <p className="text-[10px] text-muted mt-0.5 break-all">{printError}</p>}
              </div>
            )}
          </div>
        )}

        {/* บิลเสมือน (เลื่อนได้) */}
        <div className="flex-1 overflow-y-auto p-4 bg-surface2/50">
          <div id="shd-receipt" className="mx-auto w-full max-w-[320px] bg-white text-[#1d1d24] rounded-xl shadow-sm px-5 py-5 text-[12px] leading-relaxed">
            {/* โลโก้ + บริษัท */}
            <div className="text-center">
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-12 mx-auto object-contain mb-2" />
              ) : null}
              <div className="font-bold text-[13px]">{company.name_th}</div>
              {branch && <div>{branch.name_th || branch.name}</div>}
              {company.address && <div className="text-[11px] text-neutral-500">{company.address}</div>}
              <div className="text-[11px] text-neutral-500">{L("เลขภาษี", "Tax ID", "税号")} {company.tax_id}{branch?.tax_branch_no ? ` · ${L("สาขา", "Branch", "门店")} ${branch.tax_branch_no}` : ""}</div>
              {company.phone && <div className="text-[11px] text-neutral-500">{L("โทร.", "Tel.", "电话")} {company.phone}</div>}
            </div>

            <div className="border-t border-dashed border-neutral-300 my-2.5" />

            <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("เลขที่บิล", "Receipt No.", "单号")}</span><span className="font-mono font-semibold">{order.order_no}</span></div>
            <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("วันที่", "Date", "日期")}</span><span>{dateStr}</span></div>
            {cashier && <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("พนักงาน", "Cashier", "员工")}</span><span>{cashier.nickname ?? cashier.first_name}</span></div>}
            {order.customer_name && <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("ลูกค้า", "Customer", "客户")}</span><span>{order.customer_name}</span></div>}

            <div className="border-t border-dashed border-neutral-300 my-2.5" />

            {/* รายการ */}
            <div className="space-y-1.5">
              {order.items.map((it) => (
                <div key={it.id}>
                  <div className="flex justify-between gap-2">
                    <span className="flex-1">{it.name}{it.is_gift && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-neutral-900 text-white">{L("ของแถม", "Gift", "赠品")}</span>}</span>
                    <span className="tnum font-semibold shrink-0">{formatTHB(it.line_total, false)}</span>
                  </div>
                  <div className="text-[10px] text-neutral-400">{it.qty} × {formatTHB(it.unit_price, false)}{it.sku ? ` · ${it.sku}` : ""}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-neutral-300 my-2.5" />

            <div className="space-y-1">
              <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("รวมก่อนลด", "Subtotal", "折前合计")}</span><span className="tnum">{formatTHB(order.subtotal, false)}</span></div>
              {order.discount_total > 0 && <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("ส่วนลด", "Discount", "折扣")}</span><span className="tnum">-{formatTHB(order.discount_total, false)}</span></div>}
              <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("ภาษีมูลค่าเพิ่ม 7%", "VAT 7%", "增值税 7%")}</span><span className="tnum">{formatTHB(order.vat_amount, false)}</span></div>
              <div className="flex justify-between items-baseline pt-1 border-t border-neutral-200 mt-1">
                <span className="font-bold text-[13px]">{L("ยอดสุทธิ", "Grand total", "应付总额")}</span>
                <span className="tnum font-bold text-[16px]">{formatTHB(order.grand_total, false)}</span>
              </div>
            </div>

            <div className="border-t border-dashed border-neutral-300 my-2.5" />

            {order.payments.map((p, i) => (
              <div key={i} className="flex justify-between text-[11px]"><span className="text-neutral-500">{p.method}</span><span className="tnum">{formatTHB(p.amount, false)}</span></div>
            ))}
            <div className="flex justify-between text-[11px]"><span className="text-neutral-500">{L("รับเงิน", "Received", "收款")}</span><span className="tnum">{formatTHB(order.paid_total, false)}</span></div>
            {order.change_amount > 0 && <div className="flex justify-between text-[12px] font-semibold"><span>{L("เงินทอน", "Change", "找零")}</span><span className="tnum">{formatTHB(order.change_amount, false)}</span></div>}

            {!!pointsEarned && pointsEarned > 0 && (
              <div className="mt-2 text-center text-[11px] text-neutral-500">{L("ได้รับ", "Earned", "获得")} {pointsEarned} {L("แต้ม", "points", "积分")}</div>
            )}

            <div className="border-t border-dashed border-neutral-300 my-2.5" />
            <div className="text-center text-[11px] text-neutral-500">{L("ขอบคุณที่ใช้บริการ", "Thank you", "谢谢惠顾")} 🙏</div>
          </div>
        </div>

        {/* ปุ่มล่างค้าง */}
        <div className="shrink-0 border-t border-line p-3 grid grid-cols-2 gap-2">
          <button onClick={onPrint} className="h-11 rounded-xl bg-brand text-brandInk text-sm font-bold inline-flex items-center justify-center gap-1.5"><Printer size={16} /> {L("พิมพ์ใบเสร็จ", "Print receipt", "打印收据")}</button>
          <button onClick={onBrowserPrint} className="h-11 rounded-xl bg-surface2 text-ink text-sm font-semibold inline-flex items-center justify-center gap-1.5"><FileText size={16} /> {L("พิมพ์/PDF", "Print/PDF", "打印/PDF")}</button>
          <button onClick={onOpenDrawer} disabled={!canOpenDrawer} className="h-11 rounded-xl bg-surface2 text-ink text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Inbox size={16} /> {L("เปิดลิ้นชัก", "Open drawer", "打开钱箱")}</button>
          <button onClick={onNewSale} className="h-11 rounded-xl bg-ok text-white text-sm font-bold inline-flex items-center justify-center gap-1.5"><CheckCircle2 size={16} /> {L("ขายใหม่", "New sale", "新订单")}</button>
        </div>
      </div>
    </div>
  );
}
