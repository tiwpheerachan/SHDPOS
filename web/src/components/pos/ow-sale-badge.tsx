"use client";
// สถานะบิลในคลังกลาง/JST — ใช้ร่วมทุกหน้าที่แสดงบิล (ระบบเรา ↔ OneWarehouse ↔ JST)
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { useEffect, useState } from "react";
import { isLiveMode } from "@/lib/supabase/client";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

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
  if (!s) return { text: "—", tone: "text-muted", title: tr("ไม่ได้ส่งคลังกลาง (สาขายังไม่ผูก หรือบิลก่อนเชื่อม)", "Not sent to central warehouse (branch not linked, or bill predates integration)", "未发送至中央仓（门店未绑定，或单据早于对接）") };
  if (isOwSaleDone(s.ow_status) && s.jst_order_no) return { text: `JST ${s.jst_order_no}`, tone: "bg-ok/12 text-ok", title: tr(`คลังกลาง ${s.sale_no ?? ""} · JST ยืนยันแล้ว`, `Central ${s.sale_no ?? ""} · JST confirmed`, `中央仓 ${s.sale_no ?? ""} · JST 已确认`) };
  if (s.ow_status === "sn_pending") return { text: tr("รอแก้ SN", "SN fix needed", "待修正序列号"), tone: "bg-warn/12 text-warn", title: s.reason ?? tr("คลังกลางรับแล้ว แต่ SN ไม่ตรง — แก้ในหน้า คลังกลาง › ส่งบิลขาย", "Central received it but SNs don't match — fix in Central warehouse › Sales bills", "中央仓已接收但序列号不符 — 请在 中央仓 › 销售单发送 页面修正") };
  if (s.ow_status === "submitted") return { text: tr("รอ JST", "Awaiting JST", "等待 JST"), tone: "bg-sky-500/10 text-sky-600", title: tr(`คลังกลาง ${s.sale_no ?? ""} รับแล้ว รอ JST ยืนยัน`, `Central ${s.sale_no ?? ""} received, awaiting JST confirmation`, `中央仓 ${s.sale_no ?? ""} 已接收，等待 JST 确认`) };
  if (s.ow_status === "failed") return { text: tr("JST ไม่รับ · ยังไม่สมบูรณ์", "JST rejected · incomplete", "JST 拒收 · 未完成"), tone: "bg-danger/12 text-danger", title: s.reason ?? tr("JST ปฏิเสธบิล — ไม่มีการตัดสต๊อกใน JST ต้องแก้แล้วส่งใหม่", "JST rejected the bill — no stock deducted in JST; fix and resend", "JST 拒绝了单据 — JST 未扣库存，需修正后重新发送") };
  if (s.state === "blocked" && (s.reason ?? "").startsWith("พักไว้ไม่ส่ง:")) return { text: tr("พักไว้ไม่ส่ง JST", "Held, not sent to JST", "暂缓，未发送 JST"), tone: "bg-warn/12 text-warn", title: s.reason ?? "" };
  if (["blocked", "dead"].includes(s.state)) return { text: tr("ส่งไม่ผ่าน", "Send failed", "发送失败"), tone: "bg-danger/12 text-danger", title: s.reason ?? tr("ส่งคลังกลางไม่สำเร็จ", "Failed to send to central warehouse", "发送至中央仓失败") };
  if (["queued", "processing", "retry"].includes(s.state)) return { text: tr("กำลังส่ง", "Sending", "发送中"), tone: "bg-sky-500/10 text-sky-600", title: s.reason ?? tr("อยู่ในคิวส่งคลังกลาง", "In the central warehouse queue", "在中央仓发送队列中") };
  return { text: s.ow_status ?? s.state, tone: "bg-surface2 text-muted", title: s.reason ?? "" };
}

