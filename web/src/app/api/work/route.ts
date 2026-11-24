import { NextRequest, NextResponse } from "next/server";
import { workContext, workBranch } from "@/lib/server/work-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { object, UUID } from "@/lib/server/sale-validation";
export const dynamic = "force-dynamic";
const messages: Record<string, string> = {
  work_version_conflict: "งานถูกแก้จากอีกเครื่อง กรุณาโหลดใหม่",
  work_handoff_reason_required: "กรุณาระบุข้อความส่งต่ออย่างน้อย 3 ตัวอักษร",
  work_assignee_scope: "ผู้รับผิดชอบต้องมีสิทธิ์ในสาขาของงานและยังใช้งานอยู่",
  work_forbidden: "ไม่มีสิทธิ์ดูหรือแก้งานนี้",
  work_source_not_closed: "ต้องปิดบิลต้นทางก่อน งานนี้จะเสร็จตามบิลอัตโนมัติ",
  work_source_closed:
    "รายการต้นทางปิดแล้ว ไม่สามารถเปิดงานกลับโดยไม่เปลี่ยนต้นทาง",
  work_invalid_source: "รายการต้นทางไม่ถูกต้องหรือปิดแล้ว",
};
const fail = (e: unknown) =>
  NextResponse.json(
    {
      error:
        e instanceof Error
          ? messages[e.message] || e.message
          : "ดำเนินการไม่สำเร็จ",
    },
    { status: e instanceof PosError ? e.status : 409 },
  );
