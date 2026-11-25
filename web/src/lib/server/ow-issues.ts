// =====================================================================
// ปัญหาเชื่อมคลังกลาง/JST → งานใน "งานของฉัน" + กระดิ่งแจ้งเตือน (migration 0058)
//   บิลขาย: ส่งเข้า JST ไม่ผ่าน / รอแก้ SN / ลองซ้ำหลายรอบ → สร้างงาน · JST ยืนยันแล้ว → ปิดงานเอง
//   ใบโอน: ผลตรวจ "ไม่ตรง" หรือค้าง recovery_required → สร้างงาน · กลับมาตรงกัน → ปิดงานเอง
//   ปัญหาเดิม (ลายเซ็นเดิม) ไม่แจ้งซ้ำ · ปัญหาเปลี่ยน = อัปเดตงาน + แจ้งใหม่
// =====================================================================
import { HOLD_PREFIX } from "./ow-sales";
import { isOwSaleDone } from "@/lib/ow/sale-status";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Upsert = { kind: "ow_sale" | "ow_transfer"; source: string; branch: string; title: string; desc: string; priority: "normal" | "high" | "urgent"; sig: string; hint: string | null };

async function upsert(u: Upsert): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc("pos_ow_issue_upsert", {
    p_kind: u.kind, p_source: u.source, p_branch: u.branch, p_title: u.title, p_desc: u.desc, p_priority: u.priority, p_sig: u.sig, p_hint: u.hint,
  });
  if (error) throw new Error("สร้างงานแจ้งปัญหาไม่สำเร็จ: " + error.message);
  return data as string;
}
async function resolve(kind: Upsert["kind"], source: string, note: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("pos_ow_issue_resolve", { p_kind: kind, p_source: source, p_note: note });
  if (error) throw new Error("ปิดงานแจ้งปัญหาไม่สำเร็จ: " + error.message);
  return !!data;
}

type SaleEv = { aggregate_id: string; state: string; reason: string | null; attempts: number; response: { sale?: { status?: string; saleNo?: string } } | null };

/** บิลขาย: ปัญหาจากคิวส่งคลังกลาง → งาน (เรียกทุก ~2 นาทีจากวงรอบ) */
export async function syncSaleIssues(source: string): Promise<{ created: number; updated: number; resolved: number }> {
  const sb = supabaseAdmin(), out = { created: 0, updated: 0, resolved: 0 };
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const bad = await sb.from("pos_integration_events").select("aggregate_id,state,reason,attempts,response")
    .eq("source", source).eq("event_type", "sale.committed").gte("created_at", since)
    .or("state.in.(blocked,dead),and(state.eq.retry,attempts.gte.3)").limit(300);
  if (bad.error) throw new Error("อ่านคิวบิลขายไม่สำเร็จ: " + bad.error.message);
  const evs = ((bad.data ?? []) as SaleEv[]).filter((e) => UUID.test(e.aggregate_id));
  if (evs.length) {
    const ord = await sb.from("orders").select("client_uuid,order_no,branch_id,cashier_id").in("client_uuid", evs.map((e) => e.aggregate_id));
    if (ord.error) throw new Error("อ่านบิลไม่สำเร็จ: " + ord.error.message);
    const om = new Map((ord.data ?? []).map((o) => [o.client_uuid as string, o]));
    for (const e of evs) {
      const o = om.get(e.aggregate_id);
      if (!o?.branch_id) continue;
      const st = e.response?.sale?.status ?? null;
      const sn = st === "sn_pending";
      const held = (e.reason ?? "").startsWith(HOLD_PREFIX);
      const title = held ? `บิล ${o.order_no}: พักไว้ไม่ส่ง JST (${(e.reason ?? "").includes("ขายส่ง") ? "ขายส่ง" : "ช่องทางนี้"})`
        : e.state === "retry" ? `บิล ${o.order_no}: ส่งเข้าคลังกลางไม่ผ่าน (กำลังลองซ้ำ)`
        : e.state === "dead" ? `บิล ${o.order_no}: ส่งเข้าคลังกลางไม่ได้ (ลองซ้ำครบแล้ว)`
        : sn ? `บิล ${o.order_no}: รอแก้ SN ก่อนเข้า JST` : `บิล ${o.order_no}: JST ไม่รับบิล`;
      const how = held ? ((e.reason ?? "").includes("ออนไลน์")
          ? "ไม่ต้องส่งผ่าน POS — ตรวจว่าออเดอร์นี้ขึ้นใน JST จากแพลตฟอร์มแล้ว ถ้ายังไม่ขึ้นให้แจ้งทีมคลังกลาง/ทีมออนไลน์ผูกร้านกับ JST"
          : "ยังไม่ต้องทำอะไรที่หน้าร้าน — เมื่อ OneWarehouse เปิดรองรับขายส่งแล้ว กด \"ส่งใหม่\" ที่บิล (ไม่ต้องเปิดบิลใหม่)") : sn ? "แก้ SN ได้ที่ หลังบ้าน › เชื่อมคลังกลาง › ส่งบิลขาย (ภายใน 7 วัน)"
        : "ตรวจสาเหตุ แก้ที่ต้นเหตุ (เช่น เติมสต๊อก/ปิดใบโอนที่ค้างใน OneWarehouse) แล้วกด \"ลองใหม่\" ที่ หลังบ้าน › เชื่อมคลังกลาง › ส่งบิลขาย";
      const r = await upsert({
        kind: "ow_sale", source: e.aggregate_id, branch: o.branch_id as string, title,
        desc: `${e.reason ?? "ไม่ทราบสาเหตุ"}\n\nวิธีแก้: ${how}${e.response?.sale?.saleNo ? `\nเลขคลังกลาง: ${e.response.sale.saleNo}` : ""}`,
        priority: held ? "normal" : e.state === "retry" ? "high" : "urgent",
        // retry: ข้อความเปลี่ยนทุกรอบ → ใช้แค่สถานะ (ไม่แจ้งซ้ำทุก 30 วิ)
        sig: e.state === "retry" ? "retry" : `${e.state}:${st ?? ""}:${(e.reason ?? "").slice(0, 160)}`,
        hint: (o.cashier_id as string | null) ?? null,
      });
      if (r === "created") out.created++; else if (r === "updated" || r === "reopened") out.updated++;
    }
  }
  // งานที่ยังเปิด → ต้นทาง JST ยืนยันแล้ว = ปิดเอง
  const open = await sb.from("pos_work_items").select("source_id").eq("source_kind", "ow_sale").not("status", "in", "(done,cancelled)").limit(300);
  if (open.error) throw new Error("อ่านงานไม่สำเร็จ: " + open.error.message);
  const ids = (open.data ?? []).map((t) => t.source_id as string).filter(Boolean);
  if (ids.length) {
    const ok = await sb.from("pos_integration_events").select("aggregate_id,response").eq("source", source).eq("event_type", "sale.committed").eq("state", "delivered").in("aggregate_id", ids);
    if (ok.error) throw new Error("อ่านคิวบิลขายไม่สำเร็จ: " + ok.error.message);
    for (const e of ok.data ?? []) {
      const s = (e.response as SaleEv["response"])?.sale;
      if (!s || !isOwSaleDone(s.status)) continue;
      if (await resolve("ow_sale", e.aggregate_id as string, `JST ยืนยันบิลแล้ว${s.saleNo ? ` (${s.saleNo})` : ""}`)) out.resolved++;
    }
  }
  return out;
}

