"use client";
// ข้อมูลต้นทาง OneWarehouse ที่เก็บใน POS — ซ้าย: สรุป + หมวดข้อมูล · ขวา: รายการของหมวดที่เลือก · คลิก = Drawer ดูข้อมูลจริง
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { CloudDownload, RefreshCw, Database, ChevronRight } from "lucide-react";
import { Card, Button, Drawer, Badge } from "@/components/ui";
import type { OwSnapshot, OwResource } from "@/lib/ow-sync/model";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

const names = (): Record<string, string> => ({ contract: tr("ข้อกำหนด API", "API spec", "API 规范"), warehouses: tr("คลัง", "Warehouses", "仓库"), carriers: tr("ขนส่ง", "Carriers", "物流"), inventory_raw: tr("สต๊อกไม่ระบุ SKU", "Stock without SKU", "未指定 SKU 的库存"), product_page: tr("รายการสินค้า", "Product list", "商品列表"), product: tr("รายละเอียดสินค้า", "Product details", "商品详情"), stock: tr("สต๊อกแยกคลัง", "Stock by warehouse", "按仓库库存"), dashboard: "Dashboard", transfer_page: tr("รายการใบโอน", "Transfer list", "调拨单列表"), transfer: tr("รายละเอียดใบโอน", "Transfer details", "调拨单详情"), timeline: tr("ประวัติใบโอน", "Transfer history", "调拨记录"), serial: "SN", bom: tr("ส่วนประกอบชุด", "Bundle components", "套装组成") });
const STATE: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = { ok: { get label() { return tr("ดึงสำเร็จ", "Fetched", "获取成功"); }, tone: "ok" }, empty: { get label() { return tr("ไม่มีรายการ", "No items", "无条目"); }, tone: "neutral" }, unavailable: { get label() { return tr("ยังอ่านไม่ได้", "Not readable yet", "暂无法读取"); }, tone: "warn" }, error: { get label() { return tr("อ่านล้มเหลว", "Read failed", "读取失败"); }, tone: "danger" } };

