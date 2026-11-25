"use client";
// ลูกแก้ว AI (WebGL · ogl) — ดัดแปลงจาก VoicePoweredOrb: ตัดไมโครโฟนออก (ไม่ขอสิทธิ์ไมค์)
//   ขยับตลอดเวลาแบบ "กำลังพูด": หมุน + บิดตัวเป็นจังหวะ · active=true (เช่น AI กำลังคิด) ขยับเร็ว/แรงขึ้น
//   ปิดภาพเคลื่อนไหวเมื่อผู้ใช้ตั้ง prefers-reduced-motion · WebGL ใช้ไม่ได้ = แสดงวงกลมไล่สีแทน
import React, { useEffect, useRef, type FC } from "react";
import { Renderer, Program, Mesh, Triangle, Vec3 } from "ogl";
import { cn } from "@/lib/utils";

interface VoicePoweredOrbProps {
  className?: string;
  hue?: number;
  /** ขยับแรงขึ้น (เช่นระหว่างรอผล AI) */
  active?: boolean;
  /** ความแรงของการบิดตัว 0–1 */
  intensity?: number;
}

const vert = /* glsl */ `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

const frag = /* glsl */ `
  precision highp float;
  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
  vec3 yiq2rgb(vec3 c) { return vec3(c.x + 0.956 * c.y + 0.621 * c.z, c.x - 0.272 * c.y - 0.647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z); }
  vec3 adjustHue(vec3 color, float hueDeg) {
    float h = hueDeg * 3.14159265 / 180.0; vec3 yiq = rgb2yiq(color);
    float cA = cos(h), sA = sin(h);
    float i = yiq.y * cA - yiq.z * sA; float q = yiq.y * sA + yiq.z * cA;
    yiq.y = i; yiq.z = q; return yiq2rgb(yiq);
  }
  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787)); p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
  }
  float snoise3(vec3 p) {
    const float K1 = 0.333333333; const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1); vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx); vec3 i1 = e * (1.0 - e.zxy); vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2); vec3 d2 = d0 - (i2 - K1); vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
    return dot(vec4(31.316), n);
  }
  vec4 extractAlpha(vec3 c) { float a = max(max(c.r, c.g), c.b); return vec4(c.rgb / (a + 1e-5), a); }
  const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
  const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
  const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
  const float innerRadius = 0.6;
  const float noiseScale = 0.65;
  float light1(float i, float a, float d) { return i / (1.0 + d * a); }
  float light2(float i, float a, float d) { return i / (1.0 + d * d * a); }
  vec4 draw(vec2 uv) {
    vec3 color1 = adjustHue(baseColor1, hue); vec3 color2 = adjustHue(baseColor2, hue); vec3 color3 = adjustHue(baseColor3, hue);
    float ang = atan(uv.y, uv.x); float len = length(uv); float invLen = len > 0.0 ? 1.0 / len : 0.0;
    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0); v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
    float a = iTime * -1.0; vec2 pos = vec2(cos(a), sin(a)) * r0; float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d); v1 *= light1(1.0, 50.0, d0);
    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
    vec3 col = mix(color1, color2, cl); col = mix(color3, col, v0); col = (col + v1) * v2 * v3;
    return extractAlpha(clamp(col, 0.0, 1.0));
  }
  vec4 mainImage(vec2 fragCoord) {
    vec2 center = iResolution.xy * 0.5; float size = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord - center) / size * 2.0;
    float s = sin(rot), c = cos(rot); uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
    return draw(uv);
  }
  void main() { vec4 col = mainImage(vUv * iResolution.xy); gl_FragColor = vec4(col.rgb * col.a, col.a); }
`;

export const VoicePoweredOrb: FC<VoicePoweredOrbProps> = ({ className, hue = 0, active = false, intensity = 0.7 }) => {
  const ctnDom = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: false, antialias: true, dpr: window.devicePixelRatio || 1 });
    } catch { return; } // ไม่มี WebGL → ใช้พื้นหลังไล่สีจาก CSS
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(gl.canvas);

    const program = new Program(gl, {
      vertex: vert, fragment: frag,
      uniforms: { iTime: { value: 0 }, iResolution: { value: new Vec3(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height) }, hue: { value: hue }, hover: { value: 0 }, rot: { value: 0 }, hoverIntensity: { value: 0 } },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1, w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w * dpr, h * dpr);
      gl.canvas.style.width = `${w}px`; gl.canvas.style.height = `${h}px`;
      program.uniforms.iResolution.value.set(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height);
    };
    const ro = new ResizeObserver(resize); ro.observe(container); resize();

    let raf = 0, last = 0, rot = 0, level = 0;
    const update = (t: number) => {
      raf = requestAnimationFrame(update);
      const dt = Math.min((t - last) * 0.001, 0.05); last = t;
      // "เสียงพูด" สังเคราะห์: คลื่นซ้อนหลายความถี่ ให้ดูมีชีวิตเหมือนกำลังพูด
      const boost = activeRef.current ? 1 : 0.55;
      const target = (0.45 + 0.3 * Math.sin(t * 0.0021) + 0.25 * Math.sin(t * 0.0057 + 1.3) * Math.sin(t * 0.0013)) * boost;
      level += (Math.max(0, target) - level) * 0.08;
      rot += dt * (0.3 + level * 1.2 * (activeRef.current ? 2 : 1));
      program.uniforms.iTime.value = t * 0.001 * (activeRef.current ? 1.6 : 1);
      program.uniforms.rot.value = rot;
      program.uniforms.hover.value = Math.min(level * 2, 1);
      program.uniforms.hoverIntensity.value = Math.min(level * intensity, intensity);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.render({ scene: mesh });
    };
    if (reduce) { program.uniforms.iTime.value = 1.5; renderer.render({ scene: mesh }); }
    else raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      try { if (container.contains(gl.canvas)) container.removeChild(gl.canvas); } catch { /* */ }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [hue, intensity]);

  return <div ref={ctnDom} className={cn("w-full h-full relative", className)} />;
};
