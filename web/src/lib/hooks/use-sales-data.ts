"use client";
// ข้อมูลหน้ายอดขาย/ผลงานพนักงาน: โหมดจริง = บิลจากระบบกลาง (/api/admin/sales-data) ตามช่วงวันที่
//   โหมดสาธิต = ข้อมูลในเครื่อง (Dexie) · สาขา/แบรนด์/พนักงาน มาจากแหล่งเดียวกับบิล (ไม่ปน id สาธิต)
import { useEffect, useMemo, useState } from "react";
import { isLiveMode } from "@/lib/supabase/client";
import { listOrders, listEmployees } from "@/lib/data/repo";
import { useAdminScope } from "@/components/admin/filters";
import type { Branch, Brand, Employee, Order } from "@/lib/types";

export type SalesData = { orders: Order[]; branches: Branch[]; brands: Brand[]; employees: Employee[]; loading: boolean; error: string; truncated: boolean; live: boolean };

export function useSalesData(range: { from: Date; to: Date }): SalesData {
  const live = typeof window !== "undefined" && isLiveMode();
  const scope = useAdminScope();
  const [state, setState] = useState<Omit<SalesData, "live">>({ orders: [], branches: [], brands: [], employees: [], loading: true, error: "", truncated: false });
  const key = `${range.from.toISOString().slice(0, 16)}|${range.to.toISOString().slice(0, 16)}`;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    void (async () => {
      try {
        if (live) {
          const r = await fetch(`/api/admin/sales-data?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`, { cache: "no-store" });
          const j = await r.json();
          if (!r.ok) throw Error(j.error);
          if (alive) setState({ orders: j.orders, branches: j.branches, brands: j.brands, employees: j.employees, loading: false, error: "", truncated: j.truncated });
        } else {
          const [o, e] = await Promise.all([listOrders(), listEmployees()]);
          if (alive) setState({ orders: o, branches: [], brands: [], employees: e, loading: false, error: "", truncated: false });
        }
      } catch (e) { if (alive) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "โหลดไม่สำเร็จ" })); }
    })();
    return () => { alive = false; };
  }, [key, live]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => live ? { ...state, live } : { ...state, branches: scope.branches, brands: scope.brands, live }, [state, live, scope.branches, scope.brands]);
}
