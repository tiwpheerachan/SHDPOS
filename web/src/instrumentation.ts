// Next.js เรียก register() ครั้งเดียวตอนเซิร์ฟเวอร์เริ่ม — เริ่มวงรอบสำรองส่งบิลขาย → OneWarehouse
// ต้อง import ภายในบล็อก NEXT_RUNTIME === "nodejs" เท่านั้น (บิลด์ edge จะตัดทิ้ง — โมดูลใช้ node:crypto)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailyJobs } = await import("./lib/server/daily-jobs");
    startDailyJobs();
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OW_INPROCESS_WORKER !== "0") {
    const { startOwOutboxLoop } = await import("./lib/server/ow-outbox-loop");
    startOwOutboxLoop();
  }
}
