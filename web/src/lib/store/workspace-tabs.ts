"use client";

// แท็บเอกสาร (workspace tabs) — จำว่าเปิดเอกสาร/หน้าอะไรค้างไว้ สลับไปมาได้ ปิดได้
//   เก็บ href เต็ม (รวม ?doc=) → กลับมาแท็บเดิมแล้วเอกสารเดิมเปิดอยู่ (ไม่เริ่มใหม่)
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WTab { href: string; label: string; kind?: "page" | "doc" }

interface State {
  tabs: WTab[];
  open: (t: WTab) => void;        // เพิ่ม/อัปเดต label ตาม href
  close: (href: string) => void;
  closeAll: () => void;
}

export const useWorkspaceTabs = create<State>()(
  persist(
    (set) => ({
      tabs: [],
      open: (t) =>
        set((s) => {
          const i = s.tabs.findIndex((x) => x.href === t.href);
          if (i >= 0) {
            if (s.tabs[i].label === t.label) return s;
            const next = s.tabs.slice();
            next[i] = { ...next[i], ...t };
            return { tabs: next };
          }
          return { tabs: [...s.tabs, t].slice(-12) }; // จำกัด 12 แท็บ
        }),
      close: (href) => set((s) => ({ tabs: s.tabs.filter((x) => x.href !== href) })),
      closeAll: () => set({ tabs: [] }),
    }),
    { name: "shdpos.wtabs" }
  )
);
