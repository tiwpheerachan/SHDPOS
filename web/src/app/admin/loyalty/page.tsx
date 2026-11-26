"use client";
// แต้มสะสม — ภาพรวม · อัตราหลัก + ระดับสมาชิก · กฎพิเศษ (ช่วงเวลา/วันเกิด/ซื้อครั้งแรก) · แต้มใกล้หมดอายุ · ตัวจำลอง
//   สูตรจริงอยู่ที่ DB (pos_loyalty_calc) — หน้านี้ หน้าขาย และตอนบันทึกบิล ใช้สูตรเดียวกัน
import { useEffect, useMemo, useState } from "react";
import { Star, Plus, Pencil, Trash2, Calculator, Clock3, Tag, Gift, X as XIcon, Search, Crown, Cake, Sparkles, Coins, TrendingDown, Hourglass, Users, Power } from "lucide-react";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";
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

const DAYS = () => [tr("อา", "Su", "日"), tr("จ", "Mo", "一"), tr("อ", "Tu", "二"), tr("พ", "We", "三"), tr("พฤ", "Th", "四"), tr("ศ", "Fr", "五"), tr("ส", "Sa", "六")];
const CHANNELS = (): [string, string][] => [["offline", tr("หน้าร้าน", "In-store", "门店")], ["online_shopee", "Shopee"], ["online_lazada", "Lazada"], ["online_tiktok", "TikTok"], ["online_website", tr("เว็บไซต์", "Website", "官网")], ["event", tr("อีเวนต์", "Event", "活动")], ["b2b", tr("ขายส่ง", "Wholesale", "批发")], ["other", tr("อื่นๆ", "Other", "其他")]];
const SEGMENTS = (): [string, string][] => [["all", tr("ทุกคน", "Everyone", "所有人")], ["new", tr("ลูกค้าใหม่", "New customers", "新客户")], ["returning", tr("ลูกค้าประจำ", "Returning", "老客户")], ["vip", "VIP"], ["lost", tr("ลูกค้าห่างหาย", "Lapsed", "流失客户")]];
const CONDS = (): { v: Cond; label: string; hint: string }[] => [
  { v: "none", label: tr("ทุกคน", "Everyone", "所有人"), hint: "" },
  { v: "birthday_day", label: tr("ตรงวันเกิด", "On birthday", "生日当天"), hint: tr("ใช้วันเกิดในข้อมูลลูกค้า", "Uses the birthday in the customer profile", "使用客户资料中的生日") },
  { v: "birthday_month", label: tr("เดือนเกิด", "Birthday month", "生日月"), hint: tr("ทั้งเดือนเกิดของลูกค้า", "The customer's whole birthday month", "客户生日所在整月") },
  { v: "first_purchase", label: tr("ซื้อครั้งแรก", "First purchase", "首次购买"), hint: tr("บิลแรกของลูกค้า", "Customer's first bill", "客户的第一张单据") },
];
const KIND = (): Record<Rule["kind"], { th: string; desc: string; icon: typeof Star; tint: string }> => ({
  multiplier: { th: tr("คูณแต้ม", "Multiplier", "积分倍数"), desc: tr("คูณแต้มฐานของบิล (หลายกฎพร้อมกันใช้ตัวคูณสูงสุด)", "Multiplies the bill's base points (if several apply, the highest wins)", "按单据基础积分加倍（多条规则同时生效取最高倍数）"), icon: Sparkles, tint: "bg-violet-500/10 text-violet-600" },
  per_item: { th: tr("แต้มรายชิ้น", "Per item", "按件积分"), desc: tr("ซื้อสินค้า/หมวดที่เลือก ได้แต้มเพิ่มต่อชิ้น", "Extra points per unit of selected products/categories", "购买所选商品/类别，每件额外积分"), icon: Tag, tint: "bg-sky-500/10 text-sky-600" },
  bonus: { th: tr("โบนัสต่อบิล", "Bill bonus", "每单奖励"), desc: tr("ได้แต้มเพิ่มต่อบิล ตั้งยอดขั้นต่ำได้", "Extra points per bill, with optional minimum spend", "每单额外积分，可设最低消费"), icon: Gift, tint: "bg-emerald-500/10 text-emerald-600" },
});
const TIER_PRESET: Omit<Tier, "brand_id">[] = [
  { code: "member", name: "Member", min_spend: 0, multiplier: 1, color: "#9CA3AF", perks: null, active: true },
  { code: "silver", name: "Silver", min_spend: 20000, multiplier: 1.25, color: "#94A3B8", perks: null, active: true },
  { code: "gold", name: "Gold", min_spend: 50000, multiplier: 1.5, color: "#D4A017", perks: null, active: true },
  { code: "platinum", name: "Platinum", min_spend: 100000, multiplier: 2, color: "#6D28D9", perks: null, active: true },
];
const emptyRule = (brand: string | null): Rule => ({ brand_id: brand, name: "", kind: "multiplier", active: true, starts_at: null, ends_at: null, days_of_week: [], time_from: null, time_to: null, branch_ids: [], channels: [], target_segment: "all", customer_condition: "none", product_ids: [], category_ids: [], multiplier: 2, points_per_unit: 10, bonus_points: 100, min_spend: 0, min_qty: 1, priority: 0 });
const TEMPLATES = (): { label: string; icon: typeof Star; rule: Partial<Rule> }[] => [
  { label: tr("วันเกิดรับ 200 แต้ม", "Birthday +200 points", "生日送 200 积分"), icon: Cake, rule: { name: "ของขวัญวันเกิด +200 แต้ม", kind: "bonus", bonus_points: 200, customer_condition: "birthday_day" } },
  { label: tr("เดือนเกิดแต้ม ×2", "Birthday month ×2", "生日月积分 ×2"), icon: Cake, rule: { name: "เดือนเกิด แต้ม ×2", kind: "multiplier", multiplier: 2, customer_condition: "birthday_month" } },
  { label: tr("ลูกค้าใหม่ +100", "New customer +100", "新客户 +100"), icon: Users, rule: { name: "ต้อนรับลูกค้าใหม่ +100 แต้ม", kind: "bonus", bonus_points: 100, customer_condition: "first_purchase" } },
  { label: tr("เสาร์-อาทิตย์ ×2", "Weekend ×2", "周末 ×2"), icon: Sparkles, rule: { name: "สุดสัปดาห์ แต้ม ×2", kind: "multiplier", multiplier: 2, days_of_week: [0, 6] } },
  { label: tr("Happy hour 17–20 น.", "Happy hour 17–20", "欢乐时光 17–20 点"), icon: Clock3, rule: { name: "Happy hour แต้ม ×1.5", kind: "multiplier", multiplier: 1.5, time_from: "17:00", time_to: "20:00" } },
];
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nf = (n: number) => Number(n || 0).toLocaleString("th-TH");
const inputCls = "w-full h-9 px-2.5 rounded-lg border border-line bg-surface text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/10";

