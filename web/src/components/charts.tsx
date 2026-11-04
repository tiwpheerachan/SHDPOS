"use client";

// =====================================================================
// กราฟแบบ SVG เขียนเอง — ไม่พึ่ง library
// เหตุผล: ขนาดเล็ก, คุมสีให้เข้ากับ theme ได้ทั้งโหมดสว่าง/มืด,
// และไม่มีปัญหา peer dependency ตอน build
// =====================================================================

import React, { useId, useMemo, useState } from "react";
import { formatCompact, formatTHB, formatInt } from "@/lib/money";

/** จานสีสำหรับข้อมูลแบบหมวดหมู่ — โทน warm/accent อ่านออกทั้งโหมดสว่าง/มืด */
export const SERIES_COLORS = [
  "#FF725E", "#A898F5", "#3BB98C", "#F2B705", "#6D5DD3", "#EC6B9D", "#2AA7B8", "#E0894F",
];

/** อ้างสี accent จาก CSS variable (ปรับตามธีมอัตโนมัติ) */
export const cssColor = (name: string) => `rgb(var(--c-${name}))`;

// ---------------------------------------------------------------------
// Area / Line
// ---------------------------------------------------------------------
export interface SeriesPoint {
  label: string;
  value: number;
  compare?: number;
}

export function AreaChart({
  data,
  height = 220,
  valueFormat = (n: number) => formatCompact(n),
  color = SERIES_COLORS[0],
  compareColor = "#94a3b8",
}: {
  data: SeriesPoint[];
  height?: number;
  valueFormat?: (n: number) => string;
  color?: string;
  compareColor?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const { path, areaPath, comparePath, max, pts } = useMemo(() => {
    const w = 1000;
    const h = 300;
    const pad = { t: 12, r: 8, b: 8, l: 8 };
    const values = data.map((d) => d.value);
    const compares = data.map((d) => d.compare ?? 0);
    const max = Math.max(1, ...values, ...compares) * 1.12;
    const stepX = data.length > 1 ? (w - pad.l - pad.r) / (data.length - 1) : 0;
    const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);

    const pts = data.map((d, i) => ({ x: pad.l + i * stepX, y: y(d.value), d }));
    const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = pts.length
      ? `${path} L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`
      : "";
    const comparePath = data.some((d) => d.compare != null)
      ? data
          .map((d, i) => `${i === 0 ? "M" : "L"}${(pad.l + i * stepX).toFixed(1)},${y(d.compare ?? 0).toFixed(1)}`)
          .join(" ")
      : "";
    return { path, areaPath, comparePath, max, pts };
  }, [data]);

  if (!data.length) return <div className="h-[220px] grid place-items-center text-xs text-muted">ไม่มีข้อมูล</div>;

  return (
    <div className="relative">
      <svg viewBox="0 0 1000 300" preserveAspectRatio="none" style={{ height, width: "100%" }} role="img">
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="1000" y1={300 * f} y2={300 * f} stroke="rgb(var(--c-line))" strokeWidth="1" />
        ))}
        {comparePath ? (
          <path d={comparePath} fill="none" stroke={compareColor} strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        ) : null}
        <path d={areaPath} fill={`url(#g${gid})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover != null && pts[hover] ? (
          <g>
            <line x1={pts[hover].x} x2={pts[hover].x} y1="0" y2="300" stroke={color} strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={pts[hover].x} cy={pts[hover].y} r="9" fill={color} />
          </g>
        ) : null}
      </svg>
      <div className="absolute inset-0 flex">
        {data.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            className="flex-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </div>
      {hover != null ? (
        <div
          className="pointer-events-none absolute -top-1 bg-surface border border-line rounded-lg shadow-pop px-2.5 py-1.5 text-xs"
          style={{ left: `calc(${(hover / Math.max(data.length - 1, 1)) * 100}% - 48px)` }}
        >
          <div className="font-medium">{data[hover].label}</div>
          <div className="tnum text-brand">{valueFormat(data[hover].value)}</div>
          {data[hover].compare != null ? (
            <div className="tnum text-muted">{valueFormat(data[hover].compare!)}</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-between mt-1.5 text-[10px] text-muted">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Horizontal bars — ใช้กับ ranking (สาขา / พนักงาน / สินค้า)
// ---------------------------------------------------------------------
export function BarList({
  data,
  valueFormat = (n: number) => formatTHB(n),
  max: maxProp,
  colorFor,
}: {
  data: { label: string; value: number; sub?: string }[];
  valueFormat?: (n: number) => string;
  max?: number;
  colorFor?: (i: number) => string;
}) {
  const max = maxProp ?? Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="py-8 text-center text-xs text-muted">ไม่มีข้อมูล</div>;
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-xs font-medium truncate">{d.label}</span>
            <span className="text-xs tnum text-muted shrink-0">{valueFormat(d.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: colorFor ? colorFor(i) : SERIES_COLORS[i % SERIES_COLORS.length],
              }}
            />
          </div>
          {d.sub ? <p className="text-[10px] text-muted mt-0.5">{d.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Donut — สัดส่วนช่องทางชำระเงิน
// ---------------------------------------------------------------------
export function Donut({
  data,
  size = 168,
  thickness = 22,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth={thickness} />
          {data.map((d, i) => {
            const frac = total ? d.value / total : 0;
            const dash = frac * c;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </g>
        {centerValue ? (
          <>
            <text x="50%" y="47%" textAnchor="middle" className="fill-[rgb(var(--c-ink))]" style={{ fontSize: 18, fontWeight: 600 }}>
              {centerValue}
            </text>
            <text x="50%" y="60%" textAnchor="middle" className="fill-[rgb(var(--c-muted))]" style={{ fontSize: 10 }}>
              {centerLabel}
            </text>
          </>
        ) : null}
      </svg>
      <ul className="space-y-1.5 min-w-[140px]">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="flex-1 truncate">{d.label}</span>
            <span className="tnum text-muted">{total ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------
// Column chart — ยอดขายรายชั่วโมง
// ---------------------------------------------------------------------
export function Columns({
  data,
  height = 140,
  valueFormat = (n: number) => formatCompact(n),
}: {
  data: { label: string; value: number }[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 group">
          <span className="text-[9px] text-muted opacity-0 group-hover:opacity-100 tnum transition-opacity">
            {valueFormat(d.value)}
          </span>
          <div
            className="w-full rounded-t-md bg-brand/80 group-hover:bg-brand transition-colors min-h-[2px]"
            style={{ height: `${(d.value / max) * (height - 28)}px` }}
          />
          <span className="text-[9px] text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------
export function Sparkline({ values, color = SERIES_COLORS[0], height = 32, fill }: { values: number[]; color?: string; height?: number; fill?: boolean }) {
  const gid = useId().replace(/:/g, "");
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1 || 1)) * 100, 30 - ((v - min) / span) * 28] as const);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L100,32 L0,32 Z`;
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ height, width: "100%" }}>
      {fill ? (
        <>
          <defs>
            <linearGradient id={`sp${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#sp${gid})`} />
        </>
      ) : null}
      <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// =====================================================================
