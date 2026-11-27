"use client";
// =====================================================================
// ฟิลด์เพิ่มเองในตารางยอดขาย (แบบ Lark Base) — สร้างคอลัมน์ ข้อความ/ตัวเลข/ตัวเลือกมีสี/ติ๊ก/วันที่
//   กดช่องเพื่อกรอก/แก้ได้เลยเหมือน Excel (Enter บันทึก · Esc ยกเลิก) · ข้อมูลบิลจริงยังล็อก
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Type, Hash, ListChecks, CheckSquare, Calendar, Trash2, X, Check, Loader2 } from "lucide-react";
import { tr } from "@/lib/i18n/tr";
import { TagChip, TAG_BG } from "@/components/admin/sheet-tags";

export type FieldType = "text" | "number" | "select" | "checkbox" | "date";
export type FieldOpt = { id: string; label: string; color: number };
export type SalesField = { id: string; name: string; type: FieldType; options: FieldOpt[]; position: number };
type Values = Record<string, Record<string, unknown>>;

export const FIELD_TYPES: { type: FieldType; icon: typeof Type; label: () => string }[] = [
  { type: "text", icon: Type, label: () => tr("ข้อความ", "Text", "文本") },
  { type: "number", icon: Hash, label: () => tr("ตัวเลข", "Number", "数字") },
  { type: "select", icon: ListChecks, label: () => tr("ตัวเลือก (มีสี)", "Single select", "单选") },
  { type: "checkbox", icon: CheckSquare, label: () => tr("ติ๊กถูก", "Checkbox", "复选框") },
  { type: "date", icon: Calendar, label: () => tr("วันที่", "Date", "日期") },
];
export const fieldIcon = (t: FieldType) => FIELD_TYPES.find((x) => x.type === t)?.icon ?? Type;

async function post(body: unknown) {
  const r = await fetch("/api/admin/sales-fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export function useSalesFields() {
  const [fields, setFields] = useState<SalesField[]>([]);
  const [values, setValues] = useState<Values>({});
  const [canEdit, setCanEdit] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/sales-fields", { cache: "no-store" });
      if (!r.ok) { setReady(false); return; } // โหมดสาธิต/ไม่มีสิทธิ์ → ซ่อนฟีเจอร์
      const j = await r.json();
      setFields(j.fields ?? []); setValues(j.values ?? {}); setCanEdit(!!j.can_edit); setReady(true);
    } catch { setReady(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setValue = useCallback(async (orderKey: string, field: SalesField, value: unknown) => {
    const prev = values[orderKey]?.[field.id];
    setValues((v) => ({ ...v, [orderKey]: { ...(v[orderKey] ?? {}), [field.id]: value } }));
    try { await post({ action: "set", order_key: orderKey, field_id: field.id, value }); setError(""); }
    catch (e) { setValues((v) => ({ ...v, [orderKey]: { ...(v[orderKey] ?? {}), [field.id]: prev } })); setError(e instanceof Error ? e.message : String(e)); }
  }, [values]);
  const createField = useCallback(async (f: { name: string; type: FieldType; options: FieldOpt[] }) => { const j = await post({ action: "field_create", ...f }); setFields((x) => [...x, j.field]); return j.field as SalesField; }, []);
  const updateField = useCallback(async (id: string, patch: Partial<Pick<SalesField, "name" | "options">>) => { const j = await post({ action: "field_update", id, ...patch }); setFields((x) => x.map((f) => (f.id === id ? j.field : f))); }, []);
  const deleteField = useCallback(async (id: string) => { await post({ action: "field_delete", id }); setFields((x) => x.filter((f) => f.id !== id)); }, []);
  return { fields, values, canEdit, ready, error, setError, setValue, createField, updateField, deleteField, reload: load };
}

/** ค่าที่ใช้กรอง/เรียง/ส่งออก */
export function fieldText(f: SalesField, v: unknown): string | number | null {
  if (v === null || v === undefined || v === "") return f.type === "checkbox" ? "" : null;
  if (f.type === "select") return f.options.find((o) => o.id === v)?.label ?? "";
  if (f.type === "checkbox") return v ? "✓" : "";
  if (f.type === "number") return Number(v);
  return String(v);
}

/** ช่องในตาราง — แสดงค่า · กดเพื่อแก้ (ถ้ามีสิทธิ์) */
export function FieldCell({ field, value, editable, onSave }: { field: SalesField; value: unknown; editable: boolean; onSave: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pick, setPick] = useState<DOMRect | null>(null);
  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    if (field.type === "checkbox") { onSave(value ? null : true); return; }
    if (field.type === "select") { setPick((e.currentTarget as HTMLElement).getBoundingClientRect()); return; }
    setDraft(value == null ? "" : String(value)); setEditing(true);
  };
  const commit = () => { setEditing(false); const v = draft.trim(); if ((value ?? "") !== v) onSave(v === "" ? null : field.type === "number" ? Number(v) : v); };

  if (editing) {
    return (
      <input autoFocus type={field.type === "date" ? "date" : "text"} inputMode={field.type === "number" ? "decimal" : undefined} value={draft}
        onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(field.type === "number" ? e.target.value.replace(/[^\d.-]/g, "") : e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); e.stopPropagation(); }}
        className={`w-full min-w-[120px] h-7 px-1.5 -my-1 rounded-md border-2 border-brand bg-surface outline-none text-xs ${field.type === "number" ? "text-right tnum" : ""}`} />
    );
  }
  const opt = field.type === "select" ? field.options.find((o) => o.id === value) : null;
  return (
    <>
      <span onClick={start} role={editable ? "button" : undefined} tabIndex={editable ? 0 : undefined}
        onKeyDown={(e) => { if (editable && (e.key === "Enter" || e.key === "F2")) { e.preventDefault(); e.stopPropagation(); start(e as unknown as React.MouseEvent); } }}
        title={editable ? tr("กดเพื่อแก้ไข", "Click to edit", "点击编辑") : undefined}
        className={`flex items-center min-h-[22px] -mx-1 px-1 rounded ${editable ? "cursor-text hover:ring-1 hover:ring-brand/40 hover:bg-brand/[0.04]" : ""} ${field.type === "number" ? "justify-end tnum" : ""}`}>
        {field.type === "checkbox" ? (
          <span className={`w-4 h-4 rounded grid place-items-center border ${value ? "bg-brand border-brand text-white" : "border-line bg-surface"}`}>{value ? <Check size={11} strokeWidth={3} /> : null}</span>
        ) : opt ? <TagChip value={opt.label} tone={opt.color} />
          : value == null || value === "" ? <span className="text-muted/40">{editable ? "+" : "—"}</span>
          : field.type === "number" ? Number(value).toLocaleString("th-TH", { maximumFractionDigits: 2 }) : String(value)}
      </span>
      {pick ? <OptionPicker field={field} rect={pick} value={value as string | null} onClose={() => setPick(null)} onPick={(id) => { setPick(null); if (id !== value) onSave(id); }} /> : null}
    </>
  );
}

