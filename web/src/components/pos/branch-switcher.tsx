"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";
import clsx from "clsx";
import { useSession } from "@/lib/store/session";
import { useI18n } from "@/lib/i18n/provider";
import { listBranches, getTerminalForBranch } from "@/lib/data/repo";
import { visibleBranchIds } from "@/lib/permissions";
import type { Branch } from "@/lib/types";

/**
 * ตัวสลับ "สาขาปัจจุบัน" บนแถบ POS
 *  - คนสาขาเดียว → แสดงชื่อสาขานิ่งๆ (เลือกให้อัตโนมัติ)
 *  - คนหลายสาขา/ทุกสาขา → กดเพื่อสลับสาขาได้
 *  - ยังไม่เลือก → ปุ่มสีเน้น "เลือกสาขา"
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { employee, branchId, setBranch } = useSession();
  const { pick, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listBranches().then((b) => setBranches(b.filter((x) => x.branch_type !== "warehouse")));
  }, []);

  const visible = useMemo(() => {
    const ids = new Set(visibleBranchIds(employee, branches.map((b) => b.id)));
    return branches.filter((b) => ids.has(b.id));
  }, [employee, branches]);

  async function choose(id: string) {
    setBusy(true);
    try {
      const terminal = await getTerminalForBranch(id);
      setBranch(id, terminal?.id ?? null);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  // สาขาเดียว + ยังไม่เลือก → เลือกให้อัตโนมัติ
  useEffect(() => {
    if (!branchId && visible.length === 1) void choose(visible[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, visible]);

  // ปิด dropdown เมื่อคลิกนอกพื้นที่
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = branches.find((b) => b.id === branchId) ?? null;
  const label = current ? pick({ th: current.name_th ?? current.name, en: current.name, zh: current.name }) : L("เลือกสาขา", "Select branch", "选择门店");
  const switchable = visible.length > 1;
  const needsPick = !branchId;

  // สาขาเดียว (เลือกให้แล้ว) → แสดงนิ่งๆ ไม่ต้องกด
  if (!switchable && !needsPick) {
    return (
      <div className={clsx("flex items-center gap-1.5 text-muted min-w-0", className)}>
        <Building2 size={14} className="shrink-0" />
        <span className="text-[11px] font-medium truncate max-w-[160px]">{label}</span>
      </div>
    );
  }

  return (
    <div className={clsx("relative", className)} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy || visible.length === 0}
        className={clsx(
          "flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors min-w-0",
          needsPick
            ? "bg-brand/12 text-brand ring-1 ring-brand/30 hover:bg-brand/20"
            : "bg-surface2 text-ink hover:bg-surface2/70 ring-1 ring-line"
        )}
        title={L("เลือก/สลับสาขา", "Select / switch branch", "选择/切换门店")}
      >
        <Building2 size={14} className="shrink-0" />
        <span className="truncate max-w-[150px]">{label}</span>
        <ChevronDown size={13} className={clsx("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 mt-1.5 w-60 max-h-[60vh] overflow-y-auto bg-surface border border-line rounded-xl shadow-pop py-1.5 z-50">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted">{L("เลือกสาขาที่กำลังทำงาน", "Select your working branch", "选择当前门店")}</p>
          {visible.map((b) => {
            const active = b.id === branchId;
            return (
              <button
                key={b.id}
                onClick={() => void choose(b.id)}
                className={clsx(
                  "w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface2 transition-colors",
                  active && "text-brand font-semibold"
                )}
              >
                <Building2 size={14} className="shrink-0 text-muted" />
                <span className="flex-1 truncate">{pick({ th: b.name_th ?? b.name, en: b.name, zh: b.name })}</span>
                {active ? <Check size={14} className="shrink-0 text-brand" /> : null}
              </button>
            );
          })}
          {visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">{L("ไม่มีสาขาที่คุณมีสิทธิ์", "No branches available", "无可用门店")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
