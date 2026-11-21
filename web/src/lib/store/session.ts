"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Employee, Shift } from "../types";
import { DEFAULT_PRINTER, type PrinterConfig } from "../printing/bridge";
import { supabase, isLiveMode } from "../supabase/client";

const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

interface SessionState {
  employee: Employee | null;
  branchId: string | null;
  terminalId: string | null;
  shift: Shift | null;
  printer: PrinterConfig;
  /** ช่องทางขายเริ่มต้นของเครื่องนี้ */
  channel: "offline" | "online_shopee" | "online_lazada" | "online_tiktok" | "event";
  login: (e: Employee, branchId: string | null, terminalId: string | null) => void;
  logout: () => void;
  /** ดึง role/สิทธิ์/สาขา ล่าสุดจาก DB มาอัปเดต session (เผื่อแอดมินเปลี่ยน role หลัง login) */
  refreshEmployee: () => Promise<void>;
  setBranch: (branchId: string | null, terminalId: string | null) => void;
  setShift: (s: Shift | null) => void;
  setPrinter: (p: Partial<PrinterConfig>) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      employee: null,
      branchId: null,
      terminalId: null,
      shift: null,
      printer: DEFAULT_PRINTER,
      channel: "offline",
      login: (employee, branchId, terminalId) => set({ employee, branchId, terminalId }),
      logout: () => set({ employee: null, branchId: null, terminalId: null, shift: null }),
      refreshEmployee: async () => {
        const emp = get().employee;
        if (!emp || !isLiveMode() || !isUuid(emp.id)) return;
        let central;
        try {
          const response = await fetch("/api/me", {cache:"no-store"});
          if (!response.ok) return;
          central = await response.json();
        } catch { return; }
        if (!central.authenticated || !central.authz?.allowed || central.authz.employee_id !== emp.id) {
          set({employee:null,branchId:null,terminalId:null,shift:null}); return;
        }
        const sb = supabase();
        if (!sb) return;
        // อ่านจาก view pos_employees (anon ได้) — role/data_scope/สาขา/แบรนด์/สถานะ ล่าสุด
        const { data, error } = await sb
          .from("pos_employees")
          .select("role,data_scope,home_branch_id,branch_ids,brand_ids,max_discount_percent,can_open_drawer,status,photo_url,nickname,first_name,last_name")
          .eq("id", emp.id)
          .maybeSingle();
        if (error) return;
        if (!data) { set({ employee: null, branchId: null, terminalId: null, shift: null }); return; }
        // ถ้าถูกระงับ/ลบ → ออกจากระบบ
        if (data.status && data.status !== "active") { set({ employee: null, branchId: null, terminalId: null, shift: null }); return; }
        const d:Record<string,unknown> = {...data,
          role:central.authz.role,data_scope:central.authz.data_scope,
          branch_ids:central.authz.branch_ids,brand_ids:central.authz.brand_ids,
          max_discount_percent:central.authz.max_discount_percent,can_open_drawer:central.authz.can_open_drawer,
        };
        const same =
          JSON.stringify(central.authz.permission_overrides ?? {}) === JSON.stringify(emp.permission_overrides ?? {}) &&
          d.role === emp.role &&
          d.data_scope === emp.data_scope &&
          d.home_branch_id === emp.home_branch_id &&
          d.max_discount_percent === emp.max_discount_percent &&
          Boolean(d.can_open_drawer) === Boolean(emp.can_open_drawer) &&
          d.photo_url === emp.photo_url &&
          d.nickname === emp.nickname &&
          d.first_name === emp.first_name &&
          d.last_name === emp.last_name &&
          JSON.stringify(d.branch_ids ?? []) === JSON.stringify(emp.branch_ids ?? []) &&
          JSON.stringify(d.brand_ids ?? []) === JSON.stringify(emp.brand_ids ?? []);
        if (same) return; // ไม่มีอะไรเปลี่ยน ไม่ต้อง set (กัน re-render)
        set({
          employee: {
            ...emp,
            permission_overrides: central.authz.permission_overrides ?? {},
            role: (d.role as Employee["role"]) ?? emp.role,
            data_scope: (d.data_scope as Employee["data_scope"]) ?? emp.data_scope,
            home_branch_id: (d.home_branch_id as string | null) ?? emp.home_branch_id,
            branch_ids: (d.branch_ids as string[]) ?? emp.branch_ids,
            brand_ids: (d.brand_ids as string[]) ?? emp.brand_ids,
            max_discount_percent: (d.max_discount_percent as number) ?? emp.max_discount_percent,
            can_open_drawer: (d.can_open_drawer as boolean) ?? emp.can_open_drawer,
            photo_url: (d.photo_url as string | null) ?? emp.photo_url,
            nickname: (d.nickname as string | null) ?? emp.nickname,
            first_name: (d.first_name as string) ?? emp.first_name,
            last_name: (d.last_name as string | null) ?? emp.last_name,
          },
        });
      },
      setBranch: (branchId, terminalId) => set({ branchId, terminalId, shift: null }),
      setShift: (shift) => set({ shift }),
      setPrinter: (p) => set((s) => ({ printer: { ...s.printer, ...p } })),
    }),
    {
      name: "shdpos.session",
      partialize: (s) => ({
        employee: s.employee,
        branchId: s.branchId,
        terminalId: s.terminalId,
        shift: s.shift,
        printer: s.printer,
        channel: s.channel,
      }),
    }
  )
);
