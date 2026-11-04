// =====================================================================
// Supabase client — ถ้าไม่ได้ตั้ง env จะคืน null แล้วระบบจะทำงานใน "โหมดสาธิต"
// =====================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

export function isLiveMode(): boolean {
  return Boolean(url && anonKey);
}

export function supabase(): SupabaseClient | null {
  if (!isLiveMode()) return null;
  if (!_client) {
    _client = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return _client;
}
