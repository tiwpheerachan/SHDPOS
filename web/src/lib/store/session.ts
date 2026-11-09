"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Employee, Shift } from "../types";
import { DEFAULT_PRINTER, type PrinterConfig } from "../printing/bridge";

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
  setBranch: (branchId: string | null, terminalId: string | null) => void;
  setShift: (s: Shift | null) => void;
  setPrinter: (p: Partial<PrinterConfig>) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      employee: null,
      branchId: null,
      terminalId: null,
      shift: null,
      printer: DEFAULT_PRINTER,
      channel: "offline",
      login: (employee, branchId, terminalId) => set({ employee, branchId, terminalId }),
      logout: () => set({ employee: null, shift: null }),
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