function ruleState(r: Rule): { label: string; cls: string; group: 0 | 1 | 2 } {
  const now = Date.now();
  if (!r.active) return { label: tr("ปิดอยู่", "Off", "已关闭"), cls: "bg-surface2 text-muted", group: 2 };
  if (r.starts_at && new Date(r.starts_at).getTime() > now) return { label: tr("ยังไม่เริ่ม", "Scheduled", "未开始"), cls: "bg-sky-500/10 text-sky-600", group: 1 };
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return { label: tr("หมดช่วงแล้ว", "Ended", "已结束"), cls: "bg-surface2 text-muted", group: 2 };
  return { label: tr("กำลังใช้", "Active", "生效中"), cls: "bg-ok/12 text-ok", group: 0 };
}
function ruleValue(r: Rule) {
  if (r.kind === "multiplier") return tr(`×${r.multiplier} แต้มฐาน`, `×${r.multiplier} base points`, `基础积分 ×${r.multiplier}`);
  if (r.kind === "per_item") return tr(`ชิ้นละ ${nf(r.points_per_unit ?? 0)} แต้ม${r.min_qty > 1 ? ` (ตั้งแต่ ${r.min_qty} ชิ้น)` : ""}`, `${nf(r.points_per_unit ?? 0)} pts per item${r.min_qty > 1 ? ` (min ${r.min_qty} items)` : ""}`, `每件 ${nf(r.points_per_unit ?? 0)} 积分${r.min_qty > 1 ? `（${r.min_qty} 件起）` : ""}`);
  return tr(`+${nf(r.bonus_points ?? 0)} แต้มต่อบิล`, `+${nf(r.bonus_points ?? 0)} pts per bill`, `每单 +${nf(r.bonus_points ?? 0)} 积分`);
}
function ruleWhen(r: Rule) {
  const p: string[] = [];
  if (r.starts_at || r.ends_at) p.push(`${r.starts_at ? fmtDT(r.starts_at) : tr("ตั้งแต่ตอนนี้", "From now", "即日起")} → ${r.ends_at ? fmtDT(r.ends_at) : tr("ไม่มีกำหนด", "No end", "无截止")}`);
  if (r.days_of_week.length) p.push(`${tr("ทุกวัน", "Every ", "每周")}${r.days_of_week.slice().sort().map((d) => DAYS()[d]).join(" ")}`);
  if (r.time_from || r.time_to) p.push(`${r.time_from?.slice(0, 5) ?? "00:00"}–${r.time_to?.slice(0, 5) ?? "24:00"}${tr(" น.", "", "")}${r.time_from && r.time_to && r.time_from > r.time_to ? tr(" (ข้ามเที่ยงคืน)", " (overnight)", "（跨午夜）") : ""}`);
  return p.length ? p.join(" · ") : tr("ตลอดเวลา", "Always", "全天候");
}

