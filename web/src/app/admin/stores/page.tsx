"use client";

// =====================================================================
// Admin → ร้าน (stores) — จัดกลุ่มสาขาเป็นร้าน
//   บริษัท → แบรนด์ → ร้าน → สาขา → เครื่อง POS
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { Store, Plus, Trash2, Loader2, Pencil, MapPin, Layers } from "lucide-react";
import { Modal, EmptyState } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";
import { useI18n } from "@/lib/i18n/provider";

interface BranchRef { id: string; name: string; brand_id: string | null; store_id: string | null }
interface StoreRow {
  id: string; code: string | null; name: string; name_th: string | null;
  brand_id: string | null; store_type: string; note: string | null; is_active: boolean;
  branches: { id: string; name: string }[];
}

const TYPE_LABEL: Record<string, string> = {
  brand_shop: "ร้านแบรนด์เดียว", multi_brand: "ร้านรวมหลายแบรนด์", franchise: "แฟรนไชส์", online: "ออนไลน์",
};
const TYPE_OPTS = Object.entries(TYPE_LABEL).map(([v, label]) => ({ v, label }));

const EMPTY = { id: "", name: "", name_th: "", code: "", brand_id: "", store_type: "brand_shop", note: "", is_active: true, branch_ids: [] as string[] };
type FormState = typeof EMPTY;

