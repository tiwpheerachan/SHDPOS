"use client";
// ตั้งค่าแต้มสะสม — รายแบรนด์ (ค่าหลัก) + กฎเสริมตามช่วงวันเวลา (คูณแต้ม / แต้มรายชิ้น / โบนัสต่อบิล) + ตัวจำลองคำนวณ
//   สูตรจริงอยู่ที่ DB (pos_loyalty_calc) — หน้านี้และหน้าขายเรียกสูตรเดียวกัน
import { useEffect, useMemo, useState } from "react";
import { Star, Plus, Pencil, Trash2, Calculator, Clock3, Tag, Gift, X as XIcon, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button, Drawer } from "@/components/ui";
import { SearchSelect } from "@/components/admin/search-select";
import { formatTHB } from "@/lib/money";

type Program = { id: string; brand_id: string | null; active: boolean; spend_per_unit: number; points_per_unit: number; min_spend: number; max_points_per_bill: number | null; earn_on_redeemed_bill: boolean; expiry_months: number | null; note: string | null; updated_at: string };
type Rule = { id?: string; brand_id: string | null; name: string; kind: "multiplier" | "per_item" | "bonus"; active: boolean; starts_at: string | null; ends_at: string | null; days_of_week: number[]; time_from: string | null; time_to: string | null; branch_ids: string[]; channels: string[]; target_segment: string; product_ids: string[]; category_ids: string[]; multiplier: number | null; points_per_unit: number | null; bonus_points: number | null; min_spend: number; min_qty: number; priority: number };
type Data = { programs: Program[]; rules: Rule[]; brands: { id: string; name: string }[]; branches: { id: string; name: string; code: string; brand_id: string | null }[]; categories: { id: string; name_th: string }[]; products: { id: string; sku: string; name_th: string }[] };
type Calc = { points: number; reason?: string; base?: number; multiplier?: number; capped?: boolean; expiry_months?: number | null; parts: { kind: string; label: string; points: number; qty?: number; multiplier?: number }[] };

const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const CHANNELS: [string, string][] = [["offline", "หน้าร้าน"], ["online_shopee", "Shopee"], ["online_lazada", "Lazada"], ["online_tiktok", "TikTok"], ["online_website", "เว็บไซต์"], ["event", "อีเวนต์"], ["b2b", "ขายส่ง"], ["other", "อื่นๆ"]];
const SEGMENTS: [string, string][] = [["all", "ทุกคน"], ["new", "ลูกค้าใหม่"], ["returning", "ลูกค้าประจำ"], ["vip", "VIP"], ["lost", "ลูกค้าห่างหาย"]];
const KIND: Record<Rule["kind"], { th: string; desc: string; icon: typeof Star }> = {
  multiplier: { th: "คูณแต้ม", desc: "คูณแต้มฐานของบิล เช่น ×2 ช่วงสงกรานต์ (หลายกฎพร้อมกันใช้ตัวคูณสูงสุด)", icon: Star },
  per_item: { th: "แต้มรายชิ้น", desc: "ซื้อสินค้า/หมวดที่เลือก ได้แต้มเพิ่มต่อชิ้น เช่น ชิ้นละ 50 แต้ม", icon: Tag },
  bonus: { th: "โบนัสต่อบิล", desc: "ได้แต้มเพิ่มต่อบิล ตั้งยอดขั้นต่ำได้ เช่น ซื้อครบ 5,000 รับเพิ่ม 100", icon: Gift },
};
const emptyRule = (brand: string | null): Rule => ({ brand_id: brand, name: "", kind: "multiplier", active: true, starts_at: null, ends_at: null, days_of_week: [], time_from: null, time_to: null, branch_ids: [], channels: [], target_segment: "all", product_ids: [], category_ids: [], multiplier: 2, points_per_unit: 10, bonus_points: 100, min_spend: 0, min_qty: 1, priority: 0 });
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

