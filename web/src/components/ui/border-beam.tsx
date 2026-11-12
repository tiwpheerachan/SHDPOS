"use client";

import * as React from "react";
import clsx from "clsx";

// BorderBeam (ปรับจาก 21st.dev "border-beam" — ไม่ลง npm, ทำ native)
//   ลำแสงสีวิ่งรอบขอบมน · CSS ล้วน (conic-gradient + mask หมุน) · ใช้โทเคน --c-*
//   จึงตามธีม light/dark เอง · มี reduced-motion fallback
interface BorderBeamProps {
  children: React.ReactNode;
  /** รัศมีขอบ (px) — ให้ตรงกับ rounded ของลูก */
  radius?: number;
  /** ความหนาเส้นลำแสง (px) */
  width?: number;
  /** รอบการหมุน (วินาที) */
  duration?: number;
  /** หลากสี (แบรนด์+ฟ้า+ลาเวนเดอร์) หรือสีแบรนด์ล้วน */
  variant?: "colorful" | "brand";
  /** เปิด/หยุดลำแสง (เช่น เฉพาะตอนโฟกัส) — ค่าเริ่มคือเปิดตลอด */
  active?: boolean;
  className?: string;
}

const CSS = `
@property --shd-beam-ang{syntax:'<angle>';inherits:false;initial-value:0deg}
.shd-beam{position:relative;border-radius:var(--shd-beam-r);isolation:isolate}
.shd-beam::before{
  content:"";position:absolute;inset:0;border-radius:inherit;z-index:2;pointer-events:none;
  padding:var(--shd-beam-w);
  background:conic-gradient(from var(--shd-beam-ang),transparent 0deg,transparent 215deg,var(--shd-beam-g) ,transparent 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;
  animation:shd-beam-rot var(--shd-beam-dur) linear infinite;
}
.shd-beam[data-active="false"]::before{animation-play-state:paused;opacity:.45}
.shd-beam-col{--shd-beam-g:rgb(var(--c-brand)/0) 230deg,rgb(var(--c-brand)/.95) 270deg,rgb(var(--c-aqua)/1) 300deg,rgb(var(--c-brand)/.95) 330deg,rgb(var(--c-brand)/0) 360deg}
.shd-beam-brand{--shd-beam-g:rgb(var(--c-brand)/0) 230deg,rgb(var(--c-brand)/.95) 300deg,rgb(var(--c-brand)/0) 360deg}
@keyframes shd-beam-rot{to{--shd-beam-ang:360deg}}
@media (prefers-reduced-motion:reduce){
  .shd-beam::before{animation:none;background:none;box-shadow:0 0 0 var(--shd-beam-w) rgb(var(--c-brand)/.4) inset}
}
/* เผื่อเบราว์เซอร์ไม่รองรับ @property → แสดงขอบแบรนด์จางแทนการหมุน */
@supports not (background:conic-gradient(from var(--shd-beam-ang),#000,#fff)){
  .shd-beam::before{animation:none;background:none;box-shadow:0 0 0 var(--shd-beam-w) rgb(var(--c-brand)/.4) inset}
}
`;

export function BorderBeam({
  children,
  radius = 12,
  width = 2,
  duration = 3.2,
  variant = "colorful",
  active = true,
  className,
}: BorderBeamProps) {
  return (
    <div
      className={clsx("shd-beam", variant === "colorful" ? "shd-beam-col" : "shd-beam-brand", className)}
      data-active={active ? "true" : "false"}
      style={
        {
          "--shd-beam-r": `${radius}px`,
          "--shd-beam-w": `${width}px`,
          "--shd-beam-dur": `${duration}s`,
        } as React.CSSProperties
      }
    >
      {children}
      <style>{CSS}</style>
    </div>
  );
}

export default BorderBeam;
