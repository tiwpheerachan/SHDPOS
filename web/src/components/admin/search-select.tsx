"use client";

// =====================================================================
// SearchSelect — multi-select แบบค้นหาได้ (สำหรับสาขา/แบรนด์ที่มีจำนวนมาก)
//   ว่าง = "ทุก…" (ไม่จำกัด) · เลือกได้หลายรายการ · มีช่องค้นหา
// =====================================================================
import { useEffect, useRef, useState } from "react";
import { Search, Check, ChevronDown, X } from "lucide-react";

export interface SSOption { v: string; label: string; sub?: string }

export function SearchSelect({
  allLabel,
  options,
  selected,
  onChange,
  placeholder = "ค้นหา…",
}: {
  allLabel: string;
  options: SSOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const sel = new Set(selected);
  const term = q.trim().toLowerCase();
  const filtered = term
    ? options.filter((o) => o.label.toLowerCase().includes(term) || (o.sub ?? "").toLowerCase().includes(term))
    : options;
  const toggle = (v: string) => onChange(sel.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const summary = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.map((v) => options.find((o) => o.v === v)?.label ?? v).join(", ")
      : `เลือก ${selected.length} รายการ`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink flex items-center gap-2 hover:border-brand/40">
        <span className={`flex-1 text-left truncate ${selected.length === 0 ? "text-muted" : ""}`}>{summary}</span>
        {selected.length > 0 && (
          <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onChange([]); }}
            className="text-muted hover:text-danger"><X size={14} /></span>
        )}
        <ChevronDown size={15} className="text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-line bg-surface shadow-pop overflow-hidden">
          <div className="relative p-2 border-b border-line">
            <Search size={14} className="absolute left-4 top-4 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
              className="w-full h-9 pl-8 pr-2 rounded-lg bg-surface2/60 border border-line outline-none text-sm focus:border-brand/40" />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            <li>
              <button type="button" onClick={() => { onChange([]); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface2 ${selected.length === 0 ? "text-brand font-semibold" : ""}`}>
                <span className="w-4">{selected.length === 0 ? <Check size={14} /> : null}</span>
                {allLabel}
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o.v}>
                <button type="button" onClick={() => toggle(o.v)}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface2">
                  <span className="w-4 text-brand">{sel.has(o.v) ? <Check size={14} /> : null}</span>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.sub && <span className="text-[11px] text-muted">{o.sub}</span>}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-3 text-xs text-muted text-center">ไม่พบ</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
