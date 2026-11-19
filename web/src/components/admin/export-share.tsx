"use client";
// =====================================================================
// แถบปุ่ม "ดาวน์โหลด Excel + แชร์ลิงก์" ใช้ร่วมได้ทุกหน้าหลังบ้าน
//   <ExportShareBar filename="..." columns={[...]} rows={list} shareUrl? title? />
//   shareUrl ไม่ระบุ → คัดลอก URL หน้าปัจจุบัน
// =====================================================================
import { useState } from "react";
import { Download, Share2, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { downloadExcel, type ExcelCol } from "@/lib/export";

export function ExportShareBar<T>({ filename, columns, rows, title, shareUrl, share = true, size = "md", className }: {
  filename: string;
  columns: ExcelCol<T>[];
  rows: T[];
  title?: string;
  shareUrl?: string;
  share?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [copied, setCopied] = useState(false);
  const h = size === "sm" ? "h-9" : "h-10";

  function doShare() {
    const url = shareUrl ?? (typeof window !== "undefined" ? window.location.href : "");
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {share ? (
        <button onClick={doShare} className={`${h} px-3 rounded-xl border border-line bg-surface text-sm inline-flex items-center gap-1.5 hover:bg-surface2 transition-colors`}>
          {copied ? <Check size={15} className="text-emerald-500" /> : <Share2 size={15} />} {copied ? L("คัดลอกแล้ว", "Copied", "已复制") : L("แชร์ลิงก์", "Share", "分享")}
        </button>
      ) : null}
      <button onClick={() => downloadExcel(filename, columns, rows, title)} disabled={!rows.length} className={`${h} px-3 rounded-xl bg-ink text-white text-sm inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 transition-opacity`}>
        <Download size={15} /> {L("ดาวน์โหลด Excel", "Export Excel", "导出")}
      </button>
    </div>
  );
}
