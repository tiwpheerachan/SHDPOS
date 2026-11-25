"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Clock, ChevronRight, Crown, Users, LayoutDashboard, Table as TableIcon, Network, Briefcase, TrendingUp, Receipt, Award, BadgeCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { loadAllPositions } from "@/lib/data/org";
import type { Branch, Brand, Employee, Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, EmptyState, KpiTile, Avatar, Segmented } from "@/components/ui";
import { ExportShareBar } from "@/components/admin/export-share";
import { BarList, AreaChart, SERIES_COLORS } from "@/components/charts";
import { byEmployee, summarize, salesSeries, lineNet, type TimeGran } from "@/lib/analytics";
import { formatTHB, formatInt } from "@/lib/money";
import { ROLE_LABEL, can } from "@/lib/permissions";
import { positionLabel, positionLevel, type Locale } from "@/lib/positions";
import { isCountedSale, saleAt } from "@/lib/sales-basis";
import { AnimatedGradient, type GradientConfig } from "@/components/ui/animated-gradient";
import { OrderTraceDrawer } from "@/components/order-trace";

// พื้นหลังไล่สีเคลื่อนไหว โทนม่วงของระบบ (#7950D8)
const GRAD: GradientConfig = { preset: "custom", color1: "#100828", color2: "#35206e", color3: "#8f6cf0", rotation: -30, proportion: 42, scale: 0.42, speed: 10, distortion: 22, swirl: 60, swirlIterations: 10, softness: 100, offset: 180, shape: "Checks", shapeSize: 32 };
const FALLBACK_BG = "linear-gradient(135deg,#120a2a 0%,#2a1a5c 55%,#5b3fb8 100%)";
/** แยกชื่อกับตำแหน่งในวงเล็บ: "Tiw - Pheerachan (Senior …)" → ["Tiw - Pheerachan", "Senior …"] */
function splitName(label: string): [string, string] {
  const m = label.match(/^(.*?)\s*\((.+)\)\s*$/);
  return m ? [m[1], m[2]] : [label, ""];
}

type View = "dashboard" | "table" | "person" | "position";

