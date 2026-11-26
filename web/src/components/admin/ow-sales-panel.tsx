"use client";
// คิวส่งบิลขาย POS → OneWarehouse: สถานะทุกบิล · ส่งทันที · ลองใหม่ · แก้ SN ของบิล sn_pending (PATCH)
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Send, RotateCcw, ScanLine, CheckCircle2, AlertTriangle, Clock3, X } from "lucide-react";
import { Button, Badge, Drawer } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

interface Ev {
  id: string; state: string; reason: string | null; attempts: number; available_at: string; created_at: string;
  order_no: string | null; branch_id: string | null; grand_total: number | null;
  ow_sale_no: string | null; ow_status: string | null; jst_order_no: string | null;
  problems: { code: string; message: string }[]; lines: { sku: string; qty: number; serials?: string[] }[]; error: { code?: string; message?: string } | null;
}
const STATE: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "info" }> = {
  delivered: { get label() { return tr("ส่ง OW แล้ว", "Sent to OW", "已发送至 OW"); }, tone: "ok" }, queued: { get label() { return tr("รอส่ง", "Queued", "待发送"); }, tone: "info" }, processing: { get label() { return tr("กำลังส่ง", "Sending", "发送中"); }, tone: "info" },
  retry: { get label() { return tr("รอลองใหม่", "Retry pending", "待重试"); }, tone: "warn" }, blocked: { get label() { return tr("ติด (ต้องแก้)", "Blocked (needs fix)", "受阻（需处理）"); }, tone: "danger" }, dead: { get label() { return tr("ลองครบแล้ว", "Retries exhausted", "重试已用尽"); }, tone: "danger" },
};