function ruleState(r: Rule): { label: string; cls: string } {
  const now = Date.now();
  if (!r.active) return { label: "ปิดอยู่", cls: "bg-surface2 text-muted" };
  if (r.starts_at && new Date(r.starts_at).getTime() > now) return { label: "ยังไม่เริ่ม", cls: "bg-sky-500/10 text-sky-600" };
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return { label: "หมดช่วงแล้ว", cls: "bg-surface2 text-muted" };
  return { label: "กำลังใช้", cls: "bg-ok/12 text-ok" };
}
function ruleValue(r: Rule) {
  if (r.kind === "multiplier") return `×${r.multiplier} แต้มฐาน`;
  if (r.kind === "per_item") return `ชิ้นละ ${r.points_per_unit} แต้ม${r.min_qty > 1 ? ` (ซื้อ ${r.min_qty} ชิ้นขึ้นไป)` : ""}`;
  return `+${r.bonus_points} แต้มต่อบิล`;
}
function ruleWhen(r: Rule) {
  const p: string[] = [];
  if (r.starts_at || r.ends_at) p.push(`${r.starts_at ? fmtDT(r.starts_at) : "ตั้งแต่ตอนนี้"} → ${r.ends_at ? fmtDT(r.ends_at) : "ไม่มีกำหนด"}`);
  if (r.days_of_week.length) p.push(`ทุกวัน ${r.days_of_week.slice().sort().map((d) => DAYS[d]).join(" ")}`);
  if (r.time_from || r.time_to) p.push(`เวลา ${r.time_from?.slice(0, 5) ?? "00:00"}–${r.time_to?.slice(0, 5) ?? "24:00"}`);
  return p.length ? p.join(" · ") : "ตลอดเวลา";
}

