"use client";
// ค่าคอมมิชชัน — สรุปรายพนักงานประจำเดือน + กฎค่าคอม (ผูกสินค้า/หมวด/แบรนด์ · ขั้นยอด · สาขาที่มีสิทธิ์)
import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Plus, Pencil, Pause, Play, X, ChevronLeft, ChevronRight, Search, Package, Layers, Store, Users, TrendingUp, FileDown, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Badge, Button, Drawer, EmptyState, Field, Input, Segmented, Select, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { formatTHB, formatInt } from "@/lib/money";
import { bkkEndExclusive, bkkStart, toBkkYmd } from "@/lib/pricing/rules";
import { downloadExcel } from "@/lib/export";

type Ref = { id: string; name: string };
type BranchRef = { id: string; code: string; name: string; name_th: string | null; brand_id: string | null };
type Prod = { id: string; sku: string; name_th: string; brand_id: string | null; category_id: string | null; price: number };
type Tier = { min: number; rate: number };
type Rule = { id: string; name: string; scope: "sku" | "category" | "brand"; brand_id: string | null; category_id: string | null; product_ids: string[]; branch_ids: string[];
  basis: "units" | "sales"; calc: "per_unit" | "percent"; tiers: Tier[]; starts_at: string; ends_at: string; status: "active" | "paused" | "cancelled"; note: string | null; version: number };
type Row = { rule_id: string; employee_id: string; units: number; sales: number; bills: number; tier_min: number | null; rate: number | null; commission: number; next_min: number | null };
const baht = (n: number) => formatTHB(n, false);

