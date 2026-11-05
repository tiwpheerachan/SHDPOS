"use client";

// =====================================================================
// Admin → แคมเปญ / คูปอง (v2)
//   • ขอบเขต: แบรนด์ / สาขา / ช่องทาง / ช่วงเวลา
//   • เลือกสินค้าร่วมรายการ (หลาย SKU) + เงื่อนไขจำนวน/ยอดขั้นต่ำ
//   • สิทธิ์: ลดบาท / ลด% / ของแถม (ซื้อ A แถม B)
//   • วัดผล: ใช้กี่ครั้ง, ส่วนลดรวม, ยอดขายที่เกิด, ลูกค้ากี่คน
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import {
  Ticket, Plus, Trash2, Loader2, Pencil, TrendingUp, Users, Tag, Power, Gift, Search, X, Store, Layers,
} from "lucide-react";
import { Modal, EmptyState } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";
import { formatTHB } from "@/lib/money";

interface ProdRef { product_id: string | null; sku: string; name: string | null; gift_qty?: number }
interface Campaign {
  id: string; name: string; description: string | null; code: string | null;
  discount_type: string; discount_value: number; max_discount: number | null; min_spend: number;
  target_segment: string; starts_at: string | null; ends_at: string | null;
  usage_limit: number | null; per_customer_limit: number | null; active: boolean;
  brand_ids: string[]; branch_ids: string[]; channels: string[]; is_automatic: boolean;
  promo_type: string; eligible_scope: string; eligible_min_qty: number | null; eligible_across_sku: boolean;
  gift_mode: string | null; gift_per_qty: number | null; gift_cap: number | null;
  eligible_products: ProdRef[]; gift_products: ProdRef[];
  uses: number; discount_total: number; revenue: number; customers: number;
}

const SEG_LABEL: Record<string, string> = { all: "ทุกคน", new: "ลูกค้าใหม่", returning: "ซื้อซ้ำ", vip: "VIP", lost: "หายไป" };
const SEG_OPTS = Object.entries(SEG_LABEL).map(([v, label]) => ({ v, label }));
const CHANNELS: { v: string; label: string }[] = [
  { v: "offline", label: "หน้าร้าน" }, { v: "online_shopee", label: "Shopee" }, { v: "online_lazada", label: "Lazada" },
  { v: "online_tiktok", label: "TikTok" }, { v: "online_website", label: "เว็บไซต์" }, { v: "event", label: "อีเวนต์" },
  { v: "b2b", label: "ขายส่ง" }, { v: "other", label: "อื่นๆ" },
];

const EMPTY = {
  id: "", name: "", description: "", code: "", discount_type: "amount", discount_value: "",
  max_discount: "", min_spend: "", target_segment: "all", starts_at: "", ends_at: "",
  usage_limit: "", per_customer_limit: "1", active: true,
  brand_ids: [] as string[], branch_ids: [] as string[], channels: [] as string[], is_automatic: false,
  promo_type: "discount", eligible_scope: "all", eligible_min_qty: "", eligible_across_sku: true,
  gift_mode: "per_bill", gift_per_qty: "1", gift_cap: "",
  eligible: [] as ProdRef[], gifts: [] as ProdRef[],
};
type FormState = typeof EMPTY;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

