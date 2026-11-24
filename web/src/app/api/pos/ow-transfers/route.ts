// =====================================================================
// /api/pos/ow-transfers — ใบโอนที่ OneWarehouse เป็นตัวจริง (เซิร์ฟเวอร์เป็นเจ้าของสถานะ)
//   GET  ?links=1                       → การผูกสาขา↔คลัง OW + สาขาขาย (configured:false = ยังไม่ตั้ง · error = อ่านไม่ได้)
//   GET  ?branch_id=&since=&before=     → ใบของสาขา (ดึงใบขาเข้าจากคลังกลางให้ก่อนเมื่อระบุ branch_id)
//   GET  ?id=                           → ใบเดียว (สถานะล่าสุด)
//   POST {action,...}                   → create | approve | cancel | reject | scan-out | dispatch | scan-in | close-short | resume
//   ทุกคำสั่งตอบ { transfer, warning? } = ใบรูปแบบ POS ที่เซิร์ฟเวอร์สร้างจากผลจริงของ OW
//   สิทธิ์: create/scan-out = transfer.request (ต้นทาง) · approve/cancel/reject/dispatch = transfer.approve (ต้นทาง)
//           scan-in = transfer.receive (ปลายทาง) · close-short = transfer.approve (ปลายทาง) · resume = ฝ่ายใดฝ่ายหนึ่ง
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { posContext, PosError, requireSameOrigin } from "@/lib/server/pos-context";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "@/lib/server/ow-gateway";
import { owSyncReservations } from "@/lib/server/ow-reconcile";
import { owCall } from "@/lib/server/ow-write";
import type { PermissionKey } from "@/lib/permissions";
import {
  owCreateTransfer, owApproveTransfer, owCancelTransfer, owScanOut, owDispatch, owScanIn, owCloseShort, owResume,
  owListCopies, owGetCopy, owSyncInbound, OwTransferError,
} from "@/lib/server/ow-transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (e: unknown) => {
  if (e instanceof OwTransferError) return reply({ error: e.message, code: e.code, sku: e.sku ?? null }, e.status);
  if (e instanceof PosError) return reply({ error: e.message }, e.status);
  return reply({ error: e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ" }, 503);
};
const strs = (v: unknown, max = 500) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);

export async function GET(req: NextRequest) {
  try {
    const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
    if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
    const authz = await resolveAuthz(profile);
    if (!authz.allowed) throw new PosError("ไม่มีสิทธิ์", 403);
    let source: string;
    try { source = owConfig().source; } catch { return reply({ configured: false, links: {}, sale: {}, transfers: [] }); }
    const sp = req.nextUrl.searchParams;
    if (sp.get("links")) {
      const sb = supabaseAdmin();
      const [w, s] = await Promise.all([
        sb.from("pos_warehouse_links").select("warehouse_id,branch_id").eq("source", source),
        sb.from("pos_ow_sale_branches").select("branch_id,ow_branch_id").eq("source", source),
      ]);
      if (w.error || s.error) throw new PosError("อ่านการผูกสาขา OW ไม่สำเร็จ", 503);
      return reply({
        configured: true, source,
        links: Object.fromEntries((w.data ?? []).map((r) => [r.branch_id, r.warehouse_id])),
        sale: Object.fromEntries((s.data ?? []).map((r) => [r.branch_id, r.ow_branch_id])),
      });
    }
    const allowed = await visibleBranchIds(authz);
    const one = sp.get("id");
    if (one) {
      if (!UUID.test(one)) throw new PosError("เลขใบไม่ถูกต้อง");
      const c = await owGetCopy(one);
      if (allowed && !allowed.includes(c.transfer.to_branch_id) && !allowed.includes(c.transfer.from_branch_id)) throw new PosError("ไม่มีสิทธิ์ดูใบนี้", 403);
      return reply(c);
    }
    const tl = sp.get("timeline");
    if (tl) {
      if (!UUID.test(tl)) throw new PosError("เลขใบไม่ถูกต้อง");
      const c = await owGetCopy(tl);
      if (allowed && !allowed.includes(c.transfer.to_branch_id) && !allowed.includes(c.transfer.from_branch_id)) throw new PosError("ไม่มีสิทธิ์ดูใบนี้", 403);
      return reply(await owTimelineOf(source, tl));
    }
    const branch = sp.get("branch_id");
    if (branch && !UUID.test(branch)) throw new PosError("สาขาไม่ถูกต้อง");
    const scope = branch ? (allowed === null || allowed.includes(branch) ? [branch] : []) : allowed;
    if (scope && !scope.length) return reply({ configured: true, transfers: [] });
    // ดึงใบขาเข้าจากคลังกลาง — ล้มเหลวไม่ทำให้รายการล้ม แต่แจ้งกลับ (ไม่เงียบ)
    let inbound = 0, inboundError: string | null = null;
    if (branch && sp.get("sync") !== "0") inbound = await owSyncInbound(branch, authz.employee_id ?? null).catch((e) => { inboundError = e instanceof Error ? e.message : "ดึงใบขาเข้าไม่สำเร็จ"; return 0; });
    const since = sp.get("since"), before = sp.get("before");
    const rows = await owListCopies(scope, { since: since && !Number.isNaN(Date.parse(since)) ? since : undefined, before: before && !Number.isNaN(Date.parse(before)) ? before : undefined, limit: Number(sp.get("limit")) || 200 });
    return reply({ configured: true, inbound_added: inbound, inbound_error: inboundError, transfers: rows.map((r) => r.transfer), cursor: rows.length ? rows[rows.length - 1].updated_at : null });
  } catch (e) { return fail(e); }
}

