"use client";

// สถานะผู้ใช้จากระบบกลาง (โปรไฟล์ + สิทธิ์ที่ resolve จาก app_user_grants) — ดึง /api/me ครั้งเดียว แชร์ทั้งแอป
import { create } from "zustand";
import type { AppAuthz, MeResponse, SsoSessionProfile } from "./types";

interface CentralState {
  loaded: boolean;
  loading: boolean;
  authenticated: boolean;
  profile: SsoSessionProfile | null;
  authz: AppAuthz | null;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useCentral = create<CentralState>((set, get) => ({
  loaded: false,
  loading: false,
  authenticated: false,
  profile: null,
  authz: null,
  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const data = (await r.json()) as MeResponse;
      set({
        loaded: true,
        loading: false,
        authenticated: data.authenticated,
        profile: data.profile,
        authz: data.authz,
      });
    } catch {
      set({ loaded: true, loading: false });
    }
  },
  clear: () => set({ authenticated: false, profile: null, authz: null }),
}));
