"use client";
// =====================================================================
// MetricGlassCards — การ์ดตัวเลขพื้นดำสไตล์ glass (ดัดแปลงจาก card-dashboard-analytic)
//   • ข้อมูลมาจาก props ทั้งหมด (ไม่มีข้อมูลตัวอย่างฝังในคอมโพเนนต์)
//   • แต่ละการ์ดมีหลาย "ช่วงเวลา" วนแสดงอัตโนมัติด้วยแอนิเมชันคลื่น
//   • คลิกการ์ด/จุดช่วงเวลา = เปลี่ยนช่วงเวลาทันที (ไม่มีแผงเปิดด้านล่าง)
//   • ฟอนต์อ่านง่าย (sans + ตัวเลขแบบ tabular) รองรับภาษาไทย · เคารพ prefers-reduced-motion
// =====================================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TrendStatus = "up" | "down" | "flat";
export interface MetricPeriod { name: string; value: string; trend: string; status: TrendStatus; compareLabel: string }
export interface MetricCard {
  id: string;
  label: string;
  icon?: "users" | "money" | "pulse" | "bag" | React.ReactNode;
  prefix?: string;
  suffix?: string;
  periods: MetricPeriod[];
}

type Phase = "idle" | "erasing" | "revealing";

const WaveText: React.FC<{ text: string; phase: Phase; delayStep?: number }> = ({ text, phase, delayStep = 40 }) => {
  if (phase === "idle") return <>{text}</>;
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={`${phase}-${i}-${ch}`} className={`mgc-wave ${phase === "erasing" ? "mgc-out" : "mgc-in"}`} style={{ animationDelay: `${i * delayStep}ms` }}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </>
  );
};

