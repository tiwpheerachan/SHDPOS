"use client";
// ตรวจความตรงกัน POS ↔ คลังกลาง (OneWarehouse) ↔ JST — เทียบรายช่อง + เก็บผลทุกรอบเป็นประวัติ
import { Fragment, useEffect, useMemo, useState } from "react";
import { ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, Clock3, ChevronDown, ChevronRight, Receipt, ArrowLeftRight, Boxes } from "lucide-react";
import { Button } from "@/components/ui";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

type Diff = { field: string; pos: unknown; ow: unknown; jst?: unknown; ok: boolean; note?: string };
type Row = { kind: "sale" | "transfer" | "stock"; ref: string; branch_id: string | null; status: "match" | "mismatch" | "pending" | "info"; summary: string; diffs: Diff[]; times: Record<string, string | number | null> };
type Data = { run_id: string | null; checked_at: string | null; rows: Row[]; runs: { run_id: string; checked_at: string }[] };

const KIND = { sale: { get label() { return tr("บิลขาย", "Sales bill", "销售单"); }, icon: Receipt }, transfer: { get label() { return tr("ใบโอน", "Transfer", "调拨单"); }, icon: ArrowLeftRight }, stock: { get label() { return tr("สต๊อก", "Stock", "库存"); }, icon: Boxes } };
const ST = {
  match: { get label() { return tr("ตรงกัน", "Match", "一致"); }, cls: "bg-ok/12 text-ok" }, mismatch: { get label() { return tr("ไม่ตรง", "Mismatch", "不一致"); }, cls: "bg-danger/12 text-danger" },
  pending: { get label() { return tr("รอผล", "Pending", "待定"); }, cls: "bg-warn/12 text-warn" }, info: { get label() { return tr("ข้อมูล", "Info", "信息"); }, cls: "bg-sky-500/10 text-sky-600" },
};
const TIME_LABEL = (): Record<string, string> => ({
  pos_sale_at: tr("ขายใน POS", "Sold in POS", "POS 销售"), ow_order_time: tr("เวลาขายที่ OW เก็บ", "Sale time stored by OW", "OW 记录的销售时间"), ow_created_at: tr("OW รับบิล", "OW received bill", "OW 接收单据"), jst_submitted_at: tr("ส่งเข้า JST", "Sent to JST", "提交至 JST"),
  lag_pos_to_ow_sec: tr("POS → OW (วินาที)", "POS → OW (sec)", "POS → OW（秒）"), lag_pos_to_jst_sec: tr("POS → JST (วินาที)", "POS → JST (sec)", "POS → JST（秒）"),
  pos_created_at: tr("สร้างใบใน POS", "Created in POS", "POS 创建单据"), pos_packed_at: tr("สแกนออก (POS)", "Scanned out (POS)", "扫描出库（POS）"), pos_shipped_at: tr("ส่งมอบ (POS)", "Handed over (POS)", "交付（POS）"), ow_dispatch_at: tr("ส่งออก (OW)", "Dispatched (OW)", "出库（OW）"),
  jst_dispatch_sync_at: tr("JST ส่งออกสำเร็จ", "JST dispatch synced", "JST 出库成功"), pos_received_at: tr("รับครบ (POS)", "Fully received (POS)", "全部收货（POS）"), ow_receive_at: tr("รับเข้า (OW)", "Received (OW)", "入库（OW）"), jst_confirm_in_at: tr("JST รับเข้าสำเร็จ", "JST receipt confirmed", "JST 入库成功"), ow_closed_at: tr("ปิดใบ (OW)", "Closed (OW)", "关闭单据（OW）"),
});
const isIso = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const fmt = (v: unknown) => {
  if (v == null || v === "") return "—";
  if (isIso(v)) return new Date(v as string).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

export function OwReconPanel() {
  const L = useL();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"all" | Row["kind"]>("all"), [only, setOnly] = useState<"all" | "problem">("all");
  const [open, setOpen] = useState<string | null>(null);
  async function load(run?: string) {
    try {
      const r = await fetch(`/api/admin/ow-recon${run ? `?run_id=${run}` : ""}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : L("อ่านผลตรวจไม่สำเร็จ", "Couldn't load results", "读取核对结果失败")); }
  }
  async function run() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/ow-recon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); await load(j.run_id);
    } catch (e) { setError(e instanceof Error ? e.message : L("ตรวจไม่สำเร็จ", "Check failed", "核对失败")); } finally { setBusy(false); }
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
          <p className="text-sm font-semibold">{L("ตรวจความตรงกัน ระบบเรา ↔ คลังกลาง ↔ JST", "Reconcile POS ↔ central warehouse ↔ JST", "核对 POS ↔ 中央仓库 ↔ JST")}</p>
          <p className="text-[11px] text-muted">{L("เทียบรายช่อง (เลขอ้างอิง · ยอด · สินค้า · SN · การชำระ · เวลา · สถานะ) และเก็บผลทุกรอบเป็นหลักฐาน", "Field-by-field comparison (reference · amount · products · SN · payment · time · status), every run kept as evidence", "逐字段比对（参考号 · 金额 · 商品 · SN · 付款 · 时间 · 状态），每轮结果留存为凭证")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data?.runs?.length ? (
            <select value={data.run_id ?? ""} onChange={(e) => void load(e.target.value)} className="h-9 px-2 rounded-xl border border-line bg-surface2/70 text-xs">
              {data.runs.map((r) => <option key={r.run_id} value={r.run_id}>{L("รอบ", "Run", "轮次")} {fmt(r.checked_at)}</option>)}
            </select>
          ) : null}
          <Button variant="primary" loading={busy} onClick={() => void run()}><RefreshCw size={14} />{L("ตรวจตอนนี้", "Check now", "立即核对")}</Button>
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
              <p className="text-2xl font-semibold tnum mt-1">{ok}<span className="text-sm text-muted font-normal"> / {ok + mis + pen} {L("ตรงกัน", "match", "一致")}</span></p>
              <p className="text-[11px] mt-0.5">{mis ? <span className="text-danger">{L("ไม่ตรง", "Mismatch", "不一致")} {mis}</span> : null}{mis && pen ? " · " : ""}{pen ? <span className="text-warn">{L("รอผล", "Pending", "待定")} {pen}</span> : null}{!mis && !pen ? <span className="text-muted">{L("ไม่มีปัญหา", "No issues", "无问题")}</span> : null}</p>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <div className="flex rounded-xl bg-surface2/70 p-0.5">
            {([["all", L("ทั้งหมด", "All", "全部")], ["problem", L("เฉพาะไม่ตรง/รอผล", "Mismatch/pending only", "仅不一致/待定")]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setOnly(k)} className={`h-8 px-3 rounded-lg text-xs ${only === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-muted">{data?.checked_at ? L(`ตรวจล่าสุด ${fmt(data.checked_at)}`, `Last checked ${fmt(data.checked_at)}`, `最近核对 ${fmt(data.checked_at)}`) : L("ยังไม่เคยตรวจ — กด ตรวจตอนนี้", "Never checked — press Check now", "尚未核对 — 点击立即核对")} · {L(`${shown.length} รายการ`, `${shown.length} items`, `${shown.length} 项`)}</span>
        </div>
        <div className="max-h-[calc(100vh-380px)] min-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0 z-10"><tr>
              {["", L("ประเภท", "Type", "类型"), L("เลขอ้างอิง", "Reference", "参考号"), L("ผล", "Result", "结果"), L("สรุป", "Summary", "摘要")].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {shown.map((r) => {
                const key = `${r.kind}:${r.ref}`, isOpen = open === key, canOpen = r.diffs.length > 0 || Object.keys(r.times ?? {}).length > 0;
                return (
                  <Fragment key={key}>
                    <tr className={`hover:bg-surface2/40 ${canOpen ? "cursor-pointer" : ""}`} onClick={() => canOpen && setOpen(isOpen ? null : key)}>
                      <td className="pl-3 w-6 text-muted">{canOpen ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{KIND[r.kind].label}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap" translate="no">{r.ref}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${ST[r.status].cls}`}>{ST[r.status].label}</span></td>
                      <td className="px-3 py-2 max-w-[520px]"><p className="truncate" title={r.summary}>{r.summary}</p></td>
                    </tr>
                    {isOpen ? (
                      <tr><td colSpan={5} className="bg-surface2/40 px-4 py-3">
                        {r.diffs.length ? (
                          <table className="w-full text-[11px] rounded-xl overflow-hidden bg-surface">
                            <thead className="text-muted"><tr>{[L("รายการ", "Field", "项目"), L("ระบบเรา (POS)", "Ours (POS)", "我方（POS）"), L("คลังกลาง (OW)", "Central (OW)", "中央仓（OW）"), "JST", ""].map((h) => <th key={h} className="text-left font-medium px-2.5 py-1.5">{h}</th>)}</tr></thead>
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
                                <p className="text-[10px] text-muted">{TIME_LABEL()[k] ?? k}</p>
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
          {!shown.length ? <p className="text-center text-xs text-muted py-12">{data ? (rows.length ? L("ไม่มีรายการที่ตรงตัวกรอง", "No items match the filter", "没有符合筛选的条目") : L("ยังไม่มีผลตรวจ", "No results yet", "暂无核对结果")) : L("กำลังโหลด…", "Loading…", "加载中…")}</p> : null}
        </div>
      </section>
    </div>
  );
}
