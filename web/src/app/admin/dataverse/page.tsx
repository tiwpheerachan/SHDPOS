"use client";
// =====================================================================
// หลังบ้าน → เชื่อมระบบ → ยอดขายระบบเดิม (Lark ผ่าน Dataverse)
//   ดึงย้อนหลังทีละเดือน · อัปเดตอัตโนมัติ (เดือนนี้ 15 นาที, เดือนก่อนทุกชั่วโมง) · จับคู่ร้าน → สาขา · วันเริ่มใช้ POS (กันยอดซ้ำ)
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, RefreshCw, Loader2, CheckCircle2, AlertCircle, History } from "lucide-react";
import { Button, Card, Select, Input } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB, formatInt } from "@/lib/money";
import { SourceTag } from "@/components/admin/sales-sheet";

type Month = { ym: string; lines: number; bills: number; amount: number; unmapped_lines: number; synced_at: string | null };
type Place = { place_key: string; dv_place_id: string | null; place_name: string | null; channel: string; brand_ids: string[]; branch_id: string | null; matched_by: "none" | "auto" | "manual"; score: number | null; lines: number; last_sale: string | null };
type Branch = { id: string; code: string; name: string; name_th: string | null; branch_type: string; pos_go_live_date: string | null };
type Run = { id: number; kind: string; date_from: string; date_to: string; fetched: number; upserted: number; removed: number; status: string; error: string | null; started_at: string; finished_at: string | null };
type Person = { name_key: string; sample_name: string; employee_id: string | null; matched_by: "none" | "auto" | "manual"; lines: number; last_sale: string | null };
type Emp = { id: string; employee_code: string | null; first_name: string | null; last_name: string | null; nickname: string | null; photo_url: string | null };
type Data = { ready: boolean; months: Month[]; places: Place[]; branches: Branch[]; runs: Run[]; people: Person[]; employees: Emp[] };

const FIRST = "2024-01"; // ข้อมูลระบบเดิมเริ่ม ม.ค. 2024
const monthsBetween = (a: string, b: string) => { const out: string[] = []; let [y, m] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number); while (y < by || (y === by && m <= bm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; };
const thisMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);