type ReconRowLite = { kind: string; ref: string; branch_id: string | null; status: string; summary: string };

/** ใบโอน: ผลตรวจความตรงกันรอบล่าสุด → งาน (เรียกหลัง runRecon) */
export async function syncTransferIssues(source: string, rows: ReconRowLite[]): Promise<{ created: number; updated: number; resolved: number }> {
  const sb = supabaseAdmin(), out = { created: 0, updated: 0, resolved: 0 };
  const tr = rows.filter((r) => r.kind === "transfer");
  if (!tr.length) return out;
  const recs = await sb.from("pos_ow_transfers").select("pos_transfer_id,transfer_no,from_branch_id,to_branch_id").eq("source", source).in("transfer_no", tr.map((r) => r.ref));
  if (recs.error) throw new Error("อ่านใบโอนไม่สำเร็จ: " + recs.error.message);
  const rm = new Map((recs.data ?? []).map((r) => [r.transfer_no as string, r]));
  for (const r of tr) {
    const rec = rm.get(r.ref);
    const id = rec?.pos_transfer_id as string | undefined;
    if (!id || !UUID.test(id)) continue;
    // ไม่ตรง หรือ ค้างที่ต้องมีคนกู้ (recovery_required) → ต้องมีผู้รับผิดชอบ
    const stuck = r.status === "pending" && r.summary.includes("recovery_required");
    if (r.status === "mismatch" || stuck) {
      const branch = (rec?.to_branch_id ?? rec?.from_branch_id ?? r.branch_id) as string | null;
      if (!branch) continue;
      const x = await upsert({
        kind: "ow_transfer", source: id, branch, title: stuck ? `ใบโอน ${r.ref}: ค้างในคลังกลาง ต้องกู้/ปิดใบ` : `ใบโอน ${r.ref}: ไม่ตรงกับคลังกลาง/JST`,
        desc: `${r.summary}\n\nดูรายละเอียดที่ หลังบ้าน › เชื่อมคลังกลาง › ตรวจความตรงกัน แล้วแก้ในใบโอน/OneWarehouse`,
        priority: stuck ? "normal" : "high", sig: `${r.status}:${r.summary.slice(0, 200)}`, hint: null,
      });
      if (x === "created") out.created++; else if (x === "updated" || x === "reopened") out.updated++;
    } else if (r.status === "match") {
      if (await resolve("ow_transfer", id, "ตรวจล่าสุดตรงกันแล้ว")) out.resolved++;
    }
  }
  return out;
}
