import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ความปลอดภัย: ส่งให้ LLM แค่ "บทสนทนา + สเปก dashboard ปัจจุบัน" เท่านั้น
//   ไม่ส่งข้อมูลยอดขาย/ลูกค้า/PII — LLM คืนข้อความโต้ตอบ + คำแนะนำ + สเปก widget
//   แล้ว client คำนวณข้อมูลเองในเครื่อง · รองรับ DeepSeek / Anthropic
const METRICS = ["sales", "qty", "gp", "orders", "aov", "discount"];
const DIMENSIONS = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];
const VIZ = ["kpi", "bar", "donut", "line", "table"];

const SYSTEM = `You are "ผู้ช่วยวิเคราะห์ค้าปลีก", a conversational analytics assistant inside a POS/CRM app (brands: Dreame, Anker, 70mai, DDPAI; multi-branch Thailand). Chat naturally in the user's language, be concise and friendly.
Every turn, return ONLY JSON: {"reply": string, "suggestions": string[], "widgets": null | Array<{"title": string, "viz": "kpi"|"bar"|"donut"|"line"|"table", "metric": "sales"|"qty"|"gp"|"orders"|"aov"|"discount", "dimension": null|"branch"|"brand"|"product"|"employee"|"channel"|"payment"|"day"|"weekday"|"hour", "limit": number|null}>}
- "reply": your message to the user. Answer, explain what you built/changed, OR ask ONE short clarifying question when the request is ambiguous (e.g. which period, which brand, by sales or profit). Be proactive: suggest what could be added (e.g. "ผมใส่กราฟยอดขายรายสาขาให้แล้ว อยากเพิ่มกำไรต่อสาขาด้วยไหม?").
- "suggestions": 2-4 SHORT tappable follow-up prompts in the user's language (e.g. "ดูรายพนักงานด้วย", "เทียบกับเดือนก่อน", "เจาะเฉพาะ Dreame"). Smart next steps given the conversation.
- "widgets": if the user wants to see/build/modify a dashboard, return the FULL new widget list (you are given the current widgets — add/remove/change them as asked). If you are only answering or asking a clarifying question, return null to keep the current dashboard.
Rules: a good dashboard starts with 2-4 KPI tiles (dimension null: sales, orders, aov, gp) then breakdowns (day->line, channel/payment->donut, else bar; add a table for product/employee/branch). "limit" = top-N number or null; never limit day/hour/weekday. You have NO data — never invent numbers. Output JSON only.`;

type Spec = { reply?: string; suggestions?: unknown; widgets?: unknown };
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
    }))
    .slice(0, 8);
  return out.length ? out : null;
}
function cleanResult(spec: Spec) {
  return {
    reply: String(spec.reply ?? "").slice(0, 1200),
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

  const body = (await req.json().catch(() => null)) as { messages?: Msg[]; currentWidgets?: unknown[]; locale?: string } | null;
  const history = (Array.isArray(body?.messages) ? body!.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10);
  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "bad_messages" }, { status: 400 });
  }
  const locale = body?.locale ?? "th";
  const system = `${SYSTEM}\n\nUser locale: ${locale}. Current dashboard widgets (JSON): ${JSON.stringify((body?.currentWidgets ?? []).slice(0, 12))}`;

  try {
    const spec = provider === "deepseek" ? await callDeepSeek(system, history) : await callAnthropic(system, history);
    return NextResponse.json({ ...cleanResult(spec), provider });
  } catch (e) {
    return NextResponse.json({ error: "upstream", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
