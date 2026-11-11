"use client";

// การ์ดไดเรกทอรีทีม (ปรับจาก StackedList) — แอนิเมชันแผงล่างเด้งขยาย + ค้นหา
// ใช้ framer-motion + lucide + Avatar/โทเคนของระบบ (ไม่พึ่ง dep ใหม่)
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import { Search, X, Plus, Users } from "lucide-react";
import clsx from "clsx";
import { Avatar } from "@/components/ui";

export interface DirMember {
  id: string;
  name: string;
  photo_url?: string | null;
  roleLabel: string;
  sub?: string;      // บรรทัดสอง (ตำแหน่ง/สถานะ)
  online?: boolean;
  tone?: string;     // สีพื้น pill ตำแหน่ง (เช่น rgb(var(--c-lavender)))
}

const spring = { type: "spring" as const, stiffness: 400, damping: 35, mass: 0.5 };

function Row({ m, onPick }: { m: DirMember; onPick?: (id: string) => void }) {
  return (
    <motion.button
      type="button"
      onClick={() => onPick?.(m.id)}
      variants={{ hidden: { opacity: 0, x: 10, y: 15 }, visible: { opacity: 1, x: 0, y: 0 } }}
      transition={spring}
      className="flex items-center w-full text-left group py-2.5 px-2 -mx-2 rounded-xl border-b border-line/40 last:border-0 hover:bg-surface2/60 transition-colors"
    >
      <div className="relative mr-3 shrink-0">
        <Avatar name={m.name} src={m.photo_url} size={44} />
        {m.online ? (
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-surface rounded-full grid place-items-center">
            <span className="w-2 h-2 bg-ok rounded-full" />
          </span>
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate leading-tight">{m.name}</p>
        <p className="text-xs text-muted truncate mt-0.5 leading-tight">{m.sub ?? m.roleLabel}</p>
      </div>
      <span
        className="shrink-0 ml-2 text-[10px] font-semibold tracking-wide px-2.5 py-1 rounded-full border border-line/60 text-ink/80 whitespace-nowrap max-w-[96px] truncate"
        style={m.tone ? { background: m.tone } : undefined}
      >
        {m.roleLabel}
      </span>
    </motion.button>
  );
}

export function TeamDirectory({
  title,
  featured,
  all,
  featuredCount,
  directoryTitle,
  directorySub,
  searchPlaceholder = "ค้นหาพนักงาน…",
  emptyFeatured = "—",
  onPick,
  onAdd,
  className,
}: {
  title: string;
  featured: DirMember[];
  all: DirMember[];
  featuredCount?: number;
  directoryTitle?: string;
  directorySub?: string;
  searchPlaceholder?: string;
  emptyFeatured?: string;
  onPick?: (id: string) => void;
  onAdd?: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () =>
      all.filter(
        (m) =>
          m.name.toLowerCase().includes(q.toLowerCase()) ||
          (m.sub ?? "").toLowerCase().includes(q.toLowerCase()) ||
          m.roleLabel.toLowerCase().includes(q.toLowerCase())
      ),
    [all, q]
  );

  return (
    <div className={clsx("relative w-full max-w-[460px] h-[420px] bg-surface rounded-[30px] border border-line flex flex-col overflow-hidden", className)}>
      {/* บน: รายการเด่น (อยู่ในผัง) */}
      <div className="p-6 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            {title}
            <span className="text-xs bg-surface2 px-2 py-0.5 rounded-full text-muted font-normal">{featuredCount ?? featured.length}</span>
          </h2>
          {onAdd ? (
            <button onClick={onAdd} className="h-9 w-9 rounded-full border border-line text-muted hover:bg-surface2 grid place-items-center transition-colors" aria-label="add">
              <Plus size={18} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-24">
        <motion.div initial={false} animate="visible" variants={{ visible: { transition: { staggerChildren: 0.04 } } }} className="space-y-0.5">
          {featured.length ? featured.map((m) => <Row key={"f" + m.id} m={m} onPick={onPick} />) : <p className="text-sm text-muted text-center py-10">{emptyFeatured}</p>}
        </motion.div>
      </div>

      {/* ล่าง: แผงไดเรกทอรีเด้งขยาย */}
      <motion.div
        layout
        initial={false}
        animate={{
          height: expanded ? "calc(100% - 20px)" : "68px",
          width: expanded ? "calc(100% - 20px)" : "calc(100% - 40px)",
          bottom: expanded ? 10 : 20,
          left: expanded ? 10 : 20,
          borderRadius: expanded ? 26 : 20,
        }}
        transition={{ type: "spring", stiffness: 240, damping: 30, mass: 0.8 }}
        className="absolute z-40 overflow-hidden border border-line bg-surface2/85 backdrop-blur flex flex-col shadow-pop"
        style={{ cursor: expanded ? "default" : "pointer" }}
        onClick={() => !expanded && setExpanded(true)}
      >
        <div className={clsx("flex items-center justify-between px-3 h-[68px] shrink-0 transition-colors", expanded ? "border-b border-line/50" : "hover:bg-surface/40")}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-surface border border-line grid place-items-center text-muted shrink-0">
              <Users size={20} />
            </div>
            <motion.div layout="position" className="min-w-0">
              <p className="text-sm font-medium leading-none truncate">{directoryTitle ?? "ไดเรกทอรีพนักงาน"}</p>
              <p className="text-xs text-muted mt-1 leading-none truncate">{directorySub ?? `${all.length} คนในสาขา`}</p>
            </motion.div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!expanded ? (
              <div className="flex -space-x-3 items-center">
                {all.slice(0, 3).map((m) => (
                  <span key={m.id} className="rounded-full ring-2 ring-surface">
                    <Avatar name={m.name} src={m.photo_url} size={36} />
                  </span>
                ))}
                {all.length > 3 ? (
                  <span className="w-9 h-9 rounded-full ring-2 ring-surface bg-surface2 grid place-items-center text-xs text-muted relative z-0">+{all.length - 3}</span>
                ) : null}
              </div>
            ) : (
              <button
                className="h-9 w-9 rounded-xl text-muted hover:text-ink bg-surface/70 grid place-items-center active:scale-90 transition-all"
                onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                aria-label="close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <AnimatePresence>
            {expanded ? (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="px-5 py-3">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-10 w-full pl-9 pr-3 rounded-xl bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="flex-1 overflow-y-auto px-5 pb-3">
            <motion.div
              initial="hidden"
              animate={expanded ? "visible" : "hidden"}
              variants={{ visible: { transition: { staggerChildren: 0.03, delayChildren: 0.08 } }, hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } } }}
              className="space-y-0.5"
            >
              {filtered.map((m) => <Row key={"l" + m.id} m={m} onPick={onPick} />)}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