export function OwSalesPanel() {
  const L = useL();
  const [data, setData] = useState<{ events: Ev[]; branches: { id: string; name: string; name_th: string | null }[] } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [filter, setFilter] = useState("all");
  const [fix, setFix] = useState<Ev | null>(null), [fixSn, setFixSn] = useState<Record<number, string>>({}), [fixReason, setFixReason] = useState("");
  async function load() {
    try { const r = await fetch("/api/admin/ow-outbox", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : L("อ่านคิวไม่สำเร็จ", "Couldn't load queue", "读取队列失败")); }
  }
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, []);
  async function post(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try { const r = await fetch("/api/admin/ow-outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw Error(j.error); await load(); return j; }
    catch (e) { setError(e instanceof Error ? e.message : L("ทำรายการไม่สำเร็จ", "Action failed", "操作失败")); return null; } finally { setBusy(false); }
  }
  const bn = useMemo(() => new Map((data?.branches ?? []).map((b) => [b.id, b.name_th || b.name])), [data]);
  const evs = data?.events ?? [];
  const count = (s: string) => evs.filter((e) => e.state === s).length;
  const shown = evs.filter((e) => filter === "all" || (filter === "problem" ? ["blocked", "dead", "retry"].includes(e.state) : e.state === filter));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([[L("ส่งสำเร็จ", "Delivered", "发送成功"), count("delivered"), CheckCircle2, "text-ok"], [L("รอส่ง", "Queued", "待发送"), count("queued") + count("processing"), Clock3, "text-sky-600"], [L("รอลองใหม่", "Retry pending", "待重试"), count("retry"), RotateCcw, "text-warn"], [L("ติด (ต้องแก้)", "Blocked (needs fix)", "受阻（需处理）"), count("blocked") + count("dead"), AlertTriangle, "text-danger"]] as const).map(([l, v, Icon, tone]) => (
          <div key={l} className="rounded-2xl border border-line/70 bg-surface p-4">
            <div className="flex items-center justify-between"><p className="text-[11px] text-muted">{l}</p><Icon size={14} className={tone} /></div>
            <p className={`text-2xl font-semibold tnum mt-1 ${v ? tone : ""}`}>{v}</p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <div className="flex rounded-xl bg-surface2/70 p-0.5">
            {([["all", L("ทั้งหมด", "All", "全部")], ["problem", L("มีปัญหา", "Problems", "有问题")], ["delivered", L("สำเร็จ", "Delivered", "成功")], ["queued", L("รอส่ง", "Queued", "待发送")]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`h-8 px-3 rounded-lg text-xs ${filter === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-muted">{L("ส่งอัตโนมัติทุกรอบ worker · บิลจากสาขาที่ยังไม่ผูกสาขาขาย OW จะติดไว้จนผูก", "Sent automatically every worker run · bills from branches without a linked OW sales branch stay blocked until linked", "每轮 worker 自动发送 · 未绑定 OW 销售门店的门店单据将受阻直至绑定")}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="soft" onClick={() => void load()}><RefreshCw size={14} />{L("โหลด", "Reload", "刷新")}</Button>
            <Button variant="primary" loading={busy} onClick={() => void post({ action: "process" })}><Send size={14} />{L("ส่งคิวตอนนี้", "Send queue now", "立即发送队列")}</Button>
          </div>
        </div>
        {error ? <p role="alert" className="px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}
        <div className="max-h-[calc(100vh-360px)] min-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0"><tr>
              {[L("บิล POS", "POS bill", "POS 单据"), L("สาขา", "Branch", "门店"), L("ยอด", "Total", "金额"), L("สถานะคิว", "Queue status", "队列状态"), "OW / JST", L("เหตุผล", "Reason", "原因"), ""].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {shown.map((e) => (
                <tr key={e.id} className="hover:bg-surface2/40">
                  <td className="px-3 py-2"><p className="font-mono" translate="no">{e.order_no ?? "—"}</p><p className="text-[10px] text-muted">{new Date(e.created_at).toLocaleString("th-TH")}</p></td>
                  <td className="px-3 py-2">{e.branch_id ? bn.get(e.branch_id) ?? "—" : "—"}</td>
                  <td className="px-3 py-2 tnum">{e.grand_total != null ? formatTHB(Number(e.grand_total)) : "—"}</td>
                  <td className="px-3 py-2"><Badge tone={STATE[e.state]?.tone ?? "neutral"}>{STATE[e.state]?.label ?? e.state}</Badge>{e.attempts > 1 ? <span className="ml-1 text-[10px] text-muted">×{e.attempts}</span> : null}</td>
                  <td className="px-3 py-2">
                    <p className="font-mono" translate="no">{e.ow_sale_no ?? "—"}</p>
                    {e.ow_status ? <span className={`text-[10px] px-1.5 py-0.5 rounded ${isOwSaleDone(e.ow_status) ? "bg-ok/12 text-ok" : e.ow_status === "sn_pending" ? "bg-warn/12 text-warn" : e.ow_status === "failed" ? "bg-danger/12 text-danger" : "bg-sky-500/10 text-sky-600"}`}>
                      {isOwSaleDone(e.ow_status) ? L("JST ยืนยันแล้ว", "JST confirmed", "JST 已确认") : e.ow_status === "sn_pending" ? L("รอแก้ SN", "SN fix needed", "待修正序列号") : e.ow_status === "submitted" ? L("OW รับแล้ว · รอ JST", "OW received · awaiting JST", "OW 已接收 · 等待 JST") : e.ow_status === "failed" ? L("JST ล้มเหลว", "JST failed", "JST 失败") : e.ow_status}
                    </span> : null}
                    {e.jst_order_no ? <p className="text-[10px] text-muted" translate="no">JST {e.jst_order_no}</p> : null}
                  </td>
                  <td className="px-3 py-2 max-w-[280px]"><p className="truncate" title={e.reason ?? ""}>{e.reason ?? "—"}</p></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {e.ow_status === "sn_pending" ? <Button variant="soft" onClick={() => { setFix(e); setFixReason(""); setFixSn(Object.fromEntries(e.lines.map((l, i) => [i, (l.serials ?? []).join("\n")]))); }}><ScanLine size={13} />{L("แก้ SN", "Fix SN", "修正序列号")}</Button> : null}
                    {["blocked", "dead", "retry"].includes(e.state) && e.ow_status !== "sn_pending" ? <Button variant="ghost" disabled={busy} onClick={() => void post({ action: "retry", id: e.id })}><RotateCcw size={13} />{L("ลองใหม่", "Retry", "重试")}</Button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length ? <p className="text-center text-xs text-muted py-12">{data ? L("ไม่มีรายการ", "No items", "无条目") : L("กำลังโหลด…", "Loading…", "加载中…")}</p> : null}
        </div>
      </section>

      <Drawer open={!!fix} onClose={() => setFix(null)} title={fix ? `${L("แก้ SN", "Fix SN", "修正序列号")} · ${fix.order_no ?? fix.ow_sale_no}` : ""} subtitle={L("บิลอยู่สถานะ sn_pending: OW ยังไม่ตัดสต๊อก/ไม่เปิดบิล JST จนกว่าจะได้ SN ที่ถูก", "Bill is sn_pending: OW won't deduct stock or open a JST bill until correct SNs are provided", "单据处于 sn_pending：在提供正确序列号前，OW 不扣库存、不开 JST 单据")}
        footer={fix ? <><span className="flex-1" /><Button variant="ghost" onClick={() => setFix(null)}><X size={14} />{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} onClick={async () => {
          const serials = Object.fromEntries(Object.entries(fixSn).map(([k, v]) => [k, v.split(/[\s,]+/).filter(Boolean)]));
          const r = await post({ action: "patch-serials", id: fix.id, serials, reason: fixReason }); if (r?.ok) setFix(null);
        }}>{L("ส่งแก้ SN", "Submit SN fix", "提交序列号修正")}</Button></> : undefined}>
        {fix ? (
          <div className="p-5 space-y-4">
            {fix.problems.length ? <div className="rounded-xl bg-warn/10 text-warn text-xs p-3 space-y-1">{fix.problems.map((p, i) => <p key={i}>{p.message || p.code}</p>)}</div> : null}
            {error ? <p role="alert" className="text-xs text-danger bg-danger/5 rounded-lg p-2.5">{error}</p> : null}
            {fix.lines.map((l, i) => (
              <label key={i} className="block">
                <span className="text-xs text-muted">{L("บรรทัด", "Line", "行")} {i + 1} · <span translate="no">{l.sku}</span> · {L(`${l.qty} ชิ้น`, `${l.qty} pcs`, `${l.qty} 件`)}{(l as { isFreebie?: boolean }).isFreebie ? ` (${L("ของแถม", "freebie", "赠品")})` : ""} — {L(`ใส่ SN ${l.qty} ตัว คั่นด้วยบรรทัด/คอมมา`, `enter ${l.qty} SNs, separated by line/comma`, `填写 ${l.qty} 个序列号，以换行/逗号分隔`)}</span>
                <textarea className="mt-1.5 w-full rounded-xl border border-line bg-surface2/70 p-2.5 text-sm font-mono min-h-[80px]" value={fixSn[i] ?? ""} onChange={(e) => setFixSn((s) => ({ ...s, [i]: e.target.value }))} />
              </label>
            ))}
            <label className="block">
              <span className="text-xs text-muted">{L("เหตุผลการแก้ (บันทึกในประวัติ SN ของบิล)", "Reason for fix (logged in the bill's SN history)", "修正原因（记录在单据序列号历史中）")}</span>
              <textarea className="mt-1.5 w-full rounded-xl border border-line bg-surface2/70 p-2.5 text-sm min-h-[60px]" value={fixReason} onChange={(e) => setFixReason(e.target.value)} placeholder={L("เช่น สแกน SN ผิดตัวตอนขาย ตรวจกล่องจริงแล้ว", "e.g. wrong SN scanned at sale, checked the actual box", "例如：销售时扫错序列号，已核对实物包装")} />
            </label>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
