"use client";

// แถบแท็บเอกสาร — โชว์หน้า/เอกสารที่เปิดค้างไว้ สลับ/ปิดได้ · ลงทะเบียนแท็บของหน้าปัจจุบันอัตโนมัติ
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import clsx from "clsx";
import { X, FileText, Layers } from "lucide-react";
import { useWorkspaceTabs } from "@/lib/store/workspace-tabs";

export function WorkspaceTabs({ baseLabel }: { baseLabel: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const { tabs, open, close, closeAll } = useWorkspaceTabs();

  const doc = sp.get("doc");
  const href = pathname + (doc ? `?doc=${doc}` : "");
  const label = doc ? `${doc}` : baseLabel;

  // ลงทะเบียนแท็บของหน้าปัจจุบัน (เฉพาะหน้า admin จริง ไม่เอา settings)
  useEffect(() => {
    if (pathname.startsWith("/admin")) open({ href, label, kind: doc ? "doc" : "page" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, label]);

  if (tabs.length < 2) return null; // โชว์เมื่อมีหลายแท็บเท่านั้น

  return (
    <div className="px-3 sm:px-5 pt-2">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <Layers size={14} className="text-muted shrink-0" />
        {tabs.map((tb) => {
          const active = tb.href === href;
          return (
            <div key={tb.href}
              className={clsx(
                "group/tab flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-lg border text-xs shrink-0 transition-colors cursor-pointer max-w-[200px]",
                active ? "bg-brand/10 border-brand/40 text-brand font-medium" : "bg-surface border-line text-muted hover:text-ink hover:border-line"
              )}
              onClick={() => { if (!active) router.push(tb.href); }}>
              {tb.kind === "doc" ? <FileText size={12} className="shrink-0" /> : null}
              <span className="truncate font-mono">{tb.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rest = tabs.filter((x) => x.href !== tb.href);
                  close(tb.href);
                  if (active) router.push(rest.length ? rest[rest.length - 1].href : "/admin");
                }}
                className="w-5 h-5 grid place-items-center rounded hover:bg-danger/15 hover:text-danger opacity-50 group-hover/tab:opacity-100 shrink-0"
                aria-label="close tab"
              ><X size={12} /></button>
            </div>
          );
        })}
        {tabs.length > 1 ? (
          <button onClick={closeAll} className="text-[11px] text-muted hover:text-danger px-2 h-8 shrink-0">ปิดทั้งหมด</button>
        ) : null}
      </div>
    </div>
  );
}
