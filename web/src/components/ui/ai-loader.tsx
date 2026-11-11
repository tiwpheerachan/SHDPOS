"use client";

import * as React from "react";
import clsx from "clsx";

// AI-style loader (ปรับจาก 21st.dev) — วงแหวนเรืองแสงสีม่วงแบรนด์ + ตัวอักษรเต้น
// ใช้โทเคน --c-* จึงตามธีม light/dark · CSS ล้วน ไม่พึ่ง lib
interface AiLoaderProps {
  size?: number;
  text?: string;
  /** เต็มจอ (overlay) หรือ inline ในการ์ด */
  fullscreen?: boolean;
  className?: string;
}

const CSS = `
.shd-ldr{position:relative;display:flex;align-items:center;justify-content:center;font-family:var(--font-sans);user-select:none}
.shd-ldr span{display:inline-block;color:rgb(var(--c-ink));opacity:.4;animation:shd-ldr-letter 3s infinite;font-weight:600;letter-spacing:.01em}
.shd-ldr-ring{position:absolute;inset:0;border-radius:9999px;animation:shd-ldr-ring 5s linear infinite}
@keyframes shd-ldr-ring{
  0%{transform:rotate(90deg);
    box-shadow:0 6px 12px 0 rgb(var(--c-aqua)) inset,0 12px 18px 0 rgb(var(--c-brand)) inset,0 36px 36px 0 rgb(var(--c-brand-hover)) inset,0 0 3px 1.2px rgb(var(--c-brand) / .35),0 0 7px 2px rgb(var(--c-brand) / .22)}
  50%{transform:rotate(270deg);
    box-shadow:0 6px 12px 0 rgb(var(--c-lavender)) inset,0 12px 6px 0 rgb(var(--c-aqua)) inset,0 24px 36px 0 rgb(var(--c-brand)) inset,0 0 3px 1.2px rgb(var(--c-brand) / .35),0 0 7px 2px rgb(var(--c-brand) / .22)}
  100%{transform:rotate(450deg);
    box-shadow:0 6px 12px 0 rgb(var(--c-aqua)) inset,0 12px 18px 0 rgb(var(--c-brand)) inset,0 36px 36px 0 rgb(var(--c-brand-hover)) inset,0 0 3px 1.2px rgb(var(--c-brand) / .35),0 0 7px 2px rgb(var(--c-brand) / .22)}
}
@keyframes shd-ldr-letter{
  0%,100%{opacity:.4;transform:translateY(0)}
  20%{opacity:1;transform:scale(1.15)}
  40%{opacity:.7;transform:translateY(0)}
}
@media (prefers-reduced-motion:reduce){
  .shd-ldr-ring{animation:none;box-shadow:0 0 0 2px rgb(var(--c-brand) / .4) inset,0 0 10px rgb(var(--c-brand) / .25)}
  .shd-ldr span{animation:none;opacity:.8}
}
`;

export function AiLoader({ size = 150, text = "กำลังโหลด", fullscreen = true, className }: AiLoaderProps) {
  const letters = Array.from(text);
  const ring = (
    <div className="shd-ldr" style={{ width: size, height: size }}>
      {letters.map((ch, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.1}s` }}>{ch === " " ? " " : ch}</span>
      ))}
      <div className="shd-ldr-ring" aria-hidden="true" />
      <style>{CSS}</style>
    </div>
  );

  if (!fullscreen) {
    return <div className={clsx("grid place-items-center", className)} role="status" aria-label={text}>{ring}</div>;
  }
  return (
    <div
      className={clsx("fixed inset-0 z-[80] grid place-items-center", className)}
      style={{ background: "rgb(var(--c-bg) / 0.82)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
      role="status"
      aria-label={text}
    >
      {ring}
    </div>
  );
}

// alias เผื่อโค้ดเดิมอ้างชื่อ Component
export const Component = AiLoader;
export default AiLoader;
