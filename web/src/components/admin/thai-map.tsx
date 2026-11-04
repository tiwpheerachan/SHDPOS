"use client";

// =====================================================================
// Live Sales Map — แผนที่ไทยแบบ stylized เขียนเอง (ไม่พึ่ง library)
// รวมสาขาตามจังหวัด · ขนาดหมุด = ยอดขาย · สีหมุด = สถานะ
// projection เดียวกันทั้งเส้นขอบและหมุด → ตำแหน่งตรงกันเสมอ
// =====================================================================

import { useMemo, useState } from "react";
import { formatCompact } from "@/lib/money";

const VB = { w: 300, h: 560 };
const LON = [97.0, 106.0];
const LAT = [5.4, 20.7];
const px = (lon: number) => ((lon - LON[0]) / (LON[1] - LON[0])) * VB.w;
const py = (lat: number) => ((LAT[1] - lat) / (LAT[1] - LAT[0])) * VB.h;

// ขอบประเทศแบบหยาบ (lon,lat) ตามเข็มนาฬิกา — พอให้อ่านออกว่าเป็นไทย
const BORDER: [number, number][] = [
  [99.9, 20.4], [100.9, 19.9], [101.2, 18.3], [102.1, 18.2], [103.9, 18.3],
  [104.8, 17.4], [105.6, 15.0], [105.5, 14.4], [104.0, 14.4], [102.9, 14.0],
  [102.6, 13.6], [101.0, 12.6], [100.9, 13.5], [100.0, 13.4], [99.9, 11.6],
  [99.2, 9.1], [100.3, 7.2], [100.1, 6.5], [98.3, 8.0], [98.5, 9.9],
  [98.8, 12.0], [98.2, 14.9], [97.5, 17.3], [98.0, 18.5], [98.9, 19.8],
];

// พิกัดจังหวัดที่ใช้จริงในข้อมูล
const PROV: Record<string, [number, number]> = {
  กรุงเทพมหานคร: [100.52, 13.75],
  นนทบุรี: [100.47, 13.9],
  ปทุมธานี: [100.58, 14.05],
  สมุทรปราการ: [100.62, 13.58],
  ชลบุรี: [101.0, 13.36],
  ขอนแก่น: [102.83, 16.44],
  เชียงใหม่: [98.98, 18.79],
  นครราชสีมา: [102.1, 14.97],
  ภูเก็ต: [98.39, 7.88],
  สงขลา: [100.6, 7.19],
};

export interface MapProvince {
  province: string;
  sales: number;
  branches: number;
  online: number;
  status: "strong" | "normal" | "warn" | "problem" | "offline";
}

const STATUS_COLOR: Record<MapProvince["status"], string> = {
  strong: "#3BB98C",
  normal: "#FF725E",
  warn: "#E0894F",
  problem: "#D6454A",
  offline: "#9CA39C",
};

export function ThaiSalesMap({ data, onPick }: { data: MapProvince[]; onPick?: (province: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);

  const borderPath = useMemo(
    () => BORDER.map(([lo, la], i) => `${i === 0 ? "M" : "L"}${px(lo).toFixed(1)},${py(la).toFixed(1)}`).join(" ") + " Z",
    []
  );

  const maxSales = Math.max(1, ...data.map((d) => d.sales));
  const markers = useMemo(() => {
    // เขย่าตำแหน่งเล็กน้อยเมื่อจังหวัดกระจุกใน กทม.-ปริมณฑล ไม่ให้หมุดทับกัน
    return data
      .filter((d) => PROV[d.province])
      .map((d) => {
        const [lo, la] = PROV[d.province];
        const r = 7 + Math.sqrt(d.sales / maxSales) * 20;
        return { ...d, x: px(lo), y: py(la), r };
      })
      .sort((a, b) => b.r - a.r);
  }, [data, maxSales]);

  return (
    <div className="relative w-full h-full min-h-[320px] grid place-items-center">
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="h-full max-h-[440px] w-auto" role="img" aria-label="แผนที่ยอดขายประเทศไทย">
        <path d={borderPath} fill="rgb(var(--c-surface-2))" stroke="rgb(var(--c-line))" strokeWidth="1.5" strokeLinejoin="round" />
        {markers.map((m, i) => (
          <g key={m.province} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => onPick?.(m.province)} style={{ cursor: onPick ? "pointer" : "default" }}>
            <circle cx={m.x} cy={m.y} r={m.r + 6} fill={STATUS_COLOR[m.status]} opacity={hover === i ? 0.22 : 0.12} />
            <circle cx={m.x} cy={m.y} r={m.r} fill={STATUS_COLOR[m.status]} opacity="0.9"
              stroke="rgb(var(--c-surface))" strokeWidth="2" />
            {m.branches > 1 ? (
              <text x={m.x} y={m.y} textAnchor="middle" dominantBaseline="central"
                fill="#fff" style={{ fontSize: Math.min(m.r, 13), fontWeight: 700 }}>{m.branches}</text>
            ) : null}
          </g>
        ))}
      </svg>

      {hover != null && markers[hover] ? (
        <div className="absolute top-3 left-3 bg-surface border border-line rounded-xl shadow-pop px-3 py-2 text-xs pointer-events-none z-10 w-44">
          <div className="font-semibold truncate">{markers[hover].province}</div>
          <div className="mt-1 flex justify-between"><span className="text-muted">ยอดขาย</span><span className="tnum font-semibold text-coral">฿{formatCompact(markers[hover].sales)}</span></div>
          <div className="flex justify-between"><span className="text-muted">สาขา</span><span className="tnum">{markers[hover].online}/{markers[hover].branches} ออนไลน์</span></div>
        </div>
      ) : null}

      {/* legend */}
      <div className="absolute bottom-2 right-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted bg-surface/80 backdrop-blur rounded-lg px-2 py-1.5">
        {([["strong", "แข็งแรง"], ["normal", "ปกติ"], ["warn", "เฝ้าระวัง"], ["offline", "ออฟไลน์"]] as const).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[k as MapProvince["status"]] }} />{l}</span>
        ))}
      </div>
    </div>
  );
}
