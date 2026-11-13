"use client";

// คอมโพเนนต์ติดตามสถานะการโอนย้าย — ใช้ร่วมหน้า /pos/transfers และ /admin/transfers
import { Fragment } from "react";
import { ClipboardList, Check, ScanLine, Truck, PackageCheck, Ban } from "lucide-react";
import { statusMeta } from "@/lib/onewarehouse";
import type { Transfer, AuditEntry } from "@/lib/types";

type LFn = (th: string, en: string, zh: string) => string;
type Locale = "th" | "en" | "zh";

/** ขั้นปัจจุบันของการโอน (0..4) หรือ failed (ยกเลิก/ปฏิเสธ) */
export function transferStage(status: Transfer["status"]): { idx: number; failed: boolean } {
  if (status === "cancelled" || status === "rejected") return { idx: -1, failed: true };
  const order: Record<string, number> = {
    draft: 0, pending_approval: 0, approved: 1, picking: 1, packed: 2,
    shipped: 3, in_transit: 3, received: 4, partial_received: 4, completed: 4,
  };
  return { idx: order[status] ?? 0, failed: false };
}

/** แถบสเต็ปติดตามสถานะ (เหมือนติดตามพัสดุ) */
export function TransferStepper({ status, locale, L }: { status: Transfer["status"]; locale: Locale; L: LFn }) {
  const stages = [
    { icon: ClipboardList, label: L("สร้างคำขอ", "Created", "创建") },
    { icon: Check, label: L("อนุมัติ", "Approved", "批准") },
    { icon: ScanLine, label: L("สแกนออก", "Scanned out", "扫出") },
    { icon: Truck, label: L("ระหว่างทาง", "In transit", "运输中") },
    { icon: PackageCheck, label: L("รับเข้า", "Received", "收货") },
  ];
  const { idx, failed } = transferStage(status);
  const partial = status === "partial_received";
  if (failed) {
    return (
      <div className="rounded-xl bg-danger/8 border border-danger/25 text-danger text-xs px-3 py-2.5 flex items-center gap-2">
        <Ban size={15} /> {status === "cancelled" ? L("การโอนถูกยกเลิก — คืนของจองแล้ว", "Transfer cancelled", "已取消") : L("คำขอถูกปฏิเสธ — คืนของจองแล้ว", "Request rejected", "已拒绝")}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-line bg-surface2/30 px-3 py-4">
      <div className="flex items-start">
        {stages.map((s, i) => {
          const done = i < idx || (i === idx && idx === 4 && !partial);
          const cur = i === idx && !(idx === 4 && !partial);
          const warn = i === 4 && partial;
          const Icon = s.icon;
          return (
            <Fragment key={i}>
              <div className="flex flex-col items-center gap-1.5 shrink-0 w-14">
                <div className={`w-9 h-9 rounded-full grid place-items-center border-2 transition-all duration-300 ${
                  warn ? "bg-amber-500 border-amber-500 text-white"
                  : done ? "bg-brand border-brand text-white"
                  : cur ? "border-brand text-brand ring-4 ring-brand/15 bg-surface animate-[pulse_2s_ease-in-out_infinite]"
                  : "border-line text-muted bg-surface"}`}>
                  {done ? <Check size={16} /> : <Icon size={15} />}
                </div>
                <span className={`text-[9.5px] leading-tight text-center ${cur || warn ? "text-brand font-semibold" : done ? "text-ink" : "text-muted"}`}>{s.label}</span>
              </div>
              {i < stages.length - 1 ? <div className="flex-1 h-0.5 rounded-full mt-[18px] mx-0.5 overflow-hidden bg-line"><div className={`h-full rounded-full transition-all duration-500 ${i < idx ? "w-full bg-brand" : "w-0"}`} /></div> : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** ตัวติดตามรายสินค้า: ขอ → ส่ง → รับ (จำนวน + เส้นเชื่อม) */
export function ItemJourney({ req, shipped, received, L }: { req: number; shipped: number; received: number; L: LFn }) {
  const nodes = [
    { label: L("ขอ", "Req", "请求"), val: req, filled: req > 0 },
    { label: L("ส่ง", "Ship", "发"), val: shipped, filled: shipped > 0 },
    { label: L("รับ", "Recv", "收"), val: received, filled: received > 0 && received >= shipped },
  ];
  return (
    <div className="flex items-center mt-2">
      {nodes.map((n, i) => (
        <Fragment key={i}>
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <div className={`w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold tnum border ${n.filled ? (i === 2 ? "bg-ok border-ok text-white" : "bg-brand border-brand text-white") : "border-line text-muted"}`}>{n.val}</div>
            <span className="text-[9px] text-muted">{n.label}</span>
          </div>
          {i < nodes.length - 1 ? <div className="flex-1 h-0.5 rounded-full mx-1 mb-3 bg-line overflow-hidden"><div className={`h-full rounded-full ${nodes[i + 1].filled ? "w-full" : "w-0"} ${i === 1 && received >= shipped && shipped > 0 ? "bg-ok" : "bg-brand"}`} /></div> : null}
        </Fragment>
      ))}
    </div>
  );
}

/** Timeline จาก audit (เรียงเวลา + จุดสีตามสถานะ) */
export function TransferTimeline({ rows, locale, L }: { rows: AuditEntry[]; locale: Locale; L: LFn }) {
  if (!rows.length) return <div className="p-6 text-center text-sm text-muted">{L("ยังไม่มีประวัติ", "No history yet", "暂无记录")}</div>;
  const clock = (t: string) => new Date(t).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const toneColor: Record<string, string> = { ok: "bg-ok", warn: "bg-amber-500", danger: "bg-danger", brand: "bg-brand", neutral: "bg-muted", info: "bg-info" };
  return (
    <ol className="relative border-l border-line ml-6 my-5 mr-5 space-y-5">
      {rows.map((r, i) => {
        const st = (r.after_data as { status?: Transfer["status"] })?.status;
        const meta = st ? statusMeta(st, locale) : null;
        return (
          <li key={i} className="ml-5">
            <span className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 border-surface ${toneColor[meta?.tone ?? "neutral"] ?? "bg-muted"}`} />
            <p className="text-sm font-medium">{meta?.label ?? r.action}</p>
            <p className="text-[11px] text-muted">{clock(r.occurred_at)}{r.actor_name ? ` · ${r.actor_name}` : ""}</p>
          </li>
        );
      })}
    </ol>
  );
}
