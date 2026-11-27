"use client";
// ตารางยอดขายแบบชีท (แท็บ "รายการบิล" หน้ายอดขาย)
//   • 2 มุมมอง: ต่อบิล / ต่อรายการสินค้า (1 แถว = สินค้า 1 รายการ เหมือนชีทยอดขายสาขา)
//   • คอลัมน์ครบเท่าที่ระบบมี · เลือกแสดง/ซ่อน · จำค่าในเครื่อง
//   • ตัวกรองรายคอลัมน์แบบชีท (ข้อความ / เลือกค่า / ช่วงตัวเลข / ช่วงวันที่) + เรียงลำดับทุกคอลัมน์ + แถวยอดรวม
//   • กดทั้งแถว = เปิดที่มาของบิล (เหมือนเดิม) + ปุ่มเชื่อมโยงแยกท้ายแถว (เปิดบิล / คัดลอกลิงก์บิล)
//   • ส่งออก Excel ตามคอลัมน์/ตัวกรองที่เห็น
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, ArrowUp, ArrowDown, Columns3, X, Search, FileDown, ExternalLink, Link2, Check, Rows3, ReceiptText, RotateCcw } from "lucide-react";
import type { Branch, Brand, Employee, Order, OrderItem, Product } from "@/lib/types";
import { formatTHB, formatInt } from "@/lib/money";
import { saleAt, isCountedSale } from "@/lib/sales-basis";
import { OrderTraceDrawer } from "@/components/order-trace";
import { OwSaleBadge } from "@/components/pos/ow-sale-badge";
import { useSession } from "@/lib/store/session";
import { can } from "@/lib/permissions";
import { Segmented, Drawer } from "@/components/ui";
import { tr } from "@/lib/i18n/tr";
import { useI18n } from "@/lib/i18n/provider";
import { downloadExcel } from "@/lib/export";
import { TagChip, PersonChip } from "@/components/admin/sheet-tags";
import { useSalesFields, fieldText, fieldIcon, FieldCell, FieldEditor, type SalesField } from "@/components/admin/sales-custom-fields";
import { Plus, Pencil, Pin, PinOff } from "lucide-react";
import { SheetViewTabs, type SheetViewState } from "@/components/admin/sheet-view-tabs";
export { TagChip, PersonChip };

type Mode = "bill" | "line";
type Kind = "text" | "enum" | "num" | "money" | "date";
type Row = { o: Order; it?: OrderItem; key: string };
type Col = { id: string; label: () => string; kind: Kind; get: (r: Row) => string | number | null; show?: (r: Row) => React.ReactNode; sum?: boolean; def?: boolean; noTr?: boolean; w?: string;
  /** คอลัมน์ที่ผู้ใช้เพิ่มเอง (แก้ค่าในช่องได้) */ custom?: SalesField; /** หน้าตาค่าในรายการตัวกรอง (ป้ายสีเดียวกับในตาราง) */ chip?: (v: string) => React.ReactNode };
type ColFilter = { text?: string; values?: string[]; min?: number | null; max?: number | null; from?: string; to?: string };

const PAY = (): Record<string, string> => ({ cash: tr("เงินสด", "Cash", "现金"), credit_card: tr("บัตรเครดิต", "Credit card", "信用卡"), debit_card: tr("บัตรเดบิต", "Debit card", "借记卡"), qr_promptpay: tr("พร้อมเพย์", "PromptPay", "PromptPay"), bank_transfer: tr("โอนเงิน", "Bank transfer", "银行转账"), edc: "EDC", installment: tr("ผ่อนชำระ", "Installment", "分期付款"), gift_card: tr("บัตรของขวัญ", "Gift card", "礼品卡"), store_credit: tr("เครดิตร้าน", "Store credit", "店铺余额"), online_marketplace: tr("มาร์เก็ตเพลส", "Marketplace", "电商平台"), online_payment: tr("ชำระออนไลน์", "Online payment", "线上支付"), unspecified: tr("ไม่ระบุ", "Not specified", "未注明"), other: tr("อื่น ๆ", "Other", "其他") });
const STATUS = (): Record<string, string> => ({ completed: tr("ขายแล้ว", "Sold", "已售"), partially_refunded: tr("คืนบางส่วน", "Partly refunded", "部分退款"), refunded: tr("คืนครบ", "Refunded", "全额退款"), voided: tr("ยกเลิก", "Voided", "已作废") });
const STATUS_CLS: Record<string, string> = { completed: "bg-ok/12 text-ok", partially_refunded: "bg-warn/15 text-warn", refunded: "bg-warn/15 text-warn", voided: "bg-danger/10 text-danger" };
const CHANNEL = (): Record<string, string> => ({ offline: tr("หน้าร้าน", "In-store", "门店"), online: tr("ออนไลน์", "Online", "线上"), line: "LINE", facebook: "Facebook", marketplace: tr("มาร์เก็ตเพลส", "Marketplace", "电商平台"), event: tr("อีเวนต์", "Event", "活动") });
const baht = (n: number) => formatTHB(n, false);
// เวลาไทย (UTC+7) แบบคำนวณตรง — เร็วกว่า toLocaleString มาก (ตารางกรอง/เรียงหลายหมื่นแถว)
const bkkIso = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString();
const ymd = (iso: string) => bkkIso(iso).slice(0, 10);
const hm = (iso: string) => bkkIso(iso).slice(11, 16);
const maskPhone = (p?: string | null) => (p ? p.replace(/\D/g, "").replace(/^(\d{3})\d+(\d{4})$/, "$1-xxx-$2") : "");
const LS = "shdpos.salesSheet.v1";

