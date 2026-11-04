"use client";

// กรอบ liquid metal (shader @paper-design) ล้อมเนื้อหา โดยด้านในเป็นพื้นขาว
// ถ้า shader โหลดไม่ได้ จะ fallback เป็นไล่เฉดโลหะด้วย CSS ให้ยังเห็นกรอบ
import { useEffect, useRef } from "react";
import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";

export function LiquidMetalFrame({
  children,
  radius = 20,
  frame = 4,
  className = "",
}: {
  children: React.ReactNode;
  radius?: number;
  frame?: number;
  className?: string;
}) {
  const shaderRef = useRef<HTMLDivElement>(null);
  // ไลบรารีภายนอกไม่มี types
  const mountRef = useRef<{ destroy?: () => void } | null>(null);

  useEffect(() => {
    const styleId = "lm-frame-canvas-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `.lm-frame-shader canvas{width:100%!important;height:100%!important;display:block!important;position:absolute!important;top:0!important;left:0!important;}`;
      document.head.appendChild(style);
    }
    if (!shaderRef.current) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mountRef.current = new (ShaderMount as any)(
        shaderRef.current,
        liquidMetalFragmentShader,
        {
          u_repetition: 4, u_softness: 0.5, u_shiftRed: 0.3, u_shiftBlue: 0.3,
          u_distortion: 0, u_contour: 0, u_angle: 45, u_scale: 8, u_shape: 1,
          u_offsetX: 0.1, u_offsetY: -0.1,
        },
        undefined,
        0.6,
      );
    } catch (err) {
      console.error("LiquidMetalFrame shader failed:", err);
    }
    return () => {
      mountRef.current?.destroy?.();
      mountRef.current = null;
    };
  }, []);

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        borderRadius: radius,
        padding: frame,
        // fallback โลหะ ถ้า shader ไม่ขึ้น
        background: "linear-gradient(145deg,#f4f4f5 0%,#b9bcc4 28%,#6b7079 52%,#c7cad1 74%,#8a8f98 100%)",
      }}
    >
      <div ref={shaderRef} className="lm-frame-shader absolute inset-0" style={{ borderRadius: radius }} />
      <div
        className="relative"
        style={{ borderRadius: Math.max(radius - frame, 4), background: "#ffffff", overflow: "hidden", width: "100%", height: "100%" }}
      >
        {children}
      </div>
    </div>
  );
}
