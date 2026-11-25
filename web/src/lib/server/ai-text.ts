// เรียก AI แบบข้อความ/JSON สั้น ๆ (ฝั่งเซิร์ฟเวอร์) — DeepSeek หรือ Claude ตาม env เดียวกับ /api/ai/ask
//   ไม่มีคีย์ / ล้ม / เกินเวลา → คืน null ให้ผู้เรียกใช้ทางสำรอง (สรุปจากกฎ) · ผู้เรียกต้องไม่ส่งข้อมูลส่วนบุคคล
export function aiProvider(): "deepseek" | "anthropic" | null {
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY, hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const p = (process.env.AI_PROVIDER || (hasDeepSeek ? "deepseek" : hasAnthropic ? "anthropic" : "")).toLowerCase();
  if (p === "deepseek" && hasDeepSeek) return "deepseek";
  if (p === "anthropic" && hasAnthropic) return "anthropic";
  return null;
}

export async function aiJson<T>(system: string, user: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<T | null> {
  const provider = aiProvider();
  if (!provider) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    let text = "";
    if (provider === "deepseek") {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-chat", max_tokens: opts.maxTokens ?? 700, temperature: 0.2, response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      if (!r.ok) return null;
      text = ((await r.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    } else {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.AI_MODEL || "claude-opus-5-5", max_tokens: opts.maxTokens ?? 700, output_config: { effort: "low" }, system, messages: [{ role: "user", content: user }] }),
      });
      if (!r.ok) return null;
      text = (((await r.json()) as { content?: { type: string; text?: string }[] }).content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    }
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
