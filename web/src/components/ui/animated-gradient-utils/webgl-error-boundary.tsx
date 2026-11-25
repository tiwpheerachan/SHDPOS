"use client";
// ตัวกันพังของพื้นหลัง WebGL — เครื่องที่ไม่รองรับ webgl2 / shader คอมไพล์ไม่ผ่าน จะเห็นไล่สีแบบ CSS แทน
import { Component, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function WebGLFallback({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden
      style={{ background: "radial-gradient(120% 140% at 85% 0%, #9b7bff 0%, transparent 55%), radial-gradient(90% 120% at 0% 100%, #3a2470 0%, transparent 60%), linear-gradient(135deg, #140b2e 0%, #24164d 100%)" }} />
  );
}

export class WebGLErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* แสดง fallback เงียบ ๆ */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