export function OwDataPanel() {
  const L = useL();
  const [snapshot, setSnapshot] = useState<OwSnapshot | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [kind, setKind] = useState("stock"), [selected, setSelected] = useState<OwResource | null>(null);
  async function load() {
    try {
      const response = await fetch("/api/admin/ow-data", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || tr("อ่านผลซิงก์ไม่สำเร็จ", "Couldn't load sync results", "读取同步结果失败"));
      setSnapshot(data.snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : tr("อ่านไม่สำเร็จ", "Load failed", "读取失败")); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30000); return () => clearInterval(timer); }, []);
  async function pull() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/ow-data", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || tr("ดึงข้อมูลไม่สำเร็จ", "Fetch failed", "获取数据失败"));
      setSnapshot(data.snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : tr("ดึงข้อมูลไม่สำเร็จ", "Fetch failed", "获取数据失败")); } finally { setBusy(false); }
  }
  const kinds = snapshot ? Object.entries(names()).filter(([k]) => snapshot.resources.some((r) => r.kind === k)) : [];
  const groups = snapshot?.resources.filter((r) => r.kind === kind) ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Database size={18} className="text-brand" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-sm">{L("ข้อมูลต้นทางที่เก็บใน POS", "Source data stored in POS", "POS 中保存的源数据")}</h2>
          <p className="text-[11px] text-muted">
            {snapshot ? <>{L("ดึงล่าสุด", "Last fetched", "最近获取")} {new Date(snapshot.completed_at || snapshot.started_at).toLocaleString("th-TH")} · {snapshot.source} · {L("ใช้ตรวจเทียบ ไม่แก้สต๊อก POS", "for comparison only, doesn't change POS stock", "仅用于核对，不修改 POS 库存")}</> : L("สินค้า · คลัง · สต๊อก · ขนส่ง · ใบโอน · ประวัติ · SN", "Products · Warehouses · Stock · Carriers · Transfers · History · SN", "商品 · 仓库 · 库存 · 物流 · 调拨单 · 记录 · SN")}
          </p>
        </div>
        {busy ? <span className="text-xs text-brand flex gap-1.5 items-center"><RefreshCw size={13} className="animate-spin" />{L("กำลังอ่านทุกหน้า อาจใช้หลายนาที", "Reading all pages, may take several minutes", "正在读取所有页面，可能需要几分钟")}</span> : null}
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void pull()}><CloudDownload size={15} />{L("ดึงข้อมูลทั้งหมด", "Fetch all data", "获取全部数据")}</Button>
      </Card>
      {error ? <p role="alert" className="text-xs text-danger">{error} <button onClick={() => void load()} className="underline">{L("ลองอ่านใหม่", "Retry", "重试")}</button></p> : null}
      {loading ? <div className="h-40 rounded-2xl bg-surface2/60 animate-pulse" /> : null}
      {!snapshot && !loading && !error ? <Card className="p-10 text-center text-sm text-muted">{L("ยังไม่มีรอบดึงข้อมูล กด “ดึงข้อมูลทั้งหมด” เพื่อเริ่ม", "No fetch runs yet — press “Fetch all data” to start", "尚无获取记录，点击“获取全部数据”开始")}</Card> : null}

      {snapshot ? (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {([["products", L("สินค้า", "Products", "商品")], ["warehouses", L("คลัง", "Warehouses", "仓库")], ["stock_rows", L("ยอด SKU/คลัง", "SKU/warehouse rows", "SKU/仓库条目")], ["carriers", L("ขนส่ง", "Carriers", "物流")], ["transfers", L("ใบโอน", "Transfers", "调拨单")], ["serials", "SN"]] as const).map(([key, label]) => (
              <div key={key} className="rounded-xl bg-surface border border-line/70 p-3"><p className="text-[11px] text-muted">{label}</p><p className="text-xl font-semibold tabular-nums mt-0.5">{snapshot.summary[key]}</p></div>
            ))}
          </div>
          {snapshot.catalog?.matches ? (
            <p className="text-xs text-muted">{L("อ้างอิงสินค้า POS เดิม", "Matched existing POS products", "匹配现有 POS 商品")} {snapshot.catalog.matches.filter((p) => p.state === "linked").length} SKU · {L("ต้องตรวจนำเข้า", "To review for import", "待审核导入")} {snapshot.catalog.matches.filter((p) => p.state === "not_imported").length} SKU · {L("ขัดแย้ง", "Conflicts", "冲突")} {snapshot.catalog.matches.filter((p) => p.state === "conflict").length} SKU · <a href="/admin/catalog-sync" className="text-brand underline">{L("ตรวจนำเข้า / ผูกคลัง", "Review import / link warehouses", "审核导入 / 绑定仓库")}</a></p>
          ) : null}
          {snapshot.catalog?.error ? <p className="text-xs text-danger">{snapshot.catalog.error}</p> : null}

          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <Card className="p-2 self-start">
              {kinds.map(([key, label]) => {
                const n = snapshot.resources.filter((r) => r.kind === key);
                const bad = n.some((r) => r.state === "error");
                return (
                  <button key={key} onClick={() => setKind(key)} className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm text-left ${kind === key ? "bg-brand text-brandInk" : "hover:bg-surface2 text-ink"}`}>
                    <span className="truncate">{label}</span>
                    <span className={`text-[11px] tnum ${kind === key ? "opacity-80" : bad ? "text-danger" : "text-muted"}`}>{n.length}</span>
                  </button>
                );
              })}
            </Card>
            <Card className="overflow-hidden">
              <div className="max-h-[calc(100vh-360px)] min-h-[260px] overflow-y-auto divide-y divide-line">
                {groups.map((resource) => (
                  <button key={resource.key} onClick={() => setSelected(resource)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface2">
                    <span className="min-w-0">
                      <span className="text-sm block truncate">{names()[resource.kind]} {resource.scope ?? ""}</span>
                      <span className="text-[11px] text-muted block truncate">{resource.error || `${L(`${resource.count} รายการ`, `${resource.count} items`, `${resource.count} 项`)} · ${new Date(resource.fetched_at).toLocaleTimeString("th-TH")}`}</span>
                    </span>
                    <span className="inline-flex items-center gap-2 shrink-0"><Badge tone={STATE[resource.state]?.tone ?? "neutral"}>{STATE[resource.state]?.label ?? resource.state}</Badge><ChevronRight size={14} /></span>
                  </button>
                ))}
                {!groups.length ? <p className="text-xs text-muted text-center py-12">{L("ไม่มีข้อมูลหมวดนี้", "No data in this category", "此类别暂无数据")}</p> : null}
              </div>
            </Card>
          </div>
          {snapshot.summary.errors > 0 ? <p className="text-xs text-danger">{L(`มี ${snapshot.summary.errors} แหล่งข้อมูลอ่านล้มเหลว ตรวจรายละเอียดแล้วกดดึงข้อมูลทั้งหมดเพื่อลองใหม่`, `${snapshot.summary.errors} sources failed to read — check details, then fetch all data to retry`, `${snapshot.summary.errors} 个数据源读取失败，请查看详情后点击获取全部数据重试`)}</p> : null}
        </>
      ) : null}

      <Drawer open={!!selected} onClose={() => setSelected(null)} width="xl" title={selected ? `${names()[selected.kind]} ${selected.scope ?? ""}` : L("รายละเอียด", "Details", "详情")} subtitle={selected ? L(`ดึงเมื่อ ${new Date(selected.fetched_at).toLocaleString("th-TH")} · ${selected.count} รายการ`, `Fetched ${new Date(selected.fetched_at).toLocaleString("th-TH")} · ${selected.count} items`, `获取于 ${new Date(selected.fetched_at).toLocaleString("th-TH")} · ${selected.count} 项`) : undefined}>
        {selected ? (
          <div className="p-5 space-y-3">
            {selected.error ? <p className="text-sm text-warn">{selected.error}</p> : null}
            <ResourcePreview data={selected.data} />
            <details className="rounded-xl border border-line">
              <summary className="cursor-pointer text-xs text-muted px-3 py-2">{L("ข้อมูลต้นทางทั้งหมด (JSON)", "All source data (JSON)", "全部源数据（JSON）")}</summary>
              <pre className="text-[11px] whitespace-pre-wrap break-words bg-surface2 p-3 max-h-96 overflow-auto">{JSON.stringify(selected.data, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function ResourcePreview({ data }: { data: unknown }) {
  const records = Array.isArray(data) ? data : data && typeof data === "object" ? (Array.isArray((data as any).items) ? (data as any).items : [data]) : [];
  if (!records.length) return <p className="text-sm text-muted">{tr("ไม่มีรายการจากต้นทางในรอบนี้", "No source items in this run", "本次无源数据条目")}</p>;
  const columns = [...new Set(records.slice(0, 20).flatMap((r: any) => (r && typeof r === "object" ? Object.keys(r) : [])))].slice(0, 8) as string[];
  return (
    <div className="overflow-auto rounded-xl border border-line max-h-[60vh]">
      <table className="w-full text-xs">
        <thead className="bg-surface2 sticky top-0"><tr>{columns.map((c) => <th key={c} className="text-left px-3 py-2 whitespace-nowrap">{c}</th>)}</tr></thead>
        <tbody>{records.slice(0, 200).map((record: any, i: number) => <tr key={i} className="border-t border-line">{columns.map((c) => <td key={c} className="px-3 py-2 max-w-64 truncate">{record?.[c] == null ? "—" : typeof record[c] === "object" ? JSON.stringify(record[c]) : String(record[c])}</td>)}</tr>)}</tbody>
      </table>
      {records.length > 200 ? <p className="p-2 text-xs text-muted">{tr("แสดง 200 รายการแรก ข้อมูลครบอยู่ใน JSON ด้านล่าง", "Showing first 200 items; full data is in the JSON below", "显示前 200 项，完整数据见下方 JSON")}</p> : null}
    </div>
  );
}