export default function AdminCampaignsPage() {
  const { brands, branches } = useAdminScope();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/admin/campaigns").then((r) => r.json());
      setItems(Array.isArray(j.campaigns) ? j.campaigns : []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openNew() { setForm(EMPTY); setErr(""); setOpen(true); }
  function openEdit(c: Campaign) {
    setForm({
      id: c.id, name: c.name, description: c.description ?? "", code: c.code ?? "",
      discount_type: c.discount_type, discount_value: String(c.discount_value ?? ""),
      max_discount: c.max_discount != null ? String(c.max_discount) : "",
      min_spend: String(c.min_spend ?? ""), target_segment: c.target_segment,
      starts_at: c.starts_at ?? "", ends_at: c.ends_at ?? "",
      usage_limit: c.usage_limit != null ? String(c.usage_limit) : "",
      per_customer_limit: c.per_customer_limit != null ? String(c.per_customer_limit) : "",
      active: c.active,
      brand_ids: c.brand_ids ?? [], branch_ids: c.branch_ids ?? [], channels: c.channels ?? [],
      is_automatic: !!c.is_automatic, promo_type: c.promo_type ?? "discount",
      eligible_scope: c.eligible_scope ?? "all",
      eligible_min_qty: c.eligible_min_qty != null ? String(c.eligible_min_qty) : "",
      eligible_across_sku: c.eligible_across_sku ?? true,
      gift_mode: c.gift_mode ?? "per_bill", gift_per_qty: String(c.gift_per_qty ?? 1),
      gift_cap: c.gift_cap != null ? String(c.gift_cap) : "",
      eligible: c.eligible_products ?? [], gifts: c.gift_products ?? [],
    });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr("ต้องใส่ชื่อแคมเปญ"); return; }
    if (form.promo_type === "gift" && form.gifts.length === 0) { setErr("แคมเปญของแถม ต้องเลือกสินค้าของแถมอย่างน้อย 1 รายการ"); return; }
    setSaving(true); setErr("");
    try {
      const body = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, description: form.description, code: form.code,
        discount_type: form.discount_type, discount_value: Number(form.discount_value || 0),
        max_discount: form.max_discount, min_spend: Number(form.min_spend || 0),
        target_segment: form.target_segment, starts_at: form.starts_at || null, ends_at: form.ends_at || null,
        usage_limit: form.usage_limit, per_customer_limit: form.per_customer_limit, active: form.active,
        brand_ids: form.brand_ids, branch_ids: form.branch_ids, channels: form.channels, is_automatic: form.is_automatic,
        promo_type: form.promo_type, eligible_scope: form.eligible_scope,
        eligible_min_qty: form.eligible_min_qty, eligible_across_sku: form.eligible_across_sku,
        gift_mode: form.gift_mode, gift_per_qty: form.gift_per_qty, gift_cap: form.gift_cap,
        eligible_products: form.eligible, gift_products: form.gifts,
      };
      const res = await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (res.ok) { setOpen(false); await load(); } else setErr(j.error ?? "บันทึกไม่สำเร็จ");
    } finally { setSaving(false); }
  }

  async function toggleActive(c: Campaign) {
    await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, active: !c.active }) });
    await load();
  }
  async function remove(c: Campaign) {
    if (!confirm(`ลบแคมเปญ "${c.name}"?`)) return;
    await fetch(`/api/admin/campaigns?id=${c.id}`, { method: "DELETE" });
    setItems((p) => p.filter((x) => x.id !== c.id));
  }

  const discLabel = (c: Campaign) =>
    c.promo_type === "gift" ? `ของแถม ${c.gift_products?.length ?? 0} รายการ`
      : c.discount_type === "percent" ? `ลด ${c.discount_value}%${c.max_discount ? ` (สูงสุด ${formatTHB(c.max_discount, false)})` : ""}`
      : `ลด ${formatTHB(c.discount_value, false)}`;
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? id;
  const branchName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (b.name_th ?? b.name) : id; };

  function toggleArr(key: "brand_ids" | "branch_ids" | "channels", v: string) {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  }
  function addProd(list: "eligible" | "gifts", p: ProdRef) {
    setForm((f) => (f[list].some((x) => x.sku === p.sku) ? f : { ...f, [list]: [...f[list], { ...p, gift_qty: list === "gifts" ? 1 : undefined }] }));
  }
  function rmProd(list: "eligible" | "gifts", sku: string) {
    setForm((f) => ({ ...f, [list]: f[list].filter((x) => x.sku !== sku) }));
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Ticket size={22} /> แคมเปญ / คูปอง</h1>
          <p className="text-sm text-muted mt-0.5">ตั้งเงื่อนไขละเอียด — ขอบเขตแบรนด์/สาขา เลือก SKU และของแถม แล้ววัดผล</p>
        </div>
        <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> สร้างแคมเปญ
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> กำลังโหลด…</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Ticket size={26} />} title="ยังไม่มีแคมเปญ" body="กด “สร้างแคมเปญ” เพื่อเริ่ม" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((c) => (
            <div key={c.id} className={`p-4 rounded-2xl border bg-surface ${c.active ? "border-line" : "border-line opacity-60"}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{c.name}</span>
                    {c.promo_type === "gift" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ink text-surface inline-flex items-center gap-1"><Gift size={10} />ของแถม</span>}
                    {c.is_automatic ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-muted">อัตโนมัติ</span>
                      : c.code ? <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-brand/10 text-brand">{c.code}</span> : null}
                    {!c.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-danger border border-line">ปิดอยู่</span>}
                  </div>
                  <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink/80"><Tag size={11} />{discLabel(c)}</span>
                    {c.min_spend > 0 && <span>ซื้อขั้นต่ำ {formatTHB(c.min_spend, false)}</span>}
                    {(c.starts_at || c.ends_at) && <span>{fmtDate(c.starts_at)}–{fmtDate(c.ends_at)}</span>}
                    <span>{SEG_LABEL[c.target_segment] ?? c.target_segment}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    {(c.brand_ids?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1"><Layers size={10} />{c.brand_ids.map(brandName).join(", ")}</span>}
                    {(c.branch_ids?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1"><Store size={10} />{c.branch_ids.length} สาขา</span>}
                    {(c.eligible_products?.length ?? 0) > 0 && <span>· สินค้าร่วม {c.eligible_products.length} SKU</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => void toggleActive(c)} title={c.active ? "ปิด" : "เปิด"} className={`h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2 ${c.active ? "text-ink" : "text-muted"}`}><Power size={15} /></button>
                  <button onClick={() => openEdit(c)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><Pencil size={15} /></button>
                  <button onClick={() => void remove(c)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-surface2"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-line">
                <Stat label="ใช้" value={String(c.uses)} />
                <Stat label="ลูกค้า" value={String(c.customers)} icon={<Users size={12} />} />
                <Stat label="ส่วนลดรวม" value={formatTHB(c.discount_total, false)} />
                <Stat label="ยอดขายที่เกิด" value={formatTHB(c.revenue, false)} icon={<TrendingUp size={12} />} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? "แก้ไขแคมเปญ" : "สร้างแคมเปญ"} size="lg"
        footer={
          <>
            <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">ยกเลิก</button>
            <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} บันทึก
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>}

          {/* ข้อมูลหลัก */}
          <Section title="ข้อมูลหลัก">
            <Field label="ชื่อแคมเปญ *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="เช่น ซื้อกล้อง 70mai แถมเมม" /></Field>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-5">
                <input type="checkbox" checked={form.is_automatic} onChange={(e) => setForm({ ...form, is_automatic: e.target.checked })} className="w-4 h-4 accent-current" />
                โปรอัตโนมัติ (ไม่ต้องกรอกรหัส)
              </label>
              {!form.is_automatic && <Field label="รหัสคูปอง"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="NEW100" /></Field>}
            </div>
          </Section>

          {/* ขอบเขต */}
          <Section title="ขอบเขต">
            <MultiChips label="แบรนด์ (ว่าง = ทุกแบรนด์)" opts={brands.map((b) => ({ v: b.id, label: b.name }))} sel={form.brand_ids} onToggle={(v) => toggleArr("brand_ids", v)} />
            <MultiChips label="สาขา (ว่าง = ทุกสาขา)" opts={branches.map((b) => ({ v: b.id, label: b.name_th ?? b.name }))} sel={form.branch_ids} onToggle={(v) => toggleArr("branch_ids", v)} />
            <MultiChips label="ช่องทาง (ว่าง = ทุกช่องทาง)" opts={CHANNELS} sel={form.channels} onToggle={(v) => toggleArr("channels", v)} />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="เริ่ม"><input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inp} /></Field>
              <Field label="สิ้นสุด"><input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inp} /></Field>
            </div>
          </Section>

          {/* สินค้าร่วมรายการ */}
          <Section title="สินค้าร่วมรายการ">
            <div className="flex gap-2">
              {(["all", "selected"] as const).map((v) => (
                <button key={v} onClick={() => setForm({ ...form, eligible_scope: v })} className={`px-3 h-8 rounded-full text-xs font-semibold ${form.eligible_scope === v ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>
                  {v === "all" ? "ทุกสินค้า" : "เลือก SKU"}
                </button>
              ))}
            </div>
            {form.eligible_scope === "selected" && (
              <>
                <ProductPicker onPick={(p) => addProd("eligible", p)} />
                <ProdList list={form.eligible} onRemove={(sku) => rmProd("eligible", sku)} />
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="จำนวนขั้นต่ำ (สินค้าร่วม)"><input type="number" value={form.eligible_min_qty} onChange={(e) => setForm({ ...form, eligible_min_qty: e.target.value })} className={inp} placeholder="ไม่กำหนด" /></Field>
                  <label className="flex items-center gap-2 text-sm cursor-pointer pt-5">
                    <input type="checkbox" checked={form.eligible_across_sku} onChange={(e) => setForm({ ...form, eligible_across_sku: e.target.checked })} className="w-4 h-4 accent-current" />
                    นับรวมข้าม SKU ได้
                  </label>
                </div>
              </>
            )}
          </Section>

          {/* สิทธิ์ประโยชน์ */}
          <Section title="สิทธิ์ประโยชน์">
            <div className="flex gap-2">
              {(["discount", "gift"] as const).map((v) => (
                <button key={v} onClick={() => setForm({ ...form, promo_type: v })} className={`px-3 h-8 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${form.promo_type === v ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>
                  {v === "gift" ? <><Gift size={12} /> ของแถม</> : <><Tag size={12} /> ส่วนลด</>}
                </button>
              ))}
            </div>

            {form.promo_type === "discount" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="ประเภทส่วนลด">
                  <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} className={inp}>
                    <option value="amount">จำนวนเงิน (บาท)</option><option value="percent">เปอร์เซ็นต์ (%)</option>
                  </select>
                </Field>
                <Field label={form.discount_type === "percent" ? "ลดกี่ %" : "ลดกี่บาท"}><input type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} className={inp} /></Field>
                {form.discount_type === "percent" && <Field label="ส่วนลดสูงสุด (บาท)"><input type="number" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} className={inp} placeholder="ไม่จำกัด" /></Field>}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted">เลือกสินค้าของแถม (จะถูกเพิ่มในบิลราคา ฿0 แต่ตัดสต๊อก + คิดต้นทุน)</div>
                <ProductPicker onPick={(p) => addProd("gifts", p)} />
                <ProdList list={form.gifts} gift onRemove={(sku) => rmProd("gifts", sku)} onQty={(sku, q) => setForm((f) => ({ ...f, gifts: f.gifts.map((x) => x.sku === sku ? { ...x, gift_qty: q } : x) }))} />
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label="รูปแบบแถม">
                    <select value={form.gift_mode} onChange={(e) => setForm({ ...form, gift_mode: e.target.value })} className={inp}>
                      <option value="per_bill">แถม 1 ชุด/บิล</option><option value="per_item">ทุกจำนวนที่ซื้อ</option>
                    </select>
                  </Field>
                  {form.gift_mode === "per_item" && <Field label="ซื้อร่วมทุกกี่ชิ้น"><input type="number" value={form.gift_per_qty} onChange={(e) => setForm({ ...form, gift_per_qty: e.target.value })} className={inp} /></Field>}
                  <Field label="เพดานของแถม/บิล"><input type="number" value={form.gift_cap} onChange={(e) => setForm({ ...form, gift_cap: e.target.value })} className={inp} placeholder="ไม่จำกัด" /></Field>
                </div>
              </div>
            )}
          </Section>

          {/* ข้อจำกัด */}
          <Section title="ข้อจำกัด">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="ยอดซื้อขั้นต่ำ (บาท)"><input type="number" value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: e.target.value })} className={inp} placeholder="0" /></Field>
              <Field label="กลุ่มลูกค้า"><select value={form.target_segment} onChange={(e) => setForm({ ...form, target_segment: e.target.value })} className={inp}>{SEG_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></Field>
              <Field label="ใช้ได้รวม (ครั้ง)"><input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} className={inp} placeholder="ไม่จำกัด" /></Field>
              <Field label="ต่อคน (ครั้ง)"><input type="number" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })} className={inp} placeholder="ไม่จำกัด" /></Field>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer pt-1">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-current" />
              <span className="text-sm font-medium">เปิดใช้งาน</span>
            </label>
          </Section>
        </div>
      </Modal>
    </div>
  );
}

const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-3.5 space-y-3">
      <div className="text-sm font-bold text-ink">{title}</div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs text-muted block">{label}{children}</label>;
}
function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] text-muted flex items-center gap-1">{icon}{label}</div>
      <div className="text-sm font-bold tnum text-ink">{value}</div>
    </div>
  );
}
function MultiChips({ label, opts, sel, onToggle }: { label: string; opts: { v: string; label: string }[]; sel: string[]; onToggle: (v: string) => void }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {opts.length === 0 ? <span className="text-xs text-muted">—</span> : opts.map((o) => (
          <button key={o.v} onClick={() => onToggle(o.v)} className={`px-2.5 h-7 rounded-full text-[11px] font-semibold ${sel.includes(o.v) ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function ProductPicker({ onPick }: { onPick: (p: ProdRef) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    let alive = true; setLoading(true);
    const id = setTimeout(async () => {
      try {
        const j = await fetch(`/api/admin/products?q=${encodeURIComponent(q.trim())}`).then((r) => r.json());
        if (alive) setHits((j.products ?? []).map((p: { id: string; sku: string; name: string }) => ({ id: p.id, sku: p.sku, name: p.name })));
      } finally { if (alive) setLoading(false); }
    }, 280);
    return () => { alive = false; clearTimeout(id); };
  }, [q]);
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-2.5 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาสินค้า (ชื่อ/SKU)…" className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface2/60 border border-line outline-none text-sm focus:border-brand/40" />
      {loading && <Loader2 size={14} className="absolute right-3 top-2.5 animate-spin text-muted" />}
      {hits.length > 0 && (
        <ul className="mt-1 border border-line rounded-xl overflow-hidden divide-y divide-line/60 max-h-52 overflow-y-auto bg-surface">
          {hits.map((p) => (
            <li key={p.id}>
              <button onClick={() => { onPick({ product_id: p.id, sku: p.sku, name: p.name }); setQ(""); setHits([]); }} className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{p.name}</span>
                <span className="text-[11px] font-mono text-muted">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProdList({ list, gift, onRemove, onQty }: { list: ProdRef[]; gift?: boolean; onRemove: (sku: string) => void; onQty?: (sku: string, q: number) => void }) {
  if (list.length === 0) return <p className="text-xs text-muted">ยังไม่เลือกสินค้า</p>;
  return (
    <ul className="space-y-1.5">
      {list.map((p) => (
        <li key={p.sku} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line">
          <span className="min-w-0 flex-1">
            <span className="text-sm truncate block">{p.name ?? p.sku}</span>
            <span className="text-[11px] font-mono text-muted">{p.sku}</span>
          </span>
          {gift && onQty && (
            <input type="number" min={1} value={p.gift_qty ?? 1} onChange={(e) => onQty(p.sku, Math.max(1, Number(e.target.value) || 1))}
              className="w-14 h-8 px-2 rounded-lg bg-surface2/60 border border-line text-sm text-center" title="จำนวน/ชุด" />
          )}
          <button onClick={() => onRemove(p.sku)} className="text-muted hover:text-danger"><X size={15} /></button>
        </li>
      ))}
    </ul>
  );
}
