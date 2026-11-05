"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import {
  Search, Plus, Minus, Trash2, Percent, Barcode, Inbox, PauseCircle, PlayCircle,
  UserRound, AlertTriangle, PackageX, Tag, UserPlus, Phone, ChevronRight, X, Star, Wallet, Ticket,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useCart } from "@/lib/store/cart";
import { useToast } from "@/components/toast-host";
import {
  listProducts, listCategories, stockForBranch, employeesAtBranch, commitSale,
  getBranch, holdBill, listHolds, removeHold, currentShift, validateCoupon,
} from "@/lib/data/repo";
import type { Branch, CartLine, Category, Employee, Order, Product, StockLevel, PaymentEntry } from "@/lib/types";
import { formatTHB, lineTotal, round2 } from "@/lib/money";
import { can, discountLimit, discountApprovalLevel, needsApproval } from "@/lib/permissions";
import { Button, Card, EmptyState, Input, Select, Badge, Modal, Segmented } from "@/components/ui";
import { PaymentModal } from "@/components/pos/payment-modal";
import { DiscountModal, SerialModal, ReceiptModal, type PrintStatus } from "@/components/pos/sale-modals";
import { ApprovalModal, type ApprovalRequestInput } from "@/components/pos/approval-modal";
import { pushDisplay } from "@/lib/customer-display";
import { CustomerPicker } from "@/components/pos/customer-picker";
import { maxRedeemablePoints, POINT_VALUE_THB } from "@/lib/loyalty";
import { uuidv4 } from "@/lib/uuid";
import { buildReceipt } from "@/lib/printing/receipt";
import { printEscPos, openCashDrawer } from "@/lib/printing/bridge";
import type { HeldBill } from "@/lib/offline/db";

const COMPANY = {
  name_th: "บริษัท เอส เอช ดี เทคโนโลยี จำกัด",
  tax_id: "0000000000000",
  address: "กรุงเทพมหานคร",
  phone: "02-000-0000",
};

