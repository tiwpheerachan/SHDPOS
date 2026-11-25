"use client";
// สถานะบิลในคลังกลาง/JST — ใช้ร่วมทุกหน้าที่แสดงบิล (ระบบเรา ↔ OneWarehouse ↔ JST)
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { useEffect, useState } from "react";
import { isLiveMode } from "@/lib/supabase/client";

export type OwSaleStatus = { event_id?: string; state: string; reason: string | null; ow_status: string | null; sale_no: string | null; jst_order_no: string | null; sent_at: string | null };

/** ดึงสถานะคลังกลางของบิลหลายใบในครั้งเดียว (รีเฟรชทุก 30 วิ) */
export function useOwSaleStatus(clientUuids: (string | null | undefined)[], intervalMs = 30_000, nonce = 0) {
  const key = [...new Set(clientUuids.filter((x): x is string => !!x))].sort().join(",");
  const [map, setMap] = useState<Record<string, OwSaleStatus>>({});
  useEffect(() => {
    if (!isLiveMode() || !key) return;
    let alive = true;
    const load = async () => {
      try {
        const ids = key.split(",");
        const out: Record<string, OwSaleStatus> = {};
        for (let i = 0; i < ids.length; i += 200) {
          const r = await fetch(`/api/pos/ow-sale-status?ids=${ids.slice(i, i + 200).join(",")}`, { cache: "no-store" });
          if (!r.ok) return;
          Object.assign(out, (await r.json()).items ?? {});
        }
        if (alive) setMap(out);
      } catch { /* ออฟไลน์: คงค่าเดิม */ }
    };
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [key, intervalMs, nonce]);
  return map;
}

export function owSaleLabel(s?: OwSaleStatus | null): { text: string; tone: string; title: string } {
  if (!s) return { text: "—", tone: "text-muted", title: "ไม่ได้ส่งคลังกลาง (สาขายังไม่ผูก หรือบิลก่อนเชื่อม)" };
  if (isOwSaleDone(s.ow_status) && s.jst_order_no) return { text: `JST ${s.jst_order_no}`, tone: "bg-ok/12 text-ok", title: `คลังกลาง ${s.sale_no ?? ""} · JST ยืนยันแล้ว` };
  if (s.ow_status === "sn_pending") return { text: "รอแก้ SN", tone: "bg-warn/12 text-warn", title: s.reason ?? "คลังกลางรับแล้ว แต่ SN ไม่ตรง — แก้ในหน้า คลังกลาง › ส่งบิลขาย" };
  if (s.ow_status === "submitted") return { text: "รอ JST", tone: "bg-sky-500/10 text-sky-600", title: `คลังกลาง ${s.sale_no ?? ""} รับแล้ว รอ JST ยืนยัน` };
  if (s.ow_status === "failed") return { text: "JST ไม่รับ · ยังไม่สมบูรณ์", tone: "bg-danger/12 text-danger", title: s.reason ?? "JST ปฏิเสธบิล — ไม่มีการตัดสต๊อกใน JST ต้องแก้แล้วส่งใหม่" };
  if (["blocked", "dead"].includes(s.state)) return { text: "ส่งไม่ผ่าน", tone: "bg-danger/12 text-danger", title: s.reason ?? "ส่งคลังกลางไม่สำเร็จ" };
  if (["queued", "processing", "retry"].includes(s.state)) return { text: "กำลังส่ง", tone: "bg-sky-500/10 text-sky-600", title: s.reason ?? "อยู่ในคิวส่งคลังกลาง" };
  return { text: s.ow_status ?? s.state, tone: "bg-surface2 text-muted", title: s.reason ?? "" };
}

export function OwSaleBadge({ status }: { status?: OwSaleStatus | null }) {
  const l = owSaleLabel(status);
  return <span title={l.title} className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${l.tone}`}>{l.text}</span>;
}

/** สถานะ JST สดหลังขาย (ใบเสร็จ) — ถี่ 2.5 วิ จนได้ผล · JST ไม่รับ = แสดงชัดว่า "ยังไม่ถือว่าขายสำเร็จ" + ปุ่มส่งใหม่ */
export function OwSaleLive({ clientUuid, onStatus }: { clientUuid: string; onStatus?: (s: OwSaleStatus | null) => void }) {
  const [nonce, setNonce] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const map = useOwSaleStatus([clientUuid], 2_500, nonce);
  const s = map[clientUuid] ?? null;
  useEffect(() => { onStatus?.(s); }, [s?.ow_status, s?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isLiveMode()) return null;
  // ยังไม่มีข้อมูล: 15 วิแรก = กำลังส่ง · เกินนั้น = สาขาไม่ผูกคลังกลาง (ไม่ต้องแสดง)
  if (!s) return Date.now() - startedAt < 15_000
    ? <p className="text-xs text-sky-600 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />กำลังส่งบิลเข้า JST…</p>
    : null;
  if (isOwSaleDone(s.ow_status)) return <p className="text-xs text-ok flex items-center gap-1.5 font-medium">✓ JST รับบิลแล้ว{s.jst_order_no ? ` · ${s.jst_order_no}` : ""}</p>;
  if (s.ow_status === "sn_pending") return <p className="text-xs text-warn">รอแก้ SN ก่อนเข้า JST — {s.reason ?? ""}</p>;
  if (s.ow_status === "failed" || ["blocked", "dead"].includes(s.state)) return (
    <div className="rounded-lg border border-danger/40 bg-danger/8 px-3 py-2 space-y-1.5">
      <p className="text-xs font-semibold text-danger">✗ JST ไม่รับบิลนี้ — ยังไม่ถือว่าขายสำเร็จ</p>
      <p className="text-[11px] text-ink/80 break-words">{s.reason ?? "ไม่ทราบสาเหตุ"}</p>
      <p className="text-[10px] text-muted">ระบบแจ้งหัวหน้าใน "งานของฉัน" แล้ว · แก้สาเหตุ (เช่น ให้คลังกลางเปิด SKU ในสาขา) แล้วกดส่งใหม่ — ไม่ต้องเปิดบิลใหม่</p>
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            const r = await fetch("/api/pos/ow-sale-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_uuid: clientUuid }) });
            const j = await r.json(); setMsg(r.ok ? "ส่งใหม่แล้ว — JST รับบิลแล้ว" : j.error ?? "ส่งใหม่ไม่สำเร็จ");
          } catch { setMsg("เชื่อมต่อไม่ได้"); } finally { setBusy(false); setNonce((n) => n + 1); }
        }} className="h-7 px-3 rounded-lg bg-danger text-white text-[11px] font-semibold disabled:opacity-50">{busy ? "กำลังส่ง…" : "ส่งใหม่"}</button>
        {msg ? <span className="text-[10.5px] text-muted break-words">{msg}</span> : null}
      </div>
    </div>
  );
  return <p className="text-xs text-sky-600">กำลังส่งบิลเข้า JST… ({s.ow_status ?? s.state})</p>;
}
