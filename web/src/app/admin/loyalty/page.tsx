"use client";
// แต้มสะสม — ภาพรวม · อัตราหลัก + ระดับสมาชิก · กฎพิเศษ (ช่วงเวลา/วันเกิด/ซื้อครั้งแรก) · แต้มใกล้หมดอายุ · ตัวจำลอง
//   สูตรจริงอยู่ที่ DB (pos_loyalty_calc) — หน้านี้ หน้าขาย และตอนบันทึกบิล ใช้สูตรเดียวกัน
import { useEffect, useMemo, useState } from "react";
import { Star, Plus, Pencil, Trash2, Calculator, Clock3, Tag, Gift, X as XIcon, Search, Crown, Cake, Sparkles, Coins, TrendingDown, Hourglass, Users, Power } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button, Drawer, KpiTile, Segmented } from "@/components/ui";
import { SearchSelect } from "@/components/admin/search-select";
import { formatTHB } from "@/lib/money";
import { exportCsv, stampFilename } from "@/lib/export";

type Program = { id: string; brand_id: string | null; active: boolean; spend_per_unit: number; points_per_unit: number; min_spend: number; max_points_per_bill: number | null; earn_on_redeemed_bill: boolean; expiry_months: number | null; note: string | null; updated_at: string };
type Cond = "none" | "birthday_day" | "birthday_month" | "first_purchase";
type Rule = { id?: string; brand_id: string | null; name: string; kind: "multiplier" | "per_item" | "bonus"; active: boolean; starts_at: string | null; ends_at: string | null; days_of_week: number[]; time_from: string | null; time_to: string | null; branch_ids: string[]; channels: string[]; target_segment: string; customer_condition: Cond; product_ids: string[]; category_ids: string[]; multiplier: number | null; points_per_unit: number | null; bonus_points: number | null; min_spend: number; min_qty: number; priority: number };
type Tier = { id?: string; brand_id: string | null; code: string; name: string; min_spend: number; multiplier: number; color: string; perks: string | null; active: boolean };
type Data = { programs: Program[]; rules: Rule[]; tiers: Tier[]; brands: { id: string; name: string }[]; branches: { id: string; name: string; code: string; brand_id: string | null }[]; categories: { id: string; name_th: string }[]; products: { id: string; sku: string; name_th: string }[] };
type Calc = { points: number; reason?: string; base?: number; capped?: boolean; expiry_months?: number | null; tier?: { name?: string; color?: string } | null; parts: { kind: string; label: string; points: number; qty?: number; multiplier?: number }[] };
type Stats = { earned: number; redeemed: number; expired: number; outstanding: number; members_active: number; earning_bills: number; tiers: Record<string, number> };

const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const CHANNELS: [string, string][] = [["offline", "หน้าร้าน"], ["online_shopee", "Shopee"], ["online_lazada", "Lazada"], ["online_tiktok", "TikTok"], ["online_website", "เว็บไซต์"], ["event", "อีเวนต์"], ["b2b", "ขายส่ง"], ["other", "อื่นๆ"]];
const SEGMENTS: [string, string][] = [["all", "ทุกคน"], ["new", "ลูกค้าใหม่"], ["returning", "ลูกค้าประจำ"], ["vip", "VIP"], ["lost", "ลูกค้าห่างหาย"]];
const CONDS: { v: Cond; label: string; hint: string }[] = [
  { v: "none", label: "ทุกคน", hint: "" },
  { v: "birthday_day", label: "ตรงวันเกิด", hint: "ใช้วันเกิดในข้อมูลลูกค้า" },
  { v: "birthday_month", label: "เดือนเกิด", hint: "ทั้งเดือนเกิดของลูกค้า" },
  { v: "first_purchase", label: "ซื้อครั้งแรก", hint: "บิลแรกของลูกค้า" },
];
const KIND: Record<Rule["kind"], { th: string; desc: string; icon: typeof Star; tint: string }> = {
  multiplier: { th: "คูณแต้ม", desc: "คูณแต้มฐานของบิล (หลายกฎพร้อมกันใช้ตัวคูณสูงสุด)", icon: Sparkles, tint: "bg-violet-500/10 text-violet-600" },
  per_item: { th: "แต้มรายชิ้น", desc: "ซื้อสินค้า/หมวดที่เลือก ได้แต้มเพิ่มต่อชิ้น", icon: Tag, tint: "bg-sky-500/10 text-sky-600" },
  bonus: { th: "โบนัสต่อบิล", desc: "ได้แต้มเพิ่มต่อบิล ตั้งยอดขั้นต่ำได้", icon: Gift, tint: "bg-emerald-500/10 text-emerald-600" },
};
const TIER_PRESET: Omit<Tier, "brand_id">[] = [
  { code: "member", name: "Member", min_spend: 0, multiplier: 1, color: "#9CA3AF", perks: null, active: true },
  { code: "silver", name: "Silver", min_spend: 20000, multiplier: 1.25, color: "#94A3B8", perks: null, active: true },
  { code: "gold", name: "Gold", min_spend: 50000, multiplier: 1.5, color: "#D4A017", perks: null, active: true },
  { code: "platinum", name: "Platinum", min_spend: 100000, multiplier: 2, color: "#6D28D9", perks: null, active: true },
];
const emptyRule = (brand: string | null): Rule => ({ brand_id: brand, name: "", kind: "multiplier", active: true, starts_at: null, ends_at: null, days_of_week: [], time_from: null, time_to: null, branch_ids: [], channels: [], target_segment: "all", customer_condition: "none", product_ids: [], category_ids: [], multiplier: 2, points_per_unit: 10, bonus_points: 100, min_spend: 0, min_qty: 1, priority: 0 });
const TEMPLATES: { label: string; icon: typeof Star; rule: Partial<Rule> }[] = [
  { label: "วันเกิดรับ 200 แต้ม", icon: Cake, rule: { name: "ของขวัญวันเกิด +200 แต้ม", kind: "bonus", bonus_points: 200, customer_condition: "birthday_day" } },
  { label: "เดือนเกิดแต้ม ×2", icon: Cake, rule: { name: "เดือนเกิด แต้ม ×2", kind: "multiplier", multiplier: 2, customer_condition: "birthday_month" } },
  { label: "ลูกค้าใหม่ +100", icon: Users, rule: { name: "ต้อนรับลูกค้าใหม่ +100 แต้ม", kind: "bonus", bonus_points: 100, customer_condition: "first_purchase" } },
  { label: "เสาร์-อาทิตย์ ×2", icon: Sparkles, rule: { name: "สุดสัปดาห์ แต้ม ×2", kind: "multiplier", multiplier: 2, days_of_week: [0, 6] } },
  { label: "Happy hour 17–20 น.", icon: Clock3, rule: { name: "Happy hour แต้ม ×1.5", kind: "multiplier", multiplier: 1.5, time_from: "17:00", time_to: "20:00" } },
];
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nf = (n: number) => Number(n || 0).toLocaleString("th-TH");
const inputCls = "w-full h-9 px-2.5 rounded-lg border border-line bg-surface text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/10";

