import { NextRequest, NextResponse } from "next/server";
import { metricsBrief } from "@/lib/ai/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ความปลอดภัย: ส่งให้ LLM แค่ "บทสนทนา + สเปก dashboard ปัจจุบัน" เท่านั้น
//   ไม่ส่งข้อมูลยอดขาย/ลูกค้า/PII — LLM คืนข้อความโต้ตอบ + คำแนะนำ + สเปก widget
//   แล้ว client คำนวณข้อมูลเองในเครื่อง · รองรับ DeepSeek / Anthropic
const METRICS = ["sales", "qty", "gp", "orders", "aov", "discount", "gp_pct", "discount_pct"];
const DIMENSIONS = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];
const VIZ = ["kpi", "bar", "hbar", "donut", "line", "table", "heatmap"];
const TRANSFORMS = ["none", "cumulative", "ma7"];

const SYSTEM = `You are "ผู้ช่วยวิเคราะห์ค้าปลีก", a retail business ANALYST inside a POS/CRM app (brands: Dreame, Anker, 70mai, DDPAI; multi-branch Thailand). Chat naturally in the user's language, concise and evidence-based.

You are given FACTS: real numbers PRE-COMPUTED by the app for the user's current scope & period, plus the previous comparable period. Timezone Asia/Bangkok.
CRITICAL: Analyze ONLY using the numbers in FACTS. Every figure you state must come from FACTS verbatim — NEVER invent, estimate, or recompute numbers. If FACTS lack something, say what is missing instead of guessing.

Return ONLY JSON: {"reply": string, "insights": [{"text": string, "tone": "ok"|"warn"|"info"}], "suggestions": string[], "widgets": null | Array<{"title": string, "viz": "kpi"|"bar"|"hbar"|"donut"|"line"|"table"|"heatmap", "metric": "sales"|"qty"|"gp"|"gp_pct"|"orders"|"aov"|"discount"|"discount_pct", "dimension": null|"branch"|"brand"|"product"|"employee"|"channel"|"payment"|"day"|"weekday"|"hour", "limit": number|null, "compare": boolean, "transform": "none"|"cumulative"|"ma7"}>}
Chart types: bar/hbar(horizontal, good for long names) for ranked comparison; line for time; donut for few-category composition; heatmap for patterns by weekday×hour (ignores dimension); table for detail. Set "compare": true to show vs the previous comparable period (grouped bars / delta columns / KPI trend) — use it when the user asks to compare periods or wants trend context.
Calculated metrics: gp_pct = gross-profit margin % (gp/sales), discount_pct = discount % of sales — use these when the user asks about margin/discount rate, not the baht amount. "transform" applies to dimension="day" time series: "cumulative" (running total) or "ma7" (7-point moving average); else "none".
- "reply": 1-2 sentences answering/acknowledging, in the user's language. Ask ONE clarifying question only if truly ambiguous; otherwise assume a sensible default and state it.
- "insights": 2-3 findings, each citing ACTUAL numbers from FACTS (e.g. "ยอดขาย ฿X โต +12% ขับเคลื่อนโดยจำนวนบิล +8% และ AOV +4%"). When explaining a change, decompose (orders vs AOV; which branch/brand/SKU drove it). Separate observed FACTS from hypotheses to verify (say "ควรตรวจ/สมมติฐาน"); do NOT claim causation from correlation. tone: ok=good, warn=problem/attention, info=neutral.
- "suggestions": 2-4 short tappable follow-ups in the user's language (e.g. "เทียบเดือนก่อน", "เจาะสาขาที่ตกมากสุด", "แยกตาม SKU").
- "widgets": build/modify the dashboard to match the question (you get current widgets — change only what's relevant, keep the rest). null = keep current. Pick the RIGHT chart (time->line, compare branches/products->ranked bar, composition->donut for few categories, detail->table). Default: 3-5 KPI tiles + 1 main chart + 1-2 supporting; a simple question may need just 1 KPI/chart. Never add empty charts.

${""}
Honesty: if scope note says local/partial data, do NOT claim company-wide. If a base is zero, don't state a misleading growth %. Output JSON only.`;

