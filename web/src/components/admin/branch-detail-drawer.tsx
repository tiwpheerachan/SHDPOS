"use client";
// =====================================================================
// แผงรายละเอียด/ตั้งค่าสาขา (Drawer ขวา) — ใช้ในหน้าผังสาขา
//   เพิ่มสาขาใหม่ (branch=null) หรือแก้ไข + ตั้งค่าละเอียด · บันทึกลง activity log
// =====================================================================
import { useEffect, useState } from "react";
import { MapPin, Loader2, Check, X, Store, Warehouse } from "lucide-react";
import { Drawer } from "@/components/ui";
import { MultiSelect } from "@/components/ui/multi-select";
import { isLiveMode } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";
import { createBranch, updateBranch, logActivity, diffFields } from "@/lib/data/repo";
import type { Branch, Brand, Employee } from "@/lib/types";

const TYPE_OPTS = [
  { v: "brand_shop", th: "ร้านแบรนด์", en: "Brand shop", zh: "品牌店" },
  { v: "vending", th: "ตู้จำหน่าย", en: "Vending", zh: "自动售货" },
  { v: "warehouse", th: "คลังสินค้า", en: "Warehouse", zh: "仓库" },
];
const EMPTY = { code: "", name: "", name_th: "", brand_id: "", branch_type: "brand_shop", province: "", lat: "", lng: "", phone: "", email: "", address: "", district: "", postcode: "", open_time: "", close_time: "", manager_id: "", note: "", is_active: true };