/** ป้ายดำโค้งแบบ liquid ชิดซ้าย (จากต้นฉบับ) */
const LiquidBadge: React.FC<{ label: string; index: number }> = ({ label, index }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [d, setD] = useState({ w: 170, h: 30 });
  const measure = useCallback(() => {
    if (ref.current && ref.current.offsetWidth > 0) setD({ w: ref.current.offsetWidth, h: ref.current.offsetHeight });
  }, []);
  useEffect(() => { measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure, label]);
  const f = 16, H = d.h + f * 2, r = d.h / 2;
  const path = `M 0 0 Q 0 ${f} ${f} ${f} L ${Math.max(f + 4, d.w - r)} ${f} A ${r} ${r} 0 0 1 ${Math.max(f + 4, d.w - r)} ${f + d.h} L ${f} ${f + d.h} Q 0 ${f + d.h} 0 ${H} Z`;
  return (
    <span ref={ref} className="mgc-badge -ml-6 sm:-ml-7 pl-6 sm:pl-7 pr-4 py-1 text-[13px] font-semibold tracking-wide text-neutral-200 group-hover:text-white inline-flex items-center">
      <svg className="mgc-badge-shape" viewBox={`0 0 ${d.w} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`mgc-g-${index}`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#19191e" /><stop offset="52%" stopColor="#09090b" /><stop offset="100%" stopColor="#141418" /></linearGradient>
          <radialGradient id={`mgc-s-${index}`} cx="22%" cy="22%" r="75%"><stop offset="0%" stopColor="rgba(255,255,255,0.14)" /><stop offset="48%" stopColor="rgba(255,255,255,0.02)" /><stop offset="100%" stopColor="rgba(255,255,255,0)" /></radialGradient>
        </defs>
        <path d={path} fill={`url(#mgc-g-${index})`} />
        <path d={path} fill={`url(#mgc-s-${index})`} />
        <path d={path} fill="none" className="mgc-badge-stroke" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      {label}
    </span>
  );
};

function Icon({ kind }: { kind: MetricCard["icon"] }) {
  if (kind && typeof kind !== "string") return <>{kind}</>;
  const p = { className: "w-[18px] h-[18px]", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "users") return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  if (kind === "money") return <svg {...p}><line x1="12" y1="2" x2="12" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
  if (kind === "bag") return <svg {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>;
  return <svg {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>;
}

function TrendBadge({ status, trend, phase }: { status: TrendStatus; trend: string; phase: Phase }) {
  const tone = status === "up" ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
    : status === "down" ? "bg-rose-500/15 border-rose-400/30 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.2)]"
      : "bg-amber-400/15 border-amber-300/30 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.2)]";
  const pts = status === "up" ? ["22 7 13.5 15.5 8.5 10.5 2 17", "16 7 22 7 22 13"] : status === "down" ? ["22 17 13.5 8.5 8.5 13.5 2 7", "16 17 22 17 22 11"] : null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[13px] mgc-dot font-bold tracking-wider", tone)}>
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {pts ? <><polyline points={pts[0]} /><polyline points={pts[1]} /></> : <><line x1="4" y1="12" x2="20" y2="12" /><polyline points="16 8 20 12 16 16" /></>}
      </svg>
      <WaveText text={trend} phase={phase} delayStep={30} />
    </span>
  );
}

export function MetricGlassCards({ cards, className, cycleMs = 4200, footer, title }: { cards: MetricCard[]; className?: string; cycleMs?: number; footer?: React.ReactNode; title?: React.ReactNode }) {
  const [pIdx, setPIdx] = useState<number[]>(() => cards.map(() => 0));
  const [phase, setPhase] = useState<Phase[]>(() => cards.map(() => "idle"));
  const animating = useRef<boolean[]>(cards.map(() => false));
  const turn = useRef(0);
  const [reduce, setReduce] = useState(false);
  useEffect(() => { setReduce(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false); }, []);
  useEffect(() => { setPIdx((p) => cards.map((_, i) => Math.min(p[i] ?? 0, Math.max(0, cards[i].periods.length - 1)))); }, [cards]);

  const goTo = useCallback((i: number, target?: number) => {
    const n = cards[i]?.periods.length ?? 0;
    if (n < 2 || animating.current[i]) return;
    const next = (cur: number) => (target ?? (cur + 1)) % n;
    if (reduce) { setPIdx((p) => { const a = [...p]; a[i] = next(a[i] ?? 0); return a; }); return; }
    animating.current[i] = true;
    setPhase((p) => { const a = [...p]; a[i] = "erasing"; return a; });
    setTimeout(() => {
      setPIdx((p) => { const a = [...p]; a[i] = next(a[i] ?? 0); return a; });
      setPhase((p) => { const a = [...p]; a[i] = "revealing"; return a; });
      setTimeout(() => { setPhase((p) => { const a = [...p]; a[i] = "idle"; return a; }); animating.current[i] = false; }, 560);
    }, 420);
  }, [cards, reduce]);

  useEffect(() => {
    if (!cards.length) return;
    const t = setInterval(() => { if (document.hidden) return; goTo(turn.current % cards.length); turn.current++; }, cycleMs);
    return () => clearInterval(t);
  }, [goTo, cards.length, cycleMs]);

  return (
    <div className={cn("mgc relative overflow-hidden rounded-[2rem] bg-[#08080b] text-white p-5 sm:p-6 antialiased flex flex-col", className)}>
      <style>{CSS}</style>
      <div className="absolute inset-0 mgc-grid pointer-events-none" />
      <div className="absolute -top-32 -left-24 w-96 h-96 bg-white/[0.07] rounded-full blur-[110px] pointer-events-none mgc-glow" />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] bg-neutral-400/[0.06] rounded-full blur-[120px] pointer-events-none mgc-glow" style={{ animationDelay: "4s" }} />

      {title ? <div className="relative z-10 mb-4">{title}</div> : null}

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 flex-1">
        {cards.map((card, i) => {
          const per = card.periods[pIdx[i] ?? 0] ?? card.periods[0];
          const ph = phase[i] ?? "idle";
          return (
            <article key={card.id} onClick={() => goTo(i)} title="คลิกเพื่อสลับช่วงเวลา (วันนี้ · 7 วัน · 30 วัน)"
              className="mgc-card cursor-pointer rounded-[2.25rem] p-6 sm:p-7 flex flex-col justify-between relative overflow-hidden group select-none">
              <div className="flex items-center justify-between relative z-10 mb-6">
                <LiquidBadge label={card.label} index={i} />
                <div className="w-10 h-10 rounded-[1.25rem] bg-white/[0.06] border border-white/15 flex items-center justify-center text-white/90 group-hover:bg-white group-hover:text-black transition-colors duration-300">
                  <Icon kind={card.icon} />
                </div>
              </div>
              <div className="relative z-10 mb-5">
                <p className="text-[13px] font-medium text-neutral-400 mb-1.5 h-5"><WaveText text={per?.name ?? ""} phase={ph} delayStep={22} /></p>
                <div className="flex items-baseline gap-1">
                  {card.prefix ? <span className="mgc-dot font-semibold text-neutral-400 text-2xl sm:text-3xl">{card.prefix}</span> : null}
                  <h2 className="mgc-dot font-bold tracking-wider text-white tabular-nums text-4xl sm:text-5xl leading-none">
                    <WaveText text={per?.value ?? "—"} phase={ph} />
                    {card.suffix ? <span className="font-semibold text-neutral-400 ml-0.5 text-2xl sm:text-3xl">{card.suffix}</span> : null}
                  </h2>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] pt-4 relative z-10">
                {per ? <TrendBadge status={per.status} trend={per.trend} phase={ph} /> : <span />}
                <span className="text-[12px] text-neutral-400 text-right">{per?.compareLabel}</span>
              </div>
            </article>
          );
        })}
      </div>
      {footer ? <div className="relative z-10 mt-4 text-[12px] text-neutral-500 leading-relaxed">{footer}</div> : null}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@600;700;800&display=swap');
.mgc-dot{font-family:'Doto',ui-monospace,monospace}
.mgc-badge{position:relative;z-index:1}
.mgc-badge-shape{position:absolute;top:-16px;left:0;width:100%;height:calc(100% + 32px);pointer-events:none;z-index:-1;filter:drop-shadow(0 10px 18px rgba(0,0,0,.9))}
.mgc-badge-stroke{stroke:rgba(255,255,255,.16);transition:stroke .35s ease}
.group:hover .mgc-badge-stroke{stroke:rgba(255,255,255,.28)}
.mgc-grid{background-image:radial-gradient(rgba(255,255,255,.045) 1px,transparent 0);background-size:28px 28px}
.mgc-card{background:radial-gradient(rgba(255,255,255,.08) .45px,transparent .65px),radial-gradient(circle at 0% 100%,rgba(255,255,255,.16) 0%,rgba(255,255,255,.04) 38%,transparent 72%),linear-gradient(145deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,.015) 100%);background-size:4px 4px,100% 100%,100% 100%;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);box-shadow:0 24px 48px -12px rgba(0,0,0,.85),inset 16px -16px 36px -12px rgba(255,255,255,.08);transition:transform .35s cubic-bezier(.16,1,.3,1),box-shadow .35s ease}
.mgc-card:hover{transform:translateY(-4px);background:radial-gradient(rgba(255,255,255,.11) .45px,transparent .65px),radial-gradient(circle at 0% 100%,rgba(255,255,255,.22) 0%,rgba(255,255,255,.06) 42%,transparent 76%),linear-gradient(145deg,rgba(255,255,255,.075) 0%,rgba(255,255,255,.025) 100%);background-size:4px 4px,100% 100%,100% 100%;box-shadow:0 30px 56px -12px rgba(0,0,0,.92),inset 20px -20px 44px -10px rgba(255,255,255,.12)}
@keyframes mgcPulse{0%,100%{opacity:.45;transform:scale(1)}50%{opacity:.7;transform:scale(1.05)}}
.mgc-glow{animation:mgcPulse 8s ease-in-out infinite}
.mgc-wave{display:inline-block;will-change:transform,opacity,filter}
.mgc-out{animation:mgcOut .38s cubic-bezier(.4,0,.2,1) forwards}
.mgc-in{animation:mgcIn .44s cubic-bezier(.16,1,.3,1) forwards}
@keyframes mgcOut{0%{opacity:1;transform:none;filter:none}100%{opacity:0;transform:translateY(8px) scale(.9);filter:blur(4px)}}
@keyframes mgcIn{0%{opacity:0;transform:translateY(-8px) scale(.9);filter:blur(4px)}100%{opacity:1;transform:none;filter:none}}
@media (prefers-reduced-motion: reduce){.mgc-glow,.mgc-out,.mgc-in{animation:none}.mgc-card,.mgc-card:hover{transition:none;transform:none}}
`;
