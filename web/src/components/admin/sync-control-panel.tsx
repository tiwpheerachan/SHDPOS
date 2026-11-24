"use client";
// ซิงก์อัตโนมัติ (OneWarehouse) — ซ้าย: สถานะ+ตั้งค่า · ขวา: ประวัติรอบ / เหตุการณ์รอส่งกลับ (สลับแท็บ ไม่ใช้ <details> ที่ดันหน้า)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Card, Button, Badge } from "@/components/ui";
import { Activity, RefreshCw, Clock3, AlertTriangle } from "lucide-react";

export function SyncControlPanel() {
  const intervalDirty = useRef(false);
  const [data, setData] = useState<any>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [interval, setIntervalValue] = useState(60);
  const [side, setSide] = useState<"runs" | "events">("runs");
  async function load() {
    try {
      const r = await fetch("/api/admin/sync-control", { cache: "no-store" }), j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j);
      if (!intervalDirty.current) setIntervalValue(j.settings?.interval_seconds ?? 60);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "อ่านสถานะไม่สำเร็จ"); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => clearInterval(timer); }, []);
  async function save(enabled: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/sync-control", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, version: data.settings?.version ?? 0, interval_seconds: interval }) });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      intervalDirty.current = false; await load();
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); } finally { setBusy(false); }
  }
  const settings = data?.settings;
  const workerAlive = settings?.worker_seen_at && Date.now() - Date.parse(settings.worker_seen_at) < 45000;
  const running = settings?.lease_until && Date.parse(settings.lease_until) > Date.now();
  const runs: any[] = data?.runs ?? [], events: any[] = data?.events ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="p-4 sm:p-5 space-y-4 self-start">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold inline-flex items-center gap-2"><Activity size={17} className="text-brand" />ซิงก์อัตโนมัติ</h2>
            <p className="text-xs text-muted mt-1">อัปเดตงานสาขาตามรอบ · ดึงแคตตาล็อกทุก 15 นาที</p>
          </div>
          <Button variant="soft" onClick={() => void load()}><RefreshCw size={14} />ตรวจ</Button>
        </div>
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        {data ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone={settings?.enabled ? "ok" : "neutral"}>{settings?.enabled ? "เปิดซิงก์อัตโนมัติ" : "ปิดอัตโนมัติ"}</Badge>
              <Badge tone={running ? "info" : workerAlive ? "ok" : "warn"}>{running ? "กำลังซิงก์" : workerAlive ? "Worker ติดต่ออยู่" : "Worker ยังไม่ติดต่อ"}</Badge>
            </div>
            <label className="block text-xs text-muted space-y-1.5">
              <span>รอบงานสาขา</span>
              <select className="w-full h-9 border border-line bg-surface2 rounded-xl px-2.5 text-sm text-ink" value={interval}
                onChange={(e) => { intervalDirty.current = true; setIntervalValue(Number(e.target.value)); }}>
                {[30, 60, 120, 300].map((v) => <option key={v} value={v}>{v} วินาที</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} disabled={busy || (!settings?.enabled && !data.worker_configured)} onClick={() => void save(!settings?.enabled)}>
                {settings?.enabled ? "ปิดซิงก์อัตโนมัติ" : "เปิดซิงก์อัตโนมัติ"}
              </Button>
              {settings?.enabled ? <Button variant="soft" disabled={busy} onClick={() => void save(true)}>บันทึกรอบใหม่</Button> : null}
            </div>
            <dl className="text-xs space-y-1.5 rounded-xl bg-surface2/50 p-3">
              <div className="flex justify-between gap-2"><dt className="text-muted">สำเร็จล่าสุด</dt><dd>{settings?.last_success_at ? new Date(settings.last_success_at).toLocaleString("th-TH") : "ยังไม่มี"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">แคตตาล็อกเต็มล่าสุด</dt><dd>{settings?.last_catalog_at ? new Date(settings.last_catalog_at).toLocaleString("th-TH") : "ยังไม่มี"}</dd></div>
              {settings?.last_error ? <p className="text-danger pt-1">{settings.last_error}</p> : null}
            </dl>
          </>
        ) : !error ? <div className="h-40 rounded-xl bg-surface2/60 animate-pulse" /> : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
          <div className="flex rounded-xl bg-surface2/70 p-0.5">
            {([["runs", `ประวัติรอบซิงก์ (${runs.length})`], ["events", `รอส่งกลับ OW (${events.length})`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSide(k)} className={`h-8 px-3 rounded-lg text-xs ${side === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="max-h-[calc(100vh-280px)] min-h-[260px] overflow-auto">
          {side === "runs" ? (
            runs.length ? (
              <ul className="divide-y divide-line/60">
                {runs.map((run) => (
                  <li key={run.id} className="px-4 py-2.5 text-xs flex items-start gap-3">
                    <Clock3 size={14} className="text-muted mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p>{new Date(run.started_at).toLocaleString("th-TH")} · {run.mode}</p>
                      {run.error ? <p className="text-danger mt-0.5 break-words">{run.error}</p> : null}
                    </div>
                    <Badge tone={run.state === "completed" || run.state === "succeeded" || run.state === "success" ? "ok" : run.state === "failed" ? "danger" : "neutral"}>{run.state}</Badge>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted text-center py-12">ยังไม่มีรอบซิงก์</p>
          ) : (
            <>
              <p className="text-[11px] text-muted px-4 py-2 bg-surface2/40 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" />รายการที่ยังไม่มีสัญญาเขียนหรือ mapping จะถูกพักไว้ ไม่แสดงว่าส่งสำเร็จ และไม่ส่งไปเส้นทางสมมุติ</p>
              {events.length ? (
                <ul className="divide-y divide-line/60">
                  {events.map((event) => (
                    <li key={event.id} className="px-4 py-2.5 text-xs">
                      <div className="flex justify-between gap-2"><span className="truncate">{event.event_type} · <span className="font-mono">{event.aggregate_id}</span></span><Badge tone={event.state === "delivered" ? "ok" : "warn"}>{event.state}</Badge></div>
                      <p className="text-muted mt-1">{event.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted text-center py-12">ไม่มีรายการรอส่งกลับ</p>}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
