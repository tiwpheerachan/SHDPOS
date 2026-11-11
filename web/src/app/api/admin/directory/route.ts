import { NextRequest, NextResponse } from "next/server";
import { requireEmployeeAdmin } from "@/lib/sso/guard";
import { searchDirectory, getDirectoryUser, getEffective } from "@/lib/sso/central";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { matchOurBranch, jobTitleToPositionCode } from "@/lib/sso/map-central";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ค้นหาพนักงานจาก directory ระบบกลาง (proxy — API key อยู่ฝั่ง server เท่านั้น)
//   ?q=...        → ค้นหาทั้งองค์กร
//   ?enrich=email → โปรไฟล์ครบของคนเดียว + แมปสาขา/ตำแหน่งในระบบเรา
export async function GET(req: NextRequest) {
  const ctx = await requireEmployeeAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const enrich = req.nextUrl.searchParams.get("enrich");
  if (enrich) {
    try {
      const [person, eff] = await Promise.all([
        getDirectoryUser({ email: enrich }),
        getEffective(enrich),
      ]);
      const a = (eff?.assignments ?? []).find((x) => x.is_primary) ?? (eff?.assignments ?? [])[0] ?? null;
      const sb = supabaseAdmin();
      const [{ data: branches }, { data: brands }] = await Promise.all([
        sb.from("branches").select("id,name,name_th,brand_id"),
        sb.from("brands").select("id,name"),
      ]);
      const branch_id = matchOurBranch(a?.branch, a?.department ?? person?.departments?.[0], branches ?? [], brands ?? []);
      const position_code = jobTitleToPositionCode(a?.job_title ?? person?.job_title);
      return NextResponse.json({
        person,
        assignment: a,
        central_employee_id: eff?.employment?.employee_id ?? null,
        mapped: { branch_id, position_code },
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "enrich failed" }, { status: 500 });
    }
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ items: [] });
  try {
    const items = await searchDirectory(q.trim());
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "search failed", items: [] }, { status: 500 });
  }
}