async function branchesOf(posId: string) {
  const c = await owGetCopy(posId);
  return { from: c.transfer.from_branch_id, to: c.transfer.to_branch_id };
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const b = await req.json();
    const action = String(b.action ?? "");
    const auth = (perm: PermissionKey, branch: string) => posContext(req, perm, branch);

    if (action === "create") {
      if (!UUID.test(b.from_branch_id) || !UUID.test(b.to_branch_id) || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 50) throw new PosError("ข้อมูลใบโอนไม่ถูกต้อง");
      const ctx = await auth("transfer.request", b.from_branch_id);
      const lines = b.lines.map((l: Record<string, unknown>) => {
        if (!UUID.test(String(l.product_id))) throw new PosError("รายการสินค้าไม่ถูกต้อง");
        return { product_id: String(l.product_id), qty: Number(l.qty), serials: strs(l.serials) };
      });
      const canApprove = hasPerm(ctx.profile.email, ctx.authz, "transfer.approve");
      const created = await owCreateTransfer(ctx.actorId, canApprove, { from_branch_id: b.from_branch_id, to_branch_id: b.to_branch_id, note: typeof b.note === "string" ? b.note.slice(0, 200) : null, auto_approve: !!b.auto_approve, lines });
      void owSyncReservations(b.from_branch_id).catch((e) => console.error("[ow-reserved]", e instanceof Error ? e.message : e));
      return reply(created);
    }

    const posId = String(b.pos_transfer_id ?? "");
    if (!UUID.test(posId)) throw new PosError("เลขใบโอนไม่ถูกต้อง");
    const br = await branchesOf(posId);
    // หลังทำรายการเสร็จ (สำเร็จ) ที่เปลี่ยนการกันของใน JST → ปรับยอดจองของต้นทาง (ไม่รอ)
    const syncReserved = <T,>(r: T): T => {
      if (["approve", "cancel", "reject", "scan-out", "dispatch", "resume"].includes(action))
        void owSyncReservations(br.from).catch((e) => console.error("[ow-reserved]", e instanceof Error ? e.message : e));
      return r;
    };
    switch (action) {
      case "approve": { const c = await auth("transfer.approve", br.from); return reply(syncReserved(await owApproveTransfer(posId, c.actorId, typeof b.note === "string" ? b.note : undefined))); }
      case "cancel":
      case "reject": { const c = await auth("transfer.approve", br.from); return reply(syncReserved(await owCancelTransfer(posId, c.actorId, String(b.reason ?? ""), action === "reject"))); }
      case "scan-out": {
        const c = await auth("transfer.request", br.from);
        const map: Record<string, string[]> = {};
        for (const [k, v] of Object.entries((b.serials ?? {}) as Record<string, unknown>)) if (UUID.test(k)) map[k] = strs(v);
        return reply(syncReserved(await owScanOut(posId, c.actorId, map)));
      }
      case "dispatch": {
        const c = await auth("transfer.approve", br.from);
        return reply(syncReserved(await owDispatch(posId, c.actorId, { carrier: typeof b.carrier === "string" ? b.carrier.slice(0, 80) : null, tracking: typeof b.tracking === "string" ? b.tracking.slice(0, 80) : null, shippingCost: typeof b.shippingCost === "number" && b.shippingCost >= 0 ? b.shippingCost : null })));
      }
      case "scan-in": {
        const c = await auth("transfer.receive", br.to);
        if (!Array.isArray(b.lines)) throw new PosError("รายการรับไม่ถูกต้อง");
        return reply(await owScanIn(posId, c.actorId, b.lines.map((l: Record<string, unknown>) => ({
          product_id: String(l.product_id), serials: strs(l.serials), damaged: strs(l.damaged), receivedQty: Number(l.receivedQty) || 0, damagedQty: Number(l.damagedQty) || 0,
        }))));
      }
      case "close-short": { const c = await auth("transfer.approve", br.to); return reply(await owCloseShort(posId, c.actorId, String(b.reason ?? ""))); }
      case "resume": {
        await auth("transfer.request", br.from).catch(() => auth("transfer.receive", br.to));
        return reply(syncReserved(await owResume(posId)));
      }
      default: throw new PosError("คำสั่งไม่ถูกต้อง");
    }
  } catch (e) { return fail(e); }
}

