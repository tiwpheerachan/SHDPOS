"use client";
// =====================================================================
// AI Studio — แสดงการ์ด 1 ใบจากผลคำนวณจริง: KPI (เทียบช่วงก่อน) · เส้น/พื้นที่ · แท่ง/แท่งนอน/ซ้อน · วงกลม · ตาราง · แผนที่ความร้อน · กระจาย
// =====================================================================
import { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { runQuery } from "@/lib/ai/studio/query";
import type { Dataset, QueryResult, ResultColumn, StudioWidget } from "@/lib/ai/studio/types";

const COLORS = ["rgb(var(--chart-1))", "rgb(var(--chart-2))", "rgb(var(--chart-3))", "rgb(var(--chart-4))", "rgb(var(--chart-5))", "#8F959E", "#14C0C6", "#E43B95"];
const nf = (n: number, d = 0) => n.toLocaleString("th-TH", { maximumFractionDigits: d, minimumFractionDigits: 0 });
export function fmtVal(v: unknown, unit?: ResultColumn["unit"], compact = false): string {
  const n = Number(v);
  if (v == null || v === "" || Number.isNaN(n)) return "—";
  if (unit === "pct") return `${nf(n, 1)}%`;
  if (unit === "days") return `${nf(n, 1)} วัน`;
  if (compact && Math.abs(n) >= 1_000_000) return `${nf(n / 1_000_000, 2)}M`;
  if (compact && Math.abs(n) >= 10_000) return `${nf(n / 1000, 1)}K`;
  if (unit === "thb") return `฿${nf(n, Math.abs(n) < 100 ? 2 : 0)}`;
  return nf(n, Number.isInteger(n) ? 0 : 2);
}
const tick = { fontSize: 11, fill: "rgb(var(--c-muted))" };
const short = (s: unknown, n = 14) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const label = (v: unknown) => { const s = String(v ?? ""); return /^\d-[^\d]/.test(s) ? s.slice(2) : s; }; // "0-อา" → "อา"

export function useWidgetData(w: StudioWidget, ds: Dataset | undefined) {
  return useMemo(() => {
    if (!ds) return { error: `ไม่มีชุดข้อมูล ${w.query.dataset}` } as const;
    try {
      const cur = runQuery(ds, w.query);
      const prev = w.viz === "kpi" && w.compare && ds.prevRange ? runQuery(ds, { ...w.query, period: "previous" }) : null;
      return { cur, prev } as const;
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } as const; }
  }, [w, ds]);
}

export function WidgetView({ w, ds }: { w: StudioWidget; ds: Dataset | undefined }) {
  const data = useWidgetData(w, ds);
  if ("error" in data) return <p className="text-xs text-danger flex items-start gap-1.5 py-6"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{data.error}</p>;
  const { cur, prev } = data;
  if (!cur.matched && w.viz !== "kpi") return <p className="text-xs text-muted text-center py-10">ไม่มีข้อมูลตามเงื่อนไข</p>;
  return <Body w={w} r={cur} prev={prev} />;
}

