"use client";
// dropdown เลือกได้หลายรายการ + ค้นหา + เลือกทั้งหมด/ล้าง · ว่าง = "ทั้งหมด" (ใช้ placeholder)
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export type MsOption = { value: string; label: string; sub?: string };
export function MultiSelect({ options, value, onChange, placeholder, label, className, noTranslate }: {
  options: MsOption[]; value: string[]; onChange: (v: string[]) => void; placeholder: string; label?: string; className?: string; noTranslate?: boolean;
}) {
  const { L } = useI18n();
  const [open, setOpen] = useState(false), [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    // Esc ปิดแค่ dropdown ไม่ให้ไปปิด Modal ที่ครอบอยู่
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", h);
    ref.current?.addEventListener("keydown", k);
    const el = ref.current;
    return () => { document.removeEventListener("mousedown", h); el?.removeEventListener("keydown", k); };
  }, [open]);
  const s = q.trim().toLowerCase();
  const list = useMemo(() => (s ? options.filter((o) => o.label.toLowerCase().includes(s) || (o.sub ?? "").toLowerCase().includes(s)) : options).slice(0, 300), [options, s]);
  const chosen = options.filter((o) => value.includes(o.value));
  const summary = !chosen.length ? placeholder : chosen.length <= 2 ? chosen.map((o) => o.label).join(", ") : `${chosen[0].label} +${chosen.length - 1}`;
  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {label ? <span className="block text-[11px] text-muted mb-1">{label}</span> : null}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={`w-full h-9 px-3 rounded-xl border bg-surface text-left text-[12.5px] inline-flex items-center gap-2 ${chosen.length ? "border-brand/50" : "border-line"}`}>
        <span className={`flex-1 truncate ${chosen.length ? "" : "text-muted"}`} translate={noTranslate ? "no" : undefined}>{summary}</span>
        {chosen.length ? <span className="text-[10.5px] px-1.5 rounded-full bg-brand/10 text-brand tnum">{chosen.length}</span> : null}
        {chosen.length ? <span role="button" tabIndex={-1} aria-label={L("ล้าง", "Clear", "清除")} onClick={(e) => { e.stopPropagation(); onChange([]); }} className="text-muted hover:text-ink"><X size={13} /></span> : null}
        <ChevronDown size={14} className="text-muted shrink-0" />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] bg-surface border border-line rounded-xl shadow-pop p-1.5">
          <div className="relative mb-1"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา", "Search", "搜索")} className="w-full h-8 pl-8 pr-2 rounded-lg border border-line bg-surface text-xs" /></div>
          <div className="flex justify-between px-1.5 py-1 text-[11px]">
            <button type="button" className="text-brand" onClick={() => onChange([...new Set([...value, ...list.map((o) => o.value)])])}>{L(s ? "เลือกทั้งหมดที่ค้นเจอ" : "เลือกทั้งหมด", s ? "Select found" : "Select all", "全选")}</button>
            <button type="button" className="text-muted hover:text-ink" onClick={() => onChange(s ? value.filter((v) => !list.some((o) => o.value === v)) : [])}>{L("ล้าง", "Clear", "清除")}</button>
          </div>
          <div className="max-h-60 overflow-auto" translate={noTranslate ? "no" : undefined}>
            {list.map((o) => { const on = value.includes(o.value); return (
              <button type="button" key={o.value} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 ${on ? "bg-brand/[0.07]" : "hover:bg-surface2"}`}>
                <span className={`h-4 w-4 rounded border grid place-items-center shrink-0 ${on ? "bg-brand border-brand text-brandInk" : "border-line"}`}>{on ? <Check size={11} /> : null}</span>
                <span className="flex-1 min-w-0 truncate">{o.label}{o.sub ? <span className="text-muted"> · {o.sub}</span> : null}</span>
              </button>); })}
            {!list.length ? <p className="px-2 py-3 text-xs text-muted">{L("ไม่พบรายการ", "No matches", "无匹配")}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