// ── Timeline จากคลังกลาง (ทุกขั้น + ผลซิงก์ JST) → รูปแบบ AuditEntry ที่ UI ใช้ ──
type OwEvent = { at: string; type: string; actor?: string; summary: string; detail?: { step?: string; phase?: string; outcome?: string } };
async function owTimelineOf(source: string, posId: string) {
  const sb = supabaseAdmin();
  const ln = await sb.from("pos_ow_transfer_lines").select("ow_id").eq("source", source).eq("pos_transfer_id", posId);
  if (ln.error) throw new PosError("อ่านใบ OW ย่อยไม่สำเร็จ", 503);
  const ids = [...new Set((ln.data ?? []).map((r) => r.ow_id as string))];
  // ชื่อสาขาจากรหัสคลัง (actor = "branch:<warehouseId>")
  const wl = await sb.from("pos_warehouse_links").select("warehouse_id,branches(name)").eq("source", source);
  const whName = new Map((wl.data ?? []).map((r) => [String(r.warehouse_id), ((r.branches as { name?: string } | null)?.name ?? null)]));
  const rows: Record<string, unknown>[] = [];
  let failed = 0;
  for (const id of ids) {
    const r = await owCall<{ events: OwEvent[] }>("GET", `/transfers/${encodeURIComponent(id)}/timeline`, undefined, 10_000);
    if (!r.ok || !r.data) { failed++; continue; }
    for (const [i, e] of (r.data.events ?? []).entries()) {
      const jst = e.type === "sync" || /JST/.test(e.summary);
      const bad = e.detail?.outcome && e.detail.outcome !== "succeeded";
      const tone = bad ? "danger" : e.type === "sync" ? "ok" : e.detail?.step === "close" ? "ok" : e.type === "created" ? "brand" : e.type === "dispatch" ? "info" : "neutral";
      const wh = e.actor?.startsWith("branch:") ? e.actor.slice(7) : null;
      rows.push({
        id: `${id}:${i}`, action: e.summary, occurred_at: e.at, is_offline: false, ref_table: "transfers",
        actor_name: e.actor === "system" ? (jst ? "JST" : "ระบบคลังกลาง") : wh ? (whName.get(wh) ?? `คลัง ${wh}`) : (e.actor ?? null),
        after_data: { source: jst ? "jst" : "ow", tone, ...(ids.length > 1 ? { ow_id: id } : {}) },
      });
    }
  }
  rows.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  return { rows, partial: failed > 0, ow_ids: ids.length };
}
