// /api/pos/count — รอบตรวจนับสต๊อกฝั่งเซิร์ฟเวอร์ (0072 · UAT F055–F063)
//   GET  ?branch_id=            → รายการรอบนับของสาขา (+ meta หมวด/แบรนด์/พนักงาน เมื่อ &meta=1)
//   GET  ?id=                   → รอบนับ + รายการ (Blind: ซ่อนยอดระบบระหว่างนับ)
//   POST {action:"open"|"record"|"submit"|"approve"|"cancel", ...}
//        สิทธิ์: inventory.count (เปิด/นับ/ส่ง/ยกเลิก) · inventory.count_approve (อนุมัติ+ปรับสต๊อก)
//   POST แบบเดิม (ไม่มี action) = อนุมัติรอบนับจากเครื่อง (โหมดเดิม) — ยังรองรับเพื่อไม่ให้เครื่องเก่าพัง
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError, requireSameOrigin } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { object, UUID } from "@/lib/server/sale-validation";
import { assertNotOwStockBranch } from "@/lib/server/ow-branch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

// แปลรหัส error จากฐานข้อมูลเป็นข้อความที่พนักงานเข้าใจ
const MSG: [string, string][] = [
  ["count_overlap", "มีรอบนับที่ยังไม่ปิดซึ่งรวมสินค้าเหล่านี้อยู่แล้ว"],
  ["count_has_active_checkout", "มีตะกร้าที่กำลังชำระเงินของสินค้าในรอบนี้ — รอให้ขายเสร็จก่อนจึงเปิดแบบล็อกสต๊อก (Freeze) หรือเลือกแบบ Cut-off"],
  ["count_empty_scope", "ไม่พบสินค้าในขอบเขตที่เลือก"],
  ["count_scope_too_large", "ขอบเขตใหญ่เกิน 5,000 รายการ — แบ่งเป็นหลายรอบ"],
  ["count_incomplete", "ยังมีรายการที่ไม่ได้นับ (ช่องว่างไม่ใช่ 0) — กรอกยอดหรือกด “ข้าม” พร้อมเหตุผล"],
  ["count_skip_reason_required", "การข้ามรายการต้องระบุเหตุผล"],
  ["count_cancel_reason_required", "การยกเลิกรอบนับต้องระบุเหตุผล"],
  ["recount_must_be_other_counter", "รายการนับซ้ำต้องให้พนักงานคนอื่น (ไม่ใช่ผู้นับรอบแรก) เป็นผู้นับ"],
  ["approver_must_differ_from_counter", "ผู้อนุมัติต้องไม่ใช่ผู้ที่นับรายการในรอบนี้"],
  ["count_not_assignee", "คุณไม่ได้อยู่ในรายชื่อผู้รับผิดชอบรอบนับนี้"],
  ["serial_scan_required", "สินค้ามี SN — ต้องสแกน SN ทีละชิ้น (กรอกจำนวนอย่างเดียวไม่ได้)"],
  ["serial_duplicate_scan", "สแกน SN ซ้ำในรายการเดียวกัน"],
  ["serial_counted_twice", "SN นี้ถูกนับไปแล้วในสินค้าอื่นของรอบนี้"],
  ["count_negative_result", "ปรับแล้วสต๊อกจะติดลบ — ตรวจยอดอีกครั้ง"],
  ["count_line_not_in_recount", "รายการนี้ไม่อยู่ในรายการที่ต้องนับซ้ำ"],
  ["count_cannot_skip_recount", "รายการที่ต้องนับซ้ำข้ามไม่ได้"],
  ["count_invalid_qty", "จำนวนไม่ถูกต้อง"],
  ["count_already_posted", "รอบนี้อนุมัติและปรับสต๊อกแล้ว ยกเลิกไม่ได้"],
  ["count_wrong_status", "สถานะรอบนับเปลี่ยนไปแล้ว — รีเฟรชหน้า"],
  ["count_not_found", "ไม่พบรอบนับ"],
  ["employee_access_revoked", "บัญชีพนักงานถูกระงับ"],
];
const friendly = (m: string) => { const hit = MSG.find(([k]) => m.includes(k)); return hit ? hit[1] + (m.includes(": ") && !hit[0].startsWith("count_wrong") ? ` (${m.split(": ").pop()})` : "") : m; };

