"use client";

// =====================================================================
// แผนที่จริง Google Maps — ถนน/ภาพถ่าย + ซูม/ลากเนทีฟ
//   ใช้ Google Maps JavaScript SDK (โหลดครั้งเดียว) + หมุดรายสาขา ขนาด = ยอด
//   คลิกหมุด = เลือกสาขา (onFocus) · hover = title เนทีฟ
//   เปิดใช้เมื่อมี NEXT_PUBLIC_GOOGLE_MAPS_KEY ไม่งั้น page ใช้ BranchGeoMap (เวกเตอร์)
// =====================================================================

import { useEffect, useRef, useState } from "react";
import { formatCompact } from "@/lib/money";
import { useI18n } from "@/lib/i18n/provider";
import type { GeoBranch, GeoMetric } from "./branch-geo-map";

/* eslint-disable @typescript-eslint/no-explicit-any */
let loadPromise: Promise<any> | null = null;
function loadGoogle(key: string): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=th&region=TH`;
    s.async = true; s.defer = true;
    s.onload = () => (w.google?.maps ? resolve(w.google) : reject(new Error("no_maps")));
    s.onerror = () => { loadPromise = null; reject(new Error("load_failed")); };
    document.head.appendChild(s);
  });
  return loadPromise;
}

export function GoogleBranchMap({
  branches, metric = "sales", focusId, onFocus, apiKey,
}: {
  branches: GeoBranch[];
  metric?: GeoMetric;
  focusId?: string | null;
  onFocus?: (branchId: string | null) => void;
  apiKey: string;
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<Map<string, any>>(new Map());
  const fitted = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // init map ครั้งเดียว
  useEffect(() => {
    let alive = true;
    loadGoogle(apiKey).then((g) => {
      if (!alive || !divRef.current) return;
      mapRef.current = new g.maps.Map(divRef.current, {
        center: { lat: 13.74, lng: 100.55 }, zoom: 11,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        clickableIcons: false, gestureHandling: "greedy",
      });
      setReady(true);
    }).catch(() => { if (alive) setErr("err"); });
    return () => { alive = false; };
  }, [apiKey]);

  // sync หมุดเมื่อข้อมูล/มิติเปลี่ยน
  useEffect(() => {
    const w = window as any;
    const g = w.google; const map = mapRef.current;
    if (!g || !map) return;
    const valOf = (b: GeoBranch) => (metric === "sales" ? b.value : b.orders);
    const pts = branches.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    const maxVal = Math.max(1, ...pts.map(valOf));
    const seen = new Set<string>();
    const bounds = new g.maps.LatLngBounds();

    for (const b of pts) {
      seen.add(b.id);
      const val = valOf(b);
      const scale = 6 + Math.sqrt(val / maxVal) * 22;
      const active = focusId === b.id;
      const icon = {
        path: g.maps.SymbolPath.CIRCLE, scale,
        fillColor: b.online === false ? "#94a3b8" : "#ff725e",
        fillOpacity: 0.82, strokeColor: active ? "#111827" : "#ffffff", strokeWeight: active ? 2.4 : 1.4,
      };
      const title = `${b.label} · ฿${formatCompact(b.value)} · ${b.orders} ${L("บิล", "bills", "单")}`;
      let m = markers.current.get(b.id);
      if (!m) {
        m = new g.maps.Marker({ position: { lat: b.lat, lng: b.lng }, map, icon, title, zIndex: Math.round(val) });
        m.addListener("click", () => onFocus?.(focusId === b.id ? null : b.id));
        markers.current.set(b.id, m);
      } else {
        m.setIcon(icon); m.setTitle(title); m.setZIndex(Math.round(val));
      }
      bounds.extend({ lat: b.lat, lng: b.lng });
    }
    // ลบหมุดที่หายไป
    for (const [id, m] of markers.current) if (!seen.has(id)) { m.setMap(null); markers.current.delete(id); }
    // fit ครั้งแรกที่มีข้อมูล
    if (!fitted.current && pts.length) { fitted.current = true; map.fitBounds(bounds, 56); }
  }, [branches, metric, focusId, ready]);

  if (err) {
    return (
      <div className="min-h-[340px] grid place-items-center text-center px-6">
        <div className="text-xs text-muted space-y-1">
          <p className="font-semibold text-ink">{L("โหลด Google Maps ไม่สำเร็จ", "Google Maps failed to load", "Google 地图加载失败")}</p>
          <p>{L("ตรวจคีย์: เปิดใช้ \"Maps JavaScript API\" + เปิด Billing + จำกัดโดเมนให้ครอบ localhost/โดเมนจริง", "Check key: enable Maps JavaScript API + Billing + allow this domain", "检查密钥")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative w-full h-full min-h-[340px] overflow-hidden rounded-xl">
      <div ref={divRef} className="absolute inset-0" />
      {!ready ? <div className="absolute inset-0 grid place-items-center text-xs text-muted">{L("กำลังโหลดแผนที่…", "Loading map…", "加载中…")}</div> : null}
      <div className="absolute bottom-2 left-2 z-[1] flex items-center gap-2 text-[10px] text-muted bg-surface/80 backdrop-blur rounded-lg px-2 py-1.5 pointer-events-none">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff725e" }} />
        <span>{L("ขนาดหมุด = ยอด · คลิกเลือกสาขา", "Marker size = value · click to select", "标记大小=金额")}</span>
      </div>
    </div>
  );
}
