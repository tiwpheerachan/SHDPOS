"use client";
// ซิงก์อัตโนมัติ (OneWarehouse) — ซ้าย: สถานะ+ตั้งค่า · ขวา: ประวัติรอบ / เหตุการณ์รอส่งกลับ (สลับแท็บ ไม่ใช้ <details> ที่ดันหน้า)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Card, Button, Badge } from "@/components/ui";
import { Activity, RefreshCw, Clock3, AlertTriangle } from "lucide-react";
import { useL } from "@/lib/i18n/provider";

export function SyncControlPanel() {
  const L = useL();
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
    } catch (e) { setError(e instanceof Error ? e.message : L("อ่านสถานะไม่สำเร็จ", "Couldn't load status", "读取状态失败")); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => clearInterval(timer); }, []);
  async function save(enabled: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/sync-control", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, version: data.settings?.version ?? 0, interval_seconds: interval }) });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      intervalDirty.current = false; await load();
    } catch (e) { setError(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败")); } finally { setBusy(false); }
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
            <h2 className="font-semibold inline-flex items-center gap-2"><Activity size={17} className="text-brand" />{L("ซิงก์อัตโนมัติ", "Auto sync", "自动同步")}</h2>
            <p className="text-xs text-muted mt-1">{L("อัปเดตงานสาขาตามรอบ · ดึงแคตตาล็อกทุก 15 นาที", "Updates branch jobs each cycle · pulls the catalog every 15 minutes", "按周期更新门店任务 · 每 15 分钟拉取目录")}</p>
          </div>
          <Button variant="soft" onClick={() => void load()}><RefreshCw size={14} />{L("ตรวจ", "Check", "检查")}</Button>
        </div>
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        {data ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone={settings?.enabled ? "ok" : "neutral"}>{settings?.enabled ? L("เปิดซิงก์อัตโนมัติ", "Auto sync on", "自动同步已开启") : L("ปิดอัตโนมัติ", "Auto off", "自动已关闭")}</Badge>
              <Badge tone={running ? "info" : workerAlive ? "ok" : "warn"}>{running ? L("กำลังซิงก์", "Syncing", "同步中") : workerAlive ? L("Worker ติดต่ออยู่", "Worker connected", "Worker 已连接") : L("Worker ยังไม่ติดต่อ", "Worker not connected", "Worker 未连接")}</Badge>
            </div>
            <label className="block text-xs text-muted space-y-1.5">
              <span>{L("รอบงานสาขา", "Branch job interval", "门店任务周期")}</span>
              <select className="w-full h-9 border border-line bg-surface2 rounded-xl px-2.5 text-sm text-ink" value={interval}
                onChange={(e) => { intervalDirty.current = true; setIntervalValue(Number(e.target.value)); }}>
                {[30, 60, 120, 300].map((v) => <option key={v} value={v}>{L(`${v} วินาที`, `${v} sec`, `${v} 秒`)}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} disabled={busy || (!settings?.enabled && !data.worker_configured)} onClick={() => void save(!settings?.enabled)}>
                {settings?.enabled ? L("ปิดซิงก์อัตโนมัติ", "Turn off auto sync", "关闭自动同步") : L("เปิดซิงก์อัตโนมัติ", "Turn on auto sync", "开启自动同步")}
              </Button>
              {settings?.enabled ? <Button variant="soft" disabled={busy} onClick={() => void save(true)}>{L("บันทึกรอบใหม่", "Save interval", "保存新周期")}</Button> : null}
            </div>
            <dl className="text-xs space-y-1.5 rounded-xl bg-surface2/50 p-3">
              <div className="flex justify-between gap-2"><dt className="text-muted">{L("สำเร็จล่าสุด", "Last success", "最近成功")}</dt><dd>{settings?.last_success_at ? new Date(settings.last_success_at).toLocaleString("th-TH") : L("ยังไม่มี", "None yet", "暂无")}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">{L("แคตตาล็อกเต็มล่าสุด", "Last full catalog", "最近完整目录")}</dt><dd>{settings?.last_catalog_at ? new Date(settings.last_catalog_at).toLocaleString("th-TH") : L("ยังไม่มี", "None yet", "暂无")}</dd></div>
              {settings?.last_error ? <p className="text-danger pt-1">{settings.last_error}</p> : null}
            </dl>
          </>
        ) : !error ? <div className="h-40 rounded-xl bg-surface2/60 animate-pulse" /> : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
          <div className="flex rounded-xl bg-surface2/70 p-0.5">
            {([["runs", `${L("ประวัติรอบซิงก์", "Sync runs", "同步记录")} (${runs.length})`], ["events", `${L("รอส่งกลับ OW", "Pending to OW", "待回传 OW")} (${events.length})`]] as const).map(([k, l]) => (
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
            ) : <p className="text-xs text-muted text-center py-12">{L("ยังไม่มีรอบซิงก์", "No sync runs yet", "暂无同步记录")}</p>
          ) : (
            <>
              <p className="text-[11px] text-muted px-4 py-2 bg-surface2/40 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" />{L("รายการที่ยังไม่มีสัญญาเขียนหรือ mapping จะถูกพักไว้ ไม่แสดงว่าส่งสำเร็จ และไม่ส่งไปเส้นทางสมมุติ", "Items without a write contract or mapping are held — not shown as sent, and never sent to a guessed route", "没有写入契约或映射的条目将暂缓 — 不显示为已发送，也不会发往假设路径")}</p>
              {events.length ? (
                <ul className="divide-y divide-line/60">
                  {events.map((event) => (
                    <li key={event.id} className="px-4 py-2.5 text-xs">
                      <div className="flex justify-between gap-2"><span className="truncate">{event.event_type} · <span className="font-mono">{event.aggregate_id}</span></span><Badge tone={event.state === "delivered" ? "ok" : "warn"}>{event.state}</Badge></div>
                      <p className="text-muted mt-1">{event.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted text-center py-12">{L("ไม่มีรายการรอส่งกลับ", "Nothing pending", "无待回传条目")}</p>}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