export default function LoyaltyPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string) => (locale === "th" ? th : en);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<string | null>(null); // null = ค่าเริ่มต้น
  const [form, setForm] = useState<Program | null>(null);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<Rule | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const r = await fetch("/api/admin/loyalty", { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"); }
  }
  useEffect(() => { void load(); }, []);

  const def = data?.programs.find((p) => p.brand_id === null) ?? null;
  const own = data?.programs.find((p) => p.brand_id === brand) ?? null;
  useEffect(() => { setForm(own ? { ...own } : null); setMsg(""); }, [brand, own?.id, own?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const rules = useMemo(() => (data?.rules ?? []).filter((r) => brand === null ? true : r.brand_id === null || r.brand_id === brand), [data, brand]);
  const brandName = (id: string | null) => (id ? data?.brands.find((b) => b.id === id)?.name ?? "—" : L("ทุกแบรนด์", "All brands"));

  async function post(body: unknown) {
    const r = await fetch("/api/admin/loyalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw Error(j.error); return j;
  }
  async function saveProgram() {
    if (!form) return;
    setSaving(true); setMsg("");
    try { await post({ action: "save_program", ...form, brand_id: brand }); await load(); setMsg(L("บันทึกแล้ว — มีผลกับบิลถัดไปทันที", "Saved")); }
    catch (e) { setMsg(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="h-10 w-10 grid place-items-center rounded-2xl bg-amber-500/10 text-amber-600"><Star size={18} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{L("แต้มสะสม", "Loyalty points")}</h1>
          <p className="text-[11px] text-muted">{L("ตั้งได้รายแบรนด์: ซื้อเท่าไรได้กี่แต้ม · กฎพิเศษตามช่วงวันเวลา (คูณแต้ม/รายชิ้น/โบนัส) · คำนวณอัตโนมัติทุกบิลที่มีลูกค้า", "Per-brand earning + time-boxed rules")}</p>
        </div>
      </header>
      {error ? <p role="alert" className="rounded-xl px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}

      {/* เลือกแบรนด์ */}
      <div className="flex flex-wrap gap-1.5">
        {[{ id: null as string | null, name: L("ค่าเริ่มต้น (ทุกแบรนด์)", "Default (all brands)") }, ...(data?.brands ?? [])].map((b) => {
          const has = b.id === null || data?.programs.some((p) => p.brand_id === b.id);
          return (
            <button key={b.id ?? "def"} onClick={() => setBrand(b.id)}
              className={`h-8 px-3 rounded-full text-xs border inline-flex items-center gap-1.5 ${brand === b.id ? "bg-ink text-surface border-ink" : "bg-surface border-line text-ink hover:border-ink/30"}`}>
              {b.name}{b.id !== null && has ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="มีการตั้งค่าเฉพาะแบรนด์" /> : null}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* ค่าหลักของแบรนด์ */}
          <section className="rounded-2xl border border-line/70 bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{L("อัตราได้แต้มหลัก", "Base earning")} · {brandName(brand)}</p>
              {brand !== null && own ? <button onClick={async () => { if (!confirmDelete()) return; await post({ action: "delete_program", brand_id: brand }); await load(); }} className="ml-auto text-[11px] text-muted hover:text-danger underline">{L("กลับไปใช้ค่าเริ่มต้น", "Use default")}</button> : null}
            </div>
            {!form ? (
              <div className="rounded-xl bg-surface2/60 p-3 text-xs space-y-2">
                <p>{L("แบรนด์นี้ใช้ค่าเริ่มต้นอยู่", "Using default")}: <b>{def ? `ทุก ${def.spend_per_unit} บาท ได้ ${def.points_per_unit} แต้ม` : "—"}</b>{def?.expiry_months ? ` · หมดอายุ ${def.expiry_months} เดือน` : ""}</p>
                <Button size="sm" variant="primary" onClick={() => def && setForm({ ...def, id: "", brand_id: brand, note: null })}><Plus size={13} />{L("ตั้งค่าเฉพาะแบรนด์นี้", "Customize for brand")}</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{L("ซื้อทุก", "Every")}</span>
                  <input type="number" min={1} value={form.spend_per_unit} onChange={(e) => setForm({ ...form, spend_per_unit: Number(e.target.value) })} className="w-24 h-9 px-2 rounded-lg border border-line bg-surface text-right tnum" />
                  <span>{L("บาท ได้", "THB earns")}</span>
                  <input type="number" min={0} value={form.points_per_unit} onChange={(e) => setForm({ ...form, points_per_unit: Number(e.target.value) })} className="w-20 h-9 px-2 rounded-lg border border-line bg-surface text-right tnum" />
                  <span>{L("แต้ม", "points")}</span>
                  <span className="text-[11px] text-muted">({L("คิดจากยอดสุทธิที่ลูกค้าจ่าย ปัดเศษลง", "on net paid, rounded down")})</span>
                </div>
                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                  <label className="space-y-1"><span className="text-muted">{L("ยอดขั้นต่ำต่อบิล (บาท)", "Min spend")}</span>
                    <input type="number" min={0} value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: Number(e.target.value) })} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
                  <label className="space-y-1"><span className="text-muted">{L("เพดานแต้มต่อบิล (ว่าง = ไม่จำกัด)", "Max per bill")}</span>
                    <input type="number" min={0} value={form.max_points_per_bill ?? ""} onChange={(e) => setForm({ ...form, max_points_per_bill: e.target.value === "" ? null : Number(e.target.value) })} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
                  <label className="space-y-1"><span className="text-muted">{L("อายุแต้ม (เดือน, ว่าง = ไม่หมดอายุ)", "Expiry (months)")}</span>
                    <input type="number" min={1} max={120} value={form.expiry_months ?? ""} onChange={(e) => setForm({ ...form, expiry_months: e.target.value === "" ? null : Number(e.target.value) })} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.earn_on_redeemed_bill} onChange={(e) => setForm({ ...form, earn_on_redeemed_bill: e.target.checked })} />{L("บิลที่ใช้แต้มแลกส่วนลด ยังได้แต้มใหม่", "Earn on bills that redeem points")}</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{L("เปิดสะสมแต้ม", "Active")}</label>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="primary" loading={saving} onClick={() => void saveProgram()}>{L("บันทึก", "Save")}</Button>
                  {msg ? <span className="text-[11px] text-muted">{msg}</span> : null}
                </div>
              </div>
            )}
          </section>

          {/* กฎเสริม */}
          <section className="rounded-2xl border border-line/70 bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{L("กฎพิเศษ (ตั้งช่วงวันเวลาได้)", "Special rules")}</p>
              <span className="text-[11px] text-muted">{rules.length} {L("กฎ", "rules")}</span>
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEdit(emptyRule(brand))}><Plus size={13} />{L("เพิ่มกฎ", "Add rule")}</Button>
            </div>
            {rules.length ? rules.map((r) => {
              const st = ruleState(r), K = KIND[r.kind];
              return (
                <div key={r.id} className="rounded-xl border border-line px-3 py-2.5 flex items-start gap-3">
                  <span className="h-8 w-8 grid place-items-center rounded-lg bg-amber-500/10 text-amber-600 shrink-0"><K.icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{r.name} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span></p>
                    <p className="text-xs">{K.th} · <b>{ruleValue(r)}</b>{r.min_spend > 0 ? ` · ${L("ยอดขั้นต่ำ", "min")} ${formatTHB(r.min_spend, false)}` : ""}</p>
                    <p className="text-[11px] text-muted flex items-center gap-1"><Clock3 size={11} />{ruleWhen(r)}</p>
                    <p className="text-[11px] text-muted truncate">
                      {brandName(r.brand_id)}
                      {r.branch_ids.length ? ` · ${r.branch_ids.length} สาขา` : " · ทุกสาขา"}
                      {r.channels.length ? ` · ${r.channels.map((c) => CHANNELS.find((x) => x[0] === c)?.[1] ?? c).join(", ")}` : ""}
                      {r.target_segment !== "all" ? ` · ${SEGMENTS.find((s) => s[0] === r.target_segment)?.[1]}` : ""}
                      {r.kind === "per_item" ? ` · ${r.product_ids.length || r.category_ids.length ? `${r.product_ids.length} สินค้า ${r.category_ids.length} หมวด` : "ทุกสินค้า"}` : ""}
                    </p>
                  </div>
                  <button onClick={() => setEdit({ ...r })} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2" title="แก้ไข"><Pencil size={14} /></button>
                  <button onClick={async () => { if (!confirmDelete()) return; await post({ action: "archive_rule", id: r.id }); await load(); }} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-danger/5" title="ลบ"><Trash2 size={14} /></button>
                </div>
              );
            }) : <p className="text-xs text-muted text-center py-6">{L("ยังไม่มีกฎพิเศษ — ใช้อัตราหลักอย่างเดียว", "No special rules")}</p>}
          </section>
        </div>

        <Simulator data={data} brand={brand} />
      </div>

      {edit ? <RuleDrawer rule={edit} data={data} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} post={post} /> : null}
    </div>
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
  const [r, setR] = useState<Rule>(rule);
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
  return (
    <Drawer open onClose={onClose} title={rule.id ? "แก้ไขกฎแต้มสะสม" : "เพิ่มกฎแต้มสะสม"} subtitle="กฎทำงานอัตโนมัติกับทุกบิลที่มีลูกค้า ตามช่วงเวลาที่ตั้ง"
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={() => void save()}>บันทึก</Button></>}>
      <div className="space-y-4 text-xs">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KIND) as Rule["kind"][]).map((k) => {
            const K = KIND[k];
            return (
              <button key={k} type="button" onClick={() => set("kind", k)} className={`rounded-xl border p-2.5 text-left ${r.kind === k ? "border-brand ring-2 ring-brand/15 bg-brand/5" : "border-line"}`}>
                <K.icon size={15} className="text-amber-600" /><p className="font-semibold mt-1">{K.th}</p><p className="text-[10.5px] text-muted leading-snug">{K.desc}</p>
              </button>
            );
          })}
        </div>
        <label className="block space-y-1"><span className="text-muted">ชื่อกฎ (พนักงาน/ลูกค้าเห็นในรายละเอียดแต้ม)</span>
          <input value={r.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น สงกรานต์ แต้ม x2" className="w-full h-9 px-2.5 rounded-lg border border-line bg-surface" /></label>

        <div className="grid grid-cols-2 gap-3">
          {r.kind === "multiplier" ? <label className="space-y-1"><span className="text-muted">ตัวคูณแต้มฐาน</span><input type="number" min={1} step={0.5} value={r.multiplier ?? 2} onChange={(e) => set("multiplier", Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label> : null}
          {r.kind === "per_item" ? <>
            <label className="space-y-1"><span className="text-muted">แต้มต่อชิ้น</span><input type="number" min={0} value={r.points_per_unit ?? 0} onChange={(e) => set("points_per_unit", Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
            <label className="space-y-1"><span className="text-muted">ซื้ออย่างน้อย (ชิ้น)</span><input type="number" min={1} value={r.min_qty} onChange={(e) => set("min_qty", Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
          </> : null}
          {r.kind === "bonus" ? <label className="space-y-1"><span className="text-muted">แต้มโบนัสต่อบิล</span><input type="number" min={0} value={r.bonus_points ?? 0} onChange={(e) => set("bonus_points", Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label> : null}
          {r.kind !== "per_item" ? <label className="space-y-1"><span className="text-muted">ยอดซื้อขั้นต่ำต่อบิล (บาท)</span><input type="number" min={0} value={r.min_spend} onChange={(e) => set("min_spend", Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label> : null}
        </div>

        {r.kind === "per_item" ? (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="font-semibold">สินค้าที่ได้แต้มรายชิ้น <span className="font-normal text-muted">(ไม่เลือกทั้งสินค้าและหมวด = ทุกสินค้า)</span></p>
            <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อ / SKU" className="w-full h-9 pl-8 pr-2 rounded-lg border border-line bg-surface" /></div>
            {hits.length ? <div className="rounded-lg border border-line divide-y divide-line/60 max-h-40 overflow-auto">{hits.map((p) => (
              <button key={p.id} type="button" onClick={() => { if (!picked.some((x) => x.id === p.id)) setPicked([...picked, p]); setQ(""); }} className="w-full text-left px-2.5 py-1.5 hover:bg-surface2"><span className="font-mono">{p.sku}</span> · {p.name_th}</button>
            ))}</div> : null}
            <div className="flex flex-wrap gap-1.5">{picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5"><span className="font-mono">{p.sku}</span><button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}><XIcon size={11} /></button></span>
            ))}</div>
            <SearchSelect allLabel="ไม่จำกัดหมวด" placeholder="ค้นหาหมวด…" options={(data?.categories ?? []).map((c) => ({ v: c.id, label: c.name_th }))} selected={r.category_ids} onChange={(v) => set("category_ids", v)} />
          </div>
        ) : null}

        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="font-semibold">ช่วงวันเวลา <span className="font-normal text-muted">(ว่าง = ตลอด)</span></p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-muted">เริ่ม</span><input type="datetime-local" value={toLocal(r.starts_at)} onChange={(e) => set("starts_at", fromLocal(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface" /></label>
            <label className="space-y-1"><span className="text-muted">สิ้นสุด</span><input type="datetime-local" value={toLocal(r.ends_at)} onChange={(e) => set("ends_at", fromLocal(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface" /></label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted mr-1">เฉพาะวัน</span>
            {DAYS.map((d, i) => <button key={d} type="button" onClick={() => set("days_of_week", r.days_of_week.includes(i) ? r.days_of_week.filter((x) => x !== i) : [...r.days_of_week, i])} className={`h-7 w-9 rounded-lg border ${r.days_of_week.includes(i) ? "bg-ink text-surface border-ink" : "border-line"}`}>{d}</button>)}
          </div>
          <div className="flex items-center gap-2"><span className="text-muted">เฉพาะเวลา</span>
            <input type="time" value={r.time_from?.slice(0, 5) ?? ""} onChange={(e) => set("time_from", e.target.value || null)} className="h-8 px-2 rounded-lg border border-line bg-surface" />
            <span>–</span>
            <input type="time" value={r.time_to?.slice(0, 5) ?? ""} onChange={(e) => set("time_to", e.target.value || null)} className="h-8 px-2 rounded-lg border border-line bg-surface" />
            <span className="text-muted">(เช่น Happy hour 17:00–20:00)</span>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="font-semibold">ใช้กับ</p>
          <label className="block space-y-1"><span className="text-muted">แบรนด์</span>
            <select value={r.brand_id ?? ""} onChange={(e) => set("brand_id", e.target.value || null)} className="w-full h-9 px-2 rounded-lg border border-line bg-surface">
              <option value="">ทุกแบรนด์</option>{(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <SearchSelect allLabel="ทุกสาขา" placeholder="ค้นหาสาขา…" options={branchOpts} selected={r.branch_ids} onChange={(v) => set("branch_ids", v)} />
          <div className="flex flex-wrap gap-1.5"><span className="text-muted mr-1 self-center">ช่องทาง (ว่าง = ทุกช่องทาง)</span>
            {CHANNELS.map(([v, l]) => <button key={v} type="button" onClick={() => set("channels", r.channels.includes(v) ? r.channels.filter((x) => x !== v) : [...r.channels, v])} className={`h-7 px-2.5 rounded-full border ${r.channels.includes(v) ? "bg-ink text-surface border-ink" : "border-line"}`}>{l}</button>)}
          </div>
          <label className="block space-y-1"><span className="text-muted">กลุ่มลูกค้า</span>
            <select value={r.target_segment} onChange={(e) => set("target_segment", e.target.value)} className="w-full h-9 px-2 rounded-lg border border-line bg-surface">
              {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
        </div>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={r.active} onChange={(e) => set("active", e.target.checked)} />เปิดใช้กฎนี้</label>
        {err ? <p role="alert" className="text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}

function Simulator({ data, brand }: { data: Data | null; brand: string | null }) {
  const branches = (data?.branches ?? []).filter((b) => brand === null || b.brand_id === brand);
  const [branch, setBranch] = useState("");
  const [net, setNet] = useState(1000);
  const [at, setAt] = useState(() => toLocal(new Date().toISOString()));
  const [channel, setChannel] = useState("offline");
  const [sku, setSku] = useState(""), [qty, setQty] = useState(1);
  const [res, setRes] = useState<Calc | null>(null), [err, setErr] = useState("");
  useEffect(() => { if (!branches.some((b) => b.id === branch)) setBranch(branches[0]?.id ?? ""); }, [brand, data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    setErr(""); setRes(null);
    try {
      let items: { product_id: string; qty: number }[] = [];
      if (sku.trim()) {
        const r = await fetch(`/api/admin/products?q=${encodeURIComponent(sku.trim())}`, { cache: "no-store" }); const j = await r.json();
        const p = (j.products ?? []).find((x: { sku: string }) => x.sku.toLowerCase() === sku.trim().toLowerCase()) ?? j.products?.[0];
        if (!p) throw Error("ไม่พบสินค้า"); items = [{ product_id: p.id, qty }];
      }
      const r = await fetch("/api/admin/loyalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "simulate", branch_id: branch, net, channel, at: fromLocal(at), items }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setRes(j.result);
    } catch (e) { setErr(e instanceof Error ? e.message : "คำนวณไม่สำเร็จ"); }
  }
  const reason: Record<string, string> = { no_program: "ยังไม่ได้ตั้งค่าแต้ม", redeemed_bill: "บิลที่ใช้แต้มไม่ได้แต้ม (ตามการตั้งค่า)", below_min_spend: "ยอดไม่ถึงขั้นต่ำ" };
  return (
    <aside className="rounded-2xl border border-line/70 bg-surface p-4 space-y-3 h-fit text-xs">
      <p className="text-sm font-semibold flex items-center gap-1.5"><Calculator size={15} />ลองคำนวณ</p>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-line bg-surface">
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="text-muted">ยอดสุทธิ (บาท)</span><input type="number" value={net} onChange={(e) => setNet(Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
        <label className="space-y-1"><span className="text-muted">ช่องทาง</span><select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-line bg-surface">{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="block space-y-1"><span className="text-muted">วันเวลาที่ขาย</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-line bg-surface" /></label>
      <div className="grid grid-cols-[1fr_70px] gap-2">
        <label className="space-y-1"><span className="text-muted">SKU (ไม่บังคับ)</span><input value={sku} onChange={(e) => setSku(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-line bg-surface font-mono" /></label>
        <label className="space-y-1"><span className="text-muted">จำนวน</span><input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full h-9 px-2 rounded-lg border border-line bg-surface tnum" /></label>
      </div>
      <Button variant="primary" className="w-full" disabled={!branch} onClick={() => void run()}>คำนวณแต้ม</Button>
      {err ? <p className="text-danger">{err}</p> : null}
      {res ? (
        <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 p-3 space-y-1">
          <p className="text-base font-semibold">ได้ {res.points.toLocaleString()} แต้ม</p>
          {res.reason ? <p className="text-muted">{reason[res.reason] ?? res.reason}</p> : null}
          {res.parts.map((p, i) => <p key={i} className="flex justify-between gap-2"><span className="text-muted">{p.label}{p.qty ? ` × ${p.qty}` : ""}{p.multiplier ? ` (×${p.multiplier})` : ""}</span><span className="tnum">{p.points > 0 ? "+" : ""}{p.points}</span></p>)}
          {res.expiry_months ? <p className="text-[10px] text-muted">หมดอายุใน {res.expiry_months} เดือน</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
