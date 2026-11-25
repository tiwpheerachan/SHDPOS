"use client";
// ปรับสต๊อก (โหมดจริง · /api/pos/adjustments · 0078 · UAT F051) — ขอปรับ → ผู้อนุมัติคนอื่นอนุมัติ → ปรับสต๊อกครั้งเดียว
import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Search, Plus, Trash2, CheckCircle2, XCircle, Send, ScanLine, FileText } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listProducts, stockForBranch } from "@/lib/data/repo";
import type { Product, StockLevel } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, EmptyState, Badge, Modal, Field, Segmented } from "@/components/ui";
import { PosPage, TablePanel } from "@/components/pos/page-shell";
import { can } from "@/lib/permissions";
import { formatTHB } from "@/lib/money";
import { uuidv4 } from "@/lib/uuid";

type Reason = "damage" | "lost" | "expired" | "internal_use" | "found" | "correction";
const REASONS: { code: Reason; label: string; dir: -1 | 1 | 0; hint: string }[] = [
  { code: "damage", label: "ของเสีย / ชำรุด", dir: -1, hint: "ตัดออก · SN เป็นสถานะชำรุด" },
  { code: "lost", label: "สูญหาย", dir: -1, hint: "ตัดออก · SN เป็นสถานะหาย" },
  { code: "expired", label: "หมดอายุ / เสื่อมสภาพ", dir: -1, hint: "ตัดออก" },
  { code: "internal_use", label: "ใช้ภายใน / ตัวโชว์", dir: -1, hint: "ตัดออก · ต้องอธิบาย" },
  { code: "found", label: "พบสินค้าเพิ่ม", dir: 1, hint: "เพิ่มเข้า (สินค้า SN ใช้การรับเข้า)" },
  { code: "correction", label: "แก้ยอดผิด", dir: 0, hint: "เพิ่ม/ลด · ต้องอธิบาย" },
];
const reasonLabel = (c: string) => REASONS.find((r) => r.code === c)?.label ?? c;
type Line = { product: Product; qty: string; serials: string };
type Adj = { id: string; adj_no: string; reason_code: string; note: string | null; status: "pending" | "approved" | "rejected" | "cancelled"; lines: { sku: string; name: string; delta: number; value: number; serials: string[] }[];
  total_value: number; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null };
