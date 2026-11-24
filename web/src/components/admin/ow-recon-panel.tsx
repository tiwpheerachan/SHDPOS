"use client";
// ตรวจความตรงกัน POS ↔ คลังกลาง (OneWarehouse) ↔ JST — เทียบรายช่อง + เก็บผลทุกรอบเป็นประวัติ
import { Fragment, useEffect, useMemo, useState } from "react";
import { ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, Clock3, ChevronDown, ChevronRight, Receipt, ArrowLeftRight, Boxes } from "lucide-react";
import { Button } from "@/components/ui";

type Diff = { field: string; pos: unknown; ow: unknown; jst?: unknown; ok: boolean; note?: string };
type Row = { kind: "sale" | "transfer" | "stock"; ref: string; branch_id: string | null; status: "match" | "mismatch" | "pending" | "info"; summary: string; diffs: Diff[]; times: Record<string, string | number | null> };
type Data = { run_id: string | null; checked_at: string | null; rows: Row[]; runs: { run_id: string; checked_at: string }[] };

const KIND = { sale: { label: "บิลขาย", icon: Receipt }, transfer: { label: "ใบโอน", icon: ArrowLeftRight }, stock: { label: "สต๊อก", icon: Boxes } } as const;
const ST = {
  match: { label: "ตรงกัน", cls: "bg-ok/12 text-ok" }, mismatch: { label: "ไม่ตรง", cls: "bg-danger/12 text-danger" },
  pending: { label: "รอผล", cls: "bg-warn/12 text-warn" }, info: { label: "ข้อมูล", cls: "bg-sky-500/10 text-sky-600" },
} as const;
const TIME_LABEL: Record<string, string> = {
  pos_sale_at: "ขายใน POS", ow_order_time: "เวลาขายที่ OW เก็บ", ow_created_at: "OW รับบิล", jst_submitted_at: "ส่งเข้า JST",
  lag_pos_to_ow_sec: "POS → OW (วินาที)", lag_pos_to_jst_sec: "POS → JST (วินาที)",
  pos_created_at: "สร้างใบใน POS", pos_packed_at: "สแกนออก (POS)", pos_shipped_at: "ส่งมอบ (POS)", ow_dispatch_at: "ส่งออก (OW)",
  jst_dispatch_sync_at: "JST ส่งออกสำเร็จ", pos_received_at: "รับครบ (POS)", ow_receive_at: "รับเข้า (OW)", jst_confirm_in_at: "JST รับเข้าสำเร็จ", ow_closed_at: "ปิดใบ (OW)",
};
const isIso = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const fmt = (v: unknown) => {
  if (v == null || v === "") return "—";
  if (isIso(v)) return new Date(v as string).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

export function OwReconPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"all" | Row["kind"]>("all"), [only, setOnly] = useState<"all" | "problem">("all");
  const [open, setOpen] = useState<string | null>(null);
  async function load(run?: string) {
    try {
      const r = await fetch(`/api/admin/ow-recon${run ? `?run_id=${run}` : ""}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "อ่านผลตรวจไม่สำเร็จ"); }
  }
  async function run() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/ow-recon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); await load(j.run_id);
    } catch (e) { setError(e instanceof Error ? e.message : "ตรวจไม่สำเร็จ"); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const rows = data?.rows ?? [];
  const count = (k: Row["kind"], s: Row["status"]) => rows.filter((r) => r.kind === k && r.status === s).length;
  const shown = useMemo(() => rows.filter((r) => (kind === "all" || r.kind === kind) && (only === "all" || r.status === "mismatch" || r.status === "pending")), [rows, kind, only]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line/70 bg-surface p-4 flex flex-wrap items-center gap-3">
        <ShieldCheck size={18} className="text-brand" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">ตรวจความตรงกัน ระบบเรา ↔ คลังกลาง ↔ JST</p>
          <p className="text-[11px] text-muted">เทียบรายช่อง (เลขอ้างอิง · ยอด · สินค้า · SN · การชำระ · เวลา · สถานะ) และเก็บผลทุกรอบเป็นหลักฐาน</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data?.runs?.length ? (
            <select value={data.run_id ?? ""} onChange={(e) => void load(e.target.value)} className="h-9 px-2 rounded-xl border border-line bg-surface2/70 text-xs">
              {data.runs.map((r) => <option key={r.run_id} value={r.run_id}>รอบ {fmt(r.checked_at)}</option>)}
            </select>
          ) : null}
          <Button variant="primary" loading={busy} onClick={() => void run()}><RefreshCw size={14} />ตรวจตอนนี้</Button>
        </div>
      </section>
      {error ? <p role="alert" className="rounded-xl px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(KIND) as Row["kind"][]).map((k) => {
          const Icon = KIND[k].icon, mis = count(k, "mismatch"), pen = count(k, "pending"), ok = count(k, "match");
          return (
            <button key={k} onClick={() => setKind(kind === k ? "all" : k)} className={`text-left rounded-2xl border p-4 bg-surface transition ${kind === k ? "border-brand ring-2 ring-brand/15" : "border-line/70"}`}>
              <div className="flex items-center justify-between"><p className="text-[11px] text-muted inline-flex items-center gap-1.5"><Icon size={13} />{KIND[k].label}</p>
                {mis ? <AlertTriangle size={14} className="text-danger" /> : pen ? <Clock3 size={14} className="text-warn" /> : <CheckCircle2 size={14} className="text-ok" />}</div>
              <p className="text-2xl font-semibold tnum mt-1">{ok}<span className="text-sm text-muted font-normal"> / {ok + mis + pen} ตรงกัน</span></p>
              <p className="text-[11px] mt-0.5">{mis ? <span className="text-danger">ไม่ตรง {mis}</span> : null}{mis && pen ? " · " : ""}{pen ? <span className="text-warn">รอผล {pen}</span> : null}{!mis && !pen ? <span className="text-muted">ไม่มีปัญหา</span> : null}</p>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <div className="flex rounded-xl bg-surface2/70 p-0.5">
            {([["all", "ทั้งหมด"], ["problem", "เฉพาะไม่ตรง/รอผล"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setOnly(k)} className={`h-8 px-3 rounded-lg text-xs ${only === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-muted">{data?.checked_at ? `ตรวจล่าสุด ${fmt(data.checked_at)}` : "ยังไม่เคยตรวจ — กด ตรวจตอนนี้"} · {shown.length} รายการ</span>
        </div>
        <div className="max-h-[calc(100vh-380px)] min-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0 z-10"><tr>
              {["", "ประเภท", "เลขอ้างอิง", "ผล", "สรุป"].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {shown.map((r) => {
                const key = `${r.kind}:${r.ref}`, isOpen = open === key, canOpen = r.diffs.length > 0 || Object.keys(r.times ?? {}).length > 0;
                return (
                  <Fragment key={key}>
                    <tr className={`hover:bg-surface2/40 ${canOpen ? "cursor-pointer" : ""}`} onClick={() => canOpen && setOpen(isOpen ? null : key)}>
                      <td className="pl-3 w-6 text-muted">{canOpen ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{KIND[r.kind].label}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{r.ref}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${ST[r.status].cls}`}>{ST[r.status].label}</span></td>
                      <td className="px-3 py-2 max-w-[520px]"><p className="truncate" title={r.summary}>{r.summary}</p></td>
                    </tr>
                    {isOpen ? (
                      <tr><td colSpan={5} className="bg-surface2/40 px-4 py-3">
                        {r.diffs.length ? (
                          <table className="w-full text-[11px] rounded-xl overflow-hidden bg-surface">
                            <thead className="text-muted"><tr>{["รายการ", "ระบบเรา (POS)", "คลังกลาง (OW)", "JST", ""].map((h) => <th key={h} className="text-left font-medium px-2.5 py-1.5">{h}</th>)}</tr></thead>
                            <tbody className="divide-y divide-line/50">
                              {r.diffs.map((d, i) => (
                                <tr key={i} className={d.ok ? "" : "bg-danger/5"}>
                                  <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">{d.field}{d.note ? <p className="text-[10px] text-muted font-normal max-w-[260px] whitespace-normal">{d.note}</p> : null}</td>
                                  <td className="px-2.5 py-1.5 font-mono break-all">{fmt(d.pos)}</td>
                                  <td className="px-2.5 py-1.5 font-mono break-all">{fmt(d.ow)}</td>
                                  <td className="px-2.5 py-1.5 font-mono break-all">{d.jst === undefined ? "—" : fmt(d.jst)}</td>
                                  <td className="px-2.5 py-1.5">{d.ok ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-danger" />}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : null}
                        {Object.keys(r.times ?? {}).length ? (
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                            {Object.entries(r.times).map(([k, v]) => (
                              <div key={k} className="rounded-lg bg-surface px-2.5 py-1.5">
                                <p className="text-[10px] text-muted">{TIME_LABEL[k] ?? k}</p>
                                <p className="font-mono text-[11px]">{fmt(v)}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </td></tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!shown.length ? <p className="text-center text-xs text-muted py-12">{data ? (rows.length ? "ไม่มีรายการที่ตรงตัวกรอง" : "ยังไม่มีผลตรวจ") : "กำลังโหลด…"}</p> : null}
        </div>
      </section>
    </div>
  );
}
