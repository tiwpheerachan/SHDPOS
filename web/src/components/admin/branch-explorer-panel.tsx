"use client";

// =====================================================================
// แผงสำรวจสาขา (ข้างแผนที่ยอดขาย) — ค้นหา + กรองโซน(แบรนด์) + เรียง
//   คลิกสาขา = กรองแดชบอร์ด (toggle ใน filter.branchIds) · ไฮไลต์ตัวที่เลือก
// =====================================================================

import { useMemo, useState } from "react";
import { Search, ArrowDownUp } from "lucide-react";
import { formatCompact } from "@/lib/money";
import { useI18n } from "@/lib/i18n/provider";

export interface BranchRow {
  id: string;
  label: string;
  brandId: string | null;
  brandName: string | null;
  province: string | null;
  sales: number;
  orders: number;
}
type SortKey = "value_desc" | "value_asc" | "name" | "orders_desc";

export function BranchExplorerPanel({
  rows, zones, metric, selectedIds, onToggle,
}: {
  rows: BranchRow[];
  zones: { id: string; name: string }[]; // โซน = แบรนด์ที่มีสาขา
  metric: "sales" | "orders";
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [q, setQ] = useState("");
  const [zone, setZone] = useState<string>("all"); // brandId | "all"
  const [sort, setSort] = useState<SortKey>("value_desc");

  const valOf = (b: BranchRow) => (metric === "sales" ? b.sales : b.orders);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((b) => {
      if (zone !== "all" && b.brandId !== zone) return false;
      if (needle && !(`${b.label} ${b.province ?? ""} ${b.brandName ?? ""}`.toLowerCase().includes(needle))) return false;
      return true;
    });
    out = out.sort((a, b) => {
      if (sort === "name") return a.label.localeCompare(b.label, "th");
      if (sort === "value_asc") return valOf(a) - valOf(b);
      if (sort === "orders_desc") return b.orders - a.orders;
      return valOf(b) - valOf(a); // value_desc
    });
    return out;
  }, [rows, q, zone, sort, metric]);

  const maxV = Math.max(1, ...list.map(valOf));
  const totalSales = useMemo(() => list.reduce((s, b) => s + b.sales, 0), [list]);

  const sortOpts: { k: SortKey; label: string }[] = [
    { k: "value_desc", label: L("ยอดมาก→น้อย", "Value high→low", "金额↓") },
    { k: "value_asc", label: L("ยอดน้อย→มาก", "Value low→high", "金额↑") },
    { k: "orders_desc", label: L("บิลมากสุด", "Most bills", "单据↓") },
    { k: "name", label: L("ชื่อ ก-ฮ", "Name A-Z", "名称") },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ค้นหา */}
      <div className="relative mb-2 shrink-0">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นชื่อสาขา…", "Search branch…", "搜索门店…")}
          className="w-full h-8 pl-8 pr-2 rounded-lg bg-surface2 border border-line text-xs outline-none focus:ring-2 focus:ring-brand/30" />
      </div>

      {/* โซน (แบรนด์) */}
      <div className="flex gap-1 overflow-x-auto pb-1.5 mb-1.5 shrink-0 -mx-0.5 px-0.5 no-scrollbar">
        <Chip active={zone === "all"} onClick={() => setZone("all")}>{L("ทุกโซน", "All", "全部")}</Chip>
        {zones.map((z) => (
          <Chip key={z.id} active={zone === z.id} onClick={() => setZone(z.id)}>{z.name}</Chip>
        ))}
      </div>

      {/* เรียง */}
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <ArrowDownUp size={13} className="text-muted shrink-0" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
          className="flex-1 h-7 px-2 rounded-lg bg-surface2 border border-line text-[11px] outline-none focus:ring-2 focus:ring-brand/30">
          {sortOpts.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
        </select>
      </div>

      {/* รายการ */}
      <ol className="space-y-1 flex-1 overflow-y-auto pr-1 -mr-1 min-h-0">
        {list.map((b, i) => {
          const on = selectedIds.includes(b.id);
          return (
            <li key={b.id}>
              <button onClick={() => onToggle(b.id)}
                className={`w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${on ? "bg-brand/10 ring-1 ring-brand/30" : "hover:bg-surface2"}`}>
                <span className="tnum text-[11px] text-muted w-4 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{b.label}</p>
                  <div className="mt-0.5 h-1 rounded-full bg-surface2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (valOf(b) / maxV) * 100)}%`, background: on ? "rgba(255,114,94,0.95)" : "rgb(var(--c-ink) / 0.35)" }} />
                  </div>
                </div>
                <span className="text-xs font-semibold tnum shrink-0">{metric === "sales" ? `฿${formatCompact(b.sales)}` : b.orders}</span>
              </button>
            </li>
          );
        })}
        {!list.length ? <li className="text-xs text-muted text-center py-4">{L("ไม่พบสาขา", "No branches", "无门店")}</li> : null}
      </ol>

      {/* สรุป */}
      <div className="flex items-center justify-between text-[10px] text-muted mt-2 pt-2 border-t border-line shrink-0">
        <span>{L(`${list.length} สาขา`, `${list.length} branches`, `${list.length} 门店`)}{selectedIds.length ? ` · ${L("เลือก", "sel", "选")} ${selectedIds.length}` : ""}</span>
        <span className="tnum">฿{formatCompact(totalSales)}</span>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 h-6 px-2.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${active ? "bg-brand text-white" : "bg-surface2 text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}
