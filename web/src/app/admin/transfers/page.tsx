"use client";

// หน้า admin — ติดตาม/อนุมัติใบโอนย้ายทุกสาขา (ใช้ engine + ดีไซน์เดียวกับ /pos/transfers)
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import { ArrowLeftRight, Plus, Trash2, Check, X, Clock, Barcode, CircleAlert, Printer, ScanLine, Truck, PackageCheck, Upload, FileText, Boxes, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listProducts, listEmployees } from "@/lib/data/repo";
import {
  owListAll, owCreate, owApprove, owReject, owGet, owTimeline,
  owScanOut, owDispatch, owReceive, owCarriers, owSetAttachments, owShipStage,
  statusMeta, isActive, isIssue, owErrorMessage,
} from "@/lib/onewarehouse";
import { TransferStepper, ItemJourney, TransferTimeline } from "@/components/admin/transfer-ui";
import { SerialScanDrawer } from "@/components/admin/serial-scan-drawer";
import { printTransferCO } from "@/lib/transfer/print-co";
import type { Branch, Product, Transfer, TransferStatus, TransferAttachment, AuditEntry, Employee } from "@/lib/types";
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
  const { employee } = useSession();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [list, setList] = useState<Transfer[]>([]);
  const [bucket, setBucket] = useState<"mine" | "active" | "issue" | "done" | "all">("active");
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
  const [note, setNote] = useState("");
  const [createScan, setCreateScan] = useState<string | null>(null); // lineId ที่กำลังสแกนตอนเปิดบิล

  async function reload() { setList(await owListAll()); }
  useEffect(() => {
    void (async () => {
      const [b, p, c, e] = await Promise.all([listBranches(), listProducts(), owCarriers(), listEmployees()]);
      setBranches(b); setProducts(p); setCarriers(c); setEmployees(e); setFrom(b[0]?.id ?? ""); setTo(b[1]?.id ?? "");
      await reload();
    })();
  }, []);
  // เปิดเอกสาร → เตรียม state สแกนตามสถานะ (≤packed=สแกนออก, in_transit=สแกนรับ)
  useEffect(() => {
    setTab("overview"); setCarrier(""); setApproveNote("");
    if (!detail) { setScanned({}); setRecvQty({}); return; }
    void owTimeline(detail.transfer_no).then(setTimeline);
    const receiving = detail.status === "in_transit";
    const sc: Record<string, string[]> = {}; const rq: Record<string, string> = {};
    for (const it of detail.items) {
      if (it.isSerialized) sc[it.product_id] = (receiving ? it.receivedSerials : it.shippedSerials)?.map((s) => s.serialNo) ?? [];
      else rq[it.product_id] = String(receiving ? (it.qty_shipped || it.qty_requested) : it.qty_requested);
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
  const bName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id; };
  const sMeta = (s: Transfer["status"]) => statusMeta(s, locale);

  const visible = useMemo(() => list
    .filter((x) => allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id))
    .filter((x) => bucket === "all" ? true : bucket === "mine" ? needsMyAction(x) : bucket === "active" ? isActive(x.status) : bucket === "issue" ? isIssue(x.status) : x.status === "completed"),
    [list, allowed, bucket]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const actorEmp = (id?: string | null, kind: "requester" | "approver" | "source" | "dest" = "source", tr?: Transfer): Employee | null => {
    if (id) { const real = employees.find((e) => e.id === id); if (real) return real; }
    if (!employees.length) return null;
    let pool: Employee[] =
      kind === "approver" ? employees.filter((e) => ["owner", "hq", "brand_admin", "manager", "supervisor"].includes(e.role))
      : kind === "dest" ? empByBranch(tr?.to_branch_id)
      : empByBranch(tr?.from_branch_id);
    if (!pool.length) pool = employees.filter((e) => e.status === "active");
    if (!pool.length) pool = employees;
    const seed = [...`${id ?? ""}|${tr?.id ?? ""}|${kind}`].reduce((a, c) => a + c.charCodeAt(0), 0);
    return pool[seed % pool.length] ?? null;
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
  const canReceive = (tr: Transfer) => canRecv && atDest(tr) && tr.status === "in_transit";
  // รออีกฝั่งทำ (โชว์ป้ายบอกว่าใครต้องทำต่อ)
  const waitingSide = (tr: Transfer): "dest" | "source" | null =>
    tr.status === "in_transit" && !atDest(tr) ? "dest" : ["approved", "picking", "packed"].includes(tr.status) && !atSource(tr) ? "source" : null;
  const scanModeOf = (tr: Transfer): "out" | "in" => (tr.status === "in_transit" ? "in" : "out");
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
    void act(() => owReceive(tr, employee!.id, received), L("รับเข้าแล้ว", "Received", "已入库"));
  };

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
          {(["active", "issue", "done", "all"] as const).map((b) => (
            <button key={b} onClick={() => setBucket(b)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${bucket === b ? "bg-brand text-white border-brand" : "border-line text-muted hover:text-brand"}`}>
              {b === "active" ? L("กำลังดำเนินการ", "Active", "进行中") : b === "issue" ? L("มีปัญหา", "Issues", "异常") : b === "done" ? L("เสร็จแล้ว", "Done", "完成") : t.common.all}
            </button>
          ))}
        </div>
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
                    <Td align="center"><Badge tone={sMeta(tr.status).tone}>{sMeta(tr.status).label}</Badge></Td>
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
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{it.name}{it.isSerialized === null ? <Badge tone="danger" className="ml-1">{L("ยังไม่จัดประเภท", "Unclassified", "未分类")}</Badge> : it.isSerialized ? <Barcode size={12} className="inline ml-1 text-brand" /> : null}</p>
                          <p className="font-mono text-[10px] text-muted">{it.sku}</p>
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
          <div className="flex gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-1"><option value="">{t.common.add}...</option>{products.filter((p) => p.is_stocked).map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}{p.track_serial ? " · SN" : ""}</option>)}</Select>
            <Button variant="soft" disabled={!pickId} onClick={() => { setLines((l) => [...l, { id: nanoid(), product_id: pickId, qty: 1, serials: [] }]); setPickId(""); }}><Plus size={16} /></Button>
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