export function OwSaleBadge({ status }: { status?: OwSaleStatus | null }) {
  const l = owSaleLabel(status);
  return <span title={l.title} className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${l.tone}`}>{l.text}</span>;
}

/** สถานะ JST สดหลังขาย (ใบเสร็จ) — ถี่ 2.5 วิ จนได้ผล · JST ไม่รับ = แสดงชัดว่า "ยังไม่ถือว่าขายสำเร็จ" + ปุ่มส่งใหม่ */
export function OwSaleLive({ clientUuid, onStatus }: { clientUuid: string; onStatus?: (s: OwSaleStatus | null) => void }) {
  const L = useL();
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
    ? <p className="text-xs text-sky-600 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />{L("กำลังส่งบิลเข้า JST…", "Sending bill to JST…", "正在发送单据至 JST…")}</p>
    : null;
  if (isOwSaleDone(s.ow_status)) return <p className="text-xs text-ok flex items-center gap-1.5 font-medium">✓ {L("JST รับบิลแล้ว", "JST accepted the bill", "JST 已接收单据")}<span translate="no">{s.jst_order_no ? ` · ${s.jst_order_no}` : ""}</span></p>;
  if (s.ow_status === "sn_pending") return <p className="text-xs text-warn">{L("รอแก้ SN ก่อนเข้า JST", "SN fix needed before JST", "进入 JST 前需修正序列号")} — {s.reason ?? ""}</p>;
  if (s.state === "blocked" && (s.reason ?? "").startsWith("พักไว้ไม่ส่ง:")) return (
    <div className="rounded-lg border border-warn/40 bg-warn/8 px-3 py-2"><p className="text-xs font-semibold text-warn">{L("บิลนี้พักไว้ ไม่ส่งเข้า JST", "This bill is held, not sent to JST", "此单据暂缓，未发送至 JST")}</p><p className="text-[11px] text-ink/80">{(s.reason ?? "").replace("พักไว้ไม่ส่ง:", "").trim()}</p></div>
  );
  if (s.ow_status === "failed" || ["blocked", "dead"].includes(s.state)) return (
    <div className="rounded-lg border border-danger/40 bg-danger/8 px-3 py-2 space-y-1.5">
      <p className="text-xs font-semibold text-danger">✗ {L("JST ไม่รับบิลนี้ — ยังไม่ถือว่าขายสำเร็จ", "JST rejected this bill — the sale is not yet complete", "JST 拒收此单据 — 尚不视为销售成功")}</p>
      <p className="text-[11px] text-ink/80 break-words">{s.reason ?? L("ไม่ทราบสาเหตุ", "Unknown reason", "原因未知")}</p>
      <p className="text-[10px] text-muted">{L('ระบบแจ้งหัวหน้าใน "งานของฉัน" แล้ว · แก้สาเหตุ (เช่น ให้คลังกลางเปิด SKU ในสาขา) แล้วกดส่งใหม่ — ไม่ต้องเปิดบิลใหม่', 'Your supervisor was notified in "My tasks" · fix the cause (e.g. have the central warehouse enable the SKU for this branch), then resend — no need to open a new bill', '系统已在“我的任务”通知主管 · 修正原因（如让中央仓为门店开通 SKU）后重新发送 — 无需新开单据')}</p>
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            const r = await fetch("/api/pos/ow-sale-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_uuid: clientUuid }) });
            const j = await r.json(); setMsg(r.ok ? L("ส่งใหม่แล้ว — JST รับบิลแล้ว", "Resent — JST accepted the bill", "已重新发送 — JST 已接收单据") : j.error ?? L("ส่งใหม่ไม่สำเร็จ", "Resend failed", "重新发送失败"));
          } catch { setMsg(L("เชื่อมต่อไม่ได้", "Can't connect", "无法连接")); } finally { setBusy(false); setNonce((n) => n + 1); }
        }} className="h-7 px-3 rounded-lg bg-danger text-white text-[11px] font-semibold disabled:opacity-50">{busy ? L("กำลังส่ง…", "Sending…", "发送中…") : L("ส่งใหม่", "Resend", "重新发送")}</button>
        {msg ? <span className="text-[10.5px] text-muted break-words">{msg}</span> : null}
      </div>
    </div>
  );
  return <p className="text-xs text-sky-600">{L("กำลังส่งบิลเข้า JST…", "Sending bill to JST…", "正在发送单据至 JST…")} ({s.ow_status ?? s.state})</p>;
}
