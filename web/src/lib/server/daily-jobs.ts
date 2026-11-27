// =====================================================================
// งานรายวันในโปรเซสเว็บ (เริ่มจาก instrumentation.ts · ไม่ขึ้นกับการตั้งค่า OneWarehouse)
//   • แต้มหมดอายุ: เรียก pos_daily_points_expiry ทุก 30 นาที — DB รันจริงวันละครั้ง (ล็อก + audit ของวัน) หลายอินสแตนซ์ปลอดภัย
//   • ปิดได้ด้วย DAILY_JOBS=0
// =====================================================================
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dataverseReady, syncLegacyRecent } from "@/lib/server/dataverse";

const g = globalThis as unknown as { __dailyJobs?: boolean };

export function startDailyJobs(): void {
  if (g.__dailyJobs || process.env.DAILY_JOBS === "0") return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return; // โหมดเดโม
  g.__dailyJobs = true;
  const run = async () => {
    try {
      const { data, error } = await supabaseAdmin().rpc("pos_daily_points_expiry");
      if (error) throw new Error(error.message);
      const r = data as { ran: boolean; points?: number; day: string };
      if (r?.ran) console.log(JSON.stringify({ at: new Date().toISOString(), points_expired: r.points ?? 0, day: r.day }));
    } catch (e) { console.error("[daily-jobs:points-expiry]", e instanceof Error ? e.message : e); }
  };
  setTimeout(() => void run(), 60_000);
  setInterval(() => void run(), 30 * 60_000);

  // ยอดขายระบบเดิม (Lark ผ่าน Dataverse): เดือนนี้ทุก 15 นาที · เดือนก่อนทุกชั่วโมง (ระบบเดิมยังใช้คู่กัน/แก้ย้อนหลังได้) · ปิดด้วย LEGACY_SYNC=0
  if (dataverseReady() && process.env.LEGACY_SYNC !== "0") {
    let tick = 0;
    const legacy = async () => {
      try {
        const r = await syncLegacyRecent(supabaseAdmin(), { includePrev: tick++ % 4 === 0 });
        console.log(JSON.stringify({ at: new Date().toISOString(), legacy_sync: r.map((x) => x.fetched) }));
      } catch (e) { console.error("[daily-jobs:legacy-sync]", e instanceof Error ? e.message : e); }
    };
    setTimeout(() => void legacy(), 3 * 60_000);
    setInterval(() => void legacy(), 15 * 60_000);
  }
}