export function SalesSheet({ orders, branches, brands, employees, products, catName, showCost, owStatus, onExportCsv, pageState, applyPageState }: {
  orders: Order[]; branches: Branch[]; brands: Brand[]; employees: Employee[]; products: Product[]; catName: Map<string, string>;
  showCost: boolean; owStatus: Record<string, { ow_status?: string } | undefined>; onExportCsv?: () => void;
  /** ตัวกรองระดับหน้า (ช่วงวันที่/สาขา/แบรนด์/แหล่งข้อมูล) ให้มุมมองบันทึกรวมไปด้วย */
  pageState?: () => SheetViewState; applyPageState?: (s: SheetViewState | null) => void;
}) {
  const { locale } = useI18n(); // ภาษาเปลี่ยน → คำนวณป้ายใหม่
  const { employee } = useSession();
  const canTrace = !employee || can(employee, "sales.trace");
  const cf = useSalesFields();
  const [fieldEdit, setFieldEdit] = useState<{ rect: DOMRect; field?: SalesField } | null>(null);

  // ── ค่าที่จำในเครื่อง ──
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(LS) ?? "{}") as { mode?: Mode; hidden?: Record<Mode, string[]>; per?: number; frozen?: number }; } catch { return {}; } }, []);
  const [mode, setMode] = useState<Mode>(saved.mode ?? "bill");
  const [hidden, setHidden] = useState<Record<Mode, string[]>>(saved.hidden ?? { bill: [], line: [] });
  const [per, setPer] = useState<number>(saved.per ?? 50);
  // ตรึงคอลัมน์ซ้าย N คอลัมน์ (ไม่เลื่อนตามแนวนอน) — ค่าส่วนตัวของแต่ละคน
  const [frozen, setFrozen] = useState<number>(saved.frozen ?? 1);
  const viewActive = useRef(false);
  // ค่าส่วนตัว (ตอนอยู่ "ตารางหลัก") จำในเครื่อง — ตอนเปิดมุมมองอยู่ไม่ทับค่าส่วนตัว
  useEffect(() => { if (viewActive.current) return; try { localStorage.setItem(LS, JSON.stringify({ mode, hidden, per, frozen })); } catch { /* */ } }, [mode, hidden, per, frozen]);
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: "date", dir: -1 });
  const [page, setPage] = useState(0);
  const [openBill, setOpenBill] = useState<Order | null>(null);
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const skipModeReset = useRef(false);
  useEffect(() => { if (skipModeReset.current) { skipModeReset.current = false; return; } setFilters({}); setPage(0); setSort({ id: "date", dir: -1 }); }, [mode]);

  // ── มุมมอง (แท็บ) ──
  const captureView = (): SheetViewState => ({ mode, filters, sort, hidden: hidden[mode], frozen, page: pageState?.() ?? null });
  const applyView = (st: SheetViewState | null) => {
    setPage(0);
    if (!st) { // ตารางหลัก = ค่าส่วนตัว + ไม่มีตัวกรอง
      viewActive.current = false;
      setFilters({}); setSort({ id: "date", dir: -1 });
      try { const mine = JSON.parse(localStorage.getItem(LS) ?? "{}"); if (mine.hidden) setHidden(mine.hidden); setFrozen(mine.frozen ?? 1); } catch { /* */ }
      applyPageState?.(null);
      return;
    }
    viewActive.current = true;
    const m = (st.mode === "line" ? "line" : "bill") as Mode;
    if (m !== mode) { skipModeReset.current = true; setMode(m); }
    setFilters((st.filters as Record<string, ColFilter>) ?? {});
    setSort((st.sort as { id: string; dir: 1 | -1 }) ?? { id: "date", dir: -1 });
    if (Array.isArray(st.hidden)) setHidden((h) => ({ ...h, [m]: st.hidden as string[] }));
    if (typeof st.frozen === "number") setFrozen(st.frozen);
    if (st.page) applyPageState?.(st.page as SheetViewState);
  };

  // ── ข้อมูลอ้างอิง ──
  const ref = useMemo(() => {
    const br = new Map(branches.map((b) => [b.id, b])), bn = new Map(brands.map((b) => [b.id, b.name])), em = new Map(employees.map((e) => [e.id, e])), pr = new Map(products.map((p) => [p.id, p]));
    const name = (id?: string | null) => { const e = id ? em.get(id) : undefined; return e ? e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ") : ""; };
    // รูปโปรไฟล์ (จาก SSO/Lark) ตามชื่อที่แสดง — ใช้ทั้งในช่องและรายการตัวกรอง
    const photoByName = new Map<string, string>();
    for (const e of employees) { const n = name(e.id); if (n && e.photo_url) photoByName.set(n, e.photo_url); }
    return { br, bn, pr, name, photoByName };
  }, [branches, brands, employees, products]);

  // ── คอลัมน์ ──
  const cols = useMemo<Col[]>(() => {
    const B = (r: Row) => ref.br.get(r.o.branch_id);
    const goods = (o: Order) => o.items.filter((i) => !i.is_gift);
    const pay = (o: Order) => [...new Set(o.payments.map((p) => PAY()[p.method] ?? p.method))].join(" + ");
    const common: Col[] = [
      { id: "date", label: () => tr("วันที่", "Date", "日期"), kind: "date", get: (r) => ymd(saleAt(r.o)), def: true, w: "92px" },
      // ระบบเดิม (Lark) ไม่มีเวลาขาย/ต้นทุน → แสดง —
      { id: "time", label: () => tr("เวลา", "Time", "时间"), kind: "text", get: (r) => (r.o.source === "lark" ? "—" : hm(saleAt(r.o))), def: true, w: "56px" },
      { id: "order_no", label: () => tr("เลขบิล", "Bill no.", "单号"), kind: "text", get: (r) => r.o.order_no, def: true, noTr: true, show: (r) => <span className="inline-flex items-center gap-1.5"><SourceTag source={r.o.source === "lark" ? "lark" : "pos"} /><span className="font-mono">{r.o.order_no}</span></span> },
      { id: "source", label: () => tr("แหล่งข้อมูล", "Source", "数据来源"), kind: "enum", get: (r) => (r.o.source === "lark" ? "Lark" : "POS"), def: false, noTr: true },
      { id: "branch", label: () => tr("สาขา", "Branch", "门店"), kind: "enum", get: (r) => { const b = B(r); return b ? b.name_th ?? b.name : "—"; }, def: true },
      { id: "branch_code", label: () => tr("รหัสสาขา", "Branch code", "门店代码"), kind: "enum", get: (r) => B(r)?.code ?? "", noTr: true },
      { id: "branch_brand", label: () => tr("แบรนด์สาขา", "Branch brand", "门店品牌"), kind: "enum", get: (r) => { const b = B(r); return b?.brand_id ? ref.bn.get(b.brand_id) ?? "" : ""; }, def: true },
      { id: "province", label: () => tr("จังหวัด", "Province", "省份"), kind: "enum", get: (r) => B(r)?.province ?? "" },
      { id: "store_type", label: () => tr("ประเภทร้าน", "Store type", "门店类型"), kind: "enum", get: (r) => B(r)?.branch_type ?? "" },
      { id: "channel", label: () => tr("ช่องทาง", "Channel", "渠道"), kind: "enum", get: (r) => CHANNEL()[r.o.channel] ?? r.o.channel },
      { id: "sales", label: () => tr("พนักงานขาย", "Salesperson", "销售员"), kind: "enum", get: (r) => ref.name(r.it?.salesperson_id ?? r.o.salesperson_id ?? r.o.cashier_id), def: true,
        show: (r) => { const n = ref.name(r.it?.salesperson_id ?? r.o.salesperson_id ?? r.o.cashier_id); return n ? <PersonChip name={n} photo={ref.photoByName.get(n)} /> : undefined; }, chip: (v) => <PersonChip name={v} photo={ref.photoByName.get(v)} /> },
      { id: "cashier", label: () => tr("แคชเชียร์", "Cashier", "收银员"), kind: "enum", get: (r) => ref.name(r.o.cashier_id),
        show: (r) => { const n = ref.name(r.o.cashier_id); return n ? <PersonChip name={n} photo={ref.photoByName.get(n)} /> : undefined; }, chip: (v) => <PersonChip name={v} photo={ref.photoByName.get(v)} /> },
      { id: "customer", label: () => tr("ลูกค้า", "Customer", "顾客"), kind: "text", get: (r) => r.o.customer_name ?? tr("ทั่วไป", "Walk-in", "散客"), def: true, noTr: true },
      { id: "phone", label: () => tr("เบอร์ลูกค้า", "Customer phone", "顾客电话"), kind: "text", get: (r) => maskPhone(r.o.customer_phone), noTr: true },
      { id: "member", label: () => tr("สมาชิก", "Member", "会员"), kind: "enum", get: (r) => (r.o.customer_id ? tr("สมาชิก", "Member", "会员") : tr("ทั่วไป", "Walk-in", "散客")) },
    ];
    const billCols: Col[] = [
      { id: "products", label: () => tr("สินค้า", "Products", "商品"), kind: "text", get: (r) => goods(r.o).map((i) => `${i.name} ×${i.qty}`).join(", "), def: true, noTr: true,
        show: (r) => { const g = goods(r.o); return <span title={g.map((i) => `${i.sku} ×${i.qty}`).join(", ")}>{g[0]?.name ?? "—"}{g.length > 1 ? <span className="text-muted"> +{g.length - 1}</span> : null}</span>; } },
      { id: "skus", label: () => "SKU", kind: "text", get: (r) => goods(r.o).map((i) => i.sku).join(", "), noTr: true },
      { id: "lines", label: () => tr("รายการ", "Lines", "行数"), kind: "num", get: (r) => goods(r.o).length, sum: true },
      { id: "units", label: () => tr("ชิ้น", "Units", "件数"), kind: "num", get: (r) => goods(r.o).reduce((s, i) => s + i.qty, 0), sum: true, def: true },
      { id: "gifts", label: () => tr("ของแถม", "Gifts", "赠品"), kind: "num", get: (r) => r.o.items.filter((i) => i.is_gift).reduce((s, i) => s + i.qty, 0), sum: true },
      { id: "subtotal", label: () => tr("ยอดก่อนส่วนลด", "Subtotal", "折前金额"), kind: "money", get: (r) => r.o.subtotal, sum: true },
      { id: "discount", label: () => tr("ส่วนลด", "Discount", "折扣"), kind: "money", get: (r) => r.o.discount_total, sum: true, def: true },
      { id: "vat", label: () => "VAT", kind: "money", get: (r) => r.o.vat_amount, sum: true },
      { id: "total", label: () => tr("ยอดสุทธิ", "Net total", "净额"), kind: "money", get: (r) => r.o.grand_total, sum: true, def: true },
      { id: "payment", label: () => tr("วิธีชำระ", "Payment", "付款方式"), kind: "enum", get: (r) => pay(r.o), def: true },
      { id: "pay_ref", label: () => tr("เลขอ้างอิงชำระ", "Payment ref.", "付款参考号"), kind: "text", get: (r) => r.o.payments.map((p) => [p.card_brand, p.card_last4 && `•${p.card_last4}`, p.approval_code, p.reference_no].filter(Boolean).join(" ")).filter(Boolean).join(" | "), noTr: true },
      { id: "sn", label: () => "SN", kind: "text", get: (r) => goods(r.o).flatMap((i) => i.serials ?? []).join(", "), noTr: true },
      { id: "status", label: () => tr("สถานะ", "Status", "状态"), kind: "enum", get: (r) => STATUS()[r.o.status] ?? r.o.status, def: true,
        show: (r) => <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10.5px] font-medium ${STATUS_CLS[r.o.status] ?? "bg-surface2 text-muted"}`}>{STATUS()[r.o.status] ?? r.o.status}</span> },
      { id: "jst", label: () => "JST", kind: "enum", get: (r) => (r.o.client_uuid ? owStatus[r.o.client_uuid]?.ow_status ?? "" : ""), def: true,
        show: (r) => <OwSaleBadge status={(r.o.client_uuid ? owStatus[r.o.client_uuid] : null) as never} /> },
      ...(showCost ? [
        { id: "cost", label: () => tr("ต้นทุน", "Cost", "成本"), kind: "money" as Kind, get: (r: Row) => r.o.cost_total, sum: true, show: (r: Row) => (r.o.source === "lark" ? <span className="text-muted">—</span> : undefined) },
        { id: "gp", label: () => tr("กำไรขั้นต้น", "Gross profit", "毛利"), kind: "money" as Kind, get: (r: Row) => r.o.gross_profit, sum: true, def: true, show: (r: Row) => (r.o.source === "lark" ? <span className="text-muted">—</span> : undefined) },
        { id: "gp_pct", label: () => "%GP", kind: "num" as Kind, get: (r: Row) => (r.o.grand_total ? Math.round((r.o.gross_profit / r.o.grand_total) * 1000) / 10 : 0), show: (r: Row) => (r.o.source === "lark" ? <span className="text-muted">—</span> : undefined) },
      ] : []),
      { id: "void_reason", label: () => tr("เหตุผลยกเลิก", "Void reason", "作废原因"), kind: "text", get: (r) => r.o.void_reason ?? "", noTr: true },
    ];
    const lineCols: Col[] = [
      { id: "sku", label: () => "SKU", kind: "text", get: (r) => r.it!.sku, def: true, noTr: true, show: (r) => <span className="font-mono">{r.it!.sku}</span> },
      { id: "product", label: () => tr("สินค้า", "Product", "商品"), kind: "text", get: (r) => r.it!.name, def: true, noTr: true },
      { id: "category", label: () => tr("หมวดสินค้า", "Category", "商品类别"), kind: "enum", get: (r) => { const p = r.it!.product_id ? ref.pr.get(r.it!.product_id) : undefined; return p?.category_id ? catName.get(p.category_id) ?? "" : ""; } },
      { id: "p_brand", label: () => tr("แบรนด์สินค้า", "Product brand", "商品品牌"), kind: "enum", get: (r) => { const p = r.it!.product_id ? ref.pr.get(r.it!.product_id) : undefined; const id = r.it!.brand_id ?? p?.brand_id; return id ? ref.bn.get(id) ?? "" : ""; }, def: true },
      { id: "kind", label: () => tr("ประเภท", "Type", "类型"), kind: "enum", get: (r) => (r.it!.is_gift ? tr("ของแถม", "Gift", "赠品") : r.it!.kind === "service" ? tr("บริการ", "Service", "服务") : tr("สินค้า", "Goods", "商品")) },
      { id: "qty", label: () => tr("จำนวน", "Qty", "数量"), kind: "num", get: (r) => r.it!.qty, sum: true, def: true },
      { id: "price", label: () => tr("ราคา/หน่วย", "Unit price", "单价"), kind: "money", get: (r) => r.it!.unit_price, def: true },
      { id: "l_discount", label: () => tr("ส่วนลด", "Discount", "折扣"), kind: "money", get: (r) => r.it!.discount_amount, sum: true, def: true },
      { id: "l_total", label: () => tr("ยอดสุทธิ", "Net", "净额"), kind: "money", get: (r) => r.it!.line_total, sum: true, def: true },
      { id: "l_sn", label: () => "SN", kind: "text", get: (r) => (r.it!.serials ?? []).join(", "), def: true, noTr: true },
      { id: "returned", label: () => tr("คืนแล้ว", "Returned", "已退"), kind: "num", get: (r) => r.it!.returned_qty ?? 0, sum: true },
      { id: "payment", label: () => tr("วิธีชำระ (บิล)", "Payment (bill)", "付款方式（单据）"), kind: "enum", get: (r) => pay(r.o) },
      { id: "status", label: () => tr("สถานะบิล", "Bill status", "单据状态"), kind: "enum", get: (r) => STATUS()[r.o.status] ?? r.o.status, def: true,
        show: (r) => <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10.5px] font-medium ${STATUS_CLS[r.o.status] ?? "bg-surface2 text-muted"}`}>{STATUS()[r.o.status] ?? r.o.status}</span> },
      ...(showCost ? [
        { id: "l_cost", label: () => tr("ต้นทุน", "Cost", "成本"), kind: "money" as Kind, get: (r: Row) => r.it!.cost_total, sum: true },
        { id: "l_gp", label: () => tr("กำไรขั้นต้น", "Gross profit", "毛利"), kind: "money" as Kind, get: (r: Row) => r.it!.gross_profit, sum: true, def: true },
      ] : []),
    ];
    const base = mode === "bill" ? [...common, ...billCols] : [...common, ...lineCols];
    // ป้ายสีในรายการตัวกรอง = หน้าตาเดียวกับในตาราง
    for (const c of base) if (c.kind === "enum" && !c.show && !c.chip) c.chip = (v) => <TagChip value={v} />;
    // คอลัมน์ที่เพิ่มเอง (ค่าต่อบิล — แสดงทั้งมุมมองต่อบิลและต่อรายการสินค้า)
    const custom: Col[] = cf.fields.map((f) => ({
      id: `cf:${f.id}`, label: () => f.name, custom: f, def: true,
      kind: f.type === "number" ? "num" : f.type === "date" ? "date" : f.type === "text" ? "text" : "enum",
      get: (r) => fieldText(f, cf.values[r.o.id]?.[f.id]),
      chip: f.type === "select" ? (v) => { const o = f.options.find((x) => x.label === v); return <TagChip value={v} tone={o?.color} />; } : undefined,
    }));
    return [...base, ...custom];
  }, [mode, ref, catName, showCost, owStatus, locale, cf.fields, cf.values]); // eslint-disable-line react-hooks/exhaustive-deps

  const isShown = (c: Col) => (hidden[mode].length ? !hidden[mode].includes(c.id) : c.def !== false && !!c.def);
  const visible = cols.filter(isShown);
  // ครั้งแรก: ใช้ค่าเริ่มต้น (def) · เมื่อผู้ใช้ปรับ จะเก็บเป็นรายการที่ซ่อน
  function toggleCol(id: string) {
    const curHidden = hidden[mode].length ? hidden[mode] : cols.filter((c) => !c.def).map((c) => c.id);
    const next = curHidden.includes(id) ? curHidden.filter((x) => x !== id) : [...curHidden, id];
    setHidden({ ...hidden, [mode]: next.length ? next : ["__none__"] });
  }

  // ── แถว + ตัวกรอง + เรียง ──
  const rows = useMemo<Row[]>(() => mode === "bill" ? orders.map((o) => ({ o, key: o.id }))
    : orders.flatMap((o) => o.items.map((it, i) => ({ o, it, key: `${o.id}:${it.id ?? i}` }))), [orders, mode]);
  const filtered = useMemo(() => {
    const act = Object.entries(filters).filter(([, f]) => f && (f.text || f.values?.length || f.min != null || f.max != null || f.from || f.to));
    let out = rows;
    for (const [id, f] of act) {
      const c = cols.find((x) => x.id === id); if (!c) continue;
      out = out.filter((r) => {
        const v = c.get(r);
        if (f.text && !String(v ?? "").toLowerCase().includes(f.text.toLowerCase())) return false;
        if (f.values?.length && !f.values.includes(String(v ?? ""))) return false;
        if (f.min != null && Number(v) < f.min) return false;
        if (f.max != null && Number(v) > f.max) return false;
        if (f.from && String(v) < f.from) return false;
        if (f.to && String(v) > f.to) return false;
        return true;
      });
    }
    const c = cols.find((x) => x.id === sort.id);
    if (c) {
      const num = c.kind === "num" || c.kind === "money";
      out = [...out].sort((a, b) => {
        if (c.id === "date" || c.id === "time") return sort.dir * saleAt(a.o).localeCompare(saleAt(b.o));
        const x = c.get(a), y = c.get(b);
        return sort.dir * (num ? Number(x ?? 0) - Number(y ?? 0) : String(x ?? "").localeCompare(String(y ?? ""), "th"));
      });
    }
    return out;
  }, [rows, filters, cols, sort]);
  // แถวยอดรวม = เฉพาะบิลขายที่นับยอด (ไม่รวมบิลยกเลิก) — ตรงกับการ์ด/ภาพรวม/รายสาขา
  const counted = useMemo(() => filtered.filter((r) => isCountedSale(r.o)), [filtered]);
  const voidBills = useMemo(() => new Set(filtered.filter((r) => !isCountedSale(r.o)).map((r) => r.o.id)).size, [filtered]);
  const totals = useMemo(() => Object.fromEntries(visible.filter((c) => c.sum).map((c) => [c.id, counted.reduce((s, r) => s + Number(c.get(r) ?? 0), 0)])), [visible, counted]);
  const billCount = useMemo(() => new Set(filtered.map((r) => r.o.id)).size, [filtered]);
  const pages = Math.max(1, Math.ceil(filtered.length / per)), cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * per, cur * per + per);
  const activeFilters = Object.entries(filters).filter(([, f]) => f && (f.text || f.values?.length || f.min != null || f.max != null || f.from || f.to));
  const setF = (id: string, f: ColFilter | null) => { setFilters((x) => { const n = { ...x }; if (f) n[id] = f; else delete n[id]; return n; }); setPage(0); };

  function exportXls() {
    downloadExcel(`sales-${mode}-${new Date().toISOString().slice(0, 10)}.xls`, visible.map((c) => ({ key: c.id, label: c.label(), map: (r: Row) => { const v = c.get(r); return v == null ? "" : v; } })), filtered,
      `${tr("ยอดขาย", "Sales", "销售")} · ${mode === "bill" ? tr("ต่อบิล", "per bill", "按单据") : tr("ต่อรายการสินค้า", "per line", "按商品行")} · ${formatInt(filtered.length)} ${tr("แถว", "rows", "行")}`);
  }
  async function copyLink(o: Order) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/admin/sales?tab=bills&bill=${encodeURIComponent(o.order_no)}`); setCopied(o.id); setTimeout(() => setCopied(""), 1500); } catch { /* */ }
  }
  // เปิดบิลจากลิงก์ (?bill=)
  useEffect(() => {
    const no = new URLSearchParams(window.location.search).get("bill");
    if (!no) return;
    const o = orders.find((x) => x.order_no === no);
    if (o) setOpenBill(o);
  }, [orders]);

  // ── ตรึงคอลัมน์: วัดความกว้างหัวคอลัมน์จริง → ตำแหน่ง left ของแต่ละคอลัมน์ที่ตรึง ──
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const [lefts, setLefts] = useState<number[]>([]);
  const nFrozen = Math.min(frozen, visible.length);
  useLayoutEffect(() => {
    const out: number[] = []; let x = 0;
    for (let i = 0; i < nFrozen; i++) { out.push(x); x += thRefs.current[i]?.offsetWidth ?? 0; }
    setLefts((prev) => (prev.length === out.length && prev.every((v, i) => v === out[i]) ? prev : out));
  });
  const fz = (i: number, extra = "") => i < nFrozen
    ? { className: `sticky ${extra} ${i === nFrozen - 1 ? "shadow-[2px_0_0_rgb(var(--c-line))]" : ""}`, style: { left: lefts[i] ?? 0 } }
    : { className: "", style: undefined as React.CSSProperties | undefined };

  const fmt = (c: Col, r: Row) => {
    if (c.show) { const v = c.show(r); if (v !== undefined) return v; }
    const v = c.get(r);
    if (c.kind === "money") return baht(Number(v ?? 0));
    if (c.kind === "num") return formatInt(Number(v ?? 0));
    if (v === "" || v == null || v === "—") return <span className="text-muted">—</span>;
    // ค่าแบบเลือก (dropdown) → ป้ายสีแบบ Lark · คน → ชิปรูปย่อ + ชื่อ
    if (c.kind === "enum") return <TagChip value={String(v)} />;
    return String(v);
  };

  return (
    <div className="card overflow-hidden">
      {/* แถบมุมมองแบบ Lark */}
      <SheetViewTabs capture={captureView} apply={applyView} />
      {/* แถบเครื่องมือ */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <Segmented<Mode> size="sm" value={mode} onChange={setMode} options={[
          { value: "bill", label: <span className="inline-flex items-center gap-1.5"><ReceiptText size={13} />{tr("ต่อบิล", "Per bill", "按单据")}</span> },
          { value: "line", label: <span className="inline-flex items-center gap-1.5"><Rows3 size={13} />{tr("ต่อรายการสินค้า (แบบชีทสาขา)", "Per product line (branch sheet)", "按商品行（门店表格）")}</span> },
        ]} />
        <span className="text-[11px] text-muted tnum">{formatInt(filtered.length)} {tr("แถว", "rows", "行")} · {formatInt(billCount)} {tr("บิล", "bills", "单")}{voidBills ? <span title={tr("บิลยกเลิก/คืนสินค้า แสดงในตารางแต่ไม่รวมในแถวยอดรวม", "Voided/returned bills are listed but excluded from the total row", "作废/退货单据列出但不计入合计")}> · {tr(`ยกเลิก ${formatInt(voidBills)} (ไม่รวมในยอด)`, `${formatInt(voidBills)} voided (not in total)`, `作废 ${formatInt(voidBills)}（不计入合计）`)}</span> : null}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {activeFilters.length ? <button onClick={() => { setFilters({}); setPage(0); }} className="h-8 px-2.5 rounded-lg border border-line text-xs inline-flex items-center gap-1 text-muted hover:text-ink"><RotateCcw size={13} />{tr("ล้างตัวกรองคอลัมน์", "Clear column filters", "清除列筛选")}</button> : null}
          <div className="relative">
            <button onClick={() => setColsOpen((v) => !v)} className="h-8 px-2.5 rounded-lg border border-line text-xs inline-flex items-center gap-1.5 hover:bg-surface2"><Columns3 size={13} />{tr("คอลัมน์", "Columns", "列")} <span className="text-muted">{visible.length}/{cols.length}</span></button>
            {colsOpen ? (
              <div className="absolute right-0 mt-1 w-64 max-h-[60vh] overflow-auto bg-surface border border-line rounded-xl shadow-pop p-2 z-40">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-[11px] font-semibold text-muted">{tr("แสดงคอลัมน์", "Show columns", "显示列")}</span>
                  <span className="flex gap-2 text-[11px]">
                    <button onClick={() => setHidden({ ...hidden, [mode]: ["__none__"] })} className="text-brand">{tr("ทั้งหมด", "All", "全部")}</button>
                    <button onClick={() => setHidden({ ...hidden, [mode]: [] })} className="text-muted hover:text-ink">{tr("ค่าเริ่มต้น", "Default", "默认")}</button>
                  </span>
                </div>
                {cols.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-surface2 text-xs cursor-pointer">
                    <input type="checkbox" checked={isShown(c)} onChange={() => toggleCol(c.id)} className="accent-[rgb(var(--c-brand))]" />{c.label()}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <label className="h-8 pl-2 pr-1 rounded-lg border border-line text-xs inline-flex items-center gap-1 hover:bg-surface2" title={tr("ตรึงคอลัมน์ด้านซ้ายไว้ไม่ให้เลื่อนตามแนวนอน (ตั้งได้ที่เมนูหัวคอลัมน์ด้วย)", "Freeze left columns so they don't scroll (also from a column's menu)", "冻结左侧列（也可在列菜单设置）")}>
            <Pin size={12} />{tr("ตรึง", "Freeze", "冻结")}
            <select value={nFrozen} onChange={(e) => setFrozen(Number(e.target.value))} className="h-6 bg-transparent text-xs outline-none">
              {Array.from({ length: Math.min(8, visible.length) + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? tr("ไม่ตรึง", "None", "无") : tr(`${n} คอลัมน์`, `${n} col`, `${n} 列`)}</option>)}
            </select>
          </label>
          <button onClick={exportXls} className="h-8 px-2.5 rounded-lg border border-line text-xs inline-flex items-center gap-1.5 hover:bg-surface2"><FileDown size={13} />Excel</button>
          {onExportCsv ? <button onClick={onExportCsv} className="h-8 px-2 text-xs text-muted hover:text-ink">CSV</button> : null}
        </div>
      </div>
      {activeFilters.length ? (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-line bg-brand/[0.03]">
          {activeFilters.map(([id, f]) => {
            const c = cols.find((x) => x.id === id);
            const desc = f.values?.length ? (f.values.length <= 2 ? f.values.join(", ") : `${f.values.length} ${tr("ค่า", "values", "项")}`) : f.text ? `“${f.text}”` : f.from || f.to ? `${f.from ?? "…"} → ${f.to ?? "…"}` : `${f.min ?? "…"} – ${f.max ?? "…"}`;
            return <span key={id} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-brand/10 text-brand text-[11.5px]"><b className="font-medium">{c?.label()}</b>: <span translate="no">{desc}</span><button onClick={() => setF(id, null)} className="h-5 w-5 grid place-items-center rounded-full hover:bg-brand/15"><X size={11} /></button></span>;
          })}
        </div>
      ) : null}

      {/* ตาราง */}
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {visible.map((c, i) => {
                const f = filters[c.id]; const on = !!f && (f.text || f.values?.length || f.min != null || f.max != null || f.from || f.to);
                const right = c.kind === "num" || c.kind === "money";
                const z = fz(i, "z-20");
                return (
                  <th key={c.id} ref={(el) => { thRefs.current[i] = el; }} style={{ ...(c.w ? { minWidth: c.w } : {}), ...z.style }} className={`font-medium text-[11px] text-muted border-b border-line bg-surface2 whitespace-nowrap ${i === 0 ? "pl-4 pr-2" : "px-2"} py-2 ${right ? "text-right" : "text-left"} ${z.className}`}>
                    <span className={`inline-flex items-center gap-0.5 ${right ? "flex-row-reverse" : ""}`}>
                      <button onClick={() => setSort({ id: c.id, dir: sort.id === c.id ? (sort.dir === 1 ? -1 : 1) : right ? -1 : 1 })} className="hover:text-ink inline-flex items-center gap-0.5">
                        {c.label()}{sort.id === c.id ? (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null}
                      </button>
                      {c.custom ? (() => { const I = fieldIcon(c.custom.type); return <I size={11} className="opacity-60 shrink-0" />; })() : null}
                      {c.custom && cf.canEdit ? <button aria-label={tr("แก้ไขคอลัมน์", "Edit column", "编辑列")} title={tr("แก้ไขคอลัมน์", "Edit column", "编辑列")} onClick={(e) => setFieldEdit({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), field: c.custom })}
                        className="h-5 w-5 grid place-items-center rounded opacity-50 hover:opacity-100 hover:bg-surface2"><Pencil size={10} /></button> : null}
                      <button aria-label={tr("กรองคอลัมน์", "Filter column", "筛选列")} onClick={(e) => setMenu({ id: c.id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                        className={`h-5 w-5 grid place-items-center rounded ${on ? "text-brand bg-brand/10" : "opacity-50 hover:opacity-100 hover:bg-surface2"}`}><Filter size={10.5} /></button>
                    </span>
                  </th>
                );
              })}
              <th className="border-b border-l border-line bg-surface2 w-[72px] sticky right-0 z-10 px-2">
                {cf.ready && cf.canEdit ? (
                  <button onClick={(e) => setFieldEdit({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })} title={tr("เพิ่มคอลัมน์ของคุณเอง (กรอกข้อมูลได้แบบ Excel)", "Add your own column (editable like Excel)", "添加自定义列（可像 Excel 一样编辑）")}
                    className="h-7 w-full rounded-lg border border-dashed border-line text-muted hover:text-brand hover:border-brand/50 inline-flex items-center justify-center gap-1 text-[11px]"><Plus size={12} />{tr("คอลัมน์", "Column", "列")}</button>
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const active = openBill?.id === r.o.id;
              return (
                <tr key={r.key} tabIndex={canTrace ? 0 : -1}
                  onClick={canTrace ? () => setOpenBill(r.o) : undefined}
                  onKeyDown={(e) => { if (canTrace && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpenBill(r.o); } }}
                  title={canTrace ? tr("กดตรงไหนของแถวก็ได้ เพื่อดูรายละเอียดและที่มาของบิล", "Click anywhere on the row to view bill details and trace", "点击行任意位置查看单据详情与来源") : undefined}
                  className={`group ${canTrace ? "cursor-pointer" : ""} ${active ? "bg-brand/[0.07]" : "hover:bg-brand/[0.04]"}`}>
                  {visible.map((c, i) => { const z = fz(i, `z-[5] ${active ? "bg-[rgb(var(--c-surface))]" : "bg-surface"}`); return (
                    <td key={c.id} translate={c.noTr ? "no" : undefined} style={z.style}
                      className={`border-b border-line/70 py-2 whitespace-nowrap max-w-[260px] truncate ${i === 0 ? "pl-4 pr-2" : "px-2"} ${z.className} ${c.kind === "num" || c.kind === "money" ? "text-right tnum" : ""} ${c.id === "total" || c.id === "l_total" ? "font-semibold" : ""} ${r.o.status === "voided" && (c.id === "total" || c.id === "l_total") ? "line-through text-muted" : ""} ${c.id === "gp" || c.id === "l_gp" ? "text-ok" : ""}`}>
                      {c.custom ? <FieldCell field={c.custom} value={cf.values[r.o.id]?.[c.custom.id]} editable={cf.canEdit} onSave={(v) => void cf.setValue(r.o.id, c.custom!, v)} /> : fmt(c, r)}
                    </td>
                  ); })}
                  {/* ปุ่มเชื่อมโยง — แยกให้เห็นชัด (กดทั้งแถวยังเปิดได้เหมือนเดิม) */}
                  <td className={`border-b border-l border-line/70 pr-3 pl-2 py-1.5 sticky right-0 ${active ? "bg-[rgb(var(--c-surface))]" : "bg-surface"}`} onClick={(e) => e.stopPropagation()}>
                    <span className="flex items-center justify-end gap-1">
                      {canTrace ? <button onClick={() => setOpenBill(r.o)} title={tr("เปิดบิลและที่มาของบิล", "Open bill & trace", "打开单据与来源")} aria-label={tr("เปิดบิล", "Open bill", "打开单据")}
                        className="h-7 w-7 grid place-items-center rounded-lg border border-line text-muted hover:text-brand hover:border-brand/50 hover:bg-brand/5"><ExternalLink size={13} /></button> : null}
                      <button onClick={() => void copyLink(r.o)} title={tr("คัดลอกลิงก์บิลนี้", "Copy link to this bill", "复制单据链接")} aria-label={tr("คัดลอกลิงก์", "Copy link", "复制链接")}
                        className="h-7 w-7 grid place-items-center rounded-lg border border-line text-muted hover:text-brand hover:border-brand/50">{copied === r.o.id ? <Check size={13} className="text-ok" /> : <Link2 size={13} />}</button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {shown.length ? (
            <tfoot className="sticky bottom-0 z-10 bg-surface">
              <tr>
                {visible.map((c, i) => { const z = fz(i, "z-20"); return (
                  <td key={c.id} style={z.style} className={`border-t-2 border-line py-2 font-semibold whitespace-nowrap bg-surface2 ${i === 0 ? "pl-4 pr-2" : "px-2"} ${z.className} ${c.kind === "num" || c.kind === "money" ? "text-right tnum" : ""}`}>
                    {i === 0 ? tr("รวม", "Total", "合计") : c.id in totals ? (c.kind === "money" ? baht(totals[c.id]) : formatInt(totals[c.id])) : ""}
                  </td>
                ); })}
                <td className="border-t-2 border-l border-line bg-surface2 sticky right-0" />
              </tr>
            </tfoot>
          ) : null}
        </table>
        {!shown.length ? <p className="text-sm text-muted text-center py-10">{tr("ไม่มีข้อมูลตามตัวกรอง", "No rows match the filters", "没有符合筛选的数据")}</p> : null}
      </div>

      {/* แบ่งหน้า */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-line text-xs">
        <span className="text-muted">{formatInt(filtered.length ? cur * per + 1 : 0)}–{formatInt(Math.min(filtered.length, cur * per + per))} {tr("จาก", "of", "/")} {formatInt(filtered.length)}
          <select value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(0); }} className="ml-2 h-7 rounded-lg border border-line bg-surface px-1">{[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}/{tr("หน้า", "page", "页")}</option>)}</select>
        </span>
        <span className="flex gap-1"><button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="h-7 px-2.5 rounded-lg border border-line disabled:opacity-40">{tr("ก่อนหน้า", "Prev", "上一页")}</button><button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="h-7 px-2.5 rounded-lg border border-line disabled:opacity-40">{tr("ถัดไป", "Next", "下一页")}</button></span>
      </div>

      {fieldEdit ? <FieldEditor rect={fieldEdit.rect} field={fieldEdit.field} onClose={() => setFieldEdit(null)}
        onSave={async (f) => { if (fieldEdit.field) await cf.updateField(fieldEdit.field.id, { name: f.name, options: f.options }); else await cf.createField(f); }}
        onDelete={fieldEdit.field ? async () => { await cf.deleteField(fieldEdit.field!.id); } : undefined} /> : null}
      {cf.error ? <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[95] rounded-xl bg-danger text-white text-xs px-4 py-2.5 shadow-pop flex items-center gap-2">{tr("บันทึกไม่สำเร็จ", "Save failed", "保存失败")}: {cf.error}<button onClick={() => cf.setError("")} className="opacity-80 hover:opacity-100"><X size={13} /></button></div> : null}
      {menu ? <ColumnFilterMenu col={cols.find((c) => c.id === menu.id)!} rect={menu.rect} rows={rows} value={filters[menu.id]} onClose={() => setMenu(null)}
        frozenUpTo={visible.findIndex((c) => c.id === menu.id) < nFrozen} onFreeze={(on) => { const i = visible.findIndex((c) => c.id === menu.id); setFrozen(on ? i + 1 : i); setMenu(null); }}
        onApply={(f) => { setF(menu.id, f); setMenu(null); }} onSort={(dir) => { setSort({ id: menu.id, dir }); setMenu(null); }} /> : null}
      {openBill && openBill.source !== "lark" ? <OrderTraceDrawer key={openBill.id} clientUuid={openBill.client_uuid} orderNo={openBill.order_no} onClose={() => setOpenBill(null)} /> : null}
      {openBill && openBill.source === "lark" ? <LarkBillDrawer order={openBill} onClose={() => setOpenBill(null)} /> : null}
    </div>
  );
}

// ── เมนูกรองรายคอลัมน์ (แบบชีท) ──
function ColumnFilterMenu({ col, rect, rows, value, onClose, onApply, onSort, frozenUpTo, onFreeze }: {
  col: Col; rect: DOMRect; rows: Row[]; value?: ColFilter; onClose: () => void; onApply: (f: ColFilter | null) => void; onSort: (dir: 1 | -1) => void;
  frozenUpTo?: boolean; onFreeze?: (on: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(value?.text ?? ""), [q, setQ] = useState("");
  const [min, setMin] = useState(value?.min != null ? String(value.min) : ""), [max, setMax] = useState(value?.max != null ? String(value.max) : "");
  const [from, setFrom] = useState(value?.from ?? ""), [to, setTo] = useState(value?.to ?? "");
  const distinct = useMemo(() => {
    if (col.kind !== "enum" && col.kind !== "text") return [];
    const m = new Map<string, number>();
    for (const r of rows) { const v = String(col.get(r) ?? ""); m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 500);
  }, [col, rows]);
  const [picked, setPicked] = useState<Set<string>>(new Set(value?.values ?? []));
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);
  const left = Math.min(Math.max(8, rect.left - 120), window.innerWidth - 288);
  const numeric = col.kind === "num" || col.kind === "money";
  const showList = col.kind === "enum" || (col.kind === "text" && distinct.length <= 300);
  const list = distinct.filter(([v]) => !q || v.toLowerCase().includes(q.toLowerCase()));
  function apply() {
    const f: ColFilter = {};
    if (text.trim()) f.text = text.trim();
    if (picked.size) f.values = [...picked];
    if (min !== "") f.min = Number(min);
    if (max !== "") f.max = Number(max);
    if (from) f.from = from;
    if (to) f.to = to;
    onApply(Object.keys(f).length ? f : null);
  }
  return createPortal(
    <div ref={box} style={{ top: rect.bottom + 6, left }} className="fixed z-[80] w-72 bg-surface border border-line rounded-xl shadow-pop p-3 space-y-2.5 text-xs">
      <div className="flex items-center justify-between"><b className="text-[13px]">{col.label()}</b><button onClick={onClose} className="text-muted hover:text-ink"><X size={14} /></button></div>
      <div className="flex gap-1.5">
        <button onClick={() => onSort(1)} className="flex-1 h-8 rounded-lg border border-line inline-flex items-center justify-center gap-1 hover:bg-surface2"><ArrowUp size={12} />{numeric ? tr("น้อย → มาก", "Low → High", "小→大") : "A → Z"}</button>
        <button onClick={() => onSort(-1)} className="flex-1 h-8 rounded-lg border border-line inline-flex items-center justify-center gap-1 hover:bg-surface2"><ArrowDown size={12} />{numeric ? tr("มาก → น้อย", "High → Low", "大→小") : "Z → A"}</button>
      </div>
      {onFreeze ? (
        <button onClick={() => onFreeze(!frozenUpTo)} className="w-full h-8 rounded-lg border border-line inline-flex items-center justify-center gap-1.5 hover:bg-surface2">
          {frozenUpTo ? <><PinOff size={12} />{tr("เลิกตรึงตั้งแต่คอลัมน์นี้", "Unfreeze from this column", "从此列取消冻结")}</> : <><Pin size={12} />{tr("ตรึงถึงคอลัมน์นี้ (ไม่เลื่อน)", "Freeze up to this column", "冻结至此列")}</>}
        </button>
      ) : null}
      {numeric ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-muted">{tr("ตั้งแต่", "Min", "最小")}</span><input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.-]/g, ""))} className="w-full h-8 px-2 rounded-lg border border-line bg-surface tnum" /></label>
          <label className="space-y-1"><span className="text-muted">{tr("ถึง", "Max", "最大")}</span><input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.-]/g, ""))} className="w-full h-8 px-2 rounded-lg border border-line bg-surface tnum" /></label>
        </div>
      ) : col.kind === "date" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-muted">{tr("ตั้งแต่", "From", "从")}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full h-8 px-1.5 rounded-lg border border-line bg-surface" /></label>
          <label className="space-y-1"><span className="text-muted">{tr("ถึง", "To", "到")}</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-8 px-1.5 rounded-lg border border-line bg-surface" /></label>
        </div>
      ) : (
        <>
          {col.kind === "text" ? <label className="block space-y-1"><span className="text-muted">{tr("มีคำว่า", "Contains", "包含")}</span><input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} className="w-full h-8 px-2 rounded-lg border border-line bg-surface" /></label> : null}
          {showList ? (
            <div className="space-y-1.5">
              <div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("ค้นหาค่า", "Search values", "搜索值")} className="w-full h-8 pl-7 pr-2 rounded-lg border border-line bg-surface" /></div>
              <div className="flex justify-between text-[11px] text-muted"><button onClick={() => setPicked(new Set(list.map(([v]) => v)))} className="hover:text-brand">{tr("เลือกทั้งหมด", "Select all", "全选")}</button><button onClick={() => setPicked(new Set())} className="hover:text-brand">{tr("ล้าง", "Clear", "清除")}</button></div>
              <div className="max-h-52 overflow-auto rounded-lg border border-line divide-y divide-line/60" translate="no">
                {list.map(([v, n]) => (
                  <label key={v} className="flex items-center gap-2 px-2 py-1.5 hover:bg-surface2 cursor-pointer">
                    <input type="checkbox" checked={picked.has(v)} onChange={(e) => { const s = new Set(picked); if (e.target.checked) s.add(v); else s.delete(v); setPicked(s); }} className="accent-[rgb(var(--c-brand))]" />
                    <span className="flex-1 min-w-0 truncate">{v ? (col.chip ? col.chip(v) : v) : <span className="text-muted">({tr("ว่าง", "blank", "空")})</span>}</span><span className="text-muted tnum">{formatInt(n)}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      <div className="flex justify-between gap-2 pt-1">
        <button onClick={() => onApply(null)} className="h-8 px-3 rounded-lg border border-line text-muted hover:text-ink">{tr("ล้าง", "Clear", "清除")}</button>
        <button onClick={apply} className="h-8 px-4 rounded-lg bg-brand text-brandInk font-medium">{tr("ใช้ตัวกรอง", "Apply", "应用")}</button>
      </div>
    </div>,
    document.body,
  );
}

/** ป้ายแหล่งข้อมูล: POS = ขายในระบบนี้ · Lark = ระบบเดิม (ดึงจาก Dataverse) */
export function SourceTag({ source }: { source: "pos" | "lark" }) {
  return source === "lark"
    ? <span title={tr("ข้อมูลจากระบบเดิม (Lark) ผ่าน Dataverse", "From the legacy system (Lark) via Dataverse", "来自旧系统 (Lark)")} className="inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-semibold tracking-wide border border-[#C9B37E] text-[#7A5E22] bg-[#FBF6EA] dark:bg-[#2C2619] dark:text-[#E2C98F] dark:border-[#6B5A30]" translate="no">Lark</span>
    : <span title={tr("ขายในระบบ SHD POS", "Sold in SHD POS", "在 SHD POS 销售")} className="inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-semibold tracking-wide border border-line text-ink bg-surface2" translate="no">POS</span>;
}

/** บิลจากระบบเดิม — ไม่มีที่มาในระบบนี้ แสดงรายการตามที่ดึงมา */
function LarkBillDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={<span className="inline-flex items-center gap-2"><SourceTag source="lark" /><span className="font-mono">{order.order_no}</span></span>}
      subtitle={tr("ข้อมูลจากระบบเดิม (Lark) ผ่าน Dataverse — อ่านอย่างเดียว · อัปเดตอัตโนมัติทุก 15 นาที", "From the legacy system (Lark) via Dataverse — read only · refreshed every 15 min", "来自旧系统 (Lark) — 只读 · 每 15 分钟更新")}>
      <div className="p-5 space-y-3 text-sm">
        <p className="text-xs text-muted">{new Date(order.created_at).toLocaleDateString("th-TH", { dateStyle: "long" })}{order.status === "voided" ? ` · ${tr("คืนสินค้า", "Returned", "已退货")}` : ""}</p>
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted"><tr><th className="text-left font-medium py-1">{tr("สินค้า", "Item", "商品")}</th><th className="text-right font-medium py-1">{tr("จำนวน", "Qty", "数量")}</th><th className="text-right font-medium py-1">{tr("ยอด", "Amount", "金额")}</th></tr></thead>
          <tbody className="divide-y divide-line/60">
            {order.items.map((i) => (
              <tr key={i.id}><td className="py-1.5"><span className="block" translate="no">{i.name}</span><span className="text-[11px] text-muted font-mono" translate="no">{i.sku}</span></td>
                <td className="py-1.5 text-right tnum">{i.qty}</td><td className="py-1.5 text-right tnum">{formatTHB(i.line_total)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between font-semibold border-t border-line pt-2"><span>{tr("ยอดสุทธิ", "Net total", "合计")}</span><span className="tnum">{formatTHB(order.grand_total)}</span></div>
      </div>
    </Drawer>
  );
}
