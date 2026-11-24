"use client";
// =====================================================================
// OrbitGoals — วงแหวนเป้าหมาย (ดัดแปลงจาก db-orbit-goals)
//   ปรับให้เข้ากับธีม SHD: ตัวแปรสีของเราเป็นเลข RGB → ใช้ rgb(var(--x)) · พื้นปุ่มใช้ bg-surface2
//   เพิ่ม readOnly (ใช้แสดง KPI จริง — ห้ามลากเปลี่ยนค่า) · ป้ายข้อความแปลได้ · ซ่อนปุ่มธีมได้
// =====================================================================
import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Minus, Moon, Plus, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Goal {
  id: string; label: string; unit: string; goal: number; value: number; step: number;
  /** CSS var index 0-2 */ hue: 0 | 1 | 2;
  /** ค่าวันก่อน ๆ เก่าสุดก่อน (ไม่รวมวันนี้) — ใช้วาด sparkline + นับ streak */ history?: number[];
  /** ข้อความค่า (ถ้าไม่ใส่ใช้ตัวเลข) */ format?: (n: number) => string;
  /** คำอธิบายเป้า เช่น "เฉลี่ย 30 วัน" */ goalLabel?: string;
}
export interface OrbitGoalsProps {
  goals?: Goal[];
  title?: string;
  subtitle?: string;
  defaultTheme?: "light" | "dark" | "system";
  onChange?: (goals: Goal[]) => void;
  className?: string;
  readOnly?: boolean;
  hideThemeToggle?: boolean;
  /** "obsidian" = พื้นดำ glass ให้เข้าชุดกับ MetricGlassCards */
  variant?: "default" | "obsidian";
  labels?: { closed?: (n: number, total: number) => string; streak?: (d: number) => string; extra?: (pct: number) => string; reached?: (label: string) => string };
}

const CSS = `
.orb{--h0:#0092b8;--h1:#6a45e8;--h2:#c77a00}
.orb.dark,.dark .orb{--h0:#22e1ff;--h1:#a78bff;--h2:#ffb830}
`;
const G0: Goal[] = [
  { id: "move", label: "Move", unit: "min", goal: 45, value: 22, step: 5, hue: 0 },
  { id: "focus", label: "Deep focus", unit: "h", goal: 4, value: 2.5, step: 0.5, hue: 1 },
  { id: "learn", label: "Learn", unit: "pages", goal: 30, value: 12, step: 2, hue: 2 },
];
const SIZE = 320, C = SIZE / 2, SW = 24, RADII = [128, 98, 68];
const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const tok = (v: string) => `rgb(var(--${v}))`;

function Spark({ values, goal, color, grid }: { values: number[]; goal: number; color: string; grid: string }) {
  if (values.length < 2) return null;
  const w = 64, h = 20, max = Math.max(goal, ...values, 1) * 1.05;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  const goalY = h - (goal / max) * h;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0 overflow-visible">
      <line x1={0} y1={goalY} x2={w} y2={goalY} stroke={grid} strokeWidth={1} strokeDasharray="2 2" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - (values[values.length - 1] / max) * h} r={2.2} fill={color} />
    </svg>
  );
}

function streakOf(g: Goal) {
  const h = g.history ?? [];
  let s = 0;
  for (let i = h.length - 1; i >= 0; i--) { if (h[i] >= g.goal) s++; else break; }
  return s;
}

function Burst({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return <motion.circle key={i} cx={x} cy={y} r={2.5} fill={color} initial={{ opacity: 1, cx: x, cy: y }} animate={{ opacity: 0, cx: x + Math.cos(a) * 26, cy: y + Math.sin(a) * 26 }} transition={{ duration: 0.7, ease: "easeOut" }} />;
      })}
    </g>
  );
}

