"use client";

// =====================================================================
// ScopeTopbar — ตัวกรองแบรนด์/สาขาบน topbar (เลือกได้จริง + ค้นหา)
//   ขอบเขตจำกัดตามสิทธิ์พนักงาน (useAdminScope); null = ทุกแบรนด์/ทุกสาขา
// =====================================================================
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, Check, Layers, Store } from "lucide-react";
import { useAdminScope } from "@/components/admin/filters";
import { useScopeFilter } from "@/lib/store/scope-filter";

interface Opt { v: string; label: string }

function FilterDropdown({ icon, allLabel, opts, value, onChange, searchable }: {
  icon: React.ReactNode; allLabel: string; opts: Opt[]; value: string | null; onChange: (v: string | null) => void; searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const cur = value ? opts.find((o) => o.v === value)?.label ?? allLabel : allLabel;
  const term = q.trim().toLowerCase();
  const list = term ? opts.filter((o) => o.label.toLowerCase().includes(term)) : opts;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium hover:bg-surface2 ${value ? "text-brand bg-brand/8" : "text-ink"}`}>
        {icon}
        <span className="max-w-[120px] truncate">{cur}</span>
        <ChevronDown size={13} className="text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-xl border border-line bg-surface shadow-pop overflow-hidden z-50">
          {searchable && (
            <div className="relative p-2 border-b border-line">
              <Search size={13} className="absolute left-4 top-[14px] text-muted" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา…"
                className="w-full h-8 pl-7 pr-2 rounded-lg bg-surface2/60 border border-line outline-none text-xs focus:border-brand/40" />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            <li>
              <button onClick={() => { onChange(null); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface2 ${!value ? "text-brand font-semibold" : ""}`}>
                <span className="w-4">{!value ? <Check size={14} /> : null}</span>{allLabel}
              </button>
            </li>
            {list.map((o) => (
              <li key={o.v}>
                <button onClick={() => { onChange(o.v); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface2 ${value === o.v ? "text-brand font-semibold" : ""}`}>
                  <span className="w-4 text-brand">{value === o.v ? <Check size={14} /> : null}</span>
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-3 text-xs text-muted text-center">ไม่พบ</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScopeTopbar() {
  const { brands, branches } = useAdminScope();
  const { brandId, branchId, setBrand, setBranch } = useScopeFilter();
  return (
    <div className="hidden xl:flex items-center gap-1">
      <FilterDropdown icon={<Layers size={13} />} allLabel="ทุกแบรนด์" value={brandId} onChange={setBrand}
        opts={brands.map((b) => ({ v: b.id, label: b.name }))} searchable={brands.length > 8} />
      <FilterDropdown icon={<Store size={13} />} allLabel="ทุกสาขา" value={branchId} onChange={setBranch}
        opts={branches.map((b) => ({ v: b.id, label: b.name_th ?? b.name }))} searchable />
    </div>
  );
}
