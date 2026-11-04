"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listOrders } from "@/lib/data/repo";
import type { Order } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, Input, Button, EmptyState, KpiTile } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders, summarize } from "@/lib/analytics";
import { formatTHB, formatInt } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";

export default function AdminSalesPage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    void listOrders().then(setOrders);
  }, []);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);

  const rows = useMemo(() => {
    const list = filterOrders(scoped, { ...filter, branches });
    const term = q.trim().toLowerCase();
    return term
      ? list.filter((o) => o.order_no.toLowerCase().includes(term) || (o.customer_name ?? "").toLowerCase().includes(term))
      : list;
  }, [scoped, filter, branches, q]);

  const totals = summarize(rows);
  const showCost = can(employee, "report.cost");

  function exportCsv() {
    const head = [
      "order_no", "date", "branch", "cashier", "status", "channel",
      "subtotal", "discount", "vat", "grand_total", ...(showCost ? ["cost", "gross_profit"] : []),
    ];
    const lines = rows.map((o) => {
      const b = branches.find((x) => x.id === o.branch_id);
      return [
        o.order_no,
        new Date(o.created_at).toISOString(),
        b?.name ?? "",
        o.cashier_id ?? "",
        o.status,
        o.channel,
        o.subtotal, o.discount_total, o.vat_amount, o.grand_total,
        ...(showCost ? [o.cost_total, o.gross_profit] : []),
      ].join(",");
    });
    const csv = [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `shd-pos-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} />
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
        </div>
        <Button variant="ghost" className="h-9" onClick={exportCsv}>
          <Download size={15} /> CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t.admin.gmv} value={formatTHB(totals.gross)} tone="brand" />
        <KpiTile label={t.admin.orderCount} value={formatInt(totals.orders)} />
        <KpiTile label={t.pos.discount} value={formatTHB(totals.discount)} tone="warn" />
        <KpiTile label={t.pos.vat} value={formatTHB(totals.gross - totals.gross / 1.07)} />
      </div>

      <Card>
        <CardHeader title={t.orders.title} subtitle={`${rows.length} ${t.admin.orderCount}`} />
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.pos.receiptNo}</Th>
                <Th>{t.common.date}</Th>
                <Th>{t.common.branch}</Th>
                <Th>{t.common.customer}</Th>
                <Th align="center">{t.common.status}</Th>
                <Th align="right">{t.common.total}</Th>
                {showCost ? <Th align="right">{t.admin.grossProfit}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((o) => {
                const b = branches.find((x) => x.id === o.branch_id);
                return (
                  <tr key={o.id} className="hover:bg-surface2/60">
                    <Td className="font-mono text-xs">{o.order_no}</Td>
                    <Td className="text-xs text-muted">
                      {new Date(o.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Td>
                    <Td className="text-xs truncate max-w-[180px]">{b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—"}</Td>
                    <Td className="text-xs">{o.customer_name ?? "—"}</Td>
                    <Td align="center">
                      {o.status === "voided" ? <Badge tone="danger">{t.orders.voided}</Badge> : <Badge tone="ok">{t.orders.completed}</Badge>}
                    </Td>
                    <Td align="right" className="font-medium">{formatTHB(o.grand_total, false)}</Td>
                    {showCost ? <Td align="right" className="text-xs text-ok">{formatTHB(o.gross_profit, false)}</Td> : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={t.common.empty} />
        )}
      </Card>
    </div>
  );
}
