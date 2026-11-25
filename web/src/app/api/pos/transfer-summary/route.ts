// /api/pos/transfer-summary?id=<pos_transfer_id>&refresh=1 — AI สรุปใบโอน (ไม่มีคีย์/ล่ม = สรุปจากกฎ) · สิทธิ์ transfer.request + สาขาต้นทาง/ปลายทาง
//   ส่งให้ AI เฉพาะสถานะ/จำนวน/ผลต่าง — ไม่ส่งชื่อพนักงาน · แคช 10 นาที
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { loadTransfer } from "@/lib/server/transfer-docs";
import { aiJson } from "@/lib/server/ai-text";
import type { Row } from "@/lib/server/order-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
type Summary = { headline: string; bullets: string[]; actions: string[]; risk: "ok" | "warn" | "error"; source: "ai" | "rules" };
const cache = new Map<string, { at: number; s: Summary }>();
const ST: Record<string, string> = { draft: "ร่าง", pending_approval: "รออนุมัติ", approved: "อนุมัติแล้ว รอต้นทางจัดของ", picking: "กำลังจัดของ", packed: "แพ็กแล้ว รอส่งมอบขนส่ง", shipped: "ส่งแล้ว", in_transit: "ระหว่างขนส่ง", partial_received: "รับบางส่วน", received: "รับครบ", completed: "เสร็จสิ้น", cancelled: "ยกเลิก", rejected: "ปฏิเสธ" };
const DK: Record<string, string> = { short: "ขาด", over: "เกิน", damaged: "ชำรุด", lost: "สูญหาย", wrong_sn: "SN ผิด", unexpected_sn: "SN นอกใบโอน" };

