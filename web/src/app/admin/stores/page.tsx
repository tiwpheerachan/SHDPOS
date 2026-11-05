"use client";

// =====================================================================
// Admin → ร้าน (stores) — จัดกลุ่มสาขาเป็นร้าน
//   บริษัท → แบรนด์ → ร้าน → สาขา → เครื่อง POS
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { Store, Plus, Trash2, Loader2, Pencil, MapPin, Layers } from "lucide-react";
import { Modal, EmptyState } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";

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
    if (!form.name.trim()) { setErr("ต้องใส่ชื่อร้าน"); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/admin/stores", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(form.id ? { id: form.id } : {}), ...form, brand_id: form.brand_id || null }),
      });
      const j = await res.json();
      if (res.ok) { setOpen(false); await load(); } else setErr(j.error ?? "บันทึกไม่สำเร็จ");
    } finally { setSaving(false); }
  }
  async function remove(s: StoreRow) {
    if (!confirm(`ลบร้าน "${s.name}"? (สาขาจะถูกปลดออกจากร้าน แต่ไม่ถูกลบ)`)) return;
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
          <h1 className="text-xl font-bold flex items-center gap-2"><Store size={22} /> ร้าน</h1>
          <p className="text-sm text-muted mt-0.5">จัดกลุ่มสาขาเป็นร้าน — บริษัท → แบรนด์ → ร้าน → สาขา</p>
        </div>
        <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> สร้างร้าน
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> กำลังโหลด…</div>
      ) : stores.length === 0 ? (
        <EmptyState icon={<Store size={26} />} title="ยังไม่มีร้าน" body="กด “สร้างร้าน” เพื่อจัดกลุ่มสาขา" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {stores.map((s) => (
            <div key={s.id} className={`p-4 rounded-2xl border bg-surface ${s.is_active ? "border-line" : "border-line opacity-60"}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{s.name_th || s.name}</span>
                    {s.code && <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-surface2 text-muted">{s.code}</span>}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-muted">{TYPE_LABEL[s.store_type] ?? s.store_type}</span>
                  </div>
                  <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {s.brand_id && <span className="inline-flex items-center gap-1"><Layers size={11} />{brandName(s.brand_id)}</span>}
                    <span className="inline-flex items-center gap-1"><MapPin size={11} />{s.branches.length} สาขา</span>
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

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? "แก้ไขร้าน" : "สร้างร้าน"} size="md"
        footer={
          <>
            <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">ยกเลิก</button>
            <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} บันทึก
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">ชื่อร้าน *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="SHD Central" /></label>
            <label className="text-xs text-muted block">ชื่อไทย<input value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} className={inp} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">รหัสร้าน<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="ST-01" /></label>
            <label className="text-xs text-muted block">ประเภทร้าน
              <select value={form.store_type} onChange={(e) => setForm({ ...form, store_type: e.target.value })} className={inp}>
                {TYPE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <label className="text-xs text-muted block">แบรนด์หลัก (ถ้าร้านแบรนด์เดียว)
            <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className={inp}>
              <option value="">— ไม่ระบุ —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div>
            <div className="text-xs text-muted mb-1.5">สาขาในร้านนี้</div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {selectableBranches.length === 0 ? <span className="text-xs text-muted">ไม่มีสาขาว่างให้ผูก</span> : selectableBranches.map((b) => {
                const on = form.branch_ids.includes(b.id);
                return (
                  <button key={b.id} onClick={() => setForm((f) => ({ ...f, branch_ids: on ? f.branch_ids.filter((x) => x !== b.id) : [...f.branch_ids, b.id] }))}
                    className={`px-2.5 h-7 rounded-full text-[11px] font-semibold ${on ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"}`}>{b.name}</button>
                );
              })}
            </div>
          </div>
          <label className="text-xs text-muted block">หมายเหตุ<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inp} /></label>
          <label className="flex items-center gap-2.5 cursor-pointer pt-1">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-current" />
            <span className="text-sm font-medium">เปิดใช้งาน</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";
