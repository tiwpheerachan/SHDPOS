"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ArrowLeftRight, Plus, Trash2, Truck, PackageCheck, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import {
  listBranches, listProducts, listTransfersForBranch, createTransfer, shipTransfer, receiveTransfer,
} from "@/lib/data/repo";
import type { Branch, Product, Transfer, TransferStatus } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, Badge, EmptyState, Modal, Field, Drawer, DetailRow, Skeleton } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { can } from "@/lib/permissions";

interface Line { id: string; product_id: string; sku: string; name: string; qty: number }

export default function PosTransfersPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [list, setList] = useState<Transfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [recv, setRecv] = useState<Record<string, string>>({});
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
    const [tr, b, p] = await Promise.all([listTransfersForBranch(branchId), listBranches(), listProducts()]);
    setList(tr); setBranches(b); setProducts(p); setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [branchId]);
  useEffect(() => {
    if (detail && detail.to_branch_id === branchId) {
      const init: Record<string, string> = {};
      for (const it of detail.items) init[it.product_id] = String(it.qty_shipped || it.qty_requested);
      setRecv(init);
    }
  }, [detail, branchId]);

  const bName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);
  const dirOf = (tr: Transfer): "in" | "out" => (tr.to_branch_id === branchId ? "in" : "out");
  const statusMeta: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "ok" | "danger" }> = {
    pending_approval: { label: L("รออนุมัติ", "Pending", "待批"), tone: "warn" },
    approved: { label: L("อนุมัติแล้ว", "Approved", "已批"), tone: "info" },
    in_transit: { label: L("กำลังส่ง", "In transit", "运输中"), tone: "info" },
    partial_received: { label: L("รับบางส่วน", "Partial", "部分收货"), tone: "warn" },
    completed: { label: L("รับครบแล้ว", "Completed", "已完成"), tone: "ok" },
    cancelled: { label: L("ยกเลิก", "Cancelled", "已取消"), tone: "neutral" },
    rejected: { label: L("ปฏิเสธ", "Rejected", "已拒绝"), tone: "danger" },
  };
  const sMeta = (s: string) => statusMeta[s] ?? { label: s, tone: "neutral" as const };

  const filtered = useMemo(() => (dir === "all" ? list : list.filter((tr) => dirOf(tr) === dir)), [list, dir, branchId]);
  const stats = useMemo(() => ({
    incoming: list.filter((tr) => dirOf(tr) === "in" && ["in_transit", "approved", "partial_received"].includes(tr.status)).length,
    outgoing: list.filter((tr) => dirOf(tr) === "out" && ["pending_approval", "approved"].includes(tr.status)).length,
    completed: list.filter((tr) => tr.status === "completed").length,
  }), [list, branchId]);

  function addLine() { const p = products.find((x) => x.id === pickId); if (!p) return; setLines((l) => [...l, { id: nanoid(), product_id: p.id, sku: p.sku, name: p.name_th, qty: 1 }]); setPickId(""); }

  async function create() {
    if (!branchId || !employee || !dest || !lines.length) return;
    setBusy(true);
    try {
      await createTransfer(branchId, dest, employee.id, lines, note, can(employee, "transfer.approve"));
      setOpen(false); setDest(""); setLines([]); setNote(""); await reload();
      toast.push({ tone: "ok", title: t.transfer.title });
    } finally { setBusy(false); }
  }
  async function ship(tr: Transfer) {
    if (!employee) return; setBusy(true);
    try { await shipTransfer(tr, employee.id); await reload(); setDetail(null); toast.push({ tone: "ok", title: t.transfer.ship, body: tr.transfer_no }); }
    finally { setBusy(false); }
  }
  async function receive(tr: Transfer) {
    if (!employee) return; setBusy(true);
    try {
      const map: Record<string, number> = {};
      for (const it of tr.items) map[it.product_id] = Number(recv[it.product_id] ?? 0);
      await receiveTransfer(tr, employee.id, map); await reload(); setDetail(null);
      toast.push({ tone: "ok", title: t.transfer.receive, body: tr.transfer_no });
    } finally { setBusy(false); }
  }

  if (!employee) return null;

  const canReceive = (tr: Transfer) => dirOf(tr) === "in" && ["in_transit", "approved", "shipped", "partial_received"].includes(tr.status) && can(employee, "transfer.receive");
  const canShip = (tr: Transfer) => dirOf(tr) === "out" && ["pending_approval", "approved"].includes(tr.status);

  return (
    <PosPage
      title={t.transfer.title}
      icon={<ArrowLeftRight size={18} />}
      actions={
        <>
          <Select value={dir} onChange={(e) => setDir(e.target.value as "all" | "in" | "out")} className="w-32 h-9">
            <option value="all">{t.common.all}</option>
            <option value="in">{L("ขาเข้า", "Incoming", "入库")}</option>
            <option value="out">{L("ขาออก", "Outgoing", "出库")}</option>
          </Select>
          {can(employee, "transfer.request") ? <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> {t.transfer.request}</Button> : null}
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatChip label={L("รอรับเข้า", "To receive", "待收货")} value={String(stats.incoming)} accent={stats.incoming ? "coral" : "mint"} icon={<ArrowDownLeft size={16} />} />
          <StatChip label={L("รอส่งออก", "To ship", "待发货")} value={String(stats.outgoing)} accent="lavender" icon={<ArrowUpRight size={16} />} />
          <StatChip label={L("เสร็จแล้ว", "Completed", "已完成")} value={String(stats.completed)} accent="mint" icon={<PackageCheck size={16} />} />
        </div>

        <TablePanel>
          {loading ? <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            : filtered.length ? (
              <Table>
                <thead><tr><Th>{L("เลขโอน", "Transfer No.", "调拨单")}</Th><Th>{L("ทิศทาง", "Direction", "方向")}</Th><Th>{L("สาขาคู่", "Branch", "对方门店")}</Th><Th align="right">{L("รายการ", "Items", "行数")}</Th><Th align="center">{t.common.status}</Th><Th>{t.common.date}</Th></tr></thead>
                <tbody>
                  {filtered.map((tr) => {
                    const d = dirOf(tr);
                    const other = d === "in" ? tr.from_branch_id : tr.to_branch_id;
                    return (
                      <tr key={tr.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setDetail(tr)}>
                        <Td className="font-mono text-xs">{tr.transfer_no}</Td>
                        <Td><Badge tone={d === "in" ? "ok" : "info"}>{d === "in" ? <><ArrowDownLeft size={11} /> {L("เข้า", "In", "入")}</> : <><ArrowUpRight size={11} /> {L("ออก", "Out", "出")}</>}</Badge></Td>
                        <Td className="text-xs text-muted">{bName.get(other) ?? other}</Td>
                        <Td align="right" className="text-xs tnum">{tr.items.length}</Td>
                        <Td align="center"><Badge tone={sMeta(tr.status).tone}>{sMeta(tr.status).label}</Badge></Td>
                        <Td className="text-xs text-muted">{new Date(tr.created_at).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short" })}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : <EmptyState icon={<ArrowLeftRight size={26} />} title={t.common.empty} body={L("สร้างใบโอนออก หรือรอรับสินค้าจากสาขาอื่น", "Create an outgoing transfer or receive from another branch", "创建调拨或收货")} />}
        </TablePanel>
      </div>

      {/* detail / receive drawer */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="lg"
        title={detail ? <span className="font-mono">{detail.transfer_no}</span> : ""}
        subtitle={detail ? `${bName.get(detail.from_branch_id) ?? ""} → ${bName.get(detail.to_branch_id) ?? ""}` : ""}
        badge={detail ? <Badge tone={sMeta(detail.status).tone}>{sMeta(detail.status).label}</Badge> : null}
        footer={detail ? (
          <>
            {canShip(detail) ? <Button variant="primary" className="ml-auto" loading={busy} onClick={() => void ship(detail)}><Truck size={15} /> {t.transfer.ship}</Button> : null}
            {canReceive(detail) ? <Button variant="ok" className="ml-auto" loading={busy} onClick={() => void receive(detail)}><PackageCheck size={15} /> {t.transfer.receive}</Button> : null}
          </>
        ) : null}>
        {detail ? (
          <div className="p-5 space-y-4">
            <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
              <DetailRow label={t.transfer.from}>{bName.get(detail.from_branch_id) ?? "—"}</DetailRow>
              <DetailRow label={t.transfer.to}>{bName.get(detail.to_branch_id) ?? "—"}</DetailRow>
              <DetailRow label={t.common.date}>{new Date(detail.created_at).toLocaleString(locale === "th" ? "th-TH" : "en-US")}</DetailRow>
              {detail.note ? <DetailRow label={t.common.note}>{detail.note}</DetailRow> : null}
            </div>

            {canReceive(detail) ? <p className="text-[11px] text-muted flex items-center gap-1.5"><PackageCheck size={13} /> {t.transfer.scanToReceive} — {L("สต๊อกปลายทางจะเพิ่มตามจำนวนที่รับจริง", "destination stock updates by received qty", "按实收数量入库")}</p> : null}

            <div className="rounded-2xl border border-line overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase text-muted"><th className="text-left font-semibold px-3 py-2">{t.admin.products}</th><th className="text-right font-semibold px-3 py-2">{t.transfer.requested}</th><th className="text-right font-semibold px-3 py-2">{t.transfer.shipped}</th><th className="text-right font-semibold px-3 py-2">{canReceive(detail) ? t.transfer.receive : t.transfer.received}</th></tr></thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.product_id} className="border-t border-line/60">
                      <td className="px-3 py-2"><p className="font-medium">{it.name}</p><p className="font-mono text-[10px] text-muted">{it.sku}</p></td>
                      <td className="px-3 py-2 text-right tnum">{it.qty_requested}</td>
                      <td className="px-3 py-2 text-right tnum">{it.qty_shipped || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {canReceive(detail) ? (
                          <Input value={recv[it.product_id] ?? ""} inputMode="numeric" onChange={(e) => setRecv((r) => ({ ...r, [it.product_id]: e.target.value.replace(/\D/g, "") }))} className="h-8 w-16 text-center tnum ml-auto" />
                        ) : <span className="tnum">{it.qty_received || "—"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* create outgoing */}
      <Modal open={open} onClose={() => setOpen(false)} title={t.transfer.request} size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button variant="primary" loading={busy} disabled={!dest || !lines.length} onClick={() => void create()}>{t.transfer.request}</Button></>}>
        <div className="space-y-4">
          <Field label={t.transfer.to}>
            <Select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">—</option>
              {branches.filter((b) => b.id !== branchId && b.branch_type !== "warehouse").map((b) => <option key={b.id} value={b.id}>{bName.get(b.id)}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-1"><option value="">{t.common.add}…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick2(p, locale)}</option>)}</Select>
            <Button variant="soft" onClick={addLine} disabled={!pickId}><Plus size={16} /></Button>
          </div>
          <Table>
            <thead><tr><Th>{t.admin.products}</Th><Th align="center">{t.common.qty}</Th><Th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td className="text-xs">{l.name}</Td>
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

function pick2(p: Product, locale: string) {
  return locale === "th" ? p.name_th : locale === "zh" ? p.name_zh ?? p.name_th : p.name_en ?? p.name_th;
}
