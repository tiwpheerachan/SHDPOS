"use client";
// รอลูกค้ารับของ — ลูกค้าจ่ายเต็มแล้ว มารับของทีหลัง (ไม่รับมัดจำ) · 0077
//   ส่งมอบได้หลายครั้ง · สินค้า SN ต้องสแกนให้ตรงกับเครื่องในบิล · บันทึกชื่อผู้รับ · คืนเงินก่อนมารับ = ยอดรอรับลดเอง
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PackageCheck, Search, Plus, AlertTriangle, CheckCircle2, ScanLine, Clock, Phone, History, X } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { Button, Input, Table, Th, Td, EmptyState, Badge, Modal, Field, Skeleton, Segmented, Drawer } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { can } from "@/lib/permissions";
import { isLiveMode } from "@/lib/supabase/client";
import { formatTHB } from "@/lib/money";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

type Item = { order_item_id: string; sku: string; name: string; qty: number; picked_qty: number; returned_qty: number; serials: string[]; picked_serials: string[] };
type Row = { order_id: string; status: "pending" | "partial" | "completed" | "cancelled"; due_date: string | null; contact_name: string | null; contact_phone: string | null; note: string | null;
  items: Item[]; created_at: string; completed_at: string | null; version: number; remaining: number; orders: { order_no: string; client_uuid: string; grand_total: number; created_at: string } };
type Detail = { pickup: Row; order: { order_no: string; grand_total: number; created_at: string; status: string }; events: { kind: string; items: { sku: string; qty: number; serials?: string[] }[]; receiver_name: string | null; note: string | null; actor_id: string | null; created_at: string }[]; names: Record<string, string> };

const STATUS = (): Record<Row["status"], { label: string; tone: "warn" | "info" | "ok" | "neutral" }> => ({
  pending: { label: tr("รอรับ", "Awaiting pickup", "待取货"), tone: "warn" }, partial: { label: tr("รับบางส่วน", "Partly picked up", "部分取货"), tone: "info" }, completed: { label: tr("รับครบแล้ว", "Picked up", "已全部取货"), tone: "ok" }, cancelled: { label: tr("ยกเลิก (คืนเงินแล้ว)", "Cancelled (refunded)", "已取消（已退款）"), tone: "neutral" },
});
const todayStr = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" })).toISOString().slice(0, 10);
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "—");
const left = (i: Item) => Number(i.qty) - Number(i.picked_qty) - Number(i.returned_qty);