/** ผลงานพนักงาน (แดชบอร์ด/ตาราง/รายบุคคล/ตามตำแหน่ง) — ฝังในหน้ายอดขาย ใช้ข้อมูล+ตัวกรองชุดเดียวกับหน้ายอดขาย */
export function StaffPerformance({ filtered, employees, branches, brands, initialPerson }: { filtered: Order[]; employees: Employee[]; branches: Branch[]; brands: Brand[]; initialPerson?: string | null }) {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee } = useSession();
  // ── สถานะอยู่ใน URL: ?sv=dashboard|table|position (มุมมองหลัก) + ?person=<id> (เจาะดูรายคน ซ้อนบนมุมมองหลัก)
  //    → ปุ่มย้อนกลับของเบราว์เซอร์/ลิงก์แชร์ พากลับมาที่เดิมได้ถูกต้อง
  const router = useRouter(), pathname = usePathname(), sp = useSearchParams();
  const svRaw = sp.get("sv") as View | null;
  const baseView: Exclude<View, "person"> = svRaw === "table" || svRaw === "position" ? svRaw : "dashboard";
  const personId = sp.get("person");
  const view: View = personId ? "person" : baseView;
  const pushedRef = useRef(false);
  const nav = (patch: Record<string, string | null>, push: boolean) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) u.set(k, v); else u.delete(k); }
    if (u.get("sv") === "dashboard") u.delete("sv");
    router[push ? "push" : "replace"](`${pathname}?${u}`, { scroll: false });
  };
  const setView = (v: View) => nav({ sv: v === "person" ? baseView : v, person: null }, false);
  const openPerson = (id: string, from?: Exclude<View, "person">) => { if (!personId) pushedRef.current = true; nav({ person: id, ...(from ? { sv: from } : {}) }, !personId); };
  const closePerson = () => { if (pushedRef.current) { pushedRef.current = false; router.back(); } else nav({ person: null }, false); };
  const [gran, setGran] = useState<TimeGran>("day");
  const [allPos, setAllPos] = useState<{ branch_id: string; employee_id: string; title: string }[]>([]);
  const [posCode, setPosCode] = useState<string | null>(null);

  useEffect(() => { void loadAllPositions().then(setAllPos); }, []);
  void initialPerson; // อ่านจาก URL โดยตรงแล้ว

  const rows = useMemo(() => {
    const list = byEmployee(filtered, employees);
    if (employee?.data_scope === "own") return list.filter((r) => r.id === employee.id);
    return list;
  }, [filtered, employees, employee]);

  const totals = useMemo(() => summarize(filtered), [filtered]);
  const showGp = can(employee, "report.gross_profit");
  const best = rows[0];

  const branchName = (id: string | null) => {
    const b = branches.find((x) => x.id === id);
    return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—";
  };
  const empPhoto = (id: string) => employees.find((x) => x.id === id)?.photo_url ?? null;
  const empRole = (id: string) => { const e = employees.find((x) => x.id === id); return e ? ROLE_LABEL[e.role][locale] : ""; };

  // กราฟรวม + รายบุคคล
  const overallSeries = useMemo(() => salesSeries(filtered, gran), [filtered, gran]);
  // ค่าเริ่มต้น = ตัวเอง (ถ้ามีข้อมูลขายของตัวเอง) ไม่งั้นคนยอดสูงสุด
  const selfId = employee && rows.some((r) => r.id === employee.id) ? employee.id : null;
  const activePerson = personId ?? selfId ?? best?.id ?? null; // ในมุมมองรายบุคคล personId มีค่าเสมอ
  const personRow = rows.find((r) => r.id === activePerson) ?? null;
  const personSeries = useMemo(
    () => (activePerson ? salesSeries(filtered, gran, activePerson) : []),
    [filtered, gran, activePerson]
  );
  // สินค้าที่คนนี้ขายดีสุด (ข้อมูลจริงจากบิล) — attribution ตาม salesperson/cashier เหมือน byEmployee
  const personTop = useMemo(() => {
    if (!activePerson) return [] as { name: string; qty: number; gross: number }[];
    const m = new Map<string, { name: string; qty: number; gross: number }>();
    for (const o of filtered) {
      if (!isCountedSale(o)) continue;
      for (const it of o.items) {
        const eid = it.salesperson_id ?? o.salesperson_id ?? o.cashier_id;
        if (eid !== activePerson) continue;
        const cur = m.get(it.name) ?? { name: it.name, qty: 0, gross: 0 };
        cur.qty += it.qty; cur.gross += lineNet(o, it).net;
        m.set(it.name, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.gross - a.gross).slice(0, 8);
  }, [filtered, activePerson]);
  // บิลของคนนี้ (ใหม่สุดก่อน) + ยอดรายชั่วโมง (เวลาไทย)
  const personOrders = useMemo(() => activePerson ? filtered.filter((o) => isCountedSale(o) && o.items.some((it) => (it.salesperson_id ?? o.salesperson_id ?? o.cashier_id) === activePerson)).sort((a, b) => saleAt(b).localeCompare(saleAt(a))) : [], [filtered, activePerson]);
  const personHours = useMemo(() => hourTotals(personOrders, activePerson), [personOrders, activePerson]);
  const teamHours = useMemo(() => hourTotals(filtered), [filtered]);
  const [traceBill, setTraceBill] = useState<Order | null>(null);
  const personRank = activePerson ? rows.findIndex((r) => r.id === activePerson) + 1 : 0;
  const teamSharePct = totals.gross > 0 && personRow ? (personRow.value / totals.gross) * 100 : 0;


  const granOptions: { value: TimeGran; label: string }[] = [
    { value: "day", label: L("รายวัน", "Daily", "每日") },
    { value: "month", label: L("รายเดือน", "Monthly", "每月") },
    { value: "year", label: L("รายปี", "Yearly", "每年") },
  ];

  // ── เทียบ performance ตามตำแหน่ง ──
  const posLabel = (code: string) => positionLabel(code, locale as Locale);
  const brandName = (id: string) => brands.find((x) => x.id === id)?.name ?? "—";
  const empBestPos = useMemo(() => {
    const m = new Map<string, { code: string; branchId: string }>();
    for (const p of allPos) {
      if (!p.title) continue;
      const cur = m.get(p.employee_id);
      if (!cur || positionLevel(p.title) > positionLevel(cur.code)) m.set(p.employee_id, { code: p.title, branchId: p.branch_id });
    }
    return m;
  }, [allPos]);
  const posPeople = useMemo(() => {
    const salesById = new Map(rows.map((r) => [r.id, r]));
    const list: { id: string; label: string; code: string; branchId: string; brandId: string; value: number; orders: number; grossProfit: number }[] = [];
    for (const [empId, pos] of empBestPos) {
      const s = salesById.get(empId);
      const e = employees.find((x) => x.id === empId);
      const brandId = branches.find((b) => b.id === pos.branchId)?.brand_id ?? "";
      list.push({ id: empId, label: e ? (e.nickname ?? e.first_name) : empId, code: pos.code, branchId: pos.branchId, brandId, value: s?.value ?? 0, orders: s?.orders ?? 0, grossProfit: s?.grossProfit ?? 0 });
    }
    return list;
  }, [empBestPos, rows, employees, branches]);
  const positionAgg = useMemo(() => {
    const m = new Map<string, { code: string; people: number; total: number; orders: number }>();
    for (const p of posPeople) {
      const cur = m.get(p.code) ?? { code: p.code, people: 0, total: 0, orders: 0 };
      cur.people += 1; cur.total += p.value; cur.orders += p.orders;
      m.set(p.code, cur);
    }
    return [...m.values()].map((x) => ({ ...x, avg: x.people ? x.total / x.people : 0 })).sort((a, b) => b.total - a.total);
  }, [posPeople]);
  const activePos = posCode ?? positionAgg[0]?.code ?? null;
  const activePeople = posPeople.filter((p) => p.code === activePos).sort((a, b) => b.value - a.value);
  const activeAgg = positionAgg.find((x) => x.code === activePos) ?? null;
  const personPosCode = activePerson ? empBestPos.get(activePerson)?.code ?? null : null;

  return (
    <div className="space-y-4">
      {/* แถบสลับมุมมอง + ลิงก์ผังองค์กร */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<View>
          size="sm"
          value={baseView}
          onChange={setView}
          options={[
            { value: "dashboard", label: <span className="inline-flex items-center gap-1.5"><LayoutDashboard size={14} /> {L("แดชบอร์ด", "Dashboard", "仪表盘")}</span> },
            { value: "table", label: <span className="inline-flex items-center gap-1.5"><TableIcon size={14} /> {L("ตาราง", "Table", "表格")}</span> },
            { value: "position", label: <span className="inline-flex items-center gap-1.5"><Briefcase size={14} /> {L("ตามตำแหน่ง", "By position", "按职位")}</span> },
          ]}
        />
        <Link href="/admin/org" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line bg-surface hover:bg-surface2 text-sm font-medium text-ink transition-colors">
          <Network size={15} className="text-brand" /> {L("ผังองค์กร", "Org chart", "组织架构")}
        </Link>
      </div>

      {/* KPI รวม — ภาพรวมทีม (ไม่แสดงในมุมมองรายบุคคล) */}
      {view !== "person" ? (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t.admin.employees} value={formatInt(rows.length)} icon={<Users size={15} />} />
        <KpiTile label={t.admin.gmv} value={formatTHB(totals.gross)} tone="brand" />
        <KpiTile label={t.admin.avgBasket} value={formatTHB(totals.avgBasket)} />
        <button disabled={!best} onClick={() => { if (best) openPerson(best.id); }}
          className="relative overflow-hidden rounded-2xl text-left text-white min-h-[84px] shadow-card group disabled:cursor-default" style={{ background: FALLBACK_BG }}>
          <AnimatedGradient config={GRAD} noise={{ opacity: 0.25 }} />
          <div className="relative z-10 p-3.5 flex items-center gap-3 h-full">
            {best ? <span className="rounded-full ring-2 ring-white/40 shrink-0"><Avatar name={best.label} src={empPhoto(best.id)} size={40} /></span> : null}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-white/70 inline-flex items-center gap-1"><Crown size={12} className="text-amber-300" />{t.admin.topEmployees}</p>
              <p className="text-sm font-semibold truncate leading-tight mt-0.5">{best ? splitName(best.label)[0] : "—"}</p>
              {best && splitName(best.label)[1] ? <p className="text-[10.5px] text-white/60 truncate">{splitName(best.label)[1]}</p> : null}
            </div>
            {best ? <p className="text-sm font-bold tnum shrink-0">{formatTHB(best.value, false)}</p> : null}
          </div>
        </button>
      </div>
      ) : null}

      {/* ============ DASHBOARD ============ */}
      {view === "dashboard" ? (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-0">
              <div>
                <p className="text-sm font-semibold">{L("แนวโน้มยอดขายทีม", "Team sales trend", "团队销售趋势")}</p>
                <p className="text-[11px] text-muted">{L("รวมทุกคนในขอบเขตที่เลือก", "All staff in current scope", "当前范围内全部员工")}</p>
              </div>
              <Segmented<TimeGran> size="sm" value={gran} onChange={setGran} options={granOptions} />
            </div>
            <div className="p-4 pt-3">
              {overallSeries.length >= 2 ? (
                <AreaChart data={overallSeries} height={220} valueFormat={(n) => formatTHB(n, false)} />
              ) : overallSeries.length ? <><p className="text-[11px] text-muted -mt-1 mb-2">{L("ข้อมูลมีวันเดียว — แสดงรายชั่วโมง", "Single day — hourly view", "仅一天数据 — 按小时")}</p><HourBars hours={teamHours} height={200} /></> : <EmptyState title={t.common.empty} />}
            </div>
          </Card>

          <div className="grid lg:grid-cols-[1fr_360px] gap-4">
            <Card>
              <CardHeader title={t.admin.topEmployees} subtitle={L("จัดอันดับตามยอดขาย", "Ranked by sales", "按销售额排名")} />
              <div className="p-3 space-y-1">
                {rows.length ? rows.slice(0, 15).map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => openPerson(r.id)}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-surface2 transition-colors text-left"
                  >
                    <span className="w-5 text-center text-[11px] font-bold text-muted shrink-0">{i + 1}</span>
                    <Avatar name={r.label} src={empPhoto(r.id)} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{splitName(r.label)[0]}</p>
                      <p className="text-[10px] text-muted truncate">{[splitName(r.label)[1], empRole(r.id), r.branchId ? branchName(r.branchId) : ""].filter((x) => x && x !== "—").join(" · ")}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold tnum">{formatTHB(r.value, false)}</p>
                      <p className="text-[10px] text-muted tnum">{r.orders} {t.admin.orderCount}</p>
                    </div>
                  </button>
                )) : <EmptyState title={t.common.empty} />}
              </div>
            </Card>

            <Card>
              <CardHeader title={t.admin.gmv} subtitle={L("สัดส่วนรายคน", "Share by person", "各员工占比")} />
              <div className="p-5 pt-3">
                <BarList data={rows.slice(0, 12).map((r) => ({ label: splitName(r.label)[0], value: r.value, sub: `${r.orders} ${t.admin.orderCount}` }))} />
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ============ TABLE (เดิม + avatar) ============ */}
      {view === "table" ? (
        <Card>
          <CardHeader title={t.admin.topEmployees} subtitle={L("ยอดขายแยกรายคน — รวมกรณีเข้ากะพร้อมกันหลายคน", "Sales by individual — combined when several share a shift", "按个人销售额 — 多人同班时合并计算")}
            right={<ExportShareBar<(typeof rows)[number]>
              filename="employees-sales" title={t.admin.topEmployees} rows={rows} size="sm"
              columns={[
                { key: "label", label: t.common.employee },
                { key: "code", label: L("รหัส", "Code", "工号") },
                { key: "branch", label: t.common.branch, map: (r) => branchName(r.branchId) },
                { key: "value", label: t.admin.gmv, map: (r) => formatTHB(r.value, false) },
                { key: "orders", label: t.admin.orderCount },
                { key: "units", label: t.admin.unitsSold },
                { key: "avgBasket", label: t.admin.avgBasket, map: (r) => formatTHB(r.avgBasket, false) },
                ...(showGp ? [{ key: "grossProfit", label: t.admin.grossProfit, map: (r: (typeof rows)[number]) => formatTHB(r.grossProfit, false) }] : []),
              ]}
            />} />
          {rows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{t.common.employee}</Th>
                  <Th>{t.common.branch}</Th>
                  <Th align="right">{t.admin.gmv}</Th>
                  <Th align="right">{t.admin.orderCount}</Th>
                  <Th align="right">{t.admin.unitsSold}</Th>
                  <Th align="right">{t.admin.avgBasket}</Th>
                  {showGp ? <Th align="right">{t.admin.grossProfit}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} title={L("กดเพื่อเปิดแดชบอร์ดรายบุคคล", "Open individual dashboard", "打开个人仪表盘")} className="group hover:bg-brand/[0.045] cursor-pointer" onClick={() => openPerson(r.id)}>
                    <Td>
                      <span className="w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold text-white" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}>{i + 1}</span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.label} src={empPhoto(r.id)} size={30} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate group-hover:text-brand">{splitName(r.label)[0]}</p>
                          <p className="text-[10px] text-muted truncate">{[splitName(r.label)[1], r.code && !r.code.includes("@") ? r.code : "", empRole(r.id)].filter(Boolean).join(" · ")}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-xs text-muted truncate max-w-[160px]">{branchName(r.branchId)}</Td>
                    <Td align="right" className="font-medium">{formatTHB(r.value, false)}</Td>
                    <Td align="right" className="text-xs">{r.orders}</Td>
                    <Td align="right" className="text-xs">{formatInt(r.units)}</Td>
                    <Td align="right" className="text-xs text-muted">{formatTHB(r.avgBasket, false)}</Td>
                    {showGp ? <Td align="right" className="text-xs text-ok">{formatTHB(r.grossProfit, false)}</Td> : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState title={t.common.empty} />}
        </Card>
      ) : null}

      {/* ============ PERSON (แดชบอร์ดพนักงาน — ข้อมูลจริงทั้งหมด) ============ */}
      {view === "person" ? (
        personId && personRow ? (() => {
          const [nm, sub] = splitName(personRow.label);
          const teamAvg = rows.length ? totals.gross / rows.length : 0;
          const vsAvg = teamAvg ? ((personRow.value - teamAvg) / teamAvg) * 100 : 0;
          const peakH = personHours.indexOf(Math.max(...personHours));
          const useHourly = personSeries.length < 2;
          const idx = rows.findIndex((r) => r.id === activePerson);
          const prevP = idx > 0 ? rows[idx - 1] : null, nextP = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
          const fromLabel = baseView === "table" ? L("ตาราง", "Table", "表格") : baseView === "position" ? L("ตามตำแหน่ง", "By position", "按职位") : L("แดชบอร์ด", "Dashboard", "仪表盘");
          return (
            <div className="space-y-3">
              {/* ── แถบนำทาง: ย้อนกลับ · เส้นทาง · คนก่อน/ถัดไป ── */}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={closePerson} className="h-8 pl-2 pr-3 rounded-lg border border-line bg-surface hover:bg-surface2 text-xs font-medium inline-flex items-center gap-1"><ChevronLeft size={14} />{L("กลับ", "Back", "返回")}</button>
                <nav className="text-xs text-muted flex items-center gap-1.5 min-w-0">
                  <button onClick={closePerson} className="hover:text-ink">{L("ผลงานพนักงาน", "Staff performance", "员工业绩")}</button><ChevronRight size={12} />
                  <button onClick={closePerson} className="hover:text-ink">{fromLabel}</button><ChevronRight size={12} />
                  <span className="text-ink font-medium truncate">{nm}</span>
                </nav>
                <div className="ml-auto flex items-center gap-1">
                  <span className="text-[11px] text-muted tnum mr-1">{idx + 1} / {rows.length}</span>
                  <button disabled={!prevP} onClick={() => prevP && openPerson(prevP.id)} title={prevP ? splitName(prevP.label)[0] : ""} className="h-8 w-8 rounded-lg border border-line bg-surface hover:bg-surface2 grid place-items-center disabled:opacity-35"><ChevronLeft size={14} /></button>
                  <button disabled={!nextP} onClick={() => nextP && openPerson(nextP.id)} title={nextP ? splitName(nextP.label)[0] : ""} className="h-8 w-8 rounded-lg border border-line bg-surface hover:bg-surface2 grid place-items-center disabled:opacity-35"><ChevronRight size={14} /></button>
                </div>
              </div>
              {/* ── โปรไฟล์ (การ์ดพื้นหลังเคลื่อนไหว) + สถิติ (การ์ดเรียบ) — กะทัดรัด ── */}
              <div className="grid lg:grid-cols-[300px_1fr] gap-3">
                <div className="relative overflow-hidden rounded-2xl text-white shadow-card" style={{ background: FALLBACK_BG }}>
                  <AnimatedGradient config={GRAD} noise={{ opacity: 0.3 }} />
                  <div className="relative z-10 p-4 h-full flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <span className="rounded-full ring-2 ring-white/35 shrink-0"><Avatar name={personRow.label} src={activePerson ? empPhoto(activePerson) : null} size={48} /></span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[15px] font-semibold leading-tight truncate">{nm}</h2>
                        <p className="text-[11px] text-white/70 truncate">{sub || empRole(activePerson ?? "")}</p>
                      </div>

                    </div>
                    <p className="text-[11px] text-white/60 truncate">{[empRole(activePerson ?? ""), personPosCode ? posLabel(personPosCode) : "", personRow.branchId ? branchName(personRow.branchId) : ""].filter((x) => x && x !== "—").join(" · ")}</p>
                    <div className="flex flex-wrap gap-1.5 mt-auto">
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/12 border border-white/15 text-[11px]"><Award size={12} className="text-amber-300" />#{personRank} / {rows.length}</span>
                      {peakH >= 0 && personHours[peakH] ? <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/12 border border-white/15 text-[11px]"><Clock size={12} />{L("ขายดี", "Peak", "高峰")} {String(peakH).padStart(2, "0")}:00</span> : null}
                      {personRow.code && !personRow.code.includes("@") ? <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/12 border border-white/15 text-[11px] font-mono"><BadgeCheck size={12} />{personRow.code}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    { icon: <TrendingUp size={14} />, label: t.admin.gmv, value: formatTHB(personRow.value, false), hint: `${teamSharePct.toFixed(1)}% ${L("ของทีม", "of team", "团队")}`, strong: true },
                    { icon: <Receipt size={14} />, label: t.admin.orderCount, value: formatInt(personRow.orders), hint: `${formatInt(personRow.units)} ${t.admin.unitsSold}` },
                    { icon: <Users size={14} />, label: t.admin.avgBasket, value: formatTHB(personRow.avgBasket, false), hint: `${L("ทีมเฉลี่ย", "Team", "团队")} ${formatTHB(totals.avgBasket, false)}` },
                    showGp ? { icon: <Award size={14} />, label: t.admin.grossProfit, value: formatTHB(personRow.grossProfit, false), hint: personRow.value ? `GP ${((personRow.grossProfit / (personRow.value / 1.07)) * 100).toFixed(1)}%` : "—" }
                      : { icon: <Award size={14} />, label: L("เทียบค่าเฉลี่ยทีม", "vs team avg", "对比团队平均"), value: `${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(0)}%`, hint: `${L("เฉลี่ย", "avg", "平均")} ${formatTHB(teamAvg, false)}` },
                  ].map((k) => (
                    <div key={k.label} className="card px-3.5 py-3 min-w-0 flex flex-col justify-between">
                      <p className="text-[11px] text-muted inline-flex items-center gap-1.5 truncate"><span className="text-brand">{k.icon}</span>{k.label}</p>
                      <p className={`text-lg font-semibold tnum leading-tight mt-1.5 truncate ${k.strong ? "text-brand" : ""}`}>{k.value}</p>
                      <p className="text-[10.5px] text-muted truncate mt-0.5">{k.hint}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── แนวโน้ม + ตำแหน่งในทีม ── */}
              <div className="grid lg:grid-cols-3 gap-4">
                <Card className="lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-0">
                    <div>
                      <p className="text-sm font-semibold inline-flex items-center gap-1.5"><TrendingUp size={14} className="text-brand" />{useHourly ? L("ยอดขายรายชั่วโมง", "Sales by hour", "按小时销售") : L("แนวโน้มผลงาน", "Performance trend", "业绩趋势")}</p>
                      <p className="text-[11px] text-muted">{useHourly ? L("ข้อมูลมีวันเดียว จึงแสดงรายชั่วโมงแทน", "Single day of data — showing hourly", "仅一天数据，按小时显示") : granOptions.find((g) => g.value === gran)?.label}</p>
                    </div>
                    {!useHourly ? <Segmented<TimeGran> size="sm" value={gran} onChange={setGran} options={granOptions} /> : null}
                  </div>
                  <div className="p-4 pt-3">
                    {useHourly ? <HourBars hours={personHours} height={170} /> : <AreaChart data={personSeries} height={180} color={SERIES_COLORS[1]} valueFormat={(n) => formatTHB(n, false)} />}
                  </div>
                </Card>
                <Card>
                  <CardHeader title={L("ตำแหน่งในทีม", "Standing in team", "团队位置")} subtitle={L("สัดส่วนยอดขาย และเทียบค่าเฉลี่ย", "Share and vs average", "占比与平均对比")} />
                  <div className="p-4 pt-1 space-y-4">
                    <div className="flex items-center gap-4">
                      <Radial pct={teamSharePct} label={L("ของทีม", "of team", "团队")} />
                      <div className="text-xs space-y-1 min-w-0">
                        <p className="text-muted">{L("ยอดคนนี้", "This person", "此员工")}</p><p className="font-semibold tnum">{formatTHB(personRow.value, false)}</p>
                        <p className="text-muted pt-1">{L("ทั้งทีม", "Team total", "团队合计")}</p><p className="font-semibold tnum">{formatTHB(totals.gross, false)}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {rows.slice(0, 5).map((r, i) => (
                        <button key={r.id} onClick={() => openPerson(r.id)} className={`w-full flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 text-left ${r.id === activePerson ? "bg-brand/8 text-brand font-medium" : "hover:bg-surface2"}`}>
                          <span className="w-4 text-center text-[10px] text-muted">{i + 1}</span>
                          <span className="flex-1 truncate">{splitName(r.label)[0]}</span>
                          <span className="w-16 h-1.5 rounded-full bg-surface2 overflow-hidden"><span className="block h-full bg-brand/70 rounded-full" style={{ width: `${(r.value / (rows[0]?.value || 1)) * 100}%` }} /></span>
                          <span className="tnum w-20 text-right">{formatTHB(r.value, false)}</span>
                        </button>
                      ))}
                      {personRank > 5 ? <p className="text-[11px] text-muted px-1.5">… {L("คนนี้อยู่อันดับ", "this person is #", "此员工排名")} {personRank}</p> : null}
                    </div>
                  </div>
                </Card>
              </div>

              {/* ── สินค้าขายดี + บิลล่าสุด ── */}
              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader title={L("สินค้าขายดีของคนนี้", "Top products", "畅销商品")} subtitle={L("ตามยอดขายจริง", "By real sales", "按实际销售额")} />
                  <div className="p-4 pt-1">
                    {personTop.length ? <ol className="space-y-2.5">{personTop.map((p, i) => (
                      <li key={p.name} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold shrink-0 ${i < 3 ? "bg-brand/12 text-brand" : "bg-surface2 text-muted"}`}>{i + 1}</span>
                          <span className="flex-1 truncate font-medium">{p.name}</span>
                          <span className="text-muted tnum">{formatInt(p.qty)} {L("ชิ้น", "pcs", "件")}</span>
                          <span className="font-semibold tnum w-24 text-right">{formatTHB(p.gross, false)}</span>
                        </div>
                        <div className="ml-7 mt-1 h-1 rounded-full bg-surface2 overflow-hidden"><div className="h-full rounded-full bg-brand/60" style={{ width: `${(p.gross / (personTop[0]?.gross || 1)) * 100}%` }} /></div>
                      </li>))}</ol> : <EmptyState title={t.common.empty} />}
                  </div>
                </Card>
                <Card>
                  <CardHeader title={L("บิลล่าสุด", "Recent bills", "最近账单")} subtitle={L("กดเพื่อดูที่มาของบิล", "Click to trace", "点击查看")} />
                  <div className="px-2 pb-2">
                    {personOrders.length ? personOrders.slice(0, 7).map((o) => (
                      <button key={o.id} onClick={() => setTraceBill(o)} className="group w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-surface2/70 text-left text-xs">
                        <span className="w-8 h-8 rounded-lg bg-brand/8 text-brand grid place-items-center shrink-0"><Receipt size={14} /></span>
                        <span className="min-w-0 flex-1"><span className="block font-mono truncate">{o.order_no}</span>
                          <span className="block text-[10.5px] text-muted truncate">{new Date(saleAt(o)).toLocaleString(locale === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {o.items.filter((x) => !x.is_gift)[0]?.name ?? "—"}</span></span>
                        <span className="font-semibold tnum">{formatTHB(o.grand_total, false)}</span>
                        <ChevronRight size={14} className="text-muted opacity-40 group-hover:opacity-100 group-hover:text-brand" />
                      </button>)) : <EmptyState title={t.common.empty} />}
                  </div>
                </Card>
              </div>
              {traceBill ? <OrderTraceDrawer key={traceBill.id} clientUuid={traceBill.client_uuid} orderNo={traceBill.order_no} onClose={() => setTraceBill(null)} /> : null}
            </div>
          );
        })() : <EmptyState title={L("ไม่พบผลงานของพนักงานคนนี้ในช่วง/ตัวกรองที่เลือก", "No sales for this person in the current filter", "当前筛选下无此员工业绩")} />
      ) : null}

      {/* ============ BY POSITION (เทียบตามตำแหน่ง ข้ามสาขา/แบรนด์) ============ */}
      {view === "position" ? (
        <div className="space-y-4">
          {positionAgg.length ? (
            <>
              {/* ชิปเลือกตำแหน่ง */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {positionAgg.map((p) => (
                  <button
                    key={p.code}
                    onClick={() => setPosCode(p.code)}
                    className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-medium border transition-colors ${activePos === p.code ? "bg-brand text-brandInk border-brand" : "bg-surface border-line text-muted hover:text-ink hover:bg-surface2"}`}
                  >
                    {posLabel(p.code)} <span className="opacity-70 text-xs">· {p.people}</span>
                  </button>
                ))}
              </div>

              {/* KPI ของตำแหน่งที่เลือก */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiTile label={L("จำนวนคน", "People", "人数")} value={formatInt(activeAgg?.people ?? 0)} icon={<Briefcase size={15} />} tone="brand" />
                <KpiTile label={L("ยอดรวมตำแหน่งนี้", "Position total", "该职位合计")} value={formatTHB(activeAgg?.total ?? 0)} />
                <KpiTile label={L("เฉลี่ย/คน", "Avg / person", "人均")} value={formatTHB(activeAgg?.avg ?? 0)} tone="ok" />
                <KpiTile label={t.admin.orderCount} value={formatInt(activeAgg?.orders ?? 0)} />
              </div>

              <div className="grid lg:grid-cols-[1fr_360px] gap-4">
                {/* อันดับคนในตำแหน่งนี้ ข้ามสาขา */}
                <Card>
                  <CardHeader title={`${posLabel(activePos ?? "")} · ${L("จัดอันดับข้ามสาขา", "Ranked across branches", "跨门店排名")}`} subtitle={L("ยอดขายต่อคน พร้อมสาขา/แบรนด์", "Sales per person with branch/brand", "各员工销售额 + 门店/品牌")} />
                  {activePeople.length ? (
                    <Table>
                      <thead>
                        <tr>
                          <Th>#</Th>
                          <Th>{t.common.employee}</Th>
                          <Th>{t.common.branch}</Th>
                          <Th>{t.common.brand}</Th>
                          <Th align="right">{t.admin.gmv}</Th>
                          <Th align="right">{t.admin.orderCount}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {activePeople.map((p, i) => (
                          <tr key={p.id} className="hover:bg-surface2/60">
                            <Td><span className="w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold text-white" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}>{i + 1}</span></Td>
                            <Td>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={p.label} src={empPhoto(p.id)} size={28} />
                                <span className="text-xs font-medium truncate">{p.label}</span>
                              </div>
                            </Td>
                            <Td className="text-xs text-muted truncate max-w-[150px]">{branchName(p.branchId)}</Td>
                            <Td className="text-xs text-muted">{p.brandId ? brandName(p.brandId) : "—"}</Td>
                            <Td align="right" className="font-medium">{formatTHB(p.value, false)}</Td>
                            <Td align="right" className="text-xs">{p.orders}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : <EmptyState title={t.common.empty} />}
                </Card>

                {/* เทียบตำแหน่งทั้งหมด (เฉลี่ย/คน) */}
                <Card>
                  <CardHeader title={L("เทียบทุกตำแหน่ง", "All positions", "各职位对比")} subtitle={L("ยอดเฉลี่ย/คน", "Avg per person", "人均")} />
                  <div className="p-5 pt-3">
                    <BarList data={positionAgg.map((p) => ({ label: posLabel(p.code), value: p.avg, sub: `${p.people} ${L("คน", "ppl", "人")}` }))} />
                  </div>
                </Card>
              </div>
            </>
          ) : (
            <EmptyState
              title={L("ยังไม่มีข้อมูลตำแหน่งในผัง", "No positions set in org chart", "架构中尚无职位")}
              body={L("ไปตั้งตำแหน่งที่หน้าผังองค์กรก่อน", "Set positions in the org chart first", "请先在组织架构设置职位")}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}


// ยอดรายชั่วโมง (ใช้เมื่อข้อมูลมีวันเดียว — กราฟเส้นจุดเดียวอ่านไม่ได้)
function hourTotals(orders: Order[], who?: string | null) {
  const h = Array(24).fill(0) as number[];
  for (const o of orders) {
    if (!isCountedSale(o)) continue;
    const hr = new Date(new Date(saleAt(o)).toLocaleString("en-US", { timeZone: "Asia/Bangkok" })).getHours();
    if (!who) { h[hr] += o.grand_total; continue; }
    for (const it of o.items) if ((it.salesperson_id ?? o.salesperson_id ?? o.cashier_id) === who) h[hr] += lineNet(o, it).net;
  }
  return h;
}
function HourBars({ hours, height = 210 }: { hours: number[]; height?: number }) {
  const max = Math.max(1, ...hours), peak = hours.indexOf(Math.max(...hours));
  const hs = hours.map((v, h) => (v ? h : -1)).filter((h) => h >= 0);
  const [h0, h1] = hs.length ? [Math.min(9, ...hs), Math.max(20, ...hs)] : [9, 20];
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).map((h) => (
        <div key={h} className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0" title={`${h}:00 · ${formatTHB(hours[h], false)}`}>
          <span className="text-[9.5px] tnum text-muted truncate max-w-full">{hours[h] ? formatInt(Math.round(hours[h])) : ""}</span>
          <div className={`w-full rounded-t-md transition-all ${h === peak && hours[h] ? "bg-brand" : "bg-brand/40"}`} style={{ height: `${(hours[h] / max) * 78}%`, minHeight: hours[h] ? 3 : 0 }} />
          <span className="text-[9.5px] text-muted tnum">{h}</span>
        </div>
      ))}
    </div>
  );
}

// เกจวงกลม (SVG) — เปอร์เซ็นต์จริง
function Radial({ pct, label }: { pct: number; label: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - p / 100);
  return (
    <svg viewBox="0 0 140 140" className="w-36 h-36">
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth="14" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgb(var(--c-brand))" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 70 70)" style={{ transition: "stroke-dashoffset .6s ease" }} />
      <text x="70" y="69" textAnchor="middle" fill="rgb(var(--c-ink))" style={{ fontSize: 24, fontWeight: 800 }}>{p < 10 ? p.toFixed(1) : p.toFixed(0)}%</text>
      <text x="70" y="89" textAnchor="middle" fill="rgb(var(--c-muted))" style={{ fontSize: 10 }}>{label}</text>
    </svg>
  );
}
