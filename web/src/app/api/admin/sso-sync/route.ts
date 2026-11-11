import { NextRequest, NextResponse } from "next/server";
import { requireEmployeeAdmin } from "@/lib/sso/guard";
import { getDirectoryUser, getEffective } from "@/lib/sso/central";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { matchOurBranch } from "@/lib/sso/map-central";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ดึงข้อมูลจากระบบกลาง (Lark/GoodHR) มาเติมให้พนักงานในแอป
//   เติม: union_id, job_title, manager_union_id, central_branch, central_department
//         + home_branch_id (ถ้าแมปสาขาได้) + photo_url (ถ้ายังไม่มี)
export async function POST(req: NextRequest) {
  const ctx = await requireEmployeeAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();

  const [{ data: emps, error }, { data: branches }, { data: brands }] = await Promise.all([
    sb.from("employees").select("id, employee_code, email, photo_url, home_branch_id").eq("status", "active"),
    sb.from("branches").select("id,name,name_th,brand_id"),
    sb.from("brands").select("id,name"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // อีเมลจริงอยู่ที่ employee_code (SSO ใช้ email เป็นรหัส) หรือ email
  const emailOf = (e: Record<string, unknown>) => {
    const c = (e.email as string) || (e.employee_code as string) || "";
    return c.includes("@") ? c : "";
  };

  let synced = 0, branchMatched = 0, skipped = 0;
  const details: { code: string; branch: string | null; title: string | null; mapped: boolean }[] = [];

  for (const e of emps ?? []) {
    const email = emailOf(e);
    if (!email) { skipped++; continue; }
    try {
      const [person, eff] = await Promise.all([getDirectoryUser({ email }), getEffective(email)]);
      if (!person && !eff) { skipped++; continue; }
      const a = (eff?.assignments ?? []).find((x) => x.is_primary) ?? (eff?.assignments ?? [])[0] ?? null;
      const department = a?.department ?? person?.departments?.[0] ?? null;
      const branchId = matchOurBranch(a?.branch, department ?? undefined, branches ?? [], brands ?? []);

      const patch: Record<string, unknown> = {
        union_id: person?.union_id ?? null,
        job_title: a?.job_title ?? person?.job_title ?? null,
        manager_union_id: person?.manager_union_id ?? null,
        central_branch: a?.branch ?? null,
        central_department: department,
        sso_synced_at: new Date().toISOString(),
      };
      // เติมสาขาหลักถ้ายังไม่มี และแมปได้
      if (branchId && !e.home_branch_id) patch.home_branch_id = branchId;
      // เติมรูปถ้ายังไม่มี
      if (!e.photo_url && person?.avatar_url) patch.photo_url = person.avatar_url;

      const { error: upErr } = await sb.from("employees").update(patch).eq("id", e.id);
      if (upErr) { skipped++; continue; }
      synced++;
      if (branchId) branchMatched++;
      details.push({ code: e.employee_code as string, branch: a?.branch ?? null, title: (a?.job_title ?? person?.job_title) ?? null, mapped: !!branchId });
    } catch { skipped++; }
  }

  return NextResponse.json({ ok: true, total: (emps ?? []).length, synced, branchMatched, skipped, details });
}
