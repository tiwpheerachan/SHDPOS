"use client";
// คิวส่งบิลขาย POS → OneWarehouse: สถานะทุกบิล · ส่งทันที · ลองใหม่ · แก้ SN ของบิล sn_pending (PATCH)
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Send, RotateCcw, ScanLine, CheckCircle2, AlertTriangle, Clock3, X } from "lucide-react";
import { Button, Badge, Drawer } from "@/components/ui";
import { formatTHB } from "@/lib/money";

interface Ev {
  id: string; state: string; reason: string | null; attempts: number; available_at: string; created_at: string;
  order_no: string | null; branch_id: string | null; grand_total: number | null;
  ow_sale_no: string | null; ow_status: string | null; jst_order_no: string | null;
  problems: { code: string; message: string }[]; lines: { sku: string; qty: number; serials?: string[] }[]; error: { code?: string; message?: string } | null;
}
const STATE: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "info" }> = {
  delivered: { label: "ส่ง OW แล้ว", tone: "ok" }, queued: { label: "รอส่ง", tone: "info" }, processing: { label: "กำลังส่ง", tone: "info" },
  retry: { label: "รอลองใหม่", tone: "warn" }, blocked: { label: "ติด (ต้องแก้)", tone: "danger" }, dead: { label: "ลองครบแล้ว", tone: "danger" },
};

