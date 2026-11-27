"use client";
// =====================================================================
// หลังบ้าน → สินค้าและราคา → งานติดฟิล์ม (สิทธิ์ film.manage แก้ได้ · คนอื่นดูอย่างเดียว)
//   เงื่อนไขการขาย · ราคา (รอบคัน/รายตำแหน่ง) · ความเข้ม → ม้วนฟิล์ม · พื้นที่ต่อตำแหน่ง · รุ่นรถ → ขนาด
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Car, Loader2, Lock, Plus, Trash2, Search, Store, Wand2, Layers, Ruler, BadgeDollarSign, ListChecks } from "lucide-react";
import { Button, Card, Input, Segmented, Select } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB } from "@/lib/money";
import { priceKey, type FilmConfigData } from "@/lib/film/quote";

type Data = FilmConfigData & { brand_id: string | null; can_edit: boolean;
  branches: { id: string; code: string; name: string; name_th: string | null }[]; branch_off: { branch_id: string; series_code: string; shade: number }[];
  branch_stock: { branch_id: string; product_id: string; qty: number }[]; cars: { id: string; make: string; model: string; size_code: string }[]; rolls: { id: string; sku: string; name_th: string; unit: string; is_active: boolean }[] };
type Section = "rules" | "prices" | "branches" | "rolls" | "areas" | "cars";

