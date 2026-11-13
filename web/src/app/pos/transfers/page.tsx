"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { nanoid } from "nanoid";
import {
  ArrowLeftRight, Plus, Trash2, Truck, PackageCheck, ArrowDownLeft, ArrowUpRight,
  Barcode, Check, Clock, ScanLine, CircleAlert, X, ClipboardList, Ban,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listProducts } from "@/lib/data/repo";
import {
  owCreate, owApprove, owReject, owScanOut, owDispatch, owReceive, owList, owGet, owTimeline, owCarriers,
  statusMeta, isActive, isIssue, reconcileSerials, owErrorMessage,
} from "@/lib/onewarehouse";
import type { Branch, Product, Transfer, TransferItem, AuditEntry } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, Badge, EmptyState, Modal, Field, Drawer, DrawerTabs, DetailRow, Skeleton } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { SerialModal } from "@/components/pos/sale-modals";
import { can } from "@/lib/permissions";

interface Line { id: string; product_id: string; sku: string; name: string; qty: number; isSerialized: boolean | null }
type Tab = "overview" | "timeline";

export default function PosTransfersPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [list, setList] = useState<Transfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [bucket, setBucket] = useState<"all" | "active" | "issue" | "done">("active");

  // detail drawer
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [timeline, setTimeline] = useState<AuditEntry[]>([]);
  const [scanned, setScanned] = useState<Record<string, string[]>>({});   // serials ต่อ product (out/in ตามสถานะ)
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});     // qty สำหรับบรรทัดไม่ใช้ SN
  const [disp, setDisp] = useState({ carrier: "", tracking: "", cost: "" });
  const [sn, setSn] = useState<{ pid: string; name: string; qty: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // create
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pickId, setPickId] = useState("");
  const [note, setNote] = useState("");

  async function reload() {
    if (!branchId) return;
    setLoading(true);
    const [tr, b, p, c] = await Promise.all([owList(branchId), listBranches(), listProducts(), owCarriers()]);
    setList(tr); setBranches(b); setProducts(p); setCarriers(c); setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [branchId]);
  // poll รายการเงียบ ๆ (แทน Pub/Sub จนกว่า events จะพร้อม) — โชว์ของเข้ามาใหม่โดยไม่ต้องรีเฟรช
  useEffect(() => {
    if (!branchId) return;
    const id = setInterval(() => { void owList(branchId).then(setList).catch(() => {}); }, 15000);
    return () => clearInterval(id);
  }, [branchId]);

  // เปิด detail → เตรียม state ตามทิศ/สถานะ
  useEffect(() => {
    setTab("overview"); setScanned({}); setRecvQty({}); setDisp({ carrier: "", tracking: "", cost: "" });
    if (!detail) return;
    const sc: Record<string, string[]> = {}; const rq: Record<string, string> = {};
    const incoming = detail.to_branch_id === branchId;
    for (const it of detail.items) {
      if (it.isSerialized) sc[it.product_id] = (incoming ? it.receivedSerials : it.shippedSerials)?.map((s) => s.serialNo) ?? [];
      else rq[it.product_id] = String(incoming ? (it.qty_shipped || it.qty_requested) : it.qty_requested);
    }
    setScanned(sc); setRecvQty(rq);
  }, [detail, branchId]);

  useEffect(() => {
    if (detail && tab === "timeline") void owTimeline(detail.transfer_no).then(setTimeline);
  }, [detail, tab]);

  const bName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);
  const dirOf = (tr: Transfer): "in" | "out" => (tr.to_branch_id === branchId ? "in" : "out");
  const sMeta = (s: Transfer["status"]) => statusMeta(s, locale);

  const filtered = useMemo(() => list.filter((tr) => {
    if (dir !== "all" && dirOf(tr) !== dir) return false;
    if (bucket === "active") return isActive(tr.status);
    if (bucket === "issue") return isIssue(tr.status);
    if (bucket === "done") return tr.status === "completed";
    return true;
  }), [list, dir, bucket, branchId]);

  const stats = useMemo(() => ({
    incoming: list.filter((tr) => dirOf(tr) === "in" && isActive(tr.status) && tr.status !== "draft").length,
    outgoing: list.filter((tr) => dirOf(tr) === "out" && ["pending_approval", "approved", "picking", "packed"].includes(tr.status)).length,
    inTransit: list.filter((tr) => tr.status === "in_transit").length,
    issue: list.filter((tr) => isIssue(tr.status)).length,
  }), [list, branchId]);

  // ── create ──
  function addLine() {
    const p = products.find((x) => x.id === pickId); if (!p) return;
    setLines((l) => [...l, { id: nanoid(), product_id: p.id, sku: p.sku, name: p.name_th, qty: 1, isSerialized: p.track_serial ? true : false }]);
    setPickId("");
  }
  async function create() {
    if (!branchId || !employee || !dest || !lines.length) return;
    setBusy(true);
    try {
      await owCreate(branchId, dest, employee.id, lines, note, can(employee, "transfer.approve"));
      setOpen(false); setDest(""); setLines([]); setNote(""); await reload();
      toast.push({ tone: "ok", title: t.transfer.title });
    } finally { setBusy(false); }
  }

  // ── actions (wrap + reload + error map) ──
  async function run(fn: () => Promise<Transfer>, okTitle: string) {
    if (!employee) return; setBusy(true);
    try { const next = await fn(); await reload(); setDetail(next); toast.push({ tone: "ok", title: okTitle }); }
    catch (e) {
      const code = e instanceof Error ? e.message : "error";
      toast.push({ tone: "danger", title: owErrorMessage(code, locale) });
      // version ชนกัน → ดึงเอกสารล่าสุดมาแสดง (ไม่ทับของคนอื่น)
      if (code === "transfer_version_conflict" && detail) { await reload(); const fresh = await owGet(detail.id); if (fresh) setDetail(fresh); }
    }
    finally { setBusy(false); }
  }
  const approve = (tr: Transfer) => run(() => owApprove(tr, employee!.id), t.transfer.approve);
  const reject = (tr: Transfer) => run(() => owReject(tr, employee!.id), L("ปฏิเสธแล้ว", "Rejected", "已拒绝"));
  const scanOut = (tr: Transfer) => run(() => owScanOut(tr, employee!.id, scanned), L("สแกนออกแล้ว", "Scanned out", "已扫出"));
  const dispatch = (tr: Transfer) => run(() => owDispatch(tr, employee!.id, { carrier: disp.carrier || null, tracking: disp.tracking || null, shippingCost: disp.cost ? Number(disp.cost) : null }), t.transfer.ship);
  const receive = (tr: Transfer) => run(() => {
    const input: Record<string, { qty?: number; serials?: string[] }> = {};
    for (const it of tr.items) input[it.product_id] = it.isSerialized ? { serials: scanned[it.product_id] ?? [] } : { qty: Number(recvQty[it.product_id] ?? 0) };
    return owReceive(tr, employee!.id, input);
  }, t.transfer.receive);

  if (!employee) return null;

  const incoming = detail ? detail.to_branch_id === branchId : false;
  const canApprove = (tr: Transfer) => dirOf(tr) === "out" && tr.status === "pending_approval" && can(employee, "transfer.approve");
  const canScanOut = (tr: Transfer) => dirOf(tr) === "out" && ["approved", "picking", "packed"].includes(tr.status) && can(employee, "transfer.request");
  const canDispatch = (tr: Transfer) => dirOf(tr) === "out" && tr.status === "packed" && can(employee, "transfer.approve");
  const canReceive = (tr: Transfer) => dirOf(tr) === "in" && ["in_transit", "shipped", "partial_received"].includes(tr.status) && can(employee, "transfer.receive");
  // สแกนครบทุกบรรทัด serialized หรือยัง (สำหรับปุ่มยืนยันสแกนออก)
  const scanOutReady = (tr: Transfer) => tr.items.every((it) => it.isSerialized !== null && (!it.isSerialized || (scanned[it.product_id]?.length ?? 0) === it.qty_requested));
  const hasBlocked = (tr: Transfer) => tr.items.some((it) => it.isSerialized === null);

  function snChip(count: number, total: number) {
    const ok = count === total && total > 0;
    return <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${ok ? "border-ok/30 text-ok bg-ok/8" : count > 0 ? "border-amber-500/30 text-amber-600 bg-amber-500/8" : "border-line text-muted"}`}><Barcode size={10} />{count}/{total}</span>;
  }

  return (
    <PosPage
      title={t.transfer.title}
      icon={<ArrowLeftRight size={18} />}
      actions={
        <>
          <Select value={dir} onChange={(e) => setDir(e.target.value as "all" | "in" | "out")} className="w-28 h-9">
            <option value="all">{t.common.all}</option>
            <option value="in">{L("ขาเข้า", "Incoming", "入库")}</option>
            <option value="out">{L("ขาออก", "Outgoing", "出库")}</option>
          </Select>
          {can(employee, "transfer.request") ? <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> {t.transfer.request}</Button> : null}
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatChip label={L("รอรับเข้า", "To receive", "待收货")} value={String(stats.incoming)} accent={stats.incoming ? "coral" : "mint"} icon={<ArrowDownLeft size={16} />} />
          <StatChip label={L("รอส่งออก", "To ship", "待发货")} value={String(stats.outgoing)} accent="lavender" icon={<ArrowUpRight size={16} />} />
          <StatChip label={L("ระหว่างทาง", "In transit", "运输中")} value={String(stats.inTransit)} accent="peach" icon={<Truck size={16} />} />
          <StatChip label={L("มีปัญหา", "Issues", "异常")} value={String(stats.issue)} accent={stats.issue ? "coral" : "neutral"} icon={<CircleAlert size={16} />} />
        </div>

        {/* bucket filter */}
        <div className="flex gap-1.5">
          {(["active", "issue", "done", "all"] as const).map((b) => (
            <button key={b} onClick={() => setBucket(b)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${bucket === b ? "bg-brand text-white border-brand" : "border-line text-muted hover:text-brand"}`}>
              {b === "active" ? L("กำลังดำเนินการ", "Active", "进行中") : b === "issue" ? L("มีปัญหา", "Issues", "异常") : b === "done" ? L("เสร็จแล้ว", "Done", "完成") : t.common.all}
            </button>
          ))}
        </div>

        <TablePanel>
          {loading ? <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            : filtered.length ? (
              <Table>
                <thead><tr><Th>{L("เลขโอน", "Transfer No.", "调拨单")}</Th><Th>{L("ทิศทาง", "Direction", "方向")}</Th><Th>{L("คู่โอน", "Branch", "对方")}</Th><Th align="center">SN</Th><Th align="center">{t.common.status}</Th><Th>{t.common.date}</Th></tr></thead>
                <tbody>
                  {filtered.map((tr) => {
                    const d = dirOf(tr);
                    const other = d === "in" ? tr.from_branch_id : tr.to_branch_id;
                    const snTotal = tr.items.filter((i) => i.isSerialized).reduce((s, i) => s + i.qty_requested, 0);
                    const snDone = tr.items.filter((i) => i.isSerialized).reduce((s, i) => s + ((d === "in" ? i.receivedSerials : i.shippedSerials)?.length ?? 0), 0);
                    return (
                      <tr key={tr.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setDetail(tr)}>
                        <Td className="font-mono text-xs">{tr.transfer_no}{tr.sync_state === "failed" ? <span className="ml-1 text-danger" title="sync failed">⚠</span> : null}</Td>
                        <Td><Badge tone={d === "in" ? "ok" : "info"}>{d === "in" ? <><ArrowDownLeft size={11} /> {L("เข้า", "In", "入")}</> : <><ArrowUpRight size={11} /> {L("ออก", "Out", "出")}</>}</Badge></Td>
                        <Td className="text-xs text-muted">{tr.from_kind === "warehouse" && d === "in" ? "🏬 " : ""}{bName.get(other) ?? other}</Td>
                        <Td align="center">{snTotal ? snChip(snDone, snTotal) : <span className="text-[10px] text-muted">—</span>}</Td>
                        <Td align="center"><Badge tone={sMeta(tr.status).tone}>{sMeta(tr.status).label}</Badge></Td>
                        <Td className="text-xs text-muted">{new Date(tr.created_at).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short" })}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : <EmptyState icon={<ArrowLeftRight size={26} />} title={t.common.empty} body={L("สร้างใบโอนออก หรือรอรับสินค้าจากสาขา/คลัง", "Create a transfer or receive from a branch/warehouse", "创建调拨或收货")} />}
        </TablePanel>
      </div>

      {/* ── detail drawer (overview + timeline) ── */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="lg"
        title={detail ? <span className="font-mono">{detail.transfer_no}</span> : ""}
        subtitle={detail ? `${detail.from_kind === "warehouse" ? "🏬 " : ""}${bName.get(detail.from_branch_id) ?? detail.from_branch_id} → ${bName.get(detail.to_branch_id) ?? detail.to_branch_id}` : ""}
        badge={detail ? <Badge tone={sMeta(detail.status).tone}>{sMeta(detail.status).label}</Badge> : null}
        footer={detail ? (
          <div className="flex gap-2 w-full">
            {canApprove(detail) ? <><Button variant="ghost" loading={busy} onClick={() => void reject(detail)}><X size={15} /> {L("ปฏิเสธ", "Reject", "拒绝")}</Button><Button variant="primary" className="ml-auto" loading={busy} onClick={() => void approve(detail)}><Check size={15} /> {t.transfer.approve}</Button></> : null}
            {canScanOut(detail) ? <Button variant="primary" className="ml-auto" loading={busy} disabled={!scanOutReady(detail) || hasBlocked(detail)} onClick={() => void scanOut(detail)}><ScanLine size={15} /> {L("ยืนยันสแกนออก", "Confirm scan-out", "确认扫出")}</Button> : null}
            {canDispatch(detail) ? <Button variant="primary" className="ml-auto" loading={busy} onClick={() => void dispatch(detail)}><Truck size={15} /> {t.transfer.ship}</Button> : null}
            {canReceive(detail) ? <Button variant="ok" className="ml-auto" loading={busy} onClick={() => void receive(detail)}><PackageCheck size={15} /> {t.transfer.receive}</Button> : null}
          </div>
        ) : null}>
        {detail ? (
          <>
            <DrawerTabs<Tab> value={tab} onChange={setTab} options={[{ value: "overview", label: L("ภาพรวม", "Overview", "概览") }, { value: "timeline", label: <span className="inline-flex items-center gap-1"><Clock size={12} />Timeline</span> }]} />
            {tab === "overview" ? (
              <div className="p-5 space-y-4">
                <TransferStepper status={detail.status} locale={locale} L={L} />
                <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
                  <DetailRow label={t.transfer.from}>{detail.from_kind === "warehouse" ? "🏬 " : ""}{bName.get(detail.from_branch_id) ?? "—"}</DetailRow>
                  <DetailRow label={t.transfer.to}>{bName.get(detail.to_branch_id) ?? "—"}</DetailRow>
                  {detail.jst_allocation_no ? <DetailRow label="JST">{detail.jst_allocation_no}</DetailRow> : null}
                  {detail.carrier ? <DetailRow label={L("ขนส่ง", "Carrier", "承运")}>{carriers.find((c) => c.id === detail.carrier)?.name ?? detail.carrier}{detail.tracking ? ` · ${detail.tracking}` : ""}</DetailRow> : null}
                  {detail.note ? <DetailRow label={t.common.note}>{detail.note}</DetailRow> : null}
                </div>

                {hasBlocked(detail) ? <p className="text-[11px] text-danger flex items-center gap-1.5"><CircleAlert size={13} /> {L("มีสินค้ายังไม่จัดประเภท Serial — ส่งไม่ได้จนกว่าจะจัดประเภท", "Unclassified serial item — cannot ship", "有未分类序列商品 — 不可发货")}</p> : null}
                {canReceive(detail) ? <p className="text-[11px] text-muted flex items-center gap-1.5"><ScanLine size={13} /> {L("สแกน SN ที่รับจริงเทียบกับที่ส่งมา · กรอกจำนวนสำหรับสินค้าไม่ใช้ SN", "Scan received SNs vs shipped · enter qty for non-serial", "扫描实收序列")}</p> : null}

                {/* lines */}
                <div className="space-y-2">
                  {detail.items.map((it) => (
                    <LineCard key={it.product_id} it={it} incoming={incoming} locale={locale} L={L}
                      scanned={scanned[it.product_id] ?? []} recvQty={recvQty[it.product_id] ?? ""}
                      canScanOut={canScanOut(detail)} canReceive={canReceive(detail)}
                      onScan={() => setSn({ pid: it.product_id, name: it.name, qty: incoming ? (it.qty_shipped || it.qty_requested) : it.qty_requested })}
                      onQty={(v) => setRecvQty((r) => ({ ...r, [it.product_id]: v }))}
                      snChip={snChip} />
                  ))}
                </div>

                {/* dispatch form */}
                {canDispatch(detail) ? (
                  <div className="rounded-2xl border border-line p-3 space-y-2 bg-surface2/40">
                    <p className="text-xs font-semibold flex items-center gap-1.5"><Truck size={13} /> {L("ยืนยันส่งออก (เลือกขนส่งได้)", "Dispatch (carrier optional)", "发货")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={disp.carrier} onChange={(e) => setDisp((d) => ({ ...d, carrier: e.target.value }))} className="h-9"><option value="">{L("— ขนส่ง —", "— Carrier —", "— 承运 —")}</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                      <Input value={disp.tracking} onChange={(e) => setDisp((d) => ({ ...d, tracking: e.target.value }))} placeholder={L("เลขพัสดุ", "Tracking", "运单号")} className="h-9" />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <TimelineTab rows={timeline} locale={locale} L={L} />
            )}
          </>
        ) : null}
      </Drawer>

      {/* SN scan modal (out/in) */}
      <SerialModal open={Boolean(sn)} onClose={() => setSn(null)} productName={sn?.name ?? ""} qty={sn?.qty ?? 0}
        initial={sn ? scanned[sn.pid] ?? [] : []}
        onSave={(serials) => { if (sn) setScanned((s) => ({ ...s, [sn.pid]: serials })); setSn(null); }} />

      {/* create outgoing */}
      <Modal open={open} onClose={() => setOpen(false)} title={t.transfer.request} size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button variant="primary" loading={busy} disabled={!dest || !lines.length} onClick={() => void create()}>{t.transfer.request}</Button></>}>
        <div className="space-y-4">
          <Field label={t.transfer.to}>
            <Select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">—</option>
              {branches.filter((b) => b.id !== branchId).map((b) => <option key={b.id} value={b.id}>{bName.get(b.id)}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-1"><option value="">{t.common.add}…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick2(p, locale)}{p.track_serial ? " · SN" : ""}</option>)}</Select>
            <Button variant="soft" onClick={addLine} disabled={!pickId}><Plus size={16} /></Button>
          </div>
          <Table>
            <thead><tr><Th>{t.admin.products}</Th><Th align="center">{t.common.qty}</Th><Th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td className="text-xs">{l.name}{l.isSerialized ? <Barcode size={11} className="inline ml-1 text-brand" /> : null}</Td>
                  <Td align="center"><Input value={l.qty} inputMode="numeric" onChange={(e) => setLines((list) => list.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x))} className="h-8 w-16 text-center tnum" /></Td>
                  <Td align="right"><button onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))} className="text-muted hover:text-danger"><Trash2 size={14} /></button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Field label={t.common.note}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Modal>
    </PosPage>
  );
}

// ── Stepper ติดตามสถานะการโอน (เหมือนติดตามพัสดุ) ──
function transferStage(status: Transfer["status"]): { idx: number; failed: boolean } {
  if (status === "cancelled" || status === "rejected") return { idx: -1, failed: true };
  const order: Record<string, number> = {
    draft: 0, pending_approval: 0, approved: 1, picking: 1, packed: 2,
    shipped: 3, in_transit: 3, received: 4, partial_received: 4, completed: 4,
  };
  return { idx: order[status] ?? 0, failed: false };
}
function TransferStepper({ status, locale, L }: { status: Transfer["status"]; locale: string; L: (th: string, en: string, zh: string) => string }) {
  const stages = [
    { icon: ClipboardList, label: L("สร้างคำขอ", "Created", "创建") },
    { icon: Check, label: L("อนุมัติ", "Approved", "批准") },
    { icon: ScanLine, label: L("สแกนออก", "Scanned out", "扫出") },
    { icon: Truck, label: L("ระหว่างทาง", "In transit", "运输中") },
    { icon: PackageCheck, label: L("รับเข้า", "Received", "收货") },
  ];
  const { idx, failed } = transferStage(status);
  const partial = status === "partial_received";
  if (failed) {
    return (
      <div className="rounded-xl bg-danger/8 border border-danger/25 text-danger text-xs px-3 py-2.5 flex items-center gap-2">
        <Ban size={15} /> {status === "cancelled" ? L("การโอนถูกยกเลิก — คืนของจองแล้ว", "Transfer cancelled", "已取消") : L("คำขอถูกปฏิเสธ — คืนของจองแล้ว", "Request rejected", "已拒绝")}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-line bg-surface2/30 px-3 py-4">
      <div className="flex items-start">
        {stages.map((s, i) => {
          const done = i < idx || (i === idx && idx === 4 && !partial);
          const cur = i === idx && !(idx === 4 && !partial);
          const warn = i === 4 && partial;
          const Icon = s.icon;
          return (
            <Fragment key={i}>
              <div className="flex flex-col items-center gap-1.5 shrink-0 w-14">
                <div className={`w-9 h-9 rounded-full grid place-items-center border-2 transition-all duration-300 ${
                  warn ? "bg-amber-500 border-amber-500 text-white"
                  : done ? "bg-brand border-brand text-white"
                  : cur ? "border-brand text-brand ring-4 ring-brand/15 bg-surface animate-[pulse_2s_ease-in-out_infinite]"
                  : "border-line text-muted bg-surface"}`}>
                  {done ? <Check size={16} /> : <Icon size={15} />}
                </div>
                <span className={`text-[9.5px] leading-tight text-center ${cur || warn ? "text-brand font-semibold" : done ? "text-ink" : "text-muted"}`}>{s.label}</span>
              </div>
              {i < stages.length - 1 ? <div className="flex-1 h-0.5 rounded-full mt-[18px] mx-0.5 overflow-hidden bg-line"><div className={`h-full rounded-full transition-all duration-500 ${i < idx ? "w-full bg-brand" : "w-0"}`} /></div> : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ตัวติดตามรายสินค้า: ขอ → ส่ง → รับ (พร้อมจำนวน + เส้นเชื่อม)
function ItemJourney({ req, shipped, received, L }: { req: number; shipped: number; received: number; L: (th: string, en: string, zh: string) => string }) {
  const nodes = [
    { label: L("ขอ", "Req", "请求"), val: req, filled: req > 0 },
    { label: L("ส่ง", "Ship", "发"), val: shipped, filled: shipped > 0 },
    { label: L("รับ", "Recv", "收"), val: received, filled: received > 0 && received >= shipped },
  ];
  return (
    <div className="flex items-center mt-2">
      {nodes.map((n, i) => (
        <Fragment key={i}>
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <div className={`w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold tnum border ${n.filled ? (i === 2 ? "bg-ok border-ok text-white" : "bg-brand border-brand text-white") : "border-line text-muted"}`}>{n.val}</div>
            <span className="text-[9px] text-muted">{n.label}</span>
          </div>
          {i < nodes.length - 1 ? <div className="flex-1 h-0.5 rounded-full mx-1 mb-3 bg-line overflow-hidden"><div className={`h-full rounded-full ${nodes[i + 1].filled ? "w-full bg-brand" : "w-0"} ${i === 1 && received >= shipped && shipped > 0 ? "bg-ok" : ""}`} /></div> : null}
        </Fragment>
      ))}
    </div>
  );
}

// บรรทัดสินค้าในใบโอน (ภาพรวม + ปุ่มสแกน + กระทบ SN ตอนรับ)
function LineCard({ it, incoming, locale, L, scanned, recvQty, canScanOut, canReceive, onScan, onQty, snChip }: {
  it: TransferItem; incoming: boolean; locale: string; L: (th: string, en: string, zh: string) => string;
  scanned: string[]; recvQty: string; canScanOut: boolean; canReceive: boolean;
  onScan: () => void; onQty: (v: string) => void; snChip: (c: number, t: number) => React.ReactNode;
}) {
  const shipped = it.shippedSerials?.map((s) => s.serialNo) ?? [];
  const rec = incoming && canReceive ? scanned : (canScanOut ? scanned : (incoming ? it.receivedSerials?.map((s) => s.serialNo) ?? [] : shipped));
  const rc = it.isSerialized && incoming ? reconcileSerials(shipped, scanned) : null;
  const target = incoming ? (it.qty_shipped || it.qty_requested) : it.qty_requested;
  const progress = it.isSerialized ? rec.length : (incoming ? Number(recvQty || 0) : it.qty_shipped);
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{it.name}{it.isSerialized === null ? <Badge tone="danger" className="ml-1">{L("ยังไม่จัดประเภท", "Unclassified", "未分类")}</Badge> : it.isSerialized ? <Barcode size={12} className="inline ml-1 text-brand" /> : null}</p>
          <p className="font-mono text-[10px] text-muted">{it.sku} · {L("ขอ", "Req", "请求")} {it.qty_requested}{it.qty_shipped ? ` · ${L("ส่ง", "Ship", "发")} ${it.qty_shipped}` : ""}</p>
        </div>
        <div className="shrink-0 text-right">
          {it.isSerialized ? snChip(progress, target) : null}
        </div>
      </div>
      <ItemJourney req={it.qty_requested}
        shipped={canScanOut && it.isSerialized ? scanned.length : it.qty_shipped}
        received={incoming ? (it.isSerialized ? scanned.length : Number(recvQty || 0)) : it.qty_received} L={L} />
      {/* actions / reconcile */}
      {it.isSerialized && (canScanOut || canReceive) ? (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button onClick={onScan} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-brand/30 text-brand hover:bg-brand/8"><ScanLine size={13} /> {incoming ? L("สแกนรับ", "Scan in", "扫入") : L("สแกนออก", "Scan out", "扫出")} ({scanned.length}/{target})</button>
          {rc ? (
            <span className="text-[11px] flex items-center gap-2 flex-wrap">
              {rc.ok && rc.matched.length === target ? <span className="text-ok inline-flex items-center gap-0.5"><Check size={12} /> {L("ครบ", "Complete", "齐全")}</span> : null}
              {rc.missing.length ? <span className="text-amber-600">{L("ขาด", "Missing", "缺")} {rc.missing.length}</span> : null}
              {rc.extra.length ? <span className="text-danger">{L("ไม่ตรง", "Not shipped", "未发")} {rc.extra.length}</span> : null}
              {rc.duplicates.length ? <span className="text-danger">{L("ซ้ำ", "Dup", "重复")} {rc.duplicates.length}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {!it.isSerialized && incoming && canReceive ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted">{L("รับจำนวน", "Receive qty", "收货数")}</span>
          <Input value={recvQty} inputMode="numeric" onChange={(e) => onQty(e.target.value.replace(/\D/g, ""))} className="h-8 w-20 text-center tnum" />
          <span className="text-[11px] text-muted">/ {target}</span>
        </div>
      ) : null}
      {it.isSerialized && !incoming && !canScanOut && it.qty_received ? <p className="text-[11px] text-muted mt-1">{L("รับแล้ว", "Received", "已收")} {it.qty_received}</p> : null}
    </div>
  );
}

// Timeline จาก audit (ตามแพทเทิร์น order-drawer)
function TimelineTab({ rows, locale, L }: { rows: AuditEntry[]; locale: string; L: (th: string, en: string, zh: string) => string }) {
  if (!rows.length) return <div className="p-6 text-center text-sm text-muted">{L("ยังไม่มีประวัติ", "No history yet", "暂无记录")}</div>;
  const clock = (t: string) => new Date(t).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const toneColor: Record<string, string> = { ok: "bg-ok", warn: "bg-amber-500", danger: "bg-danger", brand: "bg-brand", neutral: "bg-muted" };
  return (
    <ol className="relative border-l border-line ml-6 my-5 mr-5 space-y-5">
      {rows.map((r, i) => {
        const st = (r.after_data as { status?: Transfer["status"] })?.status;
        const meta = st ? statusMeta(st, locale as "th" | "en" | "zh") : null;
        return (
          <li key={i} className="ml-5">
            <span className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 border-surface ${toneColor[meta?.tone ?? "neutral"] ?? "bg-muted"}`} />
            <p className="text-sm font-medium">{meta?.label ?? r.action}</p>
            <p className="text-[11px] text-muted">{clock(r.occurred_at)}{r.actor_name ? ` · ${r.actor_name}` : ""}</p>
          </li>
        );
      })}
    </ol>
  );
}

function pick2(p: Product, locale: string) {
  return locale === "th" ? p.name_th : locale === "zh" ? p.name_zh ?? p.name_th : p.name_en ?? p.name_th;
}