export function OwSalesPanel() {
  const [data, setData] = useState<{ events: Ev[]; branches: { id: string; name: string; name_th: string | null }[] } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [filter, setFilter] = useState("all");
  const [fix, setFix] = useState<Ev | null>(null), [fixSn, setFixSn] = useState<Record<number, string>>({}), [fixReason, setFixReason] = useState("");
  async function load() {
    try { const r = await fetch("/api/admin/ow-outbox", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "อ่านคิวไม่สำเร็จ"); }
  }
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, []);
  async function post(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try { const r = await fetch("/api/admin/ow-outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw Error(j.error); await load(); return j; }
    catch (e) { setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ"); return null; } finally { setBusy(false); }
  }
  const bn = useMemo(() => new Map((data?.branches ?? []).map((b) => [b.id, b.name_th || b.name])), [data]);
  const evs = data?.events ?? [];
  const count = (s: string) => evs.filter((e) => e.state === s).length;
  const shown = evs.filter((e) => filter === "all" || (filter === "problem" ? ["blocked", "dead", "retry"].includes(e.state) : e.state === filter));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([["ส่งสำเร็จ", count("delivered"), CheckCircle2, "text-ok"], ["รอส่ง", count("queued") + count("processing"), Clock3, "text-sky-600"], ["รอลองใหม่", count("retry"), RotateCcw, "text-warn"], ["ติด (ต้องแก้)", count("blocked") + count("dead"), AlertTriangle, "text-danger"]] as const).map(([l, v, Icon, tone]) => (
          <div key={l} className="rounded-2xl border border-line/70 bg-surface p-4">
            <div className="flex items-center justify-between"><p className="text-[11px] text-muted">{l}</p><Icon size={14} className={tone} /></div>
            <p className={`text-2xl font-semibold tnum mt-1 ${v ? tone : ""}`}>{v}</p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <div className="flex rounded-xl bg-surface2/70 p-0.5">
            {([["all", "ทั้งหมด"], ["problem", "มีปัญหา"], ["delivered", "สำเร็จ"], ["queued", "รอส่ง"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`h-8 px-3 rounded-lg text-xs ${filter === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-muted">ส่งอัตโนมัติทุกรอบ worker · บิลจากสาขาที่ยังไม่ผูกสาขาขาย OW จะติดไว้จนผูก</span>
          <div className="ml-auto flex gap-2">
            <Button variant="soft" onClick={() => void load()}><RefreshCw size={14} />โหลด</Button>
            <Button variant="primary" loading={busy} onClick={() => void post({ action: "process" })}><Send size={14} />ส่งคิวตอนนี้</Button>
          </div>
        </div>
        {error ? <p role="alert" className="px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}
        <div className="max-h-[calc(100vh-360px)] min-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0"><tr>
              {["บิล POS", "สาขา", "ยอด", "สถานะคิว", "OW / JST", "เหตุผล", ""].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {shown.map((e) => (
                <tr key={e.id} className="hover:bg-surface2/40">
                  <td className="px-3 py-2"><p className="font-mono">{e.order_no ?? "—"}</p><p className="text-[10px] text-muted">{new Date(e.created_at).toLocaleString("th-TH")}</p></td>
                  <td className="px-3 py-2">{e.branch_id ? bn.get(e.branch_id) ?? "—" : "—"}</td>
                  <td className="px-3 py-2 tnum">{e.grand_total != null ? formatTHB(Number(e.grand_total)) : "—"}</td>
                  <td className="px-3 py-2"><Badge tone={STATE[e.state]?.tone ?? "neutral"}>{STATE[e.state]?.label ?? e.state}</Badge>{e.attempts > 1 ? <span className="ml-1 text-[10px] text-muted">×{e.attempts}</span> : null}</td>
                  <td className="px-3 py-2">
                    <p className="font-mono">{e.ow_sale_no ?? "—"}</p>
                    {e.ow_status ? <span className={`text-[10px] px-1.5 py-0.5 rounded ${isOwSaleDone(e.ow_status) ? "bg-ok/12 text-ok" : e.ow_status === "sn_pending" ? "bg-warn/12 text-warn" : e.ow_status === "failed" ? "bg-danger/12 text-danger" : "bg-sky-500/10 text-sky-600"}`}>
                      {isOwSaleDone(e.ow_status) ? "JST ยืนยันแล้ว" : e.ow_status === "sn_pending" ? "รอแก้ SN" : e.ow_status === "submitted" ? "OW รับแล้ว · รอ JST" : e.ow_status === "failed" ? "JST ล้มเหลว" : e.ow_status}
                    </span> : null}
                    {e.jst_order_no ? <p className="text-[10px] text-muted">JST {e.jst_order_no}</p> : null}
                  </td>
                  <td className="px-3 py-2 max-w-[280px]"><p className="truncate" title={e.reason ?? ""}>{e.reason ?? "—"}</p></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {e.ow_status === "sn_pending" ? <Button variant="soft" onClick={() => { setFix(e); setFixReason(""); setFixSn(Object.fromEntries(e.lines.map((l, i) => [i, (l.serials ?? []).join("\n")]))); }}><ScanLine size={13} />แก้ SN</Button> : null}
                    {["blocked", "dead", "retry"].includes(e.state) && e.ow_status !== "sn_pending" ? <Button variant="ghost" disabled={busy} onClick={() => void post({ action: "retry", id: e.id })}><RotateCcw size={13} />ลองใหม่</Button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length ? <p className="text-center text-xs text-muted py-12">{data ? "ไม่มีรายการ" : "กำลังโหลด…"}</p> : null}
        </div>
      </section>

      <Drawer open={!!fix} onClose={() => setFix(null)} title={fix ? `แก้ SN · ${fix.order_no ?? fix.ow_sale_no}` : ""} subtitle="บิลอยู่สถานะ sn_pending: OW ยังไม่ตัดสต๊อก/ไม่เปิดบิล JST จนกว่าจะได้ SN ที่ถูก"
        footer={fix ? <><span className="flex-1" /><Button variant="ghost" onClick={() => setFix(null)}><X size={14} />ยกเลิก</Button><Button variant="primary" loading={busy} onClick={async () => {
          const serials = Object.fromEntries(Object.entries(fixSn).map(([k, v]) => [k, v.split(/[\s,]+/).filter(Boolean)]));
          const r = await post({ action: "patch-serials", id: fix.id, serials, reason: fixReason }); if (r?.ok) setFix(null);
        }}>ส่งแก้ SN</Button></> : undefined}>
        {fix ? (
          <div className="p-5 space-y-4">
            {fix.problems.length ? <div className="rounded-xl bg-warn/10 text-warn text-xs p-3 space-y-1">{fix.problems.map((p, i) => <p key={i}>{p.message || p.code}</p>)}</div> : null}
            {error ? <p role="alert" className="text-xs text-danger bg-danger/5 rounded-lg p-2.5">{error}</p> : null}
            {fix.lines.map((l, i) => (
              <label key={i} className="block">
                <span className="text-xs text-muted">บรรทัด {i + 1} · {l.sku} · {l.qty} ชิ้น{(l as { isFreebie?: boolean }).isFreebie ? " (ของแถม)" : ""} — ใส่ SN {l.qty} ตัว คั่นด้วยบรรทัด/คอมมา</span>
                <textarea className="mt-1.5 w-full rounded-xl border border-line bg-surface2/70 p-2.5 text-sm font-mono min-h-[80px]" value={fixSn[i] ?? ""} onChange={(e) => setFixSn((s) => ({ ...s, [i]: e.target.value }))} />
              </label>
            ))}
            <label className="block">
              <span className="text-xs text-muted">เหตุผลการแก้ (บันทึกในประวัติ SN ของบิล)</span>
              <textarea className="mt-1.5 w-full rounded-xl border border-line bg-surface2/70 p-2.5 text-sm min-h-[60px]" value={fixReason} onChange={(e) => setFixReason(e.target.value)} placeholder="เช่น สแกน SN ผิดตัวตอนขาย ตรวจกล่องจริงแล้ว" />
            </label>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