function ruleState(r: Rule): { label: string; cls: string; group: 0 | 1 | 2 } {
  const now = Date.now();
  if (!r.active) return { label: "ปิดอยู่", cls: "bg-surface2 text-muted", group: 2 };
  if (r.starts_at && new Date(r.starts_at).getTime() > now) return { label: "ยังไม่เริ่ม", cls: "bg-sky-500/10 text-sky-600", group: 1 };
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return { label: "หมดช่วงแล้ว", cls: "bg-surface2 text-muted", group: 2 };
  return { label: "กำลังใช้", cls: "bg-ok/12 text-ok", group: 0 };
}
function ruleValue(r: Rule) {
  if (r.kind === "multiplier") return `×${r.multiplier} แต้มฐาน`;
  if (r.kind === "per_item") return `ชิ้นละ ${nf(r.points_per_unit ?? 0)} แต้ม${r.min_qty > 1 ? ` (ตั้งแต่ ${r.min_qty} ชิ้น)` : ""}`;
  return `+${nf(r.bonus_points ?? 0)} แต้มต่อบิล`;
}
function ruleWhen(r: Rule) {
  const p: string[] = [];
  if (r.starts_at || r.ends_at) p.push(`${r.starts_at ? fmtDT(r.starts_at) : "ตั้งแต่ตอนนี้"} → ${r.ends_at ? fmtDT(r.ends_at) : "ไม่มีกำหนด"}`);
  if (r.days_of_week.length) p.push(`ทุกวัน${r.days_of_week.slice().sort().map((d) => DAYS[d]).join(" ")}`);
  if (r.time_from || r.time_to) p.push(`${r.time_from?.slice(0, 5) ?? "00:00"}–${r.time_to?.slice(0, 5) ?? "24:00"} น.${r.time_from && r.time_to && r.time_from > r.time_to ? " (ข้ามเที่ยงคืน)" : ""}`);
  return p.length ? p.join(" · ") : "ตลอดเวลา";
}

