"use client";

import * as React from "react";

// ThinkingOrb — ทรงกลมจุดหมุน (ปรับจาก MorphOrb 21st.dev, ดึงเฉพาะลูกแก้ว)
//   canvas ล้วน · จุดหมุน + ไฟวิ่งรอบ (ตอน AI คิด) · ใช้โทเคน --c-brand
//   เคารพ prefers-reduced-motion (นิ่ง)
interface Props { size?: number; text?: string; className?: string }

const TAU = Math.PI * 2;
const RINGS = 16;
// สร้างพิกัดจุดบนทรงกลม (fibonacci-ish rings)
const DOTS = (() => {
  const out: { x: number; y: number; z: number; seed: number }[] = [];
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let k = 0; k < RINGS; k++) {
    const y = 1 - ((k + 0.5) / RINGS) * 2;
    const r = Math.sqrt(1 - y * y);
    const m = Math.max(4, Math.round(30 * r));
    for (let j = 0; j < m; j++) {
      const a = (j / m) * TAU + k * 0.35;
      out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, seed: rnd() * TAU });
    }
  }
  return out;
})();
const N = DOTS.length;

function brandRGB(): [number, number, number] {
  if (typeof window === "undefined") return [121, 80, 216];
  const v = getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim();
  const p = v.split(/\s+/).map(Number);
  return p.length === 3 && p.every((n) => !isNaN(n)) ? [p[0], p[1], p[2]] : [121, 80, 216];
}

export function ThinkingOrb({ size = 150, text, className }: Props) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const D = size, C = D / 2, R = D * 0.42;
    cv.width = Math.round(D * dpr); cv.height = Math.round(D * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [br, bg, bb] = brandRGB();
    const CP = Math.cos(0.35), SP = Math.sin(0.35);
    let raf = 0, t0 = performance.now();

    const draw = (now: number) => {
      const time = (now - t0) / 1000;
      ctx.clearRect(0, 0, D, D);
      const yaw = reduced ? 0.6 : time * 0.45;          // หมุนช้านุ่มขึ้น
      const cyw = Math.cos(yaw), syw = Math.sin(yaw);
      const sweep = time * 1.5;                          // แถบแสงวิ่งรอบ (ตามลองจิจูด)
      const breathe = reduced ? 1 : 1 + 0.035 * Math.sin(time * 1.6); // หายใจเบาๆ

      // คำนวณ + เรียงตาม depth (วาดหลังก่อนหน้า) เพื่อความนุ่ม
      const pts: { x: number; y: number; r: number; a: number; lit: number }[] = [];
      for (let n = 0; n < N; n++) {
        const d = DOTS[n];
        const x1 = d.x * cyw + d.z * syw, z1 = -d.x * syw + d.z * cyw;
        const y2 = d.y * CP - z1 * SP, z2 = d.y * SP + z1 * CP;
        const f = 2.8 / (2.8 - z2), depth = (z2 + 1) / 2;
        // แถบแสงไหล: คลื่น cos ตามลองจิจูด (ต่อเนื่อง ไม่กระตุก) + คลื่นรองจางๆ
        let lit = 0;
        if (!reduced) {
          const lon = Math.atan2(z1, x1);
          const band = Math.max(0, Math.cos(lon - sweep));
          const band2 = Math.max(0, Math.cos(lon - sweep + 2.3));
          const shimmer = 0.5 + 0.5 * Math.sin(d.y * 5 + time * 2 + d.seed);
          lit = Math.min(1, Math.pow(band, 7) + Math.pow(band2, 16) * 0.45 + shimmer * 0.06);
        }
        const a = (0.1 + 0.5 * depth * depth + 0.72 * lit) * (0.45 + 0.55 * depth);
        pts.push({ x: C + x1 * R * f * breathe, y: C - y2 * R * f * breathe, r: ((0.5 + 0.8 * depth) * f + lit * 1.35) * breathe, a: Math.min(1, a), lit });
      }
      pts.sort((p, q) => p.r - q.r);
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.3, p.r), 0, TAU);
        const mix = p.lit; // ยิ่งโดนแสงยิ่งออกขาว, ปกติ = สีแบรนด์
        const r = Math.round(br + (255 - br) * mix), g = Math.round(bg + (255 - bg) * mix), b = Math.round(bb + (255 - bb) * mix);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.a.toFixed(3)})`;
        ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const letters = text ? Array.from(text) : [];
  return (
    <div className={className} style={{ display: "grid", placeItems: "center", gap: 6 }} role="status" aria-label={text || "thinking"}>
      <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} aria-hidden />
      {text ? (
        <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".02em", color: "rgb(var(--c-muted))" }}>
          {letters.map((ch, i) => (
            <span key={i} className="shd-thk-ch" style={{ animationDelay: `${i * 0.08}s` }}>{ch === " " ? " " : ch}</span>
          ))}
          <span className="shd-thk-dots" aria-hidden="true"><i /><i /><i /></span>
        </p>
      ) : null}
      <style>{`
.shd-thk-ch{display:inline-block;animation:shd-thk 2.4s ease-in-out infinite}
.shd-thk-dots i{display:inline-block;width:3px;height:3px;margin-left:3px;border-radius:50%;background:rgb(var(--c-brand));opacity:.3;animation:shd-thk-dot 1.2s infinite}
.shd-thk-dots i:nth-child(2){animation-delay:.2s}
.shd-thk-dots i:nth-child(3){animation-delay:.4s}
@keyframes shd-thk{0%,100%{opacity:.5}30%{opacity:1}}
@keyframes shd-thk-dot{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){.shd-thk-ch,.shd-thk-dots i{animation:none;opacity:.8}}
`}</style>
    </div>
  );
}

export default ThinkingOrb;
