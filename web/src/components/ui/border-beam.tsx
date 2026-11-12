"use client";

import * as React from "react";
import clsx from "clsx";

// BorderBeam (ปรับจาก 21st.dev "border-beam" — ไม่ลง npm, ทำ native)
//   ลำแสงสีวิ่งรอบขอบมน · CSS ล้วน (conic-gradient + mask หมุน) · ใช้โทเคน --c-*
//   จึงตามธีม light/dark เอง · มี reduced-motion fallback
//   full = กรอบเรืองครบรอบตลอด (ไม่ขาด) + ลำแสงวิ่งไฮไลต์
interface BorderBeamProps {
  children: React.ReactNode;
  /** รัศมีขอบ (px) — ให้ตรงกับ rounded ของลูก */
  radius?: number;
  /** ความหนาเส้นลำแสง (px) */
  width?: number;
  /** รอบการหมุน (วินาที) */
  duration?: number;
  /** หลากสี (แบรนด์+ฟ้า) หรือสีแบรนด์ล้วน */
  variant?: "colorful" | "brand";
  /** กรอบเรืองครบรอบตลอด (ไม่ใช่แค่ลำแสงวิ่งเป็นช่วง) */
  full?: boolean;
  /** วิ่งเฉพาะตอน hover (idle = นิ่ง) — เหมาะกับลิสต์การ์ด */
  animateOnHover?: boolean;
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
  background:conic-gradient(from var(--shd-beam-ang),var(--shd-beam-g));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;
  animation:shd-beam-rot var(--shd-beam-dur) linear infinite;
}
.shd-beam[data-active="false"]::before{animation-play-state:paused;opacity:.5}
.shd-beam-hover::before{animation-play-state:paused}
.shd-beam-hover:hover::before{animation-play-state:running}
/* ลำแสงวิ่งเป็นช่วง (กรอบโปร่งส่วนที่เหลือ) */
.shd-beam-col{--shd-beam-g:transparent 230deg,rgb(var(--c-brand)/.95) 270deg,rgb(var(--c-aqua)/1) 300deg,rgb(var(--c-brand)/.95) 330deg,transparent 360deg}
.shd-beam-brand{--shd-beam-g:transparent 230deg,rgb(var(--c-brand)/.95) 300deg,transparent 360deg}
/* full = กรอบเรืองครบรอบตลอด + ไฮไลต์วิ่ง */
.shd-beam-full.shd-beam-col{--shd-beam-g:rgb(var(--c-brand)/.32) 0deg,rgb(var(--c-brand)/.32) 225deg,rgb(var(--c-brand)/.95) 268deg,rgb(var(--c-aqua)/1) 300deg,rgb(var(--c-brand)/.95) 332deg,rgb(var(--c-brand)/.32) 360deg}
.shd-beam-full.shd-beam-brand{--shd-beam-g:rgb(var(--c-brand)/.35) 0deg,rgb(var(--c-brand)/.35) 225deg,rgb(var(--c-brand)/1) 300deg,rgb(var(--c-brand)/.35) 360deg}
@keyframes shd-beam-rot{to{--shd-beam-ang:360deg}}
@media (prefers-reduced-motion:reduce){
  .shd-beam::before{animation:none;background:none;box-shadow:0 0 0 var(--shd-beam-w) rgb(var(--c-brand)/.4) inset}
}
/* เบราว์เซอร์ไม่รองรับ @property → แสดงขอบแบรนด์เต็มรอบแทนการหมุน */
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
  full = false,
  animateOnHover = false,
  active = true,
  className,
}: BorderBeamProps) {
  return (
    <div
      className={clsx(
        "shd-beam",
        variant === "colorful" ? "shd-beam-col" : "shd-beam-brand",
        full && "shd-beam-full",
        animateOnHover && "shd-beam-hover",
        className
      )}
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
