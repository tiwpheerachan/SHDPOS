import { NextRequest, NextResponse } from "next/server";
import { workContext, workBranch } from "@/lib/server/work-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasPerm } from "@/lib/sso/guard";
import { PosError } from "@/lib/server/pos-context";
import { UUID } from "@/lib/server/sale-validation";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const c = await workContext(req);
    if (
      !["pos.sell", "report.employee_perf", "finance.view"].some((p) =>
        hasPerm(c.profile.email, c.authz, p as any),
      )
    )
      throw new PosError("ไม่มีสิทธิ์ดูข้อมูลขาย", 403);
    const sp = req.nextUrl.searchParams,
      month = sp.get("month") ?? "",
      branch = sp.get("branch_id");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new PosError("เดือนไม่ถูกต้อง");
    const [y, m] = month.split("-").map(Number);
    if (y < 2000 || y > 2100 || m < 1 || m > 12)
      throw new PosError("เดือนไม่ถูกต้อง");
    if (branch) {
      if (!UUID.test(branch)) throw new PosError("สาขาไม่ถูกต้อง");
      workBranch(branch, c.branches);
    }
    const from = `${month}-01T00:00:00+07:00`,
      to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+07:00`;
    const r = await supabaseAdmin().rpc("pos_work_sales", {
      p_actor: c.actor,
      p_from: from,
      p_to: to,
      p_branch: branch,
      p_allowed: c.branches,
      p_own: c.authz.data_scope === "own",
    });
    if (r.error) throw new PosError("อ่านปฏิทินขายไม่สำเร็จ", 503);
    return NextResponse.json(
      {
        days: r.data,
        basis: "posted_sales_including_vat_before_partial_refunds",
        timezone: "Asia/Bangkok",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "อ่านไม่สำเร็จ" },
      { status: e instanceof PosError ? e.status : 503 },
    );
  }
}
