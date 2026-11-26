"use client";
// หน้าเปิดลิงก์แชร์รายงาน (ภาพนิ่ง · ไม่ต้องล็อกอิน) — ตัวเลขที่สรุปไว้ตอนสร้างลิงก์ · ดาวน์โหลด PDF/รูปภาพได้
import { useEffect, useRef, useState } from "react";
import { BarChart3, Clock, Loader2, ShieldCheck } from "lucide-react";
import { OverviewView, type OverviewModel } from "@/components/admin/sales-dashboard";
import { DownloadMenu } from "@/components/admin/report-actions";
import { useL } from "@/lib/i18n/provider";

type Snap = { title: string; payload: { model: OverviewModel; meta: { range: string; filters?: string; generated_at: string } }; created_at: string; expires_at: string; by: string };

export default function SharedReportPage({ params }: { params: { token: string } }) {
  const L = useL();
  const [data, setData] = useState<Snap | null>(null), [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void fetch(`/api/share/report/${params.token}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) setErr(j.error ?? L("เปิดลิงก์ไม่ได้", "Can't open link", "无法打开链接")); else setData(j); }).catch(() => setErr(L("เปิดลิงก์ไม่ได้", "Can't open link", "无法打开链接")));
  }, [params.token]);
  if (err) return <div className="min-h-screen grid place-items-center p-6 bg-bg"><div className="card p-8 text-center max-w-sm"><BarChart3 size={28} className="mx-auto text-muted" /><p className="mt-3 font-semibold">{err}</p><p className="text-xs text-muted mt-1">{L("ขอลิงก์ใหม่จากผู้ส่งรายงาน", "Ask the sender for a new link", "请向报表发送者索取新链接")}</p></div></div>;
  if (!data) return <div className="min-h-screen grid place-items-center bg-bg"><Loader2 className="animate-spin text-muted" /></div>;
  const m = data.payload.model, meta = data.payload.meta;
  const when = (s: string) => new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <span className="h-11 w-11 rounded-2xl bg-brand/10 text-brand grid place-items-center"><BarChart3 size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold truncate">{data.title}</h1>
            <p className="text-xs text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>{L("ช่วง", "Period", "期间")} {meta.range}</span>{meta.filters ? <span>{meta.filters}</span> : null}
              <span className="inline-flex items-center gap-1"><Clock size={11} />{L("ข้อมูล ณ", "Data as of", "数据截至")} {when(meta.generated_at)}{data.by ? <>{L(" · แชร์โดย ", " · shared by ", " · 分享者 ")}<span translate="no">{data.by}</span></> : ""}</span>
            </p>
          </div>
          <DownloadMenu target={() => ref.current} filename={() => `shared-report-${meta.generated_at.slice(0, 10)}`} />
        </header>
        <div ref={ref} className="space-y-3">
          <div className="hidden print:block text-sm font-semibold">{data.title} · {meta.range}</div>
          <OverviewView m={m} />
        </div>
        <p className="text-[11px] text-muted flex items-center gap-1.5"><ShieldCheck size={12} />{L("ภาพนิ่งของรายงาน ณ เวลาที่แชร์ · ไม่มีข้อมูลส่วนตัวลูกค้า · ลิงก์หมดอายุ", "Report snapshot at time of sharing · no customer personal data · link expires", "分享时的报表快照 · 不含顾客个人信息 · 链接到期")} {when(data.expires_at)} {L("(ผู้แชร์ยกเลิกได้)", "(sharer can revoke)", "（分享者可撤销）")}</p>
      </div>
    </div>
  );
}
