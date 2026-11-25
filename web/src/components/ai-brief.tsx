"use client";
// การ์ด "AI สรุป" ใช้ร่วม (บิล/ใบโอน/…) — endpoint คืน { summary: {headline, bullets, actions, risk, source} }
//   ลูกแก้ว AI ขยับตลอด (แรงขึ้นตอนกำลังคิด) · ประเด็นที่มีชื่อขั้นตรงกับ stages กดแล้วกระโดดไปขั้นนั้น
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";

type Status = "ok" | "warn" | "error" | "info" | "none";
const TONE: Record<Status, { dot: string }> = { ok: { dot: "bg-emerald-500" }, warn: { dot: "bg-amber-500" }, error: { dot: "bg-red-500" }, info: { dot: "bg-sky-500" }, none: { dot: "bg-line" } };

type Summary = { headline: string; bullets: string[]; actions: string[]; risk: "ok" | "warn" | "error"; source: "ai" | "rules" };
const RISK = {
  ok: { label: "เรียบร้อย", pill: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", hue: 0 },
  warn: { label: "ต้องติดตาม", pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300", hue: 0 },
  error: { label: "มีปัญหา", pill: "bg-red-500/12 text-red-700 dark:text-red-300", hue: 0 },
} as const;
export function AiBrief({ endpoint, stages = [], onJump, title = "AI สรุปบิล" }: { endpoint: string; stages?: { key: string; title: string; status: Status }[]; onJump?: (k: string) => void; title?: string }) {
  const [s, setS] = useState<Summary | null>(null), [busy, setBusy] = useState(true), [err, setErr] = useState("");
  async function load(refresh = false) {
    setBusy(true); setErr("");
    try { const r = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${refresh ? "refresh=1" : ""}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error); setS(j.summary); }
    catch (e) { setErr(e instanceof Error ? e.message : "สรุปไม่สำเร็จ"); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageOf = (text: string) => stages.find((st) => text.includes(st.title));
  const risk = s ? RISK[s.risk] : null;

  return (
    <section className="relative overflow-hidden rounded-[20px] border border-line/70 bg-surface">
      {/* แสงพื้นหลังนุ่ม ๆ ตามสีลูกแก้ว */}
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute left-24 -bottom-24 h-48 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative flex gap-4 p-4">
        <div className="relative h-11 w-11 shrink-0 mt-0.5">
          <VoicePoweredOrb active={busy} className="!absolute inset-0" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold tracking-wide bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 bg-clip-text text-transparent">{title}</p>
            {risk && !busy ? <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${risk.pill}`}>{risk.label}</span> : null}
            <button onClick={() => void load(true)} disabled={busy} title="สรุปใหม่" aria-label="สรุปใหม่" className="ml-auto h-7 w-7 grid place-items-center rounded-full text-muted hover:text-ink hover:bg-surface2 disabled:opacity-40"><RefreshCw size={13} className={busy ? "animate-spin" : ""} /></button>
          </div>

          {busy && !s ? (
            <div className="space-y-2 pt-0.5">
              <p className="text-sm text-muted">กำลังอ่านบิลทุกขั้น…</p>
              <div className="space-y-1.5 animate-pulse"><div className="h-2.5 w-4/5 rounded-full bg-surface2" /><div className="h-2.5 w-3/5 rounded-full bg-surface2" /></div>
            </div>
          ) : err ? <p className="text-xs text-danger">{err}</p> : s ? <>
            <p className="text-[15px] font-semibold leading-snug text-ink">{s.headline}</p>
            {s.bullets.length ? (
              <div className="flex flex-wrap gap-1.5">
                {s.bullets.map((b, i) => {
                  const st = stageOf(b), T = st ? TONE[st.status] : TONE.none;
                  return (
                    <button key={i} type="button" disabled={!st || !onJump} onClick={() => st && onJump?.(st.key)} title={st ? `ไปที่ขั้น ${st.title}` : undefined}
                      className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-line bg-surface/80 px-2.5 py-1 text-[11.5px] text-ink/85 enabled:hover:border-brand/40 enabled:hover:bg-brand/5 transition">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${T.dot}`} /><span className="truncate">{b}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {s.actions.length ? (
              <ol className="mt-1 space-y-1.5 rounded-2xl bg-surface2/60 px-3 py-2.5">
                <p className="text-[10.5px] font-semibold text-muted">ขั้นตอนถัดไป</p>
                {s.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] leading-snug">
                    <span className="mt-px h-[18px] w-[18px] shrink-0 grid place-items-center rounded-full bg-ink text-surface text-[10px] font-semibold">{i + 1}</span>{a}
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="text-[10px] text-muted">{s.source === "ai" ? "สรุปโดย AI จากสถานะและตัวเลข · ไม่ได้ส่งชื่อ/เบอร์ลูกค้า" : "สรุปอัตโนมัติจากกฎของระบบ"}</p>
          </> : null}
        </div>
      </div>
    </section>
  );
}