type Spec = { reply?: string; insights?: unknown; suggestions?: unknown; widgets?: unknown };
type Msg = { role: string; content: string };

function cleanWidgets(raw: unknown): object[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((w) => w as Record<string, unknown>)
    .filter((w) => METRICS.includes(String(w.metric)) && VIZ.includes(String(w.viz)))
    .map((w) => ({
      id: Math.random().toString(36).slice(2, 9),
      title: String(w.title ?? ""),
      viz: String(w.viz),
      metric: String(w.metric),
      dimension: w.dimension && DIMENSIONS.includes(String(w.dimension)) ? String(w.dimension) : null,
      limit: typeof w.limit === "number" && w.limit > 0 ? Math.min(100, Math.trunc(w.limit)) : null,
      compare: w.compare === true,
      transform: TRANSFORMS.includes(String(w.transform)) ? String(w.transform) : "none",
    }))
    .slice(0, 8);
  return out.length ? out : null;
}
function cleanResult(spec: Spec) {
  const tones = ["ok", "warn", "info"];
  const insights = Array.isArray(spec.insights)
    ? spec.insights.map((x) => x as Record<string, unknown>).filter((x) => x && typeof x.text === "string")
      .map((x) => ({ text: String(x.text).slice(0, 400), tone: tones.includes(String(x.tone)) ? String(x.tone) : "info" })).slice(0, 4)
    : [];
  return {
    reply: String(spec.reply ?? "").slice(0, 1200),
    insights,
    suggestions: Array.isArray(spec.suggestions) ? spec.suggestions.map((s) => String(s)).filter(Boolean).slice(0, 4) : [],
    widgets: cleanWidgets(spec.widgets),
  };
}
const parseJson = (text: string): Spec => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json");
  return JSON.parse(m[0]) as Spec;
};

async function callDeepSeek(system: string, messages: Msg[]): Promise<Spec> {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      max_tokens: 1400, temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!r.ok) throw new Error(`deepseek ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return parseJson(d.choices?.[0]?.message?.content ?? "");
}
async function callAnthropic(system: string, messages: Msg[]): Promise<Spec> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-opus-5-5",
      max_tokens: 1500, output_config: { effort: "low" },
      system,
      messages: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const d = (await r.json()) as { content?: { type: string; text?: string }[] };
  return parseJson((d.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""));
}

export async function POST(req: NextRequest) {
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const provider = (process.env.AI_PROVIDER || (hasDeepSeek ? "deepseek" : hasAnthropic ? "anthropic" : "")).toLowerCase();
  if (!provider || (provider === "deepseek" && !hasDeepSeek) || (provider === "anthropic" && !hasAnthropic)) {
    return NextResponse.json({ error: "no_api_key" }, { status: 501 });
  }

  const body = (await req.json().catch(() => null)) as { messages?: Msg[]; currentWidgets?: unknown[]; facts?: unknown; locale?: string } | null;
  const history = (Array.isArray(body?.messages) ? body!.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10);
  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "bad_messages" }, { status: 400 });
  }
  const locale = body?.locale ?? "th";
  const factsJson = body?.facts ? JSON.stringify(body.facts).slice(0, 9000) : "null";
  const system = `${SYSTEM}\n\n${metricsBrief()}\n\nUser locale: ${locale}.\nCurrent dashboard widgets (JSON): ${JSON.stringify((body?.currentWidgets ?? []).slice(0, 12))}\n\nFACTS (real pre-computed numbers for the current scope & period — analyze ONLY these):\n${factsJson}`;

  try {
    const spec = provider === "deepseek" ? await callDeepSeek(system, history) : await callAnthropic(system, history);
    return NextResponse.json({ ...cleanResult(spec), provider });
  } catch (e) {
    return NextResponse.json({ error: "upstream", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
