"use client";

import { useCatalogProducts } from "@/lib/hooks/use-catalog-products";
import { isLiveMode } from "@/lib/supabase/client";
import { IntegrationNotice } from "@/components/pos/integration-notice";

// หน้า admin — ติดตาม/อนุมัติใบโอนย้ายทุกสาขา (ใช้ engine + ดีไซน์เดียวกับ /pos/transfers)
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import { ArrowLeftRight, Plus, Trash2, Check, X, Clock, Barcode, CircleAlert, Printer, ScanLine, Truck, PackageCheck, Upload, FileText, Boxes, ChevronRight, ChevronLeft, RotateCcw, Share2, Link as LinkIcon, ExternalLink, FileDown, Download, Copy, Home, MapPin, CornerDownRight, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listProducts, listEmployees, stockAll } from "@/lib/data/repo";
import { availableQty, stockView } from "@/lib/stock";
import { coordOf, haversineKm, fmtKm } from "@/lib/geo";
import { resolveSerial, locateSerial } from "@/lib/data/serials";
import { listApprovalRules, resolveApprovers, type ApprovalRule } from "@/lib/data/approval-rules";
import {
  owListAll, owCreate, owApprove, owReject, owReverse, owGet, owTimelineFor,
  owScanOut, owDispatch, owReceive, owCloseShort, owRecordDisc, owRequestResolveDisc, owResolveDisc, owCarriers, owSetAttachments, owShipStage, owSetPickupStage,
  owOpenReturn, owRequestReturnApproval, owApproveReturn, owCancelReturn, owDispatchReturn, owSetReturnShipStage, owReceiveReturnLines, owCloseReturn, owPackReturn, owMarkReplacement,
  reconcileSerials, statusMeta, isActive, isIssue, owErrorMessage, owResume, owRefresh,
} from "@/lib/onewarehouse";
import { TransferStepper, ItemJourney, TransferTimeline } from "@/components/admin/transfer-ui";
import { SerialScanDrawer } from "@/components/admin/serial-scan-drawer";
import { printTransferCO } from "@/lib/transfer/print-co";
import { TransferDocsButton } from "@/components/transfer-docs-button";
import { AiBrief } from "@/components/ai-brief";
import type { Branch, Product, Transfer, TransferStatus, TransferAttachment, AuditEntry, Employee, StockLevel, SerialLocated } from "@/lib/types";
import { Button, Card, Input, Field, Select, Table, Th, Td, Badge, EmptyState, Drawer, DrawerTabs, DetailRow, Avatar } from "@/components/ui";
import { can, visibleBranchIds, ROLE_LABEL, isSuperadmin } from "@/lib/permissions";

type Tab = "overview" | "timeline";
type ShipStage = NonNullable<Transfer["ship_stage"]>;
const SHIP_STAGES: { key: ShipStage; th: string; en: string; zh: string }[] = [
  { key: "requested", th: "เรียกรถแล้ว", en: "Pickup requested", zh: "已叫车" },
  { key: "picked_up", th: "รถรับของแล้ว", en: "Picked up", zh: "已取货" },
  { key: "in_delivery", th: "กำลังจัดส่ง", en: "In delivery", zh: "配送中" },
  { key: "arrived", th: "ถึงปลายทาง", en: "Arrived", zh: "已到达" },
];