function Body({ w, r, prev }: { w: StudioWidget; r: QueryResult; prev: QueryResult | null }) {
  const col = (k?: string) => r.columns.find((c) => c.key === k);
  const x = w.x ?? r.columns.find((c) => c.kind === "dim")?.key;
  const ys = (w.y?.length ? w.y : r.columns.filter((c) => c.kind === "measure").map((c) => c.key)).filter((k) => col(k));
  const y0 = ys[0];
  const rows: Record<string, unknown>[] = r.rows.map((row) => ({ ...row, __x: label(x ? row[x] : "") }));
  const yFmt = (k: string) => (v: unknown) => fmtVal(v, col(k)?.unit, true);
  const tip = { contentStyle: { borderRadius: 12, border: "1px solid rgb(var(--c-line))", background: "rgb(var(--c-surface))", fontSize: 12 }, formatter: (v: unknown, n: unknown) => [fmtVal(v, r.columns.find((c) => c.key === n || c.label === n)?.unit), String(n)] as [string, string] };

  switch (w.viz) {
    case "kpi": {
      const v = Number(r.rows[0]?.[y0] ?? 0), p = prev ? Number(prev.rows[0]?.[y0] ?? 0) : null;
      const d = p ? ((v - p) / Math.abs(p)) * 100 : null;
      return (
        <div className="py-1">
          <p className="text-[26px] font-semibold tnum leading-tight">{fmtVal(v, col(y0)?.unit)}</p>
          {d != null && Number.isFinite(d) ? (
            <p className={`text-xs mt-1 inline-flex items-center gap-1 ${d > 0.5 ? "text-ok" : d < -0.5 ? "text-danger" : "text-muted"}`}>
              {d > 0.5 ? <TrendingUp size={13} /> : d < -0.5 ? <TrendingDown size={13} /> : <Minus size={13} />}{d > 0 ? "+" : ""}{nf(d, 1)}% <span className="text-muted">เทียบช่วงก่อน ({fmtVal(p, col(y0)?.unit, true)})</span>
            </p>
          ) : null}
        </div>
      );
    }
    case "line":
    case "area": {
      const Chart = w.viz === "line" ? LineChart : AreaChart;
      return (
        <ResponsiveContainer width="100%" height={240}>
          <Chart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" vertical={false} />
            <XAxis dataKey="__x" tick={tick} tickLine={false} axisLine={false} minTickGap={18} tickFormatter={(v) => short(v, 10)} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={52} tickFormatter={yFmt(y0)} />
            <Tooltip {...tip} />
            {ys.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
            {ys.map((k, i) => w.viz === "line"
              ? <Line key={k} type="monotone" dataKey={k} name={col(k)?.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              : <Area key={k} type="monotone" dataKey={k} name={col(k)?.label} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} strokeWidth={2} />)}
          </Chart>
        </ResponsiveContainer>
      );
    }
    case "bar":
    case "hbar": {
      const h = w.viz === "hbar";
      return (
        <ResponsiveContainer width="100%" height={h ? Math.max(200, rows.length * 28 + 30) : 240}>
          <BarChart data={rows} layout={h ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: h ? 4 : 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" horizontal={!h} vertical={h} />
            {h ? <><XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={yFmt(y0)} /><YAxis type="category" dataKey="__x" tick={tick} tickLine={false} axisLine={false} width={120} tickFormatter={(v) => short(v, 18)} /></>
              : <><XAxis dataKey="__x" tick={tick} tickLine={false} axisLine={false} interval={0} tickFormatter={(v) => short(v, 8)} /><YAxis tick={tick} tickLine={false} axisLine={false} width={52} tickFormatter={yFmt(y0)} /></>}
            <Tooltip {...tip} cursor={{ fill: "rgb(var(--c-ink) / 0.04)" }} />
            {ys.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
            {ys.map((k, i) => <Bar key={k} dataKey={k} name={col(k)?.label} fill={COLORS[i % COLORS.length]} radius={h ? [0, 6, 6, 0] : [6, 6, 0, 0]} maxBarSize={36} />)}
          </BarChart>
        </ResponsiveContainer>
      );
    }
    case "stacked_bar": {
      const s = w.series ?? r.columns.filter((c) => c.kind === "dim")[1]?.key;
      const xs = [...new Set(r.rows.map((row) => label(row[x!])))], ss = [...new Set(r.rows.map((row) => String(row[s!] ?? "")))].slice(0, 8);
      const pivot = xs.map((xv) => ({ __x: xv, ...Object.fromEntries(ss.map((sv) => [sv, r.rows.filter((row) => label(row[x!]) === xv && String(row[s!]) === sv).reduce((a, row) => a + Number(row[y0] ?? 0), 0)])) }));
      return (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={pivot} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" vertical={false} />
            <XAxis dataKey="__x" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => short(v, 9)} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={52} tickFormatter={yFmt(y0)} />
            <Tooltip {...tip} formatter={(v: unknown, n: unknown) => [fmtVal(v, col(y0)?.unit), String(n)] as [string, string]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {ss.map((sv, i) => <Bar key={sv} dataKey={sv} stackId="a" fill={COLORS[i % COLORS.length]} maxBarSize={40} />)}
          </BarChart>
        </ResponsiveContainer>
      );
    }
    case "donut": {
      const total = rows.reduce((a, row) => a + Math.max(0, Number(row[y0] ?? 0)), 0) || 1;
      return (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="45%" height={200}>
            <PieChart><Pie data={rows} dataKey={y0} nameKey="__x" innerRadius="58%" outerRadius="90%" paddingAngle={1} stroke="none">
              {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip {...tip} /></PieChart>
          </ResponsiveContainer>
          <ul className="flex-1 min-w-0 space-y-1.5 text-xs">
            {rows.map((row, i) => (
              <li key={i} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="truncate flex-1" title={String(row.__x)}>{String(row.__x)}</span><span className="tnum text-muted">{nf((Math.max(0, Number(row[y0] ?? 0)) / total) * 100, 0)}%</span></li>
            ))}
          </ul>
        </div>
      );
    }
    case "heatmap": {
      const s = w.series ?? r.columns.filter((c) => c.kind === "dim")[1]?.key;
      const xs = [...new Set(r.rows.map((row) => String(row[x!])))].sort(), ss = [...new Set(r.rows.map((row) => String(row[s!])))].sort();
      const val = (a: string, b: string) => Number(r.rows.find((row) => String(row[x!]) === a && String(row[s!]) === b)?.[y0] ?? 0);
      const max = Math.max(1, ...r.rows.map((row) => Number(row[y0] ?? 0)));
      return (
        <div className="overflow-x-auto">
          <table className="text-[10.5px] border-separate border-spacing-[3px]">
            <thead><tr><th /> {ss.map((b) => <th key={b} className="font-medium text-muted px-0.5">{label(b)}</th>)}</tr></thead>
            <tbody>{xs.map((a) => (
              <tr key={a}><td className="text-muted pr-1 whitespace-nowrap">{label(a)}</td>
                {ss.map((b) => { const v = val(a, b); return <td key={b} title={`${label(a)} × ${label(b)}: ${fmtVal(v, col(y0)?.unit)}`} className="w-7 h-6 rounded" style={{ background: `rgb(var(--chart-1) / ${v ? 0.08 + (v / max) * 0.85 : 0.03})` }} />; })}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    }
    case "scatter": {
      const [a, b] = ys;
      return (
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" />
            <XAxis type="number" dataKey={a} name={col(a)?.label} tick={tick} tickFormatter={yFmt(a)} />
            <YAxis type="number" dataKey={b} name={col(b)?.label} tick={tick} width={52} tickFormatter={yFmt(b)} />
            <ZAxis range={[60, 60]} />
            <Tooltip {...tip} cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => { const p = payload?.[0]?.payload as Record<string, unknown> | undefined; return p ? <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop"><b>{String(p.__x)}</b><br />{col(a)?.label}: {fmtVal(p[a], col(a)?.unit)}<br />{col(b)?.label}: {fmtVal(p[b], col(b)?.unit)}</div> : null; }} />
            <Scatter data={rows} fill={COLORS[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }
    default: // table
      return (
        <div className="overflow-auto max-h-[340px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface"><tr className="border-b border-line">{r.columns.map((c) => <th key={c.key} className={`py-1.5 px-2 font-medium text-muted whitespace-nowrap ${c.kind === "measure" ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr></thead>
            <tbody>{r.rows.map((row, i) => (
              <tr key={i} className="border-b border-line/50">{r.columns.map((c) => <td key={c.key} className={`py-1.5 px-2 ${c.kind === "measure" ? "text-right tnum" : "max-w-[240px] truncate"}`} title={String(row[c.key] ?? "")}>{c.kind === "measure" ? fmtVal(row[c.key], c.unit) : label(row[c.key]) || "—"}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
  }
}
