"use client";

import React from "react";
import clsx from "clsx";
import { Sliders, Check, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * โครงหน้า POS แบบเต็มจอ (ไม่เป็นกรอบลอยกลางจอ)
 * - สูงเต็ม viewport ใต้ top bar (h-14 = 3.5rem)
 * - แถบหัวเรื่อง sticky เต็มความกว้าง + พื้นที่ actions ด้านขวา
 * - เนื้อหาเลื่อนภายในตัวเอง กินพื้นที่ที่เหลือทั้งหมด
 */
export function PosPage({
  title,
  icon,
  actions,
  children,
  bodyClassName,
  scroll = true,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  scroll?: boolean;
}) {
  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col">
      <div className="shrink-0 min-h-[3.5rem] border-b border-line bg-surface/95 backdrop-blur flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6 py-2.5">
        <h1 className="text-base font-semibold flex items-center gap-2 shrink-0">
          {icon ? <span className="text-muted">{icon}</span> : null}
          {title}
        </h1>
        {actions ? <div className="ml-auto flex items-center gap-2 flex-wrap">{actions}</div> : null}
      </div>
      <div className={clsx("flex-1 min-h-0 page-enter", scroll && "overflow-auto", bodyClassName)}>{children}</div>
    </div>
  );
}

/** ป้ายสถิติเล็ก ๆ สำหรับแถบสรุปเหนือตาราง */
const CHIP_ACCENT: Record<string, string> = {
  coral: "bg-coral/15",
  lavender: "bg-lavender/20",
  mint: "bg-mint/45",
  peach: "bg-peach/45",
  lime: "bg-lime/35",
  neutral: "bg-surface2",
};

export function StatChip({
  label,
  value,
  accent = "neutral",
  icon,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  accent?: "coral" | "lavender" | "mint" | "peach" | "lime" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <span className={clsx("w-9 h-9 rounded-xl grid place-items-center shrink-0 text-ink", CHIP_ACCENT[accent])}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted truncate">{label}</p>
        <p className="text-lg font-semibold tnum leading-tight truncate">{value}</p>
      </div>
    </div>
  );
}

/** เมนูปรับแต่งคอลัมน์ (Customize Columns) */
export function ColumnMenu({
  columns, hidden, onToggle, label = "Columns",
}: {
  columns: { key: string; label: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost h-9 px-3 text-xs">
        <Sliders size={14} /> {label}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-50 w-52 bg-surface border border-line rounded-xl shadow-pop py-1.5">
            {columns.map((c) => {
              const on = !hidden.has(c.key);
              return (
                <button key={c.key} onClick={() => onToggle(c.key)} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-surface2">
                  <span className={clsx("w-4 h-4 rounded border grid place-items-center shrink-0", on ? "bg-brand border-brand text-brandInk" : "border-line")}>{on ? <Check size={11} /> : null}</span>
                  {c.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** ตัวแบ่งหน้า (Pagination) */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2 text-xs text-muted">
      <span className="tnum">{from}–{to} / {total}</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 0} onClick={() => onPage(page - 1)} className="h-8 w-8 grid place-items-center rounded-lg border border-line disabled:opacity-40 hover:bg-surface2"><ChevronLeft size={15} /></button>
        <span className="tnum px-2">{page + 1} / {pages}</span>
        <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="h-8 w-8 grid place-items-center rounded-lg border border-line disabled:opacity-40 hover:bg-surface2"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

/** พาเนลตารางเต็มความกว้าง หัวตารางลอยติดบน (sticky) */
export function TablePanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "bg-surface border border-line rounded-2xl overflow-hidden",
        "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-surface [&_thead_th]:z-10",
        className
      )}
    >
      {children}
    </div>
  );
}
