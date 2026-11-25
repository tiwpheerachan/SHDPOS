// /api/pos/pickups — ลูกค้าจ่ายเต็มแล้วมารับของทีหลัง (0077)
//   GET  ?branch_id=&status=open|done|all&q=   → รายการรอรับ (เลขบิล/ชื่อ/เบอร์/วันนัด/คงค้าง)
//   GET  ?order_id=                            → รายละเอียด + ประวัติส่งมอบ
//   POST {action:"create", branch_id, order_no|client_uuid, due?, note?}   สิทธิ์ pos.sell (ตั้งย้อนจากบิลที่ขายแล้ว)
//   POST {action:"handover", order_id, version, lines:[{order_item_id, qty, serials}], receiver, note?}   สิทธิ์ pickup.handover
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError, requireSameOrigin } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { object, UUID } from "@/lib/server/sale-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const MSG: [string, string][] = [
  ["pickup_serial_not_in_bill", "SN นี้ไม่ใช่เครื่องในบิลนี้"], ["pickup_serial_already_handed", "SN นี้ส่งมอบไปแล้ว"],
  ["pickup_serials_required", "สินค้ามี SN — สแกน SN ให้ครบตามจำนวนที่ส่งมอบ"], ["pickup_qty_exceeds", "ส่งมอบเกินจำนวนที่ค้างรับ"],
  ["pickup_receiver_required", "กรุณาระบุชื่อผู้มารับของ"], ["pickup_version_conflict", "มีคนส่งมอบรายการนี้ไปแล้วจากอีกเครื่อง — รีเฟรชแล้วตรวจใหม่"],
  ["pickup_not_open", "รายการนี้ส่งมอบครบ/ยกเลิกแล้ว"], ["pickup_nothing_selected", "ยังไม่ได้เลือกรายการที่จะส่งมอบ"],
  ["pickup_order_not_found", "ไม่พบบิลในระบบกลาง"], ["pickup_order_not_eligible", "บิลนี้ถูกยกเลิก/คืนครบแล้ว"], ["pickup_no_goods", "บิลนี้ไม่มีสินค้าที่ต้องส่งมอบ"],
  ["pickup_due_invalid", "วันนัดรับต้องเป็นวันนี้ถึง 180 วันข้างหน้า"], ["pickup_branch_forbidden", "ไม่มีสิทธิ์ในสาขาของบิลนี้"],
];
const friendly = (m: string) => { const h = MSG.find(([k]) => m.includes(k)); return h ? h[1] + (m.includes(": ") ? ` (${m.split(": ").pop()})` : "") : m; };
const remaining = (items: { qty: number; picked_qty: number; returned_qty: number }[]) => items.reduce((s, i) => s + Number(i.qty) - Number(i.picked_qty) - Number(i.returned_qty), 0);

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const orderId = req.nextUrl.searchParams.get("order_id");
    if (orderId) {
      if (!UUID.test(orderId)) throw new PosError("ระบุรายการไม่ถูกต้อง");
      const pk = (await sb.from("pos_order_pickups").select("*").eq("order_id", orderId).maybeSingle()).data;
      if (!pk) throw new PosError("ไม่พบรายการรอรับ", 404);
      await posContext(req, "pos.sell", pk.branch_id);
      const [o, ev] = await Promise.all([
        sb.from("orders").select("order_no,client_uuid,grand_total,created_at,status").eq("id", orderId).single(),
        sb.from("pos_pickup_events").select("kind,items,receiver_name,note,actor_id,created_at").eq("order_id", orderId).order("created_at"),
      ]);
      const ids = [...new Set([pk.created_by, ...(ev.data ?? []).map((e) => e.actor_id)].filter(Boolean))] as string[];
      const emps = ids.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", ids)).data ?? []) : [];
      const names = Object.fromEntries(emps.map((e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname]));
      return reply({ pickup: pk, order: o.data, events: ev.data ?? [], names });
    }
    const branch = req.nextUrl.searchParams.get("branch_id") ?? "";
    if (!UUID.test(branch)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
    await posContext(req, "pos.sell", branch);
    const status = req.nextUrl.searchParams.get("status") ?? "open";
    let q = sb.from("pos_order_pickups").select("order_id,status,due_date,contact_name,contact_phone,note,items,created_at,completed_at,version,orders!inner(order_no,client_uuid,grand_total,created_at)").eq("branch_id", branch).order("created_at", { ascending: false }).limit(200);
    if (status === "open") q = q.in("status", ["pending", "partial"]);
    else if (status === "done") q = q.in("status", ["completed", "cancelled"]);
    const r = await q;
    if (r.error) throw new PosError("อ่านรายการรอรับไม่สำเร็จ — ตรวจ migration 0077", 503);
    const term = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const rows = (r.data ?? []).map((p) => ({ ...p, remaining: remaining(p.items as never) })).filter((p) => !term
      || [(p.orders as unknown as { order_no: string }).order_no, p.contact_name, p.contact_phone].some((x) => String(x ?? "").toLowerCase().includes(term)));
    return reply({ pickups: rows });
  } catch (e) {
    return reply({ error: e instanceof Error ? friendly(e.message) : "ผิดพลาด" }, e instanceof PosError ? e.status : 400);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const b = object(await req.json());
    const sb = supabaseAdmin();
    if (b.action === "create") {
      if (!UUID.test(b.branch_id)) throw new PosError("ระบุสาขาไม่ถูกต้อง");
      const ctx = await posContext(req, "pos.sell", b.branch_id);
      let cu = typeof b.client_uuid === "string" && UUID.test(b.client_uuid) ? b.client_uuid : null;
      if (!cu && typeof b.order_no === "string" && b.order_no.trim()) {
        const o = (await sb.from("orders").select("client_uuid,branch_id").eq("order_no", b.order_no.trim()).maybeSingle()).data;
        if (!o) throw new PosError("ไม่พบเลขบิลนี้", 404);
        if (o.branch_id !== b.branch_id) throw new PosError("บิลนี้เป็นของสาขาอื่น", 403);
        cu = o.client_uuid;
      }
      if (!cu) throw new PosError("ระบุเลขบิล");
      const due = typeof b.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null;
      const r = await sb.rpc("pos_pickup_create", { p_actor: ctx.actorId, p_order_client: cu, p_due: due, p_contact: {}, p_note: typeof b.note === "string" ? b.note.slice(0, 500) : null });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    if (b.action === "handover") {
      if (!UUID.test(b.order_id)) throw new PosError("ระบุรายการไม่ถูกต้อง");
      const pk = (await sb.from("pos_order_pickups").select("branch_id").eq("order_id", b.order_id).maybeSingle()).data;
      if (!pk) throw new PosError("ไม่พบรายการรอรับ", 404);
      const ctx = await posContext(req, "pickup.handover", pk.branch_id);
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 200) throw new PosError("ยังไม่ได้เลือกรายการที่จะส่งมอบ");
      const lines = b.lines.map((raw: unknown) => {
        const l = object(raw);
        if (!UUID.test(l.order_item_id) || typeof l.qty !== "number" || !Number.isFinite(l.qty) || l.qty < 0) throw new PosError("รายการส่งมอบไม่ถูกต้อง");
        return { order_item_id: l.order_item_id, qty: l.qty, serials: Array.isArray(l.serials) ? l.serials.filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 80)).slice(0, 500) : [] };
      });
      const r = await sb.rpc("pos_pickup_handover", { p_actor: ctx.actorId, p_order: b.order_id, p_version: Number.isInteger(b.version) ? b.version : null, p_lines: lines, p_receiver: String(b.receiver ?? "").slice(0, 120), p_note: typeof b.note === "string" ? b.note.slice(0, 500) : null });
      if (r.error) throw new PosError(friendly(r.error.message), 409);
      return reply(r.data);
    }
    throw new PosError("ไม่รู้จักคำสั่ง");
  } catch (e) {
    return reply({ error: e instanceof Error ? friendly(e.message) : "ผิดพลาด" }, e instanceof PosError ? e.status : 400);
  }
}