export function FilmSettingsTab({ editMode }: { editMode: boolean }) {
  const { L, locale } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState("");
  const [sec, setSec] = useState<Section>("prices");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/film-config", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      setD(j); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, key: string, ok?: string) {
    setBusy(key);
    try {
      const r = await fetch("/api/admin/film-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error ?? `HTTP ${r.status}`);
      await load();
      if (ok) toast.push({ tone: "ok", title: ok });
      return true;
    } catch (e) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: e instanceof Error ? e.message : String(e) }); return false; }
    finally { setBusy(null); }
  }

  const name = (x: { name_th: string; name_en: string; name_zh: string }) => (locale === "th" ? x.name_th : locale === "zh" ? x.name_zh : x.name_en);
  if (err) return <p className="m-4 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>;
  if (!d) return <div className="h-60 grid place-items-center text-muted"><Loader2 className="animate-spin" /></div>;
  const can = d.can_edit && editMode; // ต้องเปิดโหมดแก้ไขของหน้าก่อน (กันแก้ผิด)

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-brand/12 text-brand grid place-items-center"><Car size={19} /></span>
          <div>
            <p className="font-semibold">{L("งานติดฟิล์มรถยนต์", "Car window film", "汽车贴膜")}</p>
            <p className="text-xs text-muted">{L("หน้าร้านกด “งานติดฟิล์ม” → เลือกรถ → รุ่น → ตำแหน่ง/ความเข้ม · ระบบคิดราคาและตัดสต๊อกม้วนตามค่าที่ตั้งที่นี่", "POS: “Film job” → car → series → positions/shades · price and roll deduction follow these settings", "前台“贴膜”→ 车辆 → 系列 → 位置/深度 · 价格与扣膜依此设置")}</p>
          </div>
        </div>
        {!d.can_edit ? <span className="text-xs text-muted inline-flex items-center gap-1.5"><Lock size={13} />{L("ดูอย่างเดียว — ต้องมีสิทธิ์ “ตั้งค่างานติดฟิล์มรถ”", "View only — needs “Car film setup” permission", "仅查看 — 需要“汽车贴膜设置”权限")}</span>
          : !editMode ? <span className="text-xs text-muted inline-flex items-center gap-1.5"><Lock size={13} />{L("ติ๊ก “เปิดโหมดแก้ไข” ด้านบนเพื่อแก้ค่า", "Tick “Enable editing” above to change values", "勾选上方“开启编辑”后可修改")}</span> : null}
      </Card>

      <Segmented value={sec} onChange={setSec} options={[
        { value: "prices" as Section, label: <span className="inline-flex items-center gap-1.5"><BadgeDollarSign size={14} />{L("ราคา", "Prices", "价格")}</span> },
        { value: "branches" as Section, label: <span className="inline-flex items-center gap-1.5"><Store size={14} />{L(`รายสาขา (${d.branches.length})`, `Branches (${d.branches.length})`, `门店 (${d.branches.length})`)}</span> },
        { value: "rules" as Section, label: <span className="inline-flex items-center gap-1.5"><ListChecks size={14} />{L("เงื่อนไขการขาย", "Rules", "销售规则")}</span> },
        { value: "rolls" as Section, label: <span className="inline-flex items-center gap-1.5"><Layers size={14} />{L("ความเข้ม → ม้วน", "Shades → rolls", "深度 → 膜卷")}</span> },
        { value: "areas" as Section, label: <span className="inline-flex items-center gap-1.5"><Ruler size={14} />{L("พื้นที่ต่อตำแหน่ง", "Areas", "面积")}</span> },
        { value: "cars" as Section, label: <span className="inline-flex items-center gap-1.5"><Car size={14} />{L(`รุ่นรถ (${d.cars.length})`, `Car models (${d.cars.length})`, `车型 (${d.cars.length})`)}</span> },
      ]} />

      {sec === "rules" ? (
        <Card className="p-5 space-y-3 max-w-3xl">
          {([
            ["one_series_per_car", L("รุ่นฟิล์มเดียวทั้งคัน", "One film series per car", "整车同一膜系列"), L("ค่าเริ่มต้น — ทุกตำแหน่งต้องเป็น Essential/Pro/Ultra รุ่นเดียวกัน", "Default — every position uses the same series", "默认 — 所有位置同一系列")],
            ["full_car_only", L("ขายเฉพาะติดรอบคัน", "Full-car installs only", "仅限全车"), L("ปิด = ขายรายตำแหน่งได้ (ต้องตั้งราคารายตำแหน่งในแท็บราคา)", "Off = sell individual positions (set per-position prices first)", "关闭 = 可按位置销售（需先设置分位置价格）")],
            ["mixed_shades", L("ความเข้มต่างกันได้ในแต่ละตำแหน่ง", "Different shade per position", "各位置深度可不同"), L("เช่น บานหน้า 40% ข้าง 80%", "e.g. windshield 40%, sides 80%", "如前挡 40%、侧窗 80%")],
            ["round_up_feet", L("ปัดฟุตขึ้นเป็นจำนวนเต็มต่อม้วน", "Round feet up per roll", "每卷英尺向上取整"), L("คลังกลาง JST รับจำนวนเต็ม — เช่น 2.5 ฟุต → 3 ฟุต", "JST accepts whole numbers — 2.5 ft → 3 ft", "JST 只收整数 — 2.5 → 3 英尺")],
          ] as const).map(([k, t, hint]) => (
            <label key={k} className="flex items-start gap-3 rounded-xl border border-line p-3">
              <input type="checkbox" disabled={!can || !!busy} checked={!!d.rules[k]} onChange={(e) => void post({ action: "rules", ...d.rules, [k]: e.target.checked }, "rules", L("บันทึกแล้ว", "Saved", "已保存"))} className="mt-1 accent-[rgb(var(--c-brand))]" />
              <span><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
            <span className="flex-1 min-w-[220px]"><span className="block font-medium">{L("หน่วยตัดสต๊อกม้วนฟิล์ม", "Film roll stock unit", "膜卷扣库存单位")}</span>
              <span className="block text-xs text-muted">{L("ตามชีท “ยอดตัดสต๊อกทั้งคัน” = ตร.ฟุต (Size S รอบคัน 50) · ฟุตความยาว = 10 · ม้วน 60″×100ft = 500 ตร.ฟุต", "Sheet “stock deduction” is sq ft (Size S full car 50) · length = 10 ft · a 60″×100ft roll = 500 sq ft", "表格“扣库存”为平方英尺（S 全车 50）· 长度 10 英尺 · 60″×100ft 一卷 = 500 平方英尺")}</span></span>
            <Segmented size="sm" value={d.rules.stock_unit === "ft" ? "ft" : "sqft"} onChange={(v) => { if (can) void post({ action: "rules", ...d.rules, stock_unit: v }, "rules", L("บันทึกแล้ว", "Saved", "已保存")); }}
              options={[{ value: "sqft", label: L("ตร.ฟุต (ตามชีท)", "Sq ft (sheet)", "平方英尺（表格）") }, { value: "ft", label: L("ฟุตความยาว", "Length ft", "长度英尺") }]} />
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm">
            <span className="flex-1"><span className="block font-medium">{L("ความกว้างม้วน (ฟุต)", "Roll width (ft)", "膜卷宽度（英尺）")}</span><span className="block text-xs text-muted">{L("60 นิ้ว = 5 ฟุต · ความยาวที่ใช้ = ตร.ฟุต ÷ ความกว้าง", "60 in = 5 ft · length used = sq ft ÷ width", "60 英寸 = 5 英尺 · 用量 = 面积 ÷ 宽度")}</span></span>
            <NumCell value={d.rules.roll_width_ft} disabled={!can} onSave={(v) => post({ action: "rules", ...d.rules, roll_width_ft: v }, "rules")} />
          </label>
        </Card>
      ) : null}

      {sec === "branches" ? <BranchMatrix d={d} can={can} post={post} L={L} busy={busy} /> : null}

      {sec === "prices" ? <PricesGrid d={d} can={can} name={name} post={post} L={L} /> : null}

      {sec === "rolls" ? (
        <Card className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">{L("รุ่น", "Series", "系列")}</th><th className="text-left font-medium px-3 py-2">{L("ความเข้ม", "Shade", "深度")}</th>
              <th className="text-left font-medium px-3 py-2">{L("ม้วนฟิล์มที่ตัดสต๊อก", "Roll deducted", "扣减膜卷")}</th><th className="text-right font-medium px-3 py-2">{d.rules.stock_unit === "ft" ? L("1 ชิ้น = กี่ฟุต", "1 unit = ft", "1 件 = 英尺") : L("1 ชิ้น = กี่ ตร.ฟุต", "1 unit = sq ft", "1 件 = 平方英尺")}</th><th className="text-center font-medium px-3 py-2">{L("เปิดขาย", "Active", "启用")}</th>
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {d.shades.map((s) => (
                <tr key={`${s.series_code}${s.shade}`}>
                  <td className="px-4 py-2 font-medium">{d.series.find((x) => x.code === s.series_code)?.name}</td>
                  <td className="px-3 py-2"><b className="tnum">{s.shade}%</b> <span className="text-xs text-muted">({s.model_code})</span></td>
                  <td className="px-3 py-2">
                    <Select value={s.stock_product_id ?? ""} disabled={!can || !!busy} className="!h-9 text-xs min-w-[220px]" onChange={(e) => void post({ action: "shade", ...s, stock_product_id: e.target.value || null }, "shade")}>
                      <option value="">{L("— ยังไม่ผูก —", "— not linked —", "— 未关联 —")}</option>
                      {d.rolls.map((r) => <option key={r.id} value={r.id}>{r.sku}{r.is_active ? "" : ` (${L("ปิด", "off", "停用")})`}</option>)}
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right"><NumCell value={s.feet_per_unit} disabled={!can} onSave={(v) => post({ action: "shade", ...s, feet_per_unit: v }, "shade")} /></td>
                  <td className="px-3 py-2 text-center"><input type="checkbox" checked={s.active} disabled={!can || !!busy} onChange={(e) => void post({ action: "shade", ...s, active: e.target.checked }, "shade")} className="accent-[rgb(var(--c-brand))]" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[11.5px] text-muted border-t border-line/70">{L("ปกติ 1 ชิ้น = 1 หน่วย (ตามหน่วยตัดสต๊อกในเงื่อนไขการขาย) · ถ้าสต๊อกเก็บเป็นม้วน ใส่ 500 (ม้วน 60″×100ft = 500 ตร.ฟุต)", "Normally 1 unit = 1 (per the stock unit in Rules) · if stock is kept per roll, enter 500 (60″×100ft = 500 sq ft)", "通常 1 件 = 1 单位（见规则中的扣库存单位）· 若按卷计，填 500（60″×100ft = 500 平方英尺）")}</p>
        </Card>
      ) : null}

      {sec === "areas" ? (
        <Card className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">{L("ขนาดรถ", "Size", "尺寸")}</th>
              {d.positions.map((p) => <th key={p.code} className="text-right font-medium px-3 py-2">{name(p)} <span className="font-normal">({L("ตร.ฟุต", "sq ft", "平方英尺")})</span></th>)}
              <th className="text-right font-medium px-4 py-2">{L("รวม", "Total", "合计")}</th>
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {d.sizes.map((s) => {
                const tot = d.positions.reduce((n, p) => n + (d.areas[s.code]?.[p.code] ?? 0), 0);
                return (
                  <tr key={s.code}>
                    <td className="px-4 py-2 font-medium">{name(s)}</td>
                    {d.positions.map((p) => <td key={p.code} className="px-3 py-2 text-right"><NumCell value={d.areas[s.code]?.[p.code] ?? 0} disabled={!can} onSave={(v) => post({ action: "area", size_code: s.code, position_code: p.code, sqft: v }, "area")} /></td>)}
                    <td className="px-4 py-2 text-right tnum"><b>{tot}</b> <span className="text-xs text-muted">= {Math.round((tot / (d.rules.roll_width_ft || 5)) * 10) / 10} {L("ฟุต", "ft", "英尺")}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {sec === "cars" ? <CarsList d={d} can={can} name={name} post={post} L={L} busy={busy} /> : null}
    </div>
  );
}

/** สีประจำรุ่น (Essential เขียว · Pro ม่วง · Ultra ทอง) */
const SERIES_TONE: Record<string, { bar: string; chip: string; text: string; soft: string; dot: string }> = {
  E: { bar: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", text: "text-emerald-700 dark:text-emerald-300", soft: "bg-emerald-500/[0.06] border-emerald-500/25", dot: "bg-emerald-500" },
  P: { bar: "bg-violet-500", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", text: "text-violet-700 dark:text-violet-300", soft: "bg-violet-500/[0.06] border-violet-500/25", dot: "bg-violet-500" },
  U: { bar: "bg-amber-500", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", text: "text-amber-700 dark:text-amber-300", soft: "bg-amber-500/[0.07] border-amber-500/30", dot: "bg-amber-500" },
};
const toneOf = (code: string) => SERIES_TONE[code] ?? SERIES_TONE.E;
type BranchState = "full" | "partial" | "off" | "nostock";

/** รายสาขา: การ์ดต่อสาขา · สีตามรุ่น · สถานะชัด (เปิด+มีม้วน / เปิดแต่ไม่มีม้วน / ปิด) · ปุ่มลัด */
function BranchMatrix({ d, can, post, L, busy }: { d: Data; can: boolean; busy: string | null; post: (b: Record<string, unknown>, k: string, ok?: string) => Promise<boolean>; L: (a: string, b: string, c: string) => string }) {
  const [q, setQ] = useState(""), [filter, setFilter] = useState<"all" | BranchState>("all");
  const off = (bid: string, se: string, shade: number) => d.branch_off.some((o) => o.branch_id === bid && o.series_code === se && Number(o.shade) === shade);
  const qty = (bid: string, pid: string | null) => (pid ? d.branch_stock.find((x) => x.branch_id === bid && x.product_id === pid)?.qty ?? 0 : 0);
  const unit = d.rules.stock_unit === "ft" ? L("ฟุต", "ft", "英尺") : L("ตร.ฟุต", "sq ft", "平方英尺");
  const rollSize = d.rules.stock_unit === "ft" ? 100 : 500; // 1 ม้วน 60″×100ft
  const activeShades = d.shades.filter((s) => s.active);

  // สรุปต่อสาขา
  const info = useMemo(() => d.branches.map((b) => {
    const cells = activeShades.map((sh) => ({ sh, on: !off(b.id, sh.series_code, 0) && !off(b.id, sh.series_code, sh.shade), have: qty(b.id, sh.stock_product_id) }));
    const on = cells.filter((c) => c.on), onWithStock = on.filter((c) => c.have > 0), noStockOn = on.filter((c) => c.have <= 0);
    const state: BranchState = !on.length ? "off" : !onWithStock.length ? "nostock" : on.length === cells.length ? "full" : "partial";
    const stockTotal = cells.reduce((n, c) => n + Math.max(0, c.have), 0);
    return { b, state, on: on.length, total: cells.length, noStockOn: noStockOn.length, stockTotal };
  }), [d.branches, d.branch_off, d.branch_stock, d.shades]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = { full: 0, partial: 0, off: 0, nostock: 0 } as Record<BranchState, number>;
  info.forEach((x) => counts[x.state]++);
  const META: Record<BranchState, { label: string; pill: string; ring: string; hint: string }> = {
    full: { label: L("เปิดขายครบ", "All on", "全部开放"), pill: "bg-ok/12 text-ok", ring: "border-ok/30", hint: L("ทุกรุ่นทุกความเข้มเปิดขาย", "Every series & shade on", "全部系列与深度开放") },
    partial: { label: L("เปิดบางส่วน", "Partly on", "部分开放"), pill: "bg-brand/12 text-brand", ring: "border-brand/30", hint: L("ปิดบางรุ่น/บางความเข้ม", "Some series/shades off", "部分关闭") },
    nostock: { label: L("เปิดแต่ไม่มีม้วน", "On, no rolls", "开放但无膜卷"), pill: "bg-warn/15 text-warn", ring: "border-warn/40", hint: L("หน้าร้านเห็นแต่ตัดสต๊อกไม่ได้ — ตั้งตามสต๊อกหรือเติมม้วน", "Visible at POS but no stock — match stock or restock", "前台可见但无库存") },
    off: { label: L("ปิดทั้งหมด", "All off", "全部关闭"), pill: "bg-surface2 text-muted", ring: "border-line", hint: L("หน้าร้านไม่เห็นปุ่มงานติดฟิล์ม", "Film job hidden at POS", "前台不显示贴膜") },
  };
  const s = q.trim().toLowerCase();
  const list = info.filter((x) => (filter === "all" || x.state === filter) && (!s || `${x.b.code} ${x.b.name_th ?? ""} ${x.b.name}`.toLowerCase().includes(s)));

  return (
    <div className="space-y-3">
      {/* สรุป + ตัวกรอง */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <button type="button" onClick={() => setFilter("all")} className={`rounded-2xl border p-3 text-left transition ${filter === "all" ? "border-ink/40 bg-surface shadow-card" : "border-line bg-surface/70 hover:bg-surface"}`}>
          <p className="text-[11px] text-muted">{L("สาขาทั้งหมด", "All branches", "全部门店")}</p><p className="text-2xl font-bold tnum">{info.length}</p>
        </button>
        {(["full", "partial", "nostock", "off"] as BranchState[]).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(filter === k ? "all" : k)} title={META[k].hint}
            className={`rounded-2xl border p-3 text-left transition ${filter === k ? `${META[k].ring} bg-surface shadow-card ring-1 ring-current/10` : "border-line bg-surface/70 hover:bg-surface"}`}>
            <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${META[k].pill}`}>{META[k].label}</span>
            <p className="text-2xl font-bold tnum mt-1">{counts[k]}</p>
          </button>
        ))}
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาสาขา", "Search branch", "搜索门店")} className="pl-8 !h-9" /></div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
          {d.series.map((se) => <span key={se.code} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${toneOf(se.code).dot}`} />{se.name}</span>)}
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-warn/30 border border-warn/50" />{L("เปิดแต่ไม่มีม้วน", "On, no stock", "开放无库存")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-surface2 border border-line" />{L("ปิด", "Off", "关闭")}</span>
        </div>
      </Card>

      {!can ? <p className="text-xs text-muted flex items-center gap-1.5 px-1"><Lock size={12} />{L("ติ๊ก “เปิดโหมดแก้ไข” ด้านบนเพื่อเปิด/ปิดรายสาขา", "Tick “Enable editing” above to change", "勾选上方“开启编辑”后可修改")}</p> : null}

      <div className="grid xl:grid-cols-2 gap-3">
        {list.map(({ b, state, on, total, stockTotal }) => (
          <Card key={b.id} className={`overflow-hidden border ${META[state].ring}`}>
            {/* หัวการ์ด */}
            <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-line/60">
              <span className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0"><Store size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate" translate="no">{b.name_th || b.name}</p>
                <p className="text-[11px] text-muted"><span className="font-mono" translate="no">{b.code}</span> · {L("ม้วนรวม", "Rolls", "膜卷合计")} <b className="tnum text-ink">{stockTotal.toLocaleString()}</b> {unit}</p>
              </div>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${META[state].pill}`}>{META[state].label} · {on}/{total}</span>
            </div>
            {/* รายรุ่น */}
            <div className="p-3 space-y-2">
              {d.series.map((se) => {
                const tone = toneOf(se.code);
                const seriesOff = off(b.id, se.code, 0);
                const shades = d.shades.filter((x) => x.series_code === se.code && x.active);
                return (
                  <div key={se.code} className={`relative rounded-xl border pl-4 pr-3 py-2.5 flex flex-wrap items-center gap-3 ${seriesOff ? "border-line bg-surface2/40" : tone.soft}`}>
                    <span className={`absolute left-0 top-2 bottom-2 w-1.5 rounded-full ${seriesOff ? "bg-line" : tone.bar}`} />
                    <div className="w-[118px] shrink-0">
                      <p className={`text-[13px] font-semibold ${seriesOff ? "text-muted" : tone.text}`}>{se.name}</p>
                      <Switch on={!seriesOff} disabled={!can || !!busy} label={seriesOff ? L("ปิดทั้งรุ่น", "Off", "关闭") : L("เปิดขาย", "On", "开放")}
                        onChange={(v) => void post({ action: "branch_toggle", branch_id: b.id, series_code: se.code, shade: 0, enabled: v }, "branch")} />
                    </div>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {shades.map((sh) => {
                        const isOff = seriesOff || off(b.id, se.code, sh.shade);
                        const have = qty(b.id, sh.stock_product_id);
                        const noStock = !isOff && have <= 0;
                        const pct = Math.max(0, Math.min(100, (have / rollSize) * 100));
                        return (
                          <button key={sh.shade} type="button" disabled={!can || seriesOff || !!busy}
                            title={`${sh.model_code} · ${sh.sku ?? ""} · ${have.toLocaleString()} ${unit}`}
                            onClick={() => void post({ action: "branch_toggle", branch_id: b.id, series_code: se.code, shade: sh.shade, enabled: off(b.id, se.code, sh.shade) }, "branch")}
                            className={`w-[84px] rounded-xl border px-2 py-1.5 text-left transition disabled:cursor-not-allowed ${isOff ? "border-line bg-surface2/70 opacity-60" : noStock ? "border-warn/50 bg-warn/[0.08]" : "border-ok/40 bg-surface hover:shadow-card"}`}>
                            <span className="flex items-center justify-between">
                              <span className={`text-[13px] font-bold tnum ${isOff ? "line-through text-muted" : ""}`}>{sh.shade}%</span>
                              {/* แถบสีจำลองความเข้มฟิล์ม */}
                              <span className="h-3.5 w-6 rounded-[4px] border border-black/10" style={{ background: `rgba(17,24,39,${Math.min(0.92, sh.shade / 100 + 0.05)})` }} />
                            </span>
                            <span className={`block text-[10.5px] tnum mt-0.5 ${isOff ? "text-muted" : noStock ? "text-warn font-semibold" : "text-ok font-semibold"}`}>
                              {isOff ? L("ปิด", "off", "关") : noStock ? L("ไม่มีม้วน", "no roll", "无卷") : `${have.toLocaleString()} ${unit}`}
                            </span>
                            <span className="block h-1 rounded-full bg-line/70 mt-1 overflow-hidden"><span className={`block h-full ${isOff ? "bg-muted/40" : noStock ? "bg-warn" : "bg-ok"}`} style={{ width: `${isOff ? 0 : noStock ? 100 : Math.max(6, pct)}%` }} /></span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* ปุ่มลัด */}
            {can ? (
              <div className="px-3 pb-3 flex flex-wrap gap-2">
                <Button size="sm" variant="soft" disabled={!!busy} onClick={() => void post({ action: "branch_auto", branch_id: b.id }, "branch", L("ตั้งตามสต๊อกแล้ว", "Matched to stock", "已按库存设置"))}><Wand2 size={13} />{L("ตั้งตามสต๊อก", "Match stock", "按库存设置")}</Button>
                <Button size="sm" variant="ghost" disabled={!!busy || state === "full"} onClick={() => void post({ action: "branch_all", branch_id: b.id, enabled: true }, "branch", L("เปิดทั้งหมดแล้ว", "All on", "已全部开放"))}>{L("เปิดทั้งหมด", "All on", "全部开放")}</Button>
                <Button size="sm" variant="ghost" disabled={!!busy || state === "off"} onClick={() => void post({ action: "branch_all", branch_id: b.id, enabled: false }, "branch", L("ปิดทั้งหมดแล้ว", "All off", "已全部关闭"))}>{L("ปิดทั้งหมด", "All off", "全部关闭")}</Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      {!list.length ? <Card className="p-10 text-center text-sm text-muted">{info.length ? L("ไม่มีสาขาตามตัวกรอง", "No branches match", "没有符合的门店") : L("ไม่มีสาขาที่ขายแบรนด์ฟิล์มหรือมีม้วนฟิล์ม", "No branches sell the film brand or hold rolls", "没有销售该膜品牌或有膜卷的门店")}</Card> : null}
    </div>
  );
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="mt-1 inline-flex items-center gap-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-70">
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? "bg-ok" : "bg-line"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "left-3.5" : "left-0.5"}`} /></span>
      <span className={on ? "text-ink" : "text-muted"}>{label}</span>
    </button>
  );
}

function PricesGrid({ d, can, name, post, L }: { d: Data; can: boolean; name: (x: { name_th: string; name_en: string; name_zh: string }) => string; post: (b: Record<string, unknown>, k: string) => Promise<boolean>; L: (a: string, b: string, c: string) => string }) {
  const [perPos, setPerPos] = useState(false);
  const series = d.series;
  const cols = perPos ? d.positions.map((p) => ({ code: p.code, label: name(p) })) : [{ code: "ALL", label: L("รอบคัน", "Full car", "全车") }];
  return (
    <Card className="overflow-auto">
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-line/70">
        <p className="text-xs text-muted">{L("ราคารวมติดตั้ง (บาท รวม VAT) · ช่องว่าง = ยังขายไม่ได้", "Installed price (THB incl. VAT) · blank = not for sale", "含安装价（含税）· 空白 = 不可售")}</p>
        <Segmented size="sm" value={perPos ? "pos" : "all"} onChange={(v) => setPerPos(v === "pos")} options={[{ value: "all", label: L("ราคารอบคัน", "Full car", "全车") }, { value: "pos", label: L("ราคารายตำแหน่ง", "Per position", "分位置") }]} />
      </div>
      {perPos && d.rules.full_car_only ? <p className="px-4 py-2 text-[11.5px] text-warn bg-warn/[0.06]">{L("ตอนนี้ยังปิดการขายรายตำแหน่ง (เงื่อนไขการขาย) — ตั้งราคาเตรียมไว้ได้", "Per-position sales are off (Rules) — you can prepare prices now", "目前未开放分位置销售 — 可先设置价格")}</p> : null}
      <table className="w-full text-sm">
        <thead className="bg-surface2 text-[11px] text-muted"><tr>
          <th className="text-left font-medium px-4 py-2">{L("ขนาดรถ", "Size", "尺寸")}</th>
          {series.map((s) => cols.map((c) => <th key={s.code + c.code} className="text-right font-medium px-3 py-2">{s.name}{perPos ? <span className="block font-normal">{c.label}</span> : null}</th>))}
        </tr></thead>
        <tbody className="divide-y divide-line/60">
          {d.sizes.map((sz) => (
            <tr key={sz.code}>
              <td className="px-4 py-2"><span className="font-medium">{name(sz)}</span>{sz.hint_th ? <span className="block text-[10.5px] text-muted" translate="no">{sz.hint_th}</span> : null}</td>
              {series.map((s) => cols.map((c) => {
                const v = d.prices[priceKey(s.code, sz.code, c.code)];
                return <td key={s.code + c.code} className="px-3 py-2 text-right"><NumCell value={v ?? null} money disabled={!can} allowEmpty onSave={(nv) => post({ action: "price", series_code: s.code, size_code: sz.code, position_code: c.code, price: nv }, "price")} /></td>;
              }))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CarsList({ d, can, name, post, L, busy }: { d: Data; can: boolean; busy: string | null; name: (x: { name_th: string; name_en: string; name_zh: string }) => string; post: (b: Record<string, unknown>, k: string, ok?: string) => Promise<boolean>; L: (a: string, b: string, c: string) => string }) {
  const [q, setQ] = useState(""), [size, setSize] = useState(""), [add, setAdd] = useState({ make: "", model: "", size_code: "S" });
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return d.cars.filter((c) => (!size || c.size_code === size) && (!s || `${c.make} ${c.model}`.toLowerCase().includes(s))); }, [d.cars, q, size]);
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-line/70">
        <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหายี่ห้อ/รุ่น", "Search make/model", "搜索品牌/车型")} className="pl-8 !h-9" /></div>
        <Select value={size} onChange={(e) => setSize(e.target.value)} className="!h-9 text-xs w-auto"><option value="">{L("ทุกขนาด", "All sizes", "全部尺寸")}</option>{d.sizes.map((s) => <option key={s.code} value={s.code}>{name(s)}</option>)}</Select>
        <span className="text-xs text-muted">{list.length} {L("รุ่น", "models", "款")}</span>
      </div>
      {can ? (
        <div className="px-4 py-3 flex flex-wrap items-end gap-2 bg-surface2/50 border-b border-line/70">
          <Input value={add.make} onChange={(e) => setAdd({ ...add, make: e.target.value })} placeholder={L("ยี่ห้อ เช่น Toyota", "Make e.g. Toyota", "品牌")} className="!h-9 w-40" />
          <Input value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} placeholder={L("รุ่น เช่น Yaris Ativ", "Model", "车型")} className="!h-9 w-48" />
          <Select value={add.size_code} onChange={(e) => setAdd({ ...add, size_code: e.target.value })} className="!h-9 text-xs w-auto">{d.sizes.map((s) => <option key={s.code} value={s.code}>{name(s)}</option>)}</Select>
          <Button size="sm" variant="primary" loading={busy === "car"} disabled={!add.make.trim() || !add.model.trim()} onClick={async () => { if (await post({ action: "car", ...add }, "car", L("เพิ่มรุ่นรถแล้ว", "Car model added", "已添加车型"))) setAdd({ ...add, model: "" }); }}><Plus size={14} />{L("เพิ่มรุ่นรถ", "Add model", "添加车型")}</Button>
        </div>
      ) : null}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line/60">
            {list.slice(0, 400).map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-1.5 text-muted w-40" translate="no">{c.make}</td>
                <td className="px-3 py-1.5 font-medium" translate="no">{c.model}</td>
                <td className="px-3 py-1.5 w-56">
                  <Select value={c.size_code} disabled={!can || !!busy} className="!h-8 text-xs" onChange={(e) => void post({ action: "car", ...c, size_code: e.target.value }, "car")}>{d.sizes.map((s) => <option key={s.code} value={s.code}>{name(s)}</option>)}</Select>
                </td>
                <td className="px-3 py-1.5 w-10">{can ? <button type="button" title={L("ลบ", "Delete", "删除")} onClick={() => void post({ action: "car_delete", id: c.id }, "car")} className="text-muted hover:text-danger p-1"><Trash2 size={14} /></button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 400 ? <p className="text-center text-xs text-muted py-3">{L("แสดง 400 รายการแรก — ค้นหาเพื่อกรอง", "Showing first 400 — search to filter", "显示前 400 条 — 请搜索筛选")}</p> : null}
      </div>
    </Card>
  );
}

/** ช่องตัวเลขแก้ในตาราง — บันทึกเมื่อกด Enter หรือออกจากช่อง */
function NumCell({ value, onSave, disabled, money, allowEmpty }: { value: number | null; onSave: (v: number | null) => Promise<boolean> | void; disabled?: boolean; money?: boolean; allowEmpty?: boolean }) {
  const [v, setV] = useState(value == null ? "" : String(value)), [saving, setSaving] = useState(false);
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const commit = async () => {
    const t = v.trim().replace(/,/g, "");
    if (t === (value == null ? "" : String(value))) return;
    if (t === "" && !allowEmpty) { setV(value == null ? "" : String(value)); return; }
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isFinite(n) || n <= 0)) { setV(value == null ? "" : String(value)); return; }
    setSaving(true); await onSave(n); setSaving(false);
  };
  if (disabled) return <span className="tnum">{value == null ? <span className="text-muted">—</span> : money ? formatTHB(value) : value}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {saving ? <Loader2 size={12} className="animate-spin text-muted" /> : null}
      <input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="—" className="w-24 h-8 rounded-lg border border-line bg-surface px-2 text-right text-sm tnum focus:border-brand outline-none" />
    </span>
  );
}

