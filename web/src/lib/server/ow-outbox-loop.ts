// =====================================================================
// วงรอบสำรองส่งบิลขาย → OneWarehouse ในโปรเซสเว็บ (เริ่มจาก instrumentation.ts)
//   ปกติบิลถูกส่งทันทีหลัง commit (kickSaleOutbox) — วงนี้มีไว้ "ลองซ้ำ" บิลที่ส่งไม่ผ่าน + ติดตามผล JST
//   • ทุก 30 วิ: ส่งคิวที่ถึงเวลา (ครั้งละ 5) · ทุก 2 นาที: ติดตามบิล submitted/sn_pending
//   • ทุก 2 นาที: ซิงก์ยอดจองตาม JST ของทุกสาขาที่ผูกคลัง + เปิด/ปิดงานแจ้งปัญหาบิล (งานของฉัน)
//   • ทุก 1 ชม.: ตรวจความตรงกัน POS↔OW↔JST แล้วเก็บผล (ดูในแท็บ ตรวจความตรงกัน)
//   • หลายอินสแตนซ์พร้อมกันปลอดภัย: จองคิวด้วย lease · ปิดได้ด้วย OW_INPROCESS_WORKER=0
// =====================================================================
import { owConfig } from "./ow-gateway";
import { processSaleOutbox, followUpSales } from "./ow-sales";
import { runRecon } from "./ow-recon";
import { owSyncAllReservations } from "./ow-reconcile";
import { syncSaleIssues } from "./ow-issues";

const g = globalThis as unknown as { __owOutboxLoop?: boolean };

export function startOwOutboxLoop(): void {
  if (g.__owOutboxLoop) return; // กันเริ่มซ้ำ (HMR / เรียกหลายครั้ง)
  let source: string;
  try { source = owConfig().source; } catch { return; } // ยังไม่ตั้งค่า OW → ไม่เริ่ม
  g.__owOutboxLoop = true;
  let busy = false, tick = 0;
  // แต่ละงานแยก try ของตัวเอง — งานหนึ่งล้มต้องไม่ทำให้งานอื่นหยุด และ tick ต้องเดินเสมอ (ไม่งั้นงานทุก 2 นาทียิงทุก 30 วิ / recon รายชั่วโมงไม่เคยรัน)
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { console.error(`[ow-outbox-loop:${name}]`, e instanceof Error ? e.message : e); }
  };
  const run = async () => {
    if (busy) return;
    busy = true;
    const t = tick;
    try {
      await step("outbox", async () => {
        const sent = await processSaleOutbox(source, 5);
        if (sent.length) console.log(JSON.stringify({ at: new Date().toISOString(), ow_outbox: sent.map((x) => `${x.state}${x.reason ? `:${x.reason}` : ""}`) }));
      });
      if (t % 4 === 0) {
        await step("followup", async () => {
          const f = await followUpSales(source, 20);
          if (f.changed) console.log(JSON.stringify({ at: new Date().toISOString(), ow_followup: f }));
        });
        // ยอดจองตาม JST (ใบโอนขาออกที่ยังไม่ส่ง) → POS ไม่ขายของที่ JST กันไว้
        await step("reservations", async () => { await owSyncAllReservations(); });
        // ปัญหาบิล → งาน + แจ้งเตือนผู้รับผิดชอบ (ปิดเองเมื่อ JST ยืนยัน)
        await step("issues", async () => {
          const is = await syncSaleIssues(source);
          if (is.created || is.updated || is.resolved) console.log(JSON.stringify({ at: new Date().toISOString(), ow_issues: is }));
        });
      }
      if (t % 120 === 119) {
        await step("recon", async () => {
          const rc = await runRecon(null);
          const bad = rc.rows.filter((r) => r.status === "mismatch");
          if (bad.length) console.warn(JSON.stringify({ at: new Date().toISOString(), ow_recon_mismatch: bad.map((r) => `${r.kind}:${r.ref}`) }));
        });
      }
    } finally { tick = t + 1; busy = false; }
  };
  setTimeout(() => void run(), 15_000); // รอเซิร์ฟเวอร์พร้อมก่อนรอบแรก
  setInterval(() => void run(), 30_000).unref?.();
}
