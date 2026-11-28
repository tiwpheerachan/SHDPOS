// =====================================================================
// AI Studio — วนรอบ agent ฝั่งเบราว์เซอร์: ถาม AI → รัน run_query บนข้อมูลจริง → ส่งผลกลับ → ตรวจแดชบอร์ด → ให้แก้จนผ่าน
//   ข้อมูลรายแถวไม่ออกจากเบราว์เซอร์ (AI ได้แค่ผลรวม ≤40 แถว) · ไม่มี AI/เรียกไม่ได้ → ตัววางแผนสำรอง
// =====================================================================
import { runQuery, compactResult } from "./query";
import { lintDashboard, type LintIssue } from "./lint";
import { planLocal } from "./planner";
import { profileDataset } from "./datasets";
import type { Dataset, QuerySpec, StudioDashboard } from "./types";

export type Call = { id: string; name: string; input: unknown };
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; provider: string; text: string; calls: Call[]; raw?: unknown }
  | { role: "tool"; results: { id: string; content: string; isError?: boolean }[] };
export type Progress = { kind: "thinking" | "query" | "validate" | "fix" | "done" | "fallback"; text: string };
export type AgentResult = { dashboard: StudioDashboard; turns: Turn[]; provider: string; issues: LintIssue[]; queries: number; note?: string };

const MAX_STEPS = 12;

export async function runStudioAgent(opts: {
  datasets: Dataset[]; turns: Turn[]; locale: string; onProgress?: (p: Progress) => void; signal?: AbortSignal;
}): Promise<AgentResult> {
  const { datasets, locale, onProgress } = opts;
  const turns = [...opts.turns];
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const profiles = datasets.map(profileDataset);
  let queries = 0, provider = "local";
  const fallback = (why: string): AgentResult => {
    onProgress?.({ kind: "fallback", text: why });
    const main = datasets[0];
    const lint = lintDashboard(planLocal(main), datasets);
    return { dashboard: lint.dashboard, turns, provider: "local", issues: lint.issues, queries, note: why };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    // งบสำรวจหมด → บอกให้ส่งแดชบอร์ดเลย (และบังคับเครื่องมือส่งใน DeepSeek)
    const finalize = step >= 3 || queries >= 16;
    if (finalize && turns[turns.length - 1]?.role === "tool" && !(turns[turns.length - 1] as { nudged?: boolean }).nudged) {
      turns.push({ role: "user", text: "You have enough evidence. Design and submit the full dashboard now with submit_dashboard (no more run_query)." });
    }
    onProgress?.({ kind: "thinking", text: step === 0 ? "กำลังอ่านโครงข้อมูลและตั้งสมมติฐานหลายมุม…" : finalize ? "สรุปผลและออกแบบแดชบอร์ด…" : "กำลังวิเคราะห์ผลและออกแบบต่อ…" });
    let res: Response;
    try {
      res = await fetch("/api/ai/studio", { method: "POST", headers: { "Content-Type": "application/json" }, signal: opts.signal,
        body: JSON.stringify({ turns, datasets: profiles, locale, finalize, today: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10) }) });
    } catch (e) { if ((e as Error).name === "AbortError") throw e; return fallback("เชื่อมต่อ AI ไม่ได้ — ใช้ร่างอัตโนมัติจากโครงข้อมูลแทน"); }
    if (res.status === 501) return fallback("ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ — ใช้ร่างอัตโนมัติจากโครงข้อมูลแทน");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return fallback(`AI ตอบผิดพลาด (${j.error ?? res.status}) — ใช้ร่างอัตโนมัติแทน`);
    provider = j.provider;
    const a: Turn = { role: "assistant", provider: j.provider, text: j.text ?? "", calls: j.calls ?? [], raw: j.raw };
    turns.push(a);
    if (!a.calls.length) {
      // AI ตอบเป็นข้อความโดยไม่ส่งแดชบอร์ด → ขอให้ส่งด้วยเครื่องมือ (ครั้งเดียว)
      if (step < MAX_STEPS - 1) { turns.push({ role: "user", text: "Please submit the dashboard now with the submit_dashboard tool." }); continue; }
      return fallback("AI ไม่ได้ส่งแดชบอร์ด — ใช้ร่างอัตโนมัติแทน");
    }
    const results: { id: string; content: string; isError?: boolean }[] = [];
    let submitted: AgentResult | null = null;
    for (const c of a.calls) {
      const input = (c.input ?? {}) as { query?: QuerySpec; purpose?: string; dashboard?: StudioDashboard };
      if (c.name === "run_query") {
        queries++;
        onProgress?.({ kind: "query", text: input.purpose ? `ทดสอบ: ${input.purpose}` : "กำลังคำนวณ…" });
        const ds = input.query ? byId.get(input.query.dataset) : undefined;
        try {
          if (!input.query) throw Error("missing query");
          if (!ds) throw Error(`unknown dataset "${input.query.dataset}" (available: ${[...byId.keys()].join(", ")})`);
          results.push({ id: c.id, content: JSON.stringify(compactResult(runQuery(ds, input.query))) });
        } catch (e) { results.push({ id: c.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, isError: true }); }
      } else if (c.name === "submit_dashboard") {
        onProgress?.({ kind: "validate", text: "กำลังตรวจทุกการ์ดด้วยข้อมูลจริง…" });
        const d = input.dashboard;
        if (!d || !Array.isArray(d.widgets)) { results.push({ id: c.id, content: "Error: dashboard.widgets is required", isError: true }); continue; }
        const lint = lintDashboard(d, datasets);
        if (lint.errors.length) {
          onProgress?.({ kind: "fix", text: `พบ ${lint.errors.length} การ์ดที่ต้องแก้ — ให้ AI แก้ไข…` });
          results.push({ id: c.id, content: `Validation failed. Fix these widgets and resubmit the FULL dashboard:\n${lint.errors.map((e) => `- [${e.widget}] ${e.title}: ${e.message}`).join("\n")}`, isError: true });
        } else {
          results.push({ id: c.id, content: `Rendered OK.${lint.issues.length ? ` Auto-fixed: ${lint.issues.map((i) => `${i.title}: ${i.message}`).join("; ")}` : ""}` });
          submitted = { dashboard: lint.dashboard, turns: [], provider, issues: lint.issues, queries };
        }
      } else results.push({ id: c.id, content: `Error: unknown tool ${c.name}`, isError: true });
    }
    turns.push({ role: "tool", results });
    if (submitted) { onProgress?.({ kind: "done", text: "เสร็จแล้ว" }); return { ...submitted, turns }; }
  }
  return fallback("AI ใช้รอบเกินกำหนด — ใช้ร่างอัตโนมัติแทน");
}
