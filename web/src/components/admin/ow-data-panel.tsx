"use client";
// ข้อมูลต้นทาง OneWarehouse ที่เก็บใน POS — ซ้าย: สรุป + หมวดข้อมูล · ขวา: รายการของหมวดที่เลือก · คลิก = Drawer ดูข้อมูลจริง
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { CloudDownload, RefreshCw, Database, ChevronRight } from "lucide-react";
import { Card, Button, Drawer, Badge } from "@/components/ui";
import type { OwSnapshot, OwResource } from "@/lib/ow-sync/model";

const names: Record<string, string> = { contract: "ข้อกำหนด API", warehouses: "คลัง", carriers: "ขนส่ง", inventory_raw: "สต๊อกไม่ระบุ SKU", product_page: "รายการสินค้า", product: "รายละเอียดสินค้า", stock: "สต๊อกแยกคลัง", dashboard: "Dashboard", transfer_page: "รายการใบโอน", transfer: "รายละเอียดใบโอน", timeline: "ประวัติใบโอน", serial: "SN", bom: "ส่วนประกอบชุด" };
const STATE: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = { ok: { label: "ดึงสำเร็จ", tone: "ok" }, empty: { label: "ไม่มีรายการ", tone: "neutral" }, unavailable: { label: "ยังอ่านไม่ได้", tone: "warn" }, error: { label: "อ่านล้มเหลว", tone: "danger" } };

