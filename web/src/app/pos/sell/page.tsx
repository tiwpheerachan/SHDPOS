"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import {
  Search, Plus, Minus, Trash2, Percent, Barcode, Inbox, PauseCircle, PlayCircle,
  UserRound, AlertTriangle, PackageX, Tag, UserPlus, Phone, ChevronRight, X, Star, Wallet, Ticket, Gift, Package, Maximize2, Minimize2, Store,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useCart } from "@/lib/store/cart";
import { useToast } from "@/components/toast-host";
import {
  listProducts, listCategories, stockForBranch, employeesAtBranch, commitSale,
  getBranch, holdBill, listHolds, removeHold, currentShift, validateCoupon,
  fetchActiveGiftCampaigns, fetchBrandWallet, listBrands, type GiftCampaign,
  listReservedOrders, deliverOrder, cancelReservedOrder, expireReservations,
  listPromoCampaigns, promoDiscount, type PromoCampaign,
} from "@/lib/data/repo";
import { computeCampaignGifts, giftSig } from "@/lib/promo/gifts";
import type { Branch, CartLine, Category, Employee, Order, Product, StockLevel, PaymentEntry } from "@/lib/types";
import { availableQty } from "@/lib/stock";
import { formatTHB, lineTotal, round2 } from "@/lib/money";
import { can, discountLimit, discountApprovalLevel, needsApproval } from "@/lib/permissions";
import { Button, Card, EmptyState, Input, Select, Badge, Modal, Segmented, Avatar } from "@/components/ui";
import { PaymentModal } from "@/components/pos/payment-modal";
import { DiscountModal, SerialModal, type PrintStatus } from "@/components/pos/sale-modals";
import { resolveSerial } from "@/lib/data/serials";
import { ReceiptPreview } from "@/components/pos/receipt-preview";
import { ApprovalModal, type ApprovalRequestInput } from "@/components/pos/approval-modal";
import { pushDisplay } from "@/lib/customer-display";
import { CustomerPicker } from "@/components/pos/customer-picker";
import { BranchSwitcher } from "@/components/pos/branch-switcher";
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
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

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
  const [reserveMode, setReserveMode] = useState(false); // ส่งทีหลัง (จองของ)
  const [resvOpen, setResvOpen] = useState(false); const [resvOrders, setResvOrders] = useState<Order[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [promos, setPromos] = useState<PromoCampaign[]>([]);
  const [promoOpen, setPromoOpen] = useState(false); // การ์ดเลือกแคมเปญส่วนลด
  const [promoShowAll, setPromoShowAll] = useState(false); // ดูภาพรวม (ทุกแคมเปญ)
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [giftCampaigns, setGiftCampaigns] = useState<GiftCampaign[]>([]);
  const [giftWarns, setGiftWarns] = useState<string[]>([]);

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
      await expireReservations(branchId); // ปล่อยจองที่หมดอายุ
      setResvOrders(await listReservedOrders([branchId]));
      setPromos(await listPromoCampaigns());
      if (!cart.defaultSalespersonId && employee) cart.setDefaultSalesperson(employee.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // payload พื้นฐานสำหรับจอลูกค้า (ใช้ซ้ำทั้งตอนตะกร้าและตอนชำระเงิน)
  const displayBase = useCallback(() => ({
    branchName: branch ? pick({ th: branch.name_th, en: branch.name, zh: branch.name }) : undefined,
    lines: cart.lines.map((l) => ({ lineId: l.lineId, name: l.name, qty: l.qty, unit_price: l.unit_price, image_url: l.image_url ?? null, is_gift: !!l.is_gift })),
    subtotal: totals.subtotal,
    discount: totals.discountTotal,
    coupon: totals.couponAmount,
    redeem: totals.redeemAmount,
    vat: totals.vatAmount,
    grandTotal: totals.grandTotal,
  }), [branch, pick, cart.lines, totals.subtotal, totals.discountTotal, totals.couponAmount, totals.redeemAmount, totals.vatAmount, totals.grandTotal]);

  // ส่งข้อมูลไปจอลูกค้าทุกครั้งที่ตะกร้าเปลี่ยน (เว้นตอนเปิดหน้าชำระเงิน — ให้ modal คุมจอ)
  useEffect(() => {
    if (payOpen) return;
    pushDisplay({ state: cart.lines.length ? "cart" : "idle", ...displayBase() });
  }, [payOpen, displayBase, cart.lines.length]);

  // ------------------------------------------------------------------
  // ของแถมอัตโนมัติจากแคมเปญ
  // ------------------------------------------------------------------
  const productBySku = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.sku, p);
    return m;
  }, [products]);

  // โลโก้แบรนด์ของสาขา (ขึ้นบนบิล)
  useEffect(() => {
    if (!branch?.brand_id) { setBrandLogo(null); return; }
    let alive = true;
    void listBrands().then((bs) => { if (alive) setBrandLogo(bs.find((b) => b.id === branch.brand_id)?.logo_url ?? null); });
    return () => { alive = false; };
  }, [branch?.brand_id]);

  // โหลดยอดกระเป๋าแบรนด์ของสาขา เมื่อผูกลูกค้า (แต้ม/เครดิตแยกตามแบรนด์)
  useEffect(() => {
    const brandId = branch?.brand_id;
    if (!cart.customerId || !brandId) return;
    let alive = true;
    void fetchBrandWallet(cart.customerId, brandId).then((w) => { if (alive) cart.setWallet(w.points, w.store_credit); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.customerId, branch?.brand_id]);

  // ดึงแคมเปญของแถมที่ใช้ได้กับสาขา/ช่องทางนี้
  useEffect(() => {
    if (!branchId) { setGiftCampaigns([]); return; }
    let alive = true;
    void fetchActiveGiftCampaigns(branchId, session.channel).then((c) => { if (alive) setGiftCampaigns(c); });
    return () => { alive = false; };
  }, [branchId, session.channel]);

  // ประเมินตะกร้า → เติม/ปรับของแถมอัตโนมัติ (บรรทัดของแถม = gift_source 'campaign')
  useEffect(() => {
    if (!giftCampaigns.length) {
      if (cart.lines.some((l) => l.gift_source === "campaign")) cart.setCampaignGifts([]);
      if (giftWarns.length) setGiftWarns([]);
      return;
    }
    const saleLines = cart.lines.filter((l) => l.gift_source !== "campaign");
    const { gifts, warnings } = computeCampaignGifts(
      saleLines,
      giftCampaigns,
      (sku) => productBySku.get(sku),
      (pid) => availableQty(stock.get(pid)),
    );
    if (giftSig(gifts) !== giftSig(cart.lines)) cart.setCampaignGifts(gifts);
    setGiftWarns((prev) => (prev.join("|") === warnings.join("|") ? prev : warnings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines, giftCampaigns, productBySku, stock]);

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

  // SKU ที่อยู่ในแคมเปญของแถม (ร่วมรายการ/ของแถม) → แสดงป้าย "โปร"
  const promoSkus = useMemo(() => {
    const s = new Set<string>();
    for (const c of giftCampaigns) {
      for (const sku of c.eligible_skus) s.add(sku);
      for (const g of c.gift_skus) s.add(g.sku);
    }
    return s;
  }, [giftCampaigns]);

  // ------------------------------------------------------------------
  // เพิ่มสินค้า
  // ------------------------------------------------------------------
  const addProduct = useCallback(
    (p: Product) => {
      const sl = stock.get(p.id);
      if (p.is_stocked && sl && availableQty(sl) <= 0) {
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
      reason: `${L("ส่วนลด", "Discount", "折扣")} ${pct.toFixed(1)}% ${L("เกินสิทธิ์", "exceeds limit", "超出权限")} (${discountLimit(employee)}%)`,
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
      label: cart.customerName || `${cart.lines.length} ${L("รายการ", "items", "项")} · ${formatTHB(totals.grandTotal, false)}`,
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

  // ออเดอร์จอง (ส่งทีหลัง): ส่งมอบ / ยกเลิก
  async function doDeliver(o: Order) {
    if (!employee || !branchId) return;
    try { await deliverOrder(o.id, employee.id); setResvOrders(await listReservedOrders([branchId])); await reloadStock(); toast.push({ tone: "ok", title: L("ส่งมอบของแล้ว (ตัดสต๊อก)", "Delivered", "已交付") }); }
    catch { toast.push({ tone: "danger", title: L("ส่งมอบไม่สำเร็จ", "Deliver failed", "交付失败") }); }
  }
  async function doCancelResv(o: Order) {
    if (!employee || !branchId) return;
    try { await cancelReservedOrder(o.id, employee.id); setResvOrders(await listReservedOrders([branchId])); await reloadStock(); toast.push({ tone: "ok", title: L("ยกเลิกการจองแล้ว (คืนยอดจอง)", "Reservation cancelled", "已取消预留") }); }
    catch { toast.push({ tone: "danger", title: L("ยกเลิกไม่สำเร็จ", "Cancel failed", "取消失败") }); }
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
        toast.push({ tone: "ok", title: L("ใช้คูปองแล้ว", "Coupon applied", "已使用优惠券"), body: `${r.name ?? code} · ${L("ลด", "−", "减")} ${formatTHB(r.discount ?? 0, false)}` });
      } else {
        setCouponMsg(r.reason ?? L("ใช้คูปองไม่ได้", "Coupon not valid", "优惠券无效"));
      }
    } finally {
      setCouponChecking(false);
    }
  }

  // ── แคมเปญ "ฉลาด": เจาะจงสินค้า → คิดลดจากสินค้านั้น · ทั้งบิล → คิดจากยอดรวม ──
  const promoBase = (p: PromoCampaign) => p.target_skus.length
    ? cart.lines.filter((l) => l.kind === "goods" && p.target_skus.includes(l.sku)).reduce((s, l) => s + l.unit_price * l.qty, 0)
    : totals.subtotal;
  const promoAmt = (p: PromoCampaign) => { const base = promoBase(p); if (base <= 0 || base < p.min_spend) return 0; return promoDiscount(p, base); };
  // เกี่ยวข้องกับตะกร้า: ทั้งบิล (ไม่เจาะจง) หรือมีสินค้าเป้าหมายอยู่ในตะกร้า
  const promoRelevant = (p: PromoCampaign) => !p.target_skus.length || cart.lines.some((l) => l.kind === "goods" && p.target_skus.includes(l.sku));

  // ใช้แคมเปญส่วนลด (กดการ์ดเลือก)
  function applyPromo(p: PromoCampaign) {
    const amt = promoAmt(p);
    if (amt <= 0) { toast.push({ tone: "warn", title: p.target_skus.length ? L("ยังไม่มีสินค้าของแคมเปญนี้ในตะกร้า", "Add a qualifying item first", "篮内无符合商品") : L(`ยอดไม่ถึงขั้นต่ำ ${formatTHB(p.min_spend, false)}`, `Min ${formatTHB(p.min_spend, false)}`, `未达`) }); return; }
    cart.setCoupon(p.code, amt, p.id);
    setPromoOpen(false);
    toast.push({ tone: "ok", title: L(`ใช้แคมเปญ: ${p.name}`, `Applied: ${p.name}`, p.name), body: `${L("ลด", "−", "减")} ${formatTHB(amt, false)}` });
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
        reserve: reserveMode, reserve_days: 7, // ส่งทีหลัง (จองของ)
        is_offline_origin: false,
        device_created_at: new Date().toISOString(),
        discount_approved_by: cart.discountApprovedBy,
        // หักแต้มตามส่วนลดจริงที่ใช้ (clamp แล้ว) เพื่อไม่ให้หักเกินส่วนลดที่ได้
        redeem_points: Math.round(totals.redeemAmount / POINT_VALUE_THB),
        coupon_code: cart.couponCode,
        coupon_discount: totals.couponAmount,
        coupon_campaign_id: cart.couponCampaignId,
        // snapshot กติกาที่ใช้จริง เก็บกับบิล
        promo_snapshot: {
          applied_at: new Date().toISOString(),
          coupon: cart.couponCode ? { code: cart.couponCode, discount: totals.couponAmount, campaign_id: cart.couponCampaignId } : null,
          redeem_points: cart.redeemPoints || 0,
          redeem_value: totals.redeemAmount || 0,
          gifts: cart.lines
            .filter((l) => l.is_gift)
            .map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, source: l.gift_source, campaign_id: l.gift_campaign_id ?? null, unit_cost: l.unit_cost })),
        },
      });

      // ถึงตรงนี้ = ขายสำเร็จแล้ว (บิลถูกบันทึก + ตัดสต๊อกแล้ว)
      setPayOpen(false);
      setLastOrder(order);
      cart.clear();
      if (reserveMode) { setReserveMode(false); setResvOrders(await listReservedOrders([branchId])); }
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
      toast.push({ tone: "danger", title: L("บันทึกบิลไม่สำเร็จ", "Failed to save order", "保存订单失败"), body: e instanceof Error ? e.message : String(e) });
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

  if (!employee) return null;

  // ยังไม่ได้เลือกสาขา (คนหลายสาขา/ทุกสาขา) → บังคับเลือกสาขาก่อนเริ่มขาย
  if (!branchId) {
    return (
      <div className="p-6">
        <Card className="max-w-md mx-auto mt-16 p-8 text-center">
          <Store size={34} className="mx-auto text-brand mb-3" />
          <h2 className="text-base font-semibold">{L("เลือกสาขาก่อนเริ่มขาย", "Select a branch to start selling", "请先选择门店再开始销售")}</h2>
          <p className="text-xs text-muted mt-1">{L("บิลทุกใบต้องผูกกับสาขาที่ขาย — เลือกสาขาที่คุณกำลังทำงานอยู่", "Every order is tied to a branch — pick the one you're working at", "每笔订单都需绑定门店 — 请选择您当前所在门店")}</p>
          <div className="mt-5 flex justify-center">
            <BranchSwitcher />
          </div>
        </Card>
      </div>
    );
  }

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
    <div className={`grid h-[calc(100vh-3.5rem)] page-enter transition-[grid-template-columns] duration-300 ${cartExpanded ? "lg:grid-cols-[minmax(0,1fr)_600px] xl:grid-cols-[minmax(0,1fr)_720px]" : "lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]"}`}>
      {/* ================= ฝั่งสินค้า ================= */}
      <section className="flex flex-col min-h-0 min-w-0 border-r border-line">
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
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
              {visible.map((p) => {
                const sl = stock.get(p.id);
                const qty = availableQty(sl); // พร้อมขาย (หัก reserved/OTWO แล้ว)
                const low = p.is_stocked && qty > 0 && qty <= (sl?.reorder_point ?? p.reorder_point);
                const out = p.is_stocked && qty <= 0;
                const name = pick({ th: p.name_th, en: p.name_en, zh: p.name_zh });
                const hasImg = !!p.image_url;
                const promo = promoSkus.has(p.sku);
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="group text-left rounded-2xl border border-line bg-surface p-2 hover:shadow-card hover:border-brand/30 transition-all active:scale-[0.985] flex flex-col"
                  >
                    {/* รูปสินค้า — เต็มกรอบ ไม่มีพื้นเทากั้น */}
                    <div className={`relative rounded-xl aspect-square overflow-hidden grid place-items-center ${hasImg ? "bg-white" : "bg-surface2/60"}`}>
                      {hasImg ? (
                        <img src={p.image_url!} alt={name} loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
                      ) : (
                        <Package size={26} className="text-muted/35" />
                      )}
                      {promo && (
                        <span className="absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-brand text-brandInk inline-flex items-center gap-0.5 shadow-sm"><Tag size={8} />{L("โปร", "Promo", "促销")}</span>
                      )}
                      {out ? (
                        <span className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-danger text-white tnum shadow-sm">{L("หมด", "Out", "缺货")}</span>
                      ) : low ? (
                        <span className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-warn text-white tnum shadow-sm inline-flex items-center gap-0.5"><AlertTriangle size={8} />{qty}</span>
                      ) : null}
                    </div>

                    {/* ชื่อ + ราคา + สต๊อกปกติ */}
                    <p className="text-[11.5px] font-medium leading-snug line-clamp-2 mt-1.5 flex-1">{name}</p>
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <p className="text-sm font-bold tnum">{formatTHB(p.price, false)}</p>
                      {p.is_stocked && !out && !low && <span className="text-[10px] text-muted tnum">{L("เหลือ", "Left", "剩")} {qty}</span>}
                    </div>
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
      <aside className="flex flex-col min-h-0 bg-surface border-l border-line">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <span className="text-sm font-bold flex items-center gap-1.5"><Package size={15} /> {t.pos.cart} {cart.lines.length > 0 && <span className="text-xs font-normal text-muted">({cart.lines.length})</span>}</span>
          <button onClick={() => setCartExpanded((v) => !v)} title={cartExpanded ? L("ย่อตะกร้า", "Collapse cart", "收起购物车") : L("ขยายตะกร้า", "Expand cart", "展开购物车")}
            className="hidden lg:grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface2">
            {cartExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
        <div className="px-4 py-2 border-b border-line space-y-2">
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
              <Avatar name={cart.customerName} size={32} />
              <button onClick={() => setCustomerOpen(true)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold leading-tight truncate">{cart.customerName}</span>
                <span className="block text-[11px] text-muted leading-tight truncate">
                  {cart.customerPhone ? (
                    <span className="inline-flex items-center gap-1"><Phone size={10} />{cart.customerPhone}</span>
                  ) : cart.customerId ? L("สมาชิก", "Member", "会员") : L("แตะเพื่อเปลี่ยน / ค้นหา", "Tap to change / search", "点按更改/搜索")}
                </span>
              </button>
              <button onClick={() => cart.clearCustomer()} className="p-1.5 rounded-lg text-muted hover:text-danger shrink-0" aria-label={L("ล้างลูกค้า", "Clear customer", "清除客户")}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCustomerOpen(true)}
              className="flex items-center gap-2 w-full h-10 px-3 rounded-xl border border-dashed border-line text-muted hover:text-ink hover:border-ink/30 transition-colors text-xs"
            >
              <UserPlus size={15} className="shrink-0" />
              <span className="flex-1 text-left">{L("เลือก / สร้างลูกค้า", "Select / create customer", "选择/创建客户")}</span>
              <ChevronRight size={15} />
            </button>
          )}

          {/* แต้ม/เครดิต + ใช้แต้มเป็นส่วนลด */}
          {cart.customerId && (cart.customerPoints > 0 || cart.customerCredit > 0) && (
            <div className="flex items-center gap-2 rounded-xl bg-surface2/60 border border-line px-2.5 py-1.5">
              <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300 font-semibold">
                <Star size={12} /> {cart.customerPoints.toLocaleString()} {L("แต้ม", "pts", "积分")}
              </span>
              {cart.customerCredit > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-300 font-semibold">
                  <Wallet size={12} /> {formatTHB(cart.customerCredit, false)}
                </span>
              )}
              {cart.customerPoints > 0 && (
                cart.redeemPoints > 0 ? (
                  <button onClick={() => cart.setRedeem(0)} className="ml-auto text-[11px] font-semibold text-danger hover:underline">
                    {L("ยกเลิกใช้แต้ม", "Cancel points", "取消用积分")}
                  </button>
                ) : (
                  <button
                    onClick={() => cart.setRedeem(maxRedeemablePoints(cart.customerPoints, totals.grandTotal))}
                    disabled={!cart.lines.length}
                    className="ml-auto text-[11px] font-semibold text-brand hover:underline disabled:opacity-40"
                  >
                    {L("ใช้แต้ม", "Use points", "使用积分")}
                  </button>
                )
              )}
            </div>
          )}

          {/* คูปอง */}
          {cart.couponCode ? (
            <div className="flex items-center gap-2 rounded-xl bg-ink text-white px-2.5 py-1.5">
              <Ticket size={13} className="shrink-0" />
              <span className="font-mono text-xs font-bold">{cart.couponCode}</span>
              <span className="text-[11px] text-white/70">{L("ลด", "−", "减")} {formatTHB(cart.couponDiscount, false)}</span>
              <button onClick={() => cart.clearCoupon()} className="ml-auto text-white/60 hover:text-white"><X size={13} /></button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* เลือกแคมเปญส่วนลดเป็นการ์ด (พนักงานกดเลือกได้เลย) */}
              {promos.length ? (
                <button onClick={() => setPromoOpen(true)} className="w-full h-9 rounded-xl border border-brand/30 bg-brand/5 text-brand text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-brand/10 transition-colors">
                  <Gift size={14} /> {L("เลือกแคมเปญส่วนลด", "Choose promotion", "选择优惠")} <span className="text-[10px] font-normal opacity-70">({promos.filter(promoRelevant).length})</span>
                </button>
              ) : null}
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Ticket size={13} className="absolute left-2.5 top-2.5 text-muted" />
                  <input
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponMsg(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void applyCoupon(); }}
                    placeholder={L("หรือพิมพ์รหัสคูปอง", "Or type coupon code", "或输入优惠券码")}
                    className="w-full h-8 pl-7 pr-2 rounded-lg bg-surface2/60 border border-line outline-none text-xs font-mono uppercase focus:border-brand/40"
                  />
                </div>
                <button
                  onClick={() => void applyCoupon()} disabled={!couponInput.trim() || couponChecking}
                  className="h-8 px-3 rounded-lg bg-surface2 text-xs font-semibold text-ink hover:bg-surface2/70 disabled:opacity-40"
                >
                  {couponChecking ? "…" : L("ใช้", "Apply", "使用")}
                </button>
              </div>
              {couponMsg && <p className="text-[11px] text-danger px-1">{couponMsg}</p>}
            </div>
          )}
        </div>

        {giftWarns.length > 0 && (
          <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-danger/8 border border-danger/30 text-[11px] text-danger space-y-0.5">
            {giftWarns.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5"><AlertTriangle size={11} className="shrink-0" />{w}</div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {cart.lines.length ? (
            <ul className="divide-y divide-line">
              {cart.lines.map((l) => {
                const total = lineTotal(l);
                const serialMissing = l.track_serial && l.serials.length < l.qty;
                const isCampaignGift = l.gift_source === "campaign";
                return (
                  <li key={l.lineId} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="w-11 h-11 rounded-lg border border-line bg-surface2 grid place-items-center overflow-hidden shrink-0">
                        {l.image_url ? <img src={l.image_url} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Package size={16} className="text-muted/50" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug line-clamp-2">
                          {l.name}
                          {l.is_gift && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-ink text-surface align-middle inline-flex items-center gap-0.5"><Gift size={9} />{l.gift_source === "campaign" ? L("ของแถมแคมเปญ", "Campaign gift", "活动赠品") : L("ของแถม", "Gift", "赠品")}</span>}
                        </p>
                        <p className="text-[10px] font-mono text-muted mt-0.5">{l.sku}</p>
                      </div>
                      {!isCampaignGift && (
                        <button onClick={() => cart.removeLine(l.lineId)} className="text-muted hover:text-danger p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      {isCampaignGift ? (
                        <div className="h-8 px-3 flex items-center rounded-lg border border-line bg-surface2/50 text-sm font-medium tnum">×{l.qty}</div>
                      ) : (
                        <div className="flex items-center rounded-lg border border-line">
                          <button onClick={() => cart.setQty(l.lineId, l.qty - 1)} className="w-8 h-8 grid place-items-center text-muted hover:text-ink">
                            <Minus size={13} />
                          </button>
                          <span className="w-9 text-center text-sm font-medium tnum">{l.qty}</span>
                          <button onClick={() => cart.setQty(l.lineId, l.qty + 1)} className="w-8 h-8 grid place-items-center text-muted hover:text-ink">
                            <Plus size={13} />
                          </button>
                        </div>
                      )}

                      {/* ของแถม: สลับเป็น/ออก (เฉพาะของแถมที่พนักงานทำเอง ไม่ใช่ของแคมเปญ) */}
                      {!isCampaignGift && (
                        <button
                          onClick={() => cart.toggleGift(l.lineId)}
                          title={l.is_gift ? L("ยกเลิกของแถม", "Remove gift", "取消赠品") : L("ทำเป็นของแถม (฿0)", "Make gift (฿0)", "设为赠品(฿0)")}
                          className={`h-8 px-2 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 ${
                            l.is_gift ? "border-ink bg-ink text-surface" : "border-line text-muted hover:text-ink"
                          }`}
                        >
                          <Gift size={12} />
                        </button>
                      )}

                      {!l.is_gift && (
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
                      )}

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
              <span className="text-muted flex items-center gap-1"><Ticket size={11} className="text-ink" /> {L("คูปอง", "Coupon", "优惠券")} {cart.couponCode}</span>
              <span className="tnum text-danger">-{formatTHB(totals.couponAmount)}</span>
            </div>
          )}
          {totals.redeemAmount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted flex items-center gap-1"><Star size={11} className="text-amber-500" /> {L("ใช้แต้ม", "Points", "用积分")} ({cart.redeemPoints})</span>
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
          <div className="flex items-center justify-between gap-2 px-0.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
              <input type="checkbox" checked={reserveMode} onChange={(e) => setReserveMode(e.target.checked)} className="w-4 h-4 accent-[rgb(var(--c-brand))]" />
              <span className={reserveMode ? "text-brand font-medium" : "text-muted"}>{L("ส่งทีหลัง (จองของ)", "Deliver later (reserve)", "延后交付")}</span>
            </label>
            <button onClick={() => setResvOpen(true)} className="text-xs text-muted hover:text-brand inline-flex items-center gap-1">{L("ออเดอร์จอง", "Reserved", "预留单")}{resvOrders.length ? <span className="min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-brand/15 text-brand text-[10px] font-bold">{resvOrders.length}</span> : null}</button>
          </div>
          <Button
            variant="ok"
            className={`w-full h-14 text-base ${reserveMode ? "!bg-brand hover:!bg-brand-hover" : ""}`}
            disabled={!cart.lines.length}
            onClick={() => setPayOpen(true)}
          >
            {reserveMode ? L("รับเงิน + จองของ", "Pay + reserve", "收款+预留") : t.pos.pay} · {formatTHB(totals.grandTotal)}
          </Button>
          <p className="text-[10px] text-muted text-center">{reserveMode ? L("โหมดจอง: จองสต๊อกไว้ ส่งมอบทีหลัง (ไม่ตัด On Hand จนส่งมอบ)", "Reserve mode: stock held, deliver later", "预留模式") : L("F2 = ชำระเงิน · F4 = พักบิล · / = ค้นหา", "F2 = Pay · F4 = Hold · / = Search", "F2 = 收款 · F4 = 挂单 · / = 搜索")}</p>
        </div>
      </aside>

      {/* ================= Modals ================= */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        grandTotal={totals.grandTotal}
        busy={busy}
        onConfirm={(p, paid, change) => void confirmSale(p, paid, change)}
        onDisplaySync={(info) => pushDisplay({ state: "payment", ...displayBase(), payMethod: info.method, payMethodLabel: info.methodLabel, payQr: info.qr, amountDue: info.amountDue })}
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
        onSave={async (serials) => {
          if (!serialLineId) { setSerialLineId(null); return; }
          // จอง SN กลาง: กันขายเครื่องที่กำลังอยู่ระหว่างโอน หรือขายไปแล้ว
          const ok: string[] = [];
          for (const sn of serials) {
            const info = await resolveSerial(sn);
            if (info.status === "in_transit") { toast.push({ tone: "danger", title: L(`SN ${sn} กำลังอยู่ระหว่างโอน — ขายไม่ได้`, `SN ${sn} is in transit — cannot sell`, `${sn} 在途中，不能售出`) }); continue; }
            if (info.status === "sold") { toast.push({ tone: "danger", title: L(`SN ${sn} ขายออกไปแล้ว`, `SN ${sn} already sold`, `${sn} 已售出`) }); continue; }
            ok.push(sn);
          }
          cart.setLineSerials(serialLineId, ok);
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

      <ReceiptPreview
        order={lastOrder}
        branch={branch}
        cashier={employee}
        company={COMPANY}
        logoUrl={brandLogo}
        pointsEarned={lastOrder?.customer_id ? Math.floor(lastOrder.grand_total / 20) : 0}
        printStatus={printStatus}
        printError={printError}
        canOpenDrawer={can(employee, "pos.open_drawer")}
        onPrint={() => lastOrder && void doPrint(lastOrder)}
        onBrowserPrint={() => window.print()}
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

      {/* ออเดอร์จอง (ส่งทีหลัง) — ส่งมอบ / ยกเลิก */}
      <Modal open={resvOpen} onClose={() => setResvOpen(false)} title={L("ออเดอร์จอง (ส่งทีหลัง)", "Reserved orders", "预留单")} size="md">
        {resvOrders.length ? (
          <ul className="space-y-2">
            {resvOrders.map((o) => {
              const delivered: Record<string, number> = {};
              for (const d of o.deliveries ?? []) for (const l of d.lines) delivered[l.product_id] = (delivered[l.product_id] ?? 0) + l.qty;
              const outstanding = o.items.reduce((s, it) => s + (it.product_id ? Math.max(0, it.qty - (delivered[it.product_id] ?? 0)) : 0), 0);
              const exp = o.reserve_expires_at ? new Date(o.reserve_expires_at) : null;
              const soon = exp && exp.getTime() - Date.now() < 2 * 86400000;
              return (
                <li key={o.id} className="border border-line rounded-xl px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{o.order_no} {o.fulfillment === "partial" ? <Badge tone="warn">{L("ส่งบางส่วน", "Partial", "部分")}</Badge> : <Badge tone="brand">{L("จองไว้", "Reserved", "预留")}</Badge>}</p>
                      <p className="text-[11px] text-muted truncate">{o.customer_name || L("ลูกค้าทั่วไป", "Walk-in", "顾客")} · {o.items.length} {L("รายการ", "items", "项")} · {L("ค้างส่ง", "to deliver", "待交")} {outstanding} · {formatTHB(o.grand_total, false)}</p>
                      {exp ? <p className={`text-[10px] ${soon ? "text-rose-600" : "text-muted"}`}>{L("หมดอายุจอง", "Expires", "到期")} {exp.toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short" })}</p> : null}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button variant="ghost" onClick={() => void doCancelResv(o)}>{L("ยกเลิก", "Cancel", "取消")}</Button>
                      <Button variant="primary" onClick={() => void doDeliver(o)}>{L("ส่งมอบ", "Deliver", "交付")}</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState title={L("ไม่มีออเดอร์จอง", "No reserved orders", "无预留单")} />}
      </Modal>

      {/* เลือกแคมเปญส่วนลด (การ์ด) */}
      <Modal open={promoOpen} onClose={() => setPromoOpen(false)} title={L("เลือกแคมเปญส่วนลด", "Choose promotion", "选择优惠")} size="md">
        {/* สลับ: เฉพาะที่เข้ากับตะกร้า ↔ ภาพรวมทั้งหมด */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <p className="text-[11px] text-muted">{promoShowAll ? L("ทุกแคมเปญ", "All promotions", "全部") : L("ตรงกับสินค้าในตะกร้า", "Matches your cart", "匹配购物车")}</p>
          <button onClick={() => setPromoShowAll((v) => !v)} className="text-[11px] font-semibold text-brand hover:underline">
            {promoShowAll ? L("← เฉพาะในตะกร้า", "← Cart only", "← 仅购物车") : L("ดูภาพรวมทั้งหมด →", "See all →", "全部 →")}
          </button>
        </div>
        <div className="space-y-2.5">
          {(promoShowAll ? promos : promos.filter(promoRelevant)).map((p) => {
            const amt = promoAmt(p);
            const inCart = promoRelevant(p);
            const ok = amt > 0;
            const isPct = p.type === "percent";
            return (
              <button key={p.id} onClick={() => applyPromo(p)} disabled={!ok}
                className={`group relative w-full flex items-stretch rounded-[18px] overflow-hidden text-left bg-surface border border-line transition-all ${ok ? "hover:-translate-y-0.5 hover:shadow-card hover:border-ink/30" : "opacity-55 grayscale"}`}>
                {/* รอยปรุตั๋ว (วงเว้าขอบบน-ล่าง = พื้นโมดัล) */}
                <span aria-hidden className="absolute left-[92px] -top-2 w-4 h-4 rounded-full bg-surface border border-line" />
                <span aria-hidden className="absolute left-[92px] -bottom-2 w-4 h-4 rounded-full bg-surface border border-line" />
                {/* กราฟิกคูปอง (ไม่ใช่รูปสินค้า) */}
                <div className="w-[92px] shrink-0 grid place-items-center p-2 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg,#7950D8,#22d3ee)" }}>
                  <span aria-hidden className="absolute -right-5 -top-5 w-14 h-14 rounded-full bg-white/10" />
                  <span aria-hidden className="absolute -left-4 -bottom-4 w-12 h-12 rounded-full bg-white/10" />
                  <div className="relative text-center">
                    {p.value === 0 ? <Gift size={22} className="mx-auto" /> : isPct ? <Percent size={18} className="mx-auto mb-0.5" /> : <Ticket size={18} className="mx-auto mb-0.5" />}
                    <div className="text-[17px] font-extrabold leading-none tnum">{p.value === 0 ? L("แถม", "GIFT", "赠") : isPct ? `${p.value}%` : `฿${formatTHB(p.value, false)}`}</div>
                    <div className="text-[7.5px] font-bold tracking-[0.15em] opacity-85 mt-1">COUPON</div>
                  </div>
                </div>
                {/* เส้นปรุแนวตั้ง */}
                <div aria-hidden className="self-stretch my-3 border-l-2 border-dashed border-line" />
                {/* เนื้อหา */}
                <div className="flex-1 min-w-0 p-3 text-ink flex flex-col justify-center">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[15px] leading-tight truncate">{p.name}</p>
                      {p.desc ? <p className="text-[11px] text-muted leading-snug truncate">{p.desc}</p> : null}
                    </div>
                    <span className="shrink-0 text-lg font-extrabold tnum">{p.type === "percent" ? `−${p.value}%` : `−${formatTHB(p.value, false)}`}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="text-[10.5px] text-muted">{p.min_spend > 0 ? L(`ขั้นต่ำ ${formatTHB(p.min_spend, false)}`, `Min ${formatTHB(p.min_spend, false)}`, `满${formatTHB(p.min_spend, false)}`) : L("ไม่มีขั้นต่ำ", "No minimum", "无门槛")}</span>
                    <span className={`shrink-0 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${ok ? "bg-ink text-white" : "bg-surface2 text-muted border border-line"}`}>{ok ? `${L("ลด", "−", "减")} ${formatTHB(amt, false)}` : (!inCart && p.target_skus.length ? L("ไม่มีในตะกร้า", "Not in cart", "篮内无") : L("ยอดไม่ถึง", "Below min", "未达"))}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {!(promoShowAll ? promos : promos.filter(promoRelevant)).length ? <EmptyState title={L("ไม่มีแคมเปญที่ตรงกับตะกร้า", "No matching promotion", "无匹配优惠")} body={L("กด “ดูภาพรวมทั้งหมด” เพื่อดูทุกแคมเปญ", "Tap “See all” for all promotions", "点查看全部")} /> : null}
        <p className="text-[11px] text-muted mt-3 text-center">{L("ยอดบิลปัจจุบัน", "Current subtotal", "当前小计")} {formatTHB(totals.subtotal, false)}</p>
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
