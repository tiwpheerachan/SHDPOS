"use client";

// =====================================================================
// แผนที่ประเทศไทยระดับจังหวัด (77 จังหวัด) — GeoJSON → Mercator → SVG paths
// * heat โทนเข้ม-อ่อนตามยอดขาย (เลือกมิติได้: ยอดขาย / จำนวนบิล)
// * คลิกจังหวัด = ซูมเข้า (focus) + ไฮไลต์ → เลือกสาขาในจังหวัดต่อได้
// * hover = tooltip · realtime ผ่านการ re-render เมื่อ data เปลี่ยน
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCompact } from "@/lib/money";
import { provinceTH } from "@/lib/geo/th-provinces";

type Ring = [number, number][];
interface Feature { properties: { name: string }; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } }
export interface ProvinceStat { sales: number; orders: number; branches: number }
export type MapMetric = "sales" | "orders";

const VB = { w: 560, h: 880 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mercX = (lon: number) => (lon * Math.PI) / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

export function ThailandMap({
  data,
  metric = "sales",
  focus,
  onFocus,
}: {
  data: Record<string, ProvinceStat>;
  metric?: MapMetric;
  focus?: string | null;
  onFocus?: (enName: string | null) => void;
}) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/geo/thailand-provinces.json").then((r) => r.json())
      .then((g) => { if (alive) setFeatures(g.features as Feature[]); })
      .catch(() => { if (alive) setFeatures([]); });
    return () => { alive = false; };
  }, []);

  const { paths, bbox, ready } = useMemo(() => {
    if (!features || !features.length) return { paths: [] as { name: string; d: string }[], bbox: {} as Record<string, { x: number; y: number; w: number; h: number }>, ready: false };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const polysOf = (f: Feature): Ring[] =>
      f.geometry.type === "Polygon"
        ? (f.geometry.coordinates as number[][][]).map((r) => r as Ring)
        : (f.geometry.coordinates as number[][][][]).flatMap((poly) => poly.map((r) => r as Ring));
    for (const f of features) for (const ring of polysOf(f)) for (const [lon, lat] of ring) {
      const x = mercX(lon), y = mercY(lat);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const pad = 14;
    const scale = Math.min((VB.w - pad * 2) / (maxX - minX), (VB.h - pad * 2) / (maxY - minY));
    const offX = (VB.w - (maxX - minX) * scale) / 2;
    const offY = (VB.h - (maxY - minY) * scale) / 2;
    const px = (lon: number) => offX + (mercX(lon) - minX) * scale;
    const py = (lat: number) => offY + (maxY - mercY(lat)) * scale;
    const paths: { name: string; d: string }[] = [];
    const bbox: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const f of features) {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      const d = polysOf(f).map((ring) => ring.map((p, i) => {
        const x = px(p[0]), y = py(p[1]);
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ") + "Z").join(" ");
      paths.push({ name: f.properties.name, d });
      bbox[f.properties.name] = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
    }
    return { paths, bbox, ready: true };
  }, [features]);

  const valOf = (s?: ProvinceStat) => (!s ? 0 : metric === "sales" ? s.sales : s.orders);
  const maxVal = useMemo(() => Math.max(1, ...Object.values(data).map((d) => valOf(d))), [data, metric]);
  const fillFor = (name: string) => {
    const s = data[name];
    if (!s || s.branches === 0) return "rgb(var(--c-surface-2))";
    const ratio = valOf(s) / maxVal;
    return `rgba(255,114,94,${(0.16 + ratio * 0.82).toFixed(3)})`;
  };

  // zoom transform ไปยังจังหวัดที่ focus
  const g = useMemo(() => {
    if (!focus || !bbox[focus]) return { s: 1, tx: 0, ty: 0 };
    const b = bbox[focus];
    // เว้นที่รอบจังหวัดให้เห็น context (0.5) + คุมไม่ให้ซูมแรงเกิน
    const s = clamp(Math.min(VB.w / (b.w || 1), VB.h / (b.h || 1)) * 0.5, 1, 5);
    return { s, tx: VB.w / 2 - (b.x + b.w / 2) * s, ty: VB.h / 2 - (b.y + b.h / 2) * s };
  }, [focus, bbox]);

  const move = (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  if (!ready) return <div className="min-h-[340px] grid place-items-center text-xs text-muted">{features === null ? "กำลังโหลดแผนที่…" : "แผนที่ไม่พร้อมใช้งาน"}</div>;
  const hv = hover ? { name: hover, th: provinceTH(hover), stat: data[hover] } : null;

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-[340px]" onMouseMove={move}>
      {focus ? (
        <button onClick={() => onFocus?.(null)} className="absolute top-2 left-2 z-10 btn-soft h-8 px-2.5 text-xs">← ทั้งประเทศ</button>
      ) : null}
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full block"
        role="img" aria-label="แผนที่ยอดขายประเทศไทย"
        style={{ WebkitMaskImage: "radial-gradient(130% 118% at 50% 46%, #000 78%, transparent 100%)", maskImage: "radial-gradient(130% 118% at 50% 46%, #000 78%, transparent 100%)" }}>
        <g transform={`translate(${g.tx.toFixed(1)} ${g.ty.toFixed(1)}) scale(${g.s.toFixed(3)})`} style={{ transition: "transform .6s cubic-bezier(.22,1,.36,1)" }}>
          {paths.map((p) => {
            const has = Boolean(data[p.name]?.branches);
            const active = hover === p.name || focus === p.name;
            const dim = focus && focus !== p.name;
            return (
              <path key={p.name} d={p.d} data-prov={p.name}
                fill={fillFor(p.name)}
                fillOpacity={dim ? 0.45 : 1}
                stroke={active ? "rgb(var(--c-ink))" : dim ? "rgb(var(--c-line) / 0.6)" : "rgb(var(--c-line))"}
                strokeWidth={active ? 1.6 : 0.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ cursor: has ? "pointer" : "default", transition: "fill .3s, fill-opacity .35s, stroke .2s" }}
                onMouseEnter={() => setHover(p.name)}
                onMouseLeave={() => setHover(null)}
                onClick={() => { if (has) onFocus?.(focus === p.name ? null : p.name); }}
              />
            );
          })}
        </g>
      </svg>

      {hv ? (
        <div className="pointer-events-none absolute z-20 bg-surface border border-line rounded-xl shadow-pop px-3 py-2 text-xs w-44"
          style={{ left: Math.min(pos.x + 12, (wrapRef.current?.clientWidth ?? 300) - 180), top: pos.y + 12 }}>
          <div className="font-semibold truncate">{hv.th}</div>
          {hv.stat && hv.stat.branches ? (
            <>
              <div className="mt-1 flex justify-between"><span className="text-muted">ยอดขาย</span><span className="tnum font-semibold text-coral">฿{formatCompact(hv.stat.sales)}</span></div>
              <div className="flex justify-between"><span className="text-muted">บิล / สาขา</span><span className="tnum">{hv.stat.orders} / {hv.stat.branches}</span></div>
              <div className="text-[10px] text-muted mt-0.5">คลิกเพื่อซูม + ดูสาขา</div>
            </>
          ) : <div className="text-muted mt-0.5">ไม่มีสาขา</div>}
        </div>
      ) : null}

      <div className="absolute bottom-2 right-2 flex items-center gap-2 text-[10px] text-muted bg-surface/80 backdrop-blur rounded-lg px-2 py-1.5">
        <span>น้อย</span>
        <span className="h-2 w-16 rounded-full" style={{ background: "linear-gradient(90deg, rgba(255,114,94,0.16), rgba(255,114,94,0.98))" }} />
        <span>มาก</span>
      </div>
    </div>
  );
}