export default function DataversePage() {
  const { L, locale } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState("");
  const [job, setJob] = useState<{ list: string[]; done: number; current: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState(FIRST), [to, setTo] = useState(thisMonth());

  const load = useCallback(async () => {
    try { const r = await fetch("/api/admin/dataverse", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error); setD(j); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/admin/dataverse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }
  /** ดึงทีละเดือน (ทนเดือนที่ล้ม — ไปต่อเดือนถัดไป แล้วสรุปท้าย) */
  async function runMonths(list: string[], backfill: boolean) {
    setJob({ list, done: 0, current: list[0], errors: [] });
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setJob({ list, done: i, current: list[i], errors });
      try { await post({ action: "sync", month: list[i], backfill }); }
      catch (e) { errors.push(`${list[i]}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setJob(null);
    await load();
    toast.push(errors.length ? { tone: "warn", title: L(`ดึงเสร็จ แต่ล้ม ${errors.length} เดือน`, `Done with ${errors.length} failed month(s)`, `完成，${errors.length} 个月失败`), body: errors.slice(0, 3).join("\n") }
      : { tone: "ok", title: L(`ดึงข้อมูลครบ ${list.length} เดือน`, `Synced ${list.length} month(s)`, `已同步 ${list.length} 个月`) });
  }

  const totals = useMemo(() => (d?.months ?? []).reduce((s, m) => ({ lines: s.lines + m.lines, bills: s.bills + m.bills, amount: s.amount + Number(m.amount) }), { lines: 0, bills: 0, amount: 0 }), [d]);
  const branchName = (id: string | null) => { const b = d?.branches.find((x) => x.id === id); return b ? `${b.code} · ${b.name_th || b.name}` : "—"; };
  const mappedBranchIds = useMemo(() => new Set((d?.places ?? []).map((p) => p.branch_id).filter(Boolean) as string[]), [d]);
  const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");

  if (err) return <div className="p-4 sm:p-6"><p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p></div>;
  if (!d) return <div className="p-4 sm:p-6 h-60 grid place-items-center text-muted"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Database size={20} />{L("ยอดขายระบบเดิม", "Legacy sales", "旧系统销售")} <SourceTag source="lark" /></h1>
          <p className="text-xs text-muted mt-0.5">{L("ยอดขายหน้าร้านและอีเวนต์จากระบบเดิม (Lark) ผ่าน Dataverse — อ่านอย่างเดียว · อัปเดตอัตโนมัติ เดือนนี้ทุก 15 นาที · เดือนก่อนทุกชั่วโมง · หน้ายอดขายแสดงคู่กับ POS พร้อมป้ายแหล่งข้อมูล", "Store and event sales from the legacy system (Lark) via Dataverse — read only · this month refreshed every 15 min, last month hourly · shown alongside POS in Sales with a source tag", "来自旧系统 (Lark) 的门店与活动销售 — 只读 · 本月每 15 分钟更新，上月每小时· 在销售页与 POS 一起显示并标注来源")}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-lg border ${d.ready ? "border-line text-ink" : "border-danger/40 text-danger"}`}>
          {d.ready ? <CheckCircle2 size={14} className="text-ok" /> : <AlertCircle size={14} />}{d.ready ? L("เชื่อมต่อ Dataverse แล้ว", "Dataverse connected", "已连接 Dataverse") : L("ยังไม่ได้ตั้งค่า DATAVERSE_API_KEY บนเซิร์ฟเวอร์", "DATAVERSE_API_KEY not set on the server", "服务器未设置 DATAVERSE_API_KEY")}
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="p-4"><p className="text-xs text-muted">{L("ยอดขายที่ดึงมา", "Sales imported", "已导入销售额")}</p><p className="text-2xl font-semibold tnum">{formatTHB(totals.amount)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">{L("บิล", "Bills", "单据")}</p><p className="text-2xl font-semibold tnum">{formatInt(totals.bills)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">{L("บรรทัดสินค้า · เดือน", "Lines · months", "行 · 月份")}</p><p className="text-2xl font-semibold tnum">{formatInt(totals.lines)} <span className="text-sm text-muted">· {d.months.length}</span></p></Card>
      </div>

      {/* ดึงข้อมูล */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">{L("ตั้งแต่เดือน", "From", "从")}<Input type="month" value={from} min={FIRST} max={thisMonth()} onChange={(e) => setFrom(e.target.value)} className="mt-1 !h-9 w-40" /></label>
          <label className="text-xs text-muted">{L("ถึงเดือน", "To", "到")}<Input type="month" value={to} min={FIRST} max={thisMonth()} onChange={(e) => setTo(e.target.value)} className="mt-1 !h-9 w-40" /></label>
          <Button variant="primary" disabled={!d.ready || !!job || from > to} onClick={() => void runMonths(monthsBetween(from, to), true)}><History size={14} />{L(`ดึงย้อนหลัง ${monthsBetween(from, to).length} เดือน`, `Backfill ${monthsBetween(from, to).length} months`, `回填 ${monthsBetween(from, to).length} 个月`)}</Button>
          <Button variant="soft" disabled={!d.ready || !!job} onClick={() => void runMonths([thisMonth()], false)}><RefreshCw size={14} />{L("ดึงเดือนนี้ใหม่", "Refresh this month", "刷新本月")}</Button>
        </div>
        {job ? (
          <div className="space-y-1.5">
            <p className="text-xs">{L(`กำลังดึง ${job.current} (${job.done + 1}/${job.list.length}) — เปิดหน้านี้ค้างไว้จนเสร็จ`, `Syncing ${job.current} (${job.done + 1}/${job.list.length}) — keep this page open`, `正在同步 ${job.current}（${job.done + 1}/${job.list.length}）— 请保持页面打开`)}</p>
            <div className="h-2 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-ink transition-all" style={{ width: `${(job.done / job.list.length) * 100}%` }} /></div>
          </div>
        ) : null}
      </Card>

      {/* รายเดือน */}
      <Card className="overflow-auto">
        <div className="px-4 py-3 border-b border-line text-sm font-semibold">{L("ข้อมูลรายเดือน", "By month", "按月")}</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted"><tr className="border-b border-line">
            <th className="text-left font-medium px-4 py-2">{L("เดือน", "Month", "月份")}</th><th className="text-right font-medium px-3 py-2">{L("บิล", "Bills", "单据")}</th>
            <th className="text-right font-medium px-3 py-2">{L("บรรทัด", "Lines", "行")}</th><th className="text-right font-medium px-3 py-2">{L("ยอดขาย", "Sales", "销售额")}</th>
            <th className="text-right font-medium px-3 py-2">{L("ยังไม่จับคู่สาขา", "Unmapped lines", "未匹配门店")}</th><th className="text-left font-medium px-3 py-2">{L("อัปเดตล่าสุด", "Last synced", "最后同步")}</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {d.months.map((m) => (
              <tr key={m.ym} className="border-b border-line/60">
                <td className="px-4 py-2 font-medium tnum">{m.ym}</td><td className="px-3 py-2 text-right tnum">{formatInt(m.bills)}</td><td className="px-3 py-2 text-right tnum">{formatInt(m.lines)}</td>
                <td className="px-3 py-2 text-right tnum">{formatTHB(Number(m.amount))}</td><td className="px-3 py-2 text-right tnum text-muted">{m.unmapped_lines ? formatInt(m.unmapped_lines) : "—"}</td>
                <td className="px-3 py-2 text-xs text-muted">{fmtTime(m.synced_at)}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" disabled={!d.ready || !!job} onClick={() => void runMonths([m.ym], false)}><RefreshCw size={13} />{L("ดึงใหม่", "Refresh", "刷新")}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d.months.length ? <p className="text-center text-sm text-muted py-8">{L("ยังไม่มีข้อมูล — กด “ดึงย้อนหลัง”", "No data yet — run a backfill", "暂无数据 — 请回填")}</p> : null}
      </Card>

      {/* จับคู่ร้าน */}
      <Card className="overflow-auto">
        <div className="px-4 py-3 border-b border-line">
          <p className="text-sm font-semibold">{L("ร้าน/อีเวนต์ในระบบเดิม → สาขาในระบบเรา", "Legacy stores/events → our branches", "旧系统门店/活动 → 本系统门店")}</p>
          <p className="text-xs text-muted">{L("จับคู่อัตโนมัติจากชื่อร้าน · แก้เองได้ (ระบบจะไม่ทับ) · ร้านที่ไม่จับคู่ยังแสดงในหน้ายอดขายด้วยชื่อเดิม (เห็นเฉพาะผู้ดูทั้งบริษัท)", "Auto-matched by name · editable (won't be overwritten) · unmatched ones still show in Sales by their legacy name (company-wide viewers only)", "按名称自动匹配 · 可手动修改 · 未匹配的仍以原名显示")}</p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted"><tr className="border-b border-line">
            <th className="text-left font-medium px-4 py-2">{L("ชื่อในระบบเดิม", "Legacy name", "旧系统名称")}</th><th className="text-left font-medium px-3 py-2">{L("ประเภท", "Type", "类型")}</th>
            <th className="text-right font-medium px-3 py-2">{L("บรรทัด", "Lines", "行")}</th><th className="text-left font-medium px-3 py-2">{L("ขายล่าสุด", "Last sale", "最近销售")}</th>
            <th className="text-left font-medium px-3 py-2 min-w-[260px]">{L("สาขาในระบบเรา", "Our branch", "本系统门店")}</th><th className="text-left font-medium px-3 py-2">{L("จับคู่โดย", "Matched by", "匹配方式")}</th>
          </tr></thead>
          <tbody>
            {d.places.map((p) => (
              <tr key={p.place_key} className="border-b border-line/60">
                <td className="px-4 py-2"><span className="block font-medium" translate="no">{p.place_name || "—"}</span>{p.brand_ids.length ? <span className="text-[11px] text-muted" translate="no">{p.brand_ids.join(", ")}</span> : null}</td>
                <td className="px-3 py-2 text-xs">{p.channel === "event" ? L("อีเวนต์", "Event", "活动") : L("หน้าร้าน", "Store", "门店")}</td>
                <td className="px-3 py-2 text-right tnum">{formatInt(p.lines)}</td><td className="px-3 py-2 text-xs tnum">{p.last_sale ?? "—"}</td>
                <td className="px-3 py-2">
                  <Select value={p.branch_id ?? ""} disabled={busy === p.place_key} className="!h-8 text-xs" onChange={async (e) => {
                    setBusy(p.place_key);
                    try { await post({ action: "map", place_key: p.place_key, branch_id: e.target.value || null }); await load(); } catch (x) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: x instanceof Error ? x.message : String(x) }); }
                    finally { setBusy(null); }
                  }}>
                    <option value="">{p.channel === "event" ? L("— อีเวนต์ (ไม่ผูกสาขา) —", "— Event (no branch) —", "— 活动（不绑定门店）—") : L("— ยังไม่จับคู่ —", "— Not matched —", "— 未匹配 —")}</option>
                    {d.branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_th || b.name}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2 text-xs">{p.matched_by === "manual" ? L("แก้เอง", "Manual", "手动") : p.matched_by === "auto" ? `${L("อัตโนมัติ", "Auto", "自动")}${p.score != null && p.score < 1 ? ` (${Math.round(p.score * 100)}%)` : ""}` : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* พนักงานขาย (ชื่อพิมพ์เองใน Lark) → พนักงานในระบบ */}
      <PeopleMap d={d} busy={busy} onMap={async (p, eid) => {
        setBusy(p.name_key);
        try { await post({ action: "person_map", name_key: p.name_key, employee_id: eid }); await load(); }
        catch (x) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: x instanceof Error ? x.message : String(x) }); }
        finally { setBusy(null); }
      }} />

      {/* วันเริ่มใช้ POS */}
      <Card className="overflow-auto">
        <div className="px-4 py-3 border-b border-line">
          <p className="text-sm font-semibold">{L("วันเริ่มใช้ POS (กันยอดซ้ำ)", "POS go-live date (no double counting)", "POS 上线日期（防重复计算）")}</p>
          <p className="text-xs text-muted">{L("ระหว่างที่ใช้สองระบบคู่กัน ตั้งวันเริ่มใช้ POS ของสาขา — ตั้งแต่วันนั้นหน้ายอดขายนับยอดจาก POS และไม่นับยอด Lark ของสาขานั้น (ข้อมูล Lark ยังเก็บไว้ครบ) · ว่าง = ยังนับ Lark", "While both systems run, set each branch's POS go-live — from that day Sales counts POS and skips that branch's Lark sales (Lark data is kept) · blank = still count Lark", "两系统并行期间，设置门店 POS 上线日 — 当天起销售页按 POS 计算，不计该门店 Lark 数据（数据仍保留）· 留空 = 仍计 Lark")}</p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted"><tr className="border-b border-line">
            <th className="text-left font-medium px-4 py-2">{L("สาขา", "Branch", "门店")}</th><th className="text-left font-medium px-3 py-2">{L("วันเริ่มใช้ POS", "POS go-live", "POS 上线日")}</th><th className="text-left font-medium px-3 py-2">{L("ยอดที่นับในหน้ายอดขาย", "Counted in Sales", "销售页计入")}</th>
          </tr></thead>
          <tbody>
            {d.branches.filter((b) => mappedBranchIds.has(b.id) || b.pos_go_live_date).map((b) => (
              <tr key={b.id} className="border-b border-line/60">
                <td className="px-4 py-2" translate="no">{branchName(b.id)}</td>
                <td className="px-3 py-2"><Input type="date" defaultValue={b.pos_go_live_date ?? ""} className="!h-8 text-xs w-44" disabled={busy === b.id}
                  onBlur={async (e) => { const v = e.target.value || null; if (v === (b.pos_go_live_date ?? null)) return; setBusy(b.id);
                    try { await post({ action: "go_live", branch_id: b.id, date: v }); await load(); toast.push({ tone: "ok", title: L("บันทึกแล้ว", "Saved", "已保存") }); } catch (x) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: x instanceof Error ? x.message : String(x) }); } finally { setBusy(null); } }} /></td>
                <td className="px-3 py-2 text-xs">{b.pos_go_live_date
                  ? <span className="inline-flex items-center gap-1.5 flex-wrap"><SourceTag source="lark" />{L(`ก่อน ${b.pos_go_live_date}`, `before ${b.pos_go_live_date}`, `${b.pos_go_live_date} 之前`)} · <SourceTag source="pos" />{L("ตั้งแต่วันนั้น", "from then on", "此后")}</span>
                  : <span className="inline-flex items-center gap-1.5"><SourceTag source="lark" /><SourceTag source="pos" />{L("ทั้งสองระบบ", "both", "两者")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ประวัติการดึง */}
      <Card className="overflow-auto">
        <div className="px-4 py-3 border-b border-line text-sm font-semibold">{L("ประวัติการดึงข้อมูล", "Sync log", "同步记录")}</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted"><tr className="border-b border-line">
            <th className="text-left font-medium px-4 py-2">{L("เวลา", "Time", "时间")}</th><th className="text-left font-medium px-3 py-2">{L("ช่วง", "Range", "范围")}</th><th className="text-left font-medium px-3 py-2">{L("แบบ", "Kind", "方式")}</th>
            <th className="text-right font-medium px-3 py-2">{L("ดึงมา", "Fetched", "获取")}</th><th className="text-right font-medium px-3 py-2">{L("ลบออก", "Removed", "删除")}</th><th className="text-left font-medium px-3 py-2">{L("ผล", "Result", "结果")}</th>
          </tr></thead>
          <tbody>
            {d.runs.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="px-4 py-2 text-xs">{fmtTime(r.started_at)}</td><td className="px-3 py-2 text-xs tnum">{r.date_from} → {r.date_to}</td>
                <td className="px-3 py-2 text-xs">{r.kind === "auto" ? L("อัตโนมัติ", "Auto", "自动") : r.kind === "backfill" ? L("ย้อนหลัง", "Backfill", "回填") : L("กดเอง", "Manual", "手动")}</td>
                <td className="px-3 py-2 text-right tnum">{formatInt(r.fetched)}</td><td className="px-3 py-2 text-right tnum">{formatInt(r.removed)}</td>
                <td className="px-3 py-2 text-xs">{r.status === "ok" ? <span className="text-ok">{L("สำเร็จ", "OK", "成功")}</span> : r.status === "running" ? L("กำลังดึง", "Running", "进行中") : <span className="text-danger" title={r.error ?? ""}>{L("ล้มเหลว", "Failed", "失败")}{r.error ? ` — ${r.error.slice(0, 80)}` : ""}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PeopleMap({ d, busy, onMap }: { d: Data; busy: string | null; onMap: (p: Person, eid: string | null) => void }) {
  const { L } = useI18n();
  const [q, setQ] = useState(""), [only, setOnly] = useState<"all" | "none">("all");
  const empName = (e: Emp) => [e.nickname ? `${e.nickname} ·` : "", e.first_name, e.last_name].filter(Boolean).join(" ");
  const list = d.people.filter((p) => (only === "none" ? !p.employee_id : true) && (!q || p.sample_name.toLowerCase().includes(q.toLowerCase())));
  const matched = d.people.filter((p) => p.employee_id).length;
  return (
    <Card className="overflow-auto">
      <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[240px]">
          <p className="text-sm font-semibold">{L("พนักงานขายใน Lark → พนักงานในระบบ", "Lark salespeople → our staff", "Lark 销售员 → 本系统员工")}</p>
          <p className="text-xs text-muted">{L(`ระบบเดิมส่งมาเป็นชื่อที่พิมพ์เอง — จับคู่อัตโนมัติเมื่อชัดเจน 1 คน (ชื่อเล่น/ชื่อ/ชื่ออีเมล) แก้เองได้ · ที่ยังไม่จับคู่ยังแสดงชื่อตาม Lark ในหน้ายอดขาย · จับคู่แล้ว ${matched}/${d.people.length} ชื่อ`, `Free-text names from Lark — auto-matched when unambiguous, editable · unmatched names still show as typed · matched ${matched}/${d.people.length}`, `旧系统为手填姓名 — 唯一时自动匹配，可手动修改 · 已匹配 ${matched}/${d.people.length}`)}</p>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาชื่อ", "Search name", "搜索姓名")} className="!h-8 w-44 text-xs" />
        <Select value={only} onChange={(e) => setOnly(e.target.value as "all" | "none")} className="!h-8 text-xs w-40">
          <option value="all">{L("ทุกชื่อ", "All names", "全部")}</option>
          <option value="none">{L("เฉพาะที่ยังไม่จับคู่", "Unmatched only", "仅未匹配")}</option>
        </Select>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[11px] text-muted"><tr className="border-b border-line">
          <th className="text-left font-medium px-4 py-2">{L("ชื่อใน Lark", "Name in Lark", "Lark 中姓名")}</th><th className="text-right font-medium px-3 py-2">{L("บรรทัด", "Lines", "行")}</th>
          <th className="text-left font-medium px-3 py-2">{L("ขายล่าสุด", "Last sale", "最近销售")}</th><th className="text-left font-medium px-3 py-2 min-w-[260px]">{L("พนักงานในระบบ", "Our staff", "本系统员工")}</th>
          <th className="text-left font-medium px-3 py-2">{L("จับคู่โดย", "Matched by", "匹配方式")}</th>
        </tr></thead>
        <tbody>
          {list.slice(0, 300).map((p) => (
            <tr key={p.name_key} className="border-b border-line/60">
              <td className="px-4 py-2" translate="no">{p.sample_name}</td>
              <td className="px-3 py-2 text-right tnum">{formatInt(p.lines)}</td>
              <td className="px-3 py-2 text-xs tnum">{p.last_sale ?? "—"}</td>
              <td className="px-3 py-2">
                <Select value={p.employee_id ?? ""} disabled={busy === p.name_key} className="!h-8 text-xs" onChange={(e) => onMap(p, e.target.value || null)}>
                  <option value="">{L("— ยังไม่จับคู่ (แสดงชื่อตาม Lark) —", "— Not matched (show Lark name) —", "— 未匹配（显示 Lark 名称）—")}</option>
                  {d.employees.map((e) => <option key={e.id} value={e.id}>{empName(e)}{e.employee_code ? ` (${e.employee_code})` : ""}</option>)}
                </Select>
              </td>
              <td className="px-3 py-2 text-xs">{p.matched_by === "manual" ? L("แก้เอง", "Manual", "手动") : p.matched_by === "auto" ? L("อัตโนมัติ", "Auto", "自动") : <span className="text-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length ? <p className="text-center text-sm text-muted py-8">{L("ยังไม่มีชื่อพนักงานขาย — กดดึงข้อมูลใหม่", "No salesperson names yet — refresh data", "暂无销售员 — 请刷新数据")}</p> : null}
      {list.length > 300 ? <p className="text-center text-xs text-muted py-2">{L("แสดง 300 ชื่อแรก — ค้นหาเพื่อดูเพิ่ม", "Showing first 300 — search to narrow", "显示前 300 个 — 请搜索")}</p> : null}
    </Card>
  );
}
