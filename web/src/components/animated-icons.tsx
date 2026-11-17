"use client";
// =====================================================================
// Animated icons (สไตล์ 21st.dev / iconify) — SVG + SMIL <animate>
//   วาดตอน mount / กวาด-ลูปต่อเนื่อง สื่อความหมาย ใช้แทน lucide ได้ตรงจุด
//   เพิ่มไอคอนใหม่จาก https://21st.dev/community/icons ได้ที่ไฟล์นี้
// =====================================================================
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor" as const, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

/** สแกน — กรอบ + เส้นเลเซอร์กวาดขึ้น-ลงต่อเนื่อง (สื่อการสแกนบาร์โค้ด) */
export function AnimatedScan({ size = 24, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="6" x2="18" y1="12" y2="12" stroke="currentColor">
        <animate attributeName="y1" values="7.5;16.5;7.5" dur="1.9s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" keyTimes="0;0.5;1" />
        <animate attributeName="y2" values="7.5;16.5;7.5" dur="1.9s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" keyTimes="0;0.5;1" />
        <animate attributeName="opacity" values="0.25;1;0.25" dur="1.9s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}

/** ลูกศรโอนย้าย — เส้นวาดเข้าตอน mount (สไตล์ตัวอย่าง 21st.dev) */
export function AnimatedTransfer({ size = 24, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <g>
        <path strokeDasharray="14" strokeDashoffset="14" d="M4 8h16"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="14;0" /></path>
        <path strokeDasharray="8" strokeDashoffset="8" d="M17 5l3 3l-3 3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.3s" dur="0.2s" values="8;0" /></path>
        <path strokeDasharray="14" strokeDashoffset="14" d="M20 16H4"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.3s" values="14;0" /></path>
        <path strokeDasharray="8" strokeDashoffset="8" d="M7 13l-3 3l3 3"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.8s" dur="0.2s" values="8;0" /></path>
      </g>
    </svg>
  );
}

/** เช็คถูก — วาดเส้นเข้า (ยืนยันสำเร็จ) */
export function AnimatedCheck({ size = 24, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="57" strokeDashoffset="57"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="57;0" /></circle>
      <path d="M8 12l3 3l5 -6" strokeDasharray="12" strokeDashoffset="12"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.25s" values="12;0" /></path>
    </svg>
  );
}

/** กล่องสต๊อก — เด้งเบาๆ ต่อเนื่อง */
export function AnimatedBox({ size = 24, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <g>
        <path d="M21 8l-9 -5l-9 5l9 5z" />
        <path d="M3 8v8l9 5l9 -5V8" />
        <path d="M12 13v8" />
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -1.4;0 0" dur="2.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" keyTimes="0;0.5;1" />
      </g>
    </svg>
  );
}
