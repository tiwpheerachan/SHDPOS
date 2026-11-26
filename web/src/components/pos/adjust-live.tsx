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
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

type Reason = "damage" | "lost" | "expired" | "internal_use" | "found" | "correction";
const REASONS = (): { code: Reason; label: string; dir: -1 | 1 | 0; hint: string }[] => [
  { code: "damage", label: tr("ของเสีย / ชำรุด", "Damaged / defective", "损坏 / 故障"), dir: -1, hint: tr("ตัดออก · SN เป็นสถานะชำรุด", "Deduct · SN marked damaged", "扣减 · SN 标记为损坏") },
  { code: "lost", label: tr("สูญหาย", "Lost", "丢失"), dir: -1, hint: tr("ตัดออก · SN เป็นสถานะหาย", "Deduct · SN marked lost", "扣减 · SN 标记为丢失") },
  { code: "expired", label: tr("หมดอายุ / เสื่อมสภาพ", "Expired / deteriorated", "过期 / 变质"), dir: -1, hint: tr("ตัดออก", "Deduct", "扣减") },
  { code: "internal_use", label: tr("ใช้ภายใน / ตัวโชว์", "Internal use / display unit", "内部使用 / 展示机"), dir: -1, hint: tr("ตัดออก · ต้องอธิบาย", "Deduct · note required", "扣减 · 需说明") },
  { code: "found", label: tr("พบสินค้าเพิ่ม", "Found extra stock", "发现多余库存"), dir: 1, hint: tr("เพิ่มเข้า (สินค้า SN ใช้การรับเข้า)", "Add (SN products use goods receipt)", "增加（SN 商品请使用入库）") },
  { code: "correction", label: tr("แก้ยอดผิด", "Correct wrong count", "更正错误数量"), dir: 0, hint: tr("เพิ่ม/ลด · ต้องอธิบาย", "Add/deduct · note required", "增加/扣减 · 需说明") },
];
const reasonLabel = (c: string) => REASONS().find((r) => r.code === c)?.label ?? c;
type Line = { product: Product; qty: string; serials: string };
type Adj = { id: string; adj_no: string; reason_code: string; note: string | null; status: "pending" | "approved" | "rejected" | "cancelled"; lines: { sku: string; name: string; delta: number; value: number; serials: string[] }[];
  total_value: number; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null };