async function visible(sb: any, actor: string, id: string) {
  const r = await sb.rpc("pos_work_visible", { p_actor: actor, p_task: id });
  if (r.error) throw new PosError("ตรวจสิทธิ์งานไม่สำเร็จ", 503);
  if (!r.data) throw new PosError("ไม่มีสิทธิ์งานนี้", 403);
}
export async function GET(req: NextRequest) {
  try {
    const ctx = await workContext(req),
      sb = supabaseAdmin(),
      sp = req.nextUrl.searchParams,
      branch = sp.get("branch_id"),
      id = sp.get("id"),
      source = sp.get("source_id");
    if (branch) {
      if (!UUID.test(branch)) throw new PosError("สาขาไม่ถูกต้อง");
      workBranch(branch, ctx.branches);
    }
    if (sp.get("people") === "true") {
      if (!branch) throw new PosError("กรุณาเลือกสาขา");
      const r = await sb.rpc("pos_work_people", {
        p_actor: ctx.actor,
        p_branch: branch,
      });
      if (r.error) throw new PosError("อ่านผู้รับผิดชอบไม่สำเร็จ", 503);
      return NextResponse.json(
        { people: r.data },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    let q = sb.from("pos_work_items").select("*").order("id").limit(250);
    const cursor = sp.get("cursor");
    if (cursor) {
      if (!UUID.test(cursor)) throw new PosError("จุดอ่านต่อไม่ถูกต้อง");
      q = q.gt("id", cursor);
    }
    if (id) {
      if (!UUID.test(id)) throw new PosError("รหัสงานไม่ถูกต้อง");
      await visible(sb, ctx.actor, id);
      q = q.eq("id", id);
    } else {
      const personal = `created_by.eq.${ctx.actor},assigned_to.eq.${ctx.actor}`;
      if (!ctx.manager) q = q.or(personal);
      else if (ctx.branches !== null)
        q = q.or(
          ctx.branches.length
            ? `${personal},branch_id.in.(${ctx.branches.join(",")})`
            : personal,
        );
      if (ctx.branches !== null) {
        if (!ctx.branches.length)
          return NextResponse.json({
            items: [],
            branches: [],
            actor: ctx.actor,
            can_team: ctx.manager,
            has_more: false,
          });
        q = q.in("branch_id", ctx.branches);
      }
    }
    if (sp.get("kind") === "deferred_sale")
      q = q.eq("source_kind", "deferred_sale");
    if (branch) q = q.eq("branch_id", branch);
    if (source) {
      if (!UUID.test(source)) throw new PosError("รหัสต้นทางไม่ถูกต้อง");
      q = q.eq("source_kind", "deferred_sale").eq("source_id", source);
    }
    const tasks = await q;
    if (tasks.error)
      throw new PosError("อ่านงานไม่สำเร็จ กรุณาตรวจ migration 0046", 503);
    if (id && tasks.data[0]) workBranch(tasks.data[0].branch_id, ctx.branches);
    const ids = tasks.data.map((t) => t.id),
      empIds = [
        ...new Set(tasks.data.flatMap((t) => [t.created_by, t.assigned_to])),
      ];
    let bq = sb
      .from("branches")
      .select("id,name,name_th")
      .eq("is_active", true)
      .order("name");
    if (ctx.branches !== null)
      bq = bq.in(
        "id",
        ctx.branches.length
          ? ctx.branches
          : ["00000000-0000-0000-0000-000000000000"],
      );
    const [pins, emps, branches, activity] = await Promise.all([
      ids.length
        ? sb
            .from("pos_work_pins")
            .select("task_id")
            .eq("employee_id", ctx.actor)
            .in("task_id", ids)
        : Promise.resolve({ data: [], error: null }),
      empIds.length
        ? sb
            .from("employees")
            .select("id,first_name,last_name,nickname,photo_url")
            .in("id", empIds)
        : Promise.resolve({ data: [], error: null }),
      bq,
      id
        ? sb
            .from("pos_work_activity")
            .select("id,actor_id,action,body,created_at")
            .eq("task_id", id)
            .order("created_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if ([pins, emps, branches, activity].some((r) => r.error))
      throw new PosError("อ่านรายละเอียดงานไม่สำเร็จ", 503);
    const people = new Map((emps.data ?? []).map((e) => [e.id, e])),
      pinned = new Set((pins.data ?? []).map((p) => p.task_id));
    return NextResponse.json(
      {
        items: tasks.data.map((t) => ({
          ...t,
          pinned: pinned.has(t.id),
          assignee: people.get(t.assigned_to),
          creator: people.get(t.created_by),
        })),
        activity: activity.data,
        branches: branches.data,
        actor: ctx.actor,
        can_team: ctx.manager,
        has_more: tasks.data.length === 250,
        next_cursor: tasks.data.length === 250 ? tasks.data.at(-1)?.id : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const ctx = await workContext(req),
      b = object(await req.json()),
      sb = supabaseAdmin();
    if (!UUID.test(b.id)) throw new PosError("รหัสงานไม่ถูกต้อง");
    if (b.action === "pin") {
      await visible(sb, ctx.actor, b.id);
      const task = await sb
        .from("pos_work_items")
        .select("branch_id")
        .eq("id", b.id)
        .single();
      if (task.error) throw new PosError("ไม่พบงาน", 404);
      workBranch(task.data.branch_id, ctx.branches);
      if (typeof b.pinned !== "boolean")
        throw new PosError("สถานะปักหมุดไม่ถูกต้อง");
      const r = await sb.rpc("pos_work_pin", {
        p_actor: ctx.actor,
        p_task: b.id,
        p_pin: b.pinned,
      });
      if (r.error) throw Error(r.error.message);
      return NextResponse.json({ ok: true });
    }
    if (
      b.action !== "save" ||
      !Number.isSafeInteger(b.version) ||
      b.version < 0
    )
      throw new PosError("คำสั่งหรือเวอร์ชันไม่ถูกต้อง");
    const p = object(b.patch);
    const allowed = [
      "title",
      "description",
      "status",
      "priority",
      "due_at",
      "assigned_to",
      ...(b.version === 0 ? ["branch_id", "source_kind", "source_id"] : []),
    ];
    if (Object.keys(p).some((k) => !allowed.includes(k)))
      throw new PosError("มีข้อมูลที่ไม่อนุญาตให้แก้");
    if (b.version === 0) {
      if (!UUID.test(p.branch_id)) throw new PosError("กรุณาเลือกสาขา");
      workBranch(p.branch_id, ctx.branches);
    } else {
      await visible(sb, ctx.actor, b.id);
      const t = await sb
        .from("pos_work_items")
        .select("branch_id")
        .eq("id", b.id)
        .single();
      if (t.error) throw new PosError("ไม่พบงาน", 404);
      workBranch(t.data.branch_id, ctx.branches);
    }
    for (const key of ["title", "description"])
      if (
        key in p &&
        (typeof p[key] !== "string" ||
          p[key].length > (key === "title" ? 200 : 10000) ||
          (key === "title" && !p[key].trim()))
      )
        throw new PosError("ชื่องานหรือรายละเอียดไม่ถูกต้อง");
    if (
      p.status &&
      !["todo", "in_progress", "blocked", "done", "cancelled"].includes(
        p.status,
      )
    )
      throw new PosError("สถานะงานไม่ถูกต้อง");
    if (p.priority && !["low", "normal", "high", "urgent"].includes(p.priority))
      throw new PosError("ความสำคัญไม่ถูกต้อง");
    if (
      "due_at" in p &&
      p.due_at !== null &&
      (typeof p.due_at !== "string" || !Number.isFinite(Date.parse(p.due_at)))
    )
      throw new PosError("วันกำหนดส่งไม่ถูกต้อง");
    if ("assigned_to" in p && !UUID.test(p.assigned_to))
      throw new PosError("ผู้รับผิดชอบไม่ถูกต้อง");
    if (p.source_id && !UUID.test(p.source_id))
      throw new PosError("รหัสรายการต้นทางไม่ถูกต้อง");
    if (
      b.comment != null &&
      (typeof b.comment !== "string" || b.comment.length > 4000)
    )
      throw new PosError("ข้อความยาวเกินกำหนด");
    const r = await sb.rpc("pos_work_save", {
      p_id: b.id,
      p_actor: ctx.actor,
      p_version: b.version,
      p_patch: p,
      p_comment: b.comment ?? "",
    });
    if (r.error) throw Error(r.error.message);
    return NextResponse.json({ item: r.data });
  } catch (e) {
    return fail(e);
  }
}
