"use client";

// =====================================================================
// Scope filter — ตัวกรองแบรนด์/สาขาบน topbar (ขอบเขตที่กำลังดู)
//   null = ทุกแบรนด์ / ทุกสาขา
// =====================================================================
import { create } from "zustand";

interface ScopeFilterState {
  brandId: string | null;
  branchId: string | null;
  setBrand: (id: string | null) => void;
  setBranch: (id: string | null) => void;
}

export const useScopeFilter = create<ScopeFilterState>((set) => ({
  brandId: null,
  branchId: null,
  setBrand: (brandId) => set({ brandId }),
  setBranch: (branchId) => set({ branchId }),
}));