async function sessionBranch(id: string) {
  if (!UUID.test(id)) throw new PosError("ระบุรอบนับไม่ถูกต้อง");
  const { data, error } = await supabaseAdmin().from("pos_count_sessions").select("branch_id").eq("id", id).maybeSingle();
  if (error) throw new PosError("อ่านรอบนับไม่สำเร็จ — ตรวจ migration 0072", 503);
  if (!data) throw new PosError("ไม่พบรอบนับ", 404);
  return data.branch_id as string;
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const branch = await sessionBranch(id);
      const ctx = await posContext(req, "inventory.count", branch);
      const [s, lines] = await Promise.all([
        sb.from("pos_count_sessions").select("*").eq("id", id).single(),
        sb.from("pos_count_lines").select("*").eq("session_id", id).order("sku"),
      ]);
      if (s.error || lines.error) throw new PosError("อ่านรอบนับไม่สำเร็จ", 503);
      const sess = s.data;
      const people = new Set<string>([sess.created_by, sess.submitted_by, sess.approved_by, sess.cancelled_by, ...(sess.assignees ?? [])].filter(Boolean));
      for (const l of lines.data ?? []) { if (l.count1_by) people.add(l.count1_by); if (l.count2_by) people.add(l.count2_by); }
      const emps = people.size ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", [...people])).data ?? []) : [];
      const names = Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname]));
      // Blind count: ระหว่างนับ/นับซ้ำ ไม่ส่งยอดระบบ/SN ที่คาดไว้/ผลรอบแรก ออกไปที่เครื่องเลย (กันเปิด devtools ดู)
      const hide = sess.blind && (sess.status === "counting" || sess.status === "recount");
      const out = (lines.data ?? []).map((l) => hide ? {
        ...l, snapshot_qty: null, sys1: null, sys2: null, expected_sns: [], variance: null, variance_value: null, missing_sns: null, extra_sns: null,
        final_sys: null, count1: sess.status === "recount" && l.needs_recount && l.count1_by !== ctx.actorId ? null : l.count1,
        count1_sns: sess.status === "recount" && l.needs_recount && l.count1_by !== ctx.actorId ? null : l.count1_sns,
      } : l);
      return reply({ session: sess, lines: out, names, hidden: hide, me: ctx.actorId });
    }
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    await posContext(req, "inventory.count", branch);
    const list = await sb.from("pos_count_sessions").select("id,count_no,scope_type,scope,zone,mode,blind,status,ow_linked,posted,created_by,created_at,submitted_at,approved_at,cancelled_at,result").eq("branch_id", branch).order("created_at", { ascending: false }).limit(60);
    if (list.error) throw new PosError("อ่านรอบนับไม่สำเร็จ — ตรวจ migration 0072", 503);
    const ids = (list.data ?? []).map((s) => s.id);
    const prog = ids.length ? ((await sb.from("pos_count_lines").select("session_id,count1,count2,skipped,needs_recount").in("session_id", ids)).data ?? []) : [];
    const progress: Record<string, { total: number; done: number; recount: number }> = {};
    for (const l of prog) {
      const p = (progress[l.session_id] ??= { total: 0, done: 0, recount: 0 });
      p.total++; if (l.skipped || l.count1 !== null) p.done++; if (l.needs_recount) p.recount++;
    }
    const creators = [...new Set((list.data ?? []).map((s) => s.created_by))];
    const emps = creators.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", creators)).data ?? []) : [];
    const names = Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname]));
    let meta: unknown = undefined;
    if (req.nextUrl.searchParams.get("meta") === "1") {
      const [cats, brands, staff, link] = await Promise.all([
        sb.from("categories").select("id,name_th").eq("is_active", true).order("name_th"),
        sb.from("brands").select("id,name").order("name"),
        sb.from("employees").select("id,first_name,last_name,nickname").eq("status", "active").eq("home_branch_id", branch).order("first_name").limit(200),
        sb.from("pos_warehouse_links").select("warehouse_id").eq("branch_id", branch).limit(1),
      ]);
      meta = {
        categories: (cats.data ?? []).map((c) => ({ id: c.id, name: c.name_th })), brands: brands.data ?? [],
        staff: (staff.data ?? []).map((e) => ({ id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname })),
        ow_linked: !!link.data?.length,
      };
    }
    return reply({ sessions: list.data ?? [], progress, names, meta });
  } catch (e) {
    return reply({ error: e instanceof Error ? friendly(e.message) : "ผิดพลาด" }, e instanceof PosError ? e.status : 400);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const b = object(await req.json());
    if (!b.action) return legacyApprove(req, b);
    const sb = supabaseAdmin();
    const call = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new PosError(friendly(error.message), 409);
      return data;
    };
    switch (b.action) {
      case "open": {
        if (!UUID.test(b.branch_id)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
        const ctx = await posContext(req, "inventory.count", b.branch_id);
        const scopeType = String(b.scope_type ?? "");
        const scope = object(b.scope ?? {});
        const ids = Array.isArray(scope.product_ids) ? scope.product_ids.filter((x: unknown) => typeof x === "string" && UUID.test(x)).slice(0, 5000) : undefined;
        const assignees = Array.isArray(b.assignees) ? b.assignees.filter((x: unknown) => typeof x === "string" && UUID.test(x)).slice(0, 50) : [];
        const thr = object(b.thr ?? {});
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
        return reply(await call("pos_count_open", {
          p_actor: ctx.actorId, p_branch: b.branch_id, p_scope_type: scopeType,
          p_scope: { category_id: typeof scope.category_id === "string" ? scope.category_id : undefined, brand_id: typeof scope.brand_id === "string" ? scope.brand_id : undefined, product_ids: ids, zone: typeof scope.zone === "string" ? scope.zone.slice(0, 80) : undefined },
          p_mode: b.mode === "cutoff" ? "cutoff" : "freeze", p_blind: b.blind !== false,
          p_thr: { qty: num(thr.qty), pct: num(thr.pct), value: num(thr.value), recount_other: thr.recount_other !== false },
          p_note: typeof b.note === "string" ? b.note.slice(0, 500) : null, p_assignees: assignees,
        }));
      }
      case "record": {
        const ctx = await posContext(req, "inventory.count", await sessionBranch(String(b.id ?? "")));
        if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 5000) throw new PosError("ไม่มีรายการที่จะบันทึก");
        const lines = b.lines.map((raw: unknown) => {
          const l = object(raw);
          if (!UUID.test(l.product_id)) throw new PosError("รหัสสินค้าไม่ถูกต้อง");
          const out: Record<string, unknown> = { product_id: l.product_id };
          if (l.skip === true) { out.skip = true; out.skip_reason = String(l.skip_reason ?? "").slice(0, 300); }
          else if (Array.isArray(l.sns)) out.sns = l.sns.filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 80)).slice(0, 2000);
          else out.qty = l.qty === null || l.qty === undefined || l.qty === "" ? null : l.qty;
          return out;
        });
        return reply(await call("pos_count_record", { p_actor: ctx.actorId, p_session: b.id, p_lines: lines }));
      }
      case "submit": {
        const ctx = await posContext(req, "inventory.count", await sessionBranch(String(b.id ?? "")));
        return reply(await call("pos_count_submit", { p_actor: ctx.actorId, p_session: b.id }));
      }
      case "approve": {
        const ctx = await posContext(req, "inventory.count_approve", await sessionBranch(String(b.id ?? "")));
        return reply(await call("pos_count_approve", { p_actor: ctx.actorId, p_session: b.id, p_note: typeof b.note === "string" ? b.note.slice(0, 500) : null }));
      }
      case "cancel": {
        const ctx = await posContext(req, "inventory.count", await sessionBranch(String(b.id ?? "")));
        return reply(await call("pos_count_cancel", { p_actor: ctx.actorId, p_session: b.id, p_reason: String(b.reason ?? "").slice(0, 500) }));
      }
      default: throw new PosError("ไม่รู้จักคำสั่ง");
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? friendly(e.message) : "ทำรายการไม่สำเร็จ" }, e instanceof PosError ? e.status : 400);
  }
}

