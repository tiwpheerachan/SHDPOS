"use client";
// =====================================================================
// Animated icons สไตล์ 21st.dev / iconify — เส้นวาดเข้า (stroke-dashoffset)
//   + เติมของขึ้นมาผ่าน <mask> (fill-rise) · ใช้ useId กัน mask id ชนกัน
//   เพิ่มไอคอนใหม่จาก https://21st.dev/community/icons วางที่ไฟล์นี้ได้เลย
// =====================================================================
import { useId, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
const svg = (size: number) => ({ width: size, height: size, xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24" as const });
const strokeProps = { fill: "none" as const, stroke: "currentColor" as const, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** สแกน — มุมกรอบวาดเข้าทีละมุม + ลำแสงกวาดขึ้น-ลงต่อเนื่อง */
export function AnimatedScan({ size = 24, ...props }: IconProps) {
  return (
    <svg {...svg(size)} {...strokeProps} {...props}>
      <path strokeDasharray="7" strokeDashoffset="7" d="M3 8V5a2 2 0 0 1 2 -2h3"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="7;0" /></path>
      <path strokeDasharray="7" strokeDashoffset="7" d="M16 3h3a2 2 0 0 1 2 2v3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.15s" dur="0.3s" values="7;0" /></path>
      <path strokeDasharray="7" strokeDashoffset="7" d="M21 16v3a2 2 0 0 1 -2 2h-3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.3s" dur="0.3s" values="7;0" /></path>
      <path strokeDasharray="7" strokeDashoffset="7" d="M8 21H5a2 2 0 0 1 -2 -2v-3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.45s" dur="0.3s" values="7;0" /></path>
      <line x1="6.5" x2="17.5" y1="12" y2="12">
        <animate attributeName="y1" values="8;16;8" dur="2s" begin="0.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" />
        <animate attributeName="y2" values="8;16;8" dur="2s" begin="0.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" />
        <animate attributeName="opacity" values="0;1;1;0.25;1" dur="2s" begin="0.6s" repeatCount="indefinite" keyTimes="0;0.15;0.5;0.85;1" />
      </line>
    </svg>
  );
}

/** กล่องสต๊อก — โครงวาดเข้า + "เติมของ" ขึ้นจากก้นกล่องผ่าน mask (fill-rise) */
export function AnimatedBox({ size = 24, ...props }: IconProps) {
  const m = useId();
  const body = "M5 8h14v10.5a1.5 1.5 0 0 1 -1.5 1.5h-11a1.5 1.5 0 0 1 -1.5 -1.5Z";
  return (
    <svg {...svg(size)} {...props}>
      <defs>
        <mask id={m}>
          <rect width="24" height="24" fill="#000" />
          <rect x="4" y="20" width="16" height="0" fill="#fff">
            <animate fill="freeze" attributeName="y" begin="0.5s" dur="0.7s" values="20;9" calcMode="spline" keySplines="0.3 0 0.2 1" />
            <animate fill="freeze" attributeName="height" begin="0.5s" dur="0.7s" values="0;11" calcMode="spline" keySplines="0.3 0 0.2 1" />
          </rect>
        </mask>
      </defs>
      {/* ของที่เติม (โปร่งแสง) เผยผ่าน mask */}
      <path d={body} fill="currentColor" opacity="0.25" mask={`url(#${m})`} />
      {/* โครงกล่อง + ฝา วาดเข้า */}
      <g {...strokeProps}>
        <path strokeDasharray="48" strokeDashoffset="48" d={body}><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.5s" values="48;0" /></path>
        <path strokeDasharray="36" strokeDashoffset="36" d="M3.5 4.5h17v3.5h-17Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="36;0" /></path>
        <path strokeDasharray="4" strokeDashoffset="4" d="M10 12h4"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" values="4;0" /></path>
      </g>
    </svg>
  );
}

/** ลูกศรโอนย้าย — สองลูกศรวาดเข้าสลับทิศ */
export function AnimatedTransfer({ size = 24, ...props }: IconProps) {
  return (
    <svg {...svg(size)} {...strokeProps} {...props}>
      <path strokeDasharray="14" strokeDashoffset="14" d="M4 8h16"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="14;0" /></path>
      <path strokeDasharray="9" strokeDashoffset="9" d="M17 5l3 3l-3 3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.3s" dur="0.2s" values="9;0" /></path>
      <path strokeDasharray="14" strokeDashoffset="14" d="M20 16H4"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.3s" values="14;0" /></path>
      <path strokeDasharray="9" strokeDashoffset="9" d="M7 13l-3 3l3 3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.8s" dur="0.2s" values="9;0" /></path>
    </svg>
  );
}

/** เช็กถูก — วงกลม + เครื่องหมายถูกวาดเข้า (ยืนยันสำเร็จ) */
export function AnimatedCheck({ size = 24, ...props }: IconProps) {
  return (
    <svg {...svg(size)} {...strokeProps} {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="57" strokeDashoffset="57"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.45s" values="57;0" /></circle>
      <path strokeDasharray="12" strokeDashoffset="12" d="M8 12l3 3l5 -6"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.45s" dur="0.25s" values="12;0" /></path>
    </svg>
  );
}

/** กระดิ่งแจ้งเตือน — วาดเข้า + สั่นเป็นจังหวะ */
export function AnimatedBell({ size = 24, ...props }: IconProps) {
  return (
    <svg {...svg(size)} {...strokeProps} {...props}>
      <g style={{ transformOrigin: "12px 4px" }}>
        <path strokeDasharray="40" strokeDashoffset="40" d="M18 16v-5a6 6 0 0 0 -12 0v5l-2 3h16Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.5s" values="40;0" /></path>
        <animateTransform attributeName="transform" type="rotate" values="0 12 4;0 12 4;-10 12 4;10 12 4;-6 12 4;0 12 4" dur="1.2s" begin="0.5s" repeatCount="indefinite" keyTimes="0;0.5;0.62;0.74;0.86;1" />
      </g>
      <path strokeDasharray="6" strokeDashoffset="6" d="M10 19a2 2 0 0 0 4 0"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" values="6;0" /></path>
    </svg>
  );
}
