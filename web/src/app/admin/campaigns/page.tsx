"use client";

// =====================================================================
// Admin → แคมเปญ / คูปอง (วัดผล)
//   • สร้างคูปองเฉพาะกลุ่ม (เงื่อนไข ยอดขั้นต่ำ / ช่วงเวลา / จำนวนครั้ง)
//   • วัดผล: ใช้กี่ครั้ง, ส่วนลดรวม, ยอดขายที่เกิดจากคูปอง, ลูกค้ากี่คน
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { Ticket, Plus, Trash2, Loader2, Pencil, TrendingUp, Users, Tag, Power } from "lucide-react";
import { Modal, EmptyState } from "@/components/ui";
import { formatTHB } from "@/lib/money";

interface Campaign {
  id: string; name: string; description: string | null; code: string | null;
  discount_type: string; discount_value: number; max_discount: number | null; min_spend: number;
  target_segment: string; starts_at: string | null; ends_at: string | null;
  usage_limit: number | null; per_customer_limit: number | null; active: boolean;
  uses: number; discount_total: number; revenue: number; customers: number;
}

const SEG_LABEL: Record<string, string> = {
  all: "ทุกคน", new: "ลูกค้าใหม่", returning: "ซื้อซ้ำ", vip: "VIP", lost: "หายไป",
};
const SEG_OPTS = Object.entries(SEG_LABEL).map(([v, label]) => ({ v, label }));

const EMPTY = {
  id: "", name: "", description: "", code: "", discount_type: "amount", discount_value: "",
  max_discount: "", min_spend: "", target_segment: "all", starts_at: "", ends_at: "",
  usage_limit: "", per_customer_limit: "1", active: true,
};
type FormState = typeof EMPTY;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

