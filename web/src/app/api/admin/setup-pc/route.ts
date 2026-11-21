import { NextRequest, NextResponse } from "next/server";
import { requireEmployeeAdmin } from "@/lib/sso/guard";
import { getDirectoryUser } from "@/lib/sso/central";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ตั้งค่า PC หน้าร้าน (central_department='Brand Shop') ให้ "เข้าใช้จริง" ได้:
//  1) app_access=true + app_user_grants (role staff = พนักงานขาย, is_active) → login + ขายได้
//  2) org_positions → อยู่ในผังสาขา
//  3) ดึงหัวหน้าจาก Lark → สร้าง/ผูกเป็นหัวหน้าสูงสุดของสาขา + PC reports_to หัวหน้า
//  POST { dryRun?: boolean }
export async function POST(req: NextRequest) {
  const ctx = await requireEmployeeAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false;
  const sb = supabaseAdmin();

  const { data: pcs } = await sb.from("employees")
    .select("id, first_name, email, union_id, home_branch_id, photo_url")
    .eq("central_department", "Brand Shop").eq("status", "active");
  const list = (pcs ?? []).filter((e) => e.home_branch_id);

  const report: { pc: string; granted: boolean; positioned: boolean; manager: string | null }[] = [];
  let grants = 0, positions = 0, managersCreated = 0;

  // cache ตำแหน่งหัวหน้าต่อสาขา (ไม่สร้างซ้ำ)
  const mgrPosByBranch = new Map<string, string>();     // branchId -> org_positions.id ของหัวหน้า
  const mgrEmpByUnion = new Map<string, string>();       // manager union_id -> employee.id

  for (const pc of list) {
    const branchId = pc.home_branch_id as string;
    let managerName: string | null = null;
    let mgrPosId: string | null = null;
    let mgrEmpForPc: string | null = null; // employee id ของหัวหน้า (reports_to ชี้ employees ไม่ใช่ position)

    // --- หัวหน้าจาก Lark ---
    try {
      const person = await getDirectoryUser(pc.email?.includes("@") ? { email: pc.email } : { union_id: pc.union_id ?? undefined });
      const mUid = person?.manager_union_id ?? null;
      const mName = (person as { manager?: string } | null)?.manager ?? null;
      if (mUid && mName) {
        managerName = mName;
        // 1) หัวหน้าเป็นพนักงานหรือยัง
        let mgrEmpId = mgrEmpByUnion.get(mUid) ?? null;
        if (!mgrEmpId) {
          const { data: ex } = await sb.from("employees").select("id").eq("union_id", mUid).maybeSingle();
          mgrEmpId = ex?.id ?? null;
          // ดึงโปรไฟล์หัวหน้า (เอา email/รูป) เพื่อสร้าง + grant ได้
          const mgrP = await getDirectoryUser({ union_id: mUid }).catch(() => null);
          const mgrEmail = mgrP?.email ?? null;
          if (!mgrEmpId && !dryRun) {
            const { data: ins } = await sb.from("employees").insert({
              employee_code: mgrEmail || mUid, first_name: mName, nickname: mName, email: mgrEmail, union_id: mUid,
              role: "supervisor", data_scope: "brand", status: "active", app_access: true, photo_url: mgrP?.avatar_url ?? null,
              job_title: "หัวหน้าทีมขาย", central_department: "Brand Shop", home_branch_id: branchId,
            }).select("id").single();
            mgrEmpId = ins?.id ?? null;
            if (mgrEmpId) managersCreated++;
          }
          if (mgrEmpId) mgrEmpByUnion.set(mUid, mgrEmpId);
          // grant หัวหน้า (supervisor) — ต้องมี email (PK)
          if (mgrEmpId && mgrEmail && !dryRun) {
            await sb.from("app_user_grants").upsert({
              email: mgrEmail, union_id: mUid, display_name: mName, avatar_url: mgrP?.avatar_url ?? null,
              role: "supervisor", data_scope: "brand", branch_ids: [branchId], brand_ids: [], is_active: true, updated_by: "setup-pc",
            }, { onConflict: "email" });
          }
        }
        mgrEmpForPc = mgrEmpId; // ใช้เป็น reports_to ของ PC
        // 2) ตำแหน่งหัวหน้าในสาขานี้ (top, reports_to null)
        if (mgrEmpId) {
          mgrPosId = mgrPosByBranch.get(branchId) ?? null;
          if (!mgrPosId) {
            const { data: exPos } = await sb.from("org_positions").select("id").eq("branch_id", branchId).eq("employee_id", mgrEmpId).maybeSingle();
            mgrPosId = exPos?.id ?? null;
            if (!mgrPosId && !dryRun) {
              const { data: insPos } = await sb.from("org_positions").insert({
                branch_id: branchId, employee_id: mgrEmpId, title: "หัวหน้าทีมขาย", reports_to: null, sort_order: 0,
              }).select("id").single();
              mgrPosId = insPos?.id ?? null;
              if (mgrPosId) positions++;
            }
            if (mgrPosId) mgrPosByBranch.set(branchId, mgrPosId);
          }
        }
      }
    } catch { /* ไม่มีหัวหน้า/ดึงไม่ได้ */ }

    // --- PC: สิทธิ์ขาย + ผัง ---
    const noEmail = !pc.email || !String(pc.email).includes("@");
    if (!dryRun) {
      await sb.from("employees").update({ app_access: true, role: "staff" }).eq("id", pc.id);
      // grant ต้องมี email (PK) — ร้านที่ email ว่างจะ login ไม่ได้ (ต้องเติม email ก่อน)
      if (!noEmail) {
        const { error: gErr } = await sb.from("app_user_grants").upsert({
          email: pc.email, union_id: pc.union_id, display_name: pc.first_name, avatar_url: pc.photo_url,
          role: "staff", data_scope: "own", branch_ids: [branchId], brand_ids: [], is_active: true, updated_by: "setup-pc",
        }, { onConflict: "email" });
        if (!gErr) grants++;
      }
      // org position ของ PC (reports_to หัวหน้า ถ้ามี)
      const { data: exPcPos } = await sb.from("org_positions").select("id").eq("branch_id", branchId).eq("employee_id", pc.id).maybeSingle();
      if (exPcPos?.id) { await sb.from("org_positions").update({ title: "พนักงานขาย (PC)", reports_to: mgrEmpForPc }).eq("id", exPcPos.id); }
      else { const { error: pErr } = await sb.from("org_positions").insert({ branch_id: branchId, employee_id: pc.id, title: "พนักงานขาย (PC)", reports_to: mgrEmpForPc, sort_order: 10 }); if (!pErr) positions++; }
    } else { grants++; positions++; }

    report.push({ pc: pc.first_name as string, granted: !noEmail, positioned: true, manager: managerName });
  }

  const noEmailList = report.filter((r) => !r.granted).map((r) => r.pc);
  return NextResponse.json({ ok: true, dryRun, pcCount: list.length, grants, positions, managersCreated, noEmailCount: noEmailList.length, noEmailList, report });
}
