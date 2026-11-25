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

type Item = { order_item_id: string; sku: string; name: string; qty: number; picked_qty: number; returned_qty: number; serials: string[]; picked_serials: string[] };
type Row = { order_id: string; status: "pending" | "partial" | "completed" | "cancelled"; due_date: string | null; contact_name: string | null; contact_phone: string | null; note: string | null;
  items: Item[]; created_at: string; completed_at: string | null; version: number; remaining: number; orders: { order_no: string; client_uuid: string; grand_total: number; created_at: string } };
type Detail = { pickup: Row; order: { order_no: string; grand_total: number; created_at: string; status: string }; events: { kind: string; items: { sku: string; qty: number; serials?: string[] }[]; receiver_name: string | null; note: string | null; actor_id: string | null; created_at: string }[]; names: Record<string, string> };

const STATUS: Record<Row["status"], { label: string; tone: "warn" | "info" | "ok" | "neutral" }> = {
  pending: { label: "รอรับ", tone: "warn" }, partial: { label: "รับบางส่วน", tone: "info" }, completed: { label: "รับครบแล้ว", tone: "ok" }, cancelled: { label: "ยกเลิก (คืนเงินแล้ว)", tone: "neutral" },
};
const todayStr = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" })).toISOString().slice(0, 10);
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "—");
const left = (i: Item) => Number(i.qty) - Number(i.picked_qty) - Number(i.returned_qty);

