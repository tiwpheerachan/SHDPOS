import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------------
// GET — รายการงานติดตาม (กรองได้: status, assigned_to, customer_id, scope)
//   enrich: ชื่อลูกค้า + เบอร์ + ชื่อผู้รับผิดชอบ
// ---------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();
  const sp = req.nextUrl.searchParams;

  let q = sb
    .from("customer_tasks")
    .select("id,customer_id,branch_id,assigned_to,kind,title,note,due_date,status,ref_type,ref_id,result,completed_at,created_at")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const status = sp.get("status");
  if (status && status !== "all") q = q.eq("status", status);
  const customerId = sp.get("customer_id");
  if (customerId) q = q.eq("customer_id", customerId);
  const assignee = sp.get("assigned_to");
  if (assignee) q = q.eq("assigned_to", assignee);

  const { data: tasks, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // enrich ชื่อลูกค้า + ผู้รับผิดชอบ
  const custIds = [...new Set((tasks ?? []).map((t) => t.customer_id).filter(Boolean))];
  const empIds = [...new Set((tasks ?? []).map((t) => t.assigned_to).filter(isUuid))];
  const [{ data: custs }, { data: emps }] = await Promise.all([
    custIds.length ? sb.from("customers").select("id,name,phone").in("id", custIds) : Promise.resolve({ data: [] }),
    empIds.length ? sb.from("employees").select("id,first_name,nickname").in("id", empIds) : Promise.resolve({ data: [] }),
  ]);
  const cMap = Object.fromEntries((custs ?? []).map((c) => [c.id, c]));
  const eMap = Object.fromEntries((emps ?? []).map((e) => [e.id, e]));

  const rows = (tasks ?? []).map((t) => ({
    ...t,
    customer_name: cMap[t.customer_id]?.name ?? "—",
    customer_phone: cMap[t.customer_id]?.phone ?? null,
    assignee_name: t.assigned_to ? (eMap[t.assigned_to]?.nickname ?? eMap[t.assigned_to]?.first_name ?? null) : null,
  }));

  return NextResponse.json({ tasks: rows });
}

// ---------------------------------------------------------------------
// POST — สร้าง/แก้ไขงาน (มี id = แก้ไข). ปิดงาน: ส่ง status='done' + result
// ---------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });

  const actor = ctx.authz.employee_id;
  const actorId = isUuid(actor) ? actor : null;
  const sb = supabaseAdmin();

  // แก้ไข/ปิดงาน
  if (isUuid(b.id)) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["kind", "title", "note", "due_date", "assigned_to", "status", "result", "branch_id"]) {
      if (b[k] !== undefined) patch[k] = b[k] === "" ? null : b[k];
    }
    if (b.status === "done" && !b.completed_at) patch.completed_at = new Date().toISOString();
    const { error } = await sb.from("customer_tasks").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: b.id });
  }

  // สร้างใหม่
  if (!isUuid(b.customer_id)) return NextResponse.json({ error: "customer_id required" }, { status: 400 });
  if (!b.title || typeof b.title !== "string" || !b.title.trim())
    return NextResponse.json({ error: "title required" }, { status: 400 });

  const row = {
    customer_id: b.customer_id,
    branch_id: isUuid(b.branch_id) ? b.branch_id : null,
    assigned_to: isUuid(b.assigned_to) ? b.assigned_to : null,
    kind: typeof b.kind === "string" ? b.kind : "follow_up",
    title: b.title.trim(),
    note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : null,
    due_date: typeof b.due_date === "string" && b.due_date ? b.due_date : null,
    ref_type: typeof b.ref_type === "string" ? b.ref_type : null,
    ref_id: isUuid(b.ref_id) ? b.ref_id : null,
    created_by: actorId,
  };
  const { data, error } = await sb.from("customer_tasks").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

// ---------------------------------------------------------------------
// DELETE — ลบงาน (?id=)
// ---------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin().from("customer_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