// HeroChart — แท่งโค้งมน + เส้นเรียบ + เส้นเป้า + tooltip
// ใช้กับการ์ด "Sales Monitoring" ตัวหลัก
// =====================================================================
export interface HeroPoint {
  label: string;
  value: number;      // ช่วงปัจจุบัน (แท่ง)
  line?: number;      // เส้น (เช่น ยอดสะสม / เทรนด์)
  compare?: number;   // ช่วงก่อนหน้า (แท่งจาง)
}

export function HeroChart({
  data,
  height = 300,
  target,
  valueFormat = (n: number) => formatTHB(n),
  accent = "#FF725E",
}: {
  data: HeroPoint[];
  height?: number;
  target?: number;
  valueFormat?: (n: number) => string;
  accent?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 340;
  const pad = { t: 24, r: 12, b: 28, l: 12 };

  const { bars, linePath, max, targetY } = useMemo(() => {
    const vals = data.map((d) => Math.max(d.value, d.compare ?? 0, d.line ?? 0));
    const max = Math.max(1, ...vals, target ?? 0) * 1.16;
    const iw = W - pad.l - pad.r;
    const n = data.length || 1;
    const slot = iw / n;
    const bw = Math.min(slot * 0.5, 46);
    const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const bars = data.map((d, i) => {
      const cx = pad.l + slot * i + slot / 2;
      return { cx, x: cx - bw / 2, w: bw, vY: y(d.value), cY: y(d.compare ?? 0), lY: d.line != null ? y(d.line) : null, d };
    });
    const linePts = bars.filter((b) => b.lY != null);
    const linePath = linePts.map((b, i) => `${i === 0 ? "M" : "L"}${b.cx.toFixed(1)},${(b.lY as number).toFixed(1)}`).join(" ");
    return { bars, linePath, max, targetY: target != null ? y(target) : null };
  }, [data, target]);

  if (!data.length) return <div className="grid place-items-center text-xs text-muted" style={{ height }}>ไม่มีข้อมูล</div>;
  const baseY = H - pad.b;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height, width: "100%" }} role="img">
        <defs>
          <linearGradient id={`bar${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="1" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.72" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)}
            stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray={f === 1 ? "0" : "2 6"} />
        ))}
        {targetY != null ? (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={targetY} y2={targetY} stroke="rgb(var(--c-ink))" strokeWidth="1.5" strokeDasharray="7 6" opacity="0.5" />
          </g>
        ) : null}
        {bars.map((b, i) => (
          <g key={i}>
            {b.d.compare != null ? (
              <rect x={b.x + b.w * 0.22} y={b.cY} width={b.w * 0.56} height={Math.max(0, baseY - b.cY)}
                rx="5" fill="rgb(var(--c-surface-2))" />
            ) : null}
            <rect x={b.x} y={b.vY} width={b.w} height={Math.max(0, baseY - b.vY)} rx="7"
              fill={`url(#bar${gid})`} opacity={hover == null || hover === i ? 1 : 0.4}
              style={{ transition: "opacity .2s" }} />
          </g>
        ))}
        {linePath ? (
          <path d={linePath} fill="none" stroke="rgb(var(--c-ink))" strokeWidth="2.5" vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        ) : null}
        {hover != null && bars[hover] ? (
          <circle cx={bars[hover].cx} cy={bars[hover].vY} r="6" fill={accent} stroke="rgb(var(--c-surface))" strokeWidth="2.5" />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex" style={{ paddingLeft: `${(pad.l / W) * 100}%`, paddingRight: `${(pad.r / W) * 100}%` }}>
        {data.map((d, i) => (
          <div key={`${d.label}-${i}`} className="flex-1" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </div>
      {hover != null ? (
        <div className="pointer-events-none absolute top-1 bg-brand text-brandInk rounded-xl shadow-pop px-3 py-2 text-xs z-10"
          style={{ left: `min(max(0px, ${(hover / Math.max(data.length, 1)) * 100}% - 40px), calc(100% - 130px))` }}>
          <div className="font-semibold opacity-70 text-[10px] uppercase tracking-wide">{data[hover].label}</div>
          <div className="tnum text-sm font-semibold mt-0.5">{valueFormat(data[hover].value)}</div>
          {data[hover].compare != null ? (
            <div className="tnum text-[10px] opacity-60 mt-0.5">เทียบก่อนหน้า {valueFormat(data[hover].compare!)}</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-between mt-2 text-[10px] text-muted tnum px-1">
        {data.map((d, i) =>
          data.length <= 14 || i % Math.ceil(data.length / 12) === 0 ? <span key={i}>{d.label}</span> : null
        )}
      </div>
    </div>
  );
}

// =====================================================================
// StackBar — แท่งแนวนอนแบบแบ่งสัดส่วน (inventory health / payment)
// =====================================================================
export function StackBar({
  segments,
  height = 14,
  valueFormat = (n: number) => formatInt(n),
}: {
  segments: { label: string; value: number; color: string }[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div className="flex w-full rounded-full overflow-hidden gap-0.5" style={{ height }}>
        {segments.map((s, i) => (
          <div key={i} className="h-full first:rounded-l-full last:rounded-r-full transition-all"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: s.value ? 3 : 0 }} title={`${s.label}: ${valueFormat(s.value)}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color }} />
            <span className="flex-1 truncate text-muted">{s.label}</span>
            <span className="tnum font-medium">{valueFormat(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =====================================================================
// RadialGauge — วงแหวนความคืบหน้าเป้าหมาย
// =====================================================================
export function RadialGauge({
  value, // 0..100
  size = 150,
  thickness = 14,
  color = "#FF725E",
  label,
  sub,
}: {
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
  sub?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth={thickness} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
            strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray .6s ease-out" }} />
        </g>
      </svg>
      <div className="absolute text-center">
        <div className="text-[26px] font-semibold tnum leading-none">{pct.toFixed(0)}%</div>
        {label ? <div className="text-[10px] text-muted mt-1">{label}</div> : null}
        {sub ? <div className="text-[10px] text-muted">{sub}</div> : null}
      </div>
    </div>
  );
}

// =====================================================================
// Heatmap — 7 วัน × ช่วงเวลา (ความเข้ม = ยอดขาย)
// =====================================================================
export function Heatmap({
  rows,           // label แถว (ชั่วโมง)
  cols,           // label คอลัมน์ (วัน)
  values,         // values[row][col]
  color = "#FF725E",
  valueFormat = (n: number) => formatCompact(n),
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  color?: string;
  valueFormat?: (n: number) => string;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const max = Math.max(1, ...values.flat());
  return (
    <div className="relative">
      <div className="flex gap-1">
        <div className="flex flex-col justify-between py-[2px] pr-1 text-[9px] text-muted tnum">
          {rows.map((r, i) => (i % 2 === 0 ? <span key={i} className="h-[18px] leading-[18px]">{r}</span> : <span key={i} className="h-[18px]" />))}
        </div>
        <div className="flex-1">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
            {values.map((row, ri) =>
              row.map((v, ci) => {
                const intensity = v / max;
                return (
                  <div key={`${ri}-${ci}`}
                    onMouseEnter={() => setHover({ r: ri, c: ci })} onMouseLeave={() => setHover(null)}
                    className="rounded-[4px] h-[18px] cursor-pointer transition-transform hover:scale-110"
                    style={{ background: v ? color : "rgb(var(--c-surface-2))", opacity: v ? 0.18 + intensity * 0.82 : 1 }} />
                );
              })
            )}
          </div>
          <div className="grid gap-1 mt-1 text-[9px] text-muted text-center" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
            {cols.map((c, i) => <span key={i}>{c}</span>)}
          </div>
        </div>
      </div>
      {hover ? (
        <div className="mt-2 text-[11px] text-muted tnum">
          {cols[hover.c]} · {rows[hover.r]} — <span className="text-ink font-medium">{valueFormat(values[hover.r][hover.c])}</span>
        </div>
      ) : null}
    </div>
  );
}