export default function AdminTransfersPage() {
  const { t, locale, pick } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const toast = useToast();
  const { employee, branchId: sessionBranchId } = useSession();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useCatalogProducts();
  const [list, setList] = useState<Transfer[]>([]);
  const [bucket, setBucket] = useState<"mine" | "overdue" | "active" | "issue" | "done" | "all">("active");
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [timeline, setTimeline] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  // สแกน SN (out/in) + จัดส่ง
  const [scanned, setScanned] = useState<Record<string, string[]>>({});
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([]);
  const [carrier, setCarrier] = useState("");
  const [scan, setScan] = useState<{ pid: string; mode: "out" | "in" } | null>(null);
  const [retScan, setRetScan] = useState<{ retId: string; pid: string; name: string; expected: string[]; initial: string[]; mode: "pack" | "recv" } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rules, setRules] = useState<ApprovalRule[]>([]); // สายอนุมัติที่ตั้งไว้ (ตามแบรนด์/สาขา)
  const [approveNote, setApproveNote] = useState("");
  const [lbIdx, setLbIdx] = useState<number | null>(null); // lightbox รูปแนบ
  // โหมดจริง: ไฟล์แนบเก็บบน Storage ส่วนตัว (/api/pos/transfer-files) · โหมดสาธิต: data URL ในเครื่อง
  const [srvFiles, setSrvFiles] = useState<TransferAttachment[] | null>(null), [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<"" | "img" | "link">("");
  const [shareOpen, setShareOpen] = useState(false); // เมนูแชร์ฟอร์ม
  const [repOpen, setRepOpen] = useState(false); // ฟอร์มแจ้งของมีปัญหา (พักตรวจ)
  const [repPid, setRepPid] = useState(""); const [repQty, setRepQty] = useState(1); const [repKind, setRepKind] = useState<"damaged" | "wrong_sn" | "lost">("damaged");
  const [repSn, setRepSn] = useState("");  // SN ที่เลือกแจ้งปัญหา (สินค้ามี SN)
  const [packSns, setPackSns] = useState<Record<string, string[]>>({}); // SN ที่สแกนแพ็คส่งคืน (รายบรรทัด)
  const [retTracking, setRetTracking] = useState(""); // เลขติดตามขาส่งคืน
  const [openQty, setOpenQty] = useState<Record<string, number>>({});      // จำนวนที่เลือกส่งคืน (รายผลต่าง)
  const [retLineQty, setRetLineQty] = useState<Record<string, number>>({});  // จำนวนที่รับคืนจริง (รายบรรทัดใบส่งคืน)
  // create
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<{ id: string; product_id: string; qty: number; serials: string[] }[]>([]);
  const [pickId, setPickId] = useState("");
  const [addQ, setAddQ] = useState(""); // ช่องค้นหา/สแกน: พิมพ์ชื่อ หรือ ยิงบาร์โค้ด/SN
  const [note, setNote] = useState("");
  const [createScan, setCreateScan] = useState<string | null>(null); // lineId ที่กำลังสแกนตอนเปิดบิล
  // คำขอสินค้าเข้าสาขา (destination-initiated): เลือกสินค้า → แนะนำสาขาที่มีของ+ใกล้สุด → ส่งคำขอ
  const [reqOpen, setReqOpen] = useState(false);
  const [reqDest, setReqDest] = useState("");
  const [reqQ, setReqQ] = useState("");
  const [reqProductId, setReqProductId] = useState("");
  const [reqSource, setReqSource] = useState("");
  const [reqQty, setReqQty] = useState(1);
  const [stock, setStock] = useState<StockLevel[]>([]);

  async function reload() { setList(await owListAll()); }
  useEffect(() => {
    void (async () => {
      const [b, p, c, e, st, ar] = await Promise.all([listBranches(), listProducts(), owCarriers(), listEmployees(), stockAll(), listApprovalRules()]);
      setBranches(b); setProducts(p); setCarriers(c); setEmployees(e); setStock(st); setRules(ar);
      // ต้นทางเริ่มต้น = สาขาปัจจุบัน (ถ้าเป็นสาขาจริง) ไม่งั้นสาขาจริงแรก — เลี่ยง default เป็นคลัง (สต๊อก 0)
      const real = b.filter((x) => x.branch_type !== "warehouse");
      const defFrom = sessionBranchId && b.some((x) => x.id === sessionBranchId && x.branch_type !== "warehouse") ? sessionBranchId : (real[0]?.id ?? b[0]?.id ?? "");
      setFrom(defFrom); setTo((real.find((x) => x.id !== defFrom) ?? b.find((x) => x.id !== defFrom))?.id ?? "");
      await reload();
    })();
  }, []);
  // เปิดเอกสาร → เตรียม state สแกนตามสถานะ (≤packed=สแกนออก, in_transit=สแกนรับ)
  useEffect(() => {
    setTab("overview"); setCarrier(""); setApproveNote("");
    if (!detail) { setScanned({}); setRecvQty({}); return; }
    void owTimelineFor(detail).then(setTimeline);
    const receiving = ["in_transit", "partial_received"].includes(detail.status); // รับหลายรอบ
    const sc: Record<string, string[]> = {}; const rq: Record<string, string> = {};
    for (const it of detail.items) {
      if (it.isSerialized) sc[it.product_id] = (receiving ? it.receivedSerials : it.shippedSerials)?.map((s) => s.serialNo) ?? [];
      else rq[it.product_id] = String(receiving ? Math.max(0, (it.qty_shipped || it.qty_requested) - (it.qty_received || 0)) : it.qty_requested); // คงเหลือที่ยังไม่รับ
    }
    setScanned(sc); setRecvQty(rq);
  }, [detail]);

  // ── sync เอกสารที่เปิด ↔ URL (?doc=) เพื่อให้แท็บจำ/กลับมาเปิดเอกสารเดิม ──
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  // เปิด/ปิดเอกสาร = ตั้ง ?doc ใน URL ด้วย (แท็บจำ/กลับมาเปิดเอกสารเดิมได้)
  const openDoc = (tr: Transfer) => { setDetail(tr); router.replace(`${pathname}?doc=${encodeURIComponent(tr.transfer_no)}`, { scroll: false }); };
  const closeDoc = () => { setDetail(null); router.replace(pathname, { scroll: false }); };
  const docParam = sp.get("doc");
  useEffect(() => {
    if (docParam) {
      if ((!detail || detail.transfer_no !== docParam) && list.length) {
        const tr = list.find((x) => x.transfer_no === docParam); if (tr) setDetail(tr);
      }
    } else if (detail) setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docParam, list]);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  // "รอฉันทำ" — ใบที่ขั้นปัจจุบันเป็นหน้าที่ของคนนี้ (อนุมัติ/สแกนออก/จัดส่ง = ต้นทาง · รับเข้า = ปลายทาง)
  const needsMyAction = (tr: Transfer): boolean => {
    const src = allowed.includes(tr.from_branch_id), dst = allowed.includes(tr.to_branch_id);
    const cOut = can(employee, "transfer.request") || can(employee, "transfer.approve");
    const cRecv = can(employee, "transfer.receive") || can(employee, "transfer.approve");
    if (tr.status === "pending_approval") return src && can(employee, "transfer.approve");
    if (["approved", "picking", "packed"].includes(tr.status)) return src && cOut;
    if (tr.status === "in_transit") return dst && cRecv;
    return false;
  };
  // มีผลต่างที่ยังไม่ปิด (รอตรวจสอบ/รออนุมัติ) — ใบที่ปิดรับแล้วแต่ปัญหายังค้าง ก็ถือว่า "มีปัญหา"
  const hasOpenDisc = (tr: Transfer): boolean => (tr.discrepancies ?? []).some((d) => d.status !== "resolved") || (tr.returns ?? []).some((r) => r.status !== "received");
  const mineCount = useMemo(() => list.filter((x) => (allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id)) && needsMyAction(x)).length, [list, allowed, employee]); // eslint-disable-line react-hooks/exhaustive-deps
  const issueCount = useMemo(() => list.filter((x) => (allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id)) && (isIssue(x.status) || hasOpenDisc(x))).length, [list, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  // งานค้างเกินเวลา (SLA): ใบ active ที่ค้างในสถานะนานผิดปกติ (อิงอายุใบ vs เพดานต่อสถานะ)
  const SLA_HOURS: Record<string, number> = { pending_approval: 24, approved: 48, picking: 48, packed: 48, shipped: 72, in_transit: 72, partial_received: 72 };
  const overdueInfo = (tr: Transfer): { over: boolean; days: number } | null => {
    const limitH = SLA_HOURS[tr.status]; if (limitH === undefined) return null;
    const hrs = (Date.now() - new Date(tr.created_at).getTime()) / 3600000;
    return { over: hrs > limitH, days: Math.floor(hrs / 24) };
  };
  const overdueCount = useMemo(() => list.filter((x) => (allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id)) && overdueInfo(x)?.over).length, [list, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  const bName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id; };

  // ── คำขอสินค้าเข้าสาขา: เลือกสินค้า → แนะนำสาขาที่มีของ เรียงใกล้สุด → ส่งคำขอ (สร้าง transfer source→dest, รออนุมัติต้นทาง) ──
  const stockMap = useMemo(() => { const m = new Map<string, StockLevel>(); for (const s of stock) m.set(`${s.branch_id}:${s.product_id}`, s); return m; }, [stock]);
  const availAt = (bid: string, pid: string) => { const s = stockMap.get(`${bid}:${pid}`); return s ? availableQty(s) : 0; };
  const viewAt = (bid: string, pid: string) => stockView(stockMap.get(`${bid}:${pid}`));
  const reqProduct = products.find((p) => p.id === reqProductId) || null;
  const reqSources = useMemo(() => {
    if (!reqProductId || !reqDest) return [] as { b: Branch; avail: number; km: number | null }[];
    const dest = branches.find((b) => b.id === reqDest);
    const dc = coordOf(dest); const seen = new Set<string>();
    return branches
      .filter((b) => b.id !== reqDest && b.is_active && !seen.has(b.id) && (seen.add(b.id), true))
      .map((b) => { const bc = coordOf(b); return { b, avail: availAt(b.id, reqProductId), km: dc && bc ? haversineKm(dc, bc) : null }; })
      .filter((x) => x.avail > 0)
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || b.avail - a.avail);
  }, [reqProductId, reqDest, branches, stockMap]); // eslint-disable-line react-hooks/exhaustive-deps

  function openRequest(destId?: string, productId?: string) {
    const dest = destId || sessionBranchId || employee?.home_branch_id || allowed[0] || branches[0]?.id || "";
    setReqDest(dest); setReqProductId(productId || ""); setReqQ(""); setReqSource(""); setReqQty(1); setReqOpen(true);
  }
  async function submitRequest() {
    if (!employee || !reqProduct || !reqSource || !reqDest || reqSource === reqDest || reqQty < 1) return;
    const srcB = branches.find((b) => b.id === reqSource);
    setBusy(true);
    try {
      // คำขอ = โอนจาก source → dest แบบ "รออนุมัติ" (ต้นทางต้องกดอนุมัติก่อน) — ไม่ auto-approve
      await owCreate(reqSource, reqDest, employee.id, [{ product_id: reqProduct.id, sku: reqProduct.sku, name: reqProduct.name_th, qty: reqQty, isSerialized: !!reqProduct.track_serial }], L(`คำขอจาก ${bName(reqDest)}`, `Request from ${bName(reqDest)}`, `申请`), false, srcB?.branch_type === "warehouse" ? "warehouse" : "branch");
      setReqOpen(false); await reload();
      toast.push({ tone: "ok", title: L("ส่งคำขอแล้ว — รอต้นทางอนุมัติ", "Request sent — awaiting source approval", "已发送申请") });
    } catch (e) {
      toast.push({ tone: "danger", title: owErrorMessage(e instanceof Error ? e.message : "error", locale) });
    } finally { setBusy(false); }
  }
  const sMeta = (s: Transfer["status"]) => statusMeta(s, locale);
  // ใบโอนนี้มีของขาด (รับน้อยกว่าที่ส่ง) ไหม
  const hasShortage = (tr: Transfer) => tr.items.some((it) => (it.qty_received || 0) < (it.qty_shipped || it.qty_requested || 0));
  // สถานะใบโอนสำหรับแสดงผล — แยก "ปิดรับโดยมีส่วนขาด" ออกจาก "เสร็จสิ้น · รับครบ"
  const displayStatus = (tr: Transfer): { tone: ReturnType<typeof sMeta>["tone"]; label: string } => {
    if (tr.status === "completed" && hasShortage(tr)) return { tone: "warn", label: L("ปิดรับโดยมีส่วนขาด", "Closed with shortage", "结单·有缺量") };
    if (tr.status === "completed") return { tone: "ok", label: L("เสร็จสิ้น · รับครบ", "Completed · full", "已完成·齐") };
    return sMeta(tr.status);
  };

  const visible = useMemo(() => list
    .filter((x) => allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id))
    .filter((x) => bucket === "all" ? true : bucket === "mine" ? needsMyAction(x) : bucket === "overdue" ? !!overdueInfo(x)?.over : bucket === "active" ? isActive(x.status) : bucket === "issue" ? (isIssue(x.status) || hasOpenDisc(x)) : x.status === "completed"),
    [list, allowed, bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  // เพิ่มสินค้าเข้าบิล (รวม line เดิมถ้ามี; serialized + มี SN → แนบ SN กันซ้ำ)
  function addLine(productId: string, sn?: string) {
    const p = products.find((x) => x.id === productId); if (!p) return;
    const snU = sn?.trim().toUpperCase();
    setLines((l) => {
      const ex = l.find((x) => x.product_id === productId);
      if (ex && p.track_serial && snU) {
        if (ex.serials.includes(snU)) return l;
        return l.map((x) => x.id === ex.id ? { ...x, serials: [...x.serials, snU], qty: x.serials.length + 1 } : x);
      }
      if (ex && !p.track_serial) return l.map((x) => x.id === ex.id ? { ...x, qty: x.qty + 1 } : x);
      return [...l, { id: nanoid(), product_id: productId, qty: 1, serials: snU && p.track_serial ? [snU] : [] }];
    });
  }
  // ค้นหา/สแกน: บาร์โค้ด/SKU ตรง → เพิ่ม · ไม่งั้นลองเป็น SN → รู้ว่าสินค้าอะไร + แนบ SN
  async function addByCode(raw: string) {
    const code = raw.trim(); if (!code) return;
    const up = code.toUpperCase();
    const byCode = products.find((p) => p.is_stocked && (p.sku.toUpperCase() === up || (p.barcodes ?? []).some((b) => String(b).toUpperCase() === up)));
    if (byCode) { addLine(byCode.id); setAddQ(""); return; }
    const info = await resolveSerial(code);
    if (info.product?.id || info.product?.sku) {
      const p = products.find((x) => x.id === info.product!.id) || products.find((x) => x.sku === info.product!.sku);
      if (p) {
        // ── จอง SN กลาง: กันเครื่องเดียวถูกโอน/ขายซ้ำ ──
        if (info.status === "sold") { setAddQ(""); return void toast.push({ tone: "danger", title: L(`SN นี้ขายออกไปแล้ว${info.soldInfo?.orderNo ? ` · ${info.soldInfo.orderNo}` : ""}`, "This SN is already sold", "该SN已售出") }); }
        if (info.status === "in_transit") { setAddQ(""); return void toast.push({ tone: "danger", title: L("SN นี้กำลังอยู่ระหว่างโอนในใบอื่นแล้ว", "This SN is already in transit", "该SN已在途") }); }
        if (p.track_serial && lines.find((x) => x.product_id === p.id)?.serials.includes(up)) { setAddQ(""); return void toast.push({ tone: "warn", title: L("SN นี้อยู่ในบิลนี้แล้ว", "SN already in this bill", "已在单中") }); }
        if (p.track_serial && info.status === "in_stock" && info.currentBranchId && info.currentBranchId !== from) { toast.push({ tone: "warn", title: L(`⚠ SN นี้อยู่ที่ ${bName(info.currentBranchId)} ไม่ใช่ต้นทาง — ตรวจสอบ`, `SN is at ${bName(info.currentBranchId)}, not source`, "不在源店") }); }
        addLine(p.id, p.track_serial ? code : undefined);
        setAddQ(""); toast.push({ tone: "ok", title: L(`เพิ่ม ${p.name_th}${p.track_serial ? ` · SN ${up}` : ""}`, `Added ${p.name_th}`, "已添加") }); return;
      }
    }
    toast.push({ tone: "warn", title: L("ไม่พบสินค้าจากรหัส/SN นี้", "No product for this code/SN", "未找到") });
  }
  // รายการที่ตรงกับคำค้น (ชื่อ/SKU/บาร์โค้ด) สำหรับ dropdown
  const addMatches = useMemo(() => {
    const q = addQ.trim().toLowerCase(); if (!q) return [] as Product[];
    return products.filter((p) => p.is_stocked && (p.name_th.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcodes ?? []).some((b) => String(b).toLowerCase().includes(q)))).slice(0, 8);
  }, [addQ, products]);

  async function create() {
    if (!employee || !from || !to || from === to || !lines.length) return;
    setBusy(true);
    try {
      const ls = lines
        .map((l) => { const p = products.find((x) => x.id === l.product_id)!; const serialized = !!p.track_serial; return { product_id: p.id, sku: p.sku, name: p.name_th, qty: serialized ? l.serials.length : l.qty, isSerialized: serialized, serials: serialized ? l.serials : undefined }; })
        .filter((l) => l.qty > 0);
      if (!ls.length) { toast.push({ tone: "warn", title: L("เพิ่มสินค้า/สแกน SN อย่างน้อย 1 ชิ้น", "Add at least 1 item / scan a SN", "至少添加/扫描 1 件") }); return; }
      // auto-approve ถ้าผู้สร้างมีสิทธิ์อนุมัติ หรือเป็นคนในสายอนุมัติที่ตั้งไว้ของสาขาต้นทาง
      const cfg = resolveApprovers(rules, { process: "transfer", branchId: from, brandId: branches.find((b) => b.id === from)?.brand_id ?? null });
      const auto = isSuperApprover(employee) || (cfg ? cfg.includes(employee.id) : can(employee, "transfer.approve"));
      // ต้นทางเป็นคลัง (warehouse) → OneWarehouse จัดการยอดฝั่งนั้น (ข้ามจอง/ตรวจ Available ของสาขา)
      const fromKind = branches.find((b) => b.id === from)?.branch_type === "warehouse" ? "warehouse" : "branch";
      // ตรวจของพร้อมโอนที่ต้นทางก่อน — แจ้งชัดว่าสินค้าไหนไม่พอ (กันเด้ง error รวม ๆ)
      if (fromKind === "branch") {
        const need: Record<string, { name: string; qty: number }> = {};
        for (const l of ls) { const e = (need[l.product_id] ??= { name: l.name, qty: 0 }); e.qty += l.qty; }
        const short = Object.entries(need).filter(([pid, v]) => v.qty > availAt(from, pid))
          .map(([pid, v]) => `${v.name} (${L("พร้อม", "avail", "可")} ${availAt(from, pid)} / ${L("ขอ", "req", "需")} ${v.qty})`);
        if (short.length) { toast.push({ tone: "danger", title: L(`สต๊อก “${bName(from)}” ไม่พอโอน`, "Source stock not enough", "源店库存不足"), body: short.join(" · ") }); return; }
      }
      await owCreate(from, to, employee.id, ls, note, auto, fromKind);
      setOpen(false); setLines([]); setNote(""); await reload();
      toast.push({ tone: "ok", title: t.transfer.title });
    } catch (e) {
      toast.push({ tone: "danger", title: owErrorMessage(e instanceof Error ? e.message : "error", locale) });
    } finally { setBusy(false); }
  }
  async function act(fn: () => Promise<Transfer>, okTitle: string) {
    if (!employee) return; setBusy(true);
    try { const next = await fn(); await reload(); setDetail(next); toast.push({ tone: "ok", title: okTitle }); }
    catch (e) {
      const code = e instanceof Error ? e.message : "error";
      toast.push({ tone: "danger", title: owErrorMessage(code, locale) });
      if (code === "transfer_version_conflict" && detail) { await reload(); const fr = await owGet(detail.id); if (fr) setDetail(fr); }
    }
    finally { setBusy(false); }
  }

  // แปลง actor id → พนักงานจริง (ซิงก์จาก Lark: ชื่อเต็ม + รูป)
  //   id ตรงพนักงาน → คนนั้น; id ชั่วคราว/เดโม่ (เช่น demo-owner) → แม็พเป็นพนักงานจริงที่สมเหตุผลตามบทบาท/สาขา (คงที่ต่อใบ)
  const empByBranch = (bid?: string | null) => employees.filter((e) => e.status === "active" && (e.home_branch_id === bid || (e.branch_ids ?? []).includes(bid ?? "")));
  // "ฉัน" = ผู้ใช้ปัจจุบัน (ถ้าอยู่ใน Lark) ไม่งั้นจับคู่ชื่อ Tiw — ไว้ใช้เป็นคนทำในเดโม่
  const meEmp = useMemo(() => employees.find((e) => e.id === employee?.id) || employees.find((e) => /\btiw\b/i.test(`${e.nickname ?? ""} ${e.first_name ?? ""}`)) || null, [employees, employee]);
  const actorEmp = (id?: string | null, kind: "requester" | "approver" | "source" | "dest" = "source", tr?: Transfer): Employee | null => {
    if (id) { const real = employees.find((e) => e.id === id); if (real) return real; } // id จริง → คนนั้น
    // โหมดจริง: ไม่รู้ว่าใครทำ = ไม่แสดงชื่อ (ห้ามสุ่มคนในสาขามาแสดงเป็นผู้ทำ — ข้อมูลเท็จบนเอกสารจริง)
    if (isLiveMode()) return null;
    if (!employees.length) return null;
    // เดโม่ (id ชั่วคราว): คนขอ/คนอนุมัติ = ฉัน (ทดลองเป็นคนทำ) · สแกนออก/ส่ง/รับ = คนในสาขาที่มีรูปโปรไฟล์จริง
    if ((kind === "requester" || kind === "approver") && meEmp) return meEmp;
    let pool: Employee[] = kind === "dest" ? empByBranch(tr?.to_branch_id) : empByBranch(tr?.from_branch_id);
    const photo = pool.filter((e) => e.photo_url); // เลี่ยงคนไม่มีรูป → โชว์รูปจริงจาก Lark
    pool = photo.length ? photo : pool.length ? pool : employees.filter((e) => e.status === "active" && e.photo_url);
    if (!pool.length) pool = [meEmp, ...employees].filter(Boolean) as Employee[];
    const seed = [...`${tr?.id ?? ""}|${kind}`].reduce((a, c) => a + c.charCodeAt(0), 0);
    return pool[seed % pool.length] ?? meEmp;
  };
  const empLabel = (e: Employee | null) => (e ? (e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ") || e.employee_code) : "—");
  const empName = (id?: string | null) => empLabel(actorEmp(id));
  // เจ้าของกิจการ/ผู้ดูแลสูงสุด = อนุมัติได้ทุกใบเสมอ (แม้ไม่อยู่ในสายอนุมัติ)
  const isSuperApprover = (e: Employee | null) => !!e && (e.role === "owner" || isSuperadmin(e.email));
  // สายอนุมัติที่ตั้งไว้สำหรับใบนี้ (ตามสาขาต้นทาง + แบรนด์ของสาขา) — null = ไม่ได้ตั้ง → ใช้สิทธิ์เดิม
  const brandOfBranch = (branchId: string) => branches.find((b) => b.id === branchId)?.brand_id ?? null;
  const ruleApproverIds = (tr: Transfer): string[] | null => resolveApprovers(rules, { process: "transfer", branchId: tr.from_branch_id, brandId: brandOfBranch(tr.from_branch_id) });
  // ผู้มีสิทธิ์อนุมัติใบนี้: ถ้าตั้งสายอนุมัติไว้ = ใช้รายชื่อนั้น (ที่ยัง active) · ถ้าไม่ตั้ง = ผู้มีสิทธิ์ transfer.approve + ขอบเขตครอบคลุมสาขาต้นทาง
  const eligibleApprovers = (tr: Transfer) => {
    const configured = ruleApproverIds(tr);
    if (configured) {
      // รายชื่อที่ตั้งไว้ + เจ้าของ/ผู้ดูแลสูงสุด (อนุมัติได้เสมอ)
      return employees
        .filter((e) => e.status === "active" && (configured.includes(e.id) || isSuperApprover(e)))
        .map((e) => ({ e, primary: e.home_branch_id === tr.from_branch_id }))
        .sort((a, b) => Number(b.primary) - Number(a.primary));
    }
    const allIds = branches.map((b) => b.id);
    return employees
      .filter((e) => e.status === "active" && can(e, "transfer.approve") && visibleBranchIds(e, allIds).includes(tr.from_branch_id))
      .map((e) => ({ e, primary: e.home_branch_id === tr.from_branch_id })) // primary = ประจำสาขาต้นทาง · อื่น = สำรอง
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  };
  // ผู้ทำแต่ละขั้น (จาก timeline audit): actor + เวลาของ transition ที่สถานะตรง
  const actorAt = (statuses: string[]): { by: string | null; at: string | null } => {
    const sorted = [...timeline].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
    const hit = sorted.find((a) => statuses.includes(String((a.after_data as Record<string, unknown> | null | undefined)?.status ?? "")));
    return hit ? { by: hit.actor_id ?? null, at: hit.occurred_at } : { by: null, at: null };
  };
  const dtShort = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(locale === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  // อนุมัติได้ไหม: ถ้าตั้งสายอนุมัติไว้ → ต้องเป็นคนในรายชื่อ (รายชื่อคือการให้สิทธิ์ ไม่ต้องเช็ค scope เดิม) · ถ้าไม่ตั้ง → สิทธิ์เดิม
  const canApprove = (tr: Transfer) => {
    if (tr.status !== "pending_approval" || !employee) return false;
    if (isSuperApprover(employee)) return true; // เจ้าของ/ผู้ดูแลสูงสุด = อนุมัติได้ทุกใบ
    const configured = ruleApproverIds(tr);
    if (configured) return configured.includes(employee.id);
    return can(employee, "transfer.approve") && atSource(tr);
  };
  // ── แยกสิทธิ์ตามสาขา: ต้นทางทำสแกนออก/จัดส่ง · ปลายทางเท่านั้นที่รับเข้า ──
  //   atSource/atDest = สาขานั้นอยู่ในขอบเขตที่คนนี้ดูแล (owner/hq = ทุกสาขา → ทำได้ทั้งคู่)
  const atSource = (tr: Transfer) => allowed.includes(tr.from_branch_id);
  const atDest = (tr: Transfer) => allowed.includes(tr.to_branch_id);
  const canOut = can(employee, "transfer.request") || can(employee, "transfer.approve");
  const canRecv = can(employee, "transfer.receive") || can(employee, "transfer.approve");
  const canScanOut = (tr: Transfer) => canOut && atSource(tr) && ["approved", "picking", "packed"].includes(tr.status);
  const canReceive = (tr: Transfer) => canRecv && atDest(tr) && ["in_transit", "partial_received"].includes(tr.status);
  // รออีกฝั่งทำ (โชว์ป้ายบอกว่าใครต้องทำต่อ)
  const waitingSide = (tr: Transfer): "dest" | "source" | null =>
    tr.status === "in_transit" && !atDest(tr) ? "dest" : ["approved", "picking", "packed"].includes(tr.status) && !atSource(tr) ? "source" : null;
  const scanModeOf = (tr: Transfer): "out" | "in" => (["in_transit", "partial_received"].includes(tr.status) ? "in" : "out");
  const prodImg = (pid: string) => products.find((p) => p.id === pid)?.image_url ?? null;

  // สถานะสต๊อก — ของนับเป็นอะไรตอนนี้ (ตามสเปกบัญชีสต๊อก Reserved Out → OTWO → On Hand)
  const stockStatus = (s: TransferStatus): { label: string; tone: "warn" | "info" | "ok" | "neutral" | "teal" } => {
    if (["draft", "pending_approval", "approved", "picking"].includes(s)) return { label: L("จองออก (Reserved Out) · ยังอยู่ในสต๊อกต้นทาง", "Reserved Out · still source stock", "调出预留·仍在源库存"), tone: "teal" };
    if (["packed", "shipped", "in_transit"].includes(s)) return { label: L("กำลังส่งออก (On the Way Out) · ออกจากคลังต้นทางแล้ว ยังไม่ถึงปลายทาง", "On the Way Out · left source, not yet received", "在途出库"), tone: "info" };
    if (["completed", "received"].includes(s)) return { label: L("เข้าสต๊อกปลายทางแล้ว (On Hand)", "On Hand at destination", "已入目的地库存"), tone: "ok" };
    if (s === "partial_received") return { label: L("รับบางส่วน · ปรับสต๊อกตามที่รับจริง", "Partially received", "部分入库"), tone: "warn" };
    return { label: L("ยกเลิก · คืนจอง", "Cancelled · reservation released", "已取消·释放预留"), tone: "neutral" };
  };

  async function loadFiles(id: string) {
    try { const r = await fetch(`/api/pos/transfer-files?id=${encodeURIComponent(id)}`, { cache: "no-store" }); const j = await r.json(); setSrvFiles(r.ok ? j.files : []); } catch { setSrvFiles([]); }
  }
  useEffect(() => { setSrvFiles(null); if (detail && isLiveMode()) void loadFiles(detail.id); }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const atts: TransferAttachment[] = isLiveMode() ? srvFiles ?? [] : detail?.attachments ?? [];

  // แนบไฟล์/รูป (ไม่จำกัดจำนวน · โหมดจริงอัปโหลดขึ้น Storage · โหมดสาธิตเก็บ data URL ในเครื่อง)
  async function onUploadFiles(files: FileList | null) {
    if (!detail || !files || !files.length) return;
    if (isLiveMode()) {
      const fd = new FormData(); fd.set("id", detail.id); fd.set("stage", detail.status);
      [...files].slice(0, 20).forEach((f) => fd.append("file", f));
      setUploading(true);
      try {
        const r = await fetch("/api/pos/transfer-files", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (j.uploaded) toast.push({ tone: "ok", title: L(`แนบไฟล์แล้ว ${j.uploaded} ไฟล์`, `${j.uploaded} file(s) attached`, "已附加") });
        if (j.skipped?.length) toast.push({ tone: "warn", title: L(`ข้าม ${j.skipped.length} ไฟล์`, `${j.skipped.length} skipped`, "已跳过"), body: j.skipped.map((x: { name: string; reason: string }) => `${x.name}: ${x.reason}`).join("\n") });
        if (!r.ok && !j.skipped?.length) toast.push({ tone: "danger", title: L("แนบไฟล์ไม่สำเร็จ", "Upload failed", "上传失败"), body: j.error ?? `HTTP ${r.status}` });
        await loadFiles(detail.id);
      } catch (e) { toast.push({ tone: "danger", title: L("แนบไฟล์ไม่สำเร็จ", "Upload failed", "上传失败"), body: e instanceof Error ? e.message : String(e) }); }
      finally { setUploading(false); }
      return;
    }
    const read = await Promise.all([...files].slice(0, 20).map((f) => new Promise<TransferAttachment>((res) => {
      const r = new FileReader();
      r.onload = () => res({ id: nanoid(8), name: f.name, type: f.type || "application/octet-stream", url: String(r.result), size: f.size, at: new Date().toISOString(), by: employee?.id ?? null, stage: detail.status });
      r.readAsDataURL(f);
    })));
    const ok = read.filter((a) => a.size <= 8 * 1024 * 1024);
    if (ok.length < read.length) toast.push({ tone: "warn", title: L("บางไฟล์ใหญ่เกิน 8MB ถูกข้าม", "Files >8MB skipped", "超过8MB已跳过") });
    if (!ok.length) return;
    const updated = await owSetAttachments(detail.id, [...(detail.attachments ?? []), ...ok]);
    if (updated) { setDetail(updated); await reload(); toast.push({ tone: "ok", title: L("แนบไฟล์แล้ว", "Files attached", "已附加") }); }
  }
  async function removeAttachment(id: string) {
    if (!detail) return;
    if (isLiveMode()) {
      const r = await fetch(`/api/pos/transfer-files?file_id=${id}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast.push({ tone: "danger", title: L("ลบไฟล์ไม่สำเร็จ", "Delete failed", "删除失败"), body: j.error }); }
      await loadFiles(detail.id); return;
    }
    const updated = await owSetAttachments(detail.id, (detail.attachments ?? []).filter((a) => a.id !== id));
    if (updated) { setDetail(updated); await reload(); }
  }
  const doShipStage = (tr: Transfer, stage: ShipStage) => void act(() => owShipStage(tr, employee!.id, stage), L("อัปเดตสถานะขนส่งแล้ว", "Shipping updated", "已更新物流"));

  // สแกนออกครบทุก serialized line แล้วหรือยัง
  const scanOutReady = (tr: Transfer) => tr.items.every((it) => !it.isSerialized || (scanned[it.product_id]?.length ?? 0) === it.qty_requested);

  // บันทึก SN จากป๊อปอัป
  function saveScan(serials: string[]) {
    if (scan) setScanned((s) => ({ ...s, [scan.pid]: serials }));
    setScan(null);
  }
  // สแกนออก → packed
  const doScanOut = (tr: Transfer) => void act(() => owScanOut(tr, employee!.id, scanned), L("สแกนออกแล้ว", "Scanned out", "已扫描出库"));
  // จัดส่ง → in_transit
  const doDispatch = (tr: Transfer) => void act(() => owDispatch(tr, employee!.id, { carrier: carrier || null }), L("ยืนยันส่งมอบสินค้าแล้ว (ของออกจากคลัง)", "Handover confirmed (left warehouse)", "已确认交付"));
  const doPickup = (tr: Transfer, stage: "called" | "arrived") => void act(() => owSetPickupStage(tr, employee!.id, stage), stage === "called" ? L("เรียกรถแล้ว", "Carrier called", "已叫车") : L("รถมารับแล้ว รอส่งมอบ", "Carrier arrived", "车到·待交付"));
  // รับเข้า → completed/partial
  const doReceive = (tr: Transfer) => {
    const received: Record<string, { serials?: string[]; qty?: number }> = {};
    const extras: string[] = [];
    for (const it of tr.items) {
      if (it.isSerialized) {
        const scn = (scanned[it.product_id] ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
        received[it.product_id] = { serials: scn };
        const shippedSet = new Set((it.shippedSerials ?? []).map((s) => s.serialNo.toUpperCase()));
        for (const sn of scn) if (!shippedSet.has(sn)) extras.push(sn);
      } else received[it.product_id] = { qty: Number(recvQty[it.product_id] || 0) };
    }
    void act(async () => {
      // ตรวจที่มา SN นอกใบโอนก่อน (กัน SN เดียวอยู่สองสาขา) — ติดผลลงผลต่าง
      const located: Record<string, SerialLocated> = {};
      for (const sn of extras) { try { located[sn] = await locateSerial(sn); } catch { /* ignore */ } }
      return owReceive(tr, employee!.id, received, undefined, { located });
    }, extras.length ? L(`รับแล้ว — พบ SN นอกใบโอน ${extras.length} (พักตรวจ)`, `Received — ${extras.length} unexpected SN quarantined`, `已收·${extras.length}个异常SN暂扣`) : L("บันทึกการรับรอบนี้แล้ว", "Receipt recorded", "已记录本次收货"));
  };
  const doCloseShort = (tr: Transfer) => void act(() => owCloseShort(tr, employee!.id), L("ปิดรับแล้ว (ยอมรับส่วนขาด)", "Closed with shortage", "已结单(接受缺量)"));
  const doRequestResolve = (tr: Transfer, discId: string) => void act(() => owRequestResolveDisc(tr, discId, employee!.id), L("ส่งให้หัวหน้าอนุมัติปิดแล้ว", "Sent for approval", "已送审批"));
  const doResolveDisc = (tr: Transfer, discId: string, outcome?: "release" | "dispose") => void act(() => owResolveDisc(tr, discId, employee!.id, outcome), outcome === "release" ? L("ผ่านตรวจ — ปล่อยขายแล้ว", "Released to sale", "已放行") : outcome === "dispose" ? L("อนุมัติตัดทิ้งแล้ว", "Disposed", "已报废") : L("หัวหน้าอนุมัติปิดผลต่างแล้ว", "Discrepancy resolved", "已关闭差异"));
  // แจ้งของมีปัญหา (ชำรุด/SN ผิด) → พักตรวจ ขายไม่ได้ จนกว่าหัวหน้าจะตัดสิน
  const doRecordDamage = (tr: Transfer, product_id: string, kind: "damaged" | "wrong_sn" | "lost", qty: number, serialNo?: string | null) => void act(() => owRecordDisc(tr, employee!.id, { product_id, kind, qty, note: null, responsible_by: null, serialNo: serialNo?.trim().toUpperCase() || null }), kind === "lost" ? L("แจ้งไม่พบ/สูญหายแล้ว — กำลังติดตาม", "Reported missing — tracking", "已报失·跟踪中") : L("บันทึกพักตรวจแล้ว (ขายไม่ได้)", "Quarantined", "已暂扣"));
  // ── ปิดเคสราย SN ──
  const doResolveSn = (tr: Transfer, discId: string, outcome: "accept" | "dispose" | "found_source" | "confirmed_lost") => void act(() => owResolveDisc(tr, discId, employee!.id, outcome), outcome === "accept" ? L("ยอมรับที่ปลายทาง — ปล่อยขายแล้ว", "Accepted at destination", "已接收·放行") : outcome === "dispose" ? L("ตัดจำหน่ายแล้ว", "Disposed", "已报废") : outcome === "found_source" ? L("พบที่ต้นทาง — คืนสต๊อกต้นทางแล้ว", "Found at source", "源门店已找到") : L("ยืนยันสูญหาย — ตัดยอดแล้ว", "Confirmed lost", "确认丢失"));
  // ใบส่งทดแทน (SN ขาด) — สร้างใบโอนใหม่ ต้นทาง→ปลายทาง 1 ชิ้น เชื่อมเคส
  async function doMakeReplacement(tr: Transfer, dc: NonNullable<Transfer["discrepancies"]>[number]) {
    if (!employee) return; setBusy(true);
    try {
      const p = products.find((x) => x.id === dc.product_id);
      const rep = await owCreate(tr.from_branch_id, tr.to_branch_id, employee.id,
        [{ product_id: dc.product_id, sku: p?.sku ?? dc.product_id, name: p?.name_th ?? "", qty: 1, isSerialized: !!p?.track_serial }],
        L(`ส่งทดแทน SN ${dc.serialNo ?? ""} (อ้างอิง ${tr.transfer_no})`, `Replacement for ${dc.serialNo ?? ""} (ref ${tr.transfer_no})`, `替代 ${dc.serialNo ?? ""}`),
        false, tr.from_kind === "warehouse" ? "warehouse" : "branch", { transfer_no: tr.transfer_no, disc_id: dc.id, serialNo: dc.serialNo ?? null });
      await owMarkReplacement(tr, dc.id, employee.id, rep.transfer_no);
      await reload(); openDoc(rep);
      toast.push({ tone: "ok", title: L(`สร้างใบส่งทดแทนแล้ว ${rep.transfer_no} — รอต้นทางอนุมัติ`, `Replacement created ${rep.transfer_no}`, `已建替代单 ${rep.transfer_no}`) });
    } catch (e) { toast.push({ tone: "danger", title: owErrorMessage(e instanceof Error ? e.message : "error", locale) }); } finally { setBusy(false); }
  }
  // แพ็ค + สแกน SN ที่ส่งคืนจริง (serialized) → preparing
  const doPackReturn = (tr: Transfer, retId: string, snsByProduct: Record<string, string[]>) => void act(() => owPackReturn(tr, employee!.id, retId, snsByProduct), L("แพ็ค + สแกน SN ส่งคืนแล้ว", "Packed + scanned", "已打包扫描"));
  // ปฏิเสธรับ → ส่งคืน → ต้นทางรับคืน
  // ── ใบส่งคืน (Return Doc) ──
  const discOf = (tr: Transfer, discId: string) => (tr.discrepancies ?? []).find((d) => d.id === discId);
  const doOpenReturn = (tr: Transfer, dc: NonNullable<Transfer["discrepancies"]>[number], outcome: "return_source" | "repair") => {
    const qty = Math.max(1, Math.min(dc.qty, openQty[dc.id] ?? dc.qty));
    void act(() => owOpenReturn(tr, employee!.id, { disc_ids: [dc.id], outcome, reason_kind: (dc.kind === "wrong_sn" ? "wrong_sn" : "damaged"), reason: null, lines: [{ product_id: dc.product_id, qty, sns_expected: dc.serialNo ? [dc.serialNo] : [] }] }),
      outcome === "repair" ? L(`เปิดใบส่งซ่อม ${qty} ชิ้น`, "Repair return opened", "已开维修单") : L(`เปิดใบส่งคืน ${qty} ชิ้น`, "Return opened", "已开退回单"));
  };
  const doReqReturn = (tr: Transfer, retId: string) => void act(() => owRequestReturnApproval(tr, employee!.id, retId), L("ส่งให้หัวหน้าตรวจแล้ว", "Sent for approval", "已送审"));
  const doApproveReturn = (tr: Transfer, retId: string) => void act(() => owApproveReturn(tr, employee!.id, retId), L("อนุมัติใบส่งคืนแล้ว — รอจัดส่ง", "Return approved", "已批准"));
  const doCancelReturn = (tr: Transfer, retId: string) => void act(() => owCancelReturn(tr, employee!.id, retId), L("ยกเลิกใบส่งคืนแล้ว", "Return cancelled", "已取消"));
  const doDispatchReturn = (tr: Transfer, retId: string) => void act(() => owDispatchReturn(tr, employee!.id, retId, { carrier: carrier || null, tracking: retTracking || null }), L("ยืนยันส่งคืนแล้ว (ของออกจากสาขา)", "Return dispatched", "已发出退回"));
  const doReturnShipStage = (tr: Transfer, retId: string, stage: "called" | "picked_up" | "handed") => void act(() => owSetReturnShipStage(tr, employee!.id, retId, stage), L("อัปเดตสถานะขนส่งแล้ว", "Shipping updated", "已更新物流"));
  // รับคืน "ทั้งใบ" — เฉพาะสินค้าไม่มี SN (ตามจำนวน) · สินค้ามี SN ต้องสแกนรับคืนทีละตัว (ปุ่มสแกน)
  const doReceiveRet = (tr: Transfer, r: NonNullable<Transfer["returns"]>[number]) => void act(() => owReceiveReturnLines(tr, employee!.id, r.id, (r.lines ?? []).map((l) => {
    const serialized = !!products.find((p) => p.id === l.product_id)?.track_serial;
    if (serialized) return { product_id: l.product_id, qty: 0 };
    const remain = l.qty - (l.qty_received ?? 0);
    const q = retLineQty[`${r.id}:${l.product_id}`];
    return { product_id: l.product_id, qty: q === undefined ? remain : Math.max(0, Math.min(remain, q)) };
  })), L("รับคืนแล้ว — เข้าพักตรวจ (ยังไม่ขาย)", "Received into quarantine", "已收回·暂扣"));
  // บันทึก SN จากป๊อปอัปขาส่งคืน — pack=บันทึก SN ที่ส่งคืนจริง · recv=ต้นทางสแกนรับคืน
  function saveRetScan(sns: string[]) {
    if (!retScan || !detail) { setRetScan(null); return; }
    const { retId, pid, mode } = retScan;
    const clean = sns.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (mode === "pack") doPackReturn(detail, retId, { [pid]: clean });
    else void act(() => owReceiveReturnLines(detail, employee!.id, retId, [{ product_id: pid, qty: clean.length, sns_found: clean }]), L("ต้นทางรับคืนแล้ว (สแกน SN ตรง) — เข้าพักตรวจ", "Received back (SN matched)", "已收回·暂扣"));
    setRetScan(null);
  }
  const doCloseReturn = (tr: Transfer, r: NonNullable<Transfer["returns"]>[number], oc: "release" | "repair" | "dispose") => void act(() => owCloseReturn(tr, employee!.id, r.id, Object.fromEntries((r.lines ?? []).map((l) => [l.product_id, oc]))), oc === "release" ? L("ปิดงาน — ปล่อยขายแล้ว", "Closed — released to sale", "已放行") : oc === "repair" ? L("ปิดงาน — ส่งซ่อม (คงพักตรวจ)", "Closed — to repair", "已送修") : L("ปิดงาน — ตัดจำหน่ายแล้ว", "Closed — disposed", "已报废"));
  // ยกเลิกตามสถานะ: ก่อนสแกนออกยกเลิกได้ (ปล่อยจอง) · หลังส่ง/เสร็จ → โอนกลับ
  const canCancelTr = (tr: Transfer) => ["approved", "picking"].includes(tr.status) && atSource(tr) && canOut;
  const canReverse = (tr: Transfer) => ["completed", "partial_received"].includes(tr.status) && atDest(tr) && canOut && tr.items.some((it) => (it.qty_received || 0) > 0);
  const doCancel = (tr: Transfer) => void act(() => owReject(tr, employee!.id, true, approveNote), L("ยกเลิกใบแล้ว (คืนจอง)", "Cancelled (released)", "已取消"));
  async function doReverse(tr: Transfer) {
    if (!employee) return; setBusy(true);
    try { const rev = await owReverse(tr, employee.id); await reload(); openDoc(rev); toast.push({ tone: "ok", title: L("สร้างใบโอนกลับแล้ว — รอต้นทางใหม่อนุมัติ", "Reverse transfer created", "已建退回单") }); }
    catch (e) { toast.push({ tone: "danger", title: owErrorMessage(e instanceof Error ? e.message : "error", locale) }); }
    finally { setBusy(false); }
  }

  function printCO(tr: Transfer) {
    printTransferCO(tr, {
      fromName: bName(tr.from_branch_id), toName: bName(tr.to_branch_id), statusLabel: sMeta(tr.status).label, locale, carrierName: tr.carrier,
      requesterName: empLabel(actorEmp(tr.requested_by, "requester", tr)),
      approverName: tr.approved_by ? empLabel(actorEmp(tr.approved_by, "approver", tr)) : null,
      note: tr.approval_note || tr.note || null,
    });
  }
  // ── ไฟล์แนบ: ดาวน์โหลด / คัดลอกรูป ──
  function downloadAtt(a: TransferAttachment) {
    try { const l = document.createElement("a"); l.href = a.url; l.download = a.name || "file"; l.target = "_blank"; document.body.appendChild(l); l.click(); l.remove(); } catch { /* ignore */ }
  }
  async function copyImage(a: TransferAttachment) {
    try {
      const blob = await (await fetch(a.url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      setCopied("img"); setTimeout(() => setCopied(""), 1500);
    } catch {
      try { await navigator.clipboard.writeText(a.url); setCopied("img"); setTimeout(() => setCopied(""), 1500); } catch { /* ignore */ }
    }
  }
  // ── แชร์ฟอร์ม: ลิงก์ (เห็นแค่ฟอร์มนั้น) ──
  const shareUrl = (tr: Transfer) => (typeof window !== "undefined" ? `${window.location.origin}/share/transfer/${encodeURIComponent(tr.transfer_no)}` : "");
  async function copyShareLink(tr: Transfer) { try { await navigator.clipboard.writeText(shareUrl(tr)); setCopied("link"); setTimeout(() => setCopied(""), 1500); } catch { /* ignore */ } }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <IntegrationNotice kind="transfer" />
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2"><ArrowLeftRight size={16} className="text-brand" /> {t.transfer.title}</h2>
        <div className="flex gap-1.5 ml-auto">
          <button onClick={() => setBucket("mine")} className={`text-xs px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${bucket === "mine" ? "bg-brand text-white border-brand" : mineCount ? "border-teal-400/60 text-teal-600 bg-teal-500/5 hover:bg-teal-500/10" : "border-line text-muted hover:text-brand"}`}>
            <Clock size={12} /> {L("รอฉันทำ", "My queue", "待我处理")}
            {mineCount ? <span className={`min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10px] font-bold ${bucket === "mine" ? "bg-white/25 text-white" : "bg-teal-600 text-white"}`}>{mineCount}</span> : null}
          </button>
          {overdueCount ? (
            <button onClick={() => setBucket("overdue")} className={`text-xs px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${bucket === "overdue" ? "bg-rose-600 text-white border-rose-600" : "border-rose-400/60 text-rose-600 bg-rose-500/5 hover:bg-rose-500/10"}`}>
              <Clock size={12} /> {L("เกินเวลา", "Overdue", "逾期")}
              <span className={`min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10px] font-bold ${bucket === "overdue" ? "bg-white/25 text-white" : "bg-rose-600 text-white"}`}>{overdueCount}</span>
            </button>
          ) : null}
          {(["active", "issue", "done", "all"] as const).map((b) => (
            <button key={b} onClick={() => setBucket(b)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${bucket === b ? "bg-brand text-white border-brand" : b === "issue" && issueCount ? "border-rose-400/60 text-rose-600 bg-rose-500/5 hover:bg-rose-500/10" : "border-line text-muted hover:text-brand"}`}>
              {b === "active" ? L("กำลังดำเนินการ", "Active", "进行中") : b === "issue" ? L("มีปัญหา", "Issues", "异常") : b === "done" ? L("เสร็จแล้ว", "Done", "完成") : t.common.all}
              {b === "issue" && issueCount ? <span className={`min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10px] font-bold ${bucket === "issue" ? "bg-white/25 text-white" : "bg-rose-500 text-white"}`}>{issueCount}</span> : null}
            </button>
          ))}
        </div>
        {/* คำร้อง (ขอโอน/ขอสินค้าเข้า) — ใครก็สร้างได้ (แค่ล็อกอิน) · การเคลื่อนไหวจริงยังคุมด้วยสิทธิ์+สายอนุมัติ */}
        {employee ? <Button variant="ghost" className="h-9" onClick={() => openRequest()}><Boxes size={15} /> {L("ขอสินค้าเข้า", "Request stock", "申请调入")}</Button> : null}
        {employee ? <Button variant="primary" className="h-9" onClick={() => setOpen(true)}><Plus size={15} /> {t.transfer.request}</Button> : null}
      </div>

      <Card>
        {visible.length ? (
          <Table>
            <thead><tr>
              <Th>{t.transfer.title}</Th><Th>{t.transfer.from}</Th><Th>{t.transfer.to}</Th>
              <Th align="center">SN</Th><Th align="center">{t.common.status}</Th><Th>{t.common.date}</Th>
            </tr></thead>
            <tbody>
              {visible.map((tr) => {
                const snTotal = tr.items.filter((i) => i.isSerialized).reduce((s, i) => s + i.qty_requested, 0);
                const snDone = tr.items.filter((i) => i.isSerialized).reduce((s, i) => s + (i.receivedSerials?.length || i.shippedSerials?.length || 0), 0);
                return (
                  <tr key={tr.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => openDoc(tr)}>
                    <Td className="font-mono text-xs text-brand">{tr.transfer_no}</Td>
                    <Td className="text-xs truncate max-w-[150px]">{tr.from_kind === "warehouse" ? "" : ""}{bName(tr.from_branch_id)}</Td>
                    <Td className="text-xs truncate max-w-[150px]">{bName(tr.to_branch_id)}</Td>
                    <Td align="center" className="text-[11px] tnum text-muted">{snTotal ? `${snDone}/${snTotal}` : "—"}</Td>
                    <Td align="center">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={displayStatus(tr).tone}>{displayStatus(tr).label}</Badge>
                        {overdueInfo(tr)?.over ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-500/12 border border-rose-500/30 rounded-full px-1.5 py-0.5"><Clock size={10} /> {L(`ค้าง ${overdueInfo(tr)!.days} วัน`, `${overdueInfo(tr)!.days}d overdue`, `逾期${overdueInfo(tr)!.days}天`)}</span> : null}
                        {hasOpenDisc(tr) ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-500/12 border border-rose-500/30 rounded-full px-1.5 py-0.5"><CircleAlert size={10} /> {L("ผลต่างค้าง", "Open issue", "异常未结")}</span> : null}
                      </span>
                    </Td>
                    <Td className="text-xs text-muted">{new Date(tr.created_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : <EmptyState icon={<ArrowLeftRight size={26} />} title={t.common.empty} body={L("สร้างใบโอนย้ายเพื่อย้ายสินค้าระหว่างสาขา/คลัง", "Create a transfer to move stock", "创建调货单")} />}
      </Card>

      {/* detail drawer (monitor + approve) */}
      <Drawer open={Boolean(detail)} onClose={closeDoc} width="xl"
        title={detail ? <span className="font-mono">{detail.transfer_no}</span> : ""}
        subtitle={detail ? `${detail.from_kind === "warehouse" ? "" : ""}${bName(detail.from_branch_id)} → ${bName(detail.to_branch_id)}` : ""}
        badge={detail ? <Badge tone={displayStatus(detail).tone}>{displayStatus(detail).label}</Badge> : null}
        footer={detail ? (
          <div className="flex gap-2 w-full items-center flex-wrap">
            <Button variant="soft" onClick={() => printCO(detail)}><Printer size={15} /> {L("พิมพ์ใบ CO", "Print CO", "打印CO")}</Button>
            {isLiveMode() ? <TransferDocsButton transferId={detail.id} /> : null}
            <div className="relative">
              <Button variant="soft" onClick={() => setShareOpen((v) => !v)}><Share2 size={15} /> {L("แชร์ฟอร์ม", "Share", "分享")}</Button>
              {shareOpen ? <>
                <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} />
                <div className="absolute z-50 bottom-full mb-2 left-0 w-72 rounded-2xl border border-line bg-surface shadow-2xl p-2 space-y-1">
                  <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted">{L("แชร์ใบนี้ · เห็นเฉพาะฟอร์มนี้เท่านั้น", "Share this form only", "仅此单")}</p>
                  <button onClick={() => { void copyShareLink(detail); }} className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-brand/5 text-left"><span className="w-8 h-8 rounded-lg bg-brand/10 text-brand grid place-items-center">{copied === "link" ? <Check size={15} /> : <LinkIcon size={15} />}</span><span className="min-w-0"><span className="block font-medium">{copied === "link" ? L("คัดลอกลิงก์แล้ว", "Link copied", "已复制") : L("คัดลอกลิงก์", "Copy link", "复制链接")}</span><span className="block text-[11px] text-muted truncate">{shareUrl(detail)}</span></span></button>
                  <a href={shareUrl(detail)} target="_blank" rel="noreferrer" onClick={() => setShareOpen(false)} className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-brand/5 text-left"><span className="w-8 h-8 rounded-lg bg-brand/10 text-brand grid place-items-center"><ExternalLink size={15} /></span><span className="font-medium">{L("เปิดหน้าแชร์ (ลิงก์)", "Open share page", "打开分享页")}</span></a>
                  <button onClick={() => { setShareOpen(false); printCO(detail); }} className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-brand/5 text-left"><span className="w-8 h-8 rounded-lg bg-brand/10 text-brand grid place-items-center"><FileDown size={15} /></span><span className="min-w-0"><span className="block font-medium">{L("ดาวน์โหลด PDF", "Download PDF", "下载PDF")}</span><span className="block text-[11px] text-muted">{L("หน้าต่างพิมพ์ → บันทึกเป็น PDF", "Print dialog → Save as PDF", "打印→另存PDF")}</span></span></button>
                </div>
              </> : null}
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {/* รออีกฝั่ง: บอกว่าใครต้องทำต่อ (ฝั่งนี้กดไม่ได้) */}
              {waitingSide(detail) === "dest" ? <span className="text-xs text-muted inline-flex items-center gap-1.5"><Clock size={13} /> {L("รอปลายทางรับเข้า", "Waiting for destination to receive", "等待目的地入库")} ({bName(detail.to_branch_id)})</span> : null}
              {waitingSide(detail) === "source" ? <span className="text-xs text-muted inline-flex items-center gap-1.5"><Clock size={13} /> {L("รอต้นทางสแกนออก/จัดส่ง", "Waiting for source to ship", "等待调出方发货")} ({bName(detail.from_branch_id)})</span> : null}
              {canApprove(detail) ? <>
                <Button variant="ghost" loading={busy} onClick={() => void act(() => owReject(detail, employee!.id, false, approveNote), L("ปฏิเสธแล้ว", "Rejected", "已拒绝"))}><X size={15} /> {L("ปฏิเสธ", "Reject", "拒绝")}</Button>
                <Button variant="primary" loading={busy} onClick={() => void act(() => owApprove(detail, employee!.id, approveNote), t.transfer.approve)}><Check size={15} /> {t.transfer.approve}</Button>
              </> : null}
              {canScanOut(detail) && detail.status !== "packed" ? (
                <Button variant="primary" loading={busy} disabled={!scanOutReady(detail)} onClick={() => doScanOut(detail)}><ScanLine size={15} /> {L("ยืนยันสแกนออก", "Confirm scan-out", "确认出库")}</Button>
              ) : null}
              {canScanOut(detail) && detail.status === "packed" ? <>
                {/* ประสานขนส่งก่อนส่งมอบ (ยังไม่ตัดยอด): เรียกรถ → รถมารับ → ยืนยันส่งมอบ */}
                {!detail.pickup_stage ? <Button variant="ghost" loading={busy} onClick={() => doPickup(detail, "called")}><Clock size={15} /> {L("เรียกรถ", "Call carrier", "叫车")}</Button> : null}
                {detail.pickup_stage === "called" ? <><Badge tone="teal"><Clock size={11} /> {L("เรียกรถแล้ว", "Carrier called", "已叫车")}</Badge><Button variant="ghost" loading={busy} onClick={() => doPickup(detail, "arrived")}><Truck size={15} /> {L("รถมารับแล้ว", "Carrier arrived", "车已到")}</Button></> : null}
                {detail.pickup_stage === "arrived" ? <Badge tone="teal"><Truck size={11} /> {L("รถมารับแล้ว · รอส่งมอบ", "Arrived · to hand over", "车到·待交")}</Badge> : null}
                <Select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-10 w-36"><option value="">{L("ขนส่ง…", "Carrier…", "承运…")}</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                <Button variant="primary" loading={busy} onClick={() => doDispatch(detail)}><Truck size={15} /> {L("ยืนยันส่งมอบสินค้า", "Confirm handover", "确认交付")}</Button>
              </> : null}
              {canReceive(detail) ? (
                <Button variant="primary" loading={busy} onClick={() => doReceive(detail)}><PackageCheck size={15} /> {L("ยืนยันรับเข้า", "Confirm receive", "确认入库")}</Button>
              ) : null}
              {canCancelTr(detail) ? (
                <Button variant="ghost" loading={busy} onClick={() => doCancel(detail)} className="text-rose-600"><X size={15} /> {L("ยกเลิกใบ", "Cancel", "取消单")}</Button>
              ) : null}
              {canReverse(detail) ? (
                <Button variant="soft" loading={busy} onClick={() => doReverse(detail)} title={L("ของออกจากต้นทางแล้ว — คืนด้วยการสร้างใบโอนกลับ", "Goods already shipped — return via reverse transfer", "退回需建反向单")}><RotateCcw size={15} /> {L("โอนกลับ", "Reverse", "退回")}</Button>
              ) : null}
            </div>
          </div>
        ) : null}>
        {detail ? (
          <>
            <DrawerTabs<Tab> value={tab} onChange={setTab} options={[{ value: "overview", label: L("ภาพรวม", "Overview", "概览") }, { value: "timeline", label: <span className="inline-flex items-center gap-1"><Clock size={12} />Timeline</span> }]} />
            {isLiveMode() ? <div className="px-5 pt-4"><AiBrief key={detail.id + ":" + detail.status + ":" + (detail.version ?? 0)} endpoint={`/api/pos/transfer-summary?id=${encodeURIComponent(detail.id)}`} title="AI สรุปใบโอน" /></div> : null}
            {tab === "overview" ? (
              <div className="p-5 space-y-4">
                <TransferStepper status={detail.status} locale={locale} L={L} />
                {/* สิ่งที่ต้องทำตอนนี้ — บอกเป็นขั้น ๆ ว่าใครทำอะไร กดปุ่มไหน */}
                {(() => {
                  const S = detail.status;
                  let hint: { tone: string; icon: React.ReactNode; title: string; text: string } | null = null;
                  if (canApprove(detail)) hint = { tone: "info", icon: <Check size={16} />, title: L("ขั้นที่ 1 · รออนุมัติ (ต้นทาง)", "Step 1 · Approve", "待批准"), text: L("ตรวจรายการ แล้วกดปุ่ม “อนุมัติ” (มุมขวาบน) เพื่อเริ่มโอน — หรือ “ปฏิเสธ” ถ้าไม่ถูกต้อง", "Review items, then tap Approve (top right) to start — or Reject", "核对后点批准") };
                  else if (canScanOut(detail) && S !== "packed") hint = { tone: "teal", icon: <ScanLine size={16} />, title: L("ขั้นที่ 2 · สแกนของออก (ต้นทาง)", "Step 2 · Scan out", "扫描出库"), text: L("กดปุ่ม “สแกน SN” ที่สินค้าแต่ละรายการให้ครบจำนวน แล้วกด “ยืนยันสแกนออก” (มุมขวาบน)", "Scan each item's SN in full, then Confirm scan-out", "逐件扫SN后确认") };
                  else if (canScanOut(detail) && S === "packed") hint = { tone: "teal", icon: <Truck size={16} />, title: L("ขั้นที่ 3 · ส่งมอบให้ขนส่ง (ต้นทาง)", "Step 3 · Hand over", "交付"), text: L("เลือกขนส่ง → เรียกรถ → เมื่อของออกจากคลัง กด “ยืนยันส่งมอบสินค้า”", "Pick carrier, then Confirm handover when goods leave", "选承运后确认交付") };
                  else if (canReceive(detail)) hint = { tone: "ok", icon: <PackageCheck size={16} />, title: L("ขั้นที่ 4 · รับของเข้าสาขา (ปลายทาง)", "Step 4 · Receive", "收货入库"), text: L("ตรวจของ → กด “สแกน SN/ใส่จำนวน” ที่แต่ละรายการ → ถ้าครบกด “ยืนยันรับเข้า”. ⚠ ถ้าของชำรุด / SN ไม่ตรง / ขาด ให้กดปุ่ม “แจ้งปัญหา” สีแดงด้านล่างก่อน (ของจะถูกพักไว้ ขายไม่ได้จนตรวจเสร็จ)", "Check goods → Scan/enter qty → Confirm receive. If damaged / wrong SN / short, tap the red Report problem button below first", "核对后确认；有损坏/SN错/缺量先点下方报告") };
                  else if (waitingSide(detail) === "dest") hint = { tone: "neutral", icon: <Clock size={16} />, title: L("รอปลายทางรับเข้า", "Waiting for destination", "等待收货"), text: L(`ของกำลังไป ${bName(detail.to_branch_id)} — ฝั่งเราไม่ต้องทำอะไร รอสาขาปลายทางตรวจรับ`, `Awaiting ${bName(detail.to_branch_id)} to receive`, "等待目的地收货") };
                  else if (waitingSide(detail) === "source") hint = { tone: "neutral", icon: <Clock size={16} />, title: L("รอต้นทางส่งของ", "Waiting for source", "等待发货"), text: L(`รอ ${bName(detail.from_branch_id)} สแกนออกและจัดส่ง`, `Awaiting ${bName(detail.from_branch_id)} to ship`, "等待调出方发货") };
                  if (!hint) return null;
                  const c = { info: "border-sky-300 bg-sky-50 text-sky-900", teal: "border-teal-300 bg-teal-50 text-teal-900", ok: "border-emerald-300 bg-emerald-50 text-emerald-900", neutral: "border-line bg-surface2 text-ink" }[hint.tone] ?? "border-line bg-surface2 text-ink";
                  return (
                    <div className={`rounded-2xl border p-3.5 flex items-start gap-3 ${c}`}>
                      <span className="shrink-0 w-9 h-9 rounded-xl bg-white/70 grid place-items-center">{hint.icon}</span>
                      <div className="min-w-0"><p className="text-sm font-bold">{hint.title}</p><p className="text-[12.5px] leading-relaxed mt-0.5 opacity-90">{hint.text}</p></div>
                    </div>
                  );
                })()}
                <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
                  <DetailRow label={t.transfer.from}>{detail.from_kind === "warehouse" ? "" : ""}{bName(detail.from_branch_id)}</DetailRow>
                  <DetailRow label={t.transfer.to}>{bName(detail.to_branch_id)}</DetailRow>
                  {detail.ow_owned ? (
                    <DetailRow label="OneWarehouse">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${detail.sync_state === "synced" ? "bg-ok/12 text-ok" : detail.sync_state === "failed" ? "bg-danger/12 text-danger" : "bg-warn/12 text-warn"}`}>
                          {detail.sync_state === "synced" ? "ซิงก์ JST แล้ว" : detail.sync_state === "failed" ? "ซิงก์ JST ล้มเหลว" : "รอซิงก์ JST"}
                        </span>
                        <span className="font-mono text-[11px]">{Object.values(detail.ow_state ?? {}).map((s) => `${s.orderNo} (${s.status})`).join(" · ") || "—"}</span>
                      </span>
                    </DetailRow>
                  ) : null}
                  {detail.jst_allocation_no ? <DetailRow label="JST">{detail.jst_allocation_no}</DetailRow> : null}
                  {detail.ow_owned && (detail.ow_link_state && detail.ow_link_state !== "ok" || detail.ow_error) ? (
                    <div className="rounded-xl border border-warn/30 bg-warn/8 p-3 text-xs space-y-2">
                      <p className="text-warn font-medium">
                        {detail.ow_link_state === "checking" ? "กำลังตรวจสอบผลจาก OneWarehouse (อาจทำสำเร็จแล้ว) — โหลดสถานะล่าสุดก่อนกดซ้ำ"
                          : detail.ow_link_state === "partially_created" ? "สร้างใบใน OneWarehouse ได้บางส่วน"
                          : detail.ow_link_state === "recovery_required" ? "ต้องดำเนินการต่อให้ OneWarehouse ครบ"
                          : "คำสั่งล่าสุดกับ OneWarehouse ไม่สำเร็จ"}
                      </p>
                      {detail.ow_error ? <p className="text-muted break-words">{detail.ow_error}</p> : null}
                      <div className="flex gap-2">
                        <button className="h-8 px-3 rounded-lg bg-brand text-brandInk text-xs font-medium" onClick={() => void act(() => owResume(detail), "ดำเนินการต่อแล้ว")}>ดำเนินการต่อเฉพาะส่วนที่ค้าง</button>
                        <button className="h-8 px-3 rounded-lg border border-line text-xs" onClick={() => void act(() => owRefresh(detail), "โหลดสถานะล่าสุดแล้ว")}>โหลดสถานะล่าสุด</button>
                      </div>
                    </div>
                  ) : null}
                  {detail.note ? <DetailRow label={t.common.note}>{detail.note}</DetailRow> : null}
                </div>
                {/* ขั้นตอน & ผู้รับผิดชอบ — แต่ละขั้นใครทำไปแล้ว (ชื่อ+เวลา) และขั้นถัดไปใครต้องกด */}
                {(() => {
                  const S = detail.status;
                  const dead = S === "rejected" || S === "cancelled";
                  const inset = (...xs: TransferStatus[]) => xs.includes(S);
                  const src = L(`ต้นทาง — ${bName(detail.from_branch_id)}`, `Source — ${bName(detail.from_branch_id)}`, `源店 — ${bName(detail.from_branch_id)}`);
                  const dst = L(`ปลายทาง — ${bName(detail.to_branch_id)}`, `Destination — ${bName(detail.to_branch_id)}`, `目的地 — ${bName(detail.to_branch_id)}`);
                  // ผู้ทำแต่ละขั้น: ใช้ค่าที่บันทึกในใบก่อน (ใบ OneWarehouse เซิร์ฟเวอร์บันทึกเอง) แล้วค่อยดูประวัติในเครื่อง
                  const pick = (by: string | null | undefined, at: string | null | undefined, statuses: string[]) => (by ? { by, at: at ?? null } : actorAt(statuses));
                  const a = { out: pick(detail.packed_by, detail.packed_at, ["packed", "shipped"]), disp: pick(detail.shipped_by, detail.shipped_at, ["in_transit"]), recv: pick(detail.received_by, detail.received_at, ["received", "completed", "partial_received"]) };
                  type Step = { label: string; by: string | null; at: string | null; done: boolean; current: boolean; resp: string; kind: "requester" | "approver" | "source" | "dest" };
                  const steps: Step[] = [
                    { label: L("สร้างคำขอ", "Created", "创建"), by: detail.requested_by ?? null, at: detail.created_at, done: true, current: false, resp: "", kind: "requester" },
                    { label: L("อนุมัติ", "Approved", "审批"), by: detail.approved_by ?? actorAt(["approved"]).by, at: actorAt(["approved"]).at, done: inset("approved", "picking", "packed", "shipped", "in_transit", "received", "partial_received", "completed"), current: inset("pending_approval"), resp: L(`ผู้อนุมัติสาขาต้นทาง (${bName(detail.from_branch_id)})`, `Source approver (${bName(detail.from_branch_id)})`, `源店审批`), kind: "approver" },
                    { label: L("สแกนออก (SN)", "Scan-out (SN)", "扫描出库"), by: a.out.by, at: a.out.at, done: inset("packed", "shipped", "in_transit", "received", "partial_received", "completed"), current: inset("approved", "picking"), resp: src, kind: "source" },
                    { label: L("จัดส่ง", "Dispatch", "发货"), by: a.disp.by, at: a.disp.at, done: inset("in_transit", "received", "partial_received", "completed"), current: inset("packed", "shipped"), resp: src, kind: "source" },
                    { label: L("รับเข้า (SN)", "Receive (SN)", "入库"), by: a.recv.by, at: a.recv.at, done: inset("received", "completed"), current: inset("in_transit", "partial_received"), resp: dst, kind: "dest" },
                  ];
                  return (
                    <div className="rounded-2xl border border-line overflow-hidden">
                      <p className="text-[11px] font-medium text-muted px-3.5 pt-3 pb-1">{L("ขั้นตอน & ผู้รับผิดชอบ", "Steps & ownership", "步骤与负责人")}</p>
                      <div className="divide-y divide-line/60">
                        {steps.map((st, i) => {
                          const who = st.done ? actorEmp(st.by, st.kind, detail) : null;
                          return (
                            <div key={i} className={`flex items-center gap-3 px-3.5 py-2.5 ${st.current && !dead ? "bg-teal-500/5" : ""}`}>
                              <span className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-[11px] ${st.done ? "bg-emerald-500/15 text-emerald-600" : st.current && !dead ? "bg-teal-500/20 text-teal-600 ring-2 ring-teal-400/40" : "bg-line/40 text-muted/60"}`}>
                                {st.done ? <Check size={13} /> : i + 1}
                              </span>
                              {st.done && who ? <Avatar name={empLabel(who)} src={who.photo_url} size={30} /> : null}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium leading-tight">{st.label}</p>
                                {st.done ? (
                                  <p className="text-[11px] text-muted truncate">{L("โดย", "by", "由")} <span className="text-ink/80 font-medium">{empLabel(who)}</span>{st.at ? ` · ${dtShort(st.at)}` : ""}</p>
                                ) : st.current && !dead ? (
                                  <p className="text-[11px] text-teal-600 truncate">{L("รอ", "Waiting on", "待")}: {st.resp}</p>
                                ) : (
                                  <p className="text-[11px] text-muted/50">{L("ยังไม่ถึงขั้นนี้", "Not yet", "未到")}</p>
                                )}
                              </div>
                              {st.current && !dead ? <Badge tone="teal">{L("ต้องทำต่อ", "Action due", "下一步")}</Badge> : null}
                            </div>
                          );
                        })}
                      </div>
                      {dead ? <p className="text-[11px] text-rose-500 px-3.5 py-2 border-t border-line/60">{S === "rejected" ? L("ใบนี้ถูกปฏิเสธ", "Rejected", "已拒绝") : L("ใบนี้ถูกยกเลิก", "Cancelled", "已取消")}{detail.approved_by ? ` · ${L("โดย", "by", "由")} ${empName(detail.approved_by)}` : ""}</p> : null}
                    </div>
                  );
                })()}
                {/* อนุมัติ: ผู้มีสิทธิ์ (รวมผู้สำรองเมื่อคนหลักไม่อยู่) + เหตุผล */}
                {detail.status === "pending_approval" ? (
                  <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-3 space-y-2.5">
                    <p className="text-sm font-medium inline-flex items-center gap-1.5"><Clock size={14} className="text-teal-600" /> {L("รออนุมัติ (สาขาต้นทาง)", "Pending approval (source)", "待审批")}</p>
                    <div>
                      <p className="text-[11px] text-muted mb-1.5">{L("ผู้มีสิทธิ์อนุมัติ — สาขาต้นทาง + ผู้สำรอง", "Eligible approvers — source + backup", "可审批人 — 源店+备用")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {eligibleApprovers(detail).slice(0, 10).map(({ e, primary }) => (
                          <span key={e.id} className={`inline-flex items-center gap-1.5 text-[11px] pl-1 pr-2 py-1 rounded-full border ${primary ? "border-brand/40 text-brand bg-brand/5" : "border-line text-muted bg-surface"}`}>
                            <Avatar name={empLabel(e)} src={e.photo_url} size={20} />
                            {e.nickname || e.first_name} <span className="opacity-60">· {ROLE_LABEL[e.role]?.[locale] ?? e.role}</span>{primary ? null : <span className="text-[9px] opacity-70">({L("สำรอง", "backup", "备")})</span>}
                          </span>
                        ))}
                        {!eligibleApprovers(detail).length ? <span className="text-[11px] text-muted">{L("ไม่พบผู้มีสิทธิ์ — ติดต่อแอดมิน/แบรนด์", "No eligible approver — contact admin", "无")}</span> : null}
                      </div>
                    </div>
                    {canApprove(detail) ? (
                      <Input value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder={L("เหตุผล/หมายเหตุอนุมัติ-ปฏิเสธ (ถ้ามี)", "Approval / rejection note (optional)", "审批备注")} className="h-9" />
                    ) : null}
                  </div>
                ) : null}
                {/* ผลอนุมัติ (หลังอนุมัติ/ปฏิเสธ) */}
                {detail.approved_by && detail.status !== "pending_approval" && detail.status !== "draft" ? (() => {
                  const ap = actorEmp(detail.approved_by, "approver", detail);
                  return (
                    <div className="rounded-2xl border border-line p-3 text-sm flex items-center gap-2 flex-wrap">
                      <Avatar name={empLabel(ap)} src={ap?.photo_url} size={28} />
                      <span className="text-muted">{["rejected", "cancelled"].includes(detail.status) ? L("ปฏิเสธโดย", "Rejected by", "拒绝人") : L("อนุมัติโดย", "Approved by", "审批人")}:</span>
                      <span className="font-medium">{empLabel(ap)}</span>
                      {ap ? <span className="text-[11px] text-muted">· {ROLE_LABEL[ap.role]?.[locale] ?? ap.role}</span> : null}
                      {detail.approval_note ? <span className="text-muted">· “{detail.approval_note}”</span> : null}
                    </div>
                  );
                })() : null}
                <p className="text-[11px] text-muted flex items-center gap-1.5"><CircleAlert size={12} /> {L("สแกนออก/รับเข้าได้จากหน้านี้ (กดสแกน SN — ป๊อปอัปขวา) หรือที่ POS สาขา", "Scan-out/receive here (tap Scan SN — right popup) or at branch POS", "可在此扫描出入库（右侧弹窗）")}</p>
                <div className="space-y-2">
                  {detail.items.map((it) => (
                    <div key={it.product_id} className="rounded-2xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2.5">
                          {prodImg(it.product_id) ? (
                            <img src={prodImg(it.product_id)!} alt="" className="w-11 h-11 rounded-xl object-cover border border-line bg-white shrink-0" loading="lazy" />
                          ) : (
                            <div className="w-11 h-11 rounded-xl border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={18} /></div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{it.name}{it.isSerialized === null ? <Badge tone="danger" className="ml-1">{L("ยังไม่จัดประเภท", "Unclassified", "未分类")}</Badge> : it.isSerialized ? <Barcode size={12} className="inline ml-1 text-brand" /> : null}</p>
                            <p className="font-mono text-[10px] text-muted">{it.sku}</p>
                          </div>
                        </div>
                        {it.isSerialized && (canScanOut(detail) || canReceive(detail)) ? (
                          <button
                            onClick={() => setScan({ pid: it.product_id, mode: scanModeOf(detail) })}
                            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-brand/40 text-brand text-xs font-medium hover:bg-brand/10 transition-colors"
                          >
                            <ScanLine size={14} /> {L("สแกน SN", "Scan SN", "扫码")} <span className="tnum">({scanned[it.product_id]?.length ?? 0}/{detail.status === "in_transit" ? (it.qty_shipped || it.qty_requested) : it.qty_requested})</span>
                          </button>
                        ) : null}
                      </div>
                      <ItemJourney req={it.qty_requested} shipped={it.qty_shipped} received={it.qty_received} L={L} />
                      {it.isSerialized && (it.shippedSerials?.length || it.quarantinedSerials?.length) ? (() => {
                        // กระทบ SN: คาด (ส่งมา) · ตรง (รับแล้ว) · นอกใบโอน (พักตรวจ) · ขาด (ส่งมาแต่ยังไม่พบ)
                        const shippedSN = (it.shippedSerials ?? []).map((s) => s.serialNo);
                        const recvSN = new Set((it.receivedSerials ?? []).map((s) => s.serialNo));
                        const quar = (it.quarantinedSerials ?? []).map((s) => s.serialNo);
                        const missing = shippedSN.filter((sn) => !recvSN.has(sn));
                        return (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                            <span className="text-muted">{L("กระทบ SN", "SN reconcile", "SN核对")}:</span>
                            <Badge tone="neutral">{L("คาด", "Exp", "应")} {shippedSN.length}</Badge>
                            <Badge tone="ok">{L("ตรง", "Matched", "匹配")} {recvSN.size}</Badge>
                            {missing.length ? <span title={missing.join(", ")}><Badge tone="warn">{L("ขาด", "Missing", "缺")} {missing.length}</Badge></span> : null}
                            {quar.length ? <span title={quar.join(", ")}><Badge tone="danger">{L("นอกใบโอน", "Not in order", "不在单")} {quar.length}</Badge></span> : null}
                          </div>
                        );
                      })() : null}
                    </div>
                  ))}
                </div>

                {/* สถานะขนส่ง (ย่อย) — เฉพาะช่วงระหว่างทาง */}
                {detail.status === "in_transit" ? (() => {
                  const curIdx = Math.max(0, SHIP_STAGES.findIndex((s) => s.key === (detail.ship_stage ?? "requested")));
                  const next = SHIP_STAGES[curIdx + 1];
                  const carrierName = carriers.find((c) => c.id === detail.carrier)?.name ?? detail.carrier;
                  return (
                    <div className="rounded-2xl border border-line p-3">
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="text-sm text-muted inline-flex items-center gap-1.5"><Truck size={15} /> {L("สถานะขนส่ง", "Shipping status", "物流状态")}{carrierName ? <span className="text-ink font-medium">· {carrierName}</span> : null}</span>
                      </div>
                      <div className="flex items-center gap-1 overflow-x-auto pb-1">
                        {SHIP_STAGES.map((st, i) => {
                          const reached = i <= curIdx, isCur = i === curIdx;
                          return (
                            <div key={st.key} className="flex items-center gap-1 shrink-0">
                              <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium border ${isCur ? "bg-brand text-brandInk border-brand" : reached ? "bg-brand/10 text-brand border-brand/30" : "bg-surface border-line text-muted"}`}>
                                {reached ? <Check size={11} /> : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />}{L(st.th, st.en, st.zh)}
                              </span>
                              {i < SHIP_STAGES.length - 1 ? <ChevronRight size={13} className="text-muted/50" /> : null}
                            </div>
                          );
                        })}
                      </div>
                      {canOut && atSource(detail) && next ? (
                        <Button variant="soft" className="mt-2.5" loading={busy} onClick={() => doShipStage(detail, next.key)}><Truck size={14} /> {L(`อัปเดตเป็น “${next.th}”`, `Mark “${next.en}”`, next.zh)}</Button>
                      ) : null}
                    </div>
                  );
                })() : null}

                {/* รอบรับเข้า (รับหลายรอบ) */}
                {detail.receipts?.length ? (
                  <div className="rounded-2xl border border-line overflow-hidden">
                    <p className="text-[11px] font-medium text-muted px-3.5 pt-3 pb-1">{L("รอบรับเข้า", "Receipt rounds", "收货记录")} ({detail.receipts.length})</p>
                    <div className="divide-y divide-line/60">
                      {detail.receipts.map((r, i) => (
                        <div key={r.id} className="px-3.5 py-2.5 flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full bg-brand/12 text-brand grid place-items-center text-[11px] font-bold shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{L("รอบที่", "Round", "第")} {i + 1} · {r.lines.reduce((s, l) => s + l.qty, 0)} {L("ชิ้น", "pcs", "件")}</p>
                            <p className="text-[11px] text-muted truncate">{L("โดย", "by", "由")} {empName(r.by)} · {dtShort(r.at)}{r.note ? ` · ${r.note}` : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* ผลต่างการรับ (ขาด/เกิน) + ปิดรับส่วนขาด + ปิดเรื่อง */}
                {(() => {
                  const DISC_LABEL: Record<string, string> = { short: L("ขาด (SN ไม่มา)", "Missing SN", "缺SN"), over: L("เกิน", "Over", "超"), damaged: L("ชำรุด", "Damaged", "损坏"), lost: L("สูญหาย", "Lost", "丢失"), wrong_sn: L("ผิด SN", "Wrong SN", "SN错误"), unexpected_sn: L("นอกใบโอน", "Not in order", "不在单") };
                  const locWhere = (w?: string | null) => w === "sold" ? L("ขายไปแล้ว", "sold", "已售") : w === "in_transit" ? L("กำลังส่ง", "in transit", "在途") : w === "in_stock" ? L("อยู่ในสต๊อก", "in stock", "在库") : L("ไม่รู้จักในระบบ", "unknown", "未知");
                  const pName = (pid: string) => products.find((p) => p.id === pid)?.name_th ?? detail.items.find((i) => i.product_id === pid)?.sku ?? pid;
                  const diffs = detail.items.map((it) => { const target = it.qty_shipped || it.qty_requested; return { pid: it.product_id, target, recv: it.qty_received || 0, diff: (it.qty_received || 0) - target }; }).filter((d) => d.diff !== 0);
                  const discs = detail.discrepancies ?? [];
                  // แจ้งของมีปัญหา (พักตรวจ) ได้เมื่อปลายทางกำลังรับ/รับแล้ว
                  const canReport = atDest(detail) && ["in_transit", "partial_received", "completed"].includes(detail.status);
                  if (!diffs.length && !discs.length && !canReport) return null;
                  const canClose = canReceive(detail) && detail.status === "partial_received";
                  const canResolve = can(employee, "transfer.approve") || isSuperApprover(employee); // หัวหน้า/เจ้าของ = อนุมัติปิด
                  const canRequest = atDest(detail) || canRecv || isSuperApprover(employee);        // ผู้รับปลายทาง = ขออนุมัติปิด
                  // สถานะผลต่าง 3 ขั้น
                  const DISC_ST: Record<string, { label: string; tone: "teal" | "warn" | "ok" | "info" }> = {
                    open: { label: L("รอตรวจสอบ", "Reviewing", "待核"), tone: "teal" },
                    handling: { label: L("กำลังส่งคืน", "Returning", "退回中"), tone: "info" },
                    pending_approval: { label: L("รออนุมัติปิด", "Pending approval", "待批"), tone: "warn" },
                    resolved: { label: L("แก้ไขแล้ว", "Resolved", "已处理"), tone: "ok" },
                  };
                  const openCnt = discs.filter((d) => d.status !== "resolved").length;
                  return (
                    <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium inline-flex items-center gap-1.5"><CircleAlert size={14} className="text-teal-600" /> {L("ผลต่างการรับ", "Receipt discrepancy", "收货差异")}</p>
                        {discs.length ? <Badge tone={openCnt ? "warn" : "ok"}>{openCnt ? L(`ยังไม่ปิด ${openCnt}`, `${openCnt} open`, `未结${openCnt}`) : L("ปิดครบแล้ว", "All resolved", "已全部处理")}</Badge> : null}
                      </div>
                      {diffs.map((d) => (
                        <div key={d.pid} className="text-xs flex items-center justify-between gap-2">
                          <span className="truncate flex-1">{pName(d.pid)}</span>
                          <span className={`shrink-0 ${d.diff < 0 ? "text-rose-600 font-medium" : "text-teal-600 font-medium"}`}>{L("ส่ง", "ship", "发")} {d.target} · {L("รับ", "recv", "收")} {d.recv} · {d.diff < 0 ? `${L("ขาด", "short", "缺")} ${-d.diff}` : `${L("เกิน", "over", "超")} ${d.diff}`}</span>
                        </div>
                      ))}
                      {canClose ? <>
                        <p className="text-[11px] text-muted leading-relaxed">{L("“รับไม่ครบ” ไม่เท่ากับ “ของหาย” — อาจส่งแยกกล่อง ควรติดตามก่อนปิด · ถ้าได้ของชำรุด/SN ผิด ให้พักไว้ไม่ขายจนกว่าจะตรวจสอบ", "“Partial” ≠ “lost” — track before closing", "部分≠丢失")}</p>
                        <Button variant="ghost" className="w-full" loading={busy} onClick={() => doCloseShort(detail)}><CircleAlert size={14} /> {L("ปิดรับ (ยอมรับส่วนขาด + บันทึกผลต่าง)", "Close with shortage", "结单·接受缺量")}</Button>
                      </> : null}
                      {discs.length ? (
                        <div className="space-y-2 pt-2 border-t border-teal-500/20">
                          <p className="text-[11px] font-medium text-muted">{L("สถานะผลต่าง (แยกจากสถานะใบโอน)", "Discrepancy status (separate from transfer)", "差异状态")}</p>
                          {discs.map((dc) => {
                            const stt = DISC_ST[dc.status] ?? DISC_ST.open;
                            const isQuar = dc.kind === "damaged" || dc.kind === "wrong_sn" || dc.kind === "unexpected_sn"; // ของพักตรวจปลายทาง
                            const isMissing = dc.kind === "short" || dc.kind === "lost";                                   // SN ไม่มา
                            return (
                              <div key={dc.id} className="flex items-start justify-between gap-2 text-[11px] flex-wrap">
                                <span className="min-w-0 flex-1">
                                  <b className="text-ink/80">{DISC_LABEL[dc.kind]}</b> · {pName(dc.product_id)} × {dc.qty}
                                  {dc.serialNo ? <code className="ml-1 px-1 py-0.5 rounded bg-surface border border-line font-mono text-[10px]">{dc.serialNo}</code> : null}
                                  {dc.kind === "unexpected_sn" && dc.located ? <span className="ml-1 text-muted">· {L("ที่มา", "origin", "来源")}: {locWhere(dc.located.where)}{dc.located.branchId ? ` (${bName(dc.located.branchId)})` : ""}</span> : null}
                                  {dc.handled_by_return ? <span className="ml-1 text-sky-600">· {L("กำลังส่งคืน", "returning via", "退回")} {dc.handled_by_return}</span> : null}
                                  {dc.replacement_no ? <span className="ml-1 text-brand">· {L("ส่งทดแทน", "replacement", "替代")} {dc.replacement_no}</span> : null}
                                  {dc.responsible_by ? <span className="text-muted"> · {L("ผู้รับผิดชอบ", "resp.", "负责")} {empName(dc.responsible_by)}</span> : null}
                                </span>
                                <span className="shrink-0 inline-flex items-center gap-1.5 flex-wrap justify-end">
                                  <Badge tone={stt.tone}>{stt.label}</Badge>
                                  {/* พักตรวจ (ชำรุด/SN ผิด/นอกใบโอน) — ส่งคืน · ยอมรับ · ตัดทิ้ง */}
                                  {dc.status === "open" && isQuar && canRequest ? <>
                                    {dc.qty > 1 ? <span className="inline-flex items-center gap-0.5 text-muted">{L("จำนวน", "qty", "数")}<input type="number" min={1} max={dc.qty} value={openQty[dc.id] ?? dc.qty} onChange={(e) => setOpenQty((o) => ({ ...o, [dc.id]: Math.max(1, Math.min(dc.qty, Number(e.target.value) || 1)) }))} className="w-11 h-6 text-center rounded border border-line bg-surface text-[11px]" />/{dc.qty}</span> : null}
                                    <button onClick={() => doOpenReturn(detail, dc, "return_source")} className="text-brand hover:underline font-medium">{L("ส่งคืนต้นทาง", "Return", "退回")}</button>
                                    {dc.kind === "unexpected_sn"
                                      ? (canResolve ? <button onClick={() => doResolveSn(detail, dc.id, "accept")} className="text-ok hover:underline font-medium">{L("ยอมรับที่ปลายทาง", "Accept here", "此处接收")}</button> : <button onClick={() => doRequestResolve(detail, dc.id)} className="text-muted hover:underline font-medium">{L("ส่งอนุมัติ", "Request", "送审")}</button>)
                                      : <><button onClick={() => doOpenReturn(detail, dc, "repair")} className="text-amber-600 hover:underline font-medium">{L("ส่งซ่อม", "Repair", "维修")}</button><button onClick={() => doRequestResolve(detail, dc.id)} className="text-muted hover:underline font-medium">{L("ส่งอนุมัติปิด", "Request close", "送审")}</button></>}
                                  </> : null}
                                  {/* SN ไม่มา (ขาด/สูญหาย) — ส่งทดแทน · ติดตาม · ปิดเคส */}
                                  {dc.status === "open" && isMissing ? <>
                                    {dc.sn_outcome !== "replaced" ? <button onClick={() => doMakeReplacement(detail, dc)} className="text-brand hover:underline font-medium">{L("ส่งทดแทน", "Send replacement", "补发")}</button> : <span className="text-brand">{L("ส่งทดแทนแล้ว", "replacement sent", "已补发")}</span>}
                                    {canResolve
                                      ? <><button onClick={() => doResolveSn(detail, dc.id, "found_source")} className="text-ok hover:underline font-medium">{L("พบที่ต้นทาง", "Found at source", "源门店找到")}</button><button onClick={() => doResolveSn(detail, dc.id, "confirmed_lost")} className="text-rose-600 hover:underline font-medium">{L("ยืนยันสูญหาย", "Confirm lost", "确认丢失")}</button></>
                                      : (canRequest ? <button onClick={() => doRequestResolve(detail, dc.id)} className="text-muted hover:underline font-medium">{L("ขออนุมัติปิด", "Request close", "送审")}</button> : <span className="text-amber-600 font-medium">{L("กำลังติดตาม", "Tracking", "跟踪中")}</span>)}
                                  </> : null}
                                  {/* รออนุมัติปิด (หัวหน้า) */}
                                  {dc.status === "pending_approval" && canResolve ? (
                                    dc.kind === "unexpected_sn"
                                      ? <><button onClick={() => doResolveSn(detail, dc.id, "accept")} className="text-ok hover:underline font-medium">{L("ยอมรับที่ปลายทาง", "Accept here", "接收")}</button><button onClick={() => doResolveSn(detail, dc.id, "dispose")} className="text-rose-600 hover:underline font-medium">{L("ตัดจำหน่าย", "Dispose", "报废")}</button></>
                                      : (dc.kind === "damaged" || dc.kind === "wrong_sn")
                                        ? <><button onClick={() => doResolveDisc(detail, dc.id, "release")} className="text-ok hover:underline font-medium">{L("ปล่อยขายหลังตรวจ", "Release to sale", "放行")}</button><button onClick={() => doResolveDisc(detail, dc.id, "dispose")} className="text-rose-600 hover:underline font-medium">{L("อนุมัติตัดจำหน่าย", "Approve write-off", "批准报废")}</button></>
                                        : <><button onClick={() => doResolveSn(detail, dc.id, "found_source")} className="text-ok hover:underline font-medium">{L("พบที่ต้นทาง", "Found at source", "源门店找到")}</button><button onClick={() => doResolveSn(detail, dc.id, "confirmed_lost")} className="text-rose-600 hover:underline font-medium">{L("ยืนยันสูญหาย", "Confirm lost", "确认丢失")}</button></>
                                  ) : null}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {/* แจ้งของมีปัญหา (ชำรุด/SN ผิด) → พักตรวจ ขายไม่ได้ */}
                      {canReport ? (
                        <div className="pt-2 border-t border-teal-500/20">
                          {repOpen ? (
                            <div className="space-y-2">
                              <div className="flex gap-1.5">
                                {((["in_transit", "partial_received"].includes(detail.status) ? ["lost", "damaged", "wrong_sn"] : ["damaged", "wrong_sn"]) as ("damaged" | "wrong_sn" | "lost")[]).map((k) => (
                                  <button key={k} onClick={() => setRepKind(k)} className={`flex-1 h-8 rounded-lg border text-[11px] font-medium ${repKind === k ? "border-rose-400 bg-rose-500/10 text-rose-600" : "border-line text-muted"}`}>{k === "damaged" ? L("ชำรุด", "Damaged", "损坏") : k === "wrong_sn" ? L("SN ผิด", "Wrong SN", "SN错") : L("ไม่พบ/สูญหาย", "Missing/lost", "丢失")}</button>
                                ))}
                              </div>
                              <Select value={repPid || detail.items[0]?.product_id} onChange={(e) => { setRepPid(e.target.value); setRepSn(""); }} className="h-9 w-full text-xs">{detail.items.map((it) => <option key={it.product_id} value={it.product_id}>{pName(it.product_id)}</option>)}</Select>
                              {(() => {
                                const ri = detail.items.find((i) => i.product_id === (repPid || detail.items[0]?.product_id));
                                if (!ri?.isSerialized) return null;
                                const recv = new Set((ri.receivedSerials ?? []).map((s) => s.serialNo));
                                // ชำรุด/SN ผิด → เลือกจาก SN ที่รับแล้ว · ไม่พบ/สูญหาย → เลือกจาก SN ที่ส่งมาแต่ยังไม่พบ
                                const opts = repKind === "lost" ? (ri.shippedSerials ?? []).map((s) => s.serialNo).filter((sn) => !recv.has(sn)) : [...recv];
                                return (
                                  <Select value={repSn} onChange={(e) => setRepSn(e.target.value)} className="h-9 w-full text-xs font-mono">
                                    <option value="">{opts.length ? L("— เลือก SN ที่มีปัญหา —", "— pick affected SN —", "— 选SN —") : L("(ไม่มี SN ให้เลือก)", "(no SN)", "(无SN)")}</option>
                                    {opts.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
                                  </Select>
                                );
                              })()}
                              <div className="flex gap-1.5">
                                <Input type="number" min={1} value={repSn ? 1 : repQty} disabled={!!repSn} onChange={(e) => setRepQty(Math.max(1, Math.round(Number(e.target.value) || 1)))} className="h-9 w-20 text-xs" />
                                <Button variant="primary" className="h-9 flex-1" loading={busy} onClick={() => { doRecordDamage(detail, repPid || detail.items[0].product_id, repKind, repSn ? 1 : repQty, repSn || null); setRepOpen(false); setRepQty(1); setRepPid(""); setRepSn(""); }}><CircleAlert size={13} /> {repKind === "lost" ? L("แจ้งไม่พบ (ติดตาม)", "Report missing", "报失") : L("พักตรวจ (ขายไม่ได้)", "Quarantine", "暂扣")}</Button>
                                <Button variant="ghost" className="h-9" onClick={() => setRepOpen(false)}><X size={13} /></Button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => setRepOpen(true)} className="w-full h-11 rounded-xl border-2 border-rose-300 bg-rose-50 text-rose-700 font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-rose-100 transition-colors"><CircleAlert size={16} /> {["in_transit", "partial_received"].includes(detail.status) ? L("แจ้งปัญหา: ไม่พบ/สูญหาย · ชำรุด · SN ไม่ตรง", "Report: missing / damaged / wrong SN", "报告：丢失/损坏/SN错") : L("แจ้งปัญหา: ของชำรุด / SN ไม่ตรง (พักไว้ ขายไม่ได้)", "Report: damaged / wrong SN", "报告：损坏/SN错")}</button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* ใบส่งคืน (Return Doc) — วงจร 7 ขั้น + สถานะขนส่ง */}
                {(() => {
                  const pName = (pid: string) => products.find((p) => p.id === pid)?.name_th ?? detail.items.find((i) => i.product_id === pid)?.sku ?? pid;
                  const returns = (detail.returns ?? []).filter((r) => (r.lines?.length ?? 0) > 0);
                  if (!returns.length) return null;
                  const canResolve = can(employee, "transfer.approve") || isSuperApprover(employee);
                  const isDest = atDest(detail); const canRecvRet = canRecv && atSource(detail);
                  const STEPS = [L("ร่าง", "Draft", "草稿"), L("รออนุมัติ", "Approve", "待批"), L("อนุมัติ", "Approved", "已批"), L("ส่งคืน", "Ship", "退回"), L("รับคืน", "Receive", "收回"), L("ปิดงาน", "Closed", "结案")];
                  const STEP_OF: Record<string, number> = { draft: 0, pending_approval: 1, approved: 2, preparing: 2, returning: 3, partial_received: 4, received: 4, closed: 5, cancelled: -1 };
                  const RET_ST: Record<string, { label: string; tone: "warn" | "info" | "ok" | "neutral" | "danger" }> = {
                    draft: { label: L("ร่าง", "Draft", "草稿"), tone: "neutral" }, pending_approval: { label: L("รออนุมัติ", "Pending", "待批"), tone: "warn" },
                    approved: { label: L("อนุมัติ · รอจัดส่ง", "Approved", "已批"), tone: "info" }, preparing: { label: L("เตรียมส่ง", "Preparing", "备货"), tone: "info" },
                    returning: { label: L("กำลังส่งคืน", "Returning", "退回中"), tone: "info" }, partial_received: { label: L("รับคืนบางส่วน", "Partial", "部分收回"), tone: "warn" },
                    received: { label: L("รับคืนครบ", "Received", "已收回"), tone: "ok" }, closed: { label: L("ปิดงาน", "Closed", "结案"), tone: "ok" }, cancelled: { label: L("ยกเลิก", "Cancelled", "已取消"), tone: "danger" },
                  };
                  return (
                    <div className="space-y-2.5">
                      {returns.map((r) => {
                        const total = (r.lines ?? []).reduce((s, l) => s + l.qty, 0); const recv = (r.lines ?? []).reduce((s, l) => s + (l.qty_received ?? 0), 0);
                        const si = STEP_OF[r.status] ?? 0; const st = RET_ST[r.status] ?? RET_ST.draft;
                        // สินค้ามี SN ต้องสแกนของที่จะส่งคืนให้ครบก่อน dispatch
                        const serialLines = (r.lines ?? []).filter((l) => products.find((p) => p.id === l.product_id)?.track_serial);
                        const packedOk = serialLines.every((l) => (l.sns_found?.length ?? 0) >= l.qty);
                        let hint = ""; const isRepair = r.outcome === "repair";
                        if (r.status === "draft" && isDest) hint = L("กด “ส่งคำขอตรวจ” ให้หัวหน้าอนุมัติ", "Tap Request approval", "送审");
                        else if (r.status === "pending_approval" && canResolve) hint = L("หัวหน้ากด “อนุมัติใบส่งคืน”", "Supervisor approves", "审批");
                        else if ((r.status === "approved" || r.status === "preparing") && isDest) hint = !packedOk ? L("สแกน SN ของที่จะส่งคืนให้ครบก่อน แล้วเลือกขนส่ง → “ยืนยันส่งคืน”", "Scan return serials first, then confirm", "先扫描退回SN") : L("เลือกขนส่ง + เลขติดตาม แล้วกด “ยืนยันส่งคืน” (ของออกจากสาขา)", "Pick carrier + tracking, then Confirm return", "选承运后确认");
                        else if (r.status === "returning" && canRecvRet) hint = L("ของถึงต้นทางแล้ว กด “ยืนยันรับคืน” (เข้าพักตรวจ ไม่ขายอัตโนมัติ)", "Confirm receive (into quarantine)", "确认收回·暂扣");
                        else if (r.status === "returning") hint = L("กำลังส่งคืน — รอต้นทางรับ", "Returning — awaiting source", "退回中");
                        else if ((r.status === "received" || r.status === "partial_received") && canResolve) hint = L("ตรวจสภาพแล้วเลือก: ปล่อยขาย / ส่งซ่อม / ตัดจำหน่าย", "Inspect then release / repair / dispose", "检后处理");
                        return (
                          <div key={r.id} className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-sm font-semibold inline-flex items-center gap-1.5"><RotateCcw size={14} className="text-rose-600" /> {r.return_no ?? L("ใบส่งคืน", "Return", "退回单")}
                                <Badge tone={isRepair ? "warn" : "neutral"}>{isRepair ? L("ส่งซ่อม", "Repair", "维修") : L("ส่งคืนต้นทาง", "Return to source", "退回")}</Badge></span>
                              <Badge tone={st.tone === "neutral" ? "info" : st.tone === "danger" ? "danger" : st.tone}>{st.label}</Badge>
                            </div>
                            {/* stepper ย่อ */}
                            {r.status !== "cancelled" ? (
                              <div className="flex items-center gap-1">
                                {STEPS.map((s, i) => (<div key={i} className="flex items-center gap-1 flex-1 last:flex-none">
                                  <span className={`w-5 h-5 rounded-full grid place-items-center text-[9px] font-bold shrink-0 ${i < si ? "bg-ok text-white" : i === si ? "bg-brand text-white" : "bg-surface2 text-muted"}`}>{i < si ? "✓" : i + 1}</span>
                                  <span className={`text-[9px] ${i === si ? "text-ink font-medium" : "text-muted"} hidden sm:inline`}>{s}</span>
                                  {i < STEPS.length - 1 ? <span className={`flex-1 h-px ${i < si ? "bg-ok" : "bg-line"}`} /> : null}
                                </div>))}
                              </div>
                            ) : null}
                            {hint ? <div className="rounded-xl bg-white/70 border border-rose-200 px-3 py-2 text-[12px] text-rose-900 leading-relaxed flex items-start gap-1.5"><CornerDownRight size={14} className="shrink-0 mt-0.5" /><span>{hint}</span></div> : null}
                            {/* รายการ */}
                            <div className="text-[11px] text-muted space-y-0.5">
                              {(r.lines ?? []).map((l, i) => { const sns = [...new Set([...(l.sns_found ?? []), ...(l.sns_expected ?? [])])]; return <div key={i} className="flex flex-wrap items-center gap-1">{pName(l.product_id)} × {l.qty}{(l.qty_received ?? 0) > 0 ? ` · ${L("รับคืน", "recv", "收")} ${l.qty_received}/${l.qty}` : ""}{l.close_outcome ? ` · ${l.close_outcome === "release" ? L("ปล่อยขาย", "released", "放行") : l.close_outcome === "repair" ? L("ส่งซ่อม", "repair", "维修") : L("ตัดจำหน่าย", "disposed", "报废")}` : ""}{sns.map((s) => <code key={s} className={`px-1 py-0.5 rounded font-mono text-[9.5px] border ${(l.sns_found ?? []).includes(s) ? "bg-ok/10 border-ok/40 text-ok" : "bg-surface border-line"}`} title={(l.sns_found ?? []).includes(s) ? L("สแกนยืนยันแล้ว", "scanned", "已扫") : L("SN ที่ต้องคืน", "expected", "应退")}>{s}</code>)}</div>; })}
                              {r.reason ? <div className="italic">“{r.reason}”</div> : null}
                              {r.carrier ? <div>{L("ขนส่ง", "Carrier", "承运")}: {carriers.find((c) => c.id === r.carrier)?.name ?? r.carrier}{r.tracking ? ` · ${r.tracking}` : ""}</div> : null}
                            </div>
                            {/* ปุ่มตามขั้น */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {r.status === "draft" && isDest ? <><Button variant="primary" className="h-9" loading={busy} onClick={() => doReqReturn(detail, r.id)}>{L("ส่งคำขอตรวจ", "Request approval", "送审")}</Button><Button variant="ghost" className="h-9 text-rose-600" loading={busy} onClick={() => doCancelReturn(detail, r.id)}>{L("ยกเลิก", "Cancel", "取消")}</Button></> : null}
                              {r.status === "pending_approval" && canResolve ? <><Button variant="primary" className="h-9" loading={busy} onClick={() => doApproveReturn(detail, r.id)}><Check size={14} /> {L("อนุมัติ", "Approve", "批准")}</Button><Button variant="ghost" className="h-9 text-rose-600" loading={busy} onClick={() => doCancelReturn(detail, r.id)}>{L("ยกเลิก", "Cancel", "取消")}</Button></> : null}
                              {(r.status === "approved" || r.status === "preparing") && isDest ? <>
                                {(r.lines ?? []).filter((l) => products.find((p) => p.id === l.product_id)?.track_serial).map((l) => <button key={l.product_id} onClick={() => setRetScan({ retId: r.id, pid: l.product_id, name: pName(l.product_id), expected: l.sns_expected ?? [], initial: l.sns_found ?? l.sns_expected ?? [], mode: "pack" })} className={`h-9 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1 ${(l.sns_found?.length ?? 0) >= l.qty ? "border-ok/50 text-ok bg-ok/5" : "border-brand/40 text-brand"}`}><ScanLine size={13} /> {L("สแกน SN", "Scan SN", "扫码")} ({l.sns_found?.length ?? 0}/{l.qty})</button>)}
                                <Select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-9 w-32"><option value="">{L("ขนส่ง…", "Carrier…", "承运…")}</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                                <Input value={retTracking} onChange={(e) => setRetTracking(e.target.value)} placeholder={L("เลขติดตาม", "Tracking", "单号")} className="h-9 w-32 text-xs" />
                                <Button variant="primary" className="h-9" loading={busy} disabled={!packedOk} title={!packedOk ? L("สแกน SN ให้ครบก่อน", "Scan serials first", "先扫码") : undefined} onClick={() => doDispatchReturn(detail, r.id)}><Truck size={14} /> {L("ยืนยันส่งคืน", "Confirm return", "确认退回")}</Button>
                                <Button variant="ghost" className="h-9 text-rose-600" loading={busy} onClick={() => doCancelReturn(detail, r.id)}>{L("ยกเลิก", "Cancel", "取消")}</Button>
                              </> : null}
                              {r.status === "returning" || r.status === "partial_received" ? <>
                                {isDest && r.status === "returning" ? <div className="inline-flex gap-1">{([["called", L("เรียกรถ", "Called", "叫车")], ["picked_up", L("รับแล้ว", "Picked", "取货")], ["handed", L("ส่งมอบ", "Handed", "交付")]] as const).map(([k, lb]) => <button key={k} onClick={() => doReturnShipStage(detail, r.id, k)} className={`h-8 px-2 rounded-lg border text-[11px] ${r.ship_stage === k ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"}`}>{lb}</button>)}</div> : null}
                                {canRecvRet ? <>
                                  {/* สินค้ามี SN → สแกน SN รับคืน ทีละตัว (ยืนยันว่าตรงกับที่ส่งคืน) */}
                                  {(r.lines ?? []).filter((l) => products.find((p) => p.id === l.product_id)?.track_serial && (l.qty - (l.qty_received ?? 0)) > 0).map((l) => <button key={l.product_id} onClick={() => setRetScan({ retId: r.id, pid: l.product_id, name: pName(l.product_id), expected: l.sns_found?.length ? l.sns_found : (l.sns_expected ?? []), initial: [], mode: "recv" })} className="h-9 px-2.5 rounded-lg border border-brand/40 text-brand text-xs inline-flex items-center gap-1"><ScanLine size={13} /> {L("สแกน SN รับคืน", "Scan to receive", "扫码收回")}</button>)}
                                  {(r.lines ?? []).some((l) => !products.find((p) => p.id === l.product_id)?.track_serial && (l.qty - (l.qty_received ?? 0)) > 1) ? <div className="w-full flex flex-wrap gap-2 items-center">{(r.lines ?? []).filter((l) => !products.find((p) => p.id === l.product_id)?.track_serial && (l.qty - (l.qty_received ?? 0)) > 0).map((l) => { const remain = l.qty - (l.qty_received ?? 0); return <span key={l.product_id} className="inline-flex items-center gap-1 text-[11px] text-muted">{L("รับ", "recv", "收")}<input type="number" min={0} max={remain} value={retLineQty[`${r.id}:${l.product_id}`] ?? remain} onChange={(e) => setRetLineQty((o) => ({ ...o, [`${r.id}:${l.product_id}`]: Math.max(0, Math.min(remain, Number(e.target.value) || 0)) }))} className="w-12 h-7 text-center rounded border border-line bg-surface" />/{remain}</span>; })}</div> : null}
                                  {(r.lines ?? []).some((l) => !products.find((p) => p.id === l.product_id)?.track_serial && (l.qty - (l.qty_received ?? 0)) > 0) ? <Button variant="primary" className="h-9" loading={busy} onClick={() => doReceiveRet(detail, r)}><PackageCheck size={14} /> {L("ยืนยันรับคืน (ไม่มี SN)", "Receive non-serial", "收回(无SN)")}</Button> : null}
                                </> : null}
                              </> : null}
                              {(r.status === "received" || r.status === "partial_received") && canResolve ? <>
                                <span className="text-[11px] text-muted">{L("ตรวจสภาพ", "Inspect", "检查")} ({recv}/{total}):</span>
                                <Button variant="soft" className="h-9" loading={busy} onClick={() => doCloseReturn(detail, r, "release")}>{L("ปล่อยขาย", "Release", "放行")}</Button>
                                <Button variant="ghost" className="h-9 text-amber-600" loading={busy} onClick={() => doCloseReturn(detail, r, "repair")}>{L("ส่งซ่อม", "Repair", "维修")}</Button>
                                <Button variant="ghost" className="h-9 text-rose-600" loading={busy} onClick={() => doCloseReturn(detail, r, "dispose")}>{L("ตัดจำหน่าย", "Dispose", "报废")}</Button>
                              </> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* มอนิเตอร์สต๊อก — ของอยู่สาขาไหน จำนวนเท่าไร สถานะอะไร (คู่กับสถานะใบโอน) */}
                <div className="rounded-2xl border border-line p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium inline-flex items-center gap-1.5"><Boxes size={15} /> {L("มอนิเตอร์สต๊อก — ของอยู่ไหนตอนนี้", "Stock monitor — where is it now", "库存位置")}</span>
                    <Badge tone={stockStatus(detail.status).tone}>{stockStatus(detail.status).label}</Badge>
                  </div>
                  {(() => {
                    const retLines = (detail.returns ?? []).filter((r) => ["returning", "partial_received"].includes(r.status as string)).flatMap((r) => r.lines ?? []);
                    const inReturn = (pid: string) => retLines.filter((l) => l.product_id === pid).reduce((s, l) => s + (l.qty - (l.qty_received ?? 0)), 0);
                    const Chip = ({ n, label, tone }: { n: number; label: string; tone: string }) => n > 0 ? <span className={`text-[10.5px] px-1.5 py-0.5 rounded-md font-medium ${tone}`}>{label} {n}</span> : null;
                    return detail.items.map((it) => {
                      const sv = viewAt(detail.from_branch_id, it.product_id); const dv = viewAt(detail.to_branch_id, it.product_id); const ir = inReturn(it.product_id);
                      return (
                        <div key={it.product_id} className="rounded-xl border border-line/70 bg-surface2/30 p-2.5">
                          <p className="text-xs font-medium text-ink mb-1.5 truncate">{products.find((p) => p.id === it.product_id)?.name_th ?? it.sku}</p>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded-lg bg-surface border border-line px-2 py-1.5">
                              <p className="text-muted mb-1 truncate inline-flex items-center gap-1"><Home size={12} className="shrink-0 text-ink/50" /> {L("ต้นทาง", "Source", "源")} · {bName(detail.from_branch_id)}</p>
                              <div className="flex flex-wrap gap-1">
                                <Chip n={sv.available} label={L("พร้อมขาย", "avail", "可售")} tone="bg-emerald-100 text-emerald-700" />
                                <Chip n={sv.reservedOut} label={L("จองส่ง", "reserved", "预留")} tone="bg-sky-100 text-sky-700" />
                                <Chip n={sv.otwo} label={L("กำลังส่งออก", "in-transit", "在途")} tone="bg-indigo-100 text-indigo-700" />
                                <Chip n={sv.quarantine} label={L("พักตรวจ", "quarantine", "暂扣")} tone="bg-rose-100 text-rose-700" />
                                {sv.available + sv.reservedOut + sv.otwo + sv.quarantine === 0 ? <span className="text-muted">—</span> : null}
                              </div>
                            </div>
                            <div className="rounded-lg bg-surface border border-line px-2 py-1.5">
                              <p className="text-muted mb-1 truncate inline-flex items-center gap-1"><MapPin size={12} className="shrink-0 text-ink/50" /> {L("ปลายทาง", "Dest", "目的")} · {bName(detail.to_branch_id)}</p>
                              <div className="flex flex-wrap gap-1">
                                <Chip n={dv.available} label={L("พร้อมขาย", "avail", "可售")} tone="bg-emerald-100 text-emerald-700" />
                                <Chip n={dv.quarantine} label={L("พักตรวจ", "quarantine", "暂扣")} tone="bg-rose-100 text-rose-700" />
                                <Chip n={ir} label={L("กำลังส่งคืน", "returning", "退回中")} tone="bg-amber-100 text-amber-700" />
                                {dv.available + dv.quarantine + ir === 0 ? <span className="text-muted">—</span> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <p className="text-[10px] text-muted leading-relaxed">{L("พร้อมขาย=ขายได้ · จองส่ง=กันไว้รอส่ง · กำลังส่งออก=ออกจากต้นทางยังไม่ถึงปลายทาง · พักตรวจ=ชำรุด/รอตรวจ ขายไม่ได้ · กำลังส่งคืน=อยู่ระหว่างคืนต้นทาง", "avail=sellable · reserved=held · in-transit=left source · quarantine=held for inspection · returning=being returned", "")}</p>
                </div>

                {/* เอกสาร / รูปแนบ (ไม่จำกัด) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{L("เอกสาร / รูปแนบ", "Files / images", "文件/图片")} <span className="text-muted font-normal">({atts.length})</span></p>
                    <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-brand/40 text-brand text-xs font-medium hover:bg-brand/10 cursor-pointer transition-colors">
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploading ? L("กำลังอัปโหลด…", "Uploading…", "上传中…") : L("เพิ่มไฟล์", "Add files", "添加")}
                      <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" className="hidden" onChange={(e) => { void onUploadFiles(e.target.files); e.currentTarget.value = ""; }} />
                    </label>
                  </div>
                  {atts.length ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {atts.map((a, idx) => (
                        <div key={a.id} className="relative group rounded-xl border border-line overflow-hidden bg-surface2">
                          {a.type.startsWith("image/")
                            ? <button onClick={() => setLbIdx(idx)} className="block w-full"><img src={a.url} alt={a.name} className="w-full h-20 object-cover" /></button>
                            : <button onClick={() => downloadAtt(a)} className="flex flex-col items-center justify-center h-20 gap-1 p-2 text-center w-full"><FileText size={22} className="text-muted" /><span className="text-[9px] text-muted truncate w-full">{a.name}</span></button>}
                          <button onClick={() => void removeAttachment(a.id)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={11} /></button>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted">{L("ยังไม่มีไฟล์แนบ — เพิ่มรูปสินค้า/เอกสารได้ไม่จำกัด", "No files yet — add product photos / documents", "暂无附件")}</p>}
                </div>
              </div>
            ) : <TransferTimeline rows={timeline} locale={locale} L={L} />}
          </>
        ) : null}
      </Drawer>

      {/* ป๊อปอัปขวา: สแกน SN (ออก/เข้า) */}
      {detail && scan ? (() => {
        const it = detail.items.find((x) => x.product_id === scan.pid);
        if (!it) return null;
        const qty = scan.mode === "in" ? (it.qty_shipped || it.qty_requested) : it.qty_requested;
        return (
          <SerialScanDrawer
            open
            onClose={() => setScan(null)}
            mode={scan.mode}
            product={{ name: it.name, sku: it.sku, image: prodImg(it.product_id) }}
            qty={qty}
            shipped={(it.shippedSerials ?? []).map((s) => s.serialNo)}
            initial={scanned[it.product_id] ?? []}
            onSave={saveScan}
            locale={locale as "th" | "en" | "zh"}
          />
        );
      })() : null}

      {/* สแกน SN ขาส่งคืน — pack (บันทึก SN ที่คืน) / recv (ต้นทางสแกนรับคืน ยืนยันตรง) */}
      {retScan ? (
        <SerialScanDrawer
          open
          onClose={() => setRetScan(null)}
          mode="in"
          product={{ name: retScan.name, image: prodImg(retScan.pid) }}
          qty={retScan.expected.length || 0}
          shipped={retScan.expected}
          initial={retScan.initial}
          onSave={saveRetScan}
          locale={locale as "th" | "en" | "zh"}
        />
      ) : null}

      {/* คำขอสินค้าเข้าสาขา (slide-over ขวา) — ปลายทางเปิดคำขอ ระบบแนะนำสาขาที่มีของ+ใกล้สุด */}
      <Drawer open={reqOpen} onClose={() => setReqOpen(false)} title={L("ขอสินค้าเข้าสาขา", "Request stock in", "申请调入")} width="lg"
        subtitle={reqDest ? `${L("เข้าสาขา", "To", "调入")} ${bName(reqDest)}` : undefined}
        footer={<><Button variant="ghost" onClick={() => setReqOpen(false)}>{t.common.cancel}</Button>
          <Button variant="primary" className="ml-auto" loading={busy} disabled={!reqSource || !reqProduct || reqQty < 1} onClick={() => void submitRequest()}>{L("ส่งคำขอ → รอต้นทางอนุมัติ", "Send request", "发送申请")}</Button></>}>
        <div className="p-5 space-y-4">
          <Field label={L("สาขาของฉัน (ปลายทางที่รับเข้า)", "My branch (destination)", "我的门店（收货）")}>
            <Select value={reqDest} onChange={(e) => { setReqDest(e.target.value); setReqSource(""); }}>{branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{bName(b.id)}</option>)}</Select>
          </Field>
          {/* เลือกสินค้า */}
          {!reqProduct ? (
            <div>
              <div className="relative mb-2"><Barcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input value={reqQ} onChange={(e) => setReqQ(e.target.value)} placeholder={L("ค้นหาสินค้าที่ต้องการ (ชื่อ/SKU)", "Search product (name/SKU)", "搜索商品")} className="pl-9 h-10" autoFocus /></div>
              <div className="max-h-72 overflow-auto rounded-xl border border-line divide-y divide-line/60">
                {products.filter((p) => p.kind !== "service").filter((p) => { const q = reqQ.trim().toLowerCase(); return !q || p.name_th.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q); }).slice(0, 30).map((p) => (
                  <button key={p.id} onClick={() => { setReqProductId(p.id); setReqSource(""); setReqQty(1); }} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-brand/5 text-left">
                    {p.image_url ? <img src={p.image_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-line bg-white shrink-0" /> : <div className="w-9 h-9 rounded-lg border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={15} /></div>}
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{p.name_th}</p><p className="font-mono text-[10px] text-muted">{p.sku}</p></div>
                    <span className="text-[11px] text-muted">{L("มี", "in", "")} {branches.filter((b) => availAt(b.id, p.id) > 0).length} {L("สาขา", "branches", "店")}</span>
                  </button>
                ))}
                {!products.filter((p) => p.kind !== "service").some((p) => { const q = reqQ.trim().toLowerCase(); return !q || p.name_th.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q); }) ? <div className="p-4 text-center text-xs text-muted">{t.common.empty}</div> : null}
              </div>
            </div>
          ) : (
            <>
              {/* สินค้าที่เลือก */}
              <div className="flex items-center gap-3 rounded-xl border border-line p-3">
                {reqProduct.image_url ? <img src={reqProduct.image_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-line bg-white" /> : <div className="w-12 h-12 rounded-lg border border-line bg-surface grid place-items-center text-muted/40"><Boxes size={18} /></div>}
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{reqProduct.name_th}</p><p className="font-mono text-[10px] text-muted">{reqProduct.sku}</p></div>
                <button onClick={() => { setReqProductId(""); setReqSource(""); }} className="text-xs text-brand hover:underline">{L("เปลี่ยน", "Change", "更换")}</button>
              </div>
              {/* สาขาที่มีของ — เรียงใกล้สุด */}
              <div>
                <p className="text-[11px] text-muted mb-1.5">{L("เลือกสาขาต้นทาง — เรียงตามใกล้ที่สุดที่มีของ", "Pick source — nearest with stock first", "选择调出门店（最近且有货）")}</p>
                {reqSources.length ? (
                  <div className="space-y-1.5 max-h-72 overflow-auto">
                    {reqSources.map(({ b, avail, km }, i) => (
                      <button key={b.id} onClick={() => { setReqSource(b.id); setReqQty((q) => Math.min(Math.max(1, q), avail)); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${reqSource === b.id ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-line hover:border-brand/40"}`}>
                        <span className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold ${reqSource === b.id ? "bg-brand text-white" : "bg-line/50 text-muted"}`}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate flex items-center gap-1.5">{b.branch_type === "warehouse" ? "" : ""}{bName(b.id)}{i === 0 ? <Badge tone="ok">{L("ใกล้สุด", "Nearest", "最近")}</Badge> : null}</p>
                          <p className="text-[11px] text-muted">{b.province ?? ""} · {fmtKm(km)}</p>
                        </div>
                        <div className="text-right shrink-0"><p className="text-sm font-bold text-ok tnum">{avail}</p><p className="text-[10px] text-muted">{L("พร้อมโอน", "available", "可调")}</p></div>
                      </button>
                    ))}
                  </div>
                ) : <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">{L("ยังไม่มีสาขาใดมีสินค้านี้พร้อมโอน", "No branch has available stock", "暂无门店有货")}</div>}
              </div>
              {/* จำนวน */}
              {reqSource ? (
                <Field label={L("จำนวนที่ขอ", "Quantity", "数量")}>
                  <Input type="number" min={1} max={availAt(reqSource, reqProduct.id)} value={reqQty} onChange={(e) => setReqQty(Math.max(1, Math.min(availAt(reqSource, reqProduct.id), Number(e.target.value) || 1)))} className="h-10 w-40" />
                  <span className="text-[11px] text-muted ml-2">{L("สูงสุด", "max", "最多")} {availAt(reqSource, reqProduct.id)}</span>
                </Field>
              ) : null}
            </>
          )}
          <p className="text-[11px] text-muted flex items-center gap-1.5"><CircleAlert size={12} /> {L("ส่งคำขอแล้ว สาขาต้นทางจะเห็นใน \"รอฉันทำ\" และกดอนุมัติเพื่อเริ่มโอน", "Source branch sees it in \"My queue\" and approves to start the transfer", "源店将在\"待我处理\"中审批")}</p>
        </div>
      </Drawer>

      {/* create (slide-over ขวา) */}
      <Drawer open={open} onClose={() => setOpen(false)} title={t.transfer.request} width="lg"
        subtitle={from && to && from !== to ? `${bName(from)} → ${bName(to)}` : undefined}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button variant="primary" className="ml-auto" loading={busy} disabled={from === to || !lines.some((l) => { const p = products.find((x) => x.id === l.product_id); return p?.track_serial ? l.serials.length > 0 : l.qty > 0; })} onClick={() => void create()}>{L("ส่งคำขออนุมัติ", "Send for approval", "提交审批")}</Button></>}>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t.transfer.from}><Select value={from} onChange={(e) => setFrom(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{bName(b.id)}</option>)}</Select></Field>
            <Field label={t.transfer.to}><Select value={to} onChange={(e) => setTo(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{bName(b.id)}</option>)}</Select></Field>
          </div>
          {from === to ? <p className="text-xs text-danger">{L("ต้นทางและปลายทางต้องไม่ใช่สาขาเดียวกัน", "Source and destination must differ", "调出调入不能相同")}</p> : null}
          <div>
            <form onSubmit={(e) => { e.preventDefault(); void addByCode(addQ); }} className="relative">
              <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
              <Input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder={L("พิมพ์ชื่อสินค้า / ยิงบาร์โค้ด / สแกน SN แล้ว Enter", "Type name / scan barcode / SN, then Enter", "输入名称/扫条码/SN 回车")} className="pl-9 pr-9 h-11" />
              {addQ ? <button type="button" onClick={() => setAddQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={15} /></button> : null}
            </form>
            {addMatches.length ? (
              <div className="mt-1.5 rounded-xl border border-line divide-y divide-line/60 overflow-hidden max-h-64 overflow-y-auto">
                {addMatches.map((p) => (
                  <button key={p.id} type="button" onClick={() => { addLine(p.id); setAddQ(""); }} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-brand/5 text-left">
                    {p.image_url ? <img src={p.image_url} alt="" className="w-8 h-8 rounded-lg object-cover border border-line bg-white shrink-0" /> : <div className="w-8 h-8 rounded-lg border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={13} /></div>}
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{p.name_th}{p.track_serial ? <Barcode size={11} className="inline ml-1 text-brand" /> : null}</p><p className="font-mono text-[10px] text-muted truncate">{p.sku} · {(p.barcodes ?? [])[0] ?? "—"}</p></div>
                    {(() => { const av = availAt(from, p.id); return <span className={`text-[10px] tnum shrink-0 font-semibold ${av > 0 ? "text-ok" : "text-danger"}`}>{av > 0 ? `${L("พร้อม", "avail", "可")} ${av}` : L("ต้นทางไม่มี", "none at src", "源店无")}</span>; })()}
                    <Plus size={15} className="text-brand shrink-0" />
                  </button>
                ))}
              </div>
            ) : addQ.trim() ? <p className="mt-1.5 text-[11px] text-muted px-1">{L("ไม่พบชื่อที่ตรง — กด Enter เพื่อค้นด้วยบาร์โค้ด/SN", "No name match — press Enter to look up barcode/SN", "回车按条码/SN 查")}</p> : null}
          </div>
          <Table>
            <thead><tr><Th>{t.admin.products}</Th><Th align="center">{L("จำนวน / สแกน SN", "Qty / Scan SN", "数量/扫码")}</Th><Th /></tr></thead>
            <tbody>
              {lines.map((l) => { const p = products.find((x) => x.id === l.product_id); return (
                <tr key={l.id}>
                  <Td className="text-xs">{p?.name_th}{p?.track_serial ? <Barcode size={11} className="inline ml-1 text-brand" /> : null}
                    {p ? (() => { const av = availAt(from, p.id); const over = l.qty > av; return <span className={`block text-[10px] tnum ${over ? "text-danger font-semibold" : "text-muted"}`}>{L("พร้อมโอนที่ต้นทาง", "available at source", "源店可调")} {av}{over ? ` · ${L("ขอเกิน!", "exceeds!", "超量!")}` : ""}</span>; })() : null}</Td>
                  <Td align="center">
                    {p?.track_serial ? (
                      <button onClick={() => setCreateScan(l.id)} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-brand/40 text-brand text-xs font-medium hover:bg-brand/10 transition-colors">
                        <ScanLine size={14} /> {L("สแกน SN", "Scan SN", "扫码")} <span className="tnum">({l.serials.length})</span>
                      </button>
                    ) : (
                      <Input value={l.qty} inputMode="numeric" onChange={(e) => setLines((list) => list.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x))} className="h-8 w-20 text-center tnum" />
                    )}
                  </Td>
                  <Td align="right"><button onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))} className="text-muted hover:text-danger"><Trash2 size={14} /></button></Td>
                </tr>
              ); })}
            </tbody>
          </Table>
          <Field label={L("เหตุผล / หมายเหตุ", "Reason / note", "原因/备注")}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("เช่น เติมสต๊อกสาขา, ย้ายตามคำสั่งซื้อ", "e.g. restock branch, move per order", "例如：补货")} /></Field>
        </div>
      </Drawer>

      {/* ป๊อปอัปขวา: สแกน SN ตอนเปิดบิล (จำนวน = จำนวน SN ที่ยิง) */}
      {createScan ? (() => {
        const l = lines.find((x) => x.id === createScan); if (!l) return null;
        const p = products.find((x) => x.id === l.product_id); if (!p) return null;
        return (
          <SerialScanDrawer
            open
            onClose={() => setCreateScan(null)}
            mode="out"
            product={{ name: p.name_th, sku: p.sku, image: p.image_url }}
            qty={0}
            shipped={[]}
            initial={l.serials}
            onSave={(serials) => { setLines((list) => list.map((x) => x.id === l.id ? { ...x, serials, qty: serials.length } : x)); setCreateScan(null); }}
            locale={locale as "th" | "en" | "zh"}
          />
        );
      })() : null}

      {/* Lightbox รูปแนบ — เลื่อนซ้าย-ขวา + บันทึก + คัดลอก */}
      {lbIdx !== null && atts.length ? (() => {
        const i = Math.min(lbIdx, atts.length - 1); const a = atts[i];
        const go = (d: number) => setLbIdx((i + d + atts.length) % atts.length);
        const isImg = a.type?.startsWith("image/");
        return (
          <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex flex-col" onClick={() => setLbIdx(null)}>
            <div className="flex items-center gap-2 p-3 text-white/90" onClick={(e) => e.stopPropagation()}>
              <span className="font-mono text-sm">{detail?.transfer_no}</span>
              <span className="text-white/45 text-xs truncate hidden sm:block">· {a.name}</span>
              <span className="ml-auto text-xs tabular-nums text-white/60">{i + 1}/{atts.length}</span>
              <button onClick={() => setLbIdx(null)} className="w-9 h-9 rounded-full hover:bg-white/10 grid place-items-center text-white"><X size={18} /></button>
            </div>
            <div className="flex-1 relative flex items-center justify-center px-4 min-h-0" onClick={(e) => e.stopPropagation()}>
              {isImg ? <img src={a.url} alt={a.name} className="max-w-full max-h-full object-contain rounded-lg" /> : <div className="text-white/60 flex flex-col items-center gap-2"><FileText size={56} /><span className="text-sm">{a.name}</span></div>}
              {atts.length > 1 ? <>
                <button onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white grid place-items-center"><ChevronLeft size={22} /></button>
                <button onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white grid place-items-center"><ChevronRight size={22} /></button>
              </> : null}
            </div>
            <div className="p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-center gap-2">
                {isImg ? <button onClick={() => void copyImage(a)} className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm inline-flex items-center gap-1.5">{copied === "img" ? <Check size={15} /> : <Copy size={15} />} {copied === "img" ? L("คัดลอกแล้ว", "Copied", "已复制") : L("คัดลอกรูป", "Copy image", "复制图片")}</button> : null}
                <button onClick={() => downloadAtt(a)} className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm inline-flex items-center gap-1.5"><Download size={15} /> {L("บันทึก", "Save", "保存")}</button>
              </div>
              {atts.length > 1 ? <div className="flex gap-1.5 overflow-x-auto justify-center pb-1">{atts.map((t, ti) => (<button key={t.id} onClick={() => setLbIdx(ti)} className={`w-12 h-12 rounded-md overflow-hidden border-2 shrink-0 ${ti === i ? "border-white" : "border-transparent opacity-50 hover:opacity-100"}`}>{t.type?.startsWith("image/") ? <img src={t.url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center bg-white/10"><FileText size={14} className="text-white/60" /></div>}</button>))}</div> : null}
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
