import { NextRequest, NextResponse } from "next/server";
import { workContext } from "@/lib/server/work-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { UUID, object } from "@/lib/server/sale-validation";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const ctx = await workContext(req),
      sb = supabaseAdmin();
    const reminders = await sb.rpc("pos_work_reminders", {
      p_actor: ctx.actor,
    });
    if (reminders.error) throw Error("อ่านการเตือนไม่สำเร็จ");
    const [r, c] = await Promise.all([
      sb
        .from("pos_work_notifications")
        .select("id,task_id,title,read_at,created_at")
        .eq("recipient_id", ctx.actor)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("pos_work_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", ctx.actor)
        .is("read_at", null),
    ]);
    if (r.error || c.error) throw Error("อ่านการแจ้งเตือนไม่สำเร็จ");
    return NextResponse.json(
      { items: r.data, unread: c.count },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "อ่านไม่สำเร็จ" },
      { status: e instanceof PosError ? e.status : 503 },
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const c = await workContext(req),
      b = object(await req.json());
    if (b.id !== undefined && !UUID.test(b.id))
      throw new PosError("รหัสแจ้งเตือนไม่ถูกต้อง");
    let q = supabaseAdmin()
      .from("pos_work_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", c.actor)
      .is("read_at", null);
    if (b.id) q = q.eq("id", b.id);
    const r = await q;
    if (r.error) throw Error("บันทึกการอ่านไม่สำเร็จ");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" },
      { status: e instanceof PosError ? e.status : 503 },
    );
  }
}