export default function LoyaltyPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string) => (locale === "th" ? th : en);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<string | null>(null); // null = ค่าเริ่มต้น
  const [tab, setTab] = useState<"earn" | "rules" | "expiring">("earn");
  const [edit, setEdit] = useState<Rule | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/admin/loyalty", { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let alive = true; setStats(null);
    fetch(`/api/admin/loyalty?stats=30${brand ? `&brand=${brand}` : ""}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive && j.stats) setStats(j.stats); }).catch(() => {});
    return () => { alive = false; };
  }, [brand, data]);

  const rules = useMemo(() => (data?.rules ?? []).filter((r) => brand === null ? true : r.brand_id === null || r.brand_id === brand), [data, brand]);
  const brandName = (id: string | null) => (id ? data?.brands.find((b) => b.id === id)?.name ?? "—" : L("ทุกแบรนด์", "All brands"));
  async function post(body: unknown) {
    const r = await fetch("/api/admin/loyalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw Error(j.error); return j;
  }
  const activeRules = rules.filter((r) => ruleState(r).group === 0).length;

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <header className="flex flex-wrap items-end gap-3">
        <span className="h-11 w-11 grid place-items-center rounded-2xl bg-amber-500/12 text-amber-600"><Star size={20} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{L("แต้มสะสม", "Loyalty")}</h1>
          <p className="text-xs text-muted">{L("ตั้งอัตราได้แต้ม ระดับสมาชิก และกฎพิเศษรายแบรนด์ — คำนวณอัตโนมัติทุกบิลที่มีลูกค้า", "Per-brand earning, tiers and rules — applied automatically")}</p>
        </div>
        <label className="text-xs text-muted flex items-center gap-2">{L("แบรนด์", "Brand")}
          <select value={brand ?? ""} onChange={(e) => setBrand(e.target.value || null)} className="h-9 min-w-[200px] px-2.5 rounded-xl border border-line bg-surface text-sm text-ink">
            <option value="">{L("ค่าเริ่มต้น (ทุกแบรนด์)", "Default (all brands)")}</option>
            {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{data?.programs.some((p) => p.brand_id === b.id) || data?.tiers.some((t) => t.brand_id === b.id) ? " •" : ""}</option>)}
          </select>
        </label>
      </header>
      {error ? <p role="alert" className="rounded-xl px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("แต้มที่ให้ลูกค้า · 30 วัน", "Issued · 30d")} value={stats ? nf(stats.earned) : "—"} sub={stats ? `${nf(stats.earning_bills)} ${L("บิล", "bills")}` : undefined} accent="lime" icon={<Coins size={14} />} />
        <KpiTile label={L("แต้มที่ลูกค้าใช้ · 30 วัน", "Redeemed · 30d")} value={stats ? nf(stats.redeemed) : "—"} sub={stats ? `≈ ${formatTHB(stats.redeemed, false)} ${L("ส่วนลด", "discount")}` : undefined} accent="lavender" icon={<TrendingDown size={14} />} />
        <KpiTile label={L("แต้มหมดอายุ · 30 วัน", "Expired · 30d")} value={stats ? nf(stats.expired) : "—"} accent="coral" icon={<Hourglass size={14} />} />
        <KpiTile label={L("แต้มคงค้างในระบบ", "Outstanding")} value={stats ? nf(stats.outstanding) : "—"} sub={stats ? `${nf(stats.members_active)} ${L("สมาชิกเคลื่อนไหว 30 วัน", "active members")}` : undefined} accent="peach" icon={<Users size={14} />} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" value={tab} onChange={setTab} options={[
          { value: "earn", label: L("อัตราและระดับสมาชิก", "Earning & tiers") },
          { value: "rules", label: <span className="inline-flex items-center gap-1.5">{L("กฎพิเศษ", "Rules")}{activeRules ? <span className="text-[10px] px-1.5 rounded-full bg-ok/15 text-ok">{activeRules}</span> : null}</span> },
          { value: "expiring", label: L("แต้มใกล้หมดอายุ", "Expiring") },
        ]} />
        {tab === "rules" ? <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEdit(emptyRule(brand))}><Plus size={13} />{L("เพิ่มกฎ", "Add rule")}</Button> : null}
      </div>

      {tab === "expiring" ? <ExpiringReport brand={brand} /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div className="space-y-4 min-w-0">
            {tab === "earn" ? <>
              <ProgramCard data={data} brand={brand} brandName={brandName(brand)} post={post} reload={load} />
              <TierCard data={data} brand={brand} stats={stats} post={post} reload={load} />
            </> : (
              <RuleList rules={rules} brandName={brandName} onEdit={(r) => setEdit({ ...r })} onNew={(r) => setEdit({ ...emptyRule(brand), ...r })} post={post} reload={load} />
            )}
          </div>
          <Simulator data={data} brand={brand} />
        </div>
      )}

      {edit ? <RuleDrawer rule={edit} data={data} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} post={post} /> : null}
    </div>
  );
}

// ---------- อัตราหลัก ----------
function ProgramCard({ data, brand, brandName, post, reload }: { data: Data | null; brand: string | null; brandName: string; post: (b: unknown) => Promise<unknown>; reload: () => Promise<void> }) {
  const def = data?.programs.find((p) => p.brand_id === null) ?? null;
  const own = data?.programs.find((p) => p.brand_id === brand) ?? null;
  const [form, setForm] = useState<Program | null>(null);
  const [saving, setSaving] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { setForm(own ? { ...own } : null); setMsg(null); }, [brand, own?.id, own?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!form) return;
    setSaving(true); setMsg(null);
    try { await post({ action: "save_program", ...form, brand_id: brand }); await reload(); setMsg({ ok: true, t: "บันทึกแล้ว — มีผลกับบิลถัดไปทันที" }); }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }); } finally { setSaving(false); }
  }
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold">อัตราได้แต้มหลัก</p>
          <p className="text-xs text-muted">{brandName} · คิดจากยอดสุทธิที่ลูกค้าจ่าย ปัดเศษลง</p>
        </div>
        {brand !== null && own ? <button onClick={async () => { if (!confirmDelete()) return; await post({ action: "delete_program", brand_id: brand }); await reload(); }} className="text-xs text-muted hover:text-danger">กลับไปใช้ค่าเริ่มต้น</button> : null}
      </div>
      {!form ? (
        <div className="rounded-xl bg-surface2/60 p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm flex-1">แบรนด์นี้ใช้ค่าเริ่มต้น: <b>{def ? `ทุก ${nf(def.spend_per_unit)} บาท ได้ ${nf(def.points_per_unit)} แต้ม` : "—"}</b>{def?.expiry_months ? <span className="text-muted"> · หมดอายุ {def.expiry_months} เดือน</span> : null}</p>
          <Button size="sm" variant="soft" onClick={() => def && setForm({ ...def, id: "", brand_id: brand, note: null })}><Pencil size={13} />ตั้งค่าเฉพาะแบรนด์นี้</Button>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-amber-500/6 border border-amber-500/20 px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
            <span>ซื้อทุก</span>
            <input type="number" min={1} value={form.spend_per_unit} onChange={(e) => setForm({ ...form, spend_per_unit: Number(e.target.value) })} className="w-24 h-9 px-2 rounded-lg border border-line bg-surface text-right tnum font-semibold" />
            <span>บาท ได้</span>
            <input type="number" min={0} value={form.points_per_unit} onChange={(e) => setForm({ ...form, points_per_unit: Number(e.target.value) })} className="w-20 h-9 px-2 rounded-lg border border-line bg-surface text-right tnum font-semibold" />
            <span>แต้ม</span>
            {form.spend_per_unit > 0 ? <span className="ml-auto text-xs text-muted">ซื้อ 1,000 บาท ≈ {nf(Math.floor(1000 / form.spend_per_unit) * form.points_per_unit)} แต้ม</span> : null}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <label className="space-y-1"><span className="text-muted">ยอดขั้นต่ำต่อบิล (บาท)</span>
              <input type="number" min={0} value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: Number(e.target.value) })} className={inputCls + " tnum"} /></label>
            <label className="space-y-1"><span className="text-muted">เพดานแต้มต่อบิล <span className="opacity-70">(ว่าง = ไม่จำกัด)</span></span>
              <input type="number" min={0} value={form.max_points_per_bill ?? ""} onChange={(e) => setForm({ ...form, max_points_per_bill: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls + " tnum"} /></label>
            <label className="space-y-1"><span className="text-muted">อายุแต้ม (เดือน) <span className="opacity-70">(ว่าง = ไม่หมดอายุ)</span></span>
              <input type="number" min={1} max={120} value={form.expiry_months ?? ""} onChange={(e) => setForm({ ...form, expiry_months: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls + " tnum"} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <Toggle checked={form.earn_on_redeemed_bill} onChange={(v) => setForm({ ...form, earn_on_redeemed_bill: v })} label="บิลที่ใช้แต้มแลกส่วนลด ยังได้แต้มใหม่" />
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="เปิดสะสมแต้ม" />
            <span className="ml-auto flex items-center gap-2">
              {msg ? <span className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.t}</span> : null}
              <Button variant="primary" loading={saving} onClick={() => void save()}>บันทึก</Button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- ระดับสมาชิก ----------
function TierCard({ data, brand, stats, post, reload }: { data: Data | null; brand: string | null; stats: Stats | null; post: (b: unknown) => Promise<unknown>; reload: () => Promise<void> }) {
  const saved = useMemo(() => (data?.tiers ?? []).filter((t) => t.brand_id === brand).sort((a, b) => a.min_spend - b.min_spend), [data, brand]);
  const inherited = brand !== null && !saved.length ? (data?.tiers ?? []).filter((t) => t.brand_id === null) : [];
  const [rows, setRows] = useState<Tier[]>([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { setRows(saved.map((t) => ({ ...t }))); }, [saved]);
  useEffect(() => { setMsg(null); }, [brand]);
  const dirty = JSON.stringify(rows.map(({ code, name, min_spend, multiplier, color, perks, active }) => ({ code, name, min_spend, multiplier, color, perks, active })))
    !== JSON.stringify(saved.map(({ code, name, min_spend, multiplier, color, perks, active }) => ({ code, name, min_spend, multiplier, color, perks, active })));
  const set = (i: number, patch: Partial<Tier>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save() {
    setBusy(true); setMsg(null);
    try { await post({ action: "save_tiers", brand_id: brand, tiers: rows.slice().sort((a, b) => a.min_spend - b.min_spend) }); await reload(); setMsg({ ok: true, t: "บันทึกระดับแล้ว — ใช้กับบิลถัดไป" }); }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }); } finally { setBusy(false); }
  }
  return (
    <section className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="h-9 w-9 grid place-items-center rounded-xl bg-amber-500/12 text-amber-600"><Crown size={16} /></span>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold">ระดับสมาชิก</p>
          <p className="text-xs text-muted">ตามยอดซื้อ 12 เดือนย้อนหลัง · ระดับสูงได้แต้มเพิ่ม = แต้มฐาน × (ตัวคูณ − 1) · ปรับระดับอัตโนมัติทุกครั้งที่ซื้อ</p>
        </div>
        {!rows.length ? <Button size="sm" variant="soft" onClick={() => setRows(TIER_PRESET.map((t) => ({ ...t, brand_id: brand })))}><Sparkles size={13} />ใช้ชุดแนะนำ 4 ระดับ</Button> : null}
      </div>
      {inherited.length ? <p className="text-xs rounded-lg bg-surface2/60 px-3 py-2">แบรนด์นี้ใช้ระดับค่าเริ่มต้น: {inherited.map((t) => t.name).join(" · ")} — ตั้งชุดของแบรนด์เองได้ด้านล่าง</p> : null}
      {rows.length ? (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[28px_1.2fr_1fr_90px_1.4fr_28px] gap-2 px-1 text-[11px] text-muted">
            <span /><span>ชื่อระดับ</span><span>ยอดซื้อ 12 เดือนตั้งแต่ (บาท)</span><span>ตัวคูณแต้ม</span><span>สิทธิพิเศษ (แสดงให้พนักงานเห็น)</span><span />
          </div>
          {rows.map((t, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_28px] sm:grid-cols-[28px_1.2fr_1fr_90px_1.4fr_28px] gap-2 items-center rounded-xl border border-line px-2 py-2">
              <input type="color" value={t.color} onChange={(e) => set(i, { color: e.target.value })} className="h-7 w-7 rounded-full border border-line cursor-pointer bg-transparent" title="สีป้าย" />
              <input value={t.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="เช่น Gold" className={inputCls} />
              <input type="number" min={0} value={t.min_spend} onChange={(e) => set(i, { min_spend: Number(e.target.value) })} className={inputCls + " tnum text-right hidden sm:block"} />
              <input type="number" min={1} max={10} step={0.05} value={t.multiplier} onChange={(e) => set(i, { multiplier: Number(e.target.value) })} className={inputCls + " tnum text-right hidden sm:block"} />
              <input value={t.perks ?? ""} onChange={(e) => set(i, { perks: e.target.value || null })} placeholder="เช่น ส่งฟรี / ลดเพิ่ม 5%" className={inputCls + " hidden sm:block"} />
              <button onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="h-7 w-7 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-danger/5" title="ลบระดับ"><XIcon size={14} /></button>
              <div className="col-span-3 grid grid-cols-2 gap-2 sm:hidden">
                <input type="number" min={0} value={t.min_spend} onChange={(e) => set(i, { min_spend: Number(e.target.value) })} placeholder="ยอดขั้นต่ำ" className={inputCls + " tnum"} />
                <input type="number" min={1} step={0.05} value={t.multiplier} onChange={(e) => set(i, { multiplier: Number(e.target.value) })} placeholder="ตัวคูณ" className={inputCls + " tnum"} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {rows.length < 10 ? <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, { brand_id: brand, code: "", name: "", min_spend: (r.at(-1)?.min_spend ?? 0) + 10000, multiplier: 1, color: "#9CA3AF", perks: null, active: true }])}><Plus size={13} />เพิ่มระดับ</Button> : null}
            {msg ? <span className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.t}</span> : null}
            <span className="ml-auto flex gap-2">
              {dirty ? <Button size="sm" variant="ghost" onClick={() => setRows(saved.map((t) => ({ ...t })))}>ยกเลิกแก้ไข</Button> : null}
              <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>บันทึกระดับ</Button>
            </span>
          </div>
          {saved.length && stats ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {saved.map((t) => <span key={t.code} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name} <b className="tnum">{nf(stats.tiers[t.code] ?? 0)}</b> คน</span>)}
            </div>
          ) : null}
        </div>
      ) : !inherited.length ? (
        <p className="text-xs text-muted rounded-xl border border-dashed border-line px-4 py-6 text-center">ยังไม่ได้ตั้งระดับสมาชิก — ทุกคนได้แต้มอัตราเดียวกัน</p>
      ) : null}
    </section>
  );
}

// ---------- กฎพิเศษ ----------
function RuleList({ rules, brandName, onEdit, onNew, post, reload }: { rules: Rule[]; brandName: (id: string | null) => string; onEdit: (r: Rule) => void; onNew: (r: Partial<Rule>) => void; post: (b: unknown) => Promise<unknown>; reload: () => Promise<void> }) {
  const groups: [string, Rule[]][] = [["กำลังใช้", []], ["ยังไม่เริ่ม", []], ["ปิด / หมดช่วง", []]];
  for (const r of rules) groups[ruleState(r).group][1].push(r);
  async function toggle(r: Rule) { await post({ action: "save_rule", rule: { ...r, active: !r.active } }); await reload(); }
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <p className="text-xs text-muted mb-2">เริ่มจากแบบสำเร็จรูป</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => <button key={t.label} onClick={() => onNew(t.rule)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line text-xs hover:border-brand/50 hover:bg-brand/5"><t.icon size={13} className="text-amber-600" />{t.label}</button>)}
        </div>
      </section>
      {rules.length ? groups.filter(([, list]) => list.length).map(([title, list]) => (
        <section key={title} className="space-y-2">
          <p className="text-xs font-semibold text-muted px-1">{title} · {list.length}</p>
          {list.map((r) => {
            const st = ruleState(r), K = KIND[r.kind], cond = CONDS.find((c) => c.v === r.customer_condition);
            return (
              <div key={r.id} className={`card px-4 py-3 flex items-start gap-3 ${st.group === 2 ? "opacity-70" : ""}`}>
                <span className={`h-9 w-9 grid place-items-center rounded-xl shrink-0 ${K.tint}`}><K.icon size={16} /></span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold flex flex-wrap items-center gap-1.5"><span className="truncate">{r.name}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-md ${st.cls}`}>{st.label}</span>
                    {r.customer_condition !== "none" ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-pink-500/10 text-pink-600 inline-flex items-center gap-1">{r.customer_condition === "first_purchase" ? <Users size={10} /> : <Cake size={10} />}{cond?.label}</span> : null}</p>
                  <p className="text-xs"><span className="text-muted">{K.th} ·</span> <b>{ruleValue(r)}</b>{r.min_spend > 0 ? <span className="text-muted"> · ขั้นต่ำ {formatTHB(r.min_spend, false)}</span> : null}</p>
                  <p className="text-[11px] text-muted flex items-center gap-1"><Clock3 size={11} />{ruleWhen(r)}</p>
                  <p className="text-[11px] text-muted truncate">
                    {brandName(r.brand_id)}{r.branch_ids.length ? ` · ${r.branch_ids.length} สาขา` : " · ทุกสาขา"}
                    {r.channels.length ? ` · ${r.channels.map((c) => CHANNELS.find((x) => x[0] === c)?.[1] ?? c).join(", ")}` : ""}
                    {r.target_segment !== "all" ? ` · ${SEGMENTS.find((s) => s[0] === r.target_segment)?.[1]}` : ""}
                    {r.kind === "per_item" ? ` · ${r.product_ids.length || r.category_ids.length ? `${r.product_ids.length} สินค้า ${r.category_ids.length} หมวด` : "ทุกสินค้า"}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => void toggle(r)} className={`h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2 ${r.active ? "text-ok" : "text-muted"}`} title={r.active ? "ปิดกฎ" : "เปิดกฎ"}><Power size={14} /></button>
                  <button onClick={() => onEdit(r)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2" title="แก้ไข"><Pencil size={14} /></button>
                  <button onClick={async () => { if (!confirmDelete()) return; await post({ action: "archive_rule", id: r.id }); await reload(); }} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-danger/5" title="ลบ"><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </section>
      )) : <p className="card text-xs text-muted text-center py-10">ยังไม่มีกฎพิเศษ — ใช้อัตราหลักอย่างเดียว · เลือกแบบสำเร็จรูปด้านบนเพื่อเริ่ม</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-xs">
      <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-brand" : "bg-line"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} /></span>
      {label}
    </button>
  );
}

// window.confirm ทำให้เบราว์เซอร์ค้างระหว่างทดสอบอัตโนมัติ — ใช้ยืนยันแบบกดซ้ำแทน
let pendingDelete = 0;
function confirmDelete(): boolean {
  const now = Date.now();
  if (now - pendingDelete < 4000) { pendingDelete = 0; return true; }
  pendingDelete = now;
  alertToast("กดอีกครั้งภายใน 4 วินาทีเพื่อยืนยันการลบ");
  return false;
}
function alertToast(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.className = "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-ink text-surface text-xs px-4 py-2 shadow-pop";
  document.body.appendChild(el); setTimeout(() => el.remove(), 3500);
}

function RuleDrawer({ rule, data, onClose, onSaved, post }: { rule: Rule; data: Data | null; onClose: () => void; onSaved: () => void; post: (b: unknown) => Promise<unknown> }) {
  const [r, setR] = useState<Rule>({ ...rule, customer_condition: rule.customer_condition ?? "none" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; sku: string; name_th: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; sku: string; name_th: string }[]>(() => (data?.products ?? []).filter((p) => rule.product_ids.includes(p.id)));
  useEffect(() => {
    if (r.kind !== "per_item" || !q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      try { const res = await fetch(`/api/admin/products?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" }); const j = await res.json(); setHits(Array.isArray(j.products) ? j.products.slice(0, 8) : []); } catch { setHits([]); }
    }, 280);
    return () => clearTimeout(t);
  }, [q, r.kind]);
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((x) => ({ ...x, [k]: v }));
  const branchOpts = (data?.branches ?? []).filter((b) => !r.brand_id || b.brand_id === r.brand_id || !b.brand_id).map((b) => ({ v: b.id, label: b.name, sub: b.code }));
  async function save() {
    setBusy(true); setErr("");
    try { await post({ action: "save_rule", rule: { ...r, product_ids: picked.map((p) => p.id) } }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); } finally { setBusy(false); }
  }
  const box = "space-y-2.5 rounded-xl border border-line p-3.5";
  return (
    <Drawer open onClose={onClose} title={rule.id ? "แก้ไขกฎแต้มสะสม" : "เพิ่มกฎแต้มสะสม"} subtitle="ทำงานอัตโนมัติกับทุกบิลที่มีลูกค้า ตามเงื่อนไขที่ตั้ง"
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={() => void save()}>บันทึก</Button></>}>
      <div className="p-5 space-y-4 text-xs">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KIND) as Rule["kind"][]).map((k) => {
            const K = KIND[k];
            return (
              <button key={k} type="button" onClick={() => set("kind", k)} className={`rounded-xl border p-2.5 text-left transition ${r.kind === k ? "border-brand ring-2 ring-brand/15 bg-brand/5" : "border-line hover:border-ink/20"}`}>
                <span className={`h-7 w-7 grid place-items-center rounded-lg ${K.tint}`}><K.icon size={14} /></span><p className="font-semibold mt-1.5">{K.th}</p><p className="text-[10.5px] text-muted leading-snug">{K.desc}</p>
              </button>
            );
          })}
        </div>
        <label className="block space-y-1"><span className="text-muted">ชื่อกฎ <span className="opacity-70">(แสดงในรายละเอียดแต้มของบิล)</span></span>
          <input value={r.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น สงกรานต์ แต้ม ×2" className={inputCls} /></label>

        <div className="grid grid-cols-2 gap-3">
          {r.kind === "multiplier" ? <label className="space-y-1"><span className="text-muted">ตัวคูณแต้มฐาน</span><input type="number" min={1} step={0.5} value={r.multiplier ?? 2} onChange={(e) => set("multiplier", Number(e.target.value))} className={inputCls + " tnum"} /></label> : null}
          {r.kind === "per_item" ? <>
            <label className="space-y-1"><span className="text-muted">แต้มต่อชิ้น</span><input type="number" min={0} value={r.points_per_unit ?? 0} onChange={(e) => set("points_per_unit", Number(e.target.value))} className={inputCls + " tnum"} /></label>
            <label className="space-y-1"><span className="text-muted">ซื้ออย่างน้อย (ชิ้น)</span><input type="number" min={1} value={r.min_qty} onChange={(e) => set("min_qty", Number(e.target.value))} className={inputCls + " tnum"} /></label>
          </> : null}
          {r.kind === "bonus" ? <label className="space-y-1"><span className="text-muted">แต้มโบนัสต่อบิล</span><input type="number" min={0} value={r.bonus_points ?? 0} onChange={(e) => set("bonus_points", Number(e.target.value))} className={inputCls + " tnum"} /></label> : null}
          {r.kind !== "per_item" ? <label className="space-y-1"><span className="text-muted">ยอดซื้อขั้นต่ำต่อบิล (บาท)</span><input type="number" min={0} value={r.min_spend} onChange={(e) => set("min_spend", Number(e.target.value))} className={inputCls + " tnum"} /></label> : null}
        </div>

        <div className={box}>
          <p className="font-semibold">ลูกค้าที่ได้สิทธิ์</p>
          <div className="flex flex-wrap gap-1.5">
            {CONDS.map((c) => <button key={c.v} type="button" onClick={() => set("customer_condition", c.v)} className={`h-8 px-3 rounded-full border inline-flex items-center gap-1.5 ${r.customer_condition === c.v ? "bg-ink text-surface border-ink" : "border-line hover:border-ink/30"}`}>{c.v === "first_purchase" ? <Users size={12} /> : c.v !== "none" ? <Cake size={12} /> : null}{c.label}</button>)}
          </div>
          {r.customer_condition !== "none" ? <p className="text-muted">{CONDS.find((c) => c.v === r.customer_condition)?.hint} · ต้องเลือกลูกค้าในบิล</p> : null}
          <label className="block space-y-1"><span className="text-muted">กลุ่มลูกค้า</span>
            <select value={r.target_segment} onChange={(e) => set("target_segment", e.target.value)} className={inputCls}>{SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>

        {r.kind === "per_item" ? (
          <div className={box}>
            <p className="font-semibold">สินค้าที่ได้แต้มรายชิ้น <span className="font-normal text-muted">(ไม่เลือกเลย = ทุกสินค้า)</span></p>
            <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อ / SKU" className={inputCls + " pl-8"} /></div>
            {hits.length ? <div className="rounded-lg border border-line divide-y divide-line/60 max-h-40 overflow-auto">{hits.map((p) => (
              <button key={p.id} type="button" onClick={() => { if (!picked.some((x) => x.id === p.id)) setPicked([...picked, p]); setQ(""); }} className="w-full text-left px-2.5 py-1.5 hover:bg-surface2"><span className="font-mono">{p.sku}</span> · {p.name_th}</button>
            ))}</div> : null}
            {picked.length ? <div className="flex flex-wrap gap-1.5">{picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5"><span className="font-mono">{p.sku}</span><button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}><XIcon size={11} /></button></span>
            ))}</div> : null}
            <SearchSelect allLabel="ไม่จำกัดหมวด" placeholder="ค้นหาหมวด…" options={(data?.categories ?? []).map((c) => ({ v: c.id, label: c.name_th }))} selected={r.category_ids} onChange={(v) => set("category_ids", v)} />
          </div>
        ) : null}

        <div className={box}>
          <p className="font-semibold">ช่วงวันเวลา <span className="font-normal text-muted">(ว่าง = ตลอด)</span></p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-muted">เริ่ม</span><input type="datetime-local" value={toLocal(r.starts_at)} onChange={(e) => set("starts_at", fromLocal(e.target.value))} className={inputCls} /></label>
            <label className="space-y-1"><span className="text-muted">สิ้นสุด</span><input type="datetime-local" value={toLocal(r.ends_at)} onChange={(e) => set("ends_at", fromLocal(e.target.value))} className={inputCls} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted mr-1">เฉพาะวัน</span>
            {DAYS.map((d, i) => <button key={d} type="button" onClick={() => set("days_of_week", r.days_of_week.includes(i) ? r.days_of_week.filter((x) => x !== i) : [...r.days_of_week, i])} className={`h-7 w-9 rounded-lg border ${r.days_of_week.includes(i) ? "bg-ink text-surface border-ink" : "border-line"}`}>{d}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-muted">เฉพาะเวลา</span>
            <input type="time" value={r.time_from?.slice(0, 5) ?? ""} onChange={(e) => set("time_from", e.target.value || null)} className="h-9 px-2 rounded-lg border border-line bg-surface" />
            <span>–</span>
            <input type="time" value={r.time_to?.slice(0, 5) ?? ""} onChange={(e) => set("time_to", e.target.value || null)} className="h-9 px-2 rounded-lg border border-line bg-surface" />
            {r.time_from && r.time_to && r.time_from > r.time_to ? <span className="text-[11px] text-sky-600">ข้ามเที่ยงคืน</span> : null}
          </div>
        </div>

        <div className={box}>
          <p className="font-semibold">ใช้กับ</p>
          <label className="block space-y-1"><span className="text-muted">แบรนด์</span>
            <select value={r.brand_id ?? ""} onChange={(e) => set("brand_id", e.target.value || null)} className={inputCls}>
              <option value="">ทุกแบรนด์</option>{(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <SearchSelect allLabel="ทุกสาขา" placeholder="ค้นหาสาขา…" options={branchOpts} selected={r.branch_ids} onChange={(v) => set("branch_ids", v)} />
          <div className="flex flex-wrap gap-1.5"><span className="text-muted mr-1 self-center">ช่องทาง <span className="opacity-70">(ว่าง = ทุกช่องทาง)</span></span>
            {CHANNELS.map(([v, l]) => <button key={v} type="button" onClick={() => set("channels", r.channels.includes(v) ? r.channels.filter((x) => x !== v) : [...r.channels, v])} className={`h-7 px-2.5 rounded-full border ${r.channels.includes(v) ? "bg-ink text-surface border-ink" : "border-line"}`}>{l}</button>)}
          </div>
        </div>
        <Toggle checked={r.active} onChange={(v) => set("active", v)} label="เปิดใช้กฎนี้" />
        {err ? <p role="alert" className="text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}

// ---------- ตัวจำลอง ----------
function Simulator({ data, brand }: { data: Data | null; brand: string | null }) {
  const branches = (data?.branches ?? []).filter((b) => brand === null || b.brand_id === brand);
  const brandOfBranch = (id: string) => data?.branches.find((b) => b.id === id)?.brand_id ?? null;
  const [branch, setBranch] = useState("");
  const [net, setNet] = useState(1000);
  const [at, setAt] = useState(() => toLocal(new Date().toISOString()));
  const [channel, setChannel] = useState("offline");
  const [sku, setSku] = useState(""), [qty, setQty] = useState(1);
  const [tier, setTier] = useState(""), [bday, setBday] = useState(false), [first, setFirst] = useState(false);
  const [res, setRes] = useState<Calc | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (!branches.some((b) => b.id === branch)) setBranch(branches[0]?.id ?? ""); }, [brand, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const tierOpts = useMemo(() => { const b = brandOfBranch(branch); const own = (data?.tiers ?? []).filter((t) => t.brand_id === b && b); return own.length ? own : (data?.tiers ?? []).filter((t) => t.brand_id === null); }, [branch, data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    setErr(""); setRes(null); setBusy(true);
    try {
      let items: { product_id: string; qty: number }[] = [];
      if (sku.trim()) {
        const r = await fetch(`/api/admin/products?q=${encodeURIComponent(sku.trim())}`, { cache: "no-store" }); const j = await r.json();
        const p = (j.products ?? []).find((x: { sku: string }) => x.sku.toLowerCase() === sku.trim().toLowerCase()) ?? j.products?.[0];
        if (!p) throw Error("ไม่พบสินค้า"); items = [{ product_id: p.id, qty }];
      }
      const r = await fetch("/api/admin/loyalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "simulate", branch_id: branch, net, channel, at: fromLocal(at), items, sim: { tier_code: tier || null, birthday: bday, first_purchase: first } }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setRes(j.result);
    } catch (e) { setErr(e instanceof Error ? e.message : "คำนวณไม่สำเร็จ"); } finally { setBusy(false); }
  }
  const reason: Record<string, string> = { no_program: "ยังไม่ได้ตั้งค่าแต้ม", redeemed_bill: "บิลที่ใช้แต้มไม่ได้แต้ม (ตามการตั้งค่า)", below_min_spend: "ยอดไม่ถึงขั้นต่ำ" };
  return (
    <aside className="card p-4 space-y-3 h-fit text-xs lg:sticky lg:top-4">
      <p className="text-sm font-semibold flex items-center gap-1.5"><Calculator size={15} className="text-amber-600" />ลองคำนวณแต้ม</p>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="text-muted">ยอดสุทธิ (บาท)</span><input type="number" value={net} onChange={(e) => setNet(Number(e.target.value))} className={inputCls + " tnum"} /></label>
        <label className="space-y-1"><span className="text-muted">ช่องทาง</span><select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="block space-y-1"><span className="text-muted">วันเวลาที่ขาย</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={inputCls} /></label>
      <div className="grid grid-cols-[1fr_64px] gap-2">
        <label className="space-y-1"><span className="text-muted">SKU <span className="opacity-70">(ไม่บังคับ)</span></span><input value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls + " font-mono"} /></label>
        <label className="space-y-1"><span className="text-muted">จำนวน</span><input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className={inputCls + " tnum"} /></label>
      </div>
      <div className="rounded-xl bg-surface2/60 p-2.5 space-y-2">
        <p className="text-muted">ลูกค้าสมมติ</p>
        {tierOpts.length ? <select value={tier} onChange={(e) => setTier(e.target.value)} className={inputCls}><option value="">ไม่ระบุระดับ</option>{tierOpts.map((t) => <option key={t.code} value={t.code}>{t.name} (×{t.multiplier})</option>)}</select> : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5"><Toggle checked={bday} onChange={setBday} label="วันเกิด" /><Toggle checked={first} onChange={setFirst} label="ซื้อครั้งแรก" /></div>
      </div>
      <Button variant="primary" className="w-full" disabled={!branch} loading={busy} onClick={() => void run()}>คำนวณแต้ม</Button>
      {err ? <p className="text-danger">{err}</p> : null}
      {res ? (
        <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 p-3 space-y-1.5">
          <p className="flex items-baseline gap-1.5"><span className="text-2xl font-semibold tnum text-amber-700 dark:text-amber-300">{nf(res.points)}</span><span className="text-muted">แต้ม</span>
            {res.tier?.name ? <span className="ml-auto inline-flex items-center gap-1 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: res.tier.color }} />{res.tier.name}</span> : null}</p>
          {res.reason ? <p className="text-muted">{reason[res.reason] ?? res.reason}</p> : null}
          <div className="divide-y divide-amber-500/15">
            {res.parts.map((p, i) => <p key={i} className="flex justify-between gap-2 py-1"><span className="text-muted">{p.label}{p.qty ? ` × ${p.qty}` : ""}{p.multiplier ? ` (×${p.multiplier})` : ""}</span><span className="tnum font-medium">{p.points > 0 ? "+" : ""}{nf(p.points)}</span></p>)}
          </div>
          {res.expiry_months ? <p className="text-[10px] text-muted">แต้มหมดอายุใน {res.expiry_months} เดือน</p> : null}
        </div>
      ) : null}
    </aside>
  );
}

// ---------- แต้มใกล้หมดอายุ ----------
type ExpRow = { customer_id: string; name: string; phone: string | null; points: number; expiring: number; next_at: string };
function ExpiringReport({ brand }: { brand: string | null }) {
  const [days, setDays] = useState(30);
  const [res, setRes] = useState<{ rows: ExpRow[]; last_run: { amount: number; created_at: string } | null } | null>(null), [err, setErr] = useState("");
  useEffect(() => {
    let alive = true; setRes(null); setErr("");
    fetch(`/api/admin/loyalty?expiring=${days}${brand ? `&brand=${brand}` : ""}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr(j.error); else setRes(j); }).catch(() => alive && setErr("โหลดไม่สำเร็จ"));
    return () => { alive = false; };
  }, [days, brand]);
  const total = res?.rows.reduce((n, r) => n + Math.min(r.expiring, r.points), 0) ?? 0;
  const d = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <section className="card overflow-hidden">
      <div className="p-4 flex flex-wrap items-center gap-3 border-b border-line">
        <span className="h-9 w-9 grid place-items-center rounded-xl bg-danger/10 text-danger"><Hourglass size={16} /></span>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold">ลูกค้าที่แต้มใกล้หมดอายุ</p>
          <p className="text-xs text-muted">ชวนลูกค้ากลับมาใช้แต้มก่อนหมด · ระบบตัดแต้มหมดอายุอัตโนมัติวันละครั้ง{res?.last_run ? ` (ล่าสุด ${new Date(res.last_run.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${nf(Number(res.last_run.amount))} แต้ม)` : ""}</p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-xl border border-line bg-surface text-sm px-2.5">
          {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>ภายใน {n} วัน</option>)}
        </select>
        <Button size="sm" variant="soft" disabled={!res?.rows.length} onClick={() => res && exportCsv(stampFilename("points-expiring"), res.rows.map((r) => ({ name: r.name, phone: r.phone ?? "", points: r.points, expiring: Math.min(r.expiring, r.points), expires_on: r.next_at.slice(0, 10) })))}>ดาวน์โหลด CSV</Button>
      </div>
      {res && res.rows.length ? <div className="px-4 py-2.5 text-xs bg-danger/5 text-danger font-medium">{nf(res.rows.length)} คน · รวม {nf(total)} แต้มจะหมดอายุ</div> : null}
      {err ? <p role="alert" className="px-4 py-2 text-xs text-danger">{err}</p> : null}
      {res ? (res.rows.length ? (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-muted sticky top-0 text-xs"><tr><th className="text-left font-semibold px-4 py-2.5">ลูกค้า</th><th className="text-right font-semibold px-3 py-2.5">แต้มคงเหลือ</th><th className="text-right font-semibold px-3 py-2.5">จะหมดอายุ</th><th className="text-left font-semibold px-4 py-2.5">เริ่มหมด</th></tr></thead>
            <tbody>{res.rows.map((r) => (
              <tr key={r.customer_id} className="border-t border-line/60 hover:bg-surface2/40">
                <td className="px-4 py-2.5"><a href={`/admin/customers?id=${r.customer_id}`} className="font-medium hover:underline">{r.name}</a><p className="text-xs text-muted">{r.phone ?? "—"}</p></td>
                <td className="px-3 py-2.5 text-right tnum">{nf(r.points)}</td>
                <td className="px-3 py-2.5 text-right tnum font-semibold text-danger">{nf(Math.min(r.expiring, r.points))}</td>
                <td className="px-4 py-2.5 text-xs">{new Date(r.next_at) < new Date() ? <span className="text-danger">เลยกำหนด · ตัดรอบถัดไป</span> : d(r.next_at)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted text-center py-12">ไม่มีลูกค้าที่แต้มจะหมดอายุภายใน {days} วัน</p>) : !err ? <p className="text-xs text-muted text-center py-12">กำลังโหลด…</p> : null}
    </section>
  );
}