const STATUS: Record<Adj["status"], { label: string; tone: "warn" | "ok" | "danger" | "neutral" }> = { pending: { label: "รออนุมัติ", tone: "warn" }, approved: { label: "อนุมัติแล้ว", tone: "ok" }, rejected: { label: "ไม่อนุมัติ", tone: "danger" }, cancelled: { label: "ยกเลิก", tone: "neutral" } };
const when = (s: string | null) => (s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function AdjustLive() {
  const { employee, branchId } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState<"new" | "list">("new");
  const [products, setProducts] = useState<Product[]>([]), [stock, setStock] = useState<Map<string, StockLevel>>(new Map());
  const [reason, setReason] = useState<Reason>("damage"), [note, setNote] = useState(""), [lines, setLines] = useState<Line[]>([]), [q, setQ] = useState(""), [busy, setBusy] = useState(false);
  const [list, setList] = useState<Adj[] | null>(null), [names, setNames] = useState<Record<string, string>>({}), [me, setMe] = useState(""), [owLinked, setOwLinked] = useState(false), [filter, setFilter] = useState<"pending" | "all">("pending");
  const [decide, setDecide] = useState<{ a: Adj; approve: boolean } | null>(null), [decideNote, setDecideNote] = useState("");

  const loadList = useCallback(async () => {
    if (!branchId) return;
    const r = await fetch(`/api/pos/adjustments?branch_id=${branchId}&status=${filter}`, { cache: "no-store" }); const j = await r.json();
    if (!r.ok) { toast.push({ tone: "danger", title: "โหลดใบขอปรับไม่สำเร็จ", body: j.error }); setList([]); return; }
    setList(j.adjustments); setNames(j.names); setMe(j.me); setOwLinked(j.ow_linked);
  }, [branchId, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (branchId) void Promise.all([listProducts(), stockForBranch(branchId)]).then(([p, s]) => { setProducts(p.filter((x) => x.is_stocked && /^[0-9a-f-]{36}$/i.test(x.id))); setStock(s); }); }, [branchId]);

  const r = REASONS.find((x) => x.code === reason)!;
  const picks = useMemo(() => { const t = q.trim().toLowerCase(); return t ? products.filter((p) => p.sku.toLowerCase().includes(t) || p.name_th.toLowerCase().includes(t)).slice(0, 8) : []; }, [q, products]);
  const delta = (l: Line) => { const n = Number(l.qty); if (!Number.isFinite(n) || n === 0) return 0; return r.dir === 0 ? n : r.dir * Math.abs(n); };
  const total = lines.reduce((s, l) => s + delta(l) * Number(l.product.cost ?? 0), 0);
  const pendingCount = (list ?? []).filter((a) => a.status === "pending").length;

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/pos/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request", branch_id: branchId, client_uuid: uuidv4(), reason_code: reason, note,
        lines: lines.map((l) => ({ product_id: l.product.id, delta: delta(l), serials: l.product.track_serial ? l.serials.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) : [] })) }) });
      const j = await res.json(); if (!res.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: `ส่งขอปรับ ${j.adj_no} แล้ว — รอผู้มีสิทธิ์อนุมัติ`, body: "สต๊อกจะเปลี่ยนหลังอนุมัติเท่านั้น" });
      setLines([]); setNote(""); setTab("list"); setFilter("pending"); await loadList();
    } catch (e) { toast.push({ tone: "danger", title: "ส่งขอปรับไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }
  async function act(action: "approve" | "reject" | "cancel", a: Adj, n?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/pos/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: a.id, note: n }) });
      const j = await res.json(); if (!res.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: action === "approve" ? `อนุมัติ ${a.adj_no} — ปรับสต๊อกแล้ว` : action === "reject" ? `ไม่อนุมัติ ${a.adj_no}` : `ยกเลิก ${a.adj_no}` });
      setDecide(null); setDecideNote(""); await loadList();
      if (action === "approve") { try { await (await import("@/lib/offline/refresh")).refreshBranchSnapshot(); } catch { /* */ } }
    } catch (e) { toast.push({ tone: "danger", title: "ทำรายการไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  if (!employee || !branchId) return null;
  const canReq = can(employee, "inventory.adjust"), canApprove = can(employee, "inventory.adjust_approve");

  return (
    <PosPage title="ปรับสต๊อก" icon={<SlidersHorizontal size={18} />}
      actions={<Segmented value={tab} onChange={setTab} options={[{ value: "new", label: "ขอปรับ" }, { value: "list", label: <span>ใบขอปรับ{pendingCount ? <span className="ml-1 text-[10px] px-1.5 rounded-full bg-warn/20 text-warn">{pendingCount}</span> : null}</span> }]} />}>
      <div className="p-4 sm:p-6 space-y-4">
        {owLinked ? <p className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-[12.5px]">สาขานี้ใช้สต๊อกจากคลังกลาง OneWarehouse — ปรับยอดที่ OneWarehouse (POS ไม่แก้ยอดเอง)</p> : null}
        {tab === "new" ? (
          !canReq ? <p className="text-sm text-muted">ไม่มีสิทธิ์ขอปรับสต๊อก</p> : (
            <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
              <div className="card p-4 space-y-3">
                <Field label="เหตุผล *"><Select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>{REASONS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>
                <p className="text-[11px] text-muted">{r.hint}</p>
                <Field label={reason === "correction" || reason === "internal_use" ? "หมายเหตุ *" : "หมายเหตุ"}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ตกแตกระหว่างจัดเรียง" /></Field>
                <div className="rounded-xl bg-surface2 px-3 py-2 text-sm flex justify-between"><span className="text-muted">มูลค่าที่ปรับ (ต้นทุน)</span><b className={`tnum ${total < 0 ? "text-danger" : total > 0 ? "text-ok" : ""}`}>{total > 0 ? "+" : ""}{formatTHB(total)}</b></div>
                <Button variant="primary" className="w-full" loading={busy} disabled={!lines.length || lines.some((l) => !delta(l))} onClick={() => void submit()}><Send size={15} /> ส่งขออนุมัติ</Button>
                <p className="text-[11px] text-muted">สต๊อกยังไม่เปลี่ยนจนกว่าหัวหน้า/ผู้มีสิทธิ์ (ไม่ใช่ผู้ขอ) จะอนุมัติ · ระบบกันสต๊อกติดลบทั้งตอนขอและตอนอนุมัติ</p>
              </div>
              <div className="space-y-3 min-w-0">
                <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา SKU / ชื่อสินค้า เพื่อเพิ่มรายการ" className="pl-9" /></div>
                {picks.length ? <div className="card divide-y divide-line">{picks.map((p) => (
                  <button key={p.id} disabled={lines.some((l) => l.product.id === p.id)} onClick={() => { setLines([...lines, { product: p, qty: "", serials: "" }]); setQ(""); }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface2 disabled:opacity-40">
                    <Plus size={14} /><span className="font-mono text-xs text-muted">{p.sku}</span><span className="truncate">{p.name_th}</span>{p.track_serial ? <Badge tone="neutral">SN</Badge> : null}<span className="ml-auto text-xs text-muted">คงเหลือ {stock.get(p.id)?.qty_on_hand ?? 0}</span>
                  </button>))}</div> : null}
                <TablePanel>
                  {lines.length ? (
                    <Table>
                      <thead><tr><Th>สินค้า</Th><Th align="right">คงเหลือ</Th><Th align="center">{r.dir === -1 ? "จำนวนที่ลด" : r.dir === 1 ? "จำนวนที่เพิ่ม" : "+เพิ่ม / −ลด"}</Th><Th align="right">หลังปรับ</Th><Th align="right">มูลค่า</Th><Th /></tr></thead>
                      <tbody>{lines.map((l, k) => {
                        const on = Number(stock.get(l.product.id)?.qty_on_hand ?? 0), d = delta(l);
                        return (
                          <tr key={l.product.id}>
                            <Td className="text-xs"><span className="font-mono text-muted">{l.product.sku}</span><span className="block">{l.product.name_th}</span>
                              {l.product.track_serial && d < 0 ? <span className="flex items-center gap-1 mt-1"><ScanLine size={12} className="text-muted" /><input value={l.serials} onChange={(e) => setLines(lines.map((x, i) => i === k ? { ...x, serials: e.target.value } : x))} placeholder={`สแกน SN ${Math.abs(d)} ตัว (คั่นด้วยเว้นวรรค)`} className="h-7 flex-1 px-2 rounded-md border border-line bg-surface text-[11px] font-mono" /></span> : null}</Td>
                            <Td align="right" className="text-xs tnum">{on}</Td>
                            <Td align="center"><Input value={l.qty} inputMode="decimal" onChange={(e) => setLines(lines.map((x, i) => i === k ? { ...x, qty: e.target.value.replace(r.dir === 0 ? /[^\d.-]/g : /[^\d.]/g, "") } : x))} className="h-8 w-24 text-center tnum" /></Td>
                            <Td align="right" className={`text-xs tnum font-medium ${on + d < 0 ? "text-danger" : ""}`}>{on + d}</Td>
                            <Td align="right" className="text-xs tnum">{formatTHB(d * Number(l.product.cost ?? 0))}</Td>
                            <Td><button onClick={() => setLines(lines.filter((_, i) => i !== k))} className="text-muted hover:text-danger"><Trash2 size={14} /></button></Td>
                          </tr>
                        );
                      })}</tbody>
                    </Table>
                  ) : <EmptyState icon={<FileText size={24} />} title="ยังไม่มีรายการ" body="ค้นหาสินค้าด้านบนเพื่อเพิ่มรายการที่จะขอปรับ" />}
                </TablePanel>
              </div>
            </div>
          )
        ) : (
          <>
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "pending", label: "รออนุมัติ" }, { value: "all", label: "ทั้งหมด" }]} />
            <TablePanel>
              {list === null ? null : list.length ? (
                <Table>
                  <thead><tr><Th>เลขที่</Th><Th>เหตุผล</Th><Th>รายการ</Th><Th align="right">มูลค่า</Th><Th>ผู้ขอ</Th><Th align="center">สถานะ</Th><Th /></tr></thead>
                  <tbody>{list.map((a) => (
                    <tr key={a.id}>
                      <Td className="font-mono text-xs">{a.adj_no}<span className="block text-[10px] text-muted font-sans">{when(a.requested_at)}</span></Td>
                      <Td className="text-xs">{reasonLabel(a.reason_code)}{a.note ? <span className="block text-[10px] text-muted">{a.note}</span> : null}</Td>
                      <Td className="text-xs">{a.lines.map((l) => `${l.sku} ${l.delta > 0 ? "+" : ""}${l.delta}${l.serials?.length ? ` (${l.serials.join(", ")})` : ""}`).join(" · ")}</Td>
                      <Td align="right" className={`text-xs tnum ${Number(a.total_value) < 0 ? "text-danger" : "text-ok"}`}>{formatTHB(Number(a.total_value))}</Td>
                      <Td className="text-xs">{names[a.requested_by] ?? "—"}{a.decided_by && a.status !== "cancelled" ? <span className="block text-[10px] text-muted">{a.status === "approved" ? "อนุมัติ" : "ตัดสิน"}: {names[a.decided_by] ?? "—"} · {when(a.decided_at)}</span> : null}{a.decision_note ? <span className="block text-[10px] text-muted">“{a.decision_note}”</span> : null}</Td>
                      <Td align="center"><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></Td>
                      <Td className="whitespace-nowrap">
                        {a.status === "pending" && canApprove && a.requested_by !== me ? <span className="inline-flex gap-1">
                          <Button size="sm" variant="ok" onClick={() => { setDecide({ a, approve: true }); setDecideNote(""); }}><CheckCircle2 size={14} /> อนุมัติ</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setDecide({ a, approve: false }); setDecideNote(""); }}><XCircle size={14} /></Button></span> : null}
                        {a.status === "pending" && a.requested_by === me ? <Button size="sm" variant="ghost" loading={busy} onClick={() => void act("cancel", a)}>ยกเลิก</Button> : null}
                        {a.status === "pending" && a.requested_by === me && canApprove ? <span className="block text-[10px] text-muted">ให้คนอื่นอนุมัติ</span> : null}
                      </Td>
                    </tr>
                  ))}</tbody>
                </Table>
              ) : <EmptyState icon={<FileText size={24} />} title={filter === "pending" ? "ไม่มีใบรออนุมัติ" : "ยังไม่มีใบขอปรับ"} body="" />}
            </TablePanel>
          </>
        )}
      </div>
      <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.approve ? `อนุมัติ ${decide.a.adj_no}` : `ไม่อนุมัติ ${decide?.a.adj_no ?? ""}`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setDecide(null)}>ปิด</Button>
          <Button variant={decide?.approve ? "ok" : "danger"} loading={busy} disabled={!decide?.approve && decideNote.trim().length < 3} onClick={() => decide && void act(decide.approve ? "approve" : "reject", decide.a, decideNote)}>{decide?.approve ? "ยืนยันอนุมัติ + ปรับสต๊อก" : "ยืนยันไม่อนุมัติ"}</Button></>}>
        {decide ? <div className="space-y-3 text-sm">
          <p>{reasonLabel(decide.a.reason_code)} · {decide.a.lines.map((l) => `${l.sku} ${l.delta > 0 ? "+" : ""}${l.delta}`).join(", ")}</p>
          <p className="rounded-xl bg-surface2 px-3 py-2">มูลค่า <b className="tnum">{formatTHB(Number(decide.a.total_value))}</b> · ขอโดย {names[decide.a.requested_by] ?? "—"}</p>
          <Field label={decide.approve ? "หมายเหตุ (ไม่บังคับ)" : "เหตุผลที่ไม่อนุมัติ *"}><Input autoFocus value={decideNote} onChange={(e) => setDecideNote(e.target.value)} /></Field>
        </div> : null}
      </Modal>
    </PosPage>
  );
}
