"use client";

// กราฟ recharts ธีม SHD (ใช้ชั้น shadcn chart primitive + โทเคน --chart-*)
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

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
