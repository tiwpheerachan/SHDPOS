"use client";
// ปิดงวดบัญชี (รายเดือน รายสาขา) — UAT F070 · สรุปยอดขายสุทธิ F068 · สมการสต๊อก F064
//   ปิดแล้ว: บันทึกย้อนหลังเข้างวดไม่ได้ · เปิดใหม่ต้องมีสิทธิ์แยก + เหตุผล · ปิดแต่ละครั้งเก็บรายงานเป็น version
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Lock, LockOpen, CheckCircle2, AlertTriangle, FileDown, History, Loader2, Boxes, Wallet, RotateCcw, FileMinus, Ban } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useToast } from "@/components/toast-host";
import { Button, Badge, Modal, Field, Input, Select, Skeleton } from "@/components/ui";
import { downloadExcel } from "@/lib/export";

type Summary = {
  sales: { bills: number; gross: number; vat: number }; voids: { bills: number; amount: number }; returns: { count: number; amount: number };
  credit_notes: { discount_count: number; discount_amount: number; return_linked_count: number; return_linked_amount: number };
  net_sales: number; net_vat: number; payments: Record<string, number>; cash_movements: Record<string, number>;
  stock: { opening: number; movement: number; closing: number; by_type: Record<string, number>; skus_out_of_balance: number };
  open_items: Record<string, number>; generated_at: string;
};
type Period = { period: string; status: "open" | "closed"; version: number; ended: boolean; closed_by?: string | null; closed_at?: string | null; reopened_by?: string | null; reopened_at?: string | null; reopen_reason?: string | null };
type Data = { branches: { id: string; code: string; name: string; name_th: string | null }[]; branch_id: string; period: string; can_close: boolean; can_reopen: boolean; names: Record<string, string>;
  periods: Period[]; current: Period; live: Summary; versions: { version: number; summary: Summary; closed_by: string | null; closed_at: string; note: string | null }[] };

const baht = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH");
const METHOD: Record<string, string> = { cash: "เงินสด", credit_card: "บัตรเครดิต", debit_card: "บัตรเดบิต", qr_promptpay: "พร้อมเพย์", bank_transfer: "โอนเงิน", edc: "EDC", gift_card: "บัตรของขวัญ", store_credit: "เครดิตร้าน", installment: "ผ่อน", online_marketplace: "มาร์เก็ตเพลส", other: "อื่น ๆ" };
const MOVE: Record<string, string> = { sale: "ขาย", return: "รับคืน", exchange_in: "เปลี่ยน (เข้า)", exchange_out: "เปลี่ยน (ออก)", receive: "รับเข้า", transfer_out: "โอนออก", transfer_in: "โอนเข้า", count_adjust: "ปรับจากการนับ", damage: "ของเสีย", claim_out: "ส่งเคลม/คืนผู้ขาย", claim_in: "รับเคลมกลับ", manual_adjust: "ปรับมือ", opening: "ยอดยกมา" };
const CASH: Record<string, string> = { cash_in: "นำเงินเข้า", cash_out: "นำเงินออก/คืนเงิน", drop: "ฝากเงิน", pickup: "เบิกเงิน", open_no_sale: "เปิดลิ้นชัก", adjust: "ปรับยอด" };
const OPEN: Record<string, string> = { open_shifts: "กะที่ยังไม่ปิด", pending_returns: "คำขอคืน/ยกเลิกบิลที่รออนุมัติ", pending_deferred_sales: "บิลค้างส่งที่ยังไม่ลงบัญชี", open_counts: "รอบนับสต๊อกที่ยังไม่ปิด" };

