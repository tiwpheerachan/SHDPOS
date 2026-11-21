import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch_id") || "";
    await posContext(req, "pos.sell", branch);
    const { data, error } = await supabaseAdmin()
      .from("pos_payment_accounts")
      .select("payee_name,promptpay_mobile,verified")
      .eq("branch_id", branch)
      .maybeSingle();
    if (error)
      throw new PosError("ยังไม่ได้ติดตั้งทะเบียนบัญชีรับเงินกลาง", 503);
    return NextResponse.json(
      data?.verified
        ? {
            configured: true,
            payeeName: data.payee_name,
            mobile: data.promptpay_mobile,
          }
        : { configured: false },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "อ่านบัญชีรับเงินไม่สำเร็จ" },
      { status: e instanceof PosError ? e.status : 400 },
    );
  }
}