function parseLatLng(s: string): { lat: string; lng: string } | null {
  const m = s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || s.match(/[?&](?:q|ll|destination)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  return m ? { lat: m[1], lng: m[2] } : null;
}
const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";

export function BranchDetailDrawer({ open, onClose, branch, brands, employees, actor, onSaved }: {
  open: boolean;
  onClose: () => void;
  branch: Branch | null;              // null = เพิ่มใหม่
  brands: Brand[];
  employees: Employee[];
  actor: Employee | null;
  onSaved: () => void;
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // แบรนด์ที่สาขาขาย (สาขาหลายแบรนด์) — เก็บที่เซิร์ฟเวอร์ (branch_brands) · null = ยังโหลดไม่ได้/โหมดสาธิต
  const [sold, setSold] = useState<string[] | null>(null), [soldBefore, setSoldBefore] = useState<string[]>([]);
  const liveBranch = !!branch && isLiveMode() && /^[0-9a-f-]{36}$/i.test(branch.id);

  useEffect(() => {
    if (!open) return;
    setErr("");
    if (branch) setForm({ code: branch.code, name: branch.name, name_th: branch.name_th ?? "", brand_id: branch.brand_id ?? "", branch_type: branch.branch_type, province: branch.province ?? "", lat: branch.lat != null ? String(branch.lat) : "", lng: branch.lng != null ? String(branch.lng) : "", phone: branch.phone ?? "", email: branch.email ?? "", address: branch.address ?? "", district: branch.district ?? "", postcode: branch.postcode ?? "", open_time: branch.open_time ?? "", close_time: branch.close_time ?? "", manager_id: branch.manager_id ?? "", note: branch.note ?? "", is_active: branch.is_active });
    else setForm({ ...EMPTY });
    setSold(null); setSoldBefore([]);
    if (branch && isLiveMode() && /^[0-9a-f-]{36}$/i.test(branch.id)) {
      let alive = true;
      void fetch("/api/admin/branch-brands", { cache: "no-store" }).then((r) => r.json()).then((j) => {
        if (!alive || !j.map) return;
        const ids: string[] = j.map[branch.id] ?? (branch.brand_id ? [branch.brand_id] : []);
        setSold(ids); setSoldBefore(ids);
      }).catch(() => undefined);
      return () => { alive = false; };
    }
  }, [open, branch]);

  const typeLabel = (v: string) => { const o = TYPE_OPTS.find((x) => x.v === v); return o ? L(o.th, o.en, o.zh) : v; };
  const brandName = (id: string | null) => (id ? brands.find((b) => b.id === id)?.name ?? "—" : "—");
  const empName = (id: string | null | undefined) => { if (!id) return "—"; const e = employees.find((x) => x.id === id); return e ? (e.nickname || e.first_name || e.email || id) : "—"; };

  async function save() {
    if (!form.code.trim()) { setErr(L("ต้องใส่รหัสสาขา", "Branch code required", "需要门店编号")); return; }
    if (!form.name.trim()) { setErr(L("ต้องใส่ชื่อสาขา", "Branch name required", "需要门店名称")); return; }
    if (form.branch_type !== "warehouse" && !form.brand_id) { setErr(L("เลือกแบรนด์", "Select a brand", "请选择品牌")); return; }
    const lat = form.lat.trim() ? Number(form.lat) : null;
    const lng = form.lng.trim() ? Number(form.lng) : null;
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) { setErr(L("พิกัดไม่ถูกต้อง", "Invalid coordinates", "坐标无效")); return; }
    if ((lat === null) !== (lng === null)) { setErr(L("ต้องใส่ทั้งละติจูดและลองจิจูด", "Enter both lat and lng", "需同时填写经纬度")); return; }
    setSaving(true); setErr("");
    const detail = { phone: form.phone.trim() || null, email: form.email.trim() || null, address: form.address.trim() || null, district: form.district.trim() || null, postcode: form.postcode.trim() || null, open_time: form.open_time.trim() || null, close_time: form.close_time.trim() || null, manager_id: form.manager_id || null, note: form.note.trim() || null };
    const nextBranch: Partial<Branch> & { name_th: string } = { code: form.code.trim().toUpperCase(), name: form.name.trim(), name_th: form.name_th.trim() || form.name.trim(), brand_id: form.brand_id || null, branch_type: form.branch_type, province: form.province.trim() || null, lat, lng, ...detail, is_active: form.is_active };
    const snap = (o: Partial<Branch>) => ({ code: o.code ?? "", name: o.name_th || o.name || "", brand: brandName(o.brand_id ?? null), type: typeLabel(o.branch_type ?? ""), province: o.province ?? "", address: o.address ?? "", district: o.district ?? "", postcode: o.postcode ?? "", phone: o.phone ?? "", email: o.email ?? "", hours: o.open_time || o.close_time ? `${o.open_time ?? "?"}–${o.close_time ?? "?"}` : "", manager: empName(o.manager_id), note: o.note ?? "", lat: o.lat ?? "", lng: o.lng ?? "", active: o.is_active ? L("ใช้งาน", "Active", "启用") : L("ปิด", "Off", "停用") });
    const labels = { code: L("รหัสสาขา", "Code", "编号"), name: L("ชื่อสาขา", "Name", "名称"), brand: L("แบรนด์", "Brand", "品牌"), type: L("ประเภท", "Type", "类型"), province: L("จังหวัด", "Province", "省份"), address: L("ที่อยู่", "Address", "地址"), district: L("อำเภอ/เขต", "District", "区"), postcode: L("รหัสไปรษณีย์", "Postcode", "邮编"), phone: L("โทรศัพท์", "Phone", "电话"), email: L("อีเมล", "Email", "邮箱"), hours: L("เวลาทำการ", "Hours", "营业时间"), manager: L("ผู้จัดการ", "Manager", "店长"), note: L("หมายเหตุ", "Note", "备注"), lat: L("ละติจูด", "Latitude", "纬度"), lng: L("ลองจิจูด", "Longitude", "经度"), active: L("สถานะ", "Status", "状态") };
    const actorMeta = { actorId: actor?.id ?? null, actorName: actor ? (actor.nickname || actor.first_name || actor.email) : null };
    try {
      if (branch) {
        await updateBranch(branch.id, nextBranch);
        const changes = diffFields(snap(branch), snap(nextBranch), labels);
        if (changes.length) await logActivity({ ...actorMeta, op: "update", entity: "branch", entityLabel: nextBranch.name_th, entityId: branch.id, branchId: branch.id, changes });
        if (liveBranch && sold) {
          const want = [...new Set([...(form.brand_id ? [form.brand_id] : []), ...sold])];
          const key = (a: string[]) => [...a].sort().join(",");
          if (key(want) !== key(soldBefore)) {
            const r = await fetch("/api/admin/branch-brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch_id: branch.id, brand_ids: want }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw Error(`${L("บันทึกแบรนด์ที่ขายไม่สำเร็จ", "Couldn't save brands sold", "保存在售品牌失败")}${j.error ? ` — ${j.error}` : ""}`);
            const names = (ids: string[]) => ids.map((id) => brandName(id)).sort().join(", ");
            await logActivity({ ...actorMeta, op: "update", entity: "branch", entityLabel: nextBranch.name_th, entityId: branch.id, branchId: branch.id,
              changes: diffFields({ brands: names(soldBefore) }, { brands: names(j.brand_ids ?? want) }, { brands: L("แบรนด์ที่ขาย", "Brands sold", "在售品牌") }) });
          }
        }
      } else {
        const created = await createBranch({ code: form.code, name: form.name, name_th: form.name_th, brand_id: form.brand_id || null, branch_type: form.branch_type, province: form.province, lat, lng, ...detail, is_active: form.is_active });
        await logActivity({ ...actorMeta, op: "create", entity: "branch", entityLabel: created.name_th || created.name, entityId: created.id, branchId: created.id, changes: diffFields(null, snap(created), labels) });
      }
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败")); }
    finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} width="md"
      title={<span className="inline-flex items-center gap-2">{form.branch_type === "warehouse" ? <Warehouse size={18} /> : <Store size={18} />} {branch ? L("รายละเอียดสาขา", "Branch details", "门店详情") : L("เพิ่มสาขา", "Add branch", "新增门店")}</span>}
      subtitle={branch ? `${branch.code} · ${brandName(branch.brand_id)}` : L("กรอกข้อมูลสาขาใหม่", "Enter new branch info", "填写新门店信息")}>
      <div className="p-4 space-y-3">
        {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2 flex items-center gap-1.5"><X size={13} /> {err}</p>}

        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs text-muted block">{L("รหัสสาขา *", "Branch code *", "门店编号 *")}<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="70MAI-XXX" /></label>
          <label className="text-xs text-muted block">{L("ประเภท", "Type", "类型")}
            <select value={form.branch_type} onChange={(e) => setForm({ ...form, branch_type: e.target.value })} className={inp}>{TYPE_OPTS.map((o) => <option key={o.v} value={o.v}>{L(o.th, o.en, o.zh)}</option>)}</select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs text-muted block">{L("ชื่อสาขา (EN) *", "Name (EN) *", "名称 *")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="70mai Rama 9" /></label>
          <label className="text-xs text-muted block">{L("ชื่อไทย", "Thai name", "泰文名")}<input value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} className={inp} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs text-muted block">{L("แบรนด์", "Brand", "品牌")}{form.branch_type !== "warehouse" ? " *" : ""}
            <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className={inp}><option value="">{L("— ไม่ระบุ —", "— None —", "— 无 —")}</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <label className="text-xs text-muted block">{L("จังหวัด", "Province", "省份")}<input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} className={inp} /></label>
        </div>
        {/* สาขาหลายแบรนด์ — แบรนด์ที่ขายในสาขานี้ (หน้าร้านแสดงสินค้า/ของแถม/ตัวกรองตามนี้ · หลังบ้านใช้เลือกราคา/สต๊อกรายสาขา) */}
        {liveBranch ? (
          <div className="rounded-xl border border-line p-3 space-y-1.5">
            {sold === null ? <p className="text-[11.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />{L("กำลังโหลดแบรนด์ที่ขาย…", "Loading brands sold…", "正在加载在售品牌…")}</p> : (
              <MultiSelect label={L("แบรนด์ที่ขายในสาขานี้ (สาขาหลายแบรนด์เลือกได้หลายแบรนด์)", "Brands sold at this branch (multi-brand branches can pick several)", "本门店在售品牌（多品牌门店可多选）")}
                placeholder={L("เฉพาะแบรนด์หลัก", "Main brand only", "仅主品牌")} noTranslate
                options={brands.map((b) => ({ value: b.id, label: b.name, sub: b.id === form.brand_id ? L("แบรนด์หลัก", "main", "主品牌") : undefined }))}
                value={[...new Set([...(form.brand_id ? [form.brand_id] : []), ...sold])]}
                onChange={(v) => setSold(form.brand_id && !v.includes(form.brand_id) ? [form.brand_id, ...v] : v)} />
            )}
            <p className="text-[10.5px] text-muted">{L("หน้าร้านจะแสดงสินค้า ของแถม และตัวกรองแบรนด์ตามนี้ · แบรนด์หลักรวมเสมอ", "POS shows products, gifts and brand filters from this · the main brand is always included", "前台按此显示商品、赠品与品牌筛选 · 主品牌始终包含")}</p>
          </div>
        ) : null}

        {/* พิกัด */}
        <div className="rounded-xl border border-line bg-surface2/40 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted"><MapPin size={13} /> {L("พิกัดที่ตั้ง (ไม่บังคับ)", "Location (optional)", "位置（选填）")}</div>
          <input onChange={(e) => { const p = parseLatLng(e.target.value); if (p) { setForm((f) => ({ ...f, lat: p.lat, lng: p.lng })); e.target.value = ""; } }} className={`${inp} mt-0`} placeholder={L("วางลิงก์ Google Maps แล้วกรอกให้อัตโนมัติ", "Paste a Google Maps link", "粘贴 Google 地图链接")} />
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-[11px] text-muted block">{L("ละติจูด", "Latitude", "纬度")}<input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className={`${inp} font-mono`} placeholder="13.7563" inputMode="decimal" /></label>
            <label className="text-[11px] text-muted block">{L("ลองจิจูด", "Longitude", "经度")}<input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className={`${inp} font-mono`} placeholder="100.5018" inputMode="decimal" /></label>
          </div>
          {form.lat && form.lng ? <a href={`https://www.google.com/maps?q=${form.lat},${form.lng}`} target="_blank" rel="noreferrer" className="text-[11px] text-brand hover:underline">{L("ดูบนแผนที่ →", "View on map →", "在地图查看 →")}</a> : null}
        </div>

        {/* ติดต่อ */}
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs text-muted block">{L("โทรศัพท์", "Phone", "电话")}<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inp} placeholder="02-xxx-xxxx" inputMode="tel" /></label>
          <label className="text-xs text-muted block">{L("อีเมล", "Email", "邮箱")}<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inp} inputMode="email" /></label>
        </div>
        {/* ที่อยู่ */}
        <label className="text-xs text-muted block">{L("ที่อยู่", "Address", "地址")}<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inp} /></label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs text-muted block">{L("อำเภอ/เขต", "District", "区")}<input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} className={inp} /></label>
          <label className="text-xs text-muted block">{L("รหัสไปรษณีย์", "Postcode", "邮编")}<input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} className={`${inp} font-mono`} inputMode="numeric" /></label>
        </div>
        {/* เวลา + ผจก. */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="text-xs text-muted mb-1">{L("เวลาทำการ", "Opening hours", "营业时间")}</div>
            <div className="flex items-center gap-1.5">
              <input type="time" value={form.open_time} onChange={(e) => setForm({ ...form, open_time: e.target.value })} className={`${inp} mt-0`} />
              <span className="text-muted">–</span>
              <input type="time" value={form.close_time} onChange={(e) => setForm({ ...form, close_time: e.target.value })} className={`${inp} mt-0`} />
            </div>
          </div>
          <label className="text-xs text-muted block">{L("ผู้จัดการสาขา", "Branch manager", "店长")}
            <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })} className={inp}><option value="">{L("— ไม่ระบุ —", "— None —", "— 无 —")}</option>{employees.filter((em) => em.status === "active").map((em) => <option key={em.id} value={em.id}>{em.nickname || em.first_name || em.email}</option>)}</select>
          </label>
        </div>
        <label className="text-xs text-muted block">{L("หมายเหตุ", "Note", "备注")}<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inp} /></label>
        <label className="flex items-center gap-2.5 cursor-pointer pt-1">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-current" />
          <span className="text-sm font-medium">{L("เปิดใช้งาน", "Active", "启用")}</span>
        </label>

        <div className="flex gap-2 pt-2 sticky bottom-0 bg-surface pb-1">
          <button onClick={onClose} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted flex-1">{L("ยกเลิก", "Cancel", "取消")}</button>
          <button onClick={() => void save()} disabled={saving} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5 flex-1">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {L("บันทึก", "Save", "保存")}</button>
        </div>
      </div>
    </Drawer>
  );
}