export default function PickupsPage() {
  const L = useL();
  const { employee, branchId } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null), [status, setStatus] = useState<"open" | "done" | "all">("open"), [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const [createOpen, setCreateOpen] = useState(false), [form, setForm] = useState({ order_no: "", due: "", note: "" }), [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const r = await fetch(`/api/pos/pickups?branch_id=${branchId}&status=${status}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      setRows(j.pickups);
    } catch (e) { setRows([]); toast.push({ tone: "danger", title: L("โหลดรายการรอรับไม่สำเร็จ", "Failed to load pickups", "加载待取货列表失败"), body: e instanceof Error ? e.message : String(e) }); }
  }, [branchId, status, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/pos/pickups?order_id=${id}`, { cache: "no-store" }); const j = await r.json();
    if (!r.ok) { toast.push({ tone: "danger", title: L("เปิดรายการไม่สำเร็จ", "Failed to open item", "打开项目失败"), body: j.error }); return; }
    setDetail(j);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDetail(null); if (openId) void loadDetail(openId); }, [openId, loadDetail]);

  async function create() {
    setBusy(true);
    try {
      const r = await fetch("/api/pos/pickups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", branch_id: branchId, order_no: form.order_no.trim(), due: form.due || null, note: form.note }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: j.replay ? L("บิลนี้ตั้งรอรับไว้แล้ว", "This bill is already set for pickup", "此单据已设为待取货") : L("ตั้งเป็นรอลูกค้ามารับแล้ว", "Set for customer pickup", "已设为待客户取货") });
      setCreateOpen(false); setForm({ order_no: "", due: "", note: "" }); await load(); setOpenId(j.order_id);
    } catch (e) { toast.push({ tone: "danger", title: L("ตั้งรอรับไม่สำเร็จ", "Failed to set pickup", "设置待取货失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  const today = todayStr();
  const stats = useMemo(() => {
    const open = (rows ?? []).filter((r) => r.status === "pending" || r.status === "partial");
    return { open: open.length, overdue: open.filter((r) => r.due_date && r.due_date < today).length, dueToday: open.filter((r) => r.due_date === today).length, units: open.reduce((s, r) => s + r.remaining, 0) };
  }, [rows, today]);

  if (!employee || !branchId) return null;
  if (!isLiveMode()) return <div className="p-8 text-center text-sm text-muted">{L("เมนูนี้ใช้กับระบบจริง (ข้อมูลอยู่ที่เซิร์ฟเวอร์กลาง)", "This menu works in live mode only (data on central server)", "此菜单仅用于正式系统（数据在中央服务器）")}</div>;
  if (!can(employee, "pos.sell")) return <div className="p-8 text-center text-sm text-muted">{L("ไม่มีสิทธิ์", "No permission", "无权限")}</div>;

  return (
    <PosPage title={L("รอลูกค้ารับของ", "Customer pickups", "待客户取货")} icon={<PackageCheck size={18} />}
      actions={<>
        <div className="relative w-full sm:w-60"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("เลขบิล / ชื่อ / เบอร์", "Bill no. / name / phone", "单号 / 姓名 / 电话")} className="pl-9 h-9" /></div>
        <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: "open", label: L("ค้างรับ", "Open", "待取") }, { value: "done", label: L("ปิดแล้ว", "Closed", "已关闭") }, { value: "all", label: L("ทั้งหมด", "All", "全部") }]} />
        <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> {L("ตั้งจากเลขบิล", "From bill no.", "按单号设置")}</Button>
      </>}>
      <div className="p-4 sm:p-6 space-y-4">
        <p className="text-[12.5px] text-muted">{L("นโยบายร้าน: ไม่รับมัดจำ — ลูกค้าจ่ายเต็มจำนวน ออกบิล แล้วค่อยมารับของ · ของที่รอรับเป็นของลูกค้าแล้ว (ตัดสต๊อกตอนขาย) ให้แยกเก็บ ไม่ขายซ้ำ และไม่ต้องนับในรอบตรวจนับ", "Store policy: no deposits — customer pays in full, bill is issued, goods picked up later · Goods awaiting pickup belong to the customer (stock deducted at sale): keep separate, do not resell, exclude from stock counts", "门店政策：不收定金 — 客户全额付款并出单后再来取货 · 待取商品已属于客户（销售时已扣库存），请单独存放，不得再售，盘点时不计入")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatChip label={L("บิลค้างรับ", "Open bills", "待取单据")} value={stats.open} accent="lavender" icon={<PackageCheck size={16} />} />
          <StatChip label={L("ชิ้นที่ยังอยู่ในร้าน", "Units still in store", "店内待取件数")} value={stats.units} accent="mint" icon={<Clock size={16} />} />
          <StatChip label={L("นัดรับวันนี้", "Due today", "今日取货")} value={stats.dueToday} accent="peach" icon={<CheckCircle2 size={16} />} />
          <StatChip label={L("เกินวันนัด", "Overdue", "已逾期")} value={stats.overdue} accent="coral" icon={<AlertTriangle size={16} />} />
        </div>
        <TablePanel>
          {rows === null ? <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : rows.length ? (
            <Table>
              <thead><tr><Th>{L("บิล", "Bill", "单据")}</Th><Th>{L("ลูกค้า", "Customer", "客户")}</Th><Th>{L("รายการค้างรับ", "Items pending", "待取项目")}</Th><Th>{L("วันนัด", "Due", "约定日期")}</Th><Th align="center">{L("สถานะ", "Status", "状态")}</Th><Th align="right">{L("ยอดบิล", "Bill total", "单据金额")}</Th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = (r.status === "pending" || r.status === "partial") && r.due_date && r.due_date < today;
                  return (
                    <tr key={r.order_id} className={`hover:bg-surface2/60 cursor-pointer ${overdue ? "bg-danger/4" : ""}`} onClick={() => setOpenId(r.order_id)}>
                      <Td className="font-mono text-xs"><span translate="no">{r.orders.order_no}</span><span className="block text-[10px] text-muted font-sans">{L("ขาย", "Sold", "销售")} {day(r.orders.created_at)}</span></Td>
                      <Td className="text-xs">{r.contact_name ?? "—"}{r.contact_phone ? <span className="block text-[10px] text-muted">{r.contact_phone}</span> : null}</Td>
                      <Td className="text-xs" translate="no">{r.items.filter((i) => left(i) > 0).map((i) => `${i.sku} ×${left(i)}`).join(", ") || "—"}</Td>
                      <Td className={`text-xs ${overdue ? "text-danger font-medium" : r.due_date === today ? "text-warn font-medium" : ""}`}>{day(r.due_date)}{overdue ? ` · ${L("เกินนัด", "overdue", "逾期")}` : r.due_date === today ? ` · ${L("วันนี้", "today", "今天")}` : ""}</Td>
                      <Td align="center"><Badge tone={STATUS()[r.status].tone}>{STATUS()[r.status].label}</Badge></Td>
                      <Td align="right" className="text-xs tnum">{formatTHB(Number(r.orders.grand_total))}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={<PackageCheck size={26} />} title={status === "open" ? L("ไม่มีของรอลูกค้ามารับ", "No goods awaiting pickup", "没有待客户取货的商品") : L("ไม่มีรายการ", "No items", "没有项目")} body={L("ตอนขาย ติ๊ก “ลูกค้ามารับของภายหลัง” ก่อนรับเงิน — หรือกด “ตั้งจากเลขบิล” สำหรับบิลที่ขายไปแล้ว", "When selling, tick “Customer picks up later” before payment — or use “From bill no.” for bills already sold", "销售时在收款前勾选“客户稍后取货” — 或对已售单据点击“按单号设置”")} />}
        </TablePanel>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={L("ตั้งรอลูกค้ามารับ จากบิลที่ขายแล้ว", "Set pickup from a sold bill", "从已售单据设置待取货")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!form.order_no.trim()} onClick={() => void create()}>{L("บันทึก", "Save", "保存")}</Button></>}>
        <div className="space-y-3">
          <Field label={L("เลขบิล *", "Bill no. *", "单号 *")}><Input autoFocus value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} placeholder={L("เช่น UAT-33856-261125-0011", "e.g. UAT-33856-261125-0011", "例如 UAT-33856-261125-0011")} className="font-mono" /></Field>
          <Field label={L("วันนัดรับ (ไม่บังคับ)", "Pickup date (optional)", "取货日期（可选）")}><Input type="date" min={today} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
          <Field label={L("หมายเหตุ", "Note", "备注")}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={L("เช่น ลูกค้าโอนแล้ว มารับวันเสาร์", "e.g. paid by transfer, picking up Saturday", "例如：客户已转账，周六取货")} /></Field>
        </div>
      </Modal>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} width="lg" title={detail ? <span className="font-mono" translate="no">{detail.order.order_no}</span> : L("กำลังโหลด…", "Loading…", "加载中…")}
        subtitle={detail ? `${detail.pickup.contact_name ?? L("ไม่ระบุชื่อ", "No name", "未填姓名")}${detail.pickup.contact_phone ? ` · ${detail.pickup.contact_phone}` : ""} · ${L("ยอด", "Total", "金额")} ${formatTHB(Number(detail.order.grand_total))}` : undefined}
        badge={detail ? <Badge tone={STATUS()[detail.pickup.status].tone}>{STATUS()[detail.pickup.status].label}</Badge> : undefined}>
        {detail ? <Handover key={`${detail.pickup.order_id}:${detail.pickup.version}`} detail={detail} canHand={can(employee, "pickup.handover")} onDone={async () => { await load(); if (openId) await loadDetail(openId); }} /> : <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      </Drawer>
    </PosPage>
  );
}

