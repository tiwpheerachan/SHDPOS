// จัดการสิทธิ์รายคน (ตาราง app_user_grants) — ฝั่งเซิร์ฟเวอร์เท่านั้น
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSuperadmin } from "@/lib/permissions";
import type { AppUserGrant, EmployeeRole, DataScope, PermissionEffect } from "@/lib/types";
import type { AppAuthz, SsoSessionProfile } from "./types";

const TABLE = "app_user_grants";

function rowToGrant(r: any): AppUserGrant {
  return {
    email: r.email,
    union_id: r.union_id ?? null,
    display_name: r.display_name ?? null,
    avatar_url: r.avatar_url ?? null,
    role: (r.role ?? "staff") as EmployeeRole,
    data_scope: (r.data_scope ?? "branch") as DataScope,
    branch_ids: r.branch_ids ?? [],
    brand_ids: r.brand_ids ?? [],
    max_discount_percent: Number(r.max_discount_percent ?? 0),
    permission_overrides: (r.permission_overrides ?? {}) as Record<string, PermissionEffect>,
    is_active: r.is_active ?? true,
    updated_by: r.updated_by ?? null,
    updated_at: r.updated_at,
  };
}

export async function getGrant(email: string): Promise<AppUserGrant | null> {
  const { data } = await supabaseAdmin().from(TABLE).select("*").eq("email", email.toLowerCase()).maybeSingle();
  return data ? rowToGrant(data) : null;
}

export async function listGrants(): Promise<AppUserGrant[]> {
  const { data } = await supabaseAdmin().from(TABLE).select("*").order("updated_at", { ascending: false });
  return (data ?? []).map(rowToGrant);
}

export async function upsertGrant(g: Partial<AppUserGrant> & { email: string }, updatedBy?: string): Promise<AppUserGrant> {
  const row = {
    email: g.email.toLowerCase(),
    union_id: g.union_id ?? null,
    display_name: g.display_name ?? null,
    avatar_url: g.avatar_url ?? null,
    role: g.role ?? "staff",
    data_scope: g.data_scope ?? "branch",
    branch_ids: g.branch_ids ?? [],
    brand_ids: g.brand_ids ?? [],
    max_discount_percent: g.max_discount_percent ?? 0,
    permission_overrides: g.permission_overrides ?? {},
    is_active: g.is_active ?? true,
    updated_by: updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin().from(TABLE).upsert(row, { onConflict: "email" }).select("*").single();
  if (error) throw new Error(error.message);
  return rowToGrant(data);
}

export async function deleteGrant(email: string): Promise<void> {
  await supabaseAdmin().from(TABLE).delete().eq("email", email.toLowerCase());
}

/** รวมสิทธิ์จากตาราง employees (ผูกด้วย email) — superadmin > employee active > ไม่มีสิทธิ์ */
export async function resolveAuthz(profile: SsoSessionProfile): Promise<AppAuthz> {
  const sb = supabaseAdmin();
  let emp: any = null;
  if (profile.email) {
    const { data } = await sb
      .from("employees")
      .select("id,role,data_scope,home_branch_id,max_discount_percent,permission_overrides,can_open_drawer,status")
      .ilike("email", profile.email)
      .maybeSingle();
    emp = data;
  }

  if (isSuperadmin(profile.email)) {
    return {
      allowed: true,
      isSuperadmin: true,
      employee_id: emp?.id ?? null,
      role: "hq",
      data_scope: "company",
      branch_ids: [],
      brand_ids: [],
      max_discount_percent: 100,
      can_open_drawer: true,
      permission_overrides: {},
    };
  }

  if (!emp || emp.status !== "active") {
    return {
      allowed: false,
      isSuperadmin: false,
      employee_id: emp?.id ?? null,
      role: emp?.role ?? "staff",
      data_scope: emp?.data_scope ?? "branch",
      branch_ids: [],
      brand_ids: [],
      max_discount_percent: Number(emp?.max_discount_percent ?? 0),
      permission_overrides: (emp?.permission_overrides ?? {}) as Record<string, string>,
    };
  }

  const [{ data: ebs }, { data: ebrs }] = await Promise.all([
    sb.from("employee_branches").select("branch_id").eq("employee_id", emp.id),
    sb.from("employee_brands").select("brand_id").eq("employee_id", emp.id),
  ]);
  const branchSet = new Set<string>((ebs ?? []).map((x: any) => x.branch_id));
  if (emp.home_branch_id) branchSet.add(emp.home_branch_id);
  return {
    allowed: true,
    isSuperadmin: false,
    employee_id: emp.id,
    role: emp.role,
    data_scope: emp.data_scope,
    branch_ids: [...branchSet],
    brand_ids: (ebrs ?? []).map((x: any) => x.brand_id),
    max_discount_percent: Number(emp.max_discount_percent ?? 0),
    can_open_drawer: !!emp.can_open_drawer,
    permission_overrides: (emp.permission_overrides ?? {}) as Record<string, string>,
  };
}
