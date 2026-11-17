"use client";

// หน้า admin — ติดตาม/อนุมัติใบโอนย้ายทุกสาขา (ใช้ engine + ดีไซน์เดียวกับ /pos/transfers)
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import { ArrowLeftRight, Plus, Trash2, Check, X, Clock, Barcode, CircleAlert, Printer, ScanLine, Truck, PackageCheck, Upload, FileText, Boxes, ChevronRight, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listProducts, listEmployees, stockAll } from "@/lib/data/repo";
import { availableQty } from "@/lib/stock";
import { coordOf, haversineKm, fmtKm } from "@/lib/geo";
import { resolveSerial } from "@/lib/data/serials";
import {
  owListAll, owCreate, owApprove, owReject, owReverse, owGet, owTimeline,
  owScanOut, owDispatch, owReceive, owCloseShort, owRecordDisc, owResolveDisc, owCarriers, owSetAttachments, owShipStage,
  statusMeta, isActive, isIssue, owErrorMessage,
} from "@/lib/onewarehouse";
import { TransferStepper, ItemJourney, TransferTimeline } from "@/components/admin/transfer-ui";
import { SerialScanDrawer } from "@/components/admin/serial-scan-drawer";
import { printTransferCO } from "@/lib/transfer/print-co";
import type { Branch, Product, Transfer, TransferStatus, TransferAttachment, AuditEntry, Employee, StockLevel } from "@/lib/types";
import { Button, Card, Input, Field, Select, Table, Th, Td, Badge, EmptyState, Drawer, DrawerTabs, DetailRow, Avatar } from "@/components/ui";
import { can, visibleBranchIds, ROLE_LABEL } from "@/lib/permissions";

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
  const [products, setProducts] = useState<Product[]>([]);
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [approveNote, setApproveNote] = useState("");
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
      const [b, p, c, e, st] = await Promise.all([listBranches(), listProducts(), owCarriers(), listEmployees(), stockAll()]);
      setBranches(b); setProducts(p); setCarriers(c); setEmployees(e); setStock(st); setFrom(b[0]?.id ?? ""); setTo(b[1]?.id ?? "");
      await reload();
    })();
  }, []);
  // เปิดเอกสาร → เตรียม state สแกนตามสถานะ (≤packed=สแกนออก, in_transit=สแกนรับ)
  useEffect(() => {
    setTab("overview"); setCarrier(""); setApproveNote("");
    if (!detail) { setScanned({}); setRecvQty({}); return; }
    void owTimeline(detail.transfer_no).then(setTimeline);
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
  const mineCount = useMemo(() => list.filter((x) => (allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id)) && needsMyAction(x)).length, [list, allowed, employee]); // eslint-disable-line react-hooks/exhaustive-deps
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
    } finally { setBusy(false); }
  }
  const sMeta = (s: Transfer["status"]) => statusMeta(s, locale);

  const visible = useMemo(() => list
    .filter((x) => allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id))
    .filter((x) => bucket === "all" ? true : bucket === "mine" ? needsMyAction(x) : bucket === "overdue" ? !!overdueInfo(x)?.over : bucket === "active" ? isActive(x.status) : bucket === "issue" ? isIssue(x.status) : x.status === "completed"),
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
      await owCreate(from, to, employee.id, ls, note, can(employee, "transfer.approve"));
      setOpen(false); setLines([]); setNote(""); await reload();
      toast.push({ tone: "ok", title: t.transfer.title });
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
  // ผู้มีสิทธิ์อนุมัติใบนี้ = active + มีสิทธิ์ transfer.approve + ขอบเขตครอบคลุมสาขาต้นทาง
  //   primary = ผูกสาขาต้นทางโดยตรง · backup = ขอบเขตกว้าง (แบรนด์/บริษัท) ใช้อนุมัติแทนเมื่อคนหลักไม่อยู่
  const eligibleApprovers = (tr: Transfer) => {
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
  const canApprove = (tr: Transfer) => tr.status === "pending_approval" && can(employee, "transfer.approve") && atSource(tr);
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
  const stockStatus = (s: TransferStatus): { label: string; tone: "warn" | "info" | "ok" | "neutral" } => {
    if (["draft", "pending_approval", "approved", "picking"].includes(s)) return { label: L("จองออก (Reserved Out) · ยังอยู่ในสต๊อกต้นทาง", "Reserved Out · still source stock", "调出预留·仍在源库存"), tone: "warn" };
    if (["packed", "shipped", "in_transit"].includes(s)) return { label: L("กำลังส่งออก (On the Way Out) · ออกจากคลังต้นทางแล้ว ยังไม่ถึงปลายทาง", "On the Way Out · left source, not yet received", "在途出库"), tone: "info" };
    if (["completed", "received"].includes(s)) return { label: L("เข้าสต๊อกปลายทางแล้ว (On Hand)", "On Hand at destination", "已入目的地库存"), tone: "ok" };
    if (s === "partial_received") return { label: L("รับบางส่วน · ปรับสต๊อกตามที่รับจริง", "Partially received", "部分入库"), tone: "warn" };
    return { label: L("ยกเลิก · คืนจอง", "Cancelled · reservation released", "已取消·释放预留"), tone: "neutral" };
  };

  // แนบไฟล์/รูป (ไม่จำกัดจำนวน · เก็บ data URL ในโหมด demo)
  async function onUploadFiles(files: FileList | null) {
    if (!detail || !files || !files.length) return;
    const read = await Promise.all([...files].slice(0, 20).map((f) => new Promise<TransferAttachment>((res) => {
      const r = new FileReader();
      r.onload = () => res({ id: nanoid(8), name: f.name, type: f.type || "application/octet-stream", url: String(r.result), size: f.size, at: new Date().toISOString(), by: employee?.id ?? null });
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
  const doDispatch = (tr: Transfer) => void act(() => owDispatch(tr, employee!.id, { carrier: carrier || null }), L("จัดส่งแล้ว", "Dispatched", "已发货"));
  // รับเข้า → completed/partial
  const doReceive = (tr: Transfer) => {
    const received: Record<string, { serials?: string[]; qty?: number }> = {};
    for (const it of tr.items) received[it.product_id] = it.isSerialized ? { serials: scanned[it.product_id] ?? [] } : { qty: Number(recvQty[it.product_id] || 0) };
    void act(() => owReceive(tr, employee!.id, received), L("บันทึกการรับรอบนี้แล้ว", "Receipt recorded", "已记录本次收货"));
  };
  const doCloseShort = (tr: Transfer) => void act(() => owCloseShort(tr, employee!.id), L("ปิดรับแล้ว (ยอมรับส่วนขาด)", "Closed with shortage", "已结单(接受缺量)"));
  const doResolveDisc = (tr: Transfer, discId: string) => void act(() => owResolveDisc(tr, discId, employee!.id), L("ปิดเรื่องผลต่างแล้ว", "Discrepancy resolved", "已关闭差异"));
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

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2"><ArrowLeftRight size={16} className="text-brand" /> {t.transfer.title}</h2>
        <div className="flex gap-1.5 ml-auto">
          <button onClick={() => setBucket("mine")} className={`text-xs px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${bucket === "mine" ? "bg-brand text-white border-brand" : mineCount ? "border-amber-400/60 text-amber-600 bg-amber-500/5 hover:bg-amber-500/10" : "border-line text-muted hover:text-brand"}`}>
            <Clock size={12} /> {L("รอฉันทำ", "My queue", "待我处理")}
            {mineCount ? <span className={`min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10px] font-bold ${bucket === "mine" ? "bg-white/25 text-white" : "bg-amber-500 text-white"}`}>{mineCount}</span> : null}
          </button>
          {overdueCount ? (
            <button onClick={() => setBucket("overdue")} className={`text-xs px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${bucket === "overdue" ? "bg-rose-600 text-white border-rose-600" : "border-rose-400/60 text-rose-600 bg-rose-500/5 hover:bg-rose-500/10"}`}>
              <Clock size={12} /> {L("เกินเวลา", "Overdue", "逾期")}
              <span className={`min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10px] font-bold ${bucket === "overdue" ? "bg-white/25 text-white" : "bg-rose-600 text-white"}`}>{overdueCount}</span>
            </button>
          ) : null}
          {(["active", "issue", "done", "all"] as const).map((b) => (
            <button key={b} onClick={() => setBucket(b)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${bucket === b ? "bg-brand text-white border-brand" : "border-line text-muted hover:text-brand"}`}>
              {b === "active" ? L("กำลังดำเนินการ", "Active", "进行中") : b === "issue" ? L("มีปัญหา", "Issues", "异常") : b === "done" ? L("เสร็จแล้ว", "Done", "完成") : t.common.all}
            </button>
          ))}
        </div>
        {can(employee, "transfer.request") ? <Button variant="ghost" className="h-9" onClick={() => openRequest()}><Boxes size={15} /> {L("ขอสินค้าเข้า", "Request stock", "申请调入")}</Button> : null}
        {can(employee, "transfer.request") ? <Button variant="primary" className="h-9" onClick={() => setOpen(true)}><Plus size={15} /> {t.transfer.request}</Button> : null}
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
                    <Td className="text-xs truncate max-w-[150px]">{tr.from_kind === "warehouse" ? "🏬 " : ""}{bName(tr.from_branch_id)}</Td>
                    <Td className="text-xs truncate max-w-[150px]">{bName(tr.to_branch_id)}</Td>
                    <Td align="center" className="text-[11px] tnum text-muted">{snTotal ? `${snDone}/${snTotal}` : "—"}</Td>
                    <Td align="center">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={sMeta(tr.status).tone}>{sMeta(tr.status).label}</Badge>
                        {overdueInfo(tr)?.over ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-500/12 border border-rose-500/30 rounded-full px-1.5 py-0.5"><Clock size={10} /> {L(`ค้าง ${overdueInfo(tr)!.days} วัน`, `${overdueInfo(tr)!.days}d overdue`, `逾期${overdueInfo(tr)!.days}天`)}</span> : null}
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
      <Drawer open={Boolean(detail)} onClose={closeDoc} width="lg"
        title={detail ? <span className="font-mono">{detail.transfer_no}</span> : ""}
        subtitle={detail ? `${detail.from_kind === "warehouse" ? "🏬 " : ""}${bName(detail.from_branch_id)} → ${bName(detail.to_branch_id)}` : ""}
        badge={detail ? <Badge tone={sMeta(detail.status).tone}>{sMeta(detail.status).label}</Badge> : null}
        footer={detail ? (
          <div className="flex gap-2 w-full items-center flex-wrap">
            <Button variant="soft" onClick={() => printCO(detail)}><Printer size={15} /> {L("พิมพ์ใบ CO", "Print CO", "打印CO")}</Button>
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
                <Select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-10 w-36"><option value="">{L("ขนส่ง…", "Carrier…", "承运…")}</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                <Button variant="primary" loading={busy} onClick={() => doDispatch(detail)}><Truck size={15} /> {L("จัดส่ง", "Dispatch", "发货")}</Button>
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
            {tab === "overview" ? (
              <div className="p-5 space-y-4">
                <TransferStepper status={detail.status} locale={locale} L={L} />
                <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
                  <DetailRow label={t.transfer.from}>{detail.from_kind === "warehouse" ? "🏬 " : ""}{bName(detail.from_branch_id)}</DetailRow>
                  <DetailRow label={t.transfer.to}>{bName(detail.to_branch_id)}</DetailRow>
                  {detail.jst_allocation_no ? <DetailRow label="JST">{detail.jst_allocation_no}</DetailRow> : null}
                  {detail.note ? <DetailRow label={t.common.note}>{detail.note}</DetailRow> : null}
                </div>
                {/* ขั้นตอน & ผู้รับผิดชอบ — แต่ละขั้นใครทำไปแล้ว (ชื่อ+เวลา) และขั้นถัดไปใครต้องกด */}
                {(() => {
                  const S = detail.status;
                  const dead = S === "rejected" || S === "cancelled";
                  const inset = (...xs: TransferStatus[]) => xs.includes(S);
                  const src = L(`ต้นทาง — ${bName(detail.from_branch_id)}`, `Source — ${bName(detail.from_branch_id)}`, `源店 — ${bName(detail.from_branch_id)}`);
                  const dst = L(`ปลายทาง — ${bName(detail.to_branch_id)}`, `Destination — ${bName(detail.to_branch_id)}`, `目的地 — ${bName(detail.to_branch_id)}`);
                  const a = { out: actorAt(["packed", "shipped"]), disp: actorAt(["in_transit"]), recv: actorAt(["received", "completed", "partial_received"]) };
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
                            <div key={i} className={`flex items-center gap-3 px-3.5 py-2.5 ${st.current && !dead ? "bg-amber-500/5" : ""}`}>
                              <span className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-[11px] ${st.done ? "bg-emerald-500/15 text-emerald-600" : st.current && !dead ? "bg-amber-500/20 text-amber-600 ring-2 ring-amber-400/40" : "bg-line/40 text-muted/60"}`}>
                                {st.done ? <Check size={13} /> : i + 1}
                              </span>
                              {st.done && who ? <Avatar name={empLabel(who)} src={who.photo_url} size={30} /> : null}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium leading-tight">{st.label}</p>
                                {st.done ? (
                                  <p className="text-[11px] text-muted truncate">{L("โดย", "by", "由")} <span className="text-ink/80 font-medium">{empLabel(who)}</span>{st.at ? ` · ${dtShort(st.at)}` : ""}</p>
                                ) : st.current && !dead ? (
                                  <p className="text-[11px] text-amber-600 truncate">{L("รอ", "Waiting on", "待")}: {st.resp}</p>
                                ) : (
                                  <p className="text-[11px] text-muted/50">{L("ยังไม่ถึงขั้นนี้", "Not yet", "未到")}</p>
                                )}
                              </div>
                              {st.current && !dead ? <Badge tone="warn">{L("ต้องทำต่อ", "Action due", "下一步")}</Badge> : null}
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
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
                    <p className="text-sm font-medium inline-flex items-center gap-1.5"><Clock size={14} className="text-amber-600" /> {L("รออนุมัติ (สาขาต้นทาง)", "Pending approval (source)", "待审批")}</p>
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
                  const DISC_LABEL: Record<string, string> = { short: L("ขาด", "Short", "缺"), over: L("เกิน", "Over", "超"), damaged: L("ชำรุด", "Damaged", "损坏"), lost: L("สูญหาย", "Lost", "丢失"), wrong_sn: L("ผิด SN", "Wrong SN", "SN错误") };
                  const pName = (pid: string) => products.find((p) => p.id === pid)?.name_th ?? detail.items.find((i) => i.product_id === pid)?.sku ?? pid;
                  const diffs = detail.items.map((it) => { const target = it.qty_shipped || it.qty_requested; return { pid: it.product_id, target, recv: it.qty_received || 0, diff: (it.qty_received || 0) - target }; }).filter((d) => d.diff !== 0);
                  const discs = detail.discrepancies ?? [];
                  if (!diffs.length && !discs.length) return null;
                  const canClose = canReceive(detail) && detail.status === "partial_received";
                  const canResolve = can(employee, "transfer.approve");
                  return (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
                      <p className="text-sm font-medium inline-flex items-center gap-1.5"><CircleAlert size={14} className="text-amber-600" /> {L("ผลต่างการรับ", "Receipt discrepancy", "收货差异")}</p>
                      {diffs.map((d) => (
                        <div key={d.pid} className="text-xs flex items-center justify-between gap-2">
                          <span className="truncate flex-1">{pName(d.pid)}</span>
                          <span className={`shrink-0 ${d.diff < 0 ? "text-rose-600 font-medium" : "text-amber-600 font-medium"}`}>{L("ส่ง", "ship", "发")} {d.target} · {L("รับ", "recv", "收")} {d.recv} · {d.diff < 0 ? `${L("ขาด", "short", "缺")} ${-d.diff}` : `${L("เกิน", "over", "超")} ${d.diff}`}</span>
                        </div>
                      ))}
                      {canClose ? <Button variant="ghost" className="w-full" loading={busy} onClick={() => doCloseShort(detail)}><CircleAlert size={14} /> {L("ปิดรับ (ยอมรับส่วนขาด + บันทึกผลต่าง)", "Close with shortage", "结单·接受缺量")}</Button> : null}
                      {discs.length ? (
                        <div className="space-y-1.5 pt-2 border-t border-amber-500/20">
                          {discs.map((dc) => (
                            <div key={dc.id} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="truncate flex-1"><b className="text-ink/80">{DISC_LABEL[dc.kind]}</b> · {pName(dc.product_id)} × {dc.qty}{dc.responsible_by ? ` · ${L("ผู้รับผิดชอบ", "resp.", "负责")} ${empName(dc.responsible_by)}` : ""}</span>
                              {dc.status === "resolved" ? <Badge tone="ok">{L("ปิดแล้ว", "Resolved", "已关闭")}</Badge> : canResolve ? <button onClick={() => doResolveDisc(detail, dc.id)} className="shrink-0 text-brand hover:underline font-medium">{L("ปิดเรื่อง", "Resolve", "关闭")}</button> : <Badge tone="warn">{L("ค้าง", "Open", "待")}</Badge>}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* สถานะสต๊อก — ของนับเป็นอะไรตอนนี้ */}
                <div className="rounded-2xl border border-line p-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted inline-flex items-center gap-1.5 shrink-0"><Boxes size={15} /> {L("สถานะสต๊อก", "Stock status", "库存状态")}</span>
                  <Badge tone={stockStatus(detail.status).tone} className="text-right">{stockStatus(detail.status).label}</Badge>
                </div>

                {/* เอกสาร / รูปแนบ (ไม่จำกัด) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{L("เอกสาร / รูปแนบ", "Files / images", "文件/图片")} <span className="text-muted font-normal">({detail.attachments?.length ?? 0})</span></p>
                    <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-brand/40 text-brand text-xs font-medium hover:bg-brand/10 cursor-pointer transition-colors">
                      <Upload size={14} /> {L("เพิ่มไฟล์", "Add files", "添加")}
                      <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" className="hidden" onChange={(e) => { void onUploadFiles(e.target.files); e.currentTarget.value = ""; }} />
                    </label>
                  </div>
                  {detail.attachments?.length ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {detail.attachments.map((a) => (
                        <div key={a.id} className="relative group rounded-xl border border-line overflow-hidden bg-surface2">
                          {a.type.startsWith("image/")
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name} className="w-full h-20 object-cover" /></a>
                            : <a href={a.url} download={a.name} className="flex flex-col items-center justify-center h-20 gap-1 p-2 text-center"><FileText size={22} className="text-muted" /><span className="text-[9px] text-muted truncate w-full">{a.name}</span></a>}
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
                          <p className="text-sm font-medium truncate flex items-center gap-1.5">{b.branch_type === "warehouse" ? "🏬 " : ""}{bName(b.id)}{i === 0 ? <Badge tone="ok">{L("ใกล้สุด", "Nearest", "最近")}</Badge> : null}</p>
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
                  <Td className="text-xs">{p?.name_th}{p?.track_serial ? <Barcode size={11} className="inline ml-1 text-brand" /> : null}</Td>
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
    </div>
  );
}