function rules(t: Row): Summary {
  const items = (t.items ?? []) as Row[], dc = (t.discrepancies ?? []) as Row[];
  const open = dc.filter((d) => d.status === "open");
  const hrs = Math.round((Date.now() - new Date(t.created_at).getTime()) / 3_600_000);
  const owBad = ["recovery_required", "partially_created"].includes(String(t.ow_link_state)) || !!t.ow_error;
  const risk: Summary["risk"] = owBad ? "error" : open.length || (["in_transit", "shipped"].includes(t.status) && hrs > 72) ? "warn" : "ok";
  const headline = ["cancelled", "rejected"].includes(t.status) ? `ใบนี้${ST[t.status]}แล้ว`
    : owBad ? `เชื่อมคลังกลางมีปัญหา${t.ow_error ? `: ${String(t.ow_error).slice(0, 70)}` : ""}`
    : open.length ? `${ST[t.status] ?? t.status} — มีผลต่างเปิดอยู่ ${open.length} รายการ`
    : `${ST[t.status] ?? t.status}${["in_transit", "shipped"].includes(t.status) ? ` (${hrs} ชม. แล้ว)` : ""}`;
  const bullets = [
    `สินค้า ${items.length} รายการ · ขอ ${items.reduce((n, i) => n + Number(i.qty_requested ?? 0), 0)} · ส่ง ${items.reduce((n, i) => n + Number(i.qty_shipped ?? 0), 0)} · รับ ${items.reduce((n, i) => n + Number(i.qty_received ?? 0), 0)}`,
    ...(t.jst_allocation_no ? [`เลขจัดสรร JST ${t.jst_allocation_no}`] : []),
    ...(t.carrier ? [`ขนส่ง ${t.carrier}${t.tracking ? ` · ${t.tracking}` : ""}`] : []),
    ...(dc.length ? [`ผลต่าง: ${Object.entries(dc.reduce<Record<string, number>>((m, d) => ({ ...m, [DK[d.kind] ?? d.kind]: (m[DK[d.kind] ?? d.kind] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(", ")}`] : []),
  ].slice(0, 4);
  const actions: string[] = [];
  if (owBad) actions.push("เปิดใบนี้แล้วกด \"ตรวจกับคลังกลาง\" หรือแจ้งทีม OW ปิด/แก้ใบที่ค้าง");
  if (t.status === "pending_approval") actions.push("ให้หัวหน้าอนุมัติใบโอน");
  if (["approved", "picking"].includes(t.status)) actions.push("ต้นทางสแกน SN ออกให้ครบแล้วกดยืนยันสแกนออก");
  if (t.status === "packed") actions.push("เรียกขนส่ง แล้วกด \"ยืนยันส่งมอบสินค้า\"");
  if (["in_transit", "shipped"].includes(t.status)) actions.push(hrs > 72 ? "ค้างระหว่างทางนาน — ตามเลขติดตามกับขนส่ง" : "ปลายทางสแกนรับเข้าเมื่อของถึง");
  if (open.length) actions.push("ปิดเคสผลต่าง: ส่งคืนต้นทาง / ปล่อยขายหลังตรวจ / ตัดจำหน่าย / ติดตามส่วนขาด");
  return { headline, bullets, actions: actions.slice(0, 3), risk, source: "rules" };
}

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "transfer.request")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id || id.length > 80) return reply({ error: "ระบุใบโอนไม่ถูกต้อง" }, 400);
  try {
    const x = await loadTransfer(id);
    if (!x) return reply({ error: "ใบนี้ไม่ได้อยู่ในระบบคลังกลาง" }, 404);
    const allowed = await visibleBranchIds(authz);
    if (allowed !== null && ![x.t.from_branch_id, x.t.to_branch_id].some((b) => allowed.includes(b))) return reply({ error: "ไม่มีสิทธิ์ในสาขาของใบนี้" }, 403);
    const t = x.t, base = rules(t);
    const facts = {
      status: t.status, hours_since_created: Math.round((Date.now() - new Date(t.created_at).getTime()) / 3_600_000),
      from: x.from?.code, to: x.to?.code, ow_link_state: t.ow_link_state, ow_error: t.ow_error, jst_allocation: t.jst_allocation_no, carrier: t.carrier ?? null,
      items: ((t.items ?? []) as Row[]).map((i) => ({ sku: i.sku, requested: i.qty_requested, shipped: i.qty_shipped, received: i.qty_received, serialized: i.isSerialized })),
      discrepancies: ((t.discrepancies ?? []) as Row[]).map((d) => ({ kind: d.kind, qty: d.qty, status: d.status, resolution: d.resolution ?? null })),
      ow_lines: Object.values((t.ow_state ?? {}) as Record<string, Row>).map((o) => ({ status: o.status, sync: o.syncState })),
    };
    const key = createHash("sha1").update(JSON.stringify(facts)).digest("hex");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 600_000 && req.nextUrl.searchParams.get("refresh") !== "1") return reply({ summary: hit.s });
    const ai = await aiJson<Omit<Summary, "source">>(
      "คุณคือผู้ช่วยตรวจใบโอนย้ายสินค้าระหว่างสาขา/คลัง ตอบภาษาไทยสั้น กระชับ ใช้ข้อมูลที่ให้เท่านั้น ห้ามเดา " +
      'ตอบ JSON: {"headline": "ภาพรวม/ปัญหาหลักประโยคเดียว ≤ 90 ตัวอักษร", "bullets": ["≤ 4 ข้อ ข้อละ ≤ 70 ตัวอักษร"], "actions": ["สิ่งที่ต้องทำต่อ ≤ 3 ข้อ ระบุว่าฝั่งต้นทางหรือปลายทาง (ว่างได้)"], "risk": "ok|warn|error"} ' +
      "ขั้นตอนใบโอน: ขอ → อนุมัติ → ต้นทางสแกน SN ออก → ส่งมอบขนส่ง → ปลายทางสแกนรับ → ปิดผลต่าง · JST/OW = ระบบคลังกลาง",
      JSON.stringify(facts), { timeoutMs: 12_000 });
    const s: Summary = ai && typeof ai.headline === "string"
      ? { headline: ai.headline.slice(0, 160), bullets: (ai.bullets ?? []).map(String).slice(0, 4), actions: (ai.actions ?? []).map(String).slice(0, 3), risk: ["ok", "warn", "error"].includes(ai.risk) ? ai.risk : base.risk, source: "ai" }
      : base;
    cache.set(key, { at: Date.now(), s });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return reply({ summary: s });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "สรุปไม่สำเร็จ" }, 503); }
}
