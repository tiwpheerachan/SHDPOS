"use client";
// ข้อมูลหน้ายอดขาย/ผลงานพนักงาน: โหมดจริง = บิลจากระบบกลาง (/api/admin/sales-data) ตามช่วงวันที่
//   โหมดสาธิต = ข้อมูลในเครื่อง (Dexie) · สาขา/แบรนด์/พนักงาน มาจากแหล่งเดียวกับบิล (ไม่ปน id สาธิต)
import { useEffect, useMemo, useState } from "react";
import { isLiveMode } from "@/lib/supabase/client";
import { tr } from "@/lib/i18n/tr";
import { listOrders, listEmployees } from "@/lib/data/repo";
import { useAdminScope } from "@/components/admin/filters";
import type { Branch, Brand, Employee, Order } from "@/lib/types";
import { expandLegacy, expandLegacyDaily, type LegacyCompact, type LegacyDaily } from "@/lib/legacy-expand";

// แคชในหน่วยความจำ: กลับมาหน้าเดิม/สลับแท็บ = แสดงทันที แล้วรีเฟรชเบื้องหลัง · ช่วงที่แคบกว่าช่วงที่โหลดไว้ = ตัดจากแคชเลย ไม่ต้องโหลดใหม่
type Loaded = Omit<SalesData, "live" | "loading" | "error"> & { from: number; to: number; at: number };
const CACHE: Loaded[] = [];
const FRESH_MS = 5 * 60_000;
// ช่วงเดียวกัน (คลาดไม่เกิน 2 นาที เพราะ "30 วัน" นับถึงตอนนี้) = ใช้ได้เลย · ช่วงย่อย = แสดงก่อนระหว่างโหลดจริง (ช่วงก่อนหน้า/เทียบ % ต่างกัน)
function fromCache(from: Date, to: Date): (Loaded & { exact: boolean }) | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= 120_000;
  const exact = CACHE.find((c) => near(c.from, +from) && near(c.to, +to));
  if (exact) return { ...exact, exact: true };
  const hit = CACHE.filter((c) => c.from <= +from && c.to >= +to - 120_000).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
  if (!hit) return null;
  const f = from.toISOString(), t = to.toISOString();
  return { ...hit, orders: hit.orders.filter((o) => o.created_at >= f && o.created_at <= t), exact: false };
}
function remember(x: Loaded) { CACHE.unshift(x); if (CACHE.length > 4) CACHE.length = 4; }

async function loadLive(from: Date, to: Date): Promise<Loaded> {
  const r = await fetch(`/api/admin/sales-data?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw Error(j.error);
  const lk = j.legacy ? expandLegacy(j.legacy as LegacyCompact) : { orders: [], pseudoBranches: [] };
  const lp = j.legacy_prev ? expandLegacyDaily(j.legacy_prev as LegacyDaily) : [];
  return { orders: [...j.orders, ...lk.orders], branches: [...j.branches, ...lk.pseudoBranches], brands: j.brands, employees: j.employees, positions: j.positions ?? [],
    adjustments: j.adjustments ?? [], prev: [...(j.prev ?? []), ...lp], truncated: j.truncated, from: +from, to: +to, at: Date.now() };
}

export type Adjustment = { branch_id: string; kind: "return" | "void" | "credit_note"; amount: number; at: string };
/** n = จำนวนบิลที่แถวนี้แทน (ระบบเดิมส่งมาเป็นยอดรวมรายวัน) — ไม่มี = 1 */
export type PrevOrder = { branch_id: string; grand_total: number; status: string; channel: string; created_at: string; n?: number; source?: "pos" | "lark" };
/** ตำแหน่งจากผังองค์กร (โหมดจริง: จากเซิร์ฟเวอร์ · โหมดสาธิต: null = ให้หน้าโหลดเอง) */
export type OrgPosition = { branch_id: string; employee_id: string; title: string };
export type SalesData = { orders: Order[]; branches: Branch[]; brands: Brand[]; employees: Employee[]; positions: OrgPosition[] | null; adjustments: Adjustment[]; prev: PrevOrder[]; loading: boolean; error: string; truncated: boolean; live: boolean };

export function useSalesData(range: { from: Date; to: Date }): SalesData {
  const live = typeof window !== "undefined" && isLiveMode();
  const scope = useAdminScope();
  const [state, setState] = useState<Omit<SalesData, "live">>({ orders: [], branches: [], brands: [], employees: [], positions: null, adjustments: [], prev: [], loading: true, error: "", truncated: false });
  const key = `${range.from.toISOString().slice(0, 16)}|${range.to.toISOString().slice(0, 16)}`;
  // เปิดหน้าค้างไว้ → รีเฟรชเบื้องหลังทุก 5 นาที (ระบบเดิมอัปเดตทุก 15 นาที) โดยข้อมูลเดิมยังแสดงอยู่
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") setTick((t) => t + 1); }, FRESH_MS);
    return () => clearInterval(id);
  }, [live]);
  useEffect(() => {
    let alive = true;
    const cached = live ? fromCache(range.from, range.to) : null;
    const fresh = !!cached?.exact && Date.now() - cached.at < FRESH_MS - 5_000;
    if (cached) setState({ ...cached, loading: !fresh, error: "" });
    else setState((s) => ({ ...s, loading: true, error: "" }));
    if (fresh) return () => { alive = false; };
    void (async () => {
      try {
        if (live) {
          const x = await loadLive(range.from, range.to);
          remember(x);
          if (alive) setState({ ...x, loading: false, error: "" });
        } else {
          const [o, e] = await Promise.all([listOrders(), listEmployees()]);
          if (alive) setState({ orders: o, branches: [], brands: [], employees: e, positions: null, adjustments: [], prev: [], loading: false, error: "", truncated: false });
        }
      } catch (e) { if (alive) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : tr("โหลดไม่สำเร็จ", "Failed to load", "加载失败") })); }
    })();
    return () => { alive = false; };
  }, [key, live, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => live ? { ...state, live } : { ...state, branches: scope.branches, brands: scope.brands, live }, [state, live, scope.branches, scope.brands]);
}