export default function LoyaltyPage() {
  const L = useL();
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
    } catch (e) { setError(e instanceof Error ? e.message : L("โหลดไม่สำเร็จ", "Failed to load", "加载失败")); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let alive = true; setStats(null);
    fetch(`/api/admin/loyalty?stats=30${brand ? `&brand=${brand}` : ""}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive && j.stats) setStats(j.stats); }).catch(() => {});
    return () => { alive = false; };
  }, [brand, data]);

  const rules = useMemo(() => (data?.rules ?? []).filter((r) => brand === null ? true : r.brand_id === null || r.brand_id === brand), [data, brand]);
  const brandName = (id: string | null) => (id ? data?.brands.find((b) => b.id === id)?.name ?? "—" : L("ทุกแบรนด์", "All brands", "所有品牌"));
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
          <h1 className="text-xl font-semibold tracking-tight">{L("แต้มสะสม", "Loyalty", "积分")}</h1>
          <p className="text-xs text-muted">{L("ตั้งอัตราได้แต้ม ระดับสมาชิก และกฎพิเศษรายแบรนด์ — คำนวณอัตโนมัติทุกบิลที่มีลูกค้า", "Per-brand earning, tiers and rules — applied automatically to every bill with a customer", "按品牌设置积分规则、会员等级和特别规则 — 有客户的单据自动计算")}</p>
        </div>
        <label className="text-xs text-muted flex items-center gap-2">{L("แบรนด์", "Brand", "品牌")}
          <select value={brand ?? ""} onChange={(e) => setBrand(e.target.value || null)} className="h-9 min-w-[200px] px-2.5 rounded-xl border border-line bg-surface text-sm text-ink">
            <option value="">{L("ค่าเริ่มต้น (ทุกแบรนด์)", "Default (all brands)", "默认（所有品牌）")}</option>
            {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{data?.programs.some((p) => p.brand_id === b.id) || data?.tiers.some((t) => t.brand_id === b.id) ? " •" : ""}</option>)}
          </select>
        </label>
      </header>
      {error ? <p role="alert" className="rounded-xl px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("แต้มที่ให้ลูกค้า · 30 วัน", "Issued · 30d", "已发放 · 30 天")} value={stats ? nf(stats.earned) : "—"} sub={stats ? `${nf(stats.earning_bills)} ${L("บิล", "bills", "单")}` : undefined} accent="lime" icon={<Coins size={14} />} />
        <KpiTile label={L("แต้มที่ลูกค้าใช้ · 30 วัน", "Redeemed · 30d", "已兑换 · 30 天")} value={stats ? nf(stats.redeemed) : "—"} sub={stats ? `≈ ${formatTHB(stats.redeemed, false)} ${L("ส่วนลด", "discount", "折扣")}` : undefined} accent="lavender" icon={<TrendingDown size={14} />} />
        <KpiTile label={L("แต้มหมดอายุ · 30 วัน", "Expired · 30d", "已过期 · 30 天")} value={stats ? nf(stats.expired) : "—"} accent="coral" icon={<Hourglass size={14} />} />
        <KpiTile label={L("แต้มคงค้างในระบบ", "Outstanding", "未使用积分")} value={stats ? nf(stats.outstanding) : "—"} sub={stats ? `${nf(stats.members_active)} ${L("สมาชิกเคลื่อนไหว 30 วัน", "active members (30d)", "30 天活跃会员")}` : undefined} accent="peach" icon={<Users size={14} />} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" value={tab} onChange={setTab} options={[
          { value: "earn", label: L("อัตราและระดับสมาชิก", "Earning & tiers", "积分比例与会员等级") },
          { value: "rules", label: <span className="inline-flex items-center gap-1.5">{L("กฎพิเศษ", "Rules", "特别规则")}{activeRules ? <span className="text-[10px] px-1.5 rounded-full bg-ok/15 text-ok">{activeRules}</span> : null}</span> },
          { value: "expiring", label: L("แต้มใกล้หมดอายุ", "Expiring", "即将过期") },
        ]} />
        {tab === "rules" ? <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEdit(emptyRule(brand))}><Plus size={13} />{L("เพิ่มกฎ", "Add rule", "添加规则")}</Button> : null}
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
  const L = useL();
  const [form, setForm] = useState<Program | null>(null);
  const [saving, setSaving] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { setForm(own ? { ...own } : null); setMsg(null); }, [brand, own?.id, own?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!form) return;
    setSaving(true); setMsg(null);
    try { await post({ action: "save_program", ...form, brand_id: brand }); await reload(); setMsg({ ok: true, t: L("บันทึกแล้ว — มีผลกับบิลถัดไปทันที", "Saved — applies from the next bill", "已保存 — 下一张单据起生效") }); }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败") }); } finally { setSaving(false); }
  }
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold">{L("อัตราได้แต้มหลัก", "Base earning rate", "基础积分比例")}</p>
          <p className="text-xs text-muted">{brandName} · {L("คิดจากยอดสุทธิที่ลูกค้าจ่าย ปัดเศษลง", "Based on net amount paid, rounded down", "按客户实付净额计算，向下取整")}</p>
        </div>
        {brand !== null && own ? <button onClick={async () => { if (!confirmDelete()) return; await post({ action: "delete_program", brand_id: brand }); await reload(); }} className="text-xs text-muted hover:text-danger">{L("กลับไปใช้ค่าเริ่มต้น", "Revert to default", "恢复默认")}</button> : null}
      </div>
      {!form ? (
        <div className="rounded-xl bg-surface2/60 p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm flex-1">{L("แบรนด์นี้ใช้ค่าเริ่มต้น:", "This brand uses the default:", "此品牌使用默认设置：")} <b>{def ? L(`ทุก ${nf(def.spend_per_unit)} บาท ได้ ${nf(def.points_per_unit)} แต้ม`, `${nf(def.points_per_unit)} pts per ${nf(def.spend_per_unit)} THB`, `每 ${nf(def.spend_per_unit)} 泰铢得 ${nf(def.points_per_unit)} 积分`) : "—"}</b>{def?.expiry_months ? <span className="text-muted"> · {L(`หมดอายุ ${def.expiry_months} เดือน`, `expires in ${def.expiry_months} months`, `${def.expiry_months} 个月后过期`)}</span> : null}</p>
          <Button size="sm" variant="soft" onClick={() => def && setForm({ ...def, id: "", brand_id: brand, note: null })}><Pencil size={13} />{L("ตั้งค่าเฉพาะแบรนด์นี้", "Customize for this brand", "为此品牌单独设置")}</Button>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-amber-500/6 border border-amber-500/20 px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
            <span>{L("ซื้อทุก", "Every", "每消费")}</span>
            <input type="number" min={1} value={form.spend_per_unit} onChange={(e) => setForm({ ...form, spend_per_unit: Number(e.target.value) })} className="w-24 h-9 px-2 rounded-lg border border-line bg-surface text-right tnum font-semibold" />
            <span>{L("บาท ได้", "THB earns", "泰铢得")}</span>
            <input type="number" min={0} value={form.points_per_unit} onChange={(e) => setForm({ ...form, points_per_unit: Number(e.target.value) })} className="w-20 h-9 px-2 rounded-lg border border-line bg-surface text-right tnum font-semibold" />
            <span>{L("แต้ม", "points", "积分")}</span>
            {form.spend_per_unit > 0 ? <span className="ml-auto text-xs text-muted">{L("ซื้อ 1,000 บาท ≈", "1,000 THB ≈", "消费 1,000 泰铢 ≈")} {nf(Math.floor(1000 / form.spend_per_unit) * form.points_per_unit)} {L("แต้ม", "pts", "积分")}</span> : null}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <label className="space-y-1"><span className="text-muted">{L("ยอดขั้นต่ำต่อบิล (บาท)", "Min spend per bill (THB)", "每单最低消费（泰铢）")}</span>
              <input type="number" min={0} value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: Number(e.target.value) })} className={inputCls + " tnum"} /></label>
            <label className="space-y-1"><span className="text-muted">{L("เพดานแต้มต่อบิล", "Max points per bill", "每单积分上限")} <span className="opacity-70">{L("(ว่าง = ไม่จำกัด)", "(blank = unlimited)", "（留空 = 不限）")}</span></span>
              <input type="number" min={0} value={form.max_points_per_bill ?? ""} onChange={(e) => setForm({ ...form, max_points_per_bill: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls + " tnum"} /></label>
            <label className="space-y-1"><span className="text-muted">{L("อายุแต้ม (เดือน)", "Points validity (months)", "积分有效期（月）")} <span className="opacity-70">{L("(ว่าง = ไม่หมดอายุ)", "(blank = never expire)", "（留空 = 永不过期）")}</span></span>
              <input type="number" min={1} max={120} value={form.expiry_months ?? ""} onChange={(e) => setForm({ ...form, expiry_months: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls + " tnum"} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <Toggle checked={form.earn_on_redeemed_bill} onChange={(v) => setForm({ ...form, earn_on_redeemed_bill: v })} label={L("บิลที่ใช้แต้มแลกส่วนลด ยังได้แต้มใหม่", "Bills that redeem points still earn points", "使用积分抵扣的单据仍可获得积分")} />
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label={L("เปิดสะสมแต้ม", "Enable points earning", "启用积分累积")} />
            <span className="ml-auto flex items-center gap-2">
              {msg ? <span className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.t}</span> : null}
              <Button variant="primary" loading={saving} onClick={() => void save()}>{L("บันทึก", "Save", "保存")}</Button>
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
  const L = useL();
  const inherited = brand !== null && !saved.length ? (data?.tiers ?? []).filter((t) => t.brand_id === null) : [];
  const [rows, setRows] = useState<Tier[]>([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { setRows(saved.map((t) => ({ ...t }))); }, [saved]);
  useEffect(() => { setMsg(null); }, [brand]);
  const dirty = JSON.stringify(rows.map(({ code, name, min_spend, multiplier, color, perks, active }) => ({ code, name, min_spend, multiplier, color, perks, active })))
    !== JSON.stringify(saved.map(({ code, name, min_spend, multiplier, color, perks, active }) => ({ code, name, min_spend, multiplier, color, perks, active })));
  const set = (i: number, patch: Partial<Tier>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save() {
    setBusy(true); setMsg(null);
    try { await post({ action: "save_tiers", brand_id: brand, tiers: rows.slice().sort((a, b) => a.min_spend - b.min_spend) }); await reload(); setMsg({ ok: true, t: L("บันทึกระดับแล้ว — ใช้กับบิลถัดไป", "Tiers saved — applies from the next bill", "等级已保存 — 下一张单据起生效") }); }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败") }); } finally { setBusy(false); }
  }
  return (
    <section className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="h-9 w-9 grid place-items-center rounded-xl bg-amber-500/12 text-amber-600"><Crown size={16} /></span>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold">{L("ระดับสมาชิก", "Membership tiers", "会员等级")}</p>
          <p className="text-xs text-muted">{L("ตามยอดซื้อ 12 เดือนย้อนหลัง · ระดับสูงได้แต้มเพิ่ม = แต้มฐาน × (ตัวคูณ − 1) · ปรับระดับอัตโนมัติทุกครั้งที่ซื้อ", "Based on the last 12 months of spend · higher tiers earn extra = base points × (multiplier − 1) · tier updates automatically on every purchase", "按近 12 个月消费额 · 高等级额外积分 = 基础积分 × (倍数 − 1) · 每次购买自动调整等级")}</p>
        </div>
        {!rows.length ? <Button size="sm" variant="soft" onClick={() => setRows(TIER_PRESET.map((t) => ({ ...t, brand_id: brand })))}><Sparkles size={13} />{L("ใช้ชุดแนะนำ 4 ระดับ", "Use recommended 4 tiers", "使用推荐的 4 个等级")}</Button> : null}
      </div>
      {inherited.length ? <p className="text-xs rounded-lg bg-surface2/60 px-3 py-2">{L("แบรนด์นี้ใช้ระดับค่าเริ่มต้น:", "This brand uses the default tiers:", "此品牌使用默认等级：")} {inherited.map((t) => t.name).join(" · ")} — {L("ตั้งชุดของแบรนด์เองได้ด้านล่าง", "you can set brand-specific tiers below", "可在下方设置品牌专属等级")}</p> : null}
      {rows.length ? (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[28px_1.2fr_1fr_90px_1.4fr_28px] gap-2 px-1 text-[11px] text-muted">
            <span /><span>{L("ชื่อระดับ", "Tier name", "等级名称")}</span><span>{L("ยอดซื้อ 12 เดือนตั้งแต่ (บาท)", "12-month spend from (THB)", "12 个月消费起（泰铢）")}</span><span>{L("ตัวคูณแต้ม", "Points multiplier", "积分倍数")}</span><span>{L("สิทธิพิเศษ (แสดงให้พนักงานเห็น)", "Perks (shown to staff)", "专属权益（员工可见）")}</span><span />
          </div>
          {rows.map((t, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_28px] sm:grid-cols-[28px_1.2fr_1fr_90px_1.4fr_28px] gap-2 items-center rounded-xl border border-line px-2 py-2">
              <input type="color" value={t.color} onChange={(e) => set(i, { color: e.target.value })} className="h-7 w-7 rounded-full border border-line cursor-pointer bg-transparent" title={L("สีป้าย", "Badge color", "标签颜色")} />
              <input value={t.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={L("เช่น Gold", "e.g. Gold", "例如 Gold")} className={inputCls} />
              <input type="number" min={0} value={t.min_spend} onChange={(e) => set(i, { min_spend: Number(e.target.value) })} className={inputCls + " tnum text-right hidden sm:block"} />
              <input type="number" min={1} max={10} step={0.05} value={t.multiplier} onChange={(e) => set(i, { multiplier: Number(e.target.value) })} className={inputCls + " tnum text-right hidden sm:block"} />
              <input value={t.perks ?? ""} onChange={(e) => set(i, { perks: e.target.value || null })} placeholder={L("เช่น ส่งฟรี / ลดเพิ่ม 5%", "e.g. Free shipping / extra 5% off", "例如 免运费 / 额外 95 折")} className={inputCls + " hidden sm:block"} />
              <button onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="h-7 w-7 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-danger/5" title={L("ลบระดับ", "Remove tier", "删除等级")}><XIcon size={14} /></button>
              <div className="col-span-3 grid grid-cols-2 gap-2 sm:hidden">
                <input type="number" min={0} value={t.min_spend} onChange={(e) => set(i, { min_spend: Number(e.target.value) })} placeholder={L("ยอดขั้นต่ำ", "Min spend", "最低消费")} className={inputCls + " tnum"} />
                <input type="number" min={1} step={0.05} value={t.multiplier} onChange={(e) => set(i, { multiplier: Number(e.target.value) })} placeholder={L("ตัวคูณ", "Multiplier", "倍数")} className={inputCls + " tnum"} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {rows.length < 10 ? <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, { brand_id: brand, code: "", name: "", min_spend: (r.at(-1)?.min_spend ?? 0) + 10000, multiplier: 1, color: "#9CA3AF", perks: null, active: true }])}><Plus size={13} />{L("เพิ่มระดับ", "Add tier", "添加等级")}</Button> : null}
            {msg ? <span className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.t}</span> : null}
            <span className="ml-auto flex gap-2">
              {dirty ? <Button size="sm" variant="ghost" onClick={() => setRows(saved.map((t) => ({ ...t })))}>{L("ยกเลิกแก้ไข", "Discard changes", "放弃修改")}</Button> : null}
              <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>{L("บันทึกระดับ", "Save tiers", "保存等级")}</Button>
            </span>
          </div>
          {saved.length && stats ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {saved.map((t) => <span key={t.code} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name} <b className="tnum">{nf(stats.tiers[t.code] ?? 0)}</b> {L("คน", "people", "人")}</span>)}
            </div>
          ) : null}
        </div>
      ) : !inherited.length ? (
        <p className="text-xs text-muted rounded-xl border border-dashed border-line px-4 py-6 text-center">{L("ยังไม่ได้ตั้งระดับสมาชิก — ทุกคนได้แต้มอัตราเดียวกัน", "No tiers set — everyone earns at the same rate", "尚未设置会员等级 — 所有人按相同比例积分")}</p>
      ) : null}
    </section>
  );
}

// ---------- กฎพิเศษ ----------
function RuleList({ rules, brandName, onEdit, onNew, post, reload }: { rules: Rule[]; brandName: (id: string | null) => string; onEdit: (r: Rule) => void; onNew: (r: Partial<Rule>) => void; post: (b: unknown) => Promise<unknown>; reload: () => Promise<void> }) {
  const L = useL();
  const KINDS = KIND(), CONDL = CONDS(), CHL = CHANNELS(), SEGL = SEGMENTS();
  const groups: [string, Rule[]][] = [[L("กำลังใช้", "Active", "生效中"), []], [L("ยังไม่เริ่ม", "Scheduled", "未开始"), []], [L("ปิด / หมดช่วง", "Off / ended", "已关闭 / 已结束"), []]];
  for (const r of rules) groups[ruleState(r).group][1].push(r);
  async function toggle(r: Rule) { await post({ action: "save_rule", rule: { ...r, active: !r.active } }); await reload(); }
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <p className="text-xs text-muted mb-2">{L("เริ่มจากแบบสำเร็จรูป", "Start from a template", "从模板开始")}</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES().map((t) => <button key={t.label} onClick={() => onNew(t.rule)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line text-xs hover:border-brand/50 hover:bg-brand/5"><t.icon size={13} className="text-amber-600" />{t.label}</button>)}
        </div>
      </section>
      {rules.length ? groups.filter(([, list]) => list.length).map(([title, list]) => (
        <section key={title} className="space-y-2">
          <p className="text-xs font-semibold text-muted px-1">{title} · {list.length}</p>
          {list.map((r) => {
            const st = ruleState(r), K = KINDS[r.kind], cond = CONDL.find((c) => c.v === r.customer_condition);
            return (
              <div key={r.id} className={`card px-4 py-3 flex items-start gap-3 ${st.group === 2 ? "opacity-70" : ""}`}>
                <span className={`h-9 w-9 grid place-items-center rounded-xl shrink-0 ${K.tint}`}><K.icon size={16} /></span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold flex flex-wrap items-center gap-1.5"><span className="truncate">{r.name}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-md ${st.cls}`}>{st.label}</span>
                    {r.customer_condition !== "none" ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-pink-500/10 text-pink-600 inline-flex items-center gap-1">{r.customer_condition === "first_purchase" ? <Users size={10} /> : <Cake size={10} />}{cond?.label}</span> : null}</p>
                  <p className="text-xs"><span className="text-muted">{K.th} ·</span> <b>{ruleValue(r)}</b>{r.min_spend > 0 ? <span className="text-muted"> · {L("ขั้นต่ำ", "min", "最低")} {formatTHB(r.min_spend, false)}</span> : null}</p>
                  <p className="text-[11px] text-muted flex items-center gap-1"><Clock3 size={11} />{ruleWhen(r)}</p>
                  <p className="text-[11px] text-muted truncate">
                    {brandName(r.brand_id)}{r.branch_ids.length ? ` · ${r.branch_ids.length} ${L("สาขา", "branches", "家门店")}` : ` · ${L("ทุกสาขา", "All branches", "所有门店")}`}
                    {r.channels.length ? ` · ${r.channels.map((c) => CHL.find((x) => x[0] === c)?.[1] ?? c).join(", ")}` : ""}
                    {r.target_segment !== "all" ? ` · ${SEGL.find((s) => s[0] === r.target_segment)?.[1]}` : ""}
                    {r.kind === "per_item" ? ` · ${r.product_ids.length || r.category_ids.length ? L(`${r.product_ids.length} สินค้า ${r.category_ids.length} หมวด`, `${r.product_ids.length} products ${r.category_ids.length} categories`, `${r.product_ids.length} 个商品 ${r.category_ids.length} 个类别`) : L("ทุกสินค้า", "All products", "所有商品")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => void toggle(r)} className={`h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2 ${r.active ? "text-ok" : "text-muted"}`} title={r.active ? L("ปิดกฎ", "Turn off rule", "关闭规则") : L("เปิดกฎ", "Turn on rule", "开启规则")}><Power size={14} /></button>
                  <button onClick={() => onEdit(r)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2" title={L("แก้ไข", "Edit", "编辑")}><Pencil size={14} /></button>
                  <button onClick={async () => { if (!confirmDelete()) return; await post({ action: "archive_rule", id: r.id }); await reload(); }} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-danger/5" title={L("ลบ", "Delete", "删除")}><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </section>
      )) : <p className="card text-xs text-muted text-center py-10">{L("ยังไม่มีกฎพิเศษ — ใช้อัตราหลักอย่างเดียว · เลือกแบบสำเร็จรูปด้านบนเพื่อเริ่ม", "No special rules — base rate only · pick a template above to start", "暂无特别规则 — 仅使用基础比例 · 选择上方模板开始")}</p>}
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
  alertToast(tr("กดอีกครั้งภายใน 4 วินาทีเพื่อยืนยันการลบ", "Tap again within 4 seconds to confirm delete", "4 秒内再次点击以确认删除"));
  return false;
}
function alertToast(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.className = "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-ink text-surface text-xs px-4 py-2 shadow-pop";
  document.body.appendChild(el); setTimeout(() => el.remove(), 3500);
}

function RuleDrawer({ rule, data, onClose, onSaved, post }: { rule: Rule; data: Data | null; onClose: () => void; onSaved: () => void; post: (b: unknown) => Promise<unknown> }) {
  const L = useL();
  const KINDS = KIND(), CONDL = CONDS(), CHL = CHANNELS(), SEGL = SEGMENTS(), DAYL = DAYS();
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
    catch (e) { setErr(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败")); } finally { setBusy(false); }
  }
  const box = "space-y-2.5 rounded-xl border border-line p-3.5";
  return (
    <Drawer open onClose={onClose} title={rule.id ? L("แก้ไขกฎแต้มสะสม", "Edit points rule", "编辑积分规则") : L("เพิ่มกฎแต้มสะสม", "Add points rule", "添加积分规则")} subtitle={L("ทำงานอัตโนมัติกับทุกบิลที่มีลูกค้า ตามเงื่อนไขที่ตั้ง", "Applies automatically to every bill with a customer that matches the conditions", "按设定条件自动应用于所有有客户的单据")}
      footer={<><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{L("บันทึก", "Save", "保存")}</Button></>}>
      <div className="p-5 space-y-4 text-xs">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KINDS) as Rule["kind"][]).map((k) => {
            const K = KINDS[k];
            return (
              <button key={k} type="button" onClick={() => set("kind", k)} className={`rounded-xl border p-2.5 text-left transition ${r.kind === k ? "border-brand ring-2 ring-brand/15 bg-brand/5" : "border-line hover:border-ink/20"}`}>
                <span className={`h-7 w-7 grid place-items-center rounded-lg ${K.tint}`}><K.icon size={14} /></span><p className="font-semibold mt-1.5">{K.th}</p><p className="text-[10.5px] text-muted leading-snug">{K.desc}</p>
              </button>
            );
          })}
        </div>
        <label className="block space-y-1"><span className="text-muted">{L("ชื่อกฎ", "Rule name", "规则名称")} <span className="opacity-70">{L("(แสดงในรายละเอียดแต้มของบิล)", "(shown in the bill points breakdown)", "（显示在单据积分明细中）")}</span></span>
          <input value={r.name} onChange={(e) => set("name", e.target.value)} placeholder={L("เช่น สงกรานต์ แต้ม ×2", "e.g. Songkran points ×2", "例如 泼水节积分 ×2")} className={inputCls} /></label>

        <div className="grid grid-cols-2 gap-3">
          {r.kind === "multiplier" ? <label className="space-y-1"><span className="text-muted">{L("ตัวคูณแต้มฐาน", "Base points multiplier", "基础积分倍数")}</span><input type="number" min={1} step={0.5} value={r.multiplier ?? 2} onChange={(e) => set("multiplier", Number(e.target.value))} className={inputCls + " tnum"} /></label> : null}
          {r.kind === "per_item" ? <>
            <label className="space-y-1"><span className="text-muted">{L("แต้มต่อชิ้น", "Points per item", "每件积分")}</span><input type="number" min={0} value={r.points_per_unit ?? 0} onChange={(e) => set("points_per_unit", Number(e.target.value))} className={inputCls + " tnum"} /></label>
            <label className="space-y-1"><span className="text-muted">{L("ซื้ออย่างน้อย (ชิ้น)", "Min quantity (items)", "最少购买（件）")}</span><input type="number" min={1} value={r.min_qty} onChange={(e) => set("min_qty", Number(e.target.value))} className={inputCls + " tnum"} /></label>
          </> : null}
          {r.kind === "bonus" ? <label className="space-y-1"><span className="text-muted">{L("แต้มโบนัสต่อบิล", "Bonus points per bill", "每单奖励积分")}</span><input type="number" min={0} value={r.bonus_points ?? 0} onChange={(e) => set("bonus_points", Number(e.target.value))} className={inputCls + " tnum"} /></label> : null}
          {r.kind !== "per_item" ? <label className="space-y-1"><span className="text-muted">{L("ยอดซื้อขั้นต่ำต่อบิล (บาท)", "Min spend per bill (THB)", "每单最低消费（泰铢）")}</span><input type="number" min={0} value={r.min_spend} onChange={(e) => set("min_spend", Number(e.target.value))} className={inputCls + " tnum"} /></label> : null}
        </div>

        <div className={box}>
          <p className="font-semibold">{L("ลูกค้าที่ได้สิทธิ์", "Eligible customers", "适用客户")}</p>
          <div className="flex flex-wrap gap-1.5">
            {CONDL.map((c) => <button key={c.v} type="button" onClick={() => set("customer_condition", c.v)} className={`h-8 px-3 rounded-full border inline-flex items-center gap-1.5 ${r.customer_condition === c.v ? "bg-ink text-surface border-ink" : "border-line hover:border-ink/30"}`}>{c.v === "first_purchase" ? <Users size={12} /> : c.v !== "none" ? <Cake size={12} /> : null}{c.label}</button>)}
          </div>
          {r.customer_condition !== "none" ? <p className="text-muted">{CONDL.find((c) => c.v === r.customer_condition)?.hint} · {L("ต้องเลือกลูกค้าในบิล", "requires a customer on the bill", "单据需选择客户")}</p> : null}
          <label className="block space-y-1"><span className="text-muted">{L("กลุ่มลูกค้า", "Customer segment", "客户群")}</span>
            <select value={r.target_segment} onChange={(e) => set("target_segment", e.target.value)} className={inputCls}>{SEGL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>

        {r.kind === "per_item" ? (
          <div className={box}>
            <p className="font-semibold">{L("สินค้าที่ได้แต้มรายชิ้น", "Products earning per-item points", "按件积分商品")} <span className="font-normal text-muted">{L("(ไม่เลือกเลย = ทุกสินค้า)", "(none selected = all products)", "（不选 = 所有商品）")}</span></p>
            <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นชื่อ / SKU", "Search name / SKU", "搜索名称 / SKU")} className={inputCls + " pl-8"} /></div>
            {hits.length ? <div className="rounded-lg border border-line divide-y divide-line/60 max-h-40 overflow-auto">{hits.map((p) => (
              <button key={p.id} type="button" onClick={() => { if (!picked.some((x) => x.id === p.id)) setPicked([...picked, p]); setQ(""); }} className="w-full text-left px-2.5 py-1.5 hover:bg-surface2"><span className="font-mono" translate="no">{p.sku}</span> · <span translate="no">{p.name_th}</span></button>
            ))}</div> : null}
            {picked.length ? <div className="flex flex-wrap gap-1.5">{picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5"><span className="font-mono" translate="no">{p.sku}</span><button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}><XIcon size={11} /></button></span>
            ))}</div> : null}
            <SearchSelect allLabel={L("ไม่จำกัดหมวด", "All categories", "不限类别")} placeholder={L("ค้นหาหมวด…", "Search categories…", "搜索类别…")} options={(data?.categories ?? []).map((c) => ({ v: c.id, label: c.name_th }))} selected={r.category_ids} onChange={(v) => set("category_ids", v)} />
          </div>
        ) : null}

        <div className={box}>
          <p className="font-semibold">{L("ช่วงวันเวลา", "Date & time", "日期时间")} <span className="font-normal text-muted">{L("(ว่าง = ตลอด)", "(blank = always)", "（留空 = 全天候）")}</span></p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-muted">{L("เริ่ม", "Start", "开始")}</span><input type="datetime-local" value={toLocal(r.starts_at)} onChange={(e) => set("starts_at", fromLocal(e.target.value))} className={inputCls} /></label>
            <label className="space-y-1"><span className="text-muted">{L("สิ้นสุด", "End", "结束")}</span><input type="datetime-local" value={toLocal(r.ends_at)} onChange={(e) => set("ends_at", fromLocal(e.target.value))} className={inputCls} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted mr-1">{L("เฉพาะวัน", "Days", "指定日")}</span>
            {DAYL.map((d, i) => <button key={i} type="button" onClick={() => set("days_of_week", r.days_of_week.includes(i) ? r.days_of_week.filter((x) => x !== i) : [...r.days_of_week, i])} className={`h-7 w-9 rounded-lg border ${r.days_of_week.includes(i) ? "bg-ink text-surface border-ink" : "border-line"}`}>{d}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-muted">{L("เฉพาะเวลา", "Hours", "指定时段")}</span>
            <input type="time" value={r.time_from?.slice(0, 5) ?? ""} onChange={(e) => set("time_from", e.target.value || null)} className="h-9 px-2 rounded-lg border border-line bg-surface" />
            <span>–</span>
            <input type="time" value={r.time_to?.slice(0, 5) ?? ""} onChange={(e) => set("time_to", e.target.value || null)} className="h-9 px-2 rounded-lg border border-line bg-surface" />
            {r.time_from && r.time_to && r.time_from > r.time_to ? <span className="text-[11px] text-sky-600">{L("ข้ามเที่ยงคืน", "Overnight", "跨午夜")}</span> : null}
          </div>
        </div>

        <div className={box}>
          <p className="font-semibold">{L("ใช้กับ", "Applies to", "适用于")}</p>
          <label className="block space-y-1"><span className="text-muted">{L("แบรนด์", "Brand", "品牌")}</span>
            <select value={r.brand_id ?? ""} onChange={(e) => set("brand_id", e.target.value || null)} className={inputCls}>
              <option value="">{L("ทุกแบรนด์", "All brands", "所有品牌")}</option>{(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <SearchSelect allLabel={L("ทุกสาขา", "All branches", "所有门店")} placeholder={L("ค้นหาสาขา…", "Search branches…", "搜索门店…")} options={branchOpts} selected={r.branch_ids} onChange={(v) => set("branch_ids", v)} />
          <div className="flex flex-wrap gap-1.5"><span className="text-muted mr-1 self-center">{L("ช่องทาง", "Channels", "渠道")} <span className="opacity-70">{L("(ว่าง = ทุกช่องทาง)", "(blank = all channels)", "（留空 = 所有渠道）")}</span></span>
            {CHL.map(([v, l]) => <button key={v} type="button" onClick={() => set("channels", r.channels.includes(v) ? r.channels.filter((x) => x !== v) : [...r.channels, v])} className={`h-7 px-2.5 rounded-full border ${r.channels.includes(v) ? "bg-ink text-surface border-ink" : "border-line"}`}>{l}</button>)}
          </div>
        </div>
        <Toggle checked={r.active} onChange={(v) => set("active", v)} label={L("เปิดใช้กฎนี้", "Enable this rule", "启用此规则")} />
        {err ? <p role="alert" className="text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}

// ---------- ตัวจำลอง ----------
function Simulator({ data, brand }: { data: Data | null; brand: string | null }) {
  const L = useL();
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
        if (!p) throw Error(L("ไม่พบสินค้า", "Product not found", "未找到商品")); items = [{ product_id: p.id, qty }];
      }
      const r = await fetch("/api/admin/loyalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "simulate", branch_id: branch, net, channel, at: fromLocal(at), items, sim: { tier_code: tier || null, birthday: bday, first_purchase: first } }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setRes(j.result);
    } catch (e) { setErr(e instanceof Error ? e.message : L("คำนวณไม่สำเร็จ", "Calculation failed", "计算失败")); } finally { setBusy(false); }
  }
  const reason: Record<string, string> = { no_program: L("ยังไม่ได้ตั้งค่าแต้ม", "Points not configured", "尚未设置积分"), redeemed_bill: L("บิลที่ใช้แต้มไม่ได้แต้ม (ตามการตั้งค่า)", "Bills that redeem points earn none (per settings)", "使用积分的单据不累积积分（按设置）"), below_min_spend: L("ยอดไม่ถึงขั้นต่ำ", "Below minimum spend", "未达最低消费") };
  return (
    <aside className="card p-4 space-y-3 h-fit text-xs lg:sticky lg:top-4">
      <p className="text-sm font-semibold flex items-center gap-1.5"><Calculator size={15} className="text-amber-600" />{L("ลองคำนวณแต้ม", "Points simulator", "积分试算")}</p>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="text-muted">{L("ยอดสุทธิ (บาท)", "Net amount (THB)", "净额（泰铢）")}</span><input type="number" value={net} onChange={(e) => setNet(Number(e.target.value))} className={inputCls + " tnum"} /></label>
        <label className="space-y-1"><span className="text-muted">{L("ช่องทาง", "Channel", "渠道")}</span><select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>{CHANNELS().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="block space-y-1"><span className="text-muted">{L("วันเวลาที่ขาย", "Sale date & time", "销售日期时间")}</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={inputCls} /></label>
      <div className="grid grid-cols-[1fr_64px] gap-2">
        <label className="space-y-1"><span className="text-muted">SKU <span className="opacity-70">{L("(ไม่บังคับ)", "(optional)", "（可选）")}</span></span><input value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls + " font-mono"} /></label>
        <label className="space-y-1"><span className="text-muted">{L("จำนวน", "Qty", "数量")}</span><input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className={inputCls + " tnum"} /></label>
      </div>
      <div className="rounded-xl bg-surface2/60 p-2.5 space-y-2">
        <p className="text-muted">{L("ลูกค้าสมมติ", "Sample customer", "模拟客户")}</p>
        {tierOpts.length ? <select value={tier} onChange={(e) => setTier(e.target.value)} className={inputCls}><option value="">{L("ไม่ระบุระดับ", "No tier", "不指定等级")}</option>{tierOpts.map((t) => <option key={t.code} value={t.code}>{t.name} (×{t.multiplier})</option>)}</select> : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5"><Toggle checked={bday} onChange={setBday} label={L("วันเกิด", "Birthday", "生日")} /><Toggle checked={first} onChange={setFirst} label={L("ซื้อครั้งแรก", "First purchase", "首次购买")} /></div>
      </div>
      <Button variant="primary" className="w-full" disabled={!branch} loading={busy} onClick={() => void run()}>{L("คำนวณแต้ม", "Calculate points", "计算积分")}</Button>
      {err ? <p className="text-danger">{err}</p> : null}
      {res ? (
        <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 p-3 space-y-1.5">
          <p className="flex items-baseline gap-1.5"><span className="text-2xl font-semibold tnum text-amber-700 dark:text-amber-300">{nf(res.points)}</span><span className="text-muted">{L("แต้ม", "points", "积分")}</span>
            {res.tier?.name ? <span className="ml-auto inline-flex items-center gap-1 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: res.tier.color }} />{res.tier.name}</span> : null}</p>
          {res.reason ? <p className="text-muted">{reason[res.reason] ?? res.reason}</p> : null}
          <div className="divide-y divide-amber-500/15">
            {res.parts.map((p, i) => <p key={i} className="flex justify-between gap-2 py-1"><span className="text-muted">{p.label}{p.qty ? ` × ${p.qty}` : ""}{p.multiplier ? ` (×${p.multiplier})` : ""}</span><span className="tnum font-medium">{p.points > 0 ? "+" : ""}{nf(p.points)}</span></p>)}
          </div>
          {res.expiry_months ? <p className="text-[10px] text-muted">{L(`แต้มหมดอายุใน ${res.expiry_months} เดือน`, `Points expire in ${res.expiry_months} months`, `积分 ${res.expiry_months} 个月后过期`)}</p> : null}
        </div>
      ) : null}
    </aside>
  );
}

// ---------- แต้มใกล้หมดอายุ ----------
type ExpRow = { customer_id: string; name: string; phone: string | null; points: number; expiring: number; next_at: string };
function ExpiringReport({ brand }: { brand: string | null }) {
  const L = useL();
  const [days, setDays] = useState(30);
  const [res, setRes] = useState<{ rows: ExpRow[]; last_run: { amount: number; created_at: string } | null } | null>(null), [err, setErr] = useState("");
  useEffect(() => {
    let alive = true; setRes(null); setErr("");
    fetch(`/api/admin/loyalty?expiring=${days}${brand ? `&brand=${brand}` : ""}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr(j.error); else setRes(j); }).catch(() => alive && setErr(L("โหลดไม่สำเร็จ", "Failed to load", "加载失败")));
    return () => { alive = false; };
  }, [days, brand]);
  const total = res?.rows.reduce((n, r) => n + Math.min(r.expiring, r.points), 0) ?? 0;
  const d = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <section className="card overflow-hidden">
      <div className="p-4 flex flex-wrap items-center gap-3 border-b border-line">
        <span className="h-9 w-9 grid place-items-center rounded-xl bg-danger/10 text-danger"><Hourglass size={16} /></span>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold">{L("ลูกค้าที่แต้มใกล้หมดอายุ", "Customers with expiring points", "积分即将过期的客户")}</p>
          <p className="text-xs text-muted">{L("ชวนลูกค้ากลับมาใช้แต้มก่อนหมด · ระบบตัดแต้มหมดอายุอัตโนมัติวันละครั้ง", "Invite customers back to use points before they expire · expired points are cleared automatically once a day", "提醒客户在过期前使用积分 · 系统每天自动清除过期积分")}{res?.last_run ? ` (${L("ล่าสุด", "last", "最近")} ${new Date(res.last_run.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${nf(Number(res.last_run.amount))} ${L("แต้ม", "pts", "积分")})` : ""}</p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-xl border border-line bg-surface text-sm px-2.5">
          {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{L(`ภายใน ${n} วัน`, `Within ${n} days`, `${n} 天内`)}</option>)}
        </select>
        <Button size="sm" variant="soft" disabled={!res?.rows.length} onClick={() => res && exportCsv(stampFilename("points-expiring"), res.rows.map((r) => ({ name: r.name, phone: r.phone ?? "", points: r.points, expiring: Math.min(r.expiring, r.points), expires_on: r.next_at.slice(0, 10) })))}>{L("ดาวน์โหลด CSV", "Download CSV", "下载 CSV")}</Button>
      </div>
      {res && res.rows.length ? <div className="px-4 py-2.5 text-xs bg-danger/5 text-danger font-medium">{L(`${nf(res.rows.length)} คน · รวม ${nf(total)} แต้มจะหมดอายุ`, `${nf(res.rows.length)} people · ${nf(total)} points expiring`, `${nf(res.rows.length)} 人 · 共 ${nf(total)} 积分即将过期`)}</div> : null}
      {err ? <p role="alert" className="px-4 py-2 text-xs text-danger">{err}</p> : null}
      {res ? (res.rows.length ? (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-muted sticky top-0 text-xs"><tr><th className="text-left font-semibold px-4 py-2.5">{L("ลูกค้า", "Customer", "客户")}</th><th className="text-right font-semibold px-3 py-2.5">{L("แต้มคงเหลือ", "Balance", "积分余额")}</th><th className="text-right font-semibold px-3 py-2.5">{L("จะหมดอายุ", "Expiring", "即将过期")}</th><th className="text-left font-semibold px-4 py-2.5">{L("เริ่มหมด", "Expires from", "过期起始")}</th></tr></thead>
            <tbody>{res.rows.map((r) => (
              <tr key={r.customer_id} className="border-t border-line/60 hover:bg-surface2/40">
                <td className="px-4 py-2.5"><a href={`/admin/customers?id=${r.customer_id}`} className="font-medium hover:underline">{r.name}</a><p className="text-xs text-muted">{r.phone ?? "—"}</p></td>
                <td className="px-3 py-2.5 text-right tnum">{nf(r.points)}</td>
                <td className="px-3 py-2.5 text-right tnum font-semibold text-danger">{nf(Math.min(r.expiring, r.points))}</td>
                <td className="px-4 py-2.5 text-xs">{new Date(r.next_at) < new Date() ? <span className="text-danger">{L("เลยกำหนด · ตัดรอบถัดไป", "Overdue · cleared next run", "已逾期 · 下次清除")}</span> : d(r.next_at)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted text-center py-12">{L(`ไม่มีลูกค้าที่แต้มจะหมดอายุภายใน ${days} วัน`, `No customers with points expiring within ${days} days`, `${days} 天内没有积分即将过期的客户`)}</p>) : !err ? <p className="text-xs text-muted text-center py-12">{L("กำลังโหลด…", "Loading…", "加载中…")}</p> : null}
    </section>
  );
}
