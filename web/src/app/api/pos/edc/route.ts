// /api/pos/edc?branch= — เครื่อง EDC ของสาขา (ใช้งานอยู่) ให้หน้าร้านเลือกตอนรับชำระบัตร/ผ่อน
//   คืนเฉพาะข้อมูลที่ต้องใช้เลือก: ธนาคาร · ชื่อเรียก · TID 4 ตัวท้าย · บริการ/แผนผ่อนที่มี — ไม่ส่งเลข MID เต็ม
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { UUID } from "@/lib/server/sale-validation";
import { ACQUIRER_TH, maskNo } from "@/lib/server/edc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch") ?? "";
    if (!UUID.test(branch)) throw new PosError("สาขาไม่ถูกต้อง", 400);
    await posContext(req, "pos.sell", branch);
    const sb = supabaseAdmin();
    const t = await sb.from("pos_edc_terminals").select("id,acquirer,branch_id,label,tid").or(`branch_id.eq.${branch},branch_id.is.null`).eq("status", "active").order("acquirer");
    if (t.error) throw new Error(t.error.message);
    const ids = (t.data ?? []).map((x) => x.id);
    const m = ids.length ? await sb.from("pos_edc_mids").select("terminal_id,service,installment_months").in("terminal_id", ids) : { data: [] as { terminal_id: string; service: string; installment_months: number }[] };
    const terminals = (t.data ?? []).map((x) => {
      const mm = (m.data ?? []).filter((y) => y.terminal_id === x.id);
      return { id: x.id, acquirer: x.acquirer, acquirer_name: ACQUIRER_TH[x.acquirer] ?? x.acquirer, label: x.label, tid_last: maskNo(x.tid), shared: !x.branch_id,
        services: [...new Set(mm.map((y) => y.service))], installment_months: mm.filter((y) => y.service === "installment").map((y) => y.installment_months).sort((a, b) => a - b) };
    });
    return NextResponse.json({ terminals, required: terminals.some((x) => !x.shared) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "อ่านเครื่อง EDC ไม่สำเร็จ" }, { status: e instanceof PosError ? e.status : 400 });
  }
}