export function OwDataPanel() {
  const [snapshot, setSnapshot] = useState<OwSnapshot | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [kind, setKind] = useState("stock"), [selected, setSelected] = useState<OwResource | null>(null);
  async function load() {
    try {
      const response = await fetch("/api/admin/ow-data", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "อ่านผลซิงก์ไม่สำเร็จ");
      setSnapshot(data.snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : "อ่านไม่สำเร็จ"); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30000); return () => clearInterval(timer); }, []);
  async function pull() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/ow-data", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "ดึงข้อมูลไม่สำเร็จ");
      setSnapshot(data.snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : "ดึงข้อมูลไม่สำเร็จ"); } finally { setBusy(false); }
  }
  const kinds = snapshot ? Object.entries(names).filter(([k]) => snapshot.resources.some((r) => r.kind === k)) : [];
  const groups = snapshot?.resources.filter((r) => r.kind === kind) ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Database size={18} className="text-brand" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-sm">ข้อมูลต้นทางที่เก็บใน POS</h2>
          <p className="text-[11px] text-muted">
            {snapshot ? <>ดึงล่าสุด {new Date(snapshot.completed_at || snapshot.started_at).toLocaleString("th-TH")} · {snapshot.source} · ใช้ตรวจเทียบ ไม่แก้สต๊อก POS</> : "สินค้า · คลัง · สต๊อก · ขนส่ง · ใบโอน · ประวัติ · SN"}
          </p>
        </div>
        {busy ? <span className="text-xs text-brand flex gap-1.5 items-center"><RefreshCw size={13} className="animate-spin" />กำลังอ่านทุกหน้า อาจใช้หลายนาที</span> : null}
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void pull()}><CloudDownload size={15} />ดึงข้อมูลทั้งหมด</Button>
      </Card>
      {error ? <p role="alert" className="text-xs text-danger">{error} <button onClick={() => void load()} className="underline">ลองอ่านใหม่</button></p> : null}
      {loading ? <div className="h-40 rounded-2xl bg-surface2/60 animate-pulse" /> : null}
      {!snapshot && !loading && !error ? <Card className="p-10 text-center text-sm text-muted">ยังไม่มีรอบดึงข้อมูล กด “ดึงข้อมูลทั้งหมด” เพื่อเริ่ม</Card> : null}

      {snapshot ? (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {([["products", "สินค้า"], ["warehouses", "คลัง"], ["stock_rows", "ยอด SKU/คลัง"], ["carriers", "ขนส่ง"], ["transfers", "ใบโอน"], ["serials", "SN"]] as const).map(([key, label]) => (
              <div key={key} className="rounded-xl bg-surface border border-line/70 p-3"><p className="text-[11px] text-muted">{label}</p><p className="text-xl font-semibold tabular-nums mt-0.5">{snapshot.summary[key]}</p></div>
            ))}
          </div>
          {snapshot.catalog?.matches ? (
            <p className="text-xs text-muted">อ้างอิงสินค้า POS เดิม {snapshot.catalog.matches.filter((p) => p.state === "linked").length} SKU · ต้องตรวจนำเข้า {snapshot.catalog.matches.filter((p) => p.state === "not_imported").length} SKU · ขัดแย้ง {snapshot.catalog.matches.filter((p) => p.state === "conflict").length} SKU · <a href="/admin/catalog-sync" className="text-brand underline">ตรวจนำเข้า / ผูกคลัง</a></p>
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
                      <span className="text-sm block truncate">{names[resource.kind]} {resource.scope ?? ""}</span>
                      <span className="text-[11px] text-muted block truncate">{resource.error || `${resource.count} รายการ · ${new Date(resource.fetched_at).toLocaleTimeString("th-TH")}`}</span>
                    </span>
                    <span className="inline-flex items-center gap-2 shrink-0"><Badge tone={STATE[resource.state]?.tone ?? "neutral"}>{STATE[resource.state]?.label ?? resource.state}</Badge><ChevronRight size={14} /></span>
                  </button>
                ))}
                {!groups.length ? <p className="text-xs text-muted text-center py-12">ไม่มีข้อมูลหมวดนี้</p> : null}
              </div>
            </Card>
          </div>
          {snapshot.summary.errors > 0 ? <p className="text-xs text-danger">มี {snapshot.summary.errors} แหล่งข้อมูลอ่านล้มเหลว ตรวจรายละเอียดแล้วกดดึงข้อมูลทั้งหมดเพื่อลองใหม่</p> : null}
        </>
      ) : null}

      <Drawer open={!!selected} onClose={() => setSelected(null)} width="xl" title={selected ? `${names[selected.kind]} ${selected.scope ?? ""}` : "รายละเอียด"} subtitle={selected ? `ดึงเมื่อ ${new Date(selected.fetched_at).toLocaleString("th-TH")} · ${selected.count} รายการ` : undefined}>
        {selected ? (
          <div className="p-5 space-y-3">
            {selected.error ? <p className="text-sm text-warn">{selected.error}</p> : null}
            <ResourcePreview data={selected.data} />
            <details className="rounded-xl border border-line">
              <summary className="cursor-pointer text-xs text-muted px-3 py-2">ข้อมูลต้นทางทั้งหมด (JSON)</summary>
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
  if (!records.length) return <p className="text-sm text-muted">ไม่มีรายการจากต้นทางในรอบนี้</p>;
  const columns = [...new Set(records.slice(0, 20).flatMap((r: any) => (r && typeof r === "object" ? Object.keys(r) : [])))].slice(0, 8) as string[];
  return (
    <div className="overflow-auto rounded-xl border border-line max-h-[60vh]">
      <table className="w-full text-xs">
        <thead className="bg-surface2 sticky top-0"><tr>{columns.map((c) => <th key={c} className="text-left px-3 py-2 whitespace-nowrap">{c}</th>)}</tr></thead>
        <tbody>{records.slice(0, 200).map((record: any, i: number) => <tr key={i} className="border-t border-line">{columns.map((c) => <td key={c} className="px-3 py-2 max-w-64 truncate">{record?.[c] == null ? "—" : typeof record[c] === "object" ? JSON.stringify(record[c]) : String(record[c])}</td>)}</tr>)}</tbody>
      </table>
      {records.length > 200 ? <p className="p-2 text-xs text-muted">แสดง 200 รายการแรก ข้อมูลครบอยู่ใน JSON ด้านล่าง</p> : null}
    </div>
  );
}
