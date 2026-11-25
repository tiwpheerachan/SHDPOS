// /api/pos/order-summary?client_uuid=&refresh=1 — สรุปบิลสั้น ๆ (AI ถ้ามีคีย์ · ไม่งั้นสรุปจากกฎ) สิทธิ์ sales.trace
//   ส่งให้ AI เฉพาะสถานะ/ตัวเลขของแต่ละขั้น — ไม่ส่งชื่อลูกค้า เบอร์ ชื่อพนักงาน หมายเหตุ · แคช 10 นาทีต่อบิล+สถานะ
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { buildOrderTrace, loadOrder, type Stage } from "@/lib/server/order-trace";
import { aiJson, aiProvider } from "@/lib/server/ai-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
type Summary = { headline: string; bullets: string[]; actions: string[]; risk: "ok" | "warn" | "error"; source: "ai" | "rules" };
const cache = new Map<string, { at: number; s: Summary }>();
const PII = ["ลูกค้า", "แคชเชียร์", "พนักงานขาย", "หมายเหตุ", "หมายเหตุที่ JST เห็น", "มาจาก", "อนุมัติโดย"];

function rules(stages: Stage[]): Summary {
  const get = (k: string) => stages.find((s) => s.key === k);
  const bad = stages.filter((s) => s.status === "error"), warn = stages.filter((s) => s.status === "warn");
  const risk: Summary["risk"] = bad.length ? "error" : warn.length ? "warn" : "ok";
  const headline = bad.length ? `บิลยังไม่สมบูรณ์ — ${bad.map((s) => `${s.title}: ${s.summary}`).join(" · ")}`
    : warn.length ? `บิลบันทึกแล้ว แต่ต้องติดตาม ${warn.map((s) => s.title).join(", ")}` : "บิลเรียบร้อยครบทุกขั้น";
  const bullets = ["price", "payment", "jst", "loyalty", "after"].map((k) => get(k)).filter((s): s is Stage => !!s && s.status !== "none").map((s) => `${s.title}: ${s.summary}`).slice(0, 4);
  const actions: string[] = [];
  const jst = get("jst"), after = get("after"), pay = get("payment"), stock = get("stock");
  if (jst?.status === "error") actions.push("ให้ทีมคลังกลางเปิด SKU ในสาขา/เติมสต๊อกใน JST แล้วกด \"ส่งใหม่\" ที่หน้ารายการบิล");
  if (jst?.status === "warn") actions.push("รอ JST ยืนยัน — ถ้าเกิน 10 นาทียังไม่เปลี่ยน ให้ตรวจที่หน้า เชื่อมคลังกลาง → ส่งบิลขาย");
  if (after?.details.some((d) => d.label.startsWith("รอทีมคลังกลาง"))) actions.push("แจ้งทีมคลังกลางทำรับคืนใน JST แล้วกด \"ทำใน JST แล้ว\" ที่หน้าคืนสินค้า");
  if (after?.summary.includes("รออนุมัติ")) actions.push("ให้หัวหน้าอนุมัติคำขอคืนที่หน้า คืน/เปลี่ยนสินค้า");
  if (pay?.status === "warn") actions.push("ยอดรับชำระไม่ตรงยอดบิล — ตรวจที่หน้า ตรวจรายการรับชำระ");
  if (stock?.status === "warn") actions.push("บิลไม่ได้ตัดสต๊อก POS — ตรวจความเคลื่อนไหวสต๊อก");
  return { headline, bullets, actions: actions.slice(0, 3), risk, source: "rules" };
}

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "sales.trace")) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const cu = req.nextUrl.searchParams.get("client_uuid"), no = req.nextUrl.searchParams.get("order_no");
  if (!(cu && UUID.test(cu)) && !(no && no.length < 60)) return reply({ error: "ระบุบิลไม่ถูกต้อง" }, 400);
  try {
    const o = await loadOrder(cu && UUID.test(cu) ? { client_uuid: cu } : { order_no: no });
    if (!o) return reply({ error: "ไม่พบบิล" }, 404);
    const allowed = await visibleBranchIds(authz);
    if (allowed !== null && !allowed.includes(o.branch_id)) return reply({ error: "ไม่มีสิทธิ์ในสาขาของบิลนี้" }, 403);
    const t = await buildOrderTrace(o, false);
    const base = rules(t.stages);
    // ข้อเท็จจริงที่ปลอดข้อมูลส่วนบุคคล
    const facts = {
      status: o.status, grand_total: Number(o.grand_total), discount_total: Number(o.discount_total), channel: o.channel,
      stages: t.stages.map((s) => ({ step: s.title, status: s.status, summary: s.key === "origin" ? s.details.filter((d) => ["ช่องทาง", "สาขา"].includes(d.label)).map((d) => d.value).join(" · ") : s.summary,
        details: s.details.filter((d) => !PII.some((p) => d.label.startsWith(p))).slice(0, 8).map((d) => `${d.label}: ${d.value}`) })),
      events: t.timeline.map((e) => e.label).slice(-12),
    };
    const key = createHash("sha1").update(JSON.stringify(facts)).digest("hex");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 600_000 && req.nextUrl.searchParams.get("refresh") !== "1") return reply({ summary: hit.s, provider: aiProvider() });
    const ai = await aiJson<Omit<Summary, "source">>(
      "คุณคือผู้ช่วยตรวจบิลของร้านค้าปลีก ตอบภาษาไทยสั้น กระชับ ใช้ข้อมูลที่ให้เท่านั้น ห้ามเดา " +
      'ตอบ JSON: {"headline": "ประโยคเดียวบอกภาพรวม/ปัญหาหลัก ≤ 90 ตัวอักษร", "bullets": ["ประเด็นสำคัญ ≤ 4 ข้อ ข้อละ ≤ 70 ตัวอักษร"], "actions": ["สิ่งที่พนักงาน/หัวหน้าควรทำต่อ ≤ 3 ข้อ (ว่างได้ถ้าเรียบร้อย)"], "risk": "ok|warn|error"} ' +
      "ขั้นตอนของบิล: ที่มา → ราคาและโปร → ชำระเงิน → สต๊อก/SN → คลังกลาง/JST → แต้มสะสม → หลังการขาย · JST = ระบบคลังกลาง",
      JSON.stringify(facts), { timeoutMs: 12_000 });
    const s: Summary = ai && typeof ai.headline === "string"
      ? { headline: ai.headline.slice(0, 160), bullets: (ai.bullets ?? []).map(String).slice(0, 4), actions: (ai.actions ?? []).map(String).slice(0, 3), risk: ["ok", "warn", "error"].includes(ai.risk) ? ai.risk : base.risk, source: "ai" }
      : base;
    cache.set(key, { at: Date.now(), s });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return reply({ summary: s, provider: aiProvider() });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "สรุปไม่สำเร็จ" }, 503); }
}
