"use client";
// =====================================================================
// ปฏิทินขาย (เจาะลึก) — แบรนด์ → สาขา → พนักงาน → บิล
//   ข้อมูลตามสิทธิ์จาก /api/work/sales/explore (เจ้าของเห็นหมด · หัวหน้าเห็นสาขาที่ดูแล · พนักงานเห็นของตัวเอง)
//   กรอง: ช่วงวันที่ (preset/กำหนดเอง) · ช่วงเวลา (ชั่วโมง) · ค้นสินค้า/บิล · มิติ ยอด/บิล/ชิ้น
//   คลิกการ์ด = เจาะลงชั้นถัดไป · คลิกวันในปฏิทิน = ดูวันนั้น · คลิกแท่งชั่วโมง = กรองช่วงเวลานั้น
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight, RefreshCw, Search, Store, Tag, User, Clock3, Receipt, Package, X, CalendarRange, ShieldCheck,
} from "lucide-react";
import { Avatar } from "@/components/ui";
import { formatTHB, formatCompact } from "@/lib/money";

// ── ชนิดข้อมูลจาก API ──
interface ApiItem { sku: string; name: string; qty: number; total: number; gift: boolean }
interface ApiOrder { id: string; no: string; at: string; branch_id: string; person_id: string | null; total: number; items: ApiItem[] }
interface ApiBranch { id: string; code: string; name: string; name_th: string | null; brand_id: string | null; province: string | null }
interface ApiBrand { id: string; code: string; name: string; name_th: string | null; color: string | null }
interface ApiPerson { id: string; nickname: string | null; first_name: string | null; last_name: string | null; photo_url: string | null }
interface ApiPending { id: string; at: string; branch_id: string; person_id: string; agreed: number; received: number }
interface ApiData { orders: ApiOrder[]; pending?: ApiPending[]; branches: ApiBranch[]; brands: ApiBrand[]; people: ApiPerson[]; scope: "all" | "limited" | "own"; truncated: boolean }

// ── order ที่แปลงเวลาไทยแล้ว ──
interface Row extends ApiOrder { day: string; hour: number; brandId: string; qty: number }
type Level = "brand" | "branch" | "person";
type Metric = "sales" | "orders" | "qty";
const NONE = "__none__";

