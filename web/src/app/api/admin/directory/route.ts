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

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// POST — เพิ่มคนจาก directory ส่วนกลางเป็นพนักงาน "org-only" (login ไม่ได้) + ใส่เข้าผังสาขา
//   body: { branch_id, email? , union_id? }
export async function POST(req: NextRequest) {
  const ctx = await requireEmployeeAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isUuid(b.branch_id)) return NextResponse.json({ error: "branch_id required" }, { status: 400 });
  const branchId = b.branch_id as string;
  const ident = (typeof b.email === "string" && b.email) || (typeof b.union_id === "string" && b.union_id) || "";
  if (!ident) return NextResponse.json({ error: "email หรือ union_id จำเป็น" }, { status: 400 });

  const sb = supabaseAdmin();
  try {
    const [person, eff] = await Promise.all([
      getDirectoryUser(ident.includes("@") ? { email: ident } : { union_id: ident }),
      getEffective(ident),
    ]);
    if (!person) return NextResponse.json({ error: "ไม่พบใน directory" }, { status: 404 });
    const a = (eff?.assignments ?? []).find((x) => x.is_primary) ?? (eff?.assignments ?? [])[0] ?? null;
    const department = a?.department ?? person.departments?.[0] ?? null;
    const email = person.email || (ident.includes("@") ? ident : null);

    // หาคนเดิม (union_id หรือ email)
    let empId: string | null = null;
    if (person.union_id) {
      const { data } = await sb.from("employees").select("id").eq("union_id", person.union_id).maybeSingle();
      empId = data?.id ?? null;
    }
    if (!empId && email) {
      const { data } = await sb.from("employees").select("id").ilike("email", email).maybeSingle();
      empId = data?.id ?? null;
    }

    const common = {
      union_id: person.union_id ?? null,
      job_title: a?.job_title ?? person.job_title ?? null,
      manager_union_id: person.manager_union_id ?? null,
      central_branch: a?.branch ?? null,
      central_department: department,
      sso_synced_at: new Date().toISOString(),
      photo_url: person.avatar_url ?? null,
    };

    if (empId) {
      await sb.from("employees").update(common).eq("id", empId);
    } else {
      const { data, error } = await sb
        .from("employees")
        .insert({
          employee_code: email || person.union_id,
          first_name: person.name,
          nickname: person.name,
          email,
          role: "staff",
          data_scope: "own",
          status: "active",
          app_access: false, // org-only — login ไม่ได้
          home_branch_id: branchId,
          ...common,
        })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      empId = data.id;
    }

    // reports_to: ถ้าหัวหน้า (manager_union_id) เป็นพนักงานในระบบแล้ว
    let reports_to: string | null = null;
    if (person.manager_union_id) {
      const { data: mgr } = await sb.from("employees").select("id").eq("union_id", person.manager_union_id).maybeSingle();
      reports_to = mgr?.id ?? null;
    }
    await sb.from("org_positions").upsert(
      { branch_id: branchId, employee_id: empId, title: jobTitleToPositionCode(a?.job_title ?? person.job_title) ?? "", reports_to, sort_order: 0, updated_at: new Date().toISOString() },
      { onConflict: "branch_id,employee_id" }
    );

    return NextResponse.json({ ok: true, employee_id: empId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "add failed" }, { status: 500 });
  }
}
