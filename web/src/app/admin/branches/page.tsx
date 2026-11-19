"use client";
// =====================================================================
// Admin → สาขา (branches) — รายการสาขาครบทุกแบรนด์ + เพิ่ม/แก้สาขา (เขียนลง Dexie)
//   จัดกลุ่มตามแบรนด์ · คลังสินค้าแยกกลุ่ม · เพิ่มสาขาได้
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Loader2, MapPin, Store, Warehouse, Search, Check, X, Pencil } from "lucide-react";
import { Modal, EmptyState, Badge, Input } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { listBranches, listBrands, createBranch, updateBranch } from "@/lib/data/repo";
import { ExportShareBar } from "@/components/admin/export-share";
import type { Branch, Brand } from "@/lib/types";

const TYPE_OPTS = [
  { v: "brand_shop", th: "ร้านแบรนด์", en: "Brand shop", zh: "品牌店" },
  { v: "vending", th: "ตู้จำหน่าย", en: "Vending", zh: "自动售货" },
  { v: "warehouse", th: "คลังสินค้า", en: "Warehouse", zh: "仓库" },
];
const EMPTY = { id: "", code: "", name: "", name_th: "", brand_id: "", branch_type: "brand_shop", province: "", is_active: true };
type FormState = typeof EMPTY;