export default function AdminCampaignsPage() {
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
    } finally {
      setLoading(false);
    }
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
    });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr("ต้องใส่ชื่อแคมเปญ"); return; }
    setSaving(true); setErr("");
    try {
      const body = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, description: form.description, code: form.code,
        discount_type: form.discount_type, discount_value: Number(form.discount_value || 0),
        max_discount: form.max_discount, min_spend: Number(form.min_spend || 0),
        target_segment: form.target_segment, starts_at: form.starts_at || null, ends_at: form.ends_at || null,
        usage_limit: form.usage_limit, per_customer_limit: form.per_customer_limit, active: form.active,
      };
      const res = await fetch("/api/admin/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (res.ok) { setOpen(false); await load(); }
      else setErr(j.error ?? "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: Campaign) {
    await fetch("/api/admin/campaigns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, active: !c.active }),
    });
    await load();
  }
  async function remove(c: Campaign) {
    if (!confirm(`ลบแคมเปญ "${c.name}"?`)) return;
    await fetch(`/api/admin/campaigns?id=${c.id}`, { method: "DELETE" });
    setItems((p) => p.filter((x) => x.id !== c.id));
  }

  const discLabel = (c: Campaign) =>
    c.discount_type === "percent" ? `ลด ${c.discount_value}%${c.max_discount ? ` (สูงสุด ${formatTHB(c.max_discount, false)})` : ""}` : `ลด ${formatTHB(c.discount_value, false)}`;

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Ticket size={22} /> แคมเปญ / คูปอง</h1>
          <p className="text-sm text-muted mt-0.5">สร้างคูปองเฉพาะกลุ่ม แล้ววัดผลว่าใช้แล้วกลับมาซื้อเท่าไร</p>
        </div>
        <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brand-ink text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> สร้างคูปอง
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> กำลังโหลด…</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Ticket size={26} />} title="ยังไม่มีแคมเปญ" body="กด “สร้างคูปอง” เพื่อเริ่มแคมเปญแรก" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((c) => (
            <div key={c.id} className={`p-4 rounded-2xl border bg-surface ${c.active ? "border-line" : "border-line opacity-60"}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{c.name}</span>
                    {c.code && <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-brand/10 text-brand">{c.code}</span>}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-muted">{SEG_LABEL[c.target_segment] ?? c.target_segment}</span>
                    {!c.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600">ปิดอยู่</span>}
                  </div>
                  <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink/80"><Tag size={11} />{discLabel(c)}</span>
                    {c.min_spend > 0 && <span>ซื้อขั้นต่ำ {formatTHB(c.min_spend, false)}</span>}
                    {(c.starts_at || c.ends_at) && <span>{fmtDate(c.starts_at)}–{fmtDate(c.ends_at)}</span>}
                    {c.usage_limit && <span>จำกัด {c.usage_limit} ครั้ง</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => void toggleActive(c)} title={c.active ? "ปิด" : "เปิด"}
                    className={`h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2 ${c.active ? "text-emerald-600" : "text-muted"}`}><Power size={15} /></button>
                  <button onClick={() => openEdit(c)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><Pencil size={15} /></button>
                  <button onClick={() => void remove(c)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-surface2"><Trash2 size={15} /></button>
                </div>
              </div>

              {/* วัดผล */}
              <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-line">
                <Stat label="ใช้" value={String(c.uses)} />
                <Stat label="ลูกค้า" value={String(c.customers)} icon={<Users size={12} />} />
                <Stat label="ส่วนลดรวม" value={formatTHB(c.discount_total, false)} tone="rose" />
                <Stat label="ยอดขายที่เกิด" value={formatTHB(c.revenue, false)} tone="emerald" icon={<TrendingUp size={12} />} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? "แก้ไขแคมเปญ" : "สร้างคูปอง"} size="md"
        footer={
          <>
            <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">ยกเลิก</button>
            <button onClick={() => void save()} disabled={saving || !form.name.trim()}
              className="h-10 px-5 rounded-xl bg-brand text-brand-ink text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} บันทึก
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>}
          <Field label="ชื่อแคมเปญ *">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="เช่น ลด 100 ลูกค้าใหม่" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="รหัสคูปอง">
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="NEW100" />
            </Field>
            <Field label="กลุ่มเป้าหมาย">
              <select value={form.target_segment} onChange={(e) => setForm({ ...form, target_segment: e.target.value })} className={inp}>
                {SEG_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="ประเภทส่วนลด">
              <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} className={inp}>
                <option value="amount">จำนวนเงิน (บาท)</option>
                <option value="percent">เปอร์เซ็นต์ (%)</option>
              </select>
            </Field>
            <Field label={form.discount_type === "percent" ? "ลดกี่ %" : "ลดกี่บาท"}>
              <input type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} className={inp} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {form.discount_type === "percent" && (
              <Field label="ส่วนลดสูงสุด (บาท)">
                <input type="number" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} className={inp} placeholder="ไม่จำกัด" />
              </Field>
            )}
            <Field label="ยอดซื้อขั้นต่ำ (บาท)">
              <input type="number" value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: e.target.value })} className={inp} placeholder="0" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="เริ่ม"><input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inp} /></Field>
            <Field label="สิ้นสุด"><input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="ใช้ได้รวม (ครั้ง)"><input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} className={inp} placeholder="ไม่จำกัด" /></Field>
            <Field label="ต่อคน (ครั้ง)"><input type="number" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })} className={inp} placeholder="ไม่จำกัด" /></Field>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer pt-1">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-current" />
            <span className="text-sm font-medium">เปิดใช้งาน</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs text-muted block">{label}{children}</label>;
}
function Stat({ label, value, tone, icon }: { label: string; value: string; tone?: "rose" | "emerald"; icon?: React.ReactNode }) {
  const cls = tone === "rose" ? "text-rose-600 dark:text-rose-300" : tone === "emerald" ? "text-emerald-600 dark:text-emerald-300" : "text-ink";
  return (
    <div>
      <div className="text-[10.5px] text-muted flex items-center gap-1">{icon}{label}</div>
      <div className={`text-sm font-bold tnum ${cls}`}>{value}</div>
    </div>
  );
}