function usePopover(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);
  return box;
}

function OptionPicker({ field, rect, value, onClose, onPick }: { field: SalesField; rect: DOMRect; value: string | null; onClose: () => void; onPick: (id: string | null) => void }) {
  const box = usePopover(onClose);
  const [q, setQ] = useState("");
  const list = field.options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return createPortal(
    <div ref={box} onClick={(e) => e.stopPropagation()} style={{ top: Math.min(rect.bottom + 4, window.innerHeight - 300), left: Math.min(rect.left, window.innerWidth - 240) }}
      className="fixed z-[90] w-56 bg-surface border border-line rounded-xl shadow-pop p-1.5 text-xs">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("ค้นหาตัวเลือก", "Search options", "搜索选项")}
        onKeyDown={(e) => { if (e.key === "Enter" && list[0]) onPick(list[0].id); }} className="w-full h-8 px-2 mb-1 rounded-lg border border-line bg-surface" />
      <div className="max-h-56 overflow-auto">
        {list.map((o) => (
          <button key={o.id} onClick={() => onPick(o.id)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2 ${o.id === value ? "bg-brand/[0.06]" : ""}`}>
            <TagChip value={o.label} tone={o.color} /><span className="flex-1" />{o.id === value ? <Check size={13} className="text-brand" /> : null}
          </button>
        ))}
        {!list.length ? <p className="px-2 py-2 text-muted">{tr("ไม่มีตัวเลือก — เพิ่มได้ที่เมนูหัวคอลัมน์", "No options — add them from the column menu", "无选项 — 可在列菜单添加")}</p> : null}
      </div>
      {value ? <button onClick={() => onPick(null)} className="w-full mt-1 h-8 rounded-lg text-muted hover:text-danger hover:bg-danger/5 inline-flex items-center justify-center gap-1"><X size={12} />{tr("ล้างค่า", "Clear", "清除")}</button> : null}
    </div>,
    document.body,
  );
}

/** สร้าง/แก้คอลัมน์ (ชื่อ · ประเภท · ตัวเลือกพร้อมสี) */
export function FieldEditor({ rect, field, onClose, onSave, onDelete }: {
  rect: DOMRect; field?: SalesField; onClose: () => void;
  onSave: (f: { name: string; type: FieldType; options: FieldOpt[] }) => Promise<void>; onDelete?: () => Promise<void>;
}) {
  const box = usePopover(onClose);
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [opts, setOpts] = useState<FieldOpt[]>(field?.options ?? []);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [confirmDel, setConfirmDel] = useState(false);
  const addOpt = () => setOpts((o) => [...o, { id: Math.random().toString(36).slice(2, 10), label: "", color: o.length % TAG_BG.length }]);
  async function save() {
    if (!name.trim()) { setErr(tr("ใส่ชื่อคอลัมน์", "Enter a column name", "请输入列名")); return; }
    setBusy(true); setErr("");
    try { await onSave({ name: name.trim(), type, options: opts.filter((o) => o.label.trim()) }); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return createPortal(
    <div ref={box} style={{ top: Math.min(rect.bottom + 6, window.innerHeight - 460), left: Math.max(8, Math.min(rect.right - 300, window.innerWidth - 308)) }}
      className="fixed z-[90] w-[300px] bg-surface border border-line rounded-2xl shadow-pop p-3.5 space-y-3 text-xs">
      <div className="flex items-center justify-between"><b className="text-[13px]">{field ? tr("แก้ไขคอลัมน์", "Edit column", "编辑列") : tr("เพิ่มคอลัมน์", "New column", "新建列")}</b><button onClick={onClose} className="text-muted hover:text-ink"><X size={14} /></button></div>
      <label className="block space-y-1"><span className="text-muted">{tr("ชื่อคอลัมน์", "Column name", "列名")}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && type !== "select") void save(); }} maxLength={60} className="w-full h-9 px-2.5 rounded-lg border border-line bg-surface text-sm" /></label>
      <div className="space-y-1">
        <span className="text-muted">{tr("ประเภท", "Type", "类型")}{field ? ` · ${tr("เปลี่ยนไม่ได้หลังสร้าง", "fixed after creation", "创建后不可更改")}` : ""}</span>
        <div className="grid grid-cols-1 gap-0.5">
          {FIELD_TYPES.map(({ type: t, icon: I, label }) => (
            <button key={t} disabled={!!field} onClick={() => setType(t)} className={`flex items-center gap-2 h-8 px-2 rounded-lg text-left ${type === t ? "bg-brand/10 text-brand font-medium" : "hover:bg-surface2"} disabled:cursor-default ${field && type !== t ? "hidden" : ""}`}>
              <I size={14} />{label()}{type === t ? <Check size={13} className="ml-auto" /> : null}
            </button>
          ))}
        </div>
      </div>
      {type === "select" ? (
        <div className="space-y-1.5">
          <span className="text-muted">{tr("ตัวเลือก", "Options", "选项")}</span>
          <div className="space-y-1 max-h-48 overflow-auto pr-0.5">
            {opts.map((o, i) => (
              <div key={o.id} className="flex items-center gap-1.5">
                <button title={tr("เปลี่ยนสี", "Change color", "更换颜色")} onClick={() => setOpts((x) => x.map((y, j) => (j === i ? { ...y, color: (y.color + 1) % TAG_BG.length } : y)))}
                  className="w-6 h-6 rounded-md shrink-0 border border-black/5" style={{ background: TAG_BG[o.color % TAG_BG.length].bg }} />
                <input value={o.label} onChange={(e) => setOpts((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} placeholder={tr("ชื่อตัวเลือก", "Option name", "选项名称")}
                  className="flex-1 h-7 px-2 rounded-md border border-line bg-surface" maxLength={40} />
                <button onClick={() => setOpts((x) => x.filter((_, j) => j !== i))} className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-danger"><X size={12} /></button>
              </div>
            ))}
          </div>
          <button onClick={addOpt} className="h-7 px-2 rounded-lg text-brand hover:bg-brand/5 inline-flex items-center gap-1"><Plus size={12} />{tr("เพิ่มตัวเลือก", "Add option", "添加选项")}</button>
          <p className="text-[10.5px] text-muted">{tr("กดสี่เหลี่ยมสีเพื่อเปลี่ยนสี", "Click the swatch to change color", "点击色块更换颜色")}</p>
        </div>
      ) : null}
      {err ? <p className="text-danger">{err}</p> : null}
      <div className="flex items-center gap-2 pt-1">
        {field && onDelete ? (confirmDel
          ? <button onClick={async () => { setBusy(true); try { await onDelete(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }} className="h-8 px-2.5 rounded-lg bg-danger text-white">{tr("ยืนยันลบ (ข้อมูลในคอลัมน์หายด้วย)", "Confirm delete (data too)", "确认删除（含数据）")}</button>
          : <button onClick={() => setConfirmDel(true)} className="h-8 px-2 rounded-lg text-danger hover:bg-danger/5 inline-flex items-center gap-1"><Trash2 size={12} />{tr("ลบคอลัมน์", "Delete", "删除")}</button>) : null}
        <button onClick={() => void save()} disabled={busy} className="ml-auto h-8 px-4 rounded-lg bg-brand text-brandInk font-medium inline-flex items-center gap-1.5 disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" /> : null}{tr("บันทึก", "Save", "保存")}</button>
      </div>
    </div>,
    document.body,
  );
}
