"use client";
// ข้อมูลหน้ายอดขาย/ผลงานพนักงาน: โหมดจริง = บิลจากระบบกลาง (/api/admin/sales-data) ตามช่วงวันที่
//   โหมดสาธิต = ข้อมูลในเครื่อง (Dexie) · สาขา/แบรนด์/พนักงาน มาจากแหล่งเดียวกับบิล (ไม่ปน id สาธิต)
import { useEffect, useMemo, useState } from "react";
import { isLiveMode } from "@/lib/supabase/client";
import { tr } from "@/lib/i18n/tr";
import { listOrders, listEmployees } from "@/lib/data/repo";
import { useAdminScope } from "@/components/admin/filters";
import type { Branch, Brand, Employee, Order } from "@/lib/types";

export type Adjustment = { branch_id: string; kind: "return" | "void" | "credit_note"; amount: number; at: string };
export type PrevOrder = { branch_id: string; grand_total: number; status: string; channel: string; created_at: string };
/** ตำแหน่งจากผังองค์กร (โหมดจริง: จากเซิร์ฟเวอร์ · โหมดสาธิต: null = ให้หน้าโหลดเอง) */
export type OrgPosition = { branch_id: string; employee_id: string; title: string };
export type SalesData = { orders: Order[]; branches: Branch[]; brands: Brand[]; employees: Employee[]; positions: OrgPosition[] | null; adjustments: Adjustment[]; prev: PrevOrder[]; loading: boolean; error: string; truncated: boolean; live: boolean };

export function useSalesData(range: { from: Date; to: Date }): SalesData {
  const live = typeof window !== "undefined" && isLiveMode();
  const scope = useAdminScope();
  const [state, setState] = useState<Omit<SalesData, "live">>({ orders: [], branches: [], brands: [], employees: [], positions: null, adjustments: [], prev: [], loading: true, error: "", truncated: false });
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
          if (alive) setState({ orders: j.orders, branches: j.branches, brands: j.brands, employees: j.employees, positions: j.positions ?? [], adjustments: j.adjustments ?? [], prev: j.prev ?? [], loading: false, error: "", truncated: j.truncated });
        } else {
          const [o, e] = await Promise.all([listOrders(), listEmployees()]);
          if (alive) setState({ orders: o, branches: [], brands: [], employees: e, positions: null, adjustments: [], prev: [], loading: false, error: "", truncated: false });
        }
      } catch (e) { if (alive) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : tr("โหลดไม่สำเร็จ", "Failed to load", "加载失败") })); }
    })();
    return () => { alive = false; };
  }, [key, live]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => live ? { ...state, live } : { ...state, branches: scope.branches, brands: scope.brands, live }, [state, live, scope.branches, scope.brands]);
}
