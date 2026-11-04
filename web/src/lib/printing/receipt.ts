// =====================================================================
// สร้างสลิป (ใบกำกับภาษีอย่างย่อ) จากบิลขาย
// =====================================================================

import { EscPosBuilder, fit } from "./escpos";
import { formatTHB } from "../money";
import type { Branch, Employee, Order } from "../types";

export interface ReceiptContext {
  order: Order;
  branch?: Branch;
  cashier?: Employee;
  salesperson?: Employee;
  company: {
    name_th: string;
    tax_id: string;
    address?: string;
    phone?: string;
  };
  width?: number;
  copyLabel?: string;
  /** ข้อความประกาศท้ายสลิป */
  footerNote?: string;
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: "เงินสด",
  credit_card: "บัตรเครดิต",
  debit_card: "บัตรเดบิต",
  qr_promptpay: "QR พร้อมเพย์",
  bank_transfer: "โอนเงิน",
  edc: "EDC",
  gift_card: "บัตรของขวัญ",
  store_credit: "เครดิตร้าน",
  installment: "ผ่อนชำระ",
  online_marketplace: "มาร์เก็ตเพลส",
  other: "อื่นๆ",
};

export function buildReceipt(ctx: ReceiptContext): EscPosBuilder {
  const w = ctx.width ?? 48;
  const b = new EscPosBuilder(w);
  const o = ctx.order;
  const dt = new Date(o.created_at);

  b.align("center").bold(true).double(true);
  b.line(fit(ctx.company.name_th, Math.floor(w / 2)));
  b.double(false).bold(false);
  if (ctx.branch) b.line(fit(ctx.branch.name_th || ctx.branch.name, w));
  if (ctx.company.address) b.line(fit(ctx.company.address, w));
  b.line(`เลขประจำตัวผู้เสียภาษี ${ctx.company.tax_id}`);
  if (ctx.branch?.tax_branch_no) b.line(`สาขาที่ ${ctx.branch.tax_branch_no}`);
  if (ctx.company.phone) b.line(`โทร. ${ctx.company.phone}`);
  b.line();
  b.bold(true).line("ใบกำกับภาษีอย่างย่อ / ABB TAX INVOICE").bold(false);
  if (ctx.copyLabel) b.line(`*** ${ctx.copyLabel} ***`);
  b.divider("=");

  b.align("left");
  b.row(`เลขที่ ${o.order_no}`, dt.toLocaleDateString("th-TH"));
  b.row(
    `แคชเชียร์ ${ctx.cashier?.nickname ?? ctx.cashier?.first_name ?? "-"}`,
    dt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  );
  if (ctx.salesperson) b.line(`พนักงานขาย ${ctx.salesperson.nickname ?? ctx.salesperson.first_name}`);
  if (o.customer_name) b.line(`ลูกค้า ${fit(o.customer_name, w - 7)}`);
  b.divider();

  for (const it of o.items) {
    b.line(fit(it.name, w));
    const qtyPart = `  ${it.qty} x ${formatTHB(it.unit_price, false)}`;
    b.row(qtyPart, formatTHB(it.line_total, false));
    if (it.discount_amount > 0) b.row("  ส่วนลด", `-${formatTHB(it.discount_amount, false)}`);
    for (const sn of it.serials) b.line(`  SN: ${sn}`);
  }

  b.divider();
  b.row("รวมก่อนส่วนลด", formatTHB(o.subtotal, false));
  if (o.discount_total > 0) b.row("ส่วนลดรวม", `-${formatTHB(o.discount_total, false)}`);
  b.bold(true).double(true);
  b.row("สุทธิ", formatTHB(o.grand_total, false));
  b.double(false).bold(false);

  const base = o.grand_total - o.vat_amount;
  b.row("มูลค่าก่อน VAT", formatTHB(base, false));
  b.row("ภาษีมูลค่าเพิ่ม 7%", formatTHB(o.vat_amount, false));
  b.divider();

  for (const p of o.payments) {
    const label = PAYMENT_LABEL[p.method] ?? p.method;
    const extra = p.card_last4 ? ` ****${p.card_last4}` : "";
    b.row(`${label}${extra}`, formatTHB(p.amount, false));
    if (p.approval_code) b.line(`  เลขอนุมัติ ${p.approval_code}`);
    if (p.installment_months) b.line(`  ผ่อน ${p.installment_months} งวด`);
  }
  if (o.change_amount > 0) b.row("เงินทอน", formatTHB(o.change_amount, false));

  b.divider("=");
  b.align("center");
  b.line(ctx.footerNote ?? "ขอบคุณที่ใช้บริการ");
  b.line("กรุณาเก็บใบเสร็จไว้เป็นหลักฐานการรับประกัน");
  b.line();
  b.qr(`https://pos.shd-technology.co.th/r/${o.order_no}`, 5);
  b.line(o.order_no);
  if (o.is_offline_origin) b.line("(บันทึกขณะออฟไลน์)");
  b.feed(3).cut();

  return b;
}
