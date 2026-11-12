import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ความปลอดภัย: ส่งให้ Claude แค่ "คำถาม + schema ของ widget" เท่านั้น
//   ไม่ส่งข้อมูลยอดขาย/ลูกค้า/PII ใดๆ — Claude คืนแค่ "สเปก" แล้ว client
//   ไปคำนวณเองจาก order ในเครื่อง
const METRICS = ["sales", "qty", "gp", "orders", "aov", "discount"];
const DIMENSIONS = ["branch", "brand", "product", "employee", "channel", "payment", "day", "weekday", "hour"];
const VIZ = ["kpi", "bar", "donut", "line", "table"];

const SYSTEM = `You convert a retail business question into a dashboard spec for a POS/CRM app (brands: Dreame, Anker, 70mai, DDPAI; multi-branch Thailand).
Return ONLY valid JSON, no prose, shaped exactly:
{"name": string, "answer": string, "widgets": [{"title": string, "viz": "kpi"|"bar"|"donut"|"line"|"table", "metric": "sales"|"qty"|"gp"|"orders"|"aov"|"discount", "dimension": null|"branch"|"brand"|"product"|"employee"|"channel"|"payment"|"day"|"weekday"|"hour", "limit": number|null}]}
Rules:
- Always start widgets with 2-4 KPI tiles (dimension null): usually sales, orders, aov, gp.
- Then add 1-3 breakdown widgets answering the question (choose the right dimension + viz: day->line, channel/payment->donut, else bar; add a matching "table" widget for product/employee/branch breakdowns).
- "limit" for top-N (e.g. "top 10"): set the number; null otherwise. Never limit day/hour/weekday.
- "answer": one short sentence in the SAME language as the question, describing what the dashboard shows (do not invent numbers — you have no data).
- "name": a short 2-6 word title in the question's language.
Only use the allowed enum values. Output JSON only.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { prompt?: string; locale?: string } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "no_prompt" }, { status: 400 });

  const model = process.env.AI_MODEL || "claude-opus-5-5";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: `Question (locale=${body?.locale ?? "th"}): ${prompt}` }],
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return NextResponse.json({ error: "upstream", status: r.status, detail: txt.slice(0, 300) }, { status: 502 });
    }
    const data = (await r.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "parse", raw: text.slice(0, 300) }, { status: 502 });
    const spec = JSON.parse(m[0]) as { name?: string; answer?: string; widgets?: unknown[] };

    // ตรวจ/ทำความสะอาดสเปก (กันค่าเพี้ยนจากโมเดล)
    const widgets = (Array.isArray(spec.widgets) ? spec.widgets : [])
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
    if (!widgets.length) return NextResponse.json({ error: "empty" }, { status: 502 });

    return NextResponse.json({
      name: String(spec.name ?? prompt).slice(0, 48),
      answer: String(spec.answer ?? ""),
      widgets,
    });
  } catch (e) {
    return NextResponse.json({ error: "exception", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