export default function AdminBranchesPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { const [bs, br] = await Promise.all([listBranches(), listBrands()]); setBranches(bs); setBrands(br); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const typeLabel = (v: string) => { const o = TYPE_OPTS.find((x) => x.v === v); return o ? L(o.th, o.en, o.zh) : v; };
  const brandName = (id: string | null) => (id ? brands.find((b) => b.id === id)?.name ?? "—" : "—");

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return branches.filter((b) => !kw || `${b.name} ${b.name_th ?? ""} ${b.code} ${b.province ?? ""}`.toLowerCase().includes(kw));
  }, [branches, q]);

  // จัดกลุ่มตามชื่อแบรนด์ + dedupe สาขาซ้ำตาม code (Dexie มี demo + synced ปนกัน)
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const uniq = filtered.filter((b) => { const k = b.code.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const shops = uniq.filter((b) => b.branch_type !== "warehouse");
    const whs = uniq.filter((b) => b.branch_type === "warehouse");
    const nameOf = (id: string | null) => (id ? brands.find((b) => b.id === id)?.name ?? null : null);
    // ชื่อแบรนด์ไม่ซ้ำ ตามลำดับที่เจอ
    const order: string[] = []; const seenName = new Set<string>();
    brands.forEach((b) => { if (!seenName.has(b.name)) { seenName.add(b.name); order.push(b.name); } });
    const g = order
      .map((name) => ({ name, color: brands.find((b) => b.name === name)?.color ?? null, items: shops.filter((b) => nameOf(b.brand_id) === name) }))
      .filter((x) => x.items.length)
      .sort((a, b) => b.items.length - a.items.length);
    const orphan = shops.filter((b) => !nameOf(b.brand_id));
    return { g, orphan, whs, total: uniq.length };
  }, [filtered, brands]);

  function openNew() { setForm(EMPTY); setErr(""); setOpen(true); }
  function openEdit(b: Branch) {
    setForm({ id: b.id, code: b.code, name: b.name, name_th: b.name_th ?? "", brand_id: b.brand_id ?? "", branch_type: b.branch_type, province: b.province ?? "", is_active: b.is_active });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.code.trim()) { setErr(L("ต้องใส่รหัสสาขา", "Branch code required", "需要门店编号")); return; }
    if (!form.name.trim()) { setErr(L("ต้องใส่ชื่อสาขา", "Branch name required", "需要门店名称")); return; }
    if (form.branch_type !== "warehouse" && !form.brand_id) { setErr(L("เลือกแบรนด์", "Select a brand", "请选择品牌")); return; }
    setSaving(true); setErr("");
    try {
      if (form.id) {
        await updateBranch(form.id, { code: form.code.trim().toUpperCase(), name: form.name.trim(), name_th: form.name_th.trim() || form.name.trim(), brand_id: form.brand_id || null, branch_type: form.branch_type, province: form.province.trim() || null, is_active: form.is_active });
      } else {
        await createBranch({ code: form.code, name: form.name, name_th: form.name_th, brand_id: form.brand_id || null, branch_type: form.branch_type, province: form.province, is_active: form.is_active });
      }
      setOpen(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败")); }
    finally { setSaving(false); }
  }

  const card = (b: Branch) => (
    <div key={b.id} className={`p-3 rounded-xl border bg-surface flex items-center gap-3 ${b.is_active ? "border-line" : "border-line opacity-55"}`}>
      <span className="w-9 h-9 rounded-lg bg-surface2 grid place-items-center shrink-0">{b.branch_type === "warehouse" ? <Warehouse size={16} className="text-muted" /> : <Store size={16} className="text-muted" />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{locale === "th" ? b.name_th || b.name : b.name}{!b.is_active ? <span className="ml-1.5 text-[10px] text-muted">({L("ปิด", "off", "停")})</span> : null}</p>
        <p className="text-[11px] text-muted truncate"><span className="font-mono">{b.code}</span>{b.province ? ` · ${b.province}` : ""} · {typeLabel(b.branch_type)}</p>
      </div>
      <button onClick={() => openEdit(b)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2 shrink-0"><Pencil size={14} /></button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Building2 size={22} /> {L("สาขา", "Branches", "门店")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("สาขาทั้งหมดแยกตามแบรนด์ + เพิ่ม/แก้สาขา", "All branches by brand + add/edit", "按品牌分组的所有门店 + 新增/编辑")} · {groups.total} {L("สาขา", "branches", "门店")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportShareBar<Branch> filename="branches" title={L("รายการสาขา", "Branches", "门店")} rows={filtered} size="sm"
            columns={[
              { key: "code", label: L("รหัส", "Code", "编号") },
              { key: "name_th", label: L("ชื่อสาขา", "Name", "名称"), map: (b) => b.name_th || b.name },
              { key: "brand", label: L("แบรนด์", "Brand", "品牌"), map: (b) => brandName(b.brand_id) },
              { key: "branch_type", label: L("ประเภท", "Type", "类型"), map: (b) => typeLabel(b.branch_type) },
              { key: "province", label: L("จังหวัด", "Province", "省份"), map: (b) => b.province ?? "-" },
              { key: "is_active", label: L("สถานะ", "Status", "状态"), map: (b) => (b.is_active ? L("ใช้งาน", "Active", "启用") : L("ปิด", "Off", "停用")) },
            ]} />
          <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2 shrink-0"><Plus size={16} /> {L("เพิ่มสาขา", "Add branch", "新增门店")}</button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาชื่อ/รหัส/จังหวัด…", "Search name/code/province…", "搜索…")} className="pl-9 h-10" />
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลด…", "Loading…", "加载中…")}</div>
      ) : !filtered.length ? (
        <EmptyState icon={<Building2 size={26} />} title={L("ไม่พบสาขา", "No branches", "无门店")} />
      ) : (
        <div className="space-y-6">
          {groups.g.map(({ name, color, items }) => (
            <div key={name}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color ?? "var(--c-brand)" }} />
                <h2 className="font-bold text-sm">{name}</h2>
                <Badge tone="neutral">{items.length}</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map(card)}</div>
            </div>
          ))}
          {groups.orphan.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2"><h2 className="font-bold text-sm text-muted">{L("ไม่ระบุแบรนด์", "No brand", "未指定品牌")}</h2><Badge tone="neutral">{groups.orphan.length}</Badge></div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{groups.orphan.map(card)}</div>
            </div>
          )}
          {groups.whs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2"><Warehouse size={15} className="text-muted" /><h2 className="font-bold text-sm">{L("คลังสินค้า", "Warehouses", "仓库")}</h2><Badge tone="neutral">{groups.whs.length}</Badge></div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{groups.whs.map(card)}</div>
            </div>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? L("แก้ไขสาขา", "Edit branch", "编辑门店") : L("เพิ่มสาขา", "Add branch", "新增门店")} size="md"
        footer={<>
          <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
          <button onClick={() => void save()} disabled={saving} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {L("บันทึก", "Save", "保存")}</button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2 flex items-center gap-1.5"><X size={13} /> {err}</p>}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("รหัสสาขา *", "Branch code *", "门店编号 *")}<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="70MAI-XXX" /></label>
            <label className="text-xs text-muted block">{L("ประเภท", "Type", "类型")}
              <select value={form.branch_type} onChange={(e) => setForm({ ...form, branch_type: e.target.value })} className={inp}>{TYPE_OPTS.map((o) => <option key={o.v} value={o.v}>{L(o.th, o.en, o.zh)}</option>)}</select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("ชื่อสาขา (EN) *", "Name (EN) *", "名称 *")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="70mai Rama 9" /></label>
            <label className="text-xs text-muted block">{L("ชื่อไทย", "Thai name", "泰文名")}<input value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} className={inp} placeholder="70mai พระราม 9" /></label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("แบรนด์", "Brand", "品牌")}{form.branch_type !== "warehouse" ? " *" : ""}
              <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className={inp}><option value="">{L("— ไม่ระบุ —", "— None —", "— 无 —")}</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
            <label className="text-xs text-muted block">{L("จังหวัด", "Province", "省份")}<input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} className={inp} placeholder={L("กรุงเทพมหานคร", "Bangkok", "曼谷")} /></label>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer pt-1">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-current" />
            <span className="text-sm font-medium">{L("เปิดใช้งาน", "Active", "启用")}</span>
          </label>
          {!form.id ? <p className="text-[11px] text-muted">{L("สาขาที่ขายได้จะสร้างเครื่อง POS ให้อัตโนมัติ 1 เครื่อง", "A sellable branch auto-creates 1 POS terminal", "可销售门店将自动创建 1 台 POS")}</p> : null}
        </div>
      </Modal>
    </div>
  );
}

const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";
