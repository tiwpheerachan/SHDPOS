"use client";
// =====================================================================
// แถบมุมมองแบบ Lark เหนือตาราง — แต่ละแท็บ = ตัวกรอง + คอลัมน์ + การตรึง + เรียง ที่บันทึกไว้
//   + สร้างมุมมองใหม่ · ดับเบิลคลิก/เมนู ⋯ = เปลี่ยนชื่อ/แชร์ทีม/บันทึกการเปลี่ยนแปลง/ทำสำเนา/ลบ
//   จำแท็บล่าสุดที่เปิด (เปิดหน้ามาใหม่กลับไปแท็บเดิม) + "มุมมองทั้งหมด" เรียงตามที่เคยเข้าล่าสุด
//   เก็บใน pos_report_views (report = sales_sheet) — ของตัวเอง + ที่เพื่อนแชร์ให้ทีม
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Table2, Plus, MoreHorizontal, Pencil, Users, Lock, Save, Copy, Trash2, ChevronDown, Check, History } from "lucide-react";
import { tr } from "@/lib/i18n/tr";

export type SheetViewState = Record<string, unknown>;
type View = { id: string; name: string; state: SheetViewState; shared: boolean; mine: boolean; owner: string; updated_at: string };
const REPORT = "sales_sheet";
const LS_ACTIVE = "shdpos.sheetView.active", LS_RECENT = "shdpos.sheetView.recent", LS_ORDER = "shdpos.sheetView.order";
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
const stable = (s: unknown) => JSON.stringify(s, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

async function api(method: "POST" | "DELETE", body?: unknown, id?: string) {
  const r = await fetch(`/api/admin/report-views${id ? `?id=${id}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify({ report: REPORT, ...(body as object) }) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export function SheetViewTabs({ capture, apply }: { capture: () => SheetViewState; apply: (s: SheetViewState | null) => void }) {
  const [views, setViews] = useState<View[] | null>(null);
  const [active, setActive] = useState<string>(() => (typeof window === "undefined" ? "" : read(LS_ACTIVE, "")));
  const [recent, setRecent] = useState<Record<string, number>>(() => (typeof window === "undefined" ? {} : read(LS_RECENT, {})));
  const [order, setOrder] = useState<string[]>(() => (typeof window === "undefined" ? [] : read(LS_ORDER, [])));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [all, setAll] = useState<DOMRect | null>(null);
  const [err, setErr] = useState("");
  const [, force] = useState(0);
  const applied = useRef(false);

  const load = useCallback(async () => {
    try { const r = await fetch(`/api/admin/report-views?report=${REPORT}`, { cache: "no-store" }); const j = await r.json(); setViews(r.ok ? j.views : []); }
    catch { setViews([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // เปิดหน้ามาใหม่ → กลับไปแท็บที่เปิดล่าสุด
  useEffect(() => {
    if (!views || applied.current) return;
    applied.current = true;
    const v = views.find((x) => x.id === active);
    if (v) apply(v.state); else if (active) setActive("");
  }, [views]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const list = views ?? [];
    const pos = (id: string) => { const i = order.indexOf(id); return i < 0 ? 1e6 : i; };
    return [...list].sort((a, b) => pos(a.id) - pos(b.id) || a.name.localeCompare(b.name, "th"));
  }, [views, order]);
  const cur = sorted.find((v) => v.id === active) ?? null;
  // ตรวจว่ามีการเปลี่ยนแปลงที่ยังไม่บันทึก (เช็กใหม่ทุกครั้งที่ตารางเรนเดอร์ใหม่ผ่าน capture)
  const dirty = !!cur && cur.mine && stable(cur.state) !== stable(capture());

  function open(id: string) {
    setActive(id); write(LS_ACTIVE, id);
    if (id) { const r = { ...recent, [id]: Date.now() }; setRecent(r); write(LS_RECENT, r); }
    const v = sorted.find((x) => x.id === id);
    apply(v ? v.state : null);
  }
  async function create(base?: View) {
    try {
      const n = (views ?? []).filter((v) => v.mine).length + 1;
      const name = base ? `${base.name} (${tr("สำเนา", "copy", "副本")})` : tr(`มุมมอง ${n}`, `View ${n}`, `视图 ${n}`);
      const j = await api("POST", { name, state: base ? base.state : capture(), shared: false });
      const o = [...order, j.id]; setOrder(o); write(LS_ORDER, o);
      await load(); setActive(j.id); write(LS_ACTIVE, j.id); setRenaming(j.id);
      if (base) apply(base.state);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function update(v: View, patch: Partial<Pick<View, "name" | "shared" | "state">>) {
    try { await api("POST", { id: v.id, name: patch.name ?? v.name, shared: patch.shared ?? v.shared, state: patch.state ?? v.state }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function remove(v: View) {
    try { await api("DELETE", undefined, v.id); if (active === v.id) open(""); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const tabCls = (on: boolean) => `group relative h-9 px-3 inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap border-b-2 transition-colors ${on ? "border-brand text-ink font-semibold" : "border-transparent text-muted hover:text-ink hover:bg-surface2/60"}`;
  return (
    <div className="flex items-end gap-0.5 px-2 border-b border-line overflow-x-auto" onMouseEnter={() => force((x) => x + 1)}>
      <button onClick={() => open("")} className={tabCls(!active)}><Table2 size={13} />{tr("ตารางหลัก", "Main grid", "主表")}</button>
      {sorted.map((v) => (
        <div key={v.id} className={tabCls(active === v.id)} onDoubleClick={() => v.mine && setRenaming(v.id)}>
          {renaming === v.id ? (
            <input autoFocus defaultValue={v.name} maxLength={80} onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => { const n = e.currentTarget.value.trim(); setRenaming(null); if (n && n !== v.name) void update(v, { name: n }); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
              className="h-7 w-36 px-1.5 rounded-md border-2 border-brand bg-surface text-[12.5px] outline-none" />
          ) : (
            <button onClick={() => open(v.id)} className="inline-flex items-center gap-1.5" title={v.mine ? tr("ดับเบิลคลิกเพื่อเปลี่ยนชื่อ", "Double-click to rename", "双击重命名") : tr(`แชร์โดย ${v.owner}`, `Shared by ${v.owner}`, `由 ${v.owner} 共享`)}>
              {v.shared ? <Users size={12} className={active === v.id ? "text-brand" : ""} /> : <Table2 size={13} />}
              <span className="max-w-[180px] truncate" translate="no">{v.name}</span>
              {active === v.id && dirty ? <span className="w-1.5 h-1.5 rounded-full bg-warn" title={tr("มีการเปลี่ยนแปลงที่ยังไม่บันทึก", "Unsaved changes", "有未保存的更改")} /> : null}
            </button>
          )}
          {active === v.id && renaming !== v.id ? (
            <button aria-label={tr("ตัวเลือกมุมมอง", "View options", "视图选项")} onClick={(e) => setMenu({ id: v.id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
              className="h-6 w-6 -mr-1 grid place-items-center rounded-md hover:bg-surface2"><MoreHorizontal size={14} /></button>
          ) : null}
        </div>
      ))}
      <button onClick={() => void create()} title={tr("บันทึกตัวกรอง/คอลัมน์ตอนนี้เป็นมุมมองใหม่", "Save the current filters/columns as a new view", "将当前筛选/列保存为新视图")} className="h-9 w-9 grid place-items-center text-muted hover:text-brand shrink-0"><Plus size={15} /></button>
      {dirty && cur ? (
        <button onClick={() => void update(cur, { state: capture() })} className="mb-1 h-7 px-2.5 rounded-lg bg-brand text-brandInk text-[11.5px] font-medium inline-flex items-center gap-1 shrink-0"><Save size={12} />{tr("บันทึกการเปลี่ยนแปลง", "Save changes", "保存更改")}</button>
      ) : null}
      <span className="flex-1" />
      {(views ?? []).length ? (
        <button onClick={(e) => setAll((e.currentTarget as HTMLElement).getBoundingClientRect())} className="mb-1 h-7 px-2.5 rounded-lg text-[11.5px] text-muted hover:text-ink hover:bg-surface2 inline-flex items-center gap-1 shrink-0">
          <History size={12} />{tr("มุมมองทั้งหมด", "All views", "全部视图")}<ChevronDown size={12} />
        </button>
      ) : null}

      {menu ? (() => {
        const v = sorted.find((x) => x.id === menu.id);
        if (!v) return null;
        return <Pop rect={menu.rect} onClose={() => setMenu(null)}>
          {v.mine ? <>
            <Item icon={<Pencil size={13} />} label={tr("เปลี่ยนชื่อ", "Rename", "重命名")} onClick={() => { setMenu(null); setRenaming(v.id); }} />
            <Item icon={<Save size={13} />} label={tr("บันทึกตัวกรอง/คอลัมน์ตอนนี้ลงมุมมองนี้", "Save current setup to this view", "将当前设置保存到此视图")} onClick={() => { setMenu(null); void update(v, { state: capture() }); }} />
            <Item icon={v.shared ? <Lock size={13} /> : <Users size={13} />} label={v.shared ? tr("เลิกแชร์ (เห็นเฉพาะฉัน)", "Make private", "设为私有") : tr("แชร์ให้ทีมเห็น", "Share with team", "与团队共享")} onClick={() => { setMenu(null); void update(v, { shared: !v.shared }); }} />
          </> : <p className="px-2.5 py-1.5 text-[11px] text-muted">{tr(`แชร์โดย ${v.owner} — แก้ไม่ได้ ทำสำเนาไปแก้ได้`, `Shared by ${v.owner} — duplicate to edit`, `由 ${v.owner} 共享 — 复制后可编辑`)}</p>}
          <Item icon={<Copy size={13} />} label={tr("ทำสำเนา", "Duplicate", "复制")} onClick={() => { setMenu(null); void create(v); }} />
          {v.mine ? <Item danger icon={<Trash2 size={13} />} label={tr("ลบมุมมอง", "Delete view", "删除视图")} onClick={() => { setMenu(null); void remove(v); }} /> : null}
        </Pop>;
      })() : null}

      {all ? (
        <Pop rect={all} onClose={() => setAll(null)} right>
          <p className="px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold text-muted">{tr("เรียงตามที่เปิดล่าสุด", "Recently opened first", "按最近打开排序")}</p>
          {[...sorted].sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0)).map((v) => (
            <button key={v.id} onClick={() => { setAll(null); open(v.id); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-left">
              {v.shared ? <Users size={12} className="text-muted shrink-0" /> : <Table2 size={12} className="text-muted shrink-0" />}
              <span className="flex-1 min-w-0 truncate text-[12.5px]" translate="no">{v.name}</span>
              <span className="text-[10.5px] text-muted shrink-0">{recent[v.id] ? ago(recent[v.id]) : tr("ยังไม่เคยเปิด", "never", "未打开")}</span>
              {active === v.id ? <Check size={12} className="text-brand shrink-0" /> : null}
            </button>
          ))}
        </Pop>
      ) : null}
      {err ? <span className="mb-1.5 text-[11px] text-danger shrink-0" onClick={() => setErr("")}>{err}</span> : null}
    </div>
  );
}

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? tr("เมื่อกี้", "just now", "刚刚") : m < 60 ? tr(`${m} นาทีที่แล้ว`, `${m} min ago`, `${m} 分钟前`) : m < 1440 ? tr(`${Math.round(m / 60)} ชม.ที่แล้ว`, `${Math.round(m / 60)} h ago`, `${Math.round(m / 60)} 小时前`) : tr(`${Math.round(m / 1440)} วันที่แล้ว`, `${Math.round(m / 1440)} d ago`, `${Math.round(m / 1440)} 天前`); };

function Pop({ rect, onClose, children, right }: { rect: DOMRect; onClose: () => void; children: React.ReactNode; right?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);
  return createPortal(
    <div ref={box} style={{ top: rect.bottom + 4, left: right ? Math.max(8, rect.right - 280) : Math.min(rect.left, window.innerWidth - 288) }} className="fixed z-[90] w-[280px] max-h-[60vh] overflow-auto bg-surface border border-line rounded-xl shadow-pop p-1.5">{children}</div>,
    document.body,
  );
}
function Item({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[12.5px] ${danger ? "text-danger hover:bg-danger/5" : "hover:bg-surface2"}`}>{icon}{label}</button>;
}