export function CommissionTab({ products, brands, categories, branches, canManage }: { products: Prod[]; brands: Ref[]; categories: Ref[]; branches: BranchRef[]; canManage: boolean }) {
  const { L, locale } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(Date.now() + 7 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; });
  const range = useMemo(() => { const [y, m] = month.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: bkkStart(`${month}-01`), to: bkkEndExclusive(`${month}-${String(last).padStart(2, "0")}`) }; }, [month]);
  const [data, setData] = useState<{ rules: Rule[]; rows: Row[]; people: Record<string, { name: string; branch_id: string | null }> } | null>(null);
  const [edit, setEdit] = useState<Partial<Rule> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    setData(null);
    const r = await fetch(`/api/admin/commission?view=report&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { cache: "no-store" });
    const j = await r.json(); if (!r.ok) { toast.push({ tone: "danger", title: j.error }); setData({ rules: [], rows: [], people: {} }); return; }
    setData(j);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const shift = (d: number) => { const [y, m] = month.split("-").map(Number); const n = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(`${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`); };
  const monthLabel = new Date(`${month}-15T00:00:00Z`).toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { month: "long", year: "numeric" });
  const ruleMap = useMemo(() => new Map((data?.rules ?? []).map((r) => [r.id, r])), [data]);
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number; units: number; sales: number; rows: Row[] }>();
    for (const r of data?.rows ?? []) {
      const p = m.get(r.employee_id) ?? { id: r.employee_id, name: data?.people[r.employee_id]?.name ?? "—", total: 0, units: 0, sales: 0, rows: [] };
      p.total += Number(r.commission); p.units += Number(r.units); p.sales += Number(r.sales); p.rows.push(r); m.set(r.employee_id, p);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [data]);
  const total = people.reduce((s, p) => s + p.total, 0);
  const pn = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bn = useMemo(() => new Map(brands.map((b) => [b.id, b.name])), [brands]);
  const cn = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const target = (r: Rule) => r.scope === "sku" ? (r.product_ids.length === 1 ? pn.get(r.product_ids[0])?.sku ?? "1 SKU" : L(`${r.product_ids.length} สินค้า`, `${r.product_ids.length} SKUs`, `${r.product_ids.length} 个商品`))
    : r.scope === "category" ? `${L("หมวด", "Category", "类别")} ${cn.get(r.category_id ?? "") ?? "?"}` : `${L("แบรนด์", "Brand", "品牌")} ${bn.get(r.brand_id ?? "") ?? "?"}`;
  const tierText = (r: Rule, t: Tier) => `${r.basis === "units" ? L(`≥ ${formatInt(t.min)} ชิ้น`, `≥ ${formatInt(t.min)} pcs`, `≥ ${formatInt(t.min)} 件`) : `≥ ฿${formatInt(t.min)}`} → ${r.calc === "per_unit" ? L(`${baht(t.rate)}/ชิ้น`, `${baht(t.rate)}/pc`, `${baht(t.rate)}/件`) : `${t.rate}%`}`;
  async function setStatus(r: Rule, status: Rule["status"]) {
    const res = await fetch("/api/admin/commission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_rule", rule: { ...r, status } }) });
    const j = await res.json(); if (!res.ok) { toast.push({ tone: "danger", title: j.error }); return; }
    void load();
  }
  function exportXls() {
    const rows = people.flatMap((p) => p.rows.map((r) => ({ p, r, rule: ruleMap.get(r.rule_id) })));
    downloadExcel(`commission-${month}.xls`, [
      { key: "emp", label: L("พนักงาน", "Employee", "员工"), map: (x: typeof rows[number]) => x.p.name },
      { key: "rule", label: L("กฎค่าคอม", "Rule", "规则"), map: (x) => x.rule?.name ?? "" },
      { key: "units", label: L("ชิ้น", "Units", "件数"), map: (x) => Number(x.r.units) },
      { key: "sales", label: L("ยอดขายสุทธิ", "Net sales", "净销售额"), map: (x) => Number(x.r.sales) },
      { key: "rate", label: L("อัตรา", "Rate", "费率"), map: (x) => (x.r.rate == null ? "" : x.rule?.calc === "percent" ? `${x.r.rate}%` : `${x.r.rate}/${L("ชิ้น", "pc", "件")}`) },
      { key: "comm", label: L("ค่าคอม (บาท)", "Commission (THB)", "佣金（元）"), map: (x) => Number(x.r.commission) },
    ], rows, `${L("ค่าคอมมิชชัน", "Commission", "佣金")} ${monthLabel}`);
  }
  const now = Date.now();
  return (
    <div className="space-y-4">
      <div className="card px-4 py-3 flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className="h-8 w-8 grid place-items-center rounded-lg border border-line hover:bg-surface2"><ChevronLeft size={15} /></button>
        <span className="text-sm font-semibold min-w-[140px] text-center">{monthLabel}</span>
        <button onClick={() => shift(1)} className="h-8 w-8 grid place-items-center rounded-lg border border-line hover:bg-surface2"><ChevronRight size={15} /></button>
        <div className="ml-auto flex gap-2">
          {people.length ? <Button variant="ghost" onClick={exportXls}><FileDown size={14} />Excel</Button> : null}
          {canManage ? <Button variant="primary" onClick={() => setEdit({})}><Plus size={14} />{L("ตั้งกฎค่าคอม", "New commission rule", "新建佣金规则")}</Button> : null}
        </div>
      </div>

      {!data ? <Skeleton className="h-40" /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card px-4 py-3"><p className="text-[11px] text-muted">{L("ค่าคอมรวมเดือนนี้", "Total commission", "本月佣金合计")}</p><p className="text-xl font-semibold tnum">฿{baht(total)}</p></div>
            <div className="card px-4 py-3"><p className="text-[11px] text-muted">{L("พนักงานที่ได้ค่าคอม", "Earning employees", "获佣员工")}</p><p className="text-xl font-semibold tnum">{formatInt(people.filter((p) => p.total > 0).length)} / {formatInt(people.length)}</p></div>
            <div className="card px-4 py-3"><p className="text-[11px] text-muted">{L("กฎที่ใช้อยู่", "Active rules", "生效规则")}</p><p className="text-xl font-semibold tnum">{formatInt(data.rules.filter((r) => r.status === "active" && Date.parse(r.starts_at) <= now && Date.parse(r.ends_at) > now).length)}</p></div>
          </div>

          <div className="card overflow-hidden">
            <p className="px-4 py-3 border-b border-line text-sm font-semibold flex items-center gap-2"><Users size={15} />{L("ค่าคอมรายพนักงาน", "Commission by employee", "员工佣金")}</p>
            {people.length ? (
              <div className="divide-y divide-line">
                {people.map((p) => (
                  <div key={p.id}>
                    <button onClick={() => setOpen(open === p.id ? null : p.id)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-surface2/50">
                      <span className="h-8 w-8 rounded-full bg-brand/10 text-brand grid place-items-center text-xs font-semibold shrink-0">{p.name.slice(0, 1)}</span>
                      <span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate" translate="no">{p.name}</span><span className="block text-[11px] text-muted tnum">{formatInt(p.units)} {L("ชิ้น", "pcs", "件")} · ฿{baht(p.sales)} · {p.rows.length} {L("กฎ", "rules", "规则")}</span></span>
                      <span className="text-right"><span className="block text-base font-semibold tnum text-ok">฿{baht(p.total)}</span></span>
                    </button>
                    {open === p.id ? (
                      <div className="px-4 pb-3 space-y-1.5">
                        {p.rows.map((r) => { const rule = ruleMap.get(r.rule_id); if (!rule) return null; const basisVal = rule.basis === "units" ? Number(r.units) : Number(r.sales); const nextGap = r.next_min != null ? Number(r.next_min) - basisVal : null;
                          return (
                            <div key={r.rule_id} className="rounded-xl bg-surface2/60 px-3 py-2 text-[12px]">
                              <p className="flex flex-wrap justify-between gap-2"><b>{rule.name}</b><span className="tnum font-semibold">฿{baht(Number(r.commission))}</span></p>
                              <p className="text-muted tnum">{formatInt(Number(r.units))} {L("ชิ้น", "pcs", "件")} · ฿{baht(Number(r.sales))} · {r.rate != null ? (rule.calc === "per_unit" ? L(`${baht(Number(r.rate))}/ชิ้น`, `${baht(Number(r.rate))}/pc`, `${baht(Number(r.rate))}/件`) : `${r.rate}%`) : L("ยังไม่ถึงขั้นแรก", "Below first tier", "未达第一档")}</p>
                              {nextGap != null ? <p className="text-brand mt-0.5 flex items-center gap-1"><TrendingUp size={12} />{rule.basis === "units" ? L(`อีก ${formatInt(nextGap)} ชิ้น ถึงขั้นถัดไป`, `${formatInt(nextGap)} more pcs to next tier`, `再售 ${formatInt(nextGap)} 件达下一档`) : L(`อีก ฿${baht(nextGap)} ถึงขั้นถัดไป`, `฿${baht(nextGap)} more to next tier`, `再售 ฿${baht(nextGap)} 达下一档`)}</p> : null}
                            </div>
                          ); })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <EmptyState icon={<Coins size={24} />} title={L("ยังไม่มีค่าคอมในเดือนนี้", "No commission this month", "本月暂无佣金")} body={L("เมื่อมียอดขายสินค้าที่อยู่ในกฎค่าคอม ระบบจะคำนวณให้อัตโนมัติ", "Calculated automatically from sales of products covered by a rule", "有规则覆盖的商品销售时自动计算")} />}
          </div>

          <div className="card overflow-hidden">
            <p className="px-4 py-3 border-b border-line text-sm font-semibold flex items-center gap-2"><Coins size={15} />{L("กฎค่าคอม", "Commission rules", "佣金规则")}</p>
            {data.rules.length ? data.rules.map((r) => {
              const live = r.status === "active" && Date.parse(r.starts_at) <= now && Date.parse(r.ends_at) > now;
              return (
                <div key={r.id} className="px-4 py-3 border-b border-line/70 flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm font-semibold flex items-center gap-1.5">{r.name}<Badge tone={r.status === "paused" ? "warn" : live ? "ok" : "neutral"}>{r.status === "paused" ? L("หยุด", "Paused", "已暂停") : live ? L("ใช้อยู่", "Live", "生效中") : Date.parse(r.starts_at) > now ? L("รอเริ่ม", "Upcoming", "待开始") : L("หมดแล้ว", "Ended", "已结束")}</Badge></p>
                    <p className="text-[12px] mt-0.5" translate="no">{target(r)} · {r.branch_ids.length ? L(`${r.branch_ids.length} สาขา`, `${r.branch_ids.length} branches`, `${r.branch_ids.length} 家门店`) : L("ทุกสาขา", "All branches", "所有门店")}</p>
                    <p className="text-[11.5px] text-muted mt-0.5">{r.tiers.map((t) => tierText(r, t)).join(" · ")}</p>
                    <p className="text-[11px] text-muted">{toBkkYmd(r.starts_at)} – {toBkkYmd(r.ends_at, true)}</p>
                  </div>
                  {canManage ? <div className="flex gap-1">
                    <Ib title={L("แก้ไข", "Edit", "编辑")} onClick={() => setEdit(r)}><Pencil size={14} /></Ib>
                    {r.status === "active" ? <Ib title={L("หยุด", "Pause", "暂停")} onClick={() => void setStatus(r, "paused")}><Pause size={14} /></Ib> : <Ib title={L("ใช้ต่อ", "Resume", "恢复")} onClick={() => void setStatus(r, "active")}><Play size={14} /></Ib>}
                    <Ib title={L("ยกเลิกกฎ", "Cancel rule", "取消规则")} onClick={() => void setStatus(r, "cancelled")}><X size={14} /></Ib>
                  </div> : null}
                </div>
              );
            }) : <EmptyState icon={<Coins size={24} />} title={L("ยังไม่มีกฎค่าคอม", "No commission rules", "暂无佣金规则")} body={canManage ? L("กด “ตั้งกฎค่าคอม” เพื่อผูกค่าคอมกับสินค้า", "Press “New commission rule” to link commission to products", "点击“新建佣金规则”为商品设置佣金") : ""} />}
          </div>
        </>
      )}
      {edit ? <RuleDrawer initial={edit} products={products} brands={brands} categories={categories} branches={branches} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); toast.push({ tone: "ok", title: L("บันทึกกฎค่าคอมแล้ว", "Commission rule saved", "佣金规则已保存") }); }} /> : null}
    </div>
  );
}
function Ib({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button title={title} aria-label={title} onClick={onClick} className="h-8 w-8 grid place-items-center rounded-lg border border-line text-muted hover:text-brand hover:border-brand/50">{children}</button>;
}

function RuleDrawer({ initial, products, brands, categories, branches, onClose, onSaved }: { initial: Partial<Rule>; products: Prod[]; brands: Ref[]; categories: Ref[]; branches: BranchRef[]; onClose: () => void; onSaved: () => void }) {
  const { L } = useI18n();
  const today = toBkkYmd(new Date().toISOString());
  const monthEnd = (ymd: string) => { const [y, m] = ymd.split("-").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
  const [f, setF] = useState({
    name: initial.name ?? "", scope: initial.scope ?? "sku", brand_id: initial.brand_id ?? brands[0]?.id ?? "", category_id: initial.category_id ?? "", product_ids: initial.product_ids ?? [],
    allBranches: !(initial.branch_ids?.length), branch_ids: initial.branch_ids ?? [], basis: initial.basis ?? "units", calc: initial.calc ?? "per_unit",
    tiers: (initial.tiers ?? [{ min: 1, rate: 0 }]).map((t) => ({ min: String(t.min), rate: String(t.rate || "") })),
    from: initial.starts_at ? toBkkYmd(initial.starts_at) : `${today.slice(0, 7)}-01`, to: initial.ends_at ? toBkkYmd(initial.ends_at, true) : monthEnd(today), note: initial.note ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const s = q.trim().toLowerCase();
  const pick = s ? products.filter((p) => (p.sku.toLowerCase().includes(s) || p.name_th.toLowerCase().includes(s)) && !f.product_ids.includes(p.id)).slice(0, 30) : [];
  const tiers = f.tiers.map((t) => ({ min: Number(t.min), rate: Number(t.rate) })).filter((t) => Number.isFinite(t.min) && Number.isFinite(t.rate) && t.rate > 0);
  const valid = f.name.trim().length >= 2 && tiers.length > 0 && (f.scope !== "sku" || f.product_ids.length) && (f.scope !== "category" || f.category_id) && f.to >= f.from && (f.allBranches || f.branch_ids.length);
  const ex = tiers.length ? [...tiers].sort((a, b) => a.min - b.min) : [];
  async function save() {
    setBusy(true); setErr("");
    try {
      const rule = { id: initial.id, version: initial.version, status: initial.status ?? "active", name: f.name.trim(), scope: f.scope,
        brand_id: f.scope === "sku" ? products.find((p) => p.id === f.product_ids[0])?.brand_id ?? null : f.brand_id, category_id: f.scope === "category" ? f.category_id : null,
        product_ids: f.scope === "sku" ? f.product_ids : [], branch_ids: f.allBranches ? [] : f.branch_ids, basis: f.basis, calc: f.calc, tiers,
        starts_at: bkkStart(f.from), ends_at: bkkEndExclusive(f.to), note: f.note };
      const r = await fetch("/api/admin/commission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_rule", rule }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const unit = f.basis === "units" ? L("ชิ้น", "pcs", "件") : L("บาท", "THB", "元");
  return (
    <Drawer open onClose={onClose} width="lg" title={initial.id ? L("แก้กฎค่าคอม", "Edit commission rule", "编辑佣金规则") : L("ตั้งกฎค่าคอม", "New commission rule", "新建佣金规则")}
      subtitle={L("ค่าคอมคิดจากยอดขายจริงของพนักงานแต่ละคนในช่วงของกฎ · หักของคืน · ไม่นับของแถมและบิลยกเลิก", "Calculated from each employee's actual sales in the rule period · returns deducted · gifts & voids excluded", "按每位员工在规则期间的实际销售计算 · 扣除退货 · 不含赠品与作废单")}
      footer={<div className="flex justify-end gap-2 w-full"><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>{L("บันทึกกฎ", "Save rule", "保存规则")}</Button></div>}>
      <div className="p-5 space-y-5 text-sm">
        <Field label={L("ชื่อกฎ", "Rule name", "规则名称")}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={L("เช่น คอม PC เดือน ธ.ค. – หุ่นยนต์ดูดฝุ่น", "e.g. Dec PC commission – robot vacuums", "例如 12月PC佣金 – 扫地机器人")} /></Field>
        <section>
          <p className="text-[13px] font-semibold mb-2">{L("ใช้กับสินค้าไหน", "Which products", "适用商品")}</p>
          <Segmented<Rule["scope"]> value={f.scope} onChange={(v) => set({ scope: v })} options={[
            { value: "sku", label: <span className="inline-flex items-center gap-1"><Package size={13} />{L("เลือกสินค้า", "Pick SKUs", "选择商品")}</span> },
            { value: "category", label: <span className="inline-flex items-center gap-1"><Layers size={13} />{L("ทั้งหมวด", "Category", "整个类别")}</span> },
            { value: "brand", label: <span className="inline-flex items-center gap-1"><Store size={13} />{L("ทั้งแบรนด์", "Whole brand", "整个品牌")}</span> },
          ]} />
          {f.scope === "sku" ? (
            <div className="mt-2 space-y-2">
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อ", "Search SKU / name", "搜索 SKU / 名称")} className="pl-9" /></div>
              {pick.length ? <div className="max-h-36 overflow-auto rounded-xl border border-line divide-y divide-line" translate="no">{pick.map((p) => <button key={p.id} onClick={() => { set({ product_ids: [...f.product_ids, p.id] }); setQ(""); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface2"><span className="font-mono text-muted">{p.sku}</span> · {p.name_th}</button>)}</div> : null}
              <div className="flex flex-wrap gap-1.5" translate="no">{f.product_ids.map((id) => <span key={id} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-surface2 text-[11.5px] font-mono">{products.find((p) => p.id === id)?.sku}<button onClick={() => set({ product_ids: f.product_ids.filter((x) => x !== id) })} className="h-5 w-5 grid place-items-center rounded-full hover:bg-line"><X size={11} /></button></span>)}</div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <Field label={L("แบรนด์", "Brand", "品牌")}><Select value={f.brand_id} onChange={(e) => set({ brand_id: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
              {f.scope === "category" ? <Field label={L("หมวด", "Category", "类别")}><Select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field> : null}
            </div>
          )}
        </section>
        <section>
          <p className="text-[13px] font-semibold mb-2">{L("สาขาที่มีสิทธิ์ได้ค่าคอม", "Eligible branches", "可获佣门店")}</p>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.allBranches} onChange={(e) => set({ allBranches: e.target.checked })} className="accent-[rgb(var(--c-brand))]" />{L("ทุกสาขา", "All branches", "所有门店")}</label>
          {!f.allBranches ? <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-line p-1.5 grid sm:grid-cols-2 gap-0.5">{branches.map((b) => <label key={b.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded-lg hover:bg-surface2"><input type="checkbox" checked={f.branch_ids.includes(b.id)} onChange={(e) => set({ branch_ids: e.target.checked ? [...f.branch_ids, b.id] : f.branch_ids.filter((x) => x !== b.id) })} className="accent-[rgb(var(--c-brand))]" /><span className="truncate">{b.name_th ?? b.name}</span></label>)}</div> : null}
        </section>
        <section className="grid sm:grid-cols-2 gap-2">
          <Field label={L("เริ่ม", "Start", "开始")}><Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label={L("ถึง", "End", "结束")}><Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        </section>
        <section className="rounded-xl border border-line p-3 space-y-2.5">
          <p className="text-[13px] font-semibold">{L("วิธีคิดค่าคอม", "How it's calculated", "计算方式")}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label={L("นับขั้นจาก", "Tiers based on", "档位依据")}><Segmented<Rule["basis"]> value={f.basis} onChange={(v) => set({ basis: v })} options={[{ value: "units", label: L("จำนวนชิ้น", "Units", "件数") }, { value: "sales", label: L("ยอดขาย (บาท)", "Sales (THB)", "销售额") }]} /></Field>
            <Field label={L("จ่ายเป็น", "Pay as", "支付方式")}><Segmented<Rule["calc"]> value={f.calc} onChange={(v) => set({ calc: v })} options={[{ value: "per_unit", label: L("บาท/ชิ้น", "THB/pc", "元/件") }, { value: "percent", label: L("% ของยอด", "% of sales", "销售额%") }]} /></Field>
          </div>
          <div className="space-y-1.5">
            {f.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-muted w-14">{L(`ขั้น ${i + 1}`, `Tier ${i + 1}`, `第${i + 1}档`)}</span>
                <span className="text-muted">{L("ตั้งแต่", "from", "从")}</span>
                <Input inputMode="decimal" value={t.min} onChange={(e) => set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, min: e.target.value.replace(/[^\d.]/g, "") } : x)) })} className="h-8 w-24 tnum" />
                <span className="text-muted">{unit} →</span>
                <Input inputMode="decimal" value={t.rate} onChange={(e) => set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, rate: e.target.value.replace(/[^\d.]/g, "") } : x)) })} className="h-8 w-24 tnum" />
                <span className="text-muted">{f.calc === "per_unit" ? L("บาท/ชิ้น", "THB/pc", "元/件") : "%"}</span>
                {f.tiers.length > 1 ? <button onClick={() => set({ tiers: f.tiers.filter((_, j) => j !== i) })} className="text-muted hover:text-danger"><Trash2 size={13} /></button> : null}
              </div>
            ))}
            {f.tiers.length < 10 ? <button onClick={() => set({ tiers: [...f.tiers, { min: "", rate: "" }] })} className="text-xs text-brand inline-flex items-center gap-1"><Plus size={12} />{L("เพิ่มขั้น", "Add tier", "添加档位")}</button> : null}
          </div>
          {ex.length ? <p className="text-[11.5px] rounded-lg bg-brand/5 px-2.5 py-2 leading-relaxed">{L("ตัวอย่าง: ", "Example: ", "示例：")}{(() => { const top = ex[ex.length - 1]; const qty = f.basis === "units" ? Math.max(top.min, 1) : top.min; return f.basis === "units"
            ? (f.calc === "per_unit" ? L(`ขาย ${qty} ชิ้น → ได้ ${baht(qty * top.rate)} บาท`, `Sell ${qty} pcs → ${baht(qty * top.rate)} THB`, `售出 ${qty} 件 → ${baht(qty * top.rate)} 元`) : L(`ขาย ${qty} ชิ้น ใช้อัตรา ${top.rate}% ของยอด`, `Sell ${qty} pcs → ${top.rate}% of sales`, `售出 ${qty} 件 → 销售额 ${top.rate}%`))
            : (f.calc === "percent" ? L(`ยอด ฿${formatInt(qty)} → ได้ ${baht(qty * top.rate / 100)} บาท`, `Sales ฿${formatInt(qty)} → ${baht(qty * top.rate / 100)} THB`, `销售 ฿${formatInt(qty)} → ${baht(qty * top.rate / 100)} 元`) : L(`ยอดถึง ฿${formatInt(qty)} → ${baht(top.rate)} บาท/ชิ้น`, `Sales ≥ ฿${formatInt(qty)} → ${baht(top.rate)} THB/pc`, `销售达 ฿${formatInt(qty)} → ${baht(top.rate)} 元/件`)); })()}
            {" · "}{L("ถึงขั้นไหน ใช้อัตราขั้นนั้นกับยอดทั้งหมด", "Reaching a tier applies its rate to all sales", "达到某档后该档费率适用于全部销量")}</p> : null}
        </section>
        <Field label={L("หมายเหตุ (ไม่บังคับ)", "Note (optional)", "备注（可选）")}><Input value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        {err ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}
