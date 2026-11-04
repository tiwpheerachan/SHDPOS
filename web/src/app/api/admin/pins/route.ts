import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// รายชื่อพนักงาน + PIN (ดูได้ตามที่เจ้าของเลือก) — service role, เฉพาะแอดมิน
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();
  const [{ data: emps, error: e1 }, { data: ebs }] = await Promise.all([
    sb.from("employees").select("id,employee_code,first_name,last_name,nickname,role,home_branch_id,status,pin_plain"),
    sb.from("employee_branches").select("employee_id,branch_id"),
  ]);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  const byEmp: Record<string, string[]> = {};
  for (const r of ebs ?? []) (byEmp[r.employee_id] ??= []).push(r.branch_id);
  const employees = (emps ?? []).map((e) => ({
    id: e.id,
    employee_code: e.employee_code,
    first_name: e.first_name,
    last_name: e.last_name,
    nickname: e.nickname,
    role: e.role,
    home_branch_id: e.home_branch_id,
    branch_ids: byEmp[e.id] ?? [],
    status: e.status,
    pin: e.pin_plain ?? null,
  }));
  return NextResponse.json({ employees });
}

// ตั้ง/เปลี่ยน PIN
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { employee_id?: string; pin?: string } | null;
  const pin = (body?.pin ?? "").trim();
  if (!body?.employee_id) return NextResponse.json({ error: "employee_id required" }, { status: 400 });
  if (!/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "PIN ต้องเป็นตัวเลข 4-6 หลัก" }, { status: 400 });
  const { error } = await supabaseAdmin().rpc("admin_set_employee_pin", { p_id: body.employee_id, p_pin: pin });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
