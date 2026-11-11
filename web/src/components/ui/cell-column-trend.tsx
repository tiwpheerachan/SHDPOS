"use client"
import { useEffect, useMemo, useRef, useState } from "react"

/**
 * Cell Column Trend — ตารางเซลล์แสดงแนวโน้ม (ดัดแปลงให้เข้าธีม SHD POS + dark mode)
 * KPI tiles ด้านล่าง = แท็บเลือกเมตริก, hover คอลัมน์ขึ้น tooltip
 * สีทั้งหมดอิงโทเคน --c-* (brand/ink/surface) จึงตามธีมอัตโนมัติ
 */

export type TrendMetric = {
  key: string
  label: string
  values: number[]
  summary: string
  delta: number
  higherIsBetter?: boolean
  format?: (n: number) => string
}

export interface CellColumnTrendProps {
  metrics: TrendMetric[]
  labels: string[]
  ticks?: string[]
  title?: string
  caption?: string
  rows?: number
  accent?: string
  className?: string
}

// #region scale
export function niceMax(max: number) {
  if (!(max > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p
  return 10 * p
}
export function fill(values: number[], top: number, rows: number) {
  return values.map((v) => (v <= 0 ? 0 : Math.min(rows, Math.max(1, Math.round((v / top) * rows)))))
}
export function better(delta: number, higherIsBetter = true) {
  return delta === 0 ? "flat" : delta > 0 === higherIsBetter ? "good" : "bad"
}
// #endregion

const SPRING =
  "linear(0,0.009,0.035 2.1%,0.141,0.281 6.7%,0.723 12.9%,0.938 16.7%,1.017,1.077,1.121,1.149 24.3%,1.159,1.163,1.161,1.154 29.9%,1.129 32.8%,1.051 39.6%,1.017 43.1%,0.991,0.977 51%,0.974 53.8%,0.975 57.1%,0.997 69.8%,1.003 76.9%,1)"
const MONO = "ui-monospace,'SF Mono','JetBrains Mono',monospace"
const INK = (a?: string) => (a ? `rgb(var(--cct-ink) / ${a})` : "rgb(var(--cct-ink))")
const PAPER = "rgb(var(--cct-paper))"

const CSS = [
  ".cct-root{--cct-accent:rgb(var(--c-brand));--cct-ink:var(--c-ink);--cct-paper:var(--c-surface);position:relative;width:100%;border-radius:22px;color:" + INK() + ";overflow:hidden;",
  "font-family:var(--font-sans),ui-sans-serif,system-ui,sans-serif;background:" + PAPER + ";",
  "background-image:linear-gradient(180deg,rgb(var(--c-surface) / .9),rgb(var(--c-surface) / 0) 40%),radial-gradient(120% 80% at 100% 0%,color-mix(in oklab,var(--cct-accent) 9%,transparent),transparent 60%);",
  "box-shadow:0 0 0 1px " + INK(".08") + ",0 2px 4px " + INK(".04") + ",0 24px 60px -28px " + INK(".28") + "}",
  ".cct-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:22px 24px 0}",
  ".cct-title{font-size:17px;font-weight:650;letter-spacing:-.02em;display:flex;align-items:center;gap:8px}",
  ".cct-cap{font-size:12.5px;color:" + INK(".52") + ";margin-top:3px}",
  ".cct-badge{font:600 11px/1 " + MONO + ";padding:6px 9px;border-radius:8px;background:" + INK(".05") + ";color:" + INK(".6") + ";white-space:nowrap}",
  ".cct-chart{display:grid;grid-template-columns:44px minmax(0,1fr);gap:0 10px;padding:22px 24px 8px}",
  ".cct-y{position:relative;height:var(--h)}",
  ".cct-y>span{position:absolute;right:0;transform:translateY(-50%);font:500 11px/1 " + MONO + ";color:" + INK(".42") + ";animation:cct-tick .6s " + SPRING + " both}",
  ".cct-plot{position:relative;height:var(--h);display:flex;gap:3px;outline:none;border-radius:6px}",
  ".cct-plot:focus-visible{box-shadow:0 0 0 2px var(--cct-accent);outline-offset:4px}",
  ".cct-grid{position:absolute;left:0;right:0;height:1px;background:repeating-linear-gradient(90deg," + INK(".12") + " 0 3px,transparent 3px 7px);pointer-events:none}",
  ".cct-col{position:relative;flex:1;display:flex;flex-direction:column-reverse;gap:3px;cursor:crosshair;transition:opacity .25s}",
  ".cct-cell{flex:1;border-radius:3px;background:" + INK(".055") + ";transform-origin:50% 100%;",
  "animation:var(--flip) .55s " + SPRING + " both;animation-delay:calc(var(--c)*11ms + var(--r)*16ms);transition:background .25s}",
  ".cct-on{background:color-mix(in oklab,var(--cct-accent) 82%," + PAPER + ")}",
  ".cct-cap1{background:color-mix(in oklab,var(--cct-accent) 45%," + PAPER + ")}",
  ".cct-hot .cct-col{opacity:.38}",
  ".cct-hot .cct-col.cct-act{opacity:1}",
  ".cct-act .cct-on{background:var(--cct-accent)}",
  ".cct-act .cct-cell:not(.cct-on){background:color-mix(in oklab,var(--cct-accent) 10%,transparent)}",
  ".cct-line{position:absolute;top:-6px;bottom:-6px;width:0;border-left:1px dashed " + INK(".55") + ";pointer-events:none;opacity:0;transition:left .4s " + SPRING + ",opacity .2s}",
  ".cct-tip{position:absolute;z-index:2;pointer-events:none;opacity:0;transform:translate(14px,-50%) scale(.92);transform-origin:0 50%;",
  "transition:left .4s " + SPRING + ",top .4s " + SPRING + ",opacity .2s,transform .35s " + SPRING + ";",
  "background:" + PAPER + ";border-radius:12px;padding:8px 12px;white-space:nowrap;box-shadow:0 0 0 1px " + INK(".08") + ",0 12px 28px -10px " + INK(".35") + "}",
  ".cct-flipx{transform:translate(calc(-100% - 14px),-50%) scale(.92);transform-origin:100% 50%}",
  ".cct-hot .cct-tip{opacity:1;transform:translate(14px,-50%) scale(1)}",
  ".cct-hot .cct-tip.cct-flipx{transform:translate(calc(-100% - 14px),-50%) scale(1)}",
  ".cct-hot .cct-line{opacity:1}",
  ".cct-tip-d{font-size:11px;color:" + INK(".5") + "}",
  ".cct-tip-v{font:650 15px/1.1 " + MONO + ";margin-top:3px;display:flex;align-items:center;gap:6px}",
  ".cct-tip-v i{width:8px;height:8px;border-radius:2px;background:var(--cct-accent)}",
  ".cct-x{position:relative;height:28px;grid-column:2}",
  ".cct-x>span{position:absolute;top:8px;transform:translateX(-50%);font-size:11px;color:" + INK(".42") + "}",
  ".cct-x>.cct-pin{position:absolute;top:4px;transform:translateX(-50%) scale(.8);opacity:0;font:600 10.5px/1 " + MONO + ";color:rgb(var(--c-bg));background:" + INK() + ";padding:5px 8px;border-radius:999px;",
  "transition:left .4s " + SPRING + ",opacity .2s,transform .3s " + SPRING + ";z-index:1;white-space:nowrap}",
  ".cct-hot .cct-x>.cct-pin{opacity:1;transform:translateX(-50%) scale(1)}",
  ".cct-tabs{position:relative;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));border-top:1px solid " + INK(".08") + "}",
  ".cct-ind{position:absolute;top:-1px;left:0;height:2px;width:calc(100% / var(--n));background:" + INK() + ";transform:translateX(calc(var(--k)*100%));transition:transform .5s " + SPRING + "}",
  ".cct-tab{appearance:none;border:0;background:transparent;text-align:left;cursor:pointer;padding:16px 20px 18px;font:inherit;color:inherit;position:relative;transition:background .2s}",
  ".cct-tab+.cct-tab{box-shadow:-1px 0 0 " + INK(".08") + "}",
  ".cct-tab:hover{background:" + INK(".025") + "}",
  ".cct-tab:focus-visible{outline:2px solid var(--cct-accent);outline-offset:-2px}",
  ".cct-tl{display:flex;align-items:center;gap:8px;font-size:12px;color:" + INK(".55") + ";font-weight:500}",
  ".cct-ic{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:" + INK(".06") + ";color:" + INK(".6") + ";transition:background .3s,color .3s}",
  ".cct-tab[aria-selected=true] .cct-ic{background:" + INK() + ";color:rgb(var(--c-bg))}",
  ".cct-tv{font:600 26px/1 " + MONO + ";letter-spacing:-.04em;margin-top:12px;color:" + INK(".4") + ";transition:color .3s}",
  ".cct-tab[aria-selected=true] .cct-tv{color:" + INK() + "}",
  ".cct-td{font-size:11.5px;margin-top:8px;color:" + INK(".45") + ";font-variant-numeric:tabular-nums}",
  ".cct-good{color:rgb(var(--c-ok));font-weight:600}",
  ".cct-bad{color:rgb(var(--c-danger));font-weight:600}",
  ".cct-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
  "@keyframes cct-a{0%{transform:scaleY(.15) rotateX(80deg);opacity:0}100%{transform:none;opacity:1}}",
  "@keyframes cct-b{0%{transform:scaleY(.15) rotateX(80deg);opacity:0}100%{transform:none;opacity:1}}",
  "@keyframes cct-tick{0%{transform:translateY(0);opacity:0}100%{transform:translateY(-50%);opacity:1}}",
  "@media (max-width:640px){.cct-head,.cct-chart{padding-left:16px;padding-right:16px}.cct-chart{grid-template-columns:34px minmax(0,1fr);gap:0 6px}.cct-plot,.cct-col{gap:2px}.cct-cell{border-radius:2px}",
  ".cct-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.cct-ind{display:none}.cct-tab{padding:14px 16px}.cct-tab[aria-selected=true]{box-shadow:inset 0 2px 0 " + INK() + "}.cct-tab:nth-child(n+4){border-top:1px solid " + INK(".08") + "}.cct-tv{font-size:21px}.cct-badge{display:none}}",
  "@media (prefers-reduced-motion:reduce){.cct-root *{animation:none!important;transition:none!important}}",
].join("")

function Icon({ i }: { i: number }) {
  const d = ["M4 18l5-6 4 3 7-9", "M12 8v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M4 7h16M4 12h10M4 17h6"][i % 4]
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export default function CellColumnTrend({
  metrics,
  labels,
  ticks,
  title = "Performance",
  caption = "",
  rows = 12,
  accent,
  className = "",
}: CellColumnTrendProps) {
  const root = useRef(null as HTMLDivElement | null)
  const [seen, setSeen] = useState(false)
  const [k, setK] = useState(0)
  const [active, setActive] = useState(-1)
  const m = metrics[Math.min(k, metrics.length - 1)]
  const n = m ? m.values.length : 0
  const fmt = m?.format || ((v: number) => Math.round(v).toLocaleString("en-US"))
  const top = useMemo(() => niceMax(Math.max(0, ...(m ? m.values : [0]))), [m])
  const lv = useMemo(() => (m ? fill(m.values, top, rows) : []), [m, top, rows])
  const xs = ticks || []

  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!m) return null
  const pct = ((Math.max(active, 0) + 0.5) / n) * 100
  const tipTop = (1 - (active >= 0 ? lv[active] : 0) / rows) * 100

  const onPlotKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return e.key === "Escape" && setActive(-1)
    e.preventDefault()
    const step = e.key === "ArrowRight" ? 1 : -1
    setActive((i) => Math.min(n - 1, Math.max(0, i < 0 ? (step > 0 ? 0 : n - 1) : i + step)))
  }
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    e.preventDefault()
    setK((x) => (x + (e.key === "ArrowRight" ? 1 : metrics.length - 1)) % metrics.length)
  }

  return (
    <div
      ref={root}
      className={"cct-root " + (active >= 0 ? "cct-hot " : "") + className}
      style={{ ...(accent ? { ["--cct-accent" as string]: accent } : {}), ["--h" as string]: "clamp(170px,26vw,236px)" }}
    >
      <style>{CSS}</style>
      <div className="cct-head">
        <div>
          <div className="cct-title">{title}</div>
          {caption ? <div className="cct-cap">{caption}</div> : null}
        </div>
        <span className="cct-badge">{m.label}</span>
      </div>

      <div className="cct-chart">
        <div className="cct-y" aria-hidden="true">
          {[1, 0.75, 0.5, 0.25].map((f) => (
            <span key={m.key + f} style={{ top: (1 - f) * 100 + "%" }}>
              {fmt(top * f)}
            </span>
          ))}
        </div>
        <div
          className="cct-plot"
          tabIndex={0}
          role="img"
          aria-label={m.label + ", " + labels.map((l, i) => l + " " + fmt(m.values[i])).join(", ")}
          onKeyDown={onPlotKey}
          onPointerLeave={() => setActive(-1)}
          onBlur={() => setActive(-1)}
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} className="cct-grid" style={{ top: (1 - f) * 100 + "%" }} aria-hidden="true" />
          ))}
          {seen &&
            lv.map((level, c) => (
              <div key={c} className={"cct-col" + (c === active ? " cct-act" : "")} onPointerEnter={() => setActive(c)} onPointerDown={() => setActive(c)}>
                {Array.from({ length: rows }, (_, r) => (
                  <span
                    key={r}
                    className={"cct-cell" + (r < level ? " cct-on" : "") + (r === level - 1 && level < rows ? " cct-cap1" : "")}
                    style={{ ["--c" as string]: c, ["--r" as string]: r, ["--flip" as string]: k % 2 ? "cct-b" : "cct-a" }}
                  />
                ))}
              </div>
            ))}
          <span className="cct-line" style={{ left: pct + "%" }} aria-hidden="true" />
          <div className={"cct-tip" + (pct > 66 ? " cct-flipx" : "")} style={{ left: pct + "%", top: "clamp(26px," + tipTop + "%,calc(100% - 26px))" }} aria-live="polite">
            <div className="cct-tip-d">{active >= 0 ? labels[active] : ""}</div>
            <div className="cct-tip-v">
              <i aria-hidden="true" />
              {active >= 0 ? fmt(m.values[active]) : ""}
            </div>
          </div>
        </div>
        <div className="cct-x" aria-hidden="true">
          {xs.map((t, i) => (
            <span key={t + i} style={{ left: ((i + 0.5) / xs.length) * 100 + "%" }}>
              {t}
            </span>
          ))}
          <span className="cct-pin" style={{ left: pct + "%" }}>
            {active >= 0 ? labels[active] : ""}
          </span>
        </div>
      </div>

      <div className="cct-tabs" role="tablist" aria-label="Metric" onKeyDown={onTabKey} style={{ ["--n" as string]: metrics.length, ["--k" as string]: k }}>
        <span className="cct-ind" aria-hidden="true" />
        {metrics.map((x, i) => {
          const tone = better(x.delta, x.higherIsBetter !== false)
          return (
            <button key={x.key} type="button" role="tab" aria-selected={i === k} tabIndex={i === k ? 0 : -1} className="cct-tab" onClick={() => setK(i)}>
              <span className="cct-tl">
                <span className="cct-ic">
                  <Icon i={i} />
                </span>
                {x.label}
              </span>
              <span className="cct-tv" style={{ display: "block" }}>
                {x.summary}
              </span>
              <span className="cct-td" style={{ display: "block" }}>
                <span className={tone === "good" ? "cct-good" : tone === "bad" ? "cct-bad" : ""}>{(x.delta > 0 ? "+" : x.delta < 0 ? "−" : "") + Math.abs(x.delta).toFixed(1) + "%"}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