export default function SellPage() {
  const { t, locale, pick } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const cart = useCart();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stock, setStock] = useState<Map<string, StockLevel>>(new Map());
  const [staff, setStaff] = useState<Employee[]>([]);
  const [branch, setBranch] = useState<Branch>();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lineDiscountId, setLineDiscountId] = useState<string | null>(null);
  const [billDiscountOpen, setBillDiscountOpen] = useState(false);
  const [serialLineId, setSerialLineId] = useState<string | null>(null);
  const [approvalReq, setApprovalReq] = useState<ApprovalRequestInput | null>(null);
  const pendingDiscount = useRef<{ lineId: string | null; percent: number; amount: number } | null>(null);

  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [printStatus, setPrintStatus] = useState<PrintStatus>("idle");
  const [printError, setPrintError] = useState<string | null>(null);
  const [holds, setHolds] = useState<HeldBill[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  const employee = session.employee;
  const branchId = session.branchId;
  const totals = cart.totals();

  // ------------------------------------------------------------------
  // โหลดข้อมูล
  // ------------------------------------------------------------------
  const reloadStock = useCallback(async () => {
    if (!branchId) return;
    setStock(await stockForBranch(branchId));
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    void (async () => {
      const [p, c, s, b, sh] = await Promise.all([
        listProducts(), listCategories(), employeesAtBranch(branchId), getBranch(branchId), currentShift(branchId),
      ]);
      setProducts(p);
      setCategories(c);
      setStaff(s);
      setBranch(b);
      session.setShift(sh ?? null);
      await reloadStock();
      setHolds(await listHolds(branchId));
      if (!cart.defaultSalespersonId && employee) cart.setDefaultSalesperson(employee.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // ส่งข้อมูลไปจอลูกค้าทุกครั้งที่ตะกร้าเปลี่ยน
  useEffect(() => {
    pushDisplay({
      state: cart.lines.length ? "cart" : "idle",
      branchName: branch ? pick({ th: branch.name_th, en: branch.name, zh: branch.name }) : undefined,
      lines: cart.lines.map((l) => ({ lineId: l.lineId, name: l.name, qty: l.qty, unit_price: l.unit_price })),
      subtotal: totals.subtotal,
      discount: totals.discountTotal,
      grandTotal: totals.grandTotal,
    });
  }, [cart.lines, totals.subtotal, totals.discountTotal, totals.grandTotal, branch, pick]);

  // ------------------------------------------------------------------
  // สินค้าที่แสดง — เฉพาะแบรนด์ของสาขา + ค้นหา
  // ------------------------------------------------------------------
  const branchProducts = useMemo(() => {
    if (!branch) return [];
    return products.filter((p) => {
      if (!p.is_active) return false;
      if (p.kind === "service" || p.kind === "fee") return true;
      return stock.has(p.id) || p.brand_id === branch.brand_id;
    });
  }, [products, branch, stock]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branchProducts
      .filter((p) => (categoryId === "all" ? true : p.category_id === categoryId))
      .filter((p) => {
        if (!q) return true;
        return (
          p.sku.toLowerCase().includes(q) ||
          p.name_th.toLowerCase().includes(q) ||
          (p.name_en ?? "").toLowerCase().includes(q) ||
          (p.name_zh ?? "").includes(q) ||
          p.barcodes.some((b) => b.includes(q))
        );
      })
      .slice(0, 120);
  }, [branchProducts, query, categoryId]);

  // ------------------------------------------------------------------
  // เพิ่มสินค้า
  // ------------------------------------------------------------------
  const addProduct = useCallback(
    (p: Product) => {
      const sl = stock.get(p.id);
      if (p.is_stocked && sl && sl.qty_on_hand <= 0) {
        toast.push({ tone: "warn", title: t.pos.outOfStock, body: p.name_th });
      }
      cart.addProduct(p);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stock, t.pos.outOfStock]
  );

  function onSearchEnter() {
    const q = query.trim();
    if (!q) return;
    const hit =
      branchProducts.find((p) => p.barcodes.includes(q)) ??
      branchProducts.find((p) => p.sku.toLowerCase() === q.toLowerCase());
    if (hit) {
      addProduct(hit);
      setQuery("");
      return;
    }
    if (visible.length === 1) {
      addProduct(visible[0]);
      setQuery("");
    }
  }

  // คีย์ลัด: F2 = ชำระเงิน, F4 = พักบิล, / = ไปช่องค้นหา
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" && cart.lines.length) {
        e.preventDefault();
        setPayOpen(true);
      }
      if (e.key === "F4" && cart.lines.length) {
        e.preventDefault();
        void doHold();
      }
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines.length]);

  // ------------------------------------------------------------------
  // ส่วนลด
  // ------------------------------------------------------------------
  function applyDiscount(lineId: string | null, percent: number, amount: number, requiresApproval: boolean) {
    if (!requiresApproval) {
      if (lineId) cart.setLineDiscount(lineId, percent, amount);
      else cart.setBillDiscount(percent, amount);
      setLineDiscountId(null);
      setBillDiscountOpen(false);
      return;
    }
    const base = lineId
      ? (() => {
          const l = cart.lines.find((x) => x.lineId === lineId);
          return l ? l.unit_price * l.qty : 0;
        })()
      : totals.subtotal;
    const pct = percent || (base > 0 ? round2((amount / base) * 100) : 0);
    pendingDiscount.current = { lineId, percent, amount };
    setApprovalReq({
      kind: "discount",
      minRole: discountApprovalLevel(pct) ?? "supervisor",
      branchId: branchId!,
      requestedBy: employee!.id,
      amount: amount || round2((base * percent) / 100),
      reason: `ส่วนลด ${pct.toFixed(1)}% เกินสิทธิ์ (${discountLimit(employee)}%)`,
      payload: { percent: pct, line_id: lineId },
    });
    setLineDiscountId(null);
    setBillDiscountOpen(false);
  }

  // ------------------------------------------------------------------
  // พักบิล
  // ------------------------------------------------------------------
  async function doHold() {
    if (!branchId || !cart.lines.length) return;
    const bill: HeldBill = {
      id: nanoid(),
      branch_id: branchId,
      label: cart.customerName || `${cart.lines.length} รายการ · ${formatTHB(totals.grandTotal, false)}`,
      lines: cart.lines,
      customer_name: cart.customerName,
      created_at: new Date().toISOString(),
    };
    await holdBill(bill);
    setHolds(await listHolds(branchId));
    cart.clear();
    toast.push({ tone: "info", title: t.pos.hold });
  }

  async function resumeHold(h: HeldBill) {
    cart.loadLines(h.lines as CartLine[]);
    cart.setCustomer(h.customer_name ?? "", "");
    await removeHold(h.id);
    setHolds(await listHolds(branchId!));
    setHoldOpen(false);
  }

  // ------------------------------------------------------------------
  // คูปอง
  // ------------------------------------------------------------------
  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponChecking(true);
    setCouponMsg(null);
    try {
      const r = await validateCoupon(code, cart.customerId, totals.subtotal);
      if (r.valid && r.campaign_id) {
        cart.setCoupon(code.toUpperCase(), r.discount ?? 0, r.campaign_id);
        setCouponInput("");
        setCouponMsg(null);
        toast.push({ tone: "ok", title: "ใช้คูปองแล้ว", body: `${r.name ?? code} · ลด ${formatTHB(r.discount ?? 0, false)}` });
      } else {
        setCouponMsg(r.reason ?? "ใช้คูปองไม่ได้");
      }
    } finally {
      setCouponChecking(false);
    }
  }

  // ------------------------------------------------------------------
  // จบการขาย — ลำดับสำคัญ: บันทึกบิล → ตัดสต๊อก → ค่อยพิมพ์
  // ------------------------------------------------------------------
  async function confirmSale(payments: PaymentEntry[], paid: number, change: number) {
    if (!employee || !branchId) return;
    const missingSerial = cart.lines.find((l) => l.track_serial && l.serials.length < l.qty);
    if (missingSerial) {
      toast.push({ tone: "warn", title: t.pos.serialRequired, body: missingSerial.name });
      setPayOpen(false);
      setSerialLineId(missingSerial.lineId);
      return;
    }

    setBusy(true);
    try {
      const { order } = await commitSale({
        client_uuid: uuidv4(),
        branch_id: branchId,
        terminal_id: session.terminalId,
        shift_id: session.shift?.id ?? null,
        cashier_id: employee.id,
        salesperson_id: cart.defaultSalespersonId ?? employee.id,
        customer_id: cart.customerId,
        customer_name: cart.customerName,
        customer_phone: cart.customerPhone,
        channel: session.channel,
        items: cart.lines,
        payments,
        subtotal: totals.subtotal,
        // ส่วนลดที่บันทึก = ส่วนลดพนักงาน + คูปอง + มูลค่าแต้มที่ใช้ (เพื่อให้ยอดตรงกัน)
        discount_total: round2(totals.discountTotal + totals.redeemAmount + totals.couponAmount),
        discount_percent: 0,
        vat_amount: totals.vatAmount,
        grand_total: totals.grandTotal,
        paid_total: paid,
        change_amount: change,
        note: cart.note,
        is_offline_origin: false,
        device_created_at: new Date().toISOString(),
        discount_approved_by: cart.discountApprovedBy,
        // หักแต้มตามส่วนลดจริงที่ใช้ (clamp แล้ว) เพื่อไม่ให้หักเกินส่วนลดที่ได้
        redeem_points: Math.round(totals.redeemAmount / POINT_VALUE_THB),
        coupon_code: cart.couponCode,
        coupon_discount: totals.couponAmount,
        coupon_campaign_id: cart.couponCampaignId,
      });

      // ถึงตรงนี้ = ขายสำเร็จแล้ว (บิลถูกบันทึก + ตัดสต๊อกแล้ว)
      setPayOpen(false);
      setLastOrder(order);
      cart.clear();
      await reloadStock();
      const sh = await currentShift(branchId);
      session.setShift(sh ?? null);

      pushDisplay({
        state: "done",
        lines: [],
        subtotal: 0,
        discount: 0,
        grandTotal: order.grand_total,
        paid,
        change,
        orderNo: order.order_no,
      });

      // พิมพ์สลิปเป็นขั้นตอนแยก — ถ้าพัง บิลยังอยู่
      void doPrint(order);
      // เปิดลิ้นชักอัตโนมัติเมื่อรับเงินสด
      if (payments.some((p) => p.method === "cash")) void openCashDrawer(session.printer);
    } catch (e) {
      toast.push({ tone: "danger", title: "บันทึกบิลไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function doPrint(order: Order) {
    setPrintStatus("printing");
    setPrintError(null);
    const builder = buildReceipt({
      order,
      branch,
      cashier: employee ?? undefined,
      salesperson: staff.find((s) => s.id === order.salesperson_id),
      company: COMPANY,
      width: session.printer.width,
    });
    const res = await printEscPos(session.printer, builder);
    if (res.ok) {
      setPrintStatus("ok");
    } else {
      setPrintStatus("failed");
      setPrintError(res.error ?? null);
    }
  }

  if (!employee || !branchId) return null;

  if (!session.shift) {
    return (
      <div className="p-6">
        <Card className="max-w-md mx-auto mt-16 p-8 text-center">
          <PlayCircle size={34} className="mx-auto text-brand mb-3" />
          <h2 className="text-base font-semibold">{t.shift.noShift}</h2>
          <p className="text-xs text-muted mt-1">{t.shift.openFirst}</p>
          <Button variant="primary" className="w-full mt-5" onClick={() => router.push("/pos/shift")}>
            {t.shift.open}
          </Button>
        </Card>
      </div>
    );
  }

  const discLimit = discountLimit(employee);
  const activeLine = cart.lines.find((l) => l.lineId === (lineDiscountId ?? serialLineId));

  return (
    <div className="grid lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_440px] h-[calc(100vh-3.5rem)] page-enter">
      {/* ================= ฝั่งสินค้า ================= */}
      <section className="flex flex-col min-h-0 border-r border-line">
        <div className="p-3 sm:p-4 border-b border-line flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearchEnter()}
              placeholder={t.pos.scanOrSearch}
              className="pl-9"
            />
          </div>
          <Button variant="ghost" onClick={() => setHoldOpen(true)} title={t.pos.holdList}>
            <PauseCircle size={16} />
            {holds.length ? <span className="tnum text-xs">{holds.length}</span> : null}
          </Button>
        </div>

        <div className="px-3 sm:px-4 py-2 flex gap-1.5 overflow-x-auto border-b border-line">
          <button
            onClick={() => setCategoryId("all")}
            className={`chip shrink-0 ${categoryId === "all" ? "border-brand text-brand bg-brand/8" : ""}`}
          >
            {t.common.all}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`chip shrink-0 ${categoryId === c.id ? "border-brand text-brand bg-brand/8" : ""}`}
            >
              {pick({ th: c.name_th, en: c.name_en, zh: c.name_zh })}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {visible.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
              {visible.map((p) => {
                const sl = stock.get(p.id);
                const qty = sl?.qty_on_hand ?? 0;
                const low = p.is_stocked && qty > 0 && qty <= (sl?.reorder_point ?? p.reorder_point);
                const out = p.is_stocked && qty <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="text-left rounded-xl border border-line bg-surface hover:border-brand hover:shadow-card transition-all p-3 flex flex-col min-h-[116px] active:scale-[0.985]"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-[10px] font-mono text-muted truncate">{p.sku}</span>
                      {out ? (
                        <Badge tone="danger" className="shrink-0">
                          <PackageX size={9} />
                        </Badge>
                      ) : low ? (
                        <Badge tone="warn" className="shrink-0 tnum">
                          {qty}
                        </Badge>
                      ) : p.is_stocked ? (
                        <span className="text-[10px] text-muted tnum shrink-0">{qty}</span>
                      ) : (
                        <Tag size={11} className="text-muted shrink-0" />
                      )}
                    </div>
                    <p className="text-xs font-medium mt-1.5 line-clamp-2 leading-snug flex-1">
                      {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}
                    </p>
                    <p className="text-sm font-semibold tnum mt-1.5">{formatTHB(p.price, false)}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<Barcode size={28} />} title={t.common.empty} body={t.pos.scanOrSearch} />
          )}
        </div>
      </section>

      {/* ================= ตะกร้า ================= */}
      <aside className="flex flex-col min-h-0 bg-surface">
        <div className="px-4 py-3 border-b border-line space-y-2">
          <div className="flex items-center gap-2">
            <UserRound size={15} className="text-muted shrink-0" />
            <Select
              value={cart.defaultSalespersonId ?? ""}
              onChange={(e) => cart.setDefaultSalesperson(e.target.value || null)}
              className="h-9 text-xs"
            >
              <option value="">{t.pos.selectSalesperson}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nickname ?? s.first_name}
                </option>
              ))}
            </Select>
          </div>
          {cart.customerName ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface2/60 pl-2.5 pr-1.5 py-1.5">
              <span className="grid place-items-center w-8 h-8 rounded-full text-white text-xs font-bold shrink-0"
                style={{ background: "linear-gradient(145deg,#0a84ff,#5e5ce6)" }}>
                {cart.customerName.trim().slice(0, 2).toUpperCase()}
              </span>
              <button onClick={() => setCustomerOpen(true)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold leading-tight truncate">{cart.customerName}</span>
                <span className="block text-[11px] text-muted leading-tight truncate">
                  {cart.customerPhone ? (
                    <span className="inline-flex items-center gap-1"><Phone size={10} />{cart.customerPhone}</span>
                  ) : cart.customerId ? "สมาชิก" : "แตะเพื่อเปลี่ยน / ค้นหา"}
                </span>
              </button>
              <button onClick={() => cart.clearCustomer()} className="p-1.5 rounded-lg text-muted hover:text-danger shrink-0" aria-label="ล้างลูกค้า">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCustomerOpen(true)}
              className="flex items-center gap-2 w-full h-10 px-3 rounded-xl border border-dashed border-line text-muted hover:text-ink hover:border-ink/30 transition-colors text-xs"
            >
              <UserPlus size={15} className="shrink-0" />
              <span className="flex-1 text-left">เลือก / สร้างลูกค้า</span>
              <ChevronRight size={15} />
            </button>
          )}

          {/* แต้ม/เครดิต + ใช้แต้มเป็นส่วนลด */}
          {cart.customerId && (cart.customerPoints > 0 || cart.customerCredit > 0) && (
            <div className="flex items-center gap-2 rounded-xl bg-surface2/60 border border-line px-2.5 py-1.5">
              <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300 font-semibold">
                <Star size={12} /> {cart.customerPoints.toLocaleString()} แต้ม
              </span>
              {cart.customerCredit > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-300 font-semibold">
                  <Wallet size={12} /> {formatTHB(cart.customerCredit, false)}
                </span>
              )}
              {cart.customerPoints > 0 && (
                cart.redeemPoints > 0 ? (
                  <button onClick={() => cart.setRedeem(0)} className="ml-auto text-[11px] font-semibold text-danger hover:underline">
                    ยกเลิกใช้แต้ม
                  </button>
                ) : (
                  <button
                    onClick={() => cart.setRedeem(maxRedeemablePoints(cart.customerPoints, totals.grandTotal))}
                    disabled={!cart.lines.length}
                    className="ml-auto text-[11px] font-semibold text-brand hover:underline disabled:opacity-40"
                  >
                    ใช้แต้ม
                  </button>
                )
              )}
            </div>
          )}

          {/* คูปอง */}
          {cart.couponCode ? (
            <div className="flex items-center gap-2 rounded-xl bg-violet-500/10 border border-violet-500/25 px-2.5 py-1.5">
              <Ticket size={13} className="text-violet-600 dark:text-violet-300 shrink-0" />
              <span className="font-mono text-xs font-bold text-violet-700 dark:text-violet-300">{cart.couponCode}</span>
              <span className="text-[11px] text-muted">ลด {formatTHB(cart.couponDiscount, false)}</span>
              <button onClick={() => cart.clearCoupon()} className="ml-auto text-muted hover:text-danger"><X size={13} /></button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Ticket size={13} className="absolute left-2.5 top-2.5 text-muted" />
                  <input
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponMsg(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void applyCoupon(); }}
                    placeholder="รหัสคูปอง"
                    className="w-full h-8 pl-7 pr-2 rounded-lg bg-surface2/60 border border-line outline-none text-xs font-mono uppercase focus:border-brand/40"
                  />
                </div>
                <button
                  onClick={() => void applyCoupon()} disabled={!couponInput.trim() || couponChecking}
                  className="h-8 px-3 rounded-lg bg-surface2 text-xs font-semibold text-ink hover:bg-surface2/70 disabled:opacity-40"
                >
                  {couponChecking ? "…" : "ใช้"}
                </button>
              </div>
              {couponMsg && <p className="text-[11px] text-danger px-1">{couponMsg}</p>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {cart.lines.length ? (
            <ul className="divide-y divide-line">
              {cart.lines.map((l) => {
                const total = lineTotal(l);
                const serialMissing = l.track_serial && l.serials.length < l.qty;
                return (
                  <li key={l.lineId} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug line-clamp-2">{l.name}</p>
                        <p className="text-[10px] font-mono text-muted mt-0.5">{l.sku}</p>
                      </div>
                      <button onClick={() => cart.removeLine(l.lineId)} className="text-muted hover:text-danger p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex items-center rounded-lg border border-line">
                        <button onClick={() => cart.setQty(l.lineId, l.qty - 1)} className="w-8 h-8 grid place-items-center text-muted hover:text-ink">
                          <Minus size={13} />
                        </button>
                        <span className="w-9 text-center text-sm font-medium tnum">{l.qty}</span>
                        <button onClick={() => cart.setQty(l.lineId, l.qty + 1)} className="w-8 h-8 grid place-items-center text-muted hover:text-ink">
                          <Plus size={13} />
                        </button>
                      </div>

                      <button
                        onClick={() => setLineDiscountId(l.lineId)}
                        className={`h-8 px-2 rounded-lg border text-[11px] font-medium ${
                          l.discount_percent || l.discount_amount ? "border-danger/40 text-danger bg-danger/8" : "border-line text-muted"
                        }`}
                        disabled={discLimit <= 0 && !needsApproval(employee, "pos.discount")}
                      >
                        <Percent size={12} className="inline -mt-0.5" />{" "}
                        {l.discount_percent ? `${l.discount_percent}%` : l.discount_amount ? formatTHB(l.discount_amount, false) : ""}
                      </button>

                      {l.track_serial ? (
                        <button
                          onClick={() => setSerialLineId(l.lineId)}
                          className={`h-8 px-2 rounded-lg border text-[11px] font-medium ${
                            serialMissing ? "border-warn/50 text-warn bg-warn/8" : "border-ok/40 text-ok bg-ok/8"
                          }`}
                        >
                          <Barcode size={12} className="inline -mt-0.5" /> {l.serials.length}/{l.qty}
                        </button>
                      ) : null}

                      <span className="ml-auto text-sm font-semibold tnum">{formatTHB(total, false)}</span>
                    </div>

                    {l.serials.length ? (
                      <p className="text-[10px] font-mono text-muted mt-1.5 truncate">SN: {l.serials.join(", ")}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<Inbox size={26} />} title={t.pos.emptyCart} body={t.pos.scanOrSearch} />
          )}
        </div>

        <div className="border-t border-line px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted">{t.pos.subtotal}</span>
            <span className="tnum">{formatTHB(totals.subtotal)}</span>
          </div>
          <button
            onClick={() => setBillDiscountOpen(true)}
            className="flex justify-between text-xs w-full hover:text-brand"
            disabled={!cart.lines.length}
          >
            <span className="text-muted flex items-center gap-1">
              <Percent size={11} /> {t.pos.billDiscount}
            </span>
            <span className="tnum text-danger">{totals.discountTotal > 0 ? `-${formatTHB(totals.discountTotal)}` : "—"}</span>
          </button>
          {totals.couponAmount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted flex items-center gap-1"><Ticket size={11} className="text-violet-500" /> คูปอง {cart.couponCode}</span>
              <span className="tnum text-danger">-{formatTHB(totals.couponAmount)}</span>
            </div>
          )}
          {totals.redeemAmount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted flex items-center gap-1"><Star size={11} className="text-amber-500" /> ใช้แต้ม ({cart.redeemPoints})</span>
              <span className="tnum text-danger">-{formatTHB(totals.redeemAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-muted">{t.pos.vat}</span>
            <span className="tnum text-muted">{formatTHB(totals.vatAmount)}</span>
          </div>
          <div className="flex items-baseline justify-between pt-1.5 border-t border-line">
            <span className="text-sm font-medium">{t.pos.grandTotal}</span>
            <span className="text-2xl font-semibold tnum">{formatTHB(totals.grandTotal)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <Button variant="ghost" onClick={() => cart.clear()} disabled={!cart.lines.length}>
              <Trash2 size={15} />
            </Button>
            <Button variant="ghost" onClick={() => void doHold()} disabled={!cart.lines.length}>
              <PauseCircle size={15} />
            </Button>
            <Button
              variant="ghost"
              disabled={!can(employee, "pos.open_drawer")}
              onClick={() => void openCashDrawer(session.printer)}
            >
              <Inbox size={15} />
            </Button>
          </div>
          <Button
            variant="ok"
            className="w-full h-14 text-base"
            disabled={!cart.lines.length}
            onClick={() => setPayOpen(true)}
          >
            {t.pos.pay} · {formatTHB(totals.grandTotal)}
          </Button>
          <p className="text-[10px] text-muted text-center">F2 = ชำระเงิน · F4 = พักบิล · / = ค้นหา</p>
        </div>
      </aside>

      {/* ================= Modals ================= */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        grandTotal={totals.grandTotal}
        busy={busy}
        onConfirm={(p, paid, change) => void confirmSale(p, paid, change)}
      />

      <DiscountModal
        open={Boolean(lineDiscountId)}
        onClose={() => setLineDiscountId(null)}
        title={t.pos.lineDiscount}
        base={activeLine ? activeLine.unit_price * activeLine.qty : 0}
        limitPercent={discLimit}
        initialPercent={activeLine?.discount_percent ?? 0}
        initialAmount={activeLine?.discount_amount ?? 0}
        onApply={(pct, amt, needs) => applyDiscount(lineDiscountId, pct, amt, needs)}
      />

      <DiscountModal
        open={billDiscountOpen}
        onClose={() => setBillDiscountOpen(false)}
        title={t.pos.billDiscount}
        base={totals.subtotal}
        limitPercent={discLimit}
        initialPercent={cart.billDiscountPercent}
        initialAmount={cart.billDiscountAmount}
        onApply={(pct, amt, needs) => applyDiscount(null, pct, amt, needs)}
      />

      <SerialModal
        open={Boolean(serialLineId)}
        onClose={() => setSerialLineId(null)}
        productName={activeLine?.name ?? ""}
        qty={activeLine?.qty ?? 1}
        initial={activeLine?.serials ?? []}
        onSave={(serials) => {
          if (serialLineId) cart.setLineSerials(serialLineId, serials);
          setSerialLineId(null);
        }}
      />

      <ApprovalModal
        request={approvalReq}
        onClose={() => setApprovalReq(null)}
        onApproved={(approver) => {
          const pd = pendingDiscount.current;
          if (!pd) return;
          if (pd.lineId) cart.setLineDiscount(pd.lineId, pd.percent, pd.amount);
          else cart.setBillDiscount(pd.percent, pd.amount);
          cart.setDiscountApprover(approver.id);
          pendingDiscount.current = null;
          toast.push({ tone: "ok", title: t.approval.approved, body: approver.nickname ?? approver.first_name });
        }}
      />

      <ReceiptModal
        open={Boolean(lastOrder)}
        order={lastOrder}
        branch={branch}
        cashier={employee}
        printStatus={printStatus}
        printError={printError}
        canOpenDrawer={can(employee, "pos.open_drawer")}
        onRetryPrint={() => lastOrder && void doPrint(lastOrder)}
        onOpenDrawer={() => void openCashDrawer(session.printer)}
        onNewSale={() => {
          setLastOrder(null);
          setPrintStatus("idle");
          pushDisplay({ state: "idle", lines: [], subtotal: 0, discount: 0, grandTotal: 0 });
          searchRef.current?.focus();
        }}
      />

      <Modal open={holdOpen} onClose={() => setHoldOpen(false)} title={t.pos.holdList} size="sm">
        {holds.length ? (
          <ul className="space-y-2">
            {holds.map((h) => (
              <li key={h.id} className="flex items-center gap-3 border border-line rounded-xl px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{h.label}</p>
                  <p className="text-[11px] text-muted">{new Date(h.created_at).toLocaleTimeString(locale === "th" ? "th-TH" : "en-US")}</p>
                </div>
                <Button variant="soft" onClick={() => void resumeHold(h)}>
                  {t.pos.resume}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t.common.empty} />
        )}
      </Modal>

      <CustomerPicker
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        branchId={branchId}
        initialQuery={cart.customerId ? "" : cart.customerName}
        onPick={(c) => cart.setCustomerRef(c)}
      />
    </div>
  );
}
