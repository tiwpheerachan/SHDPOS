// Worker: ส่งคิวบิลขาย + ติดตามผล — แยกจากรอบอ่านแคตตาล็อก (ที่อาจนาน) เพื่อไม่หน่วงบิลขาย
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { owConfig } from "@/lib/server/ow-gateway";
import { processSaleOutbox, followUpSales } from "@/lib/server/ow-sales";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 120;
export async function POST(req: NextRequest) {
  const key = process.env.OW_SYNC_CRON_SECRET ?? "", provided = req.headers.get("authorization") ?? "";
  if (key.length < 32 || Buffer.byteLength(provided) !== Buffer.byteLength("Bearer " + key) || !timingSafeEqual(Buffer.from(provided), Buffer.from("Bearer " + key))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const source = owConfig().source;
    const sales = await processSaleOutbox(source, 5);
    const followup = await followUpSales(source, 20);
    return NextResponse.json({ sales, followup });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "outbox_failed" }, { status: 503 }); }
}
