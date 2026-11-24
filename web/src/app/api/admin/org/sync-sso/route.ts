import { NextRequest, NextResponse } from "next/server";
import { requireEmployeeAdmin } from "@/lib/sso/guard";
import { getDirectoryUser } from "@/lib/sso/central";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { jobTitleToPositionCode } from "@/lib/sso/map-central";
import type { CentralPerson } from "@/lib/sso/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ซิงก์ "สายบังคับบัญชา" จาก SSO/Lark (manager_union_id) → employees + org_positions
//   1) เติม/อัปเดต manager_union_id, job_title, central_department, email (ถ้าว่าง), รูป (ถ้าว่าง) ของทุกคนที่ผูก SSO
//   2) ไล่หัวหน้าขึ้นไปทีละขั้น (สูงสุด 8 ชั้น กันวน) → หัวหน้าที่ยังไม่มีในระบบ สร้าง employee ขั้นต่ำ (app_access=false = อยู่ในผังเท่านั้น)
//   3) ต่อสาขา: ทุกคนในผัง (+ คนที่ home_branch = สาขานี้แต่ยังไม่อยู่ในผัง) → reports_to = หัวหน้าตาม SSO
//      และให้หัวหน้า (และหัวหน้าของหัวหน้า …) มีตำแหน่งในผังสาขานั้นด้วย
//   idempotent · ไม่ลบแถวใด ๆ · ถ้า SSO ไม่มีหัวหน้า จะไม่แตะ reports_to เดิม (ที่ตั้งเอง)
//   POST { dryRun?: boolean }  (default = dryRun)
const MAX_DEPTH = 8;

type Emp = {
  id: string; first_name: string | null; email: string | null; union_id: string | null; employee_code: string;
  home_branch_id: string | null; job_title: string | null; manager_union_id: string | null;
  central_department: string | null; photo_url: string | null; status: string;
};
type Pos = { id: string; branch_id: string; employee_id: string; title: string | null; reports_to: string | null; sort_order: number | null };