export function OrbitGoals({
  goals: gp = G0, title = "Today's goals", subtitle, defaultTheme = "system", onChange, className, readOnly = false, hideThemeToggle = false, labels, variant = "default",
}: OrbitGoalsProps) {
  const obs = variant === "obsidian";
  const pal = obs
    ? { track: "rgba(255,255,255,0.08)", tick: "rgba(255,255,255,0.14)", knob: "#0b0b0f", spark: "rgba(255,255,255,0.22)" }
    : { track: tok("muted"), tick: tok("border"), knob: tok("background"), spark: tok("border") };
  const reduce = useReducedMotion();
  const [theme, setTheme] = React.useState<"light" | "dark">(defaultTheme === "dark" ? "dark" : "light");
  React.useEffect(() => { if (defaultTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark"); }, [defaultTheme]);
  const [goals, setGoals] = React.useState(gp);
  React.useEffect(() => { setGoals(gp); }, [gp]); // ข้อมูลจริงอัปเดต → วาดใหม่
  const [active, setActive] = React.useState<string | null>(null);
  const [bursts, setBursts] = React.useState<{ id: string; k: number }[]>([]);
  const [live, setLive] = React.useState("");
  const svgRef = React.useRef<SVGSVGElement>(null);
  const ref = React.useRef(goals); ref.current = goals;
  const fmt = (g: Goal, n: number) => (g.format ? g.format(n) : fmtN(n));

  const setVal = React.useCallback((id: string, raw: number) => {
    if (readOnly) return;
    const g = ref.current.find((x) => x.id === id)!;
    const v = Math.max(0, Math.min(g.goal * 2, Math.round(raw / g.step) * g.step));
    if (v === g.value) return;
    if (g.value < g.goal && v >= g.goal) { setBursts((b) => [...b, { id, k: Date.now() }]); setTimeout(() => setBursts((b) => b.slice(1)), 800); setLive(labels?.reached?.(g.label) ?? `${g.label} goal reached`); }
    const next = ref.current.map((x) => (x.id === id ? { ...x, value: v } : x));
    setGoals(next); onChange?.(next);
  }, [onChange, readOnly, labels]);

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const svg = svgRef.current!, rect = svg.getBoundingClientRect(), k = SIZE / rect.width;
    const pt = (ev: { clientX: number; clientY: number }) => ({ x: (ev.clientX - rect.left) * k - C, y: (ev.clientY - rect.top) * k - C });
    const p = pt(e), r = Math.hypot(p.x, p.y);
    let idx = -1, best = 1e9;
    RADII.forEach((rr, i) => { const d = Math.abs(rr - r); if (d < best) { best = d; idx = i; } });
    if (best > SW * 0.8 || idx >= goals.length) return;
    const id = goals[idx].id;
    setActive(id);
    svg.setPointerCapture(e.pointerId);
    let prev = ref.current[idx].value / ref.current[idx].goal;
    const apply = (ev: { clientX: number; clientY: number }) => {
      const q = pt(ev);
      const th = ((Math.atan2(q.x, -q.y) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      const f = Math.max(0, Math.min(2, th + Math.round(prev - th)));
      prev = f; setVal(id, f * ref.current[idx].goal);
    };
    apply(e);
    const move = (m: PointerEvent) => apply(m);
    const up = () => { svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up); setActive(null); };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up);
  };

  const onKey = (e: React.KeyboardEvent, g: Goal) => {
    if (readOnly) return;
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (d) { e.preventDefault(); setVal(g.id, g.value + d * g.step); return; }
    if (e.key === "Home") { e.preventDefault(); setVal(g.id, 0); } else if (e.key === "End") { e.preventDefault(); setVal(g.id, g.goal); }
  };
  const total = goals.length ? goals.reduce((s, g) => s + Math.min(1, g.goal > 0 ? g.value / g.goal : 0), 0) / goals.length : 0;
  const closed = goals.filter((g) => g.goal > 0 && g.value >= g.goal).length;
  const bestStreak = Math.max(0, ...goals.map(streakOf));

  return (
    <div className={cn("orb relative w-full overflow-hidden p-5 sm:p-6 flex flex-col",
      obs ? "dark rounded-[2rem] bg-[#08080b] text-white antialiased" : "rounded-3xl border border-border bg-card text-foreground",
      !obs && theme === "dark" && !hideThemeToggle && "dark", className)}>
      <style>{CSS}</style>
      {obs ? <>
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.045) 1px,transparent 0)", backgroundSize: "28px 28px" }} />
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full blur-[110px] pointer-events-none" style={{ background: "rgba(167,139,255,.12)" }} />
        <div className="absolute -bottom-28 -left-20 w-80 h-80 rounded-full blur-[110px] pointer-events-none" style={{ background: "rgba(34,225,255,.08)" }} />
      </> : null}
      <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className={cn("font-semibold tracking-tight", obs ? "text-[15px] text-white/90" : "text-base")}>{title}</h2>
          {subtitle ? <p className={cn("mt-0.5 text-xs", obs ? "text-neutral-400" : "text-muted-foreground")}>{subtitle}</p> : null}
          {bestStreak >= 2 && <p className={cn("mt-0.5 text-xs", obs ? "text-neutral-400" : "text-muted-foreground")}>🔥 {labels?.streak?.(bestStreak) ?? `Best streak: ${bestStreak} days in a row`}</p>}
        </div>
        {!hideThemeToggle ? (
          <button aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="grid h-10 w-10 place-items-center rounded-full border border-border outline-none hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring">{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        ) : null}
      </div>
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 md:flex-row">
        <div className="relative shrink-0" style={{ width: 260, height: 260, maxWidth: "100%" }}>
          <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className={cn("h-full w-full select-none", !readOnly && "touch-none")} onPointerDown={down} role="group" aria-label={readOnly ? "Goal rings" : "Goal rings. Drag around a ring to set its value."}>
            {Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2; return <line key={i} x1={C + Math.sin(a) * 152} y1={C - Math.cos(a) * 152} x2={C + Math.sin(a) * (i % 5 ? 155 : 158)} y2={C - Math.cos(a) * (i % 5 ? 155 : 158)} stroke={pal.tick} strokeWidth={1.2} />; })}
            {goals.map((g, i) => {
              const r = RADII[i], circ = 2 * Math.PI * r, f = g.goal > 0 ? g.value / g.goal : 0, lap1 = Math.min(1, f), lap2 = Math.max(0, Math.min(1, f - 1));
              const a = lap1 * Math.PI * 2 + (lap2 > 0 ? lap2 * Math.PI * 2 : 0);
              const cx = C + Math.sin(a) * r, cy = C - Math.cos(a) * r;
              const col = `var(--h${g.hue})`;
              return (
                <g key={g.id} role={readOnly ? "img" : "slider"} tabIndex={readOnly ? -1 : 0} aria-label={`${g.label}`} aria-valuemin={readOnly ? undefined : 0} aria-valuemax={readOnly ? undefined : g.goal * 2} aria-valuenow={readOnly ? undefined : g.value} aria-valuetext={`${fmt(g, g.value)} / ${fmt(g, g.goal)} ${g.unit}`} onKeyDown={(e) => onKey(e, g)} className="outline-none">
                  <circle cx={C} cy={C} r={r} fill="none" stroke={pal.track} strokeWidth={SW} />
                  <motion.circle cx={C} cy={C} r={r} fill="none" stroke={col} strokeWidth={SW} strokeLinecap="round" strokeDasharray={circ} initial={false} animate={{ strokeDashoffset: circ * (1 - lap1) }} transition={reduce ? { duration: 0.1 } : { type: "spring", stiffness: 140, damping: 22 }} transform={`rotate(-90 ${C} ${C})`} style={{ filter: active === g.id || f >= 1 ? `drop-shadow(0 0 6px ${col})` : "none" }} />
                  {lap2 > 0 && <motion.circle cx={C} cy={C} r={r} fill="none" stroke={pal.knob} strokeOpacity={0.55} strokeWidth={SW * 0.38} strokeLinecap="round" strokeDasharray={circ} initial={false} animate={{ strokeDashoffset: circ * (1 - lap2) }} transition={{ type: "spring", stiffness: 140, damping: 22 }} transform={`rotate(-90 ${C} ${C})`} />}
                  {g.value > 0 && <motion.circle r={SW / 2 - 4} fill={pal.knob} stroke={col} strokeWidth={3} initial={false} animate={{ cx, cy, scale: active === g.id ? 1.25 : 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} />}
                  <AnimatePresence>{bursts.filter((b) => b.id === g.id).map((b) => <Burst key={b.k} x={C} y={C - r} color={col} />)}</AnimatePresence>
                  <title>{g.label}</title>
                </g>
              );
            })}
            <text x={C} y={C - 6} textAnchor="middle" className={cn("text-[38px] font-bold tabular-nums", obs ? "fill-white" : "fill-foreground")}>{Math.round(total * 100)}%</text>
            <text x={C} y={C + 16} textAnchor="middle" className={cn("text-[13px] font-medium", obs ? "fill-neutral-400" : "fill-muted-foreground")}>{labels?.closed?.(closed, goals.length) ?? `${closed} of ${goals.length} closed`}</text>
          </svg>
        </div>
        <ul className="m-0 w-full flex-1 space-y-2.5 p-0">
          {goals.map((g) => (
            <li key={g.id} className={cn("flex list-none items-center gap-3 rounded-2xl border p-3 transition-colors", obs ? "bg-white/[0.04] border-white/10" : cn("bg-surface", active === g.id ? "border-ring" : "border-border"))}>
              <span className="h-10 w-1.5 rounded-full shrink-0" style={{ background: `var(--h${g.hue})`, boxShadow: g.goal > 0 && g.value >= g.goal ? `0 0 10px var(--h${g.hue})` : "none" }} />
              <div className="flex-1 min-w-0">
                <p className={cn("text-[14px] font-semibold", obs && "text-white/90")}>{g.label}</p>
                <p className={cn("text-[13px] tabular-nums", obs ? "text-neutral-400" : "text-muted-foreground")}>
                  <AnimatePresence mode="popLayout" initial={false}><motion.span key={g.value} className={cn("inline-block font-bold", obs ? "text-white" : "text-foreground")} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.15 }}>{fmt(g, g.value)}</motion.span></AnimatePresence>
                  {" "}/ {fmt(g, g.goal)} {g.unit}{g.goalLabel ? <span className="opacity-70"> · {g.goalLabel}</span> : null}
                  {g.goal > 0 && g.value > g.goal && <span className="ml-2 rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">+{Math.round((g.value / g.goal - 1) * 100)}%{labels?.extra ? "" : " extra"}</span>}
                </p>
                {(g.history?.length ?? 0) > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <Spark values={[...(g.history ?? []), g.value]} goal={g.goal} color={`var(--h${g.hue})`} grid={pal.spark} />
                    {streakOf(g) >= 2 && <span className="rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">🔥 {labels?.streak?.(streakOf(g)) ?? `${streakOf(g)}d streak`}</span>}
                  </div>
                )}
              </div>
              {!readOnly ? (
                <>
                  <button aria-label={`Decrease ${g.label}`} onClick={() => setVal(g.id, g.value - g.step)} className="grid h-10 w-10 place-items-center rounded-full bg-surface2 outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring"><Minus size={16} /></button>
                  <button aria-label={`Increase ${g.label}`} onClick={() => setVal(g.id, g.value + g.step)} className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"><Plus size={16} /></button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{live}</div>
    </div>
  );
}
