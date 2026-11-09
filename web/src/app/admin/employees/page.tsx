"use client";

import { useEffect, useMemo, useState } from "react";
import { Users, Trophy } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders, listEmployees } from "@/lib/data/repo";
import type { Employee, Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, EmptyState, KpiTile } from "@/components/ui";
import { BarList, SERIES_COLORS } from "@/components/charts";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { byEmployee, filterOrders, summarize } from "@/lib/analytics";
import { formatTHB, formatInt } from "@/lib/money";
import { ROLE_LABEL, can, visibleBranchIds } from "@/lib/permissions";

export default function AdminEmployeesPage() {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

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

  const rows = useMemo(() => {
    const list = byEmployee(filterOrders(scoped, { ...filter, branches }), employees);
    // scope = own → เห็นเฉพาะของตัวเอง
    if (employee?.data_scope === "own") return list.filter((r) => r.id === employee.id);
    return list;
  }, [scoped, filter, branches, employees, employee]);

  const totals = summarize(filterOrders(scoped, { ...filter, branches }));
  const showGp = can(employee, "report.gross_profit");
  const best = rows[0];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />

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

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
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
                {rows.map((r, i) => {
                  const e = employees.find((x) => x.id === r.id);
                  const b = branches.find((x) => x.id === r.branchId);
                  return (
                    <tr key={r.id} className="hover:bg-surface2/60">
                      <Td>
                        <span
                          className="w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold text-white"
                          style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                        >
                          {i + 1}
                        </span>
                      </Td>
                      <Td>
                        <p className="text-xs font-medium">{r.label}</p>
                        <p className="text-[10px] text-muted">
                          {r.code}
                          {e ? ` · ${ROLE_LABEL[e.role][locale]}` : ""}
                        </p>
                      </Td>
                      <Td className="text-xs text-muted truncate max-w-[160px]">
                        {b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—"}
                      </Td>
                      <Td align="right" className="font-medium">{formatTHB(r.value, false)}</Td>
                      <Td align="right" className="text-xs">{r.orders}</Td>
                      <Td align="right" className="text-xs">{formatInt(r.units)}</Td>
                      <Td align="right" className="text-xs text-muted">{formatTHB(r.avgBasket, false)}</Td>
                      {showGp ? <Td align="right" className="text-xs text-ok">{formatTHB(r.grossProfit, false)}</Td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState title={t.common.empty} />
          )}
        </Card>

        <Card>
          <CardHeader title={t.admin.gmv} subtitle={t.admin.byBranch} />
          <div className="p-5 pt-3">
            <BarList data={rows.slice(0, 12).map((r) => ({ label: r.label, value: r.value, sub: `${r.orders} ${t.admin.orderCount}` }))} />
          </div>
        </Card>
      </div>
    </div>
  );
}