const STATUS = (): Record<Adj["status"], { label: string; tone: "warn" | "ok" | "danger" | "neutral" }> => ({ pending: { label: tr("รออนุมัติ", "Pending approval", "待审批"), tone: "warn" }, approved: { label: tr("อนุมัติแล้ว", "Approved", "已批准"), tone: "ok" }, rejected: { label: tr("ไม่อนุมัติ", "Rejected", "未批准"), tone: "danger" }, cancelled: { label: tr("ยกเลิก", "Cancelled", "已取消"), tone: "neutral" } });
const when = (s: string | null) => (s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function AdjustLive() {
  const L = useL();
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
    if (!r.ok) { toast.push({ tone: "danger", title: L("โหลดใบขอปรับไม่สำเร็จ", "Failed to load adjustment requests", "加载调整申请失败"), body: j.error }); setList([]); return; }
    setList(j.adjustments); setNames(j.names); setMe(j.me); setOwLinked(j.ow_linked);
  }, [branchId, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (branchId) void Promise.all([listProducts(), stockForBranch(branchId)]).then(([p, s]) => { setProducts(p.filter((x) => x.is_stocked && /^[0-9a-f-]{36}$/i.test(x.id))); setStock(s); }); }, [branchId]);

  const r = REASONS().find((x) => x.code === reason)!;
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
      toast.push({ tone: "ok", title: L(`ส่งขอปรับ ${j.adj_no} แล้ว — รอผู้มีสิทธิ์อนุมัติ`, `Request ${j.adj_no} sent — awaiting approval`, `已提交调整申请 ${j.adj_no} — 等待审批`), body: L("สต๊อกจะเปลี่ยนหลังอนุมัติเท่านั้น", "Stock changes only after approval", "审批后才会变更库存") });
      setLines([]); setNote(""); setTab("list"); setFilter("pending"); await loadList();
    } catch (e) { toast.push({ tone: "danger", title: L("ส่งขอปรับไม่สำเร็จ", "Failed to send request", "提交调整申请失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }
  async function act(action: "approve" | "reject" | "cancel", a: Adj, n?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/pos/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: a.id, note: n }) });
      const j = await res.json(); if (!res.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: action === "approve" ? L(`อนุมัติ ${a.adj_no} — ปรับสต๊อกแล้ว`, `Approved ${a.adj_no} — stock adjusted`, `已批准 ${a.adj_no} — 库存已调整`) : action === "reject" ? L(`ไม่อนุมัติ ${a.adj_no}`, `Rejected ${a.adj_no}`, `未批准 ${a.adj_no}`) : L(`ยกเลิก ${a.adj_no}`, `Cancelled ${a.adj_no}`, `已取消 ${a.adj_no}`) });
      setDecide(null); setDecideNote(""); await loadList();
      if (action === "approve") { try { await (await import("@/lib/offline/refresh")).refreshBranchSnapshot(); } catch { /* */ } }
    } catch (e) { toast.push({ tone: "danger", title: L("ทำรายการไม่สำเร็จ", "Action failed", "操作失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  if (!employee || !branchId) return null;
  const canReq = can(employee, "inventory.adjust"), canApprove = can(employee, "inventory.adjust_approve");

  return (
    <PosPage title={L("ปรับสต๊อก", "Stock adjustment", "库存调整")} icon={<SlidersHorizontal size={18} />}
      actions={<Segmented value={tab} onChange={setTab} options={[{ value: "new", label: L("ขอปรับ", "Request", "申请调整") }, { value: "list", label: <span>{L("ใบขอปรับ", "Requests", "调整申请单")}{pendingCount ? <span className="ml-1 text-[10px] px-1.5 rounded-full bg-warn/20 text-warn">{pendingCount}</span> : null}</span> }]} />}>
      <div className="p-4 sm:p-6 space-y-4">
        {owLinked ? <p className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-[12.5px]">{L("สาขานี้ใช้สต๊อกจากคลังกลาง OneWarehouse — ปรับยอดที่ OneWarehouse (POS ไม่แก้ยอดเอง)", "This branch uses OneWarehouse central stock — adjust in OneWarehouse (POS does not change it)", "本门店使用 OneWarehouse 中央仓库存 — 请在 OneWarehouse 调整（POS 不自行修改）")}</p> : null}
        {tab === "new" ? (
          !canReq ? <p className="text-sm text-muted">{L("ไม่มีสิทธิ์ขอปรับสต๊อก", "No permission to request stock adjustment", "无权申请库存调整")}</p> : (
            <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
              <div className="card p-4 space-y-3">
                <Field label={L("เหตุผล *", "Reason *", "原因 *")}><Select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>{REASONS().map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>
                <p className="text-[11px] text-muted">{r.hint}</p>
                <Field label={reason === "correction" || reason === "internal_use" ? L("หมายเหตุ *", "Note *", "备注 *") : L("หมายเหตุ", "Note", "备注")}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("เช่น ตกแตกระหว่างจัดเรียง", "e.g. dropped while shelving", "例如：上架时摔坏")} /></Field>
                <div className="rounded-xl bg-surface2 px-3 py-2 text-sm flex justify-between"><span className="text-muted">{L("มูลค่าที่ปรับ (ต้นทุน)", "Adjusted value (cost)", "调整金额（成本）")}</span><b className={`tnum ${total < 0 ? "text-danger" : total > 0 ? "text-ok" : ""}`}>{total > 0 ? "+" : ""}{formatTHB(total)}</b></div>
                <Button variant="primary" className="w-full" loading={busy} disabled={!lines.length || lines.some((l) => !delta(l))} onClick={() => void submit()}><Send size={15} /> {L("ส่งขออนุมัติ", "Submit for approval", "提交审批")}</Button>
                <p className="text-[11px] text-muted">{L("สต๊อกยังไม่เปลี่ยนจนกว่าหัวหน้า/ผู้มีสิทธิ์ (ไม่ใช่ผู้ขอ) จะอนุมัติ · ระบบกันสต๊อกติดลบทั้งตอนขอและตอนอนุมัติ", "Stock does not change until a supervisor/approver (not the requester) approves · Negative stock is blocked at request and approval", "在主管/有权限者（非申请人）批准前库存不变 · 申请和审批时均防止负库存")}</p>
              </div>
              <div className="space-y-3 min-w-0">
                <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อสินค้า เพื่อเพิ่มรายการ", "Search SKU / product name to add", "搜索 SKU / 商品名称以添加")} className="pl-9" /></div>
                {picks.length ? <div className="card divide-y divide-line">{picks.map((p) => (
                  <button key={p.id} disabled={lines.some((l) => l.product.id === p.id)} onClick={() => { setLines([...lines, { product: p, qty: "", serials: "" }]); setQ(""); }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface2 disabled:opacity-40">
                    <Plus size={14} /><span className="font-mono text-xs text-muted" translate="no">{p.sku}</span><span className="truncate" translate="no">{p.name_th}</span>{p.track_serial ? <Badge tone="neutral">SN</Badge> : null}<span className="ml-auto text-xs text-muted">{L("คงเหลือ", "On hand", "库存")} {stock.get(p.id)?.qty_on_hand ?? 0}</span>
                  </button>))}</div> : null}
                <TablePanel>
                  {lines.length ? (
                    <Table>
                      <thead><tr><Th>{L("สินค้า", "Product", "商品")}</Th><Th align="right">{L("คงเหลือ", "On hand", "库存")}</Th><Th align="center">{r.dir === -1 ? L("จำนวนที่ลด", "Qty to deduct", "扣减数量") : r.dir === 1 ? L("จำนวนที่เพิ่ม", "Qty to add", "增加数量") : L("+เพิ่ม / −ลด", "+add / −deduct", "+增加 / −扣减")}</Th><Th align="right">{L("หลังปรับ", "After", "调整后")}</Th><Th align="right">{L("มูลค่า", "Value", "金额")}</Th><Th /></tr></thead>
                      <tbody>{lines.map((l, k) => {
                        const on = Number(stock.get(l.product.id)?.qty_on_hand ?? 0), d = delta(l);
                        return (
                          <tr key={l.product.id}>
                            <Td className="text-xs"><span className="font-mono text-muted" translate="no">{l.product.sku}</span><span className="block" translate="no">{l.product.name_th}</span>
                              {l.product.track_serial && d < 0 ? <span className="flex items-center gap-1 mt-1"><ScanLine size={12} className="text-muted" /><input value={l.serials} onChange={(e) => setLines(lines.map((x, i) => i === k ? { ...x, serials: e.target.value } : x))} placeholder={L(`สแกน SN ${Math.abs(d)} ตัว (คั่นด้วยเว้นวรรค)`, `Scan ${Math.abs(d)} SN (space-separated)`, `扫描 ${Math.abs(d)} 个 SN（以空格分隔）`)} className="h-7 flex-1 px-2 rounded-md border border-line bg-surface text-[11px] font-mono" /></span> : null}</Td>
                            <Td align="right" className="text-xs tnum">{on}</Td>
                            <Td align="center"><Input value={l.qty} inputMode="decimal" onChange={(e) => setLines(lines.map((x, i) => i === k ? { ...x, qty: e.target.value.replace(r.dir === 0 ? /[^\d.-]/g : /[^\d.]/g, "") } : x))} className="h-8 w-24 text-center tnum" /></Td>
                            <Td align="right" className={`text-xs tnum font-medium ${on + d < 0 ? "text-danger" : ""}`}>{on + d}</Td>
                            <Td align="right" className="text-xs tnum">{formatTHB(d * Number(l.product.cost ?? 0))}</Td>
                            <Td><button onClick={() => setLines(lines.filter((_, i) => i !== k))} className="text-muted hover:text-danger"><Trash2 size={14} /></button></Td>
                          </tr>
                        );
                      })}</tbody>
                    </Table>
                  ) : <EmptyState icon={<FileText size={24} />} title={L("ยังไม่มีรายการ", "No items yet", "暂无项目")} body={L("ค้นหาสินค้าด้านบนเพื่อเพิ่มรายการที่จะขอปรับ", "Search products above to add items to adjust", "在上方搜索商品以添加调整项目")} />}
                </TablePanel>
              </div>
            </div>
          )
        ) : (
          <>
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "pending", label: L("รออนุมัติ", "Pending", "待审批") }, { value: "all", label: L("ทั้งหมด", "All", "全部") }]} />
            <TablePanel>
              {list === null ? null : list.length ? (
                <Table>
                  <thead><tr><Th>{L("เลขที่", "No.", "编号")}</Th><Th>{L("เหตุผล", "Reason", "原因")}</Th><Th>{L("รายการ", "Items", "项目")}</Th><Th align="right">{L("มูลค่า", "Value", "金额")}</Th><Th>{L("ผู้ขอ", "Requester", "申请人")}</Th><Th align="center">{L("สถานะ", "Status", "状态")}</Th><Th /></tr></thead>
                  <tbody>{list.map((a) => (
                    <tr key={a.id}>
                      <Td className="font-mono text-xs"><span translate="no">{a.adj_no}</span><span className="block text-[10px] text-muted font-sans">{when(a.requested_at)}</span></Td>
                      <Td className="text-xs">{reasonLabel(a.reason_code)}{a.note ? <span className="block text-[10px] text-muted">{a.note}</span> : null}</Td>
                      <Td className="text-xs" translate="no">{a.lines.map((l) => `${l.sku} ${l.delta > 0 ? "+" : ""}${l.delta}${l.serials?.length ? ` (${l.serials.join(", ")})` : ""}`).join(" · ")}</Td>
                      <Td align="right" className={`text-xs tnum ${Number(a.total_value) < 0 ? "text-danger" : "text-ok"}`}>{formatTHB(Number(a.total_value))}</Td>
                      <Td className="text-xs">{names[a.requested_by] ?? "—"}{a.decided_by && a.status !== "cancelled" ? <span className="block text-[10px] text-muted">{a.status === "approved" ? L("อนุมัติ", "Approved", "批准") : L("ตัดสิน", "Decided", "决定")}: {names[a.decided_by] ?? "—"} · {when(a.decided_at)}</span> : null}{a.decision_note ? <span className="block text-[10px] text-muted">“{a.decision_note}”</span> : null}</Td>
                      <Td align="center"><Badge tone={STATUS()[a.status].tone}>{STATUS()[a.status].label}</Badge></Td>
                      <Td className="whitespace-nowrap">
                        {a.status === "pending" && canApprove && a.requested_by !== me ? <span className="inline-flex gap-1">
                          <Button size="sm" variant="ok" onClick={() => { setDecide({ a, approve: true }); setDecideNote(""); }}><CheckCircle2 size={14} /> {L("อนุมัติ", "Approve", "批准")}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setDecide({ a, approve: false }); setDecideNote(""); }}><XCircle size={14} /></Button></span> : null}
                        {a.status === "pending" && a.requested_by === me ? <Button size="sm" variant="ghost" loading={busy} onClick={() => void act("cancel", a)}>{L("ยกเลิก", "Cancel", "取消")}</Button> : null}
                        {a.status === "pending" && a.requested_by === me && canApprove ? <span className="block text-[10px] text-muted">{L("ให้คนอื่นอนุมัติ", "Needs another approver", "需由他人审批")}</span> : null}
                      </Td>
                    </tr>
                  ))}</tbody>
                </Table>
              ) : <EmptyState icon={<FileText size={24} />} title={filter === "pending" ? L("ไม่มีใบรออนุมัติ", "No pending requests", "没有待审批申请") : L("ยังไม่มีใบขอปรับ", "No adjustment requests yet", "暂无调整申请")} body="" />}
            </TablePanel>
          </>
        )}
      </div>
      <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.approve ? L(`อนุมัติ ${decide.a.adj_no}`, `Approve ${decide.a.adj_no}`, `批准 ${decide.a.adj_no}`) : L(`ไม่อนุมัติ ${decide?.a.adj_no ?? ""}`, `Reject ${decide?.a.adj_no ?? ""}`, `不批准 ${decide?.a.adj_no ?? ""}`)} size="sm"
        footer={<><Button variant="ghost" onClick={() => setDecide(null)}>{L("ปิด", "Close", "关闭")}</Button>
          <Button variant={decide?.approve ? "ok" : "danger"} loading={busy} disabled={!decide?.approve && decideNote.trim().length < 3} onClick={() => decide && void act(decide.approve ? "approve" : "reject", decide.a, decideNote)}>{decide?.approve ? L("ยืนยันอนุมัติ + ปรับสต๊อก", "Confirm approve + adjust stock", "确认批准并调整库存") : L("ยืนยันไม่อนุมัติ", "Confirm reject", "确认不批准")}</Button></>}>
        {decide ? <div className="space-y-3 text-sm">
          <p>{reasonLabel(decide.a.reason_code)} · {decide.a.lines.map((l) => `${l.sku} ${l.delta > 0 ? "+" : ""}${l.delta}`).join(", ")}</p>
          <p className="rounded-xl bg-surface2 px-3 py-2">{L("มูลค่า", "Value", "金额")} <b className="tnum">{formatTHB(Number(decide.a.total_value))}</b> · {L("ขอโดย", "Requested by", "申请人")} {names[decide.a.requested_by] ?? "—"}</p>
          <Field label={decide.approve ? L("หมายเหตุ (ไม่บังคับ)", "Note (optional)", "备注（可选）") : L("เหตุผลที่ไม่อนุมัติ *", "Rejection reason *", "不批准原因 *")}><Input autoFocus value={decideNote} onChange={(e) => setDecideNote(e.target.value)} /></Field>
        </div> : null}
      </Modal>
    </PosPage>
  );
}
