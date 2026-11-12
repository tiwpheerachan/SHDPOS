"use client";

// กราฟ recharts ธีม SHD (ใช้ชั้น shadcn chart primitive + โทเคน --chart-*)
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

/** แท่งคู่ เทียบช่วงปัจจุบัน vs ช่วงก่อน (smart comparison) */
export function CompareBars({ data, labels, valueFormat, onBarClick, className = "h-[240px] w-full" }: {
  data: { label: string; cur: number; prev: number }[];
  labels: { cur: string; prev: string };
  valueFormat?: (n: number) => string;
  onBarClick?: (i: number) => void;
  className?: string;
}) {
  const config: ChartConfig = { cur: { label: labels.cur, color: "rgb(var(--chart-1))" }, prev: { label: labels.prev, color: "rgb(var(--chart-1) / 0.3)" } };
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={valueFormat} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="prev" fill="var(--color-prev)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="cur" fill="var(--color-cur)" radius={[4, 4, 0, 0]} onClick={onBarClick ? (_: unknown, i: number) => onBarClick(i) : undefined} style={onBarClick ? { cursor: "pointer" } : undefined} />
      </BarChart>
    </ChartContainer>
  );
}

/** แท่งแนวนอนเรียงอันดับ (เหมาะกับชื่อยาว/เปรียบเทียบหลายรายการ) */
export function RankedBars({ data, valueFormat, compare, onBarClick, className = "w-full" }: {
  data: { label: string; value: number; prev?: number; highlight?: boolean }[];
  valueFormat?: (n: number) => string;
  compare?: boolean;
  onBarClick?: (i: number) => void;
  className?: string;
}) {
  const config: ChartConfig = { value: { label: "", color: "rgb(var(--chart-1))" }, prev: { label: "", color: "rgb(var(--chart-1) / 0.3)" } };
  const h = Math.max(160, data.length * (compare ? 40 : 30) + 20);
  return (
    <ChartContainer config={config} className={className} style={{ height: h }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="4 8" />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={valueFormat} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} tick={{ fontSize: 11 }} interval={0} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        {compare ? <Bar dataKey="prev" fill="rgb(var(--chart-1) / 0.3)" radius={[0, 3, 3, 0]} /> : null}
        <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={onBarClick ? (_: unknown, i: number) => onBarClick(i) : undefined} style={onBarClick ? { cursor: "pointer" } : undefined}>
          {data.map((d, i) => <Cell key={i} fill={d.highlight ? "rgb(var(--chart-1))" : "rgb(var(--chart-1) / 0.65)"} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Waterfall — องค์ประกอบการเปลี่ยนแปลง (ช่วงก่อน → ปัจจัย +/- → ช่วงนี้) */
export function WaterfallChart({ data, valueFormat, className = "h-[260px] w-full" }: {
  data: { label: string; base: number; val: number; kind: "up" | "down" | "total" }[];
  valueFormat?: (n: number) => string;
  className?: string;
}) {
  const config: ChartConfig = { val: { label: "", color: "rgb(var(--chart-1))" } };
  const color = (k: "up" | "down" | "total") => k === "total" ? "rgb(var(--c-brand))" : k === "up" ? "rgb(var(--c-ok, 34 197 94))" : "rgb(var(--c-danger, 239 68 68))";
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={valueFormat} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="base" stackId="w" fill="transparent" />
        <Bar dataKey="val" stackId="w" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={color(d.kind)} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** แท่งซ้อน (stacked) — มิติหลัก × มิติซ้อน (องค์ประกอบในแต่ละแท่ง) */
const STACK_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--c-brand)", "var(--c-aqua, 20 184 166)"];
export function StackedBars({ data, series, valueFormat, className = "h-[280px] w-full" }: {
  data: Array<Record<string, string | number>>;
  series: { key: string; label: string }[];
  valueFormat?: (n: number) => string;
  className?: string;
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: `rgb(${STACK_COLORS[i % STACK_COLORS.length]})` }]));
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={valueFormat} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} className="flex-wrap" />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="s" fill={`var(--color-${s.key})`} radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** กราฟกระจาย (scatter) — จุดต่อมิติ x=ตัววัดหลัก y=ตัววัดที่สอง ขนาด=จำนวนบิล */
export function ScatterPlot({ data, xLabel, yLabel, xFormat, yFormat, className = "h-[280px] w-full" }: {
  data: { label: string; x: number; y: number; z: number }[];
  xLabel: string; yLabel: string;
  xFormat?: (n: number) => string; yFormat?: (n: number) => string;
  className?: string;
}) {
  const config: ChartConfig = { pts: { label: xLabel, color: "rgb(var(--chart-1))" } };
  type P = { label: string; x: number; y: number; z: number };
  const Tip = ({ active, payload }: { active?: boolean; payload?: { payload: P }[] }) =>
    active && payload?.length ? (
      <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop">
        <p className="font-semibold mb-0.5">{payload[0].payload.label}</p>
        <p className="text-muted">{xLabel}: <span className="text-ink tnum">{xFormat ? xFormat(payload[0].payload.x) : payload[0].payload.x}</span></p>
        <p className="text-muted">{yLabel}: <span className="text-ink tnum">{yFormat ? yFormat(payload[0].payload.y) : payload[0].payload.y}</span></p>
      </div>
    ) : null;
  return (
    <ChartContainer config={config} className={className}>
      <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="4 8" />
        <XAxis type="number" dataKey="x" name={xLabel} tickLine={false} axisLine={false} tickFormatter={xFormat} tick={{ fontSize: 10 }} label={{ value: xLabel, position: "insideBottom", offset: -8, fontSize: 10, fill: "rgb(var(--c-muted))" }} />
        <YAxis type="number" dataKey="y" name={yLabel} tickLine={false} axisLine={false} width={50} tickFormatter={yFormat} tick={{ fontSize: 10 }} />
        <ZAxis type="number" dataKey="z" range={[48, 360]} />
        <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={<Tip />} />
        <Scatter data={data} fill="rgb(var(--chart-1))" fillOpacity={0.6} />
      </ScatterChart>
    </ChartContainer>
  );
}

/** กราฟเรดาร์เปรียบเทียบหลายสาขา/มิติ */
export function BranchRadar({
  data,
  config,
  keys,
  className = "mx-auto aspect-square max-h-[280px]",
}: {
  data: Record<string, number | string>[];
  config: ChartConfig;
  keys: string[];
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <RadarChart data={data}>
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <PolarAngleAxis dataKey="dim" />
        <PolarGrid strokeDasharray="3 3" />
        {keys.map((k) => (
          <Radar key={k} dataKey={k} stroke={`var(--color-${k})`} fill={`var(--color-${k})`} fillOpacity={0.12} strokeWidth={2} />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </RadarChart>
    </ChartContainer>
  );
}

/** กราฟพื้นที่แนวโน้ม (ยอดขายตามช่วงเวลา) */
export function SalesAreaTrend({
  data,
  config,
  valueFormat,
  className = "h-[260px] w-full",
}: {
  data: { label: string; value: number }[];
  config: ChartConfig;
  valueFormat?: (n: number) => string;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <AreaChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="cr-fill-value" x1="0" y1="0" x2="0" y2="1">
            <stop offset="2%" stopColor="var(--color-value)" stopOpacity={0.28} />
            <stop offset="98%" stopColor="var(--color-value)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={valueFormat} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} fill="url(#cr-fill-value)" />
      </AreaChart>
    </ChartContainer>
  );
}

/** กราฟแท่ง (รายชั่วโมง/รายวัน) — ไฮไลต์แท่งที่ highlight=true */
export function InsightBars({
  data,
  config,
  valueFormat,
  onBarClick,
  className = "h-[220px] w-full",
}: {
  data: { label: string; value: number; highlight?: boolean }[];
  config: ChartConfig;
  valueFormat?: (n: number) => string;
  onBarClick?: (i: number) => void;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={valueFormat} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" radius={[5, 5, 0, 0]} onClick={onBarClick ? (_: unknown, i: number) => onBarClick(i) : undefined} style={onBarClick ? { cursor: "pointer" } : undefined}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.highlight ? "rgb(var(--chart-1))" : "rgb(var(--chart-1) / 0.3)"} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** โดนัทสัดส่วน (ช่องทาง/การจ่าย) — data key ต้องตรงกับ config */
export function MixDonut({
  data,
  config,
  onBarClick,
  className = "mx-auto aspect-square max-h-[230px]",
}: {
  data: { key: string; value: number }[];
  config: ChartConfig;
  onBarClick?: (i: number) => void;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
        <Pie data={data} dataKey="value" nameKey="key" innerRadius={52} outerRadius={82} paddingAngle={2} strokeWidth={2} onClick={onBarClick ? (_: unknown, i: number) => onBarClick(i) : undefined} style={onBarClick ? { cursor: "pointer" } : undefined}>
          {data.map((d) => (
            <Cell key={d.key} fill={`var(--color-${d.key})`} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="key" />} className="flex-wrap" />
      </PieChart>
    </ChartContainer>
  );
}
