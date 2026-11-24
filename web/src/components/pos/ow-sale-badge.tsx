"use client";
// สถานะบิลในคลังกลาง/JST — ใช้ร่วมทุกหน้าที่แสดงบิล (ระบบเรา ↔ OneWarehouse ↔ JST)
import { useEffect, useState } from "react";
import { isLiveMode } from "@/lib/supabase/client";

export type OwSaleStatus = { state: string; reason: string | null; ow_status: string | null; sale_no: string | null; jst_order_no: string | null; sent_at: string | null };

/** ดึงสถานะคลังกลางของบิลหลายใบในครั้งเดียว (รีเฟรชทุก 30 วิ) */
export function useOwSaleStatus(clientUuids: (string | null | undefined)[]) {
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
    const t = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [key]);
  return map;
}

export function owSaleLabel(s?: OwSaleStatus | null): { text: string; tone: string; title: string } {
  if (!s) return { text: "—", tone: "text-muted", title: "ไม่ได้ส่งคลังกลาง (สาขายังไม่ผูก หรือบิลก่อนเชื่อม)" };
  if (s.ow_status === "jst_confirmed" && s.jst_order_no) return { text: `JST ${s.jst_order_no}`, tone: "bg-ok/12 text-ok", title: `คลังกลาง ${s.sale_no ?? ""} · JST ยืนยันแล้ว` };
  if (s.ow_status === "sn_pending") return { text: "รอแก้ SN", tone: "bg-warn/12 text-warn", title: s.reason ?? "คลังกลางรับแล้ว แต่ SN ไม่ตรง — แก้ในหน้า คลังกลาง › ส่งบิลขาย" };
  if (s.ow_status === "submitted") return { text: "รอ JST", tone: "bg-sky-500/10 text-sky-600", title: `คลังกลาง ${s.sale_no ?? ""} รับแล้ว รอ JST ยืนยัน` };
  if (s.ow_status === "failed" || ["blocked", "dead"].includes(s.state)) return { text: "ส่งไม่ผ่าน", tone: "bg-danger/12 text-danger", title: s.reason ?? "ส่งคลังกลางไม่สำเร็จ" };
  if (["queued", "processing", "retry"].includes(s.state)) return { text: "กำลังส่ง", tone: "bg-sky-500/10 text-sky-600", title: s.reason ?? "อยู่ในคิวส่งคลังกลาง" };
  return { text: s.ow_status ?? s.state, tone: "bg-surface2 text-muted", title: s.reason ?? "" };
}

export function OwSaleBadge({ status }: { status?: OwSaleStatus | null }) {
  const l = owSaleLabel(status);
  return <span title={l.title} className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${l.tone}`}>{l.text}</span>;
}
