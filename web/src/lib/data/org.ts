// =====================================================================
// ผังองค์กร (org chart) — อ่าน/เขียนตำแหน่ง+สายบังคับบัญชาต่อสาขา
//   พนักงาน/สาขา id จริง (UUID) + live  → เก็บใน DB ผ่าน RPC (pos_org_*)
//   id แบบ demo (ไม่ใช่ UUID) หรือ offline → เก็บใน localStorage
//   โหลดจะรวมทั้งสองแหล่ง เพื่อให้ใช้งานได้ทุกสภาพแวดล้อม
//   พนักงานในสาขาดึงจาก directory ในเครื่อง (listEmployees)
// =====================================================================
import { supabase, isLiveMode } from "@/lib/supabase/client";
import { listEmployees } from "./repo";

export interface OrgEmp { id: string; code: string; name: string; full_name: string; role: string; photo_url: string | null }
export interface OrgPos { id: string; employee_id: string; title: string; reports_to: string | null; sort_order: number }

const isUuid = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const LS_KEY = (branchId: string) => `shdpos.org.${branchId}`;

function readLS(branchId: string): OrgPos[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY(branchId)) || "[]") as OrgPos[]; }
  catch { return []; }
}
function writeLS(branchId: string, rows: OrgPos[]) {
  try { localStorage.setItem(LS_KEY(branchId), JSON.stringify(rows)); } catch { /* private mode */ }
}
/** employee id นี้ควรเก็บลง DB ไหม (จริง+live) หรือ localStorage (demo/offline) */
const useDb = (branchId: string, employeeId: string) => isLiveMode() && isUuid(branchId) && isUuid(employeeId);

export async function loadOrg(branchId: string): Promise<{ employees: OrgEmp[]; positions: OrgPos[] }> {
  const all = await listEmployees();
  // แสดงพนักงาน active "ทั้งหมดในระบบ" เป็น pool ให้เลือกเข้าผังแต่ละสาขา
  //   (พนักงานจริงจาก Lark/SSO ยังไม่ถูกผูกสาขา การเพิ่มเข้าผัง = สร้างความเชื่อมโยง)
  //   เรียงคนที่ผูกกับสาขานี้ (home_branch/branch_ids) ขึ้นก่อน
  const linked = (e: { home_branch_id?: string | null; branch_ids?: string[] }) =>
    e.home_branch_id === branchId || (e.branch_ids ?? []).includes(branchId);
  const employees: OrgEmp[] = all
    .filter((e) => e.status === "active")
    .sort((a, b) => Number(linked(b)) - Number(linked(a)) || (a.first_name || "").localeCompare(b.first_name || ""))
    .map((e) => ({
      id: e.id,
      code: e.employee_code,
      name: e.nickname || e.first_name || e.employee_code,
      full_name: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname || "",
      role: e.role,
      photo_url: e.photo_url ?? null,
    }));

  // DB (พนักงานจริง) — ถ้า live + สาขาเป็น UUID
  const positions: OrgPos[] = [];
  const seen = new Set<string>();
  if (isLiveMode() && isUuid(branchId)) {
    const sb = supabase();
    if (sb) {
      const { data } = await sb.rpc("pos_org_positions", { p_branch_id: branchId });
      for (const p of (data as OrgPos[]) ?? []) { positions.push(p); seen.add(p.employee_id); }
    }
  }
  // รวม localStorage (รองรับ demo id) — ไม่ซ้ำกับ DB
  for (const r of readLS(branchId)) if (!seen.has(r.employee_id)) positions.push(r);
  return { employees, positions };
}

export async function upsertOrg(
  branchId: string,
  employeeId: string,
  patch: { title: string; reports_to: string | null; sort_order?: number }
): Promise<void> {
  const reports_to = patch.reports_to && patch.reports_to !== employeeId ? patch.reports_to : null;
  const sort_order = patch.sort_order ?? 0;
  if (useDb(branchId, employeeId)) {
    const sb = supabase();
    if (sb) {
      const { error } = await sb.rpc("pos_org_upsert", {
        p_branch_id: branchId, p_employee_id: employeeId,
        p_title: patch.title, p_reports_to: reports_to, p_sort_order: sort_order,
      });
      if (error) throw new Error(error.message);
      return;
    }
  }
  // demo / offline → localStorage
  const rows = readLS(branchId).filter((r) => r.employee_id !== employeeId);
  rows.push({ id: `${branchId}:${employeeId}`, employee_id: employeeId, title: patch.title, reports_to, sort_order });
  writeLS(branchId, rows);
}

export async function deleteOrg(branchId: string, employeeId: string): Promise<void> {
  if (useDb(branchId, employeeId)) {
    const sb = supabase();
    if (sb) await sb.rpc("pos_org_delete", { p_branch_id: branchId, p_employee_id: employeeId });
  }
  // เอาออกจาก localStorage ด้วยเสมอ (เผื่อเคยเก็บไว้)
  writeLS(branchId, readLS(branchId).filter((r) => r.employee_id !== employeeId));
}
