import { NextRequest, NextResponse } from "next/server";
import {
  posContext,
  PosError,
  requireSameOrigin,
} from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { object, UUID } from "@/lib/server/sale-validation";
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const b = object(await req.json());
    const ctx = await posContext(req, "inventory.adjust", b.branch_id);
    if (
      typeof b.id !== "string" ||
      !b.id ||
      b.id.length > 100 ||
      !Array.isArray(b.lines) ||
      !b.lines.length ||
      b.lines.length > 5000
    )
      throw new PosError("รอบนับไม่ถูกต้อง");
    const ids = new Set<string>();
    const lines = b.lines
      .filter((l: any) => l.counted !== null)
      .map((raw: unknown) => {
        const l = object(raw);
        if (
          !UUID.test(l.product_id) ||
          ids.has(l.product_id) ||
          typeof l.counted !== "number" ||
          !Number.isFinite(l.counted) ||
          l.counted < 0 ||
          typeof l.expected !== "number" ||
          !Number.isFinite(l.expected)
        )
          throw new PosError("จำนวนหรือรหัสสินค้าในรอบนับไม่ถูกต้อง");
        ids.add(l.product_id);
        return {
          product_id: l.product_id,
          expected: l.expected,
          counted: l.counted,
          reason: String(b.note ?? "นับสต๊อก").slice(0, 1000),
        };
      });
    if (!lines.length) throw new PosError("ยังไม่มีรายการที่นับแล้ว");
    const { data, error } = await supabaseAdmin().rpc("pos_approve_count", {
      p_id: b.id,
      p_branch: b.branch_id,
      p_actor: ctx.actorId,
      p_lines: lines,
    });
    if (error)
      throw new PosError(`อนุมัติรอบนับไม่สำเร็จ: ${error.message}`, 409);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "อนุมัติไม่สำเร็จ" },
      { status: e instanceof PosError ? e.status : 400 },
    );
  }
}