const pad = (n: number) => String(n).padStart(2, "0");
const bkk = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000); // อ่านด้วย getUTC*
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayBkk = () => ymd(bkk(new Date().toISOString()));
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const thDate = (s: string, opt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(s + "T12:00:00+07:00").toLocaleDateString("th-TH", opt);

const PRESETS: { k: string; label: string; range: () => [string, string] }[] = [
  { k: "today", label: "วันนี้", range: () => [todayBkk(), todayBkk()] },
  { k: "yesterday", label: "เมื่อวาน", range: () => { const y = addDays(todayBkk(), -1); return [y, y]; } },
  { k: "7d", label: "7 วัน", range: () => [addDays(todayBkk(), -6), todayBkk()] },
  { k: "month", label: "เดือนนี้", range: () => [todayBkk().slice(0, 8) + "01", todayBkk()] },
  { k: "lastmonth", label: "เดือนก่อน", range: () => {
      const first = todayBkk().slice(0, 8) + "01"; const end = addDays(first, -1); return [end.slice(0, 8) + "01", end];
    } },
  { k: "year", label: "ปีนี้", range: () => [todayBkk().slice(0, 4) + "-01-01", todayBkk()] },
];
const PALETTE = ["#7950D8", "#FF725E", "#22B8A7", "#F5A524", "#3B82F6", "#E05297", "#8B5CF6", "#10B981"];

export function SalesExplorer({ admin = true }: { admin?: boolean }) {
  const [preset, setPreset] = useState("month");
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[3].range());
  const [hourFrom, setHourFrom] = useState(0);
  const [hourTo, setHourTo] = useState(23);
  const [metric, setMetric] = useState<Metric>("sales");
  const [q, setQ] = useState("");
  const [path, setPath] = useState<{ brand?: string; branch?: string; person?: string }>({});
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [openBill, setOpenBill] = useState<string | null>(null);

  // ── โหลดตามช่วงวันที่ (+รีเฟรชทุก 1 นาที) ──
  useEffect(() => {
    let alive = true;
    const run = async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const r = await fetch(`/api/work/sales/explore?from=${from}&to=${to}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(j.error || "อ่านข้อมูลขายไม่สำเร็จ");
        setData(j as ApiData); setError("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "อ่านข้อมูลขายไม่สำเร็จ");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run(false);
    const t = setInterval(() => { if (!document.hidden) void run(true); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [from, to, tick]);

  // ── อ้างอิง ──
  const ref = useMemo(() => {
    const branch = new Map((data?.branches ?? []).map((b) => [b.id, b]));
    const brand = new Map((data?.brands ?? []).map((b, i) => [b.id, { ...b, tone: b.color || PALETTE[i % PALETTE.length] }]));
    const person = new Map((data?.people ?? []).map((p) => [p.id, p]));
    return { branch, brand, person };
  }, [data]);
  const brandName = (id: string) => (id === NONE ? "ไม่ระบุแบรนด์" : ref.brand.get(id)?.name_th || ref.brand.get(id)?.name || "แบรนด์");
  const branchName = (id: string) => ref.branch.get(id)?.name_th || ref.branch.get(id)?.name || "สาขา";
  const personName = (id: string) => {
    if (id === NONE) return "ไม่ระบุพนักงาน";
    const p = ref.person.get(id);
    return p ? (p.nickname || [p.first_name, p.last_name].filter(Boolean).join(" ") || "พนักงาน") : "พนักงาน";
  };

  // ── แถวที่ผ่านตัวกรองเวลา/คำค้น (ยังไม่กรองชั้นเจาะ) ──
  const rows: Row[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.orders ?? []).map((o) => {
      const t = bkk(o.at);
      return { ...o, day: ymd(t), hour: t.getUTCHours(), brandId: ref.branch.get(o.branch_id)?.brand_id ?? NONE, qty: o.items.reduce((s, i) => s + i.qty, 0) };
    }).filter((o) => {
      if (o.hour < hourFrom || o.hour > hourTo) return false;
      if (needle && !(o.no.toLowerCase().includes(needle) || o.items.some((i) => i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle)))) return false;
      return true;
    });
  }, [data, ref, q, hourFrom, hourTo]);

  // ── ชั้นเจาะ: ถ้าเห็นแบรนด์เดียว/สาขาเดียว ข้ามชั้นให้อัตโนมัติ ──
  const brandSet = useMemo(() => new Set(rows.map((r) => r.brandId)), [rows]);
  const scoped = useMemo(() => rows.filter((r) =>
    (!path.brand || r.brandId === path.brand) &&
    (!path.branch || r.branch_id === path.branch) &&
    (!path.person || (r.person_id ?? NONE) === path.person)), [rows, path]);
  const level: Level | "bills" = path.person ? "bills" : path.branch ? "person" : path.brand || Math.max(brandSet.size, data?.brands.length ?? 0) <= 1 ? "branch" : "brand";

  const valOf = (rs: Row[]) => metric === "sales" ? rs.reduce((s, r) => s + r.total, 0) : metric === "orders" ? rs.length : rs.reduce((s, r) => s + r.qty, 0);
  const fmt = (v: number) => metric === "sales" ? formatTHB(v) : v.toLocaleString("th-TH");

  // ── กลุ่มของชั้นปัจจุบัน ──
  const groups = useMemo(() => {
    if (level === "bills") return [];
    const keyOf = (r: Row) => level === "brand" ? r.brandId : level === "branch" ? r.branch_id : (r.person_id ?? NONE);
    const m = new Map<string, Row[]>();
    for (const r of scoped) (m.get(keyOf(r)) ?? m.set(keyOf(r), []).get(keyOf(r))!).push(r);
    return [...m.entries()].map(([id, rs]) => ({ id, rows: rs, value: valOf(rs), sales: rs.reduce((s, r) => s + r.total, 0), orders: rs.length }))
      .sort((a, b) => b.value - a.value);
  }, [scoped, level, metric]);

  const total = valOf(scoped);
  // บิลรอปิด (ยังไม่ลงบิล) — กรองตามชั้นเจาะเดียวกัน แต่ "ไม่รวม" ในยอดขาย
  const pending = useMemo(() => (data?.pending ?? []).filter((d) => {
    const brandId = ref.branch.get(d.branch_id)?.brand_id ?? NONE;
    if (path.brand && brandId !== path.brand) return false;
    if (path.branch && d.branch_id !== path.branch) return false;
    if (path.person && d.person_id !== path.person) return false;
    return true;
  }), [data, ref, path]);
  const pendingAgreed = pending.reduce((s, d) => s + d.agreed, 0);
  const pendingReceived = pending.reduce((s, d) => s + d.received, 0);
  const kpi = useMemo(() => {
    const sales = scoped.reduce((s, r) => s + r.total, 0);
    const qty = scoped.reduce((s, r) => s + r.qty, 0);
    return { sales, orders: scoped.length, avg: scoped.length ? sales / scoped.length : 0, qty };
  }, [scoped]);

  // ── รายชั่วโมง + รายวัน + สินค้า ──
  const hours = useMemo(() => {
    const a = Array.from({ length: 24 }, () => [] as Row[]);
    // ใช้ rows ก่อนกรองชั่วโมง เพื่อเห็นภาพทั้งวัน (แต่กรองชั้นเจาะ+คำค้น)
    const needle = q.trim().toLowerCase();
    for (const o of data?.orders ?? []) {
      const t = bkk(o.at);
      const r: Row = { ...o, day: ymd(t), hour: t.getUTCHours(), brandId: ref.branch.get(o.branch_id)?.brand_id ?? NONE, qty: o.items.reduce((s, i) => s + i.qty, 0) };
      if (path.brand && r.brandId !== path.brand) continue;
      if (path.branch && r.branch_id !== path.branch) continue;
      if (path.person && (r.person_id ?? NONE) !== path.person) continue;
      if (needle && !(r.no.toLowerCase().includes(needle) || r.items.some((i) => i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle)))) continue;
      a[r.hour].push(r);
    }
    return a.map((rs, h) => ({ h, value: valOf(rs) }));
  }, [data, ref, path, q, metric]);
  const hourMax = Math.max(1, ...hours.map((h) => h.value));

  const days = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of scoped) (m.get(r.day) ?? m.set(r.day, []).get(r.day)!).push(r);
    const out: { day: string; value: number }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, value: valOf(m.get(d) ?? []) });
    return out;
  }, [scoped, from, to, metric]);
  const dayMax = Math.max(1, ...days.map((d) => d.value));

  const products = useMemo(() => {
    const m = new Map<string, { sku: string; name: string; qty: number; total: number }>();
    for (const r of scoped) for (const i of r.items) {
      const cur = m.get(i.sku) ?? { sku: i.sku, name: i.name, qty: 0, total: 0 };
      cur.qty += i.qty; cur.total += i.total; m.set(i.sku, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.qty - a.qty).slice(0, 10);
  }, [scoped]);
  const recent = useMemo(() => [...scoped].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40), [scoped]);

  // ── action ──
  const applyPreset = (k: string) => { const p = PRESETS.find((x) => x.k === k); if (!p) return; setPreset(k); setRange(p.range()); };
  const setCustom = (f: string, t: string) => { setPreset("custom"); setRange(f <= t ? [f, t] : [t, f]); };
  const drill = (id: string) => setPath((p) => level === "brand" ? { brand: id } : level === "branch" ? { ...p, branch: id } : { ...p, person: id });
  const hourFiltered = hourFrom !== 0 || hourTo !== 23;

  const crumbs: { label: string; icon: typeof Tag; go: () => void }[] = [
    { label: data?.scope === "own" ? "ยอดของฉัน" : "ทุกแบรนด์", icon: Tag, go: () => setPath({}) },
  ];
  if (path.brand) crumbs.push({ label: brandName(path.brand), icon: Tag, go: () => setPath({ brand: path.brand }) });
  if (path.branch) crumbs.push({ label: branchName(path.branch), icon: Store, go: () => setPath({ brand: path.brand, branch: path.branch }) });
  if (path.person) crumbs.push({ label: personName(path.person), icon: User, go: () => {} });

  const levelTitle = level === "brand" ? "ยอดตามแบรนด์" : level === "branch" ? "ยอดตามสาขา" : level === "person" ? "ยอดตามพนักงาน" : "บิลของพนักงาน";
  const scopeLabel = data?.scope === "all" ? "เห็นทุกแบรนด์/สาขา" : data?.scope === "own" ? "เฉพาะยอดของคุณ" : "ตามสาขาที่ดูแล";
  const bill = openBill ? scoped.find((r) => r.id === openBill) ?? null : null;

  return (
    <div className="space-y-4">
      {/* ── แถบตัวกรอง ── */}
      <section className="work-card p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-x-auto rounded-xl bg-surface2/70 p-0.5 gap-0.5 no-scrollbar">
            {PRESETS.map((p) => (
              <button key={p.k} onClick={() => applyPreset(p.k)}
                className={`h-8 px-3 rounded-lg text-xs whitespace-nowrap transition ${preset === p.k ? "bg-surface text-ink shadow-sm font-semibold" : "text-muted hover:text-ink"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-xl bg-surface2/70 px-2 h-9">
            <CalendarRange size={14} className="text-muted" />
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setCustom(e.target.value, to)} className="bg-transparent text-xs outline-none tnum" aria-label="ตั้งแต่วันที่" />
            <span className="text-muted text-xs">–</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setCustom(from, e.target.value)} className="bg-transparent text-xs outline-none tnum" aria-label="ถึงวันที่" />
          </div>
          <div className="flex items-center gap-1.5 rounded-xl bg-surface2/70 px-2 h-9">
            <Clock3 size={14} className="text-muted" />
            <select value={hourFrom} onChange={(e) => { const v = +e.target.value; setHourFrom(v); if (v > hourTo) setHourTo(v); }} className="bg-transparent text-xs outline-none tnum" aria-label="ตั้งแต่เวลา">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}:00</option>)}
            </select>
            <span className="text-muted text-xs">–</span>
            <select value={hourTo} onChange={(e) => { const v = +e.target.value; setHourTo(v); if (v < hourFrom) setHourFrom(v); }} className="bg-transparent text-xs outline-none tnum" aria-label="ถึงเวลา">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}:59</option>)}
            </select>
            {hourFiltered ? <button onClick={() => { setHourFrom(0); setHourTo(23); }} className="text-muted hover:text-ink" aria-label="ล้างช่วงเวลา"><X size={13} /></button> : null}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นสินค้า / SKU / เลขบิล" className="work-field !pl-9 w-full" />
          </div>
          <div className="inline-flex rounded-xl bg-surface2/70 p-0.5">
            {([["sales", "ยอดขาย"], ["orders", "บิล"], ["qty", "ชิ้น"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMetric(k)} className={`h-8 px-3 rounded-lg text-xs ${metric === k ? "bg-brand text-brandInk shadow-sm" : "text-muted hover:text-ink"}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => setTick((t) => t + 1)} className="h-9 w-9 grid place-items-center rounded-xl bg-surface2/70 text-muted hover:text-ink" aria-label="โหลดใหม่">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* breadcrumb + ขอบเขตสิทธิ์ */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap items-center gap-1 text-xs">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              const Icon = c.icon;
              return (
                <span key={i} className="flex items-center gap-1">
                  {i ? <ChevronRight size={13} className="text-muted/60" /> : null}
                  <button onClick={c.go} disabled={last}
                    className={`flex items-center gap-1 h-7 px-2.5 rounded-lg ${last ? "bg-brand/10 text-brand font-semibold" : "text-muted hover:bg-surface2 hover:text-ink"}`}>
                    <Icon size={12} /> {c.label}
                  </button>
                </span>
              );
            })}
          </nav>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck size={13} className="text-ok" /> {scopeLabel} · {thDate(from)}{from !== to ? ` – ${thDate(to)}` : ""}{hourFiltered ? ` · ${pad(hourFrom)}:00–${pad(hourTo)}:59` : ""}
          </span>
        </div>
      </section>

      {error ? <p role="alert" className="text-xs text-danger bg-danger/5 rounded-xl p-3">{error}</p> : null}
      {data?.truncated ? <p className="work-caption text-warn">ข้อมูลเกิน 20,000 บิล แสดงบางส่วน — กรุณาเลือกช่วงวันที่ให้แคบลง</p> : null}

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["ยอดขาย", formatTHB(kpi.sales), "รวม VAT · บิลปิดแล้ว", true],
          ["จำนวนบิล", kpi.orders.toLocaleString("th-TH"), "ไม่รวมบิลยกเลิก/คืนเต็ม", false],
          ["เฉลี่ยต่อบิล", formatTHB(kpi.avg), "ยอดขาย ÷ บิล", false],
          ["จำนวนชิ้น", kpi.qty.toLocaleString("th-TH"), "รวมของแถม", false],
        ].map(([l, v, h, hero]) => (
          <div key={l as string} className={`p-4 sm:p-5 rounded-[22px] ${hero ? "bg-brand text-brandInk shadow-sm" : "work-card"}`}>
            <p className={`text-[11px] ${hero ? "opacity-70" : "text-muted"}`}>{l}</p>
            <p className="text-2xl sm:text-[27px] font-semibold tracking-tight mt-2 tnum">{loading && !data ? "—" : v}</p>
            <p className={`text-[10px] mt-2 ${hero ? "opacity-60" : "text-muted"}`}>{h}</p>
          </div>
        ))}
      </div>

      {pending.length ? (
        <a href={admin ? "/admin/deferred-sales" : "/pos/deferred-sales"} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3 text-xs hover:bg-warn/12 transition">
          <span className="font-semibold text-warn">รอปิดบิล {pending.length} รายการ</span>
          <span className="text-muted">ยอดตกลง <b className="tnum text-ink">{formatTHB(pendingAgreed)}</b></span>
          <span className="text-muted">รับเงินแล้ว <b className="tnum text-ink">{formatTHB(pendingReceived)}</b></span>
          <span className="text-muted">· แสดงแยก ยังไม่รวมในยอดขายจนกว่าจะปิดบิล</span>
          <span className="ml-auto text-warn font-medium flex items-center gap-1">จัดการบิลรอปิด <ChevronRight size={13} /></span>
        </a>
      ) : null}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
        {/* ── ชั้นเจาะ ── */}
        <section className="work-card p-4 sm:p-5 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{levelTitle}</h2>
            <span className="work-caption">{level === "bills" ? `${scoped.length} บิล` : `${groups.length} รายการ · คลิกเพื่อดูลึกลงไป`}</span>
          </div>

          {loading && !data ? (
            <div className="grid sm:grid-cols-2 gap-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[86px] rounded-2xl bg-surface2/60 animate-pulse" />)}</div>
          ) : level === "bills" ? (
            <BillList rows={recent} branchName={branchName} onOpen={setOpenBill} />
          ) : groups.length ? (
            <div className="grid sm:grid-cols-2 gap-2">
              {groups.map((g, i) => {
                const share = total ? (g.value / total) * 100 : 0;
                const tone = level === "brand" ? (ref.brand.get(g.id)?.tone ?? PALETTE[i % PALETTE.length]) : PALETTE[i % PALETTE.length];
                const label = level === "brand" ? brandName(g.id) : level === "branch" ? branchName(g.id) : personName(g.id);
                const sub = level === "branch" ? (ref.branch.get(g.id)?.province ?? "") : level === "brand" ? `${new Set(g.rows.map((r) => r.branch_id)).size} สาขา` : `${new Set(g.rows.map((r) => r.day)).size} วันที่ขาย`;
                const p = level === "person" && g.id !== NONE ? ref.person.get(g.id) : null;
                return (
                  <button key={g.id} onClick={() => drill(g.id)}
                    className="group text-left rounded-2xl border border-line/80 bg-surface/60 hover:bg-surface hover:border-brand/40 hover:shadow-sm p-3.5 transition">
                    <div className="flex items-center gap-2.5">
                      {level === "person" ? (
                        <Avatar name={label} src={p?.photo_url ?? undefined} size={30} />
                      ) : (
                        <span className="h-8 w-8 rounded-xl grid place-items-center text-white text-xs font-bold shrink-0" style={{ background: tone }}>
                          {level === "brand" ? <Tag size={14} /> : <Store size={14} />}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{label}</p>
                        <p className="text-[11px] text-muted truncate">{sub}</p>
                      </div>
                      <span className="text-[10px] text-muted tnum">#{i + 1}</span>
                      <ChevronRight size={15} className="text-muted/50 group-hover:text-brand group-hover:translate-x-0.5 transition" />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <p className="text-lg font-semibold tnum tracking-tight">{fmt(g.value)}</p>
                      <p className="text-[11px] text-muted tnum">{g.orders} บิล · {share.toFixed(1)}%</p>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, share)}%`, background: tone }} />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty />
          )}
        </section>

        {/* ── ช่วงเวลาที่ขาย ── */}
        <section className="work-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><Clock3 size={14} /> ขายช่วงเวลาไหน</h2>
            {hourFiltered ? <button onClick={() => { setHourFrom(0); setHourTo(23); }} className="text-[11px] text-brand">ล้าง</button> : null}
          </div>
          <p className="work-caption mb-3">คลิกแท่งเพื่อกรองชั่วโมงนั้น</p>
          <div className="flex items-end gap-[3px] h-36">
            {hours.map(({ h, value }) => {
              const on = h >= hourFrom && h <= hourTo;
              return (
                <button key={h} title={`${pad(h)}:00–${pad(h)}:59 · ${fmt(value)}`}
                  onClick={() => { if (hourFrom === h && hourTo === h) { setHourFrom(0); setHourTo(23); } else { setHourFrom(h); setHourTo(h); } }}
                  className="flex-1 h-full flex flex-col justify-end group">
                  <span className={`w-full rounded-t-[4px] transition-all ${on ? "bg-brand group-hover:bg-brand/80" : "bg-line group-hover:bg-muted/40"}`}
                    style={{ height: `${value ? Math.max(4, (value / hourMax) * 100) : 2}%` }} />
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted tnum mt-1.5">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
          {(() => {
            const peak = hours.reduce((a, b) => (b.value > a.value ? b : a), hours[0]);
            return peak && peak.value ? (
              <p className="text-xs mt-3 rounded-xl bg-surface2/70 px-3 py-2">
                ช่วงขายดีสุด <b className="tnum">{pad(peak.h)}:00–{pad(peak.h)}:59</b> · {fmt(peak.value)}
              </p>
            ) : null;
          })()}
        </section>
      </div>

      {/* ── ปฏิทินรายวัน ── */}
      <section className="work-card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5"><CalendarRange size={14} /> ยอดรายวัน</h2>
          <span className="work-caption">คลิกวันเพื่อดูเฉพาะวันนั้น</span>
        </div>
        {days.length <= 45 ? (
          <div className="grid grid-cols-7 gap-1.5">
            {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => <p key={d} className="text-[10px] text-muted text-center pb-1">{d}</p>)}
            {Array.from({ length: (new Date(from + "T00:00:00Z").getUTCDay() + 6) % 7 }, (_, i) => <span key={"b" + i} />)}
            {days.map((d) => {
              const a = d.value / dayMax;
              const isToday = d.day === todayBkk();
              return (
                <button key={d.day} onClick={() => { setPreset("custom"); setRange([d.day, d.day]); }}
                  title={`${thDate(d.day, { day: "numeric", month: "long" })} · ${fmt(d.value)}`}
                  className={`h-14 sm:h-[62px] rounded-xl p-1.5 sm:p-2 text-left border transition hover:-translate-y-0.5 ${isToday ? "border-brand" : "border-transparent"}`}
                  style={{ background: d.value ? `rgb(var(--c-brand) / ${(0.1 + a * 0.75).toFixed(3)})` : "rgb(var(--c-surface-2) / 0.7)", color: a > 0.55 ? "#fff" : undefined }}>
                  <p className="text-[10px] opacity-70 tnum">{+d.day.slice(8)}</p>
                  <p className="text-[11px] sm:text-xs font-semibold tnum truncate">{d.value ? (metric === "sales" ? formatCompact(d.value) : d.value) : ""}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <MonthBars days={days} fmt={fmt} onPick={(m) => {
            const end = addDays(addDays(m + "-28", 4).slice(0, 8) + "01", -1); // วันสุดท้ายของเดือน
            setPreset("custom");
            setRange([m + "-01" < from ? from : m + "-01", end > to ? to : end]);
          }} />
        )}
      </section>

      {/* ── สินค้า + บิลล่าสุด ── */}
      <div className="grid xl:grid-cols-2 gap-4">
        <section className="work-card p-4 sm:p-5 min-w-0">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Package size={14} /> สินค้าที่ขายได้</h2>
          {products.length ? (
            <ol className="space-y-1.5">
              {products.map((p, i) => (
                <li key={p.sku} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface2/60">
                  <span className="text-[11px] text-muted tnum w-5">{pad(i + 1)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{p.name}</p>
                    <p className="text-[10px] text-muted tnum">{p.sku}</p>
                  </div>
                  <span className="text-[11px] text-muted tnum">{p.qty.toLocaleString("th-TH")} ชิ้น</span>
                  <span className="text-xs font-semibold tnum w-24 text-right">{formatTHB(p.total)}</span>
                </li>
              ))}
            </ol>
          ) : <Empty />}
        </section>
        <section className="work-card p-4 sm:p-5 min-w-0">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Receipt size={14} /> บิลล่าสุด · ขายอะไรไปบ้าง</h2>
          {recent.length ? <BillList rows={recent.slice(0, 12)} branchName={branchName} personName={personName} onOpen={setOpenBill} /> : <Empty />}
        </section>
      </div>

      <p className="work-caption">อัปเดตทุก 1 นาที · ยอดรวม VAT ตามบิลปิด · ไม่รวมบิลยกเลิกและคืนเต็ม · ยังไม่หักคืนบางส่วน · เวลาไทย (UTC+7)</p>

      {/* ── รายละเอียดบิล ── */}
      {bill ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setOpenBill(null)} aria-label="ปิด" />
          <aside className="relative w-full max-w-md h-full bg-surface shadow-2xl p-5 overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="work-caption">บิล</p>
                <h3 className="text-lg font-semibold tnum">{bill.no}</h3>
                <p className="text-xs text-muted mt-0.5">
                  {thDate(bill.day, { weekday: "short", day: "numeric", month: "long", year: "numeric" })} · {pad(bill.hour)}:{pad(bkk(bill.at).getUTCMinutes())} น.
                </p>
              </div>
              <button onClick={() => setOpenBill(null)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2" aria-label="ปิด"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs mb-4">
              <div className="rounded-xl bg-surface2/70 p-3"><p className="text-muted text-[10px]">สาขา</p><p className="font-medium truncate">{branchName(bill.branch_id)}</p></div>
              <div className="rounded-xl bg-surface2/70 p-3"><p className="text-muted text-[10px]">พนักงาน</p><p className="font-medium truncate">{personName(bill.person_id ?? NONE)}</p></div>
            </div>
            <ul className="divide-y divide-line">
              {bill.items.map((it, i) => (
                <li key={i} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{it.name}{it.gift ? <span className="ml-1.5 text-[10px] text-ok">แถม</span> : null}</p>
                    <p className="text-[10px] text-muted tnum">{it.sku} · ×{it.qty}</p>
                  </div>
                  <span className="text-sm tnum">{formatTHB(it.total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between mt-4 pt-3 border-t border-line text-sm font-semibold"><span>รวม</span><span className="tnum">{formatTHB(bill.total)}</span></div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function BillList({ rows, branchName, personName, onOpen }: { rows: Row[]; branchName: (id: string) => string; personName?: (id: string) => string; onOpen: (id: string) => void }) {
  if (!rows.length) return <Empty />;
  return (
    <ul className="divide-y divide-line/70">
      {rows.map((r) => {
        const t = bkk(r.at);
        const first = r.items[0]?.name ?? "—";
        return (
          <li key={r.id}>
            <button onClick={() => onOpen(r.id)} className="w-full flex items-center gap-3 py-2.5 px-1 text-left hover:bg-surface2/50 rounded-lg">
              <div className="w-12 shrink-0 text-center">
                <p className="text-xs font-semibold tnum">{pad(t.getUTCHours())}:{pad(t.getUTCMinutes())}</p>
                <p className="text-[9px] text-muted tnum">{+r.day.slice(8)}/{+r.day.slice(5, 7)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{first}{r.items.length > 1 ? <span className="text-muted"> +{r.items.length - 1}</span> : null}</p>
                <p className="text-[10px] text-muted truncate">{r.no} · {branchName(r.branch_id)}{personName ? ` · ${personName(r.person_id ?? NONE)}` : ""}</p>
              </div>
              <span className="text-xs font-semibold tnum">{formatTHB(r.total)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MonthBars({ days, fmt, onPick }: { days: { day: string; value: number }[]; fmt: (v: number) => string; onPick: (ym: string) => void }) {
  const m = new Map<string, number>();
  for (const d of days) m.set(d.day.slice(0, 7), (m.get(d.day.slice(0, 7)) ?? 0) + d.value);
  const arr = [...m.entries()];
  const max = Math.max(1, ...arr.map(([, v]) => v));
  return (
    <div className="flex items-end gap-2 h-44">
      {arr.map(([ym, v]) => (
        <button key={ym} onClick={() => onPick(ym)} title={fmt(v)} className="flex-1 h-full flex flex-col justify-end items-center gap-1 group">
          <span className="text-[10px] text-muted tnum opacity-0 group-hover:opacity-100">{fmt(v)}</span>
          <span className="w-full rounded-t-lg bg-brand/80 group-hover:bg-brand transition-all" style={{ height: `${v ? Math.max(3, (v / max) * 100) : 1}%` }} />
          <span className="text-[10px] text-muted">{new Date(ym + "-15T12:00:00+07:00").toLocaleDateString("th-TH", { month: "short" })}</span>
        </button>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="py-10 text-center">
      <Receipt size={22} className="mx-auto text-muted/40" />
      <p className="text-xs text-muted mt-2">ยังไม่มียอดขายในช่วงนี้</p>
    </div>
  );
}