// ── โหมดเดิม: อนุมัติรอบนับที่นับบนเครื่อง (ยังเก็บไว้ให้เครื่องที่ยังไม่อัปเดต) ──
async function legacyApprove(req: NextRequest, b: Record<string, any>) {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const ctx = await posContext(req, "inventory.count_approve", b.branch_id);
  await assertNotOwStockBranch(b.branch_id);
  if (typeof b.id !== "string" || !b.id || b.id.length > 100 || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 5000) throw new PosError("รอบนับไม่ถูกต้อง");
  const ids = new Set<string>();
  const lines = b.lines
    .filter((l: any) => l.counted !== null)  // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((raw: unknown) => {
      const l = object(raw);
      if (!UUID.test(l.product_id) || ids.has(l.product_id) || typeof l.counted !== "number" || !Number.isFinite(l.counted) || l.counted < 0 || typeof l.expected !== "number" || !Number.isFinite(l.expected))
        throw new PosError("จำนวนหรือรหัสสินค้าในรอบนับไม่ถูกต้อง");
      ids.add(l.product_id);
      return { product_id: l.product_id, expected: l.expected, counted: l.counted, reason: String(b.note ?? "นับสต๊อก").slice(0, 1000) };
    });
  if (!lines.length) throw new PosError("ยังไม่มีรายการที่นับแล้ว");
  const { data, error } = await supabaseAdmin().rpc("pos_approve_count", { p_id: b.id, p_branch: b.branch_id, p_actor: ctx.actorId, p_lines: lines });
  if (error) throw new PosError(`อนุมัติรอบนับไม่สำเร็จ: ${error.message}`, 409);
  return reply(data);
}
