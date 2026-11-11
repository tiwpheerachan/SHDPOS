"use client";

import { useEffect, useMemo, useState } from "react";
import { Users, Trophy, LayoutDashboard, Table as TableIcon, UserRound, Network } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders, listEmployees } from "@/lib/data/repo";
import type { Employee, Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, EmptyState, KpiTile, Avatar, Segmented, Select } from "@/components/ui";
import { BarList, AreaChart, SERIES_COLORS } from "@/components/charts";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { byEmployee, filterOrders, summarize, salesSeries, type TimeGran } from "@/lib/analytics";
import { formatTHB, formatInt } from "@/lib/money";
import { ROLE_LABEL, can, visibleBranchIds } from "@/lib/permissions";

type View = "dashboard" | "table" | "person";

export default function AdminEmployeesPage() {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [gran, setGran] = useState<TimeGran>("day");
  const [personId, setPersonId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setOrders(await listOrders());
      setEmployees(await listEmployees());
    })();
  }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);

  const filtered = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);

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
  const activePerson = personId ?? best?.id ?? null;
  const personRow = rows.find((r) => r.id === activePerson) ?? null;
  const personSeries = useMemo(
    () => (activePerson ? salesSeries(filtered, gran, activePerson) : []),
    [filtered, gran, activePerson]
  );

  const granOptions: { value: TimeGran; label: string }[] = [
    { value: "day", label: L("รายวัน", "Daily", "每日") },
    { value: "month", label: L("รายเดือน", "Monthly", "每月") },
    { value: "year", label: L("รายปี", "Yearly", "每年") },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

      {/* แถบสลับมุมมอง + ลิงก์ผังองค์กร */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<View>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "dashboard", label: <span className="inline-flex items-center gap-1.5"><LayoutDashboard size={14} /> {L("แดชบอร์ด", "Dashboard", "仪表盘")}</span> },
            { value: "table", label: <span className="inline-flex items-center gap-1.5"><TableIcon size={14} /> {L("ตาราง", "Table", "表格")}</span> },
            { value: "person", label: <span className="inline-flex items-center gap-1.5"><UserRound size={14} /> {L("รายบุคคล", "Individual", "个人")}</span> },
          ]}
        />
        <Link href="/admin/org" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line bg-surface hover:bg-surface2 text-sm font-medium text-ink transition-colors">
          <Network size={15} className="text-brand" /> {L("ผังองค์กร", "Org chart", "组织架构")}
        </Link>
      </div>

      {/* KPI รวม */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t.admin.employees} value={formatInt(rows.length)} icon={<Users size={15} />} />
        <KpiTile label={t.admin.gmv} value={formatTHB(totals.gross)} tone="brand" />
        <KpiTile label={t.admin.avgBasket} value={formatTHB(totals.avgBasket)} />
        <KpiTile
          label={t.admin.topEmployees}
          value={best?.label ?? "—"}
          sub={best ? formatTHB(best.value) : undefined}
          tone="ok"
          icon={<Trophy size={15} />}
        />
      </div>

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
              {overallSeries.length ? (
                <AreaChart data={overallSeries} height={220} valueFormat={(n) => formatTHB(n, false)} />
              ) : <EmptyState title={t.common.empty} />}
            </div>
          </Card>

          <div className="grid lg:grid-cols-[1fr_360px] gap-4">
            <Card>
              <CardHeader title={t.admin.topEmployees} subtitle={L("จัดอันดับตามยอดขาย", "Ranked by sales", "按销售额排名")} />
              <div className="p-3 space-y-1">
                {rows.length ? rows.slice(0, 15).map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => { setPersonId(r.id); setView("person"); }}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-surface2 transition-colors text-left"
                  >
                    <span className="w-5 text-center text-[11px] font-bold text-muted shrink-0">{i + 1}</span>
                    <Avatar name={r.label} src={empPhoto(r.id)} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{r.label}</p>
                      <p className="text-[10px] text-muted truncate">{empRole(r.id)} · {branchName(r.branchId)}</p>
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
                <BarList data={rows.slice(0, 12).map((r) => ({ label: r.label, value: r.value, sub: `${r.orders} ${t.admin.orderCount}` }))} />
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ============ TABLE (เดิม + avatar) ============ */}
      {view === "table" ? (
        <Card>
          <CardHeader title={t.admin.topEmployees} subtitle={L("ยอดขายแยกรายคน — รวมกรณีเข้ากะพร้อมกันหลายคน", "Sales by individual — combined when several share a shift", "按个人销售额 — 多人同班时合并计算")} />
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
                  <tr key={r.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => { setPersonId(r.id); setView("person"); }}>
                    <Td>
                      <span className="w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold text-white" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}>{i + 1}</span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.label} src={empPhoto(r.id)} size={30} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{r.label}</p>
                          <p className="text-[10px] text-muted truncate">{r.code}{empRole(r.id) ? ` · ${empRole(r.id)}` : ""}</p>
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

      {/* ============ PERSON (รายบุคคล + กราฟ) ============ */}
      {view === "person" ? (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3 min-w-0">
                {activePerson ? <Avatar name={personRow?.label ?? ""} src={activePerson ? empPhoto(activePerson) : null} size={46} /> : null}
                <div className="min-w-0">
                  <p className="text-base font-semibold truncate">{personRow?.label ?? L("เลือกพนักงาน", "Select employee", "选择员工")}</p>
                  <p className="text-[11px] text-muted truncate">
                    {activePerson ? `${empRole(activePerson)} · ${branchName(personRow?.branchId ?? null)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={activePerson ?? ""} onChange={(e) => setPersonId(e.target.value || null)} className="w-52">
                  {rows.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
                <Segmented<TimeGran> size="sm" value={gran} onChange={setGran} options={granOptions} />
              </div>
            </div>
          </Card>

          {personRow ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiTile label={t.admin.gmv} value={formatTHB(personRow.value)} tone="brand" />
                <KpiTile label={t.admin.orderCount} value={formatInt(personRow.orders)} />
                <KpiTile label={t.admin.unitsSold} value={formatInt(personRow.units)} />
                {showGp
                  ? <KpiTile label={t.admin.grossProfit} value={formatTHB(personRow.grossProfit)} tone="ok" />
                  : <KpiTile label={t.admin.avgBasket} value={formatTHB(personRow.avgBasket)} />}
              </div>
              <Card>
                <CardHeader
                  title={L("แนวโน้มผลงาน", "Performance trend", "业绩趋势")}
                  subtitle={`${personRow.label} · ${granOptions.find((g) => g.value === gran)?.label}`}
                />
                <div className="p-4 pt-3">
                  {personSeries.length ? (
                    <AreaChart data={personSeries} height={240} color={SERIES_COLORS[1]} valueFormat={(n) => formatTHB(n, false)} />
                  ) : <EmptyState title={t.common.empty} />}
                </div>
              </Card>
            </>
          ) : <EmptyState title={t.common.empty} />}
        </div>
      ) : null}
    </div>
  );
}
