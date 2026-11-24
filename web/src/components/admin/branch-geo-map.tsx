"use client";

// =====================================================================
// แผนที่จริง (ตามพิกัดสาขาจริง) — Mercator → SVG + ซูม/ลากได้
// * วาดโครงชายแดน/จังหวัดไทยจาก GeoJSON เดียวกับมุมมองจังหวัด เป็น backdrop
// * จุดฟอง 1 จุด/สาขา วางที่ lat/lng จริง (จาก DB หรือ seed lib/geo) ขนาด = ยอด
// * ซูม: ล้อเมาส์ / ปุ่ม +−  ·  ลาก: กดค้างแล้วลาก  ·  hover = tooltip · click = เลือกสาขา
// ── tile API ภายนอก (ถนน/ภาพถ่าย) ────────────────────────────────────
//   เจ้าของจะส่ง "tile API" ให้ภายหลัง → เซ็ต env NEXT_PUBLIC_MAP_TILES = tile URL
//   แล้วส่งเข้ามาทาง prop tileUrl (page.tsx อ่าน env ให้แล้ว)
//   ตอนนี้ยังไม่ตั้ง = ใช้ backdrop โครงแผนที่ไทย (ทำงานได้เลย ไม่ต้องรอ key)
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCompact } from "@/lib/money";
import { useI18n } from "@/lib/i18n/provider";

export interface GeoBranch {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number;      // ยอดขาย
  orders: number;     // จำนวนบิล
  province?: string | null;
  online?: boolean;
}
export type GeoMetric = "sales" | "orders";

type Ring = [number, number][];
interface Feature { geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } }

const VB = { w: 560, h: 440 };
const mercX = (lon: number) => (lon * Math.PI) / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const MIN_SPAN = 0.045; // ช่วง merc ขั้นต่ำ กันซูมแรงเกินตอนสาขากระจุกจุดเดียว
const K_MIN = 1, K_MAX = 12;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function BranchGeoMap({
  branches,
  metric = "sales",
  focusId,
  onFocus,
  tileUrl,
}: {
  branches: GeoBranch[];
  metric?: GeoMetric;
  focusId?: string | null;
  onFocus?: (branchId: string | null) => void;
  tileUrl?: string | null; // tile API ที่จะมาทีหลัง
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 }); // ซูม/แพน (พิกัด viewBox)
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/geo/thailand-provinces.json").then((r) => r.json())
      .then((g) => { if (alive) setFeatures(g.features as Feature[]); })
      .catch(() => { if (alive) setFeatures([]); });
    return () => { alive = false; };
  }, []);

  const valOf = (b: GeoBranch) => (metric === "sales" ? b.value : b.orders);

  // ── โปรเจกต์: fit ขอบเขตสาขา → ซูมไปที่สาขาจริง ────
  const proj = useMemo(() => {
    const pts = branches.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    if (!pts.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of pts) {
      const x = mercX(b.lng), y = mercY(b.lat);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, MIN_SPAN), spanY = Math.max(maxY - minY, MIN_SPAN);
    const padR = 0.26;
    minX = cx - spanX * (0.5 + padR); maxX = cx + spanX * (0.5 + padR);
    minY = cy - spanY * (0.5 + padR); maxY = cy + spanY * (0.5 + padR);
    const scale = Math.min(VB.w / (maxX - minX), VB.h / (maxY - minY));
    const offX = (VB.w - (maxX - minX) * scale) / 2;
    const offY = (VB.h - (maxY - minY) * scale) / 2;
    const px = (lon: number) => offX + (mercX(lon) - minX) * scale;
    const py = (lat: number) => offY + (maxY - mercY(lat)) * scale;
    return { px, py };
  }, [branches]);

  const outline = useMemo(() => {
    if (!features || !proj) return [];
    const polysOf = (f: Feature): Ring[] =>
      f.geometry.type === "Polygon"
        ? (f.geometry.coordinates as number[][][]).map((r) => r as Ring)
        : (f.geometry.coordinates as number[][][][]).flatMap((poly) => poly.map((r) => r as Ring));
    const out: string[] = [];
    for (const f of features) {
      for (const ring of polysOf(f)) {
        let anyIn = false;
        const d = ring.map((p, i) => {
          const x = proj.px(p[0]), y = proj.py(p[1]);
          if (x > -200 && x < VB.w + 200 && y > -200 && y < VB.h + 200) anyIn = true;
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ") + "Z";
        if (anyIn) out.push(d);
      }
    }
    return out;
  }, [features, proj]);

  const maxVal = useMemo(() => Math.max(1, ...branches.map(valOf)), [branches, metric]);
  const rOf = (b: GeoBranch) => 6 + Math.sqrt(valOf(b) / maxVal) * 22;

  // client → พิกัด viewBox (รองรับ letterbox ของ preserveAspectRatio)
  const toVB = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  // ซูมรอบจุด (px,py ใน viewBox)
  const zoomAround = (px: number, py: number, factor: number) => {
    setView((v) => {
      const k = clamp(v.k * factor, K_MIN, K_MAX);
      const r = k / v.k;
      let tx = px - (px - v.tx) * r;
      let ty = py - (py - v.ty) * r;
      // คุมไม่ให้แพนหลุดจอตอน k=1
      if (k === 1) { tx = 0; ty = 0; }
      return { k, tx, ty };
    });
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const { x, y } = toVB(e.clientX, e.clientY);
    zoomAround(x, y, e.deltaY < 0 ? 1.18 : 1 / 1.18);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    const d = drag.current;
    if (!d) return;
    const ctmA = svgRef.current?.getScreenCTM()?.a || 1; // สเกล screen→viewBox
    const dx = (e.clientX - d.x) / ctmA, dy = (e.clientY - d.y) / ctmA;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    setView((v) => (v.k <= 1 ? v : { ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = () => { drag.current = null; };
  const reset = () => setView({ k: 1, tx: 0, ty: 0 });

  if (!proj) return <div className="min-h-[340px] grid place-items-center text-xs text-muted">{L("ยังไม่มีพิกัดสาขา", "No branch coordinates", "无门店坐标")}</div>;

  const drawn = branches.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
  const ordered = [...drawn].sort((a, b) => valOf(b) - valOf(a)); // ใหญ่ล่าง เล็กบน
  const hv = hover ? drawn.find((b) => b.id === hover) ?? null : null;
  const k = view.k;

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-[340px] overflow-hidden rounded-xl">
      <svg ref={svgRef} viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet"
        className="h-full w-full block select-none" style={{ cursor: k > 1 ? (drag.current ? "grabbing" : "grab") : "default", touchAction: "none" }}
        role="img" aria-label={L("แผนที่ยอดขายตามพิกัดสาขา", "Branch sales map", "门店销售地图")}
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { onPointerUp(); setHover(null); }}>
        <g transform={`translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${k.toFixed(4)})`}>
          {/* base layer: tile API (ถ้ามี) ไม่งั้นพื้นโครงแผนที่ */}
          {tileUrl ? (
            <image href={tileUrl} x="0" y="0" width={VB.w} height={VB.h} preserveAspectRatio="xMidYMid slice" opacity={0.9} />
          ) : null}
          {outline.map((d, i) => (
            <path key={i} d={d} fill="rgb(var(--c-surface-2) / 0.7)" stroke="rgb(var(--c-line))" strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
          {/* จุดสาขา — ขนาดคงที่บนจอ (หาร k) ให้อ่านง่ายทุกระดับซูม */}
          {ordered.map((b) => {
            const x = proj.px(b.lng), y = proj.py(b.lat);
            const rr = rOf(b);
            const active = hover === b.id || focusId === b.id;
            const dim = focusId && focusId !== b.id;
            const off = b.online === false;
            return (
              <g key={b.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
                style={{ cursor: "pointer" }} opacity={dim ? 0.4 : 1}
                onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}
                onClick={() => { if (!drag.current?.moved) onFocus?.(focusId === b.id ? null : b.id); }}>
                {active ? <circle r={(rr + 5) / k} fill="none" stroke="rgb(var(--c-ink))" strokeWidth={1.4} vectorEffect="non-scaling-stroke" /> : null}
                <circle r={rr / k} fill={off ? "rgba(148,163,184,0.55)" : "rgba(255,114,94,0.82)"} stroke="rgb(var(--c-surface))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                {rr > 13 ? <text textAnchor="middle" dy="0.34em" fontSize={9 / k} fontWeight={700} fill="#fff" style={{ pointerEvents: "none" }}>{formatCompact(valOf(b))}</text> : null}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ปุ่มซูม */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button onClick={() => zoomAround(VB.w / 2, VB.h / 2, 1.4)} className="h-7 w-7 grid place-items-center rounded-lg bg-surface/90 backdrop-blur border border-line text-ink hover:bg-surface2 text-base leading-none" aria-label="zoom in">+</button>
        <button onClick={() => zoomAround(VB.w / 2, VB.h / 2, 1 / 1.4)} className="h-7 w-7 grid place-items-center rounded-lg bg-surface/90 backdrop-blur border border-line text-ink hover:bg-surface2 text-base leading-none" aria-label="zoom out">−</button>
        {k > 1 ? <button onClick={reset} className="h-7 w-7 grid place-items-center rounded-lg bg-surface/90 backdrop-blur border border-line text-muted hover:bg-surface2 text-[10px]" aria-label="reset">รี</button> : null}
      </div>

      {hv ? (
        <div className="pointer-events-none absolute z-20 bg-surface border border-line rounded-xl shadow-pop px-3 py-2 text-xs w-48"
          style={{ left: Math.min(pos.x + 12, (wrapRef.current?.clientWidth ?? 300) - 196), top: pos.y + 12 }}>
          <div className="font-semibold truncate">{hv.label}</div>
          <div className="mt-1 flex justify-between"><span className="text-muted">{L("ยอดขาย", "Sales", "销售额")}</span><span className="tnum font-semibold text-coral">฿{formatCompact(hv.value)}</span></div>
          <div className="flex justify-between"><span className="text-muted">{L("บิล", "Bills", "单据")}</span><span className="tnum">{hv.orders}</span></div>
          {hv.online === false ? <div className="text-[10px] text-muted mt-0.5">● {L("POS ออฟไลน์", "POS offline", "POS 离线")}</div> : null}
          <div className="text-[10px] text-muted mt-0.5">{L("คลิกเพื่อเลือกสาขา", "Click to select branch", "点击选择门店")}</div>
        </div>
      ) : null}

      {!tileUrl ? (
        <div className="absolute top-2 left-2 text-[10px] text-muted bg-surface/80 backdrop-blur rounded-lg px-2 py-1">
          {L("โครงแผนที่ (รอเชื่อม tile API)", "Outline map (tile API pending)", "轮廓地图（待接入 tile API）")}
        </div>
      ) : null}

      <div className="absolute bottom-2 right-2 flex items-center gap-2 text-[10px] text-muted bg-surface/80 backdrop-blur rounded-lg px-2 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "rgba(255,114,94,0.82)" }} />
        <span>{L("ขนาด = ยอด · ล้อ/ลากเพื่อซูม", "Size = value · scroll/drag to zoom", "大小=金额 · 滚动/拖动缩放")}</span>
      </div>
    </div>
  );
}