export default function PeriodsPage() {
  const { locale } = useI18n();
  const toast = useToast();
  const monthLabel = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { month: "long", year: "numeric" }); };
  const when = (s?: string | null) => (s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState("");
  const [branch, setBranch] = useState(""), [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false), [closeOpen, setCloseOpen] = useState(false), [reopenOpen, setReopenOpen] = useState(false), [text, setText] = useState(""), [viewV, setViewV] = useState<number | null>(null);

  const load = useCallback(async (b?: string, p?: string) => {
    const q = new URLSearchParams(); if (b) q.set("branch_id", b); if (p) q.set("period", p);
    try {
      const r = await fetch(`/api/admin/periods?${q}`, { cache: "no-store" }); const j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j); setBranch(j.branch_id); setPeriod(j.period); setErr(""); setViewV(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(action: "close" | "reopen") {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, branch_id: branch, period, note: text, reason: text }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: action === "close" ? `ปิดงวด ${monthLabel(period)} แล้ว (version ${j.version})` : `เปิดงวด ${monthLabel(period)} แล้ว — บันทึกย้อนหลังได้จนกว่าจะปิดอีกครั้ง` });
      setCloseOpen(false); setReopenOpen(false); setText(""); await load(branch, period);
    } catch (e) { toast.push({ tone: "danger", title: action === "close" ? "ปิดงวดไม่สำเร็จ" : "เปิดงวดไม่สำเร็จ", body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  const shown: Summary | null = useMemo(() => (viewV ? data?.versions.find((v) => v.version === viewV)?.summary ?? null : data?.live ?? null), [data, viewV]);
  const lastSnap = data?.versions[0]?.summary;
  const drift = data && lastSnap && data.current.status === "open" && data.current.version > 0 ? Number(data.live.net_sales) - Number(lastSnap.net_sales) : 0;
  const openCount = shown ? Object.values(shown.open_items).reduce((a, b) => a + Number(b), 0) : 0;
  const cur = data?.current;
  const curEnded = data?.periods.find((p) => p.period === period)?.ended ?? true;

  function exportXls() {
    if (!shown || !data) return;
    const b = data.branches.find((x) => x.id === branch);
    const rows: { k: string; v: string | number }[] = [
      { k: "สาขา", v: `${b?.code ?? ""} ${b?.name_th ?? b?.name ?? ""}` }, { k: "งวด", v: monthLabel(period) }, { k: "สถานะ", v: cur?.status === "closed" ? `ปิดแล้ว v${cur.version}` : "เปิด" },
      { k: "รายงาน", v: viewV ? `snapshot version ${viewV}` : `ยอดสด ณ ${when(shown.generated_at)}` },
      { k: "บิลขาย (ไม่รวมยกเลิก)", v: shown.sales.bills }, { k: "ยอดขายรวม", v: Number(shown.sales.gross) },
      { k: "หัก คืนเงินจากการรับคืน", v: -Number(shown.returns.amount) }, { k: "หัก ใบลดหนี้ส่วนลด", v: -Number(shown.credit_notes.discount_amount) },
      { k: "ยอดขายสุทธิ", v: Number(shown.net_sales) }, { k: "ภาษีขายสุทธิ", v: Number(shown.net_vat) },
      { k: "บิลยกเลิก (แยก ไม่นับในยอดขาย)", v: `${shown.voids.bills} บิล · ${baht(shown.voids.amount)}` },
      { k: "ใบลดหนี้จากการรับคืน (อ้างอิง ไม่หักซ้ำ)", v: Number(shown.credit_notes.return_linked_amount) },
      ...Object.entries(shown.payments).map(([m, v]) => ({ k: `รับชำระ: ${METHOD[m] ?? m}`, v: Number(v) })),
      { k: "สต๊อกยกมา (ชิ้น)", v: Number(shown.stock.opening) }, ...Object.entries(shown.stock.by_type).map(([t, v]) => ({ k: `สต๊อก: ${MOVE[t] ?? t}`, v: Number(v) })),
      { k: "สต๊อกคงเหลือ (ชิ้น)", v: Number(shown.stock.closing) },
    ];
    downloadExcel(`period-${b?.code ?? "branch"}-${period}${viewV ? `-v${viewV}` : ""}.xls`, [{ key: "k", label: "รายการ" }, { key: "v", label: "ค่า" }], rows, `สรุปงวด ${monthLabel(period)}`);
  }

  if (err) return <div className="p-4 sm:p-6"><p className="rounded-xl bg-danger/8 text-danger text-sm px-4 py-3">{err}</p></div>;
  if (!data || !shown) return <div className="p-4 sm:p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center"><CalendarCheck size={19} /></span>
          <div><h1 className="text-lg font-semibold">ปิดงวดบัญชี</h1><p className="text-xs text-muted">ปิดแล้วบันทึกย้อนหลังเข้างวดไม่ได้ · รายการคืน/ลดหนี้วันนี้ลงงวดปัจจุบัน · ทุกครั้งที่ปิดเก็บรายงานเป็น version</p></div>
        </div>
        <div className="ml-auto w-full sm:w-72">
          <Select value={branch} onChange={(e) => void load(e.target.value, period)}>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_th ?? b.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-5 items-start">
        {/* รายการงวด */}
        <div className="card p-2 space-y-1">
          {data.periods.map((p) => (
            <button key={p.period} onClick={() => void load(branch, p.period)} className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-2.5 transition ${p.period === period ? "bg-brand/8 ring-1 ring-brand/30" : "hover:bg-surface2"}`}>
              <span className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${p.status === "closed" ? "bg-ok/12 text-ok" : p.ended ? "bg-warn/12 text-warn" : "bg-surface2 text-muted"}`}>{p.status === "closed" ? <Lock size={14} /> : p.ended ? <LockOpen size={14} /> : <CalendarCheck size={14} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{monthLabel(p.period)}</span>
                <span className="block text-[11px] text-muted">{p.status === "closed" ? `ปิดแล้ว · v${p.version}` : p.ended ? (p.version ? `เปิดใหม่หลัง v${p.version} · รอปิด` : "จบเดือนแล้ว · รอปิด") : "งวดปัจจุบัน"}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-4 min-w-0">
          {/* หัวงวด */}
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold flex items-center gap-2">{monthLabel(period)}
                {cur?.status === "closed" ? <Badge tone="ok"><Lock size={11} /> ปิดแล้ว v{cur.version}</Badge> : curEnded ? <Badge tone="warn">ยังไม่ปิด</Badge> : <Badge tone="neutral">งวดปัจจุบัน</Badge>}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {cur?.status === "closed" ? `ปิดโดย ${data.names[cur.closed_by ?? ""] ?? "—"} · ${when(cur.closed_at)}` : cur?.reopened_at ? `เปิดใหม่โดย ${data.names[cur.reopened_by ?? ""] ?? "—"} · ${when(cur.reopened_at)} — “${cur.reopen_reason}”` : "ยังไม่เคยปิด"}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" onClick={exportXls}><FileDown size={15} /> Excel</Button>
              {cur?.status !== "closed" && data.can_close ? <Button variant="primary" disabled={!curEnded} title={!curEnded ? "ปิดได้หลังสิ้นเดือน" : undefined} onClick={() => { setText(""); setCloseOpen(true); }}><Lock size={15} /> ปิดงวด</Button> : null}
              {cur?.status === "closed" && data.can_reopen ? <Button variant="soft" onClick={() => { setText(""); setReopenOpen(true); }}><LockOpen size={15} /> เปิดงวดใหม่</Button> : null}
            </div>
          </div>

          {drift ? <div className="rounded-xl border border-warn/40 bg-warn/8 px-4 py-3 text-[13px] flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5 text-warn" />ยอดขายสุทธิสดต่างจากรายงานที่ปิดไว้ (v{data.versions[0].version}) {drift > 0 ? "+" : ""}{baht(drift)} บาท — ปิดงวดอีกครั้งเพื่อออกรายงาน version ใหม่</div> : null}
          {viewV ? <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-2.5 text-[13px] flex items-center gap-2"><History size={15} />กำลังดูรายงานที่ปิดไว้ version {viewV} (ภาพ ณ ตอนปิด) <button className="ml-auto underline text-xs" onClick={() => setViewV(null)}>กลับไปดูยอดสด</button></div> : null}

          {/* ยอดขายสุทธิ */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Tile icon={<Wallet size={16} />} label={`ยอดขาย · ${qty(shown.sales.bills)} บิล`} value={baht(shown.sales.gross)} />
            <Tile icon={<RotateCcw size={16} />} label={`หัก คืนเงิน · ${qty(shown.returns.count)} ใบ`} value={Number(shown.returns.amount) ? `−${baht(shown.returns.amount)}` : baht(0)} tone={Number(shown.returns.amount) ? "danger" : undefined} />
            <Tile icon={<FileMinus size={16} />} label={`หัก ใบลดหนี้ส่วนลด · ${qty(shown.credit_notes.discount_count)} ใบ`} value={Number(shown.credit_notes.discount_amount) ? `−${baht(shown.credit_notes.discount_amount)}` : baht(0)} tone={Number(shown.credit_notes.discount_amount) ? "danger" : undefined} />
            <Tile icon={<CheckCircle2 size={16} />} label="ยอดขายสุทธิ" value={baht(shown.net_sales)} strong sub={`ภาษีขายสุทธิ ${baht(shown.net_vat)}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4 space-y-2 text-sm">
              <p className="font-semibold">รายละเอียดที่ไม่ถูกหักซ้ำ</p>
              <Row k={<span className="inline-flex items-center gap-1.5"><Ban size={13} />บิลยกเลิก (ไม่นับในยอดขาย)</span>} v={`${qty(shown.voids.bills)} บิล · ${baht(shown.voids.amount)}`} />
              <Row k="ใบลดหนี้จากการรับคืน (อ้างอิง เงินคืนอยู่ในใบรับคืนแล้ว)" v={`${qty(shown.credit_notes.return_linked_count)} ใบ · ${baht(shown.credit_notes.return_linked_amount)}`} />
              <p className="font-semibold pt-2">รับชำระตามช่องทาง</p>
              {Object.keys(shown.payments).length ? Object.entries(shown.payments).map(([m, v]) => <Row key={m} k={METHOD[m] ?? m} v={baht(v)} />) : <p className="text-xs text-muted">ไม่มี</p>}
              {Object.keys(shown.cash_movements).length ? <><p className="font-semibold pt-2">เงินเข้า-ออกลิ้นชัก</p>{Object.entries(shown.cash_movements).map(([m, v]) => <Row key={m} k={CASH[m] ?? m} v={baht(v)} />)}</> : null}
            </div>
            <div className="card p-4 space-y-2 text-sm">
              <p className="font-semibold flex items-center gap-1.5"><Boxes size={15} /> สมการสต๊อก (ชิ้น)</p>
              <Row k="ยกมาต้นงวด" v={qty(shown.stock.opening)} />
              {Object.entries(shown.stock.by_type).map(([t, v]) => <Row key={t} k={`${Number(v) >= 0 ? "+" : "−"} ${MOVE[t] ?? t}`} v={qty(Math.abs(Number(v)))} muted />)}
              <div className="border-t border-line pt-2"><Row k={<b>คงเหลือปลายงวด</b>} v={<b>{qty(shown.stock.closing)}</b>} /></div>
              <p className={`text-[11px] ${Number(shown.stock.opening) + Number(shown.stock.movement) === Number(shown.stock.closing) ? "text-ok" : "text-danger"}`}>
                {qty(shown.stock.opening)} {Number(shown.stock.movement) >= 0 ? "+" : "−"} {qty(Math.abs(Number(shown.stock.movement)))} = {qty(shown.stock.closing)} {Number(shown.stock.opening) + Number(shown.stock.movement) === Number(shown.stock.closing) ? "✓ สมดุล" : "✗ ไม่สมดุล"}
              </p>
              {Number(shown.stock.skus_out_of_balance) ? <p className="text-[11px] text-warn">{qty(shown.stock.skus_out_of_balance)} SKU ที่ยอดคงเหลือปัจจุบันไม่ตรงกับ stock card (ยอดตั้งต้น/ดึงจากคลังกลางโดยไม่มีรายการเคลื่อนไหว)</p> : null}
            </div>
          </div>

          {/* รายการค้างก่อนปิด */}
          {cur?.status !== "closed" && curEnded ? (
            <div className={`card p-4 text-sm ${openCount ? "border-warn/40" : ""}`}>
              <p className="font-semibold mb-2">ตรวจก่อนปิดงวด</p>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {Object.entries(shown.open_items).map(([k, v]) => (
                  <p key={k} className={`flex items-center gap-2 text-[13px] ${Number(v) ? "text-warn" : "text-ok"}`}>{Number(v) ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{OPEN[k] ?? k}: {qty(v)}</p>
                ))}
              </div>
              {openCount ? <p className="text-[11px] text-muted mt-2">ต้องเคลียร์ให้ครบก่อนปิด (ปิดกะ / อนุมัติหรือปฏิเสธคำขอคืน / ลงบัญชีบิลค้างส่ง / ปิดรอบนับ)</p> : null}
            </div>
          ) : null}

          {/* ประวัติ version */}
          <div className="card p-4">
            <p className="font-semibold text-sm flex items-center gap-1.5 mb-2"><History size={15} /> รายงานที่ปิดไว้ (version)</p>
            {data.versions.length ? (
              <div className="divide-y divide-line">
                {data.versions.map((v) => (
                  <button key={v.version} onClick={() => setViewV(viewV === v.version ? null : v.version)} className={`w-full text-left py-2.5 flex items-center gap-3 text-sm ${viewV === v.version ? "text-brand" : ""}`}>
                    <Badge tone={v.version === data.versions[0].version ? "ok" : "neutral"}>v{v.version}</Badge>
                    <span className="flex-1 min-w-0 truncate">ยอดขายสุทธิ {baht(v.summary.net_sales)} · ปิดโดย {data.names[v.closed_by ?? ""] ?? "—"} · {when(v.closed_at)}{v.note ? ` — ${v.note}` : ""}</span>
                    <span className="text-[11px] text-muted">{viewV === v.version ? "กำลังดู" : "ดู"}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-xs text-muted">ยังไม่เคยปิดงวดนี้</p>}
          </div>
        </div>
      </div>

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title={`ปิดงวด ${monthLabel(period)}`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCloseOpen(false)}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={openCount > 0} onClick={() => void act("close")}><Lock size={15} /> ยืนยันปิดงวด</Button></>}>
        <div className="space-y-3 text-sm">
          <p>หลังปิด: บิล/การเคลื่อนไหวสต๊อก/เงินลิ้นชักที่ลงวันที่ในงวดนี้ บันทึกเพิ่มไม่ได้ · ระบบเก็บรายงานนี้เป็น version {(cur?.version ?? 0) + 1}</p>
          <div className="rounded-xl bg-surface2 px-3 py-2 tnum">ยอดขายสุทธิ <b>{baht(data.live.net_sales)}</b> · ภาษีขายสุทธิ {baht(data.live.net_vat)}</div>
          {openCount ? <p className="text-warn text-xs">ยังมีรายการค้าง {openCount} รายการ — เคลียร์ก่อนจึงปิดได้</p> : null}
          <Field label="หมายเหตุ (ไม่บังคับ)"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
        </div>
      </Modal>
      <Modal open={reopenOpen} onClose={() => setReopenOpen(false)} title={`เปิดงวด ${monthLabel(period)} ใหม่`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setReopenOpen(false)}>ยกเลิก</Button><Button variant="danger" loading={busy} disabled={text.trim().length < 5} onClick={() => void act("reopen")}><LockOpen size={15} /> ยืนยันเปิดงวด</Button></>}>
        <div className="space-y-3 text-sm">
          <p>เปิดแล้วบันทึกย้อนหลังเข้างวดนี้ได้จนกว่าจะปิดอีกครั้ง (รายงานเดิม v{cur?.version} ยังเก็บไว้ · ปิดใหม่จะได้ v{(cur?.version ?? 0) + 1}) · บันทึกเหตุผลใน log</p>
          <Field label="เหตุผล (บังคับ)"><Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="เช่น ลงบิลตกหล่นของวันที่ 28" /></Field>
        </div>
      </Modal>
      {busy ? <span className="sr-only"><Loader2 /></span> : null}
    </div>
  );
}

function Tile({ icon, label, value, sub, tone, strong }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "danger"; strong?: boolean }) {
  return (
    <div className={`card px-4 py-3 ${strong ? "ring-1 ring-brand/30 bg-brand/5" : ""}`}>
      <p className="text-[11px] text-muted flex items-center gap-1.5">{icon}{label}</p>
      <p className={`text-xl font-semibold tnum mt-0.5 ${tone === "danger" ? "text-danger" : strong ? "text-brand" : ""}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}
function Row({ k, v, muted }: { k: React.ReactNode; v: React.ReactNode; muted?: boolean }) {
  return <p className={`flex items-center justify-between gap-3 ${muted ? "text-muted text-[13px]" : ""}`}><span className="min-w-0">{k}</span><span className="tnum shrink-0">{v}</span></p>;
}
