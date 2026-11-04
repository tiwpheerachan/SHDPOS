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

/** รวมสิทธิ์: superadmin > grant ที่ active > ไม่มีสิทธิ์ */
export async function resolveAuthz(profile: SsoSessionProfile): Promise<AppAuthz> {
  if (isSuperadmin(profile.email)) {
    return {
      allowed: true,
      isSuperadmin: true,
      role: "hq",
      data_scope: "company",
      branch_ids: [],
      brand_ids: [],
      max_discount_percent: 100,
      permission_overrides: {},
    };
  }
  const grant = await getGrant(profile.email);
  if (!grant || !grant.is_active) {
    return {
      allowed: false,
      isSuperadmin: false,
      role: grant?.role ?? "staff",
      data_scope: grant?.data_scope ?? "branch",
      branch_ids: grant?.branch_ids ?? [],
      brand_ids: grant?.brand_ids ?? [],
      max_discount_percent: grant?.max_discount_percent ?? 0,
      permission_overrides: grant?.permission_overrides ?? {},
    };
  }
  return {
    allowed: true,
    isSuperadmin: false,
    role: grant.role,
    data_scope: grant.data_scope,
    branch_ids: grant.branch_ids,
    brand_ids: grant.brand_ids,
    max_discount_percent: grant.max_discount_percent,
    permission_overrides: grant.permission_overrides,
  };
}
