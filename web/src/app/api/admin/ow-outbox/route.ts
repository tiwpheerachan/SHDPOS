// =====================================================================
// /api/admin/ow-outbox — คิวส่งบิลขาย POS → OneWarehouse + การผูกสาขา
//   GET                         → รายการคิว (บิลขาย) + ผลจาก OW · การผูกสาขา↔คลัง/สาขาขาย
//   POST {action:"process"}     → ส่งคิวที่ถึงเวลาทันที
//   POST {action:"retry",id}    → นำรายการที่ติด (blocked/dead/retry) กลับเข้าคิว
//   POST {action:"patch-serials",id,reason,serials:{lineIndex:[sn]}} → แก้ SN รายบรรทัด (PATCH /v1/sales) + ปรับ SN ใน POS + ประวัติ
//   POST {action:"reconcile", branch_id, serials?} → ปรับยอดสต๊อก/SN ของสาขาให้ตรง OW
//   POST {action:"link", branch_id, warehouse_id?, ow_branch_id?} → ผูก/ยกเลิกผูกสาขา
//   สิทธิ์: integration.manage
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { requireSameOrigin, PosError } from "@/lib/server/pos-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "@/lib/server/ow-gateway";
import { processSaleOutbox, patchSaleSerials, followUpSales, resubmitFailedSale } from "@/lib/server/ow-sales";
import { owReconcileBranch } from "@/lib/server/ow-reconcile";
import { syncSaleIssues } from "@/lib/server/ow-issues";
import { OwTransferError } from "@/lib/server/ow-transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) throw new PosError("กรุณาเข้าสู่ระบบ", 401);
  const authz = await resolveAuthz(profile);
  if (!hasPerm(profile.email, authz, "integration.manage")) throw new PosError("ไม่มีสิทธิ์จัดการการเชื่อมคลังกลาง", 403);
  if (!authz.employee_id) throw new PosError("ไม่พบพนักงานของบัญชีนี้", 403);
  return { actor: authz.employee_id };
}
const fail = (e: unknown) => reply({ error: e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ" }, e instanceof PosError ? e.status : 503);

export async function GET(req: NextRequest) {
  try {
    await ctx(req);
    const sb = supabaseAdmin(), source = owConfig().source;
    const [ev, wl, sl, br] = await Promise.all([
      sb.from("pos_integration_events").select("id,source,event_type,aggregate_id,state,reason,attempts,available_at,response,created_at,updated_at")
        .in("source", [source, "onewarehouse:unmapped"]).eq("event_type", "sale.committed").order("created_at", { ascending: false }).limit(200),
      sb.from("pos_warehouse_links").select("warehouse_id,branch_id").eq("source", source),
      sb.from("pos_ow_sale_branches").select("branch_id,ow_branch_id").eq("source", source),
      sb.from("branches").select("id,code,name,name_th,branch_type,is_active").order("code"),
    ]);
    if (ev.error) throw new Error("อ่านคิวไม่สำเร็จ");
    // เติมเลขบิล POS ให้อ่านง่าย (client_uuid = hold id)
    const holds = [...new Set((ev.data ?? []).map((e) => e.aggregate_id))];
    const orders = holds.length ? (await sb.from("orders").select("client_uuid,order_no,branch_id,grand_total").in("client_uuid", holds)).data ?? [] : [];
    const om = new Map(orders.map((o) => [o.client_uuid, o]));
    return reply({
      source,
      events: (ev.data ?? []).map((e) => {
        const r = (e.response ?? {}) as { sale?: { saleNo?: string; status?: string; version?: number; problems?: unknown[]; jstProgress?: { jstOrderNo?: string } }; request?: { lines?: { sku: string; qty: number; serials?: string[] }[] }; error?: { code?: string; message?: string } };
        const o = om.get(e.aggregate_id);
        return {
          id: e.id, state: e.state, reason: e.reason, attempts: e.attempts, available_at: e.available_at, created_at: e.created_at, updated_at: e.updated_at,
          order_no: o?.order_no ?? null, branch_id: o?.branch_id ?? null, grand_total: o?.grand_total ?? null,
          ow_sale_no: r.sale?.saleNo ?? null, ow_status: r.sale?.status ?? null, jst_order_no: r.sale?.jstProgress?.jstOrderNo ?? null,
          problems: r.sale?.problems ?? [], lines: r.request?.lines ?? [], error: r.error ?? null,
        };
      }),
      warehouse_links: wl.data ?? [], sale_links: sl.data ?? [], branches: br.data ?? [],
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const { actor } = await ctx(req);
    const b = await req.json();
    const sb = supabaseAdmin(), source = owConfig().source;
    switch (b.action) {
      case "process": { const results = await processSaleOutbox(source, 5), followup = await followUpSales(source, 20); return reply({ results, followup, issues: await syncSaleIssues(source) }); }
      case "retry": {
        if (!UUID.test(String(b.id))) throw new PosError("รายการไม่ถูกต้อง");
        const ev = await sb.from("pos_integration_events").select("payload,aggregate_id,state,response").eq("id", b.id).single();
        if (ev.error) throw new PosError("ไม่พบรายการ", 404);
        if (ev.data.state === "delivered") throw new PosError("รายการนี้ส่งสำเร็จแล้ว", 409);
        // OW มีบิลแล้วแต่ JST ปฏิเสธ (failed) → ส่งเข้า JST ใหม่ด้วย PATCH (ส่ง POST ซ้ำจะได้ผลเดิม)
        if ((ev.data.response as { sale?: { status?: string } } | null)?.sale?.status === "failed") {
          const r = await resubmitFailedSale(b.id);
          return r.ok ? reply(r) : reply({ error: `JST ยังไม่รับบิล: ${r.reason ?? r.status}` }, 422);
        }
        // ผูกสาขาขายทีหลังได้: เติม ow_branch_id ปัจจุบัน + ย้ายจากคิว unmapped มาคิวจริง
        const order = await sb.from("orders").select("branch_id").eq("client_uuid", ev.data.aggregate_id).maybeSingle();
        const branchId = order.data?.branch_id ?? (ev.data.payload as { branch_id?: string })?.branch_id;
        const link = branchId ? await sb.from("pos_ow_sale_branches").select("ow_branch_id").eq("source", source).eq("branch_id", branchId).maybeSingle() : null;
        const ow = link?.data?.ow_branch_id ?? null;
        const { error } = await sb.from("pos_integration_events").update({
          source, state: ow ? "queued" : "blocked", reason: ow ? null : "สาขานี้ยังไม่ผูกสาขาขาย OneWarehouse", attempts: 0,
          available_at: new Date().toISOString(), payload: { ...(ev.data.payload as object), ow_branch_id: ow }, updated_at: new Date().toISOString(),
        }).eq("id", b.id);
        if (error) throw new PosError(error.code === "23505" ? "มีรายการเดียวกันอยู่ในคิวจริงแล้ว" : "นำกลับเข้าคิวไม่สำเร็จ", 409);
        return reply({ ok: true, queued: !!ow });
      }
      case "patch-serials": {
        if (!UUID.test(String(b.id)) || typeof b.serials !== "object" || !b.serials) throw new PosError("ข้อมูลไม่ถูกต้อง");
        const byLine: Record<number, string[]> = {};
        for (const [k, list] of Object.entries(b.serials as Record<string, unknown>)) {
          const idx = Number(k);
          if (!Number.isInteger(idx) || idx < 0 || idx > 200 || !Array.isArray(list)) throw new PosError("รูปแบบ SN ไม่ถูกต้อง");
          byLine[idx] = list.map((x) => String(x).trim()).filter(Boolean).slice(0, 200);
        }
        const r = await patchSaleSerials(b.id, actor, String(b.reason ?? ""), byLine);
        // OW ปฏิเสธ → ตอบ 422 ให้หน้าจอแสดง error (ไม่ใช่ 200 + ok:false)
        return r.ok ? reply(r) : reply({ error: `OW ไม่รับการแก้ SN: ${r.error?.message ?? r.error?.code ?? ""}`, code: r.error?.code ?? null }, 422);
      }
      case "reconcile": {
        // ปรับยอดสต๊อก/SN ของสาขาให้ตรง OneWarehouse (OW เป็นตัวจริง)
        if (!UUID.test(String(b.branch_id))) throw new PosError("สาขาไม่ถูกต้อง");
        const extra = Array.isArray(b.serials) ? b.serials.map((x: unknown) => String(x).trim()).filter((x: string) => /^[A-Za-z0-9._\-/]{1,64}$/.test(x)).slice(0, 500) : [];
        try { return reply(await owReconcileBranch(b.branch_id, actor, extra)); }
        catch (e) { if (e instanceof OwTransferError) return reply({ error: e.message, code: e.code }, e.status); throw e; }
      }
      case "link": {
        if (!UUID.test(String(b.branch_id))) throw new PosError("สาขาไม่ถูกต้อง");
        const wh = typeof b.warehouse_id === "string" ? b.warehouse_id.trim() : "";
        const sale = typeof b.ow_branch_id === "string" ? b.ow_branch_id.trim() : "";
        if (wh && !/^[A-Za-z0-9_-]{1,40}$/.test(wh)) throw new PosError("รหัสคลังไม่ถูกต้อง");
        if (sale && !/^[A-Za-z0-9_.-]{1,80}$/.test(sale)) throw new PosError("รหัสสาขาขายไม่ถูกต้อง");
        // บันทึกคลัง + สาขาขายใน transaction เดียว (ล้มทั้งชุดถ้ามีจุดใดล้ม)
        const { error } = await sb.rpc("pos_ow_link_branch", { p_source: source, p_branch: b.branch_id, p_warehouse: wh, p_ow_branch: sale, p_actor: actor });
        if (error) throw new PosError("บันทึกการผูกสาขาไม่สำเร็จ: " + error.message, 409);
        return reply({ ok: true });
      }
      default: throw new PosError("คำสั่งไม่ถูกต้อง");
    }
  } catch (e) { return fail(e); }
}