export default function AdminStoresPage() {
  const { brands } = useAdminScope();
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const typeLabel = (v: string) =>
    v === "brand_shop" ? L("ร้านแบรนด์เดียว", "Single-brand store", "单品牌店")
      : v === "multi_brand" ? L("ร้านรวมหลายแบรนด์", "Multi-brand store", "多品牌店")
        : v === "franchise" ? L("แฟรนไชส์", "Franchise", "加盟店")
          : v === "online" ? L("ออนไลน์", "Online", "线上")
            : (TYPE_LABEL[v] ?? v);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/admin/stores").then((r) => r.json());
      setStores(Array.isArray(j.stores) ? j.stores : []);
      setBranches(Array.isArray(j.branches) ? j.branches : []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openNew() { setForm(EMPTY); setErr(""); setOpen(true); }
  function openEdit(s: StoreRow) {
    setForm({
      id: s.id, name: s.name, name_th: s.name_th ?? "", code: s.code ?? "",
      brand_id: s.brand_id ?? "", store_type: s.store_type, note: s.note ?? "", is_active: s.is_active,
      branch_ids: s.branches.map((b) => b.id),
    });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr(L("ต้องใส่ชื่อร้าน", "Please enter a store name", "请输入店铺名称")); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/admin/stores", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(form.id ? { id: form.id } : {}), ...form, brand_id: form.brand_id || null }),
      });
      const j = await res.json();
      if (res.ok) { setOpen(false); await load(); } else setErr(j.error ?? L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"));
    } finally { setSaving(false); }
  }
  async function remove(s: StoreRow) {
    if (!confirm(L(`ลบร้าน "${s.name}"? (สาขาจะถูกปลดออกจากร้าน แต่ไม่ถูกลบ)`, `Delete store "${s.name}"? (Branches will be detached from the store but not deleted)`, `删除店铺 "${s.name}"？（门店将从店铺中移除但不会被删除）`))) return;
    await fetch(`/api/admin/stores?id=${s.id}`, { method: "DELETE" });
    setStores((p) => p.filter((x) => x.id !== s.id));
  }

  const brandName = (id: string | null) => (id ? brands.find((b) => b.id === id)?.name ?? "—" : "—");
  // สาขาที่เลือกได้ในฟอร์ม: ยังไม่มีร้าน หรืออยู่ร้านที่กำลังแก้
  const selectableBranches = branches.filter((b) => !b.store_id || b.store_id === form.id || form.branch_ids.includes(b.id));

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Store size={22} /> {L("ร้าน", "Stores", "店铺")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("จัดกลุ่มสาขาเป็นร้าน — บริษัท → แบรนด์ → ร้าน → สาขา", "Group branches into stores — Company → Brand → Store → Branch", "将门店归组为店铺 — 公司 → 品牌 → 店铺 → 门店")}</p>
        </div>
        <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> {L("สร้างร้าน", "Create store", "创建店铺")}
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลด…", "Loading…", "加载中…")}</div>
      ) : stores.length === 0 ? (
        <EmptyState icon={<Store size={26} />} title={L("ยังไม่มีร้าน", "No stores yet", "暂无店铺")} body={L("กด “สร้างร้าน” เพื่อจัดกลุ่มสาขา", "Tap “Create store” to group branches", "点击“创建店铺”以归组门店")} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {stores.map((s) => (
            <div key={s.id} className={`p-4 rounded-2xl border bg-surface ${s.is_active ? "border-line" : "border-line opacity-60"}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{s.name_th || s.name}</span>
                    {s.code && <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-surface2 text-muted">{s.code}</span>}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-muted">{typeLabel(s.store_type)}</span>
                  </div>
                  <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {s.brand_id && <span className="inline-flex items-center gap-1"><Layers size={11} />{brandName(s.brand_id)}</span>}
                    <span className="inline-flex items-center gap-1"><MapPin size={11} />{s.branches.length} {L("สาขา", "branches", "门店")}</span>
                  </div>
                  {s.branches.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.branches.map((b) => <span key={b.id} className="text-[10px] px-2 py-0.5 rounded-full bg-surface2 text-ink border border-line">{b.name}</span>)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(s)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><Pencil size={15} /></button>
                  <button onClick={() => void remove(s)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-surface2"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? L("แก้ไขร้าน", "Edit store", "编辑店铺") : L("สร้างร้าน", "Create store", "创建店铺")} size="md"
        footer={
          <>
            <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} {L("บันทึก", "Save", "保存")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("ชื่อร้าน *", "Store name *", "店铺名称 *")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="SHD Central" /></label>
            <label className="text-xs text-muted block">{L("ชื่อไทย", "Thai name", "泰文名称")}<input value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} className={inp} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("รหัสร้าน", "Store code", "店铺编号")}<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="ST-01" /></label>
            <label className="text-xs text-muted block">{L("ประเภทร้าน", "Store type", "店铺类型")}
              <select value={form.store_type} onChange={(e) => setForm({ ...form, store_type: e.target.value })} className={inp}>
                {TYPE_OPTS.map((o) => <option key={o.v} value={o.v}>{typeLabel(o.v)}</option>)}
              </select>
            </label>
          </div>
          <label className="text-xs text-muted block">{L("แบรนด์หลัก (ถ้าร้านแบรนด์เดียว)", "Main brand (if single-brand store)", "主品牌（若为单品牌店）")}
            <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className={inp}>
              <option value="">{L("— ไม่ระบุ —", "— None —", "— 不指定 —")}</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div>
            <div className="text-xs text-muted mb-1.5">{L("สาขาในร้านนี้", "Branches in this store", "本店铺的门店")}</div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {selectableBranches.length === 0 ? <span className="text-xs text-muted">{L("ไม่มีสาขาว่างให้ผูก", "No available branches to link", "没有可关联的门店")}</span> : selectableBranches.map((b) => {
                const on = form.branch_ids.includes(b.id);
                return (
                  <button key={b.id} onClick={() => setForm((f) => ({ ...f, branch_ids: on ? f.branch_ids.filter((x) => x !== b.id) : [...f.branch_ids, b.id] }))}
                    className={`px-2.5 h-7 rounded-full text-[11px] font-semibold ${on ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"}`}>{b.name}</button>
                );
              })}
            </div>
          </div>
          <label className="text-xs text-muted block">{L("หมายเหตุ", "Note", "备注")}<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inp} /></label>
          <label className="flex items-center gap-2.5 cursor-pointer pt-1">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-current" />
            <span className="text-sm font-medium">{L("เปิดใช้งาน", "Active", "启用")}</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";
