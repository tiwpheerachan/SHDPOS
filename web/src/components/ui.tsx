"use client";

import React, { useEffect, useRef } from "react";
import clsx from "clsx";
import { X, Check, AlertTriangle, Info, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink truncate">{title}</h3>
        {subtitle ? <p className="text-xs text-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------
type ButtonVariant = "primary" | "ghost" | "soft" | "danger" | "ok";

export function Button({
  variant = "soft",
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  const cls = {
    primary: "btn-primary",
    ghost: "btn-ghost",
    soft: "btn-soft",
    danger: "btn-danger",
    ok: "btn-ok",
  }[variant];
  return (
    <button className={clsx(cls, className)} disabled={rest.disabled || loading} {...rest}>
      {loading ? <Loader2 size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Input / Select
// ---------------------------------------------------------------------
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={clsx("input", className)} {...rest} />;
  }
);

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx("input pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-muted mt-1">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "brand";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface2 text-muted border-line",
    ok: "bg-ok/10 text-ok border-ok/25",
    warn: "bg-warn/10 text-warn border-warn/25",
    danger: "bg-danger/10 text-danger border-danger/25",
    info: "bg-info/10 text-info border-info/25",
    brand: "bg-brand/10 text-brand border-brand/25",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={clsx(
          "relative w-full bg-surface border border-line rounded-t-2xl sm:rounded-2xl shadow-pop animate-slideUp",
          "max-h-[92vh] flex flex-col",
          width
        )}
      >
        {title ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
            <h3 className="text-base font-semibold">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface2 text-muted" aria-label="close">
              <X size={18} />
            </button>
          </div>
        ) : null}
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer ? <div className="px-5 py-4 border-t border-line flex gap-2 justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Drawer — แผงเลื่อนจากขวา (Detail Drawer มาตรฐานของทุก Entity)
// ---------------------------------------------------------------------
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
  width = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const w = { md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" }[width];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={clsx("relative w-full bg-surface border-l border-line shadow-pop h-full flex flex-col drawer-in", w)}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {title ? <h3 className="text-base font-semibold truncate">{title}</h3> : null}
              {badge}
            </div>
            {subtitle ? <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface2 text-muted shrink-0" aria-label="close">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer ? <div className="px-5 py-3 border-t border-line flex gap-2 flex-wrap shrink-0">{footer}</div> : null}
      </div>
    </div>
  );
}

/** แถบแท็บมาตรฐานใน Drawer (Overview / Timeline / Audit …) */
export function DrawerTabs<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 px-5 pt-3 border-b border-line overflow-x-auto sticky top-0 bg-surface z-10">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={clsx(
            "px-3 h-9 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
            value === o.value ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
          )}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** แถวข้อมูล key/value ใน Detail */
export function DetailRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="text-xs font-medium text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------
export type ToastTone = "ok" | "warn" | "danger" | "info";

export function Toast({
  tone,
  title,
  body,
  onClose,
}: {
  tone: ToastTone;
  title: string;
  body?: string;
  onClose?: () => void;
}) {
  const icon = {
    ok: <Check size={16} className="text-ok" />,
    warn: <AlertTriangle size={16} className="text-warn" />,
    danger: <AlertTriangle size={16} className="text-danger" />,
    info: <Info size={16} className="text-info" />,
  }[tone];
  return (
    <div className="flex items-start gap-3 bg-surface border border-line rounded-xl shadow-pop px-4 py-3 w-[min(92vw,380px)] animate-pop">
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {body ? <p className="text-xs text-muted mt-0.5 break-words">{body}</p> : null}
      </div>
      {onClose ? (
        <button onClick={onClose} className="text-muted hover:text-ink">
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// Empty / Loading
// ---------------------------------------------------------------------
export function EmptyState({ icon, title, body }: { icon?: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon ? <div className="text-muted mb-3">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="text-xs text-muted mt-1 max-w-sm">{body}</p> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={18} className={clsx("animate-spin text-muted", className)} />;
}

// ---------------------------------------------------------------------
// Skeleton — สถานะกำลังโหลด (shimmer)
// ---------------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton rounded-lg", className)} />;
}

/** แถวตารางจำลองระหว่างโหลด */
export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-2 py-1.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={clsx("h-4", c === 0 ? "w-28" : c === cols - 1 ? "w-16 ml-auto" : "flex-1 max-w-[160px]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Numpad — ใช้ทั้งใส่ PIN, จำนวนเงิน, จำนวนสินค้า
// ---------------------------------------------------------------------
export function Numpad({
  onDigit,
  onBackspace,
  onClear,
  onEnter,
  enterLabel = "OK",
  extra,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onEnter?: () => void;
  enterLabel?: string;
  extra?: React.ReactNode;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-2 select-none">
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => (k === "⌫" ? onBackspace() : onDigit(k))}
          className="h-14 rounded-xl bg-surface2 border border-line text-lg font-semibold active:scale-[0.97] transition-transform"
        >
          {k}
        </button>
      ))}
      <button onClick={onClear} className="h-14 rounded-xl bg-surface2 border border-line text-sm font-medium">
        C
      </button>
      {extra ?? <div />}
      {onEnter ? (
        <button onClick={onEnter} className="h-14 rounded-xl bg-brand text-brandInk text-sm font-semibold">
          {enterLabel}
        </button>
      ) : (
        <div />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// KPI tile — โทน accent เป็นชิปไอคอนเล็ก ตัวเลขหลักอยู่สีหมึกให้อ่านง่าย
// variant="ink" = การ์ดโทนเข้มสำหรับ KPI พระเอก (เช่น ยอดขายสุทธิ)
// ---------------------------------------------------------------------
export type KpiAccent = "coral" | "lime" | "lavender" | "mint" | "peach" | "neutral";

const ACCENT_BG: Record<KpiAccent, string> = {
  coral: "bg-coral/18 text-[rgb(var(--c-ink))]",
  lime: "bg-lime/40 text-[rgb(var(--c-ink))]",
  lavender: "bg-lavender/25 text-[rgb(var(--c-ink))]",
  mint: "bg-mint/55 text-[rgb(var(--c-ink))]",
  peach: "bg-peach/55 text-[rgb(var(--c-ink))]",
  neutral: "bg-surface2 text-muted",
};

/** map โทนเดิม (ใช้ในหน้าอื่น) → accent ชุดใหม่ เพื่อความเข้ากันได้ย้อนหลัง */
const LEGACY_TONE: Record<string, KpiAccent> = {
  neutral: "neutral",
  brand: "coral",
  ok: "mint",
  warn: "peach",
  danger: "coral",
};

export function KpiTile({
  label,
  value,
  sub,
  delta,
  accent,
  tone,
  icon,
  variant = "plain",
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  accent?: KpiAccent;
  /** @deprecated ใช้ accent แทน — คงไว้เพื่อความเข้ากันได้กับหน้าเดิม */
  tone?: "neutral" | "ok" | "warn" | "danger" | "brand";
  icon?: React.ReactNode;
  variant?: "plain" | "ink";
  spark?: React.ReactNode;
}) {
  const resolvedAccent: KpiAccent = accent ?? (tone ? LEGACY_TONE[tone] : "neutral");
  const ink = variant === "ink";
  return (
    <div className={clsx(ink ? "card-ink" : "card", "px-4 py-4 flex flex-col justify-between min-h-[118px]")}>
      <div className="flex items-start justify-between gap-2">
        <p className={clsx("eyebrow", ink && "text-brandInk/60")}>{label}</p>
        {icon ? (
          <span
            className={clsx(
              "w-7 h-7 rounded-full grid place-items-center shrink-0",
              ink ? "bg-brandInk/12 text-brandInk" : ACCENT_BG[resolvedAccent]
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className={clsx("mt-2 text-[28px] leading-none font-semibold tnum", ink ? "text-brandInk" : "text-ink")}>
        {value}
      </p>
      <div className="mt-2 flex items-center gap-2 min-h-[16px]">
        {typeof delta === "number" ? (
          <span
            className={clsx(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold tnum rounded-full px-1.5 py-0.5",
              delta >= 0
                ? ink ? "bg-mint/25 text-mint" : "bg-ok/12 text-ok"
                : ink ? "bg-coral/25 text-coral" : "bg-danger/12 text-danger"
            )}
          >
            {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
        {sub ? <span className={clsx("text-[11px]", ink ? "text-brandInk/55" : "text-muted")}>{sub}</span> : null}
        {spark ? <span className="ml-auto w-16 opacity-90">{spark}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Avatar — ตัวย่อชื่อพนักงาน/สาขา ระบายสีจากชื่อแบบ deterministic
// ---------------------------------------------------------------------
const AVA_TONES = [
  "bg-coral/20 text-[rgb(var(--c-ink))]",
  "bg-lavender/25 text-[rgb(var(--c-ink))]",
  "bg-mint/60 text-[rgb(var(--c-ink))]",
  "bg-peach/60 text-[rgb(var(--c-ink))]",
  "bg-lime/45 text-[rgb(var(--c-ink))]",
];

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name.trim().slice(0, 2).toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const tone = AVA_TONES[h % AVA_TONES.length];
  return (
    <span
      className={clsx("rounded-full grid place-items-center font-semibold shrink-0", tone, className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------
// Progress bar — แถบแนวนอนแบบ minimal
// ---------------------------------------------------------------------
export function ProgressBar({
  value,
  tone = "ink",
  height = 8,
  track,
}: {
  value: number; // 0..100
  tone?: "ink" | "coral" | "lime" | "lavender" | "mint" | "ok" | "warn" | "danger";
  height?: number;
  track?: boolean;
}) {
  const bg: Record<string, string> = {
    ink: "bg-brand",
    coral: "bg-coral",
    lime: "bg-lime",
    lavender: "bg-lavender",
    mint: "bg-mint",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  };
  return (
    <div className={clsx("w-full rounded-full overflow-hidden", track === false ? "" : "bg-surface2")} style={{ height }}>
      <div
        className={clsx("h-full rounded-full transition-all duration-500 ease-out", bg[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Section title — หัวข้อกลุ่มการ์ดแบบ editorial
// ---------------------------------------------------------------------
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <h2 className="text-[13px] font-semibold text-muted tracking-wide">{children}</h2>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------
// Live dot — จุดกระพริบสถานะเรียลไทม์
// ---------------------------------------------------------------------
export function LiveDot({ tone = "ok" }: { tone?: "ok" | "coral" | "warn" | "danger" }) {
  const c: Record<string, string> = { ok: "bg-ok", coral: "bg-coral", warn: "bg-warn", danger: "bg-danger" };
  return (
    <span className="relative inline-flex w-2 h-2">
      <span className={clsx("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", c[tone])} />
      <span className={clsx("relative inline-flex rounded-full w-2 h-2", c[tone])} />
    </span>
  );
}

// ---------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

export function Th({ children, align = "left", className }: { children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th
      className={clsx(
        "text-[11px] font-semibold uppercase tracking-wide text-muted px-3 py-2 border-b border-line whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className }: { children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <td
      className={clsx(
        "px-3 py-2.5 border-b border-line/70 align-middle",
        align === "right" && "text-right tnum",
        align === "center" && "text-center",
        className
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={clsx("inline-flex rounded-xl bg-surface2 border border-line p-0.5", size === "sm" ? "h-9" : "h-11")}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "px-3 rounded-[10px] text-sm font-medium transition-colors whitespace-nowrap",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
