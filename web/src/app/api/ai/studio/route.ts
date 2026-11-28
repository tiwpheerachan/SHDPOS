// =====================================================================
// /api/ai/studio — 1 ขั้นของ agent สร้างแดชบอร์ด (หน้าเว็บวนเรียกจนจบ): ส่งบทสนทนา + โครงข้อมูล → AI ตอบ/สั่งเครื่องมือ
//   เครื่องมือทำงานในเบราว์เซอร์ (run_query คำนวณจากข้อมูลจริง) → AI ไม่เห็นข้อมูลรายแถว/ข้อมูลลูกค้า
//   ผู้ให้บริการ: Claude (ANTHROPIC_API_KEY · @anthropic-ai/sdk · claude-opus-5-5 + fallback) หรือ DeepSeek (function calling)
//   สิทธิ์: ล็อกอิน + report.employee_perf (เหมือนหน้าผู้ช่วย AI)
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { STUDIO_PLAYBOOK, RUN_QUERY_TOOL, SUBMIT_TOOL } from "@/lib/ai/studio/playbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

/** บทสนทนาแบบกลาง (หน้าเว็บเก็บ) — assistant.raw = เนื้อหาเดิมของผู้ให้บริการ (Claude: content blocks รวม thinking ต้องส่งกลับตามเดิม) */
type Call = { id: string; name: string; input: unknown };
type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; provider: string; text: string; calls: Call[]; raw?: unknown }
  | { role: "tool"; results: { id: string; content: string; isError?: boolean }[] };

function pickProvider() {
  const hasA = !!process.env.ANTHROPIC_API_KEY, hasD = !!process.env.DEEPSEEK_API_KEY;
  const want = (process.env.AI_STUDIO_PROVIDER || (hasA ? "anthropic" : hasD ? "deepseek" : "")).toLowerCase();
  if (want === "anthropic" && hasA) return "anthropic";
  if (want === "deepseek" && hasD) return "deepseek";
  return hasA ? "anthropic" : hasD ? "deepseek" : null;
}

// ── Claude (SDK ทางการ) ──
async function stepAnthropic(system: string, context: string, turns: Turn[]) {
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of turns) {
    if (t.role === "user") messages.push({ role: "user", content: t.text });
    else if (t.role === "assistant") {
      // เนื้อหาเดิมของ Claude (รวม thinking) ต้องส่งกลับไม่แก้ · ถ้ามาจากผู้ให้บริการอื่น สร้างใหม่จากข้อความ/การเรียกเครื่องมือ
      const content = t.provider === "anthropic" && Array.isArray(t.raw) ? (t.raw as Anthropic.Beta.BetaContentBlockParam[])
        : [...(t.text ? [{ type: "text" as const, text: t.text }] : []), ...t.calls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input as Record<string, unknown> }))];
      messages.push({ role: "assistant", content });
    } else messages.push({ role: "user", content: t.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: !!r.isError })) });
  }
  const res = await client.beta.messages.create({
    model: process.env.AI_STUDIO_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    // คู่มือคงที่ (แคชได้) แล้วตามด้วยโครงข้อมูลของคำขอนี้
    system: [{ type: "text", text: STUDIO_PLAYBOOK, cache_control: { type: "ephemeral" } }, { type: "text", text: context }],
    tools: [RUN_QUERY_TOOL, SUBMIT_TOOL],
    messages,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") throw Error("AI ปฏิเสธคำขอนี้");
  const calls: Call[] = [];
  let text = "";
  for (const b of res.content) {
    if (b.type === "tool_use") calls.push({ id: b.id, name: b.name, input: b.input });
    else if (b.type === "text") text += b.text;
  }
  return { provider: "anthropic", text, calls, raw: res.content, done: res.stop_reason !== "tool_use", usage: { in: res.usage.input_tokens, out: res.usage.output_tokens } };
}

// ── DeepSeek (รูปแบบ function calling แบบ OpenAI) ──
async function stepDeepSeek(system: string, context: string, turns: Turn[], finalize: boolean) {
  const msgs: Record<string, unknown>[] = [{ role: "system", content: `${system}\n\n${context}` }];
  for (const t of turns) {
    if (t.role === "user") msgs.push({ role: "user", content: t.text });
    else if (t.role === "assistant") msgs.push({ role: "assistant", content: t.text || null, ...(t.calls.length ? { tool_calls: t.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}) });
    else for (const r of t.results) msgs.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  const tools = [RUN_QUERY_TOOL, SUBMIT_TOOL].map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } }));
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-chat", max_tokens: 8000, temperature: 0.2, tools, tool_choice: finalize ? { type: "function", function: { name: "submit_dashboard" } } : "auto", messages: msgs }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!r.ok) throw Error(`deepseek ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const d = (await r.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const m = d.choices?.[0]?.message;
  const calls: Call[] = (m?.tool_calls ?? []).map((c) => { let input: unknown = {}; try { input = JSON.parse(c.function.arguments || "{}"); } catch { input = { __invalid_json: c.function.arguments?.slice(0, 200) }; } return { id: c.id, name: c.function.name, input }; });
  return { provider: "deepseek", text: m?.content ?? "", calls, raw: null, done: !calls.length, usage: { in: d.usage?.prompt_tokens ?? 0, out: d.usage?.completion_tokens ?? 0 } };
}

export async function POST(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "report.employee_perf")) return reply({ error: "ไม่มีสิทธิ์ใช้ผู้ช่วย AI" }, 403);
  const provider = pickProvider();
  if (!provider) return reply({ error: "no_api_key" }, 501);

  const b = (await req.json().catch(() => null)) as { turns?: Turn[]; datasets?: unknown; locale?: string; today?: string; finalize?: boolean } | null;
  const turns = Array.isArray(b?.turns) ? b!.turns.slice(-60) : [];
  if (!turns.length || turns[0].role !== "user") return reply({ error: "bad_turns" }, 400);
  const context = `## Context for this request
Today (Asia/Bangkok): ${String(b?.today ?? new Date().toISOString().slice(0, 10)).slice(0, 10)}. User language: ${b?.locale === "en" ? "English" : b?.locale === "zh" ? "Chinese" : "Thai"}.
Datasets (profiles computed in the browser — field keys are exact):
${JSON.stringify(b?.datasets ?? []).slice(0, 60000)}`;
  try {
    const step = provider === "anthropic" ? await stepAnthropic(STUDIO_PLAYBOOK, context, turns) : await stepDeepSeek(STUDIO_PLAYBOOK, context, turns, !!b?.finalize);
    return reply(step);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply({ error: "AI ถูกจำกัดอัตราการใช้งาน ลองใหม่อีกครู่" }, 429);
    if (e instanceof Anthropic.APIError) return reply({ error: `AI error ${e.status ?? ""}`.trim(), detail: e.message.slice(0, 300) }, 502);
    return reply({ error: "upstream", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) }, 502);
  }
}
