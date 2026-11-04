import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpsertBody {
  id?: string;
  email?: string;
  display_name?: string;
  nickname?: string;
  role?: string;
  data_scope?: string;
  branch_ids?: string[];
  max_discount_percent?: number;
  permission_overrides?: Record<string, string>;
  pin?: string;
  photo_url?: string | null;
  is_active?: boolean;
}

// รายชื่อผู้ใช้ทั้งหมด (จาก employees) + PIN + สิทธิ์ละเอียด + สาขา
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();
  const [{ data: emps, error }, { data: ebs }] = await Promise.all([
    sb.from("employees").select(
      "id,employee_code,email,first_name,last_name,nickname,role,data_scope,home_branch_id,status,pin_plain,permission_overrides,photo_url,max_discount_percent,can_open_drawer"
    ),
    sb.from("employee_branches").select("employee_id,branch_id"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byEmp: Record<string, string[]> = {};
  for (const r of ebs ?? []) (byEmp[r.employee_id] ??= []).push(r.branch_id);
  const users = (emps ?? []).map((e) => ({
    id: e.id,
    employee_code: e.employee_code,
    email: e.email,
    display_name: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname || e.email,
    nickname: e.nickname,
    role: e.role,
    data_scope: e.data_scope,
    home_branch_id: e.home_branch_id,
    branch_ids: byEmp[e.id] ?? [],
    status: e.status,
    pin: e.pin_plain ?? null,
    permission_overrides: e.permission_overrides ?? {},
    photo_url: e.photo_url,
    max_discount_percent: Number(e.max_discount_percent ?? 0),
    can_open_drawer: !!e.can_open_drawer,
  }));
  return NextResponse.json({ users });
}

// เพิ่ม/แก้ไขผู้ใช้ (employee) — ตั้ง role + สิทธิ์ + PIN + สาขา ในที่เดียว
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const email = b.email?.trim().toLowerCase() || null;
  if (!b.id && !email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (b.pin !== undefined && b.pin !== "" && !/^\d{4,6}$/.test(b.pin))
    return NextResponse.json({ error: "PIN ต้องเป็นตัวเลข 4-6 หลัก" }, { status: 400 });

  const sb = supabaseAdmin();

  // หา employee เดิม (ด้วย id หรือ email)
  let existing: any = null;
  if (b.id) {
    existing = (await sb.from("employees").select("*").eq("id", b.id).maybeSingle()).data;
  } else if (email) {
    existing = (await sb.from("employees").select("*").ilike("email", email).maybeSingle()).data;
  }

  const branchIds = b.branch_ids ?? [];
  const row: Record<string, any> = {
    employee_code: existing?.employee_code ?? email ?? `emp-${Date.now()}`,
    first_name: b.display_name ?? existing?.first_name ?? email ?? "ผู้ใช้",
    nickname: b.nickname ?? b.display_name ?? existing?.nickname ?? null,
    email: email ?? existing?.email ?? null,
    role: b.role ?? existing?.role ?? "staff",
    data_scope: b.data_scope ?? existing?.data_scope ?? "branch",
    home_branch_id: branchIds[0] ?? existing?.home_branch_id ?? null,
    max_discount_percent: b.max_discount_percent ?? existing?.max_discount_percent ?? 0,
    permission_overrides: b.permission_overrides ?? existing?.permission_overrides ?? {},
    photo_url: b.photo_url ?? existing?.photo_url ?? null,
    status: b.is_active === false ? "suspended" : "active",
    updated_at: new Date().toISOString(),
  };

  let empId: string;
  if (existing) {
    const { error } = await sb.from("employees").update(row).eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    empId = existing.id;
  } else {
    const { data, error } = await sb.from("employees").insert(row).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    empId = data.id;
  }

  // แทนที่รายการสาขา
  await sb.from("employee_branches").delete().eq("employee_id", empId);
  if (branchIds.length) {
    await sb.from("employee_branches").insert(branchIds.map((bid, i) => ({ employee_id: empId, branch_id: bid, is_primary: i === 0 })));
  }

  // ตั้ง PIN (ถ้าส่งมา) — set ทั้งเลขที่ดูได้ + hash
  if (b.pin) {
    const { error } = await sb.rpc("admin_set_employee_pin", { p_id: empId, p_pin: b.pin });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: empId });
}

// ปิดใช้งาน (ไม่ลบจริง เพื่อคงประวัติขาย/audit)
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin().from("employees").update({ status: "suspended" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
