"use client";

// หน้า admin — ติดตาม/อนุมัติใบโอนย้ายทุกสาขา (ใช้ engine + ดีไซน์เดียวกับ /pos/transfers)
import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ArrowLeftRight, Plus, Trash2, Check, X, Clock, Barcode, CircleAlert, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listProducts } from "@/lib/data/repo";
import {
  owListAll, owCreate, owApprove, owReject, owGet, owTimeline,
  statusMeta, isActive, isIssue, owErrorMessage,
} from "@/lib/onewarehouse";
import { TransferStepper, ItemJourney, TransferTimeline } from "@/components/admin/transfer-ui";
import { printTransferCO } from "@/lib/transfer/print-co";
import type { Branch, Product, Transfer, AuditEntry } from "@/lib/types";
import { Button, Card, Input, Field, Select, Table, Th, Td, Badge, EmptyState, Modal, Drawer, DrawerTabs, DetailRow } from "@/components/ui";
import { can, visibleBranchIds } from "@/lib/permissions";

type Tab = "overview" | "timeline";

export default function AdminTransfersPage() {
  const { t, locale, pick } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const toast = useToast();
  const { employee } = useSession();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [list, setList] = useState<Transfer[]>([]);
  const [bucket, setBucket] = useState<"active" | "issue" | "done" | "all">("active");
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [timeline, setTimeline] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  // create
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<{ id: string; product_id: string; qty: number }[]>([]);
  const [pickId, setPickId] = useState("");
  const [note, setNote] = useState("");

  async function reload() { setList(await owListAll()); }
  useEffect(() => {
    void (async () => {
      const [b, p] = await Promise.all([listBranches(), listProducts()]);
      setBranches(b); setProducts(p); setFrom(b[0]?.id ?? ""); setTo(b[1]?.id ?? "");
      await reload();
    })();
  }, []);
  useEffect(() => { setTab("overview"); if (detail) void owTimeline(detail.transfer_no).then(setTimeline); }, [detail]);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const bName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id; };
  const sMeta = (s: Transfer["status"]) => statusMeta(s, locale);

  const visible = useMemo(() => list
    .filter((x) => allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id))
    .filter((x) => bucket === "all" ? true : bucket === "active" ? isActive(x.status) : bucket === "issue" ? isIssue(x.status) : x.status === "completed"),
    [list, allowed, bucket]);

  async function create() {
    if (!employee || !from || !to || from === to || !lines.length) return;
    setBusy(true);
    try {
      const ls = lines.map((l) => { const p = products.find((x) => x.id === l.product_id)!; return { product_id: p.id, sku: p.sku, name: p.name_th, qty: l.qty, isSerialized: p.track_serial ? true : false }; });
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

  const canApprove = (tr: Transfer) => tr.status === "pending_approval" && can(employee, "transfer.approve");
  function printCO(tr: Transfer) {
    printTransferCO(tr, { fromName: bName(tr.from_branch_id), toName: bName(tr.to_branch_id), statusLabel: sMeta(tr.status).label, locale, carrierName: tr.carrier });
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2"><ArrowLeftRight size={16} className="text-brand" /> {t.transfer.title}</h2>
        <div className="flex gap-1.5 ml-auto">
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
                  <tr key={tr.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setDetail(tr)}>
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
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="lg"
        title={detail ? <span className="font-mono">{detail.transfer_no}</span> : ""}
        subtitle={detail ? `${detail.from_kind === "warehouse" ? "🏬 " : ""}${bName(detail.from_branch_id)} → ${bName(detail.to_branch_id)}` : ""}
        badge={detail ? <Badge tone={sMeta(detail.status).tone}>{sMeta(detail.status).label}</Badge> : null}
        footer={detail ? (
          <div className="flex gap-2 w-full items-center">
            <Button variant="soft" onClick={() => printCO(detail)}><Printer size={15} /> {L("พิมพ์ใบ CO", "Print CO", "打印CO")}</Button>
            {canApprove(detail) ? <>
              <Button variant="ghost" className="ml-auto" loading={busy} onClick={() => void act(() => owReject(detail, employee!.id), L("ปฏิเสธแล้ว", "Rejected", "已拒绝"))}><X size={15} /> {L("ปฏิเสธ", "Reject", "拒绝")}</Button>
              <Button variant="primary" loading={busy} onClick={() => void act(() => owApprove(detail, employee!.id), t.transfer.approve)}><Check size={15} /> {t.transfer.approve}</Button>
            </> : null}
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
                <p className="text-[11px] text-muted flex items-center gap-1.5"><CircleAlert size={12} /> {L("หน้านี้ใช้ติดตาม/อนุมัติ · การสแกนออก-รับเข้าทำที่ POS ของสาขา", "Monitor/approve here · scan-out & receive happen at branch POS", "此页用于监控/审批")}</p>
                <div className="space-y-2">
                  {detail.items.map((it) => (
                    <div key={it.product_id} className="rounded-2xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{it.name}{it.isSerialized === null ? <Badge tone="danger" className="ml-1">{L("ยังไม่จัดประเภท", "Unclassified", "未分类")}</Badge> : it.isSerialized ? <Barcode size={12} className="inline ml-1 text-brand" /> : null}</p>
                          <p className="font-mono text-[10px] text-muted">{it.sku}</p>
                        </div>
                      </div>
                      <ItemJourney req={it.qty_requested} shipped={it.qty_shipped} received={it.qty_received} L={L} />
                    </div>
                  ))}
                </div>
              </div>
            ) : <TransferTimeline rows={timeline} locale={locale} L={L} />}
          </>
        ) : null}
      </Drawer>

      {/* create */}
      <Modal open={open} onClose={() => setOpen(false)} title={t.transfer.request} size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button variant="primary" loading={busy} disabled={!lines.length || from === to} onClick={() => void create()}>{t.common.save}</Button></>}>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t.transfer.from}><Select value={from} onChange={(e) => setFrom(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{bName(b.id)}</option>)}</Select></Field>
            <Field label={t.transfer.to}><Select value={to} onChange={(e) => setTo(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{bName(b.id)}</option>)}</Select></Field>
          </div>
          {from === to ? <p className="text-xs text-danger">{L("ต้นทางและปลายทางต้องไม่ใช่สาขาเดียวกัน", "Source and destination must differ", "调出调入不能相同")}</p> : null}
          <div className="flex gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-1"><option value="">{t.common.add}...</option>{products.filter((p) => p.is_stocked).map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}{p.track_serial ? " · SN" : ""}</option>)}</Select>
            <Button variant="soft" disabled={!pickId} onClick={() => { setLines((l) => [...l, { id: nanoid(), product_id: pickId, qty: 1 }]); setPickId(""); }}><Plus size={16} /></Button>
          </div>
          <Table>
            <thead><tr><Th>{t.admin.products}</Th><Th align="center">{t.common.qty}</Th><Th /></tr></thead>
            <tbody>
              {lines.map((l) => { const p = products.find((x) => x.id === l.product_id); return (
                <tr key={l.id}>
                  <Td className="text-xs">{p?.name_th}{p?.track_serial ? <Barcode size={11} className="inline ml-1 text-brand" /> : null}</Td>
                  <Td align="center"><Input value={l.qty} inputMode="numeric" onChange={(e) => setLines((list) => list.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x))} className="h-8 w-20 text-center tnum" /></Td>
                  <Td align="right"><button onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))} className="text-muted hover:text-danger"><Trash2 size={14} /></button></Td>
                </tr>
              ); })}
            </tbody>
          </Table>
          <Field label={t.common.note}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