export async function POST(req: NextRequest) {
  const ctx = await requireEmployeeAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const [{ data: empRows, error: eErr }, { data: posRows, error: pErr }, { data: branchRows }] = await Promise.all([
    sb.from("employees").select("id, first_name, email, union_id, employee_code, home_branch_id, job_title, manager_union_id, central_department, photo_url, status"),
    sb.from("org_positions").select("id, branch_id, employee_id, title, reports_to, sort_order"),
    sb.from("branches").select("id, name, branch_type"),
  ]);
  if (eErr || pErr) return NextResponse.json({ error: (eErr ?? pErr)!.message }, { status: 500 });
  const emps = (empRows ?? []) as Emp[];
  const positions = (posRows ?? []) as Pos[];
  const branchName = new Map((branchRows ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));

  const byId = new Map(emps.map((e) => [e.id, e]));
  const byUnion = new Map<string, Emp>();
  const byEmail = new Map<string, Emp>();
  const codes = new Set(emps.map((e) => e.employee_code));
  for (const e of emps) {
    if (e.union_id) byUnion.set(e.union_id, e);
    if (e.email?.includes("@")) byEmail.set(e.email.toLowerCase(), e);
  }
  const nameOf = (id: string | null) => (id ? byId.get(id)?.first_name ?? id : null);

  // ---- SSO profile cache (ฝั่งเซิร์ฟเวอร์เท่านั้น) ----
  const cache = new Map<string, CentralPerson | null>();
  async function fetchPerson(q: { union_id?: string | null; email?: string | null }): Promise<CentralPerson | null> {
    const key = q.union_id ? `u:${q.union_id}` : q.email ? `e:${q.email.toLowerCase()}` : "";
    if (!key) return null;
    if (cache.has(key)) return cache.get(key)!;
    let p: CentralPerson | null = null;
    try { p = await getDirectoryUser(q.union_id ? { union_id: q.union_id } : { email: q.email! }); } catch { p = null; }
    // union_id ไม่เจอ → ลองอีเมล
    if (!p && q.union_id && q.email?.includes("@")) {
      try { p = await getDirectoryUser({ email: q.email }); } catch { p = null; }
    }
    cache.set(key, p);
    if (p?.union_id) cache.set(`u:${p.union_id}`, p);
    return p;
  }

  const stats = { employeesUpdated: 0, managersCreated: 0, managersLinked: 0, positionsCreated: 0, reportsToChanged: 0, ssoNotFound: 0 };
  const changes: string[] = [];
  const noManager: string[] = [];
  const notFound: string[] = [];
  const errors: string[] = [];

  // ---- 1) เติมข้อมูล SSO ให้คนที่มีอยู่ ----
  const profileOf = new Map<string, CentralPerson>(); // employee id -> profile
  for (const e of emps) {
    if (e.status !== "active") continue;
    if (!e.union_id && !e.email?.includes("@")) continue;
    const p = await fetchPerson({ union_id: e.union_id, email: e.email });
    if (!p) { stats.ssoNotFound++; notFound.push(e.first_name ?? e.id); continue; }
    profileOf.set(e.id, p);
    const patch: Record<string, unknown> = {};
    if (p.union_id && !e.union_id) patch.union_id = p.union_id;
    const mgr = p.manager_union_id || null;
    if (mgr !== (e.manager_union_id ?? null)) patch.manager_union_id = mgr;
    // job_title/แผนก: ไม่ทับค่าที่ /api/admin/sso-sync เติมจาก assignment (GoodHR) — แทนเฉพาะค่าว่าง
    //   หรือค่าที่ setup-pc ใส่เดาไว้ ("หัวหน้าทีมขาย" / แผนก "Brand Shop" ของคนที่ไม่ใช่บัญชีหน้าร้าน)
    const placeholderTitle = !e.job_title || e.job_title === "หัวหน้าทีมขาย";
    if (p.job_title && p.job_title !== e.job_title && placeholderTitle) patch.job_title = p.job_title;
    const dept = p.departments?.[0];
    if (dept && dept !== e.central_department && (!e.central_department || e.central_department === "Brand Shop")) patch.central_department = dept;
    if (!e.email?.includes("@") && p.email?.includes("@") && !byEmail.has(p.email.toLowerCase())) patch.email = p.email;
    if (!e.photo_url && p.avatar_url) patch.photo_url = p.avatar_url;
    if (!mgr) noManager.push(e.first_name ?? e.id);
    if (Object.keys(patch).length) {
      changes.push(`อัปเดต ${e.first_name}: ${Object.keys(patch).join(", ")}`);
      if (!dryRun) {
        const { error } = await sb.from("employees").update({ ...patch, sso_synced_at: now }).eq("id", e.id);
        if (error) { errors.push(`${e.first_name}: ${error.message}`); continue; }
      }
      Object.assign(e, patch);
      if (patch.union_id) byUnion.set(p.union_id, e);
      if (patch.email) byEmail.set(String(patch.email).toLowerCase(), e);
      stats.employeesUpdated++;
    }
  }

  // ---- 2) ไล่หัวหน้าขึ้นไป + สร้างคนที่ยังไม่มี ----
  async function ensureManager(uid: string): Promise<Emp | null> {
    const ex = byUnion.get(uid);
    if (ex) return ex;
    const p = await fetchPerson({ union_id: uid });
    if (!p) { notFound.push(`manager ${uid.slice(0, 12)}…`); return null; }
    // มีคนนี้ด้วยอีเมลแล้ว → ผูก union_id
    const viaEmail = p.email ? byEmail.get(p.email.toLowerCase()) : undefined;
    if (viaEmail) {
      const patch = { union_id: uid, manager_union_id: p.manager_union_id || null, job_title: p.job_title || viaEmail.job_title };
      changes.push(`ผูก union_id หัวหน้า ${viaEmail.first_name}`);
      if (!dryRun) await sb.from("employees").update({ ...patch, sso_synced_at: now }).eq("id", viaEmail.id);
      Object.assign(viaEmail, patch);
      byUnion.set(uid, viaEmail);
      profileOf.set(viaEmail.id, p);
      stats.managersLinked++;
      return viaEmail;
    }
    let code = p.email || uid;
    if (codes.has(code)) code = `sso:${uid}`;
    const row = {
      employee_code: code, first_name: p.name, nickname: p.name, email: p.email || null, union_id: uid,
      role: "supervisor", data_scope: "brand", status: "active", app_access: false,
      photo_url: p.avatar_url ?? null, job_title: p.job_title || null, central_department: p.departments?.[0] ?? null,
      manager_union_id: p.manager_union_id || null, home_branch_id: null, sso_synced_at: now,
    };
    let id = `new:${uid}`;
    if (!dryRun) {
      const { data, error } = await sb.from("employees").insert(row).select("id").single();
      if (error || !data) { errors.push(`สร้าง ${p.name}: ${error?.message ?? "insert failed"}`); return null; }
      id = data.id as string;
    }
    codes.add(code);
    const emp: Emp = { id, first_name: p.name, email: row.email, union_id: uid, employee_code: code, home_branch_id: null, job_title: row.job_title, manager_union_id: row.manager_union_id, central_department: row.central_department, photo_url: row.photo_url, status: "active" };
    emps.push(emp); byId.set(id, emp); byUnion.set(uid, emp);
    if (emp.email) byEmail.set(emp.email.toLowerCase(), emp);
    profileOf.set(id, p);
    stats.managersCreated++;
    changes.push(`สร้างหัวหน้า ${p.name}${p.job_title ? ` (${p.job_title})` : ""}`);
    return emp;
  }

  const starts = [...emps];
  for (const e of starts) {
    let uid = e.manager_union_id;
    const seen = new Set<string>([e.union_id ?? e.id]);
    for (let d = 0; uid && d < MAX_DEPTH && !seen.has(uid); d++) {
      seen.add(uid);
      const m = await ensureManager(uid);
      if (!m) break;
      uid = m.manager_union_id;
    }
  }

  // ---- 3) ผังต่อสาขา ----
  const posKey = (b: string, emp: string) => `${b}|${emp}`;
  const posMap = new Map(positions.map((p) => [posKey(p.branch_id, p.employee_id), p]));
  const branchesWithPeople = new Set<string>(positions.map((p) => p.branch_id));
  for (const e of emps) if (e.status === "active" && e.home_branch_id) branchesWithPeople.add(e.home_branch_id);

  const titleFor = (e: Emp) => jobTitleToPositionCode(e.job_title ?? undefined) ?? (e.central_department === "Brand Shop" ? "pc" : "");

  async function ensurePos(branchId: string, e: Emp, sortOrder: number): Promise<Pos | null> {
    const ex = posMap.get(posKey(branchId, e.id));
    if (ex) return ex;
    const row = { branch_id: branchId, employee_id: e.id, title: titleFor(e), reports_to: null as string | null, sort_order: sortOrder };
    let id = `new:${branchId}:${e.id}`;
    if (!dryRun) {
      if (e.id.startsWith("new:")) return null;
      const { data, error } = await sb.from("org_positions").insert(row).select("id").single();
      if (error || !data) { errors.push(`ตำแหน่ง ${e.first_name} @ ${branchName.get(branchId)}: ${error?.message ?? "insert failed"}`); return null; }
      id = data.id as string;
    }
    const p: Pos = { id, ...row };
    posMap.set(posKey(branchId, e.id), p);
    stats.positionsCreated++;
    changes.push(`เพิ่มเข้าผัง ${branchName.get(branchId)}: ${e.first_name}`);
    return p;
  }

  const perBranch: Record<string, { members: number; linked: number }> = {};
  for (const branchId of branchesWithPeople) {
    // สมาชิกเริ่มต้น = คนที่มีตำแหน่งในสาขานี้ + คน home_branch นี้ที่ยังไม่มีตำแหน่ง
    const queue: Emp[] = [];
    for (const p of positions) if (p.branch_id === branchId) { const e = byId.get(p.employee_id); if (e) queue.push(e); }
    for (const e of emps) {
      if (e.status === "active" && e.home_branch_id === branchId && !posMap.has(posKey(branchId, e.id))) {
        const p = await ensurePos(branchId, e, 10);
        if (p) queue.push(e);
      }
    }
    const done = new Set<string>();
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const e = queue.shift()!;
      if (done.has(e.id)) continue;
      done.add(e.id);
      const mUid = e.manager_union_id;
      if (!mUid || mUid === e.union_id) continue;
      const m = byUnion.get(mUid);
      if (!m || m.id === e.id) continue;
      const myPos = posMap.get(posKey(branchId, e.id));
      if (!myPos) continue;
      // หัวหน้าต้องอยู่ในผังสาขานี้ด้วย (ชั้นบน)
      const mPos = await ensurePos(branchId, m, 0);
      if (!mPos) continue;
      if (myPos.reports_to !== m.id) {
        changes.push(`${branchName.get(branchId)}: ${e.first_name} → รายงานต่อ ${m.first_name} (เดิม ${nameOf(myPos.reports_to) ?? "—"})`);
        if (!dryRun && !myPos.id.startsWith("new:")) {
          const { error } = await sb.from("org_positions").update({ reports_to: m.id }).eq("id", myPos.id);
          if (error) { errors.push(`reports_to ${e.first_name}: ${error.message}`); continue; }
        } else if (!dryRun && myPos.id.startsWith("new:")) continue;
        myPos.reports_to = m.id;
        stats.reportsToChanged++;
      }
      queue.push(m); // ไล่ต่อขึ้นไป (หัวหน้าของหัวหน้า)
    }
    const members = [...posMap.values()].filter((p) => p.branch_id === branchId);
    perBranch[branchName.get(branchId) ?? branchId] = { members: members.length, linked: members.filter((p) => p.reports_to).length };
  }

  return NextResponse.json({
    ok: errors.length === 0, dryRun, ...stats,
    changes, perBranch,
    noManagerInSso: noManager, notFound, errors,
  });
}