function Handover({ detail, canHand, onDone }: { detail: Detail; canHand: boolean; onDone: () => Promise<void> }) {
  const toast = useToast();
  const L = useL();
  const p = detail.pickup;
  const open = p.status === "pending" || p.status === "partial";
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(p.items.map((i) => [i.order_item_id, i.serials.length ? 0 : left(i)])));
  const [sns, setSns] = useState<Record<string, string[]>>({});
  const [scan, setScan] = useState(""), [scanErr, setScanErr] = useState(""), [receiver, setReceiver] = useState(p.contact_name ?? ""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 80); return () => clearTimeout(t); }, []);

  function addScan() {
    const sn = scan.trim().toUpperCase(); setScan("");
    if (!sn) return;
    const line = p.items.find((i) => i.serials.map((x) => x.toUpperCase()).includes(sn));
    if (!line) { setScanErr(L(`${sn} ไม่ใช่เครื่องในบิลนี้ — ห้ามส่งมอบ`, `${sn} is not a unit on this bill — do not hand over`, `${sn} 不是此单据中的机器 — 禁止交付`)); return; }
    if (line.picked_serials.map((x) => x.toUpperCase()).includes(sn)) { setScanErr(L(`${sn} ส่งมอบไปแล้ว`, `${sn} already handed over`, `${sn} 已交付`)); return; }
    if ((sns[line.order_item_id] ?? []).includes(sn)) { setScanErr(L(`${sn} สแกนแล้ว`, `${sn} already scanned`, `${sn} 已扫描`)); return; }
    setScanErr("");
    const next = [...(sns[line.order_item_id] ?? []), sn];
    setSns({ ...sns, [line.order_item_id]: next }); setQty({ ...qty, [line.order_item_id]: next.length });
  }
  const selected = p.items.filter((i) => (qty[i.order_item_id] ?? 0) > 0);
  async function submit() {
    setBusy(true);
    try {
      const r = await fetch("/api/pos/pickups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "handover", order_id: p.order_id, version: p.version, receiver, note,
        lines: selected.map((i) => ({ order_item_id: i.order_item_id, qty: qty[i.order_item_id], serials: sns[i.order_item_id] ?? [] })) }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: j.status === "completed" ? L("ส่งมอบครบแล้ว", "Fully handed over", "已全部交付") : L("บันทึกการส่งมอบบางส่วนแล้ว", "Partial handover saved", "已记录部分交付") });
      setSns({}); await onDone();
    } catch (e) { toast.push({ tone: "danger", title: L("ส่งมอบไม่สำเร็จ", "Handover failed", "交付失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-5 space-y-5">
      {p.due_date ? <p className="text-xs text-muted flex items-center gap-1.5"><Clock size={13} /> {L("นัดรับ", "Pickup", "约定取货")} {day(p.due_date)}{p.note ? ` · ${p.note}` : ""}</p> : p.note ? <p className="text-xs text-muted">{p.note}</p> : null}
      {open && canHand && p.items.some((i) => i.serials.length && left(i) > 0) ? (
        <div>
          <form onSubmit={(e) => { e.preventDefault(); addScan(); }} className="flex gap-2">
            <div className="relative flex-1"><ScanLine size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input ref={ref} value={scan} onChange={(e) => setScan(e.target.value)} placeholder={L("สแกน SN ของเครื่องที่ส่งมอบ", "Scan SN of unit being handed over", "扫描交付机器的 SN")} className="pl-9 font-mono" /></div>
            <Button type="submit" variant="soft">{L("เพิ่ม", "Add", "添加")}</Button>
          </form>
          {scanErr ? <p role="alert" className="text-xs text-danger mt-1.5 flex items-center gap-1"><AlertTriangle size={12} />{scanErr}</p> : null}
        </div>
      ) : null}
      <div className="space-y-2">
        {p.items.map((i) => {
          const rem = left(i), mine = sns[i.order_item_id] ?? [];
          return (
            <div key={i.order_item_id} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" translate="no">{i.name}</p>
                  <p className="text-[11px] text-muted font-mono" translate="no">{i.sku}</p>
                  <p className="text-[11px] text-muted mt-0.5">{L("ซื้อ", "Bought", "购买")} {i.qty} · {L("รับแล้ว", "Picked up", "已取")} {i.picked_qty}{i.returned_qty ? ` · ${L("คืนเงิน", "Refunded", "已退款")} ${i.returned_qty}` : ""} · <b className={rem ? "text-ink" : "text-ok"}>{L("ค้าง", "Remaining", "待取")} {rem}</b></p>
                </div>
                {open && canHand && rem > 0 && !i.serials.length ? (
                  <div className="flex items-center gap-1.5"><span className="text-[11px] text-muted">{L("ส่งมอบ", "Hand over", "交付")}</span>
                    <Input value={String(qty[i.order_item_id] ?? 0)} inputMode="numeric" onChange={(e) => setQty({ ...qty, [i.order_item_id]: Math.min(rem, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)) })} className="h-8 w-16 text-center tnum" /></div>
                ) : null}
              </div>
              {i.serials.length ? (
                <div className="flex flex-wrap gap-1 mt-2">
                  {i.serials.map((sn) => {
                    const done = i.picked_serials.includes(sn), now = mine.includes(sn.toUpperCase());
                    return <span key={sn} translate="no" className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded-md ${done ? "bg-surface2 text-muted line-through" : now ? "bg-ok/15 text-ok" : "bg-warn/12 text-warn"}`}>{sn}{now ? <button className="ml-1" onClick={() => { const n = mine.filter((x) => x !== sn.toUpperCase()); setSns({ ...sns, [i.order_item_id]: n }); setQty({ ...qty, [i.order_item_id]: n.length }); }}><X size={10} className="inline" /></button> : null}</span>;
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {open && canHand ? (
        <div className="rounded-xl border border-brand/30 bg-brand/5 p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label={L("ชื่อผู้มารับ *", "Receiver name *", "取货人姓名 *")}><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder={L("ตรวจบัตร/ใบเสร็จก่อนส่งมอบ", "Check ID/receipt before handover", "交付前核对证件/收据")} /></Field>
            <Field label={L("หมายเหตุ", "Note", "备注")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <Button variant="primary" className="w-full" loading={busy} disabled={!selected.length || receiver.trim().length < 2} onClick={() => void submit()}>
            <PackageCheck size={16} /> {L("ส่งมอบ", "Hand over", "交付")} {selected.reduce((s, i) => s + (qty[i.order_item_id] ?? 0), 0)} {L("ชิ้น", "pcs", "件")}
          </Button>
        </div>
      ) : open ? <p className="text-xs text-muted">{L("ไม่มีสิทธิ์ส่งมอบ (ต้องมีสิทธิ์ “ส่งมอบสินค้าที่ลูกค้ามารับภายหลัง”)", "No handover permission (requires “Hand over customer pickups”)", "无交付权限（需要“交付客户稍后取货商品”权限）")}</p> : null}
      <div>
        <p className="text-sm font-semibold flex items-center gap-1.5 mb-2"><History size={14} /> {L("ประวัติ", "History", "历史")}</p>
        <ol className="space-y-2">
          {detail.events.map((e, k) => (
            <li key={k} className="text-xs flex gap-2">
              <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${e.kind === "handover" ? "bg-ok" : e.kind === "returned" ? "bg-danger" : "bg-brand"}`} />
              <span>
                <b>{e.kind === "created" ? L("ตั้งรอรับ", "Set for pickup", "设为待取货") : e.kind === "handover" ? L(`ส่งมอบให้ ${e.receiver_name}`, `Handed to ${e.receiver_name}`, `交付给 ${e.receiver_name}`) : e.kind === "returned" ? L("คืนเงินก่อนรับ", "Refunded before pickup", "取货前退款") : e.kind}</b>
                {" · "}{e.items.map((x) => `${x.sku} ×${x.qty}${x.serials?.length ? ` (${x.serials.join(", ")})` : ""}`).join(", ")}
                <span className="block text-muted">{new Date(e.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {detail.names[e.actor_id ?? ""] ?? "—"}{e.note ? ` · ${e.note}` : ""}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {detail.pickup.contact_phone ? <a href={`tel:${detail.pickup.contact_phone}`} className="text-xs text-brand inline-flex items-center gap-1"><Phone size={12} /> {L("โทรหาลูกค้า", "Call customer", "致电客户")}</a> : null}
    </div>
  );
}