export default function PickupsPage() {
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
    } catch (e) { setRows([]); toast.push({ tone: "danger", title: "โหลดรายการรอรับไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) }); }
  }, [branchId, status, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/pos/pickups?order_id=${id}`, { cache: "no-store" }); const j = await r.json();
    if (!r.ok) { toast.push({ tone: "danger", title: "เปิดรายการไม่สำเร็จ", body: j.error }); return; }
    setDetail(j);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDetail(null); if (openId) void loadDetail(openId); }, [openId, loadDetail]);

  async function create() {
    setBusy(true);
    try {
      const r = await fetch("/api/pos/pickups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", branch_id: branchId, order_no: form.order_no.trim(), due: form.due || null, note: form.note }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: j.replay ? "บิลนี้ตั้งรอรับไว้แล้ว" : "ตั้งเป็นรอลูกค้ามารับแล้ว" });
      setCreateOpen(false); setForm({ order_no: "", due: "", note: "" }); await load(); setOpenId(j.order_id);
    } catch (e) { toast.push({ tone: "danger", title: "ตั้งรอรับไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  const today = todayStr();
  const stats = useMemo(() => {
    const open = (rows ?? []).filter((r) => r.status === "pending" || r.status === "partial");
    return { open: open.length, overdue: open.filter((r) => r.due_date && r.due_date < today).length, dueToday: open.filter((r) => r.due_date === today).length, units: open.reduce((s, r) => s + r.remaining, 0) };
  }, [rows, today]);

  if (!employee || !branchId) return null;
  if (!isLiveMode()) return <div className="p-8 text-center text-sm text-muted">เมนูนี้ใช้กับระบบจริง (ข้อมูลอยู่ที่เซิร์ฟเวอร์กลาง)</div>;
  if (!can(employee, "pos.sell")) return <div className="p-8 text-center text-sm text-muted">ไม่มีสิทธิ์</div>;

  return (
    <PosPage title="รอลูกค้ารับของ" icon={<PackageCheck size={18} />}
      actions={<>
        <div className="relative w-full sm:w-60"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="เลขบิล / ชื่อ / เบอร์" className="pl-9 h-9" /></div>
        <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: "open", label: "ค้างรับ" }, { value: "done", label: "ปิดแล้ว" }, { value: "all", label: "ทั้งหมด" }]} />
        <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> ตั้งจากเลขบิล</Button>
      </>}>
      <div className="p-4 sm:p-6 space-y-4">
        <p className="text-[12.5px] text-muted">นโยบายร้าน: ไม่รับมัดจำ — ลูกค้าจ่ายเต็มจำนวน ออกบิล แล้วค่อยมารับของ · ของที่รอรับเป็นของลูกค้าแล้ว (ตัดสต๊อกตอนขาย) ให้แยกเก็บ ไม่ขายซ้ำ และไม่ต้องนับในรอบตรวจนับ</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatChip label="บิลค้างรับ" value={stats.open} accent="lavender" icon={<PackageCheck size={16} />} />
          <StatChip label="ชิ้นที่ยังอยู่ในร้าน" value={stats.units} accent="mint" icon={<Clock size={16} />} />
          <StatChip label="นัดรับวันนี้" value={stats.dueToday} accent="peach" icon={<CheckCircle2 size={16} />} />
          <StatChip label="เกินวันนัด" value={stats.overdue} accent="coral" icon={<AlertTriangle size={16} />} />
        </div>
        <TablePanel>
          {rows === null ? <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : rows.length ? (
            <Table>
              <thead><tr><Th>บิล</Th><Th>ลูกค้า</Th><Th>รายการค้างรับ</Th><Th>วันนัด</Th><Th align="center">สถานะ</Th><Th align="right">ยอดบิล</Th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = (r.status === "pending" || r.status === "partial") && r.due_date && r.due_date < today;
                  return (
                    <tr key={r.order_id} className={`hover:bg-surface2/60 cursor-pointer ${overdue ? "bg-danger/4" : ""}`} onClick={() => setOpenId(r.order_id)}>
                      <Td className="font-mono text-xs">{r.orders.order_no}<span className="block text-[10px] text-muted font-sans">ขาย {day(r.orders.created_at)}</span></Td>
                      <Td className="text-xs">{r.contact_name ?? "—"}{r.contact_phone ? <span className="block text-[10px] text-muted">{r.contact_phone}</span> : null}</Td>
                      <Td className="text-xs">{r.items.filter((i) => left(i) > 0).map((i) => `${i.sku} ×${left(i)}`).join(", ") || "—"}</Td>
                      <Td className={`text-xs ${overdue ? "text-danger font-medium" : r.due_date === today ? "text-warn font-medium" : ""}`}>{day(r.due_date)}{overdue ? " · เกินนัด" : r.due_date === today ? " · วันนี้" : ""}</Td>
                      <Td align="center"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></Td>
                      <Td align="right" className="text-xs tnum">{formatTHB(Number(r.orders.grand_total))}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={<PackageCheck size={26} />} title={status === "open" ? "ไม่มีของรอลูกค้ามารับ" : "ไม่มีรายการ"} body="ตอนขาย ติ๊ก “ลูกค้ามารับของภายหลัง” ก่อนรับเงิน — หรือกด “ตั้งจากเลขบิล” สำหรับบิลที่ขายไปแล้ว" />}
        </TablePanel>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="ตั้งรอลูกค้ามารับ จากบิลที่ขายแล้ว" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={!form.order_no.trim()} onClick={() => void create()}>บันทึก</Button></>}>
        <div className="space-y-3">
          <Field label="เลขบิล *"><Input autoFocus value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} placeholder="เช่น UAT-33856-261125-0011" className="font-mono" /></Field>
          <Field label="วันนัดรับ (ไม่บังคับ)"><Input type="date" min={today} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
          <Field label="หมายเหตุ"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="เช่น ลูกค้าโอนแล้ว มารับวันเสาร์" /></Field>
        </div>
      </Modal>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} width="lg" title={detail ? <span className="font-mono">{detail.order.order_no}</span> : "กำลังโหลด…"}
        subtitle={detail ? `${detail.pickup.contact_name ?? "ไม่ระบุชื่อ"}${detail.pickup.contact_phone ? ` · ${detail.pickup.contact_phone}` : ""} · ยอด ${formatTHB(Number(detail.order.grand_total))}` : undefined}
        badge={detail ? <Badge tone={STATUS[detail.pickup.status].tone}>{STATUS[detail.pickup.status].label}</Badge> : undefined}>
        {detail ? <Handover key={`${detail.pickup.order_id}:${detail.pickup.version}`} detail={detail} canHand={can(employee, "pickup.handover")} onDone={async () => { await load(); if (openId) await loadDetail(openId); }} /> : <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      </Drawer>
    </PosPage>
  );
}

function Handover({ detail, canHand, onDone }: { detail: Detail; canHand: boolean; onDone: () => Promise<void> }) {
  const toast = useToast();
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
    if (!line) { setScanErr(`${sn} ไม่ใช่เครื่องในบิลนี้ — ห้ามส่งมอบ`); return; }
    if (line.picked_serials.map((x) => x.toUpperCase()).includes(sn)) { setScanErr(`${sn} ส่งมอบไปแล้ว`); return; }
    if ((sns[line.order_item_id] ?? []).includes(sn)) { setScanErr(`${sn} สแกนแล้ว`); return; }
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
      toast.push({ tone: "ok", title: j.status === "completed" ? "ส่งมอบครบแล้ว" : "บันทึกการส่งมอบบางส่วนแล้ว" });
      setSns({}); await onDone();
    } catch (e) { toast.push({ tone: "danger", title: "ส่งมอบไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-5 space-y-5">
      {p.due_date ? <p className="text-xs text-muted flex items-center gap-1.5"><Clock size={13} /> นัดรับ {day(p.due_date)}{p.note ? ` · ${p.note}` : ""}</p> : p.note ? <p className="text-xs text-muted">{p.note}</p> : null}
      {open && canHand && p.items.some((i) => i.serials.length && left(i) > 0) ? (
        <div>
          <form onSubmit={(e) => { e.preventDefault(); addScan(); }} className="flex gap-2">
            <div className="relative flex-1"><ScanLine size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input ref={ref} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="สแกน SN ของเครื่องที่ส่งมอบ" className="pl-9 font-mono" /></div>
            <Button type="submit" variant="soft">เพิ่ม</Button>
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
                  <p className="text-sm font-medium truncate">{i.name}</p>
                  <p className="text-[11px] text-muted font-mono">{i.sku}</p>
                  <p className="text-[11px] text-muted mt-0.5">ซื้อ {i.qty} · รับแล้ว {i.picked_qty}{i.returned_qty ? ` · คืนเงิน ${i.returned_qty}` : ""} · <b className={rem ? "text-ink" : "text-ok"}>ค้าง {rem}</b></p>
                </div>
                {open && canHand && rem > 0 && !i.serials.length ? (
                  <div className="flex items-center gap-1.5"><span className="text-[11px] text-muted">ส่งมอบ</span>
                    <Input value={String(qty[i.order_item_id] ?? 0)} inputMode="numeric" onChange={(e) => setQty({ ...qty, [i.order_item_id]: Math.min(rem, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)) })} className="h-8 w-16 text-center tnum" /></div>
                ) : null}
              </div>
              {i.serials.length ? (
                <div className="flex flex-wrap gap-1 mt-2">
                  {i.serials.map((sn) => {
                    const done = i.picked_serials.includes(sn), now = mine.includes(sn.toUpperCase());
                    return <span key={sn} className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded-md ${done ? "bg-surface2 text-muted line-through" : now ? "bg-ok/15 text-ok" : "bg-warn/12 text-warn"}`}>{sn}{now ? <button className="ml-1" onClick={() => { const n = mine.filter((x) => x !== sn.toUpperCase()); setSns({ ...sns, [i.order_item_id]: n }); setQty({ ...qty, [i.order_item_id]: n.length }); }}><X size={10} className="inline" /></button> : null}</span>;
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
            <Field label="ชื่อผู้มารับ *"><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="ตรวจบัตร/ใบเสร็จก่อนส่งมอบ" /></Field>
            <Field label="หมายเหตุ"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <Button variant="primary" className="w-full" loading={busy} disabled={!selected.length || receiver.trim().length < 2} onClick={() => void submit()}>
            <PackageCheck size={16} /> ส่งมอบ {selected.reduce((s, i) => s + (qty[i.order_item_id] ?? 0), 0)} ชิ้น
          </Button>
        </div>
      ) : open ? <p className="text-xs text-muted">ไม่มีสิทธิ์ส่งมอบ (ต้องมีสิทธิ์ “ส่งมอบสินค้าที่ลูกค้ามารับภายหลัง”)</p> : null}
      <div>
        <p className="text-sm font-semibold flex items-center gap-1.5 mb-2"><History size={14} /> ประวัติ</p>
        <ol className="space-y-2">
          {detail.events.map((e, k) => (
            <li key={k} className="text-xs flex gap-2">
              <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${e.kind === "handover" ? "bg-ok" : e.kind === "returned" ? "bg-danger" : "bg-brand"}`} />
              <span>
                <b>{e.kind === "created" ? "ตั้งรอรับ" : e.kind === "handover" ? `ส่งมอบให้ ${e.receiver_name}` : e.kind === "returned" ? "คืนเงินก่อนรับ" : e.kind}</b>
                {" · "}{e.items.map((x) => `${x.sku} ×${x.qty}${x.serials?.length ? ` (${x.serials.join(", ")})` : ""}`).join(", ")}
                <span className="block text-muted">{new Date(e.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {detail.names[e.actor_id ?? ""] ?? "—"}{e.note ? ` · ${e.note}` : ""}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {detail.pickup.contact_phone ? <a href={`tel:${detail.pickup.contact_phone}`} className="text-xs text-brand inline-flex items-center gap-1"><Phone size={12} /> โทรหาลูกค้า</a> : null}
    </div>
  );
}
