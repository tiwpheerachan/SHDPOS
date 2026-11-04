"use client";

// ตราธนาคารสไตล์ไอคอนแอป
// 1) มีโลโก้เต็มสี (logoColor) -> วางบนไทล์ขาวนวล เหมือนไอคอนแอป
// 2) มีแต่โลโก้ขาว (logo, omise) -> วางบนไทล์ไล่เฉดสีประจำธนาคาร
// 3) ไม่มีโลโก้ -> ตัวอักษรย่อบนสีประจำธนาคาร
import { useState } from "react";
import { bankByName, type BankInfo } from "@/lib/banks";

// ปรับความสว่างของสี hex (amt > 0 สว่างขึ้น, < 0 มืดลง)
function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function BankMark({
  bank,
  size = 36,
  className = "",
}: {
  bank?: string | BankInfo | null;
  size?: number;
  className?: string;
}) {
  const info: BankInfo = typeof bank === "object" && bank ? bank : bankByName(bank as string);
  const [failed, setFailed] = useState(false);

  // โหมด 1: โลโก้เต็มสีบนวงกลมขาว (circle style)
  if (info.logoColor && !failed) {
    return (
      <span
        className={`relative inline-grid place-items-center shrink-0 overflow-hidden rounded-full ${className}`}
        style={{
          width: size,
          height: size,
          background: "#ffffff",
          boxShadow: "0 1px 2px rgba(0,0,0,.14), inset 0 0 0 1px rgba(0,0,0,.06)",
        }}
        title={info.th}
        aria-label={info.th}
      >
        <img
          src={info.logoColor}
          alt={info.th}
          onError={() => setFailed(true)}
          style={{ width: size * 0.86, height: size * 0.86, objectFit: "contain" }}
        />
      </span>
    );
  }

  const ink = info.ink ?? "#ffffff";
  const fs = info.en.length >= 4 ? size * 0.3 : info.en.length === 3 ? size * 0.36 : size * 0.44;
  const showLogo = Boolean(info.logo) && !failed;

  // โหมด 2/3: วงกลมไล่เฉดสีประจำธนาคาร + โลโก้ขาว หรือ ตัวอักษรย่อ
  return (
    <span
      className={`relative inline-grid place-items-center shrink-0 overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        color: ink,
        background: `linear-gradient(150deg, ${shade(info.color, 30)} 0%, ${info.color} 52%, ${shade(info.color, -26)} 100%)`,
        boxShadow: `0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.28), inset 0 0 0 1px rgba(0,0,0,.04)`,
      }}
      title={info.th}
      aria-label={info.th}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: "55%", background: "linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,0))" }}
      />
      {showLogo ? (
        <img
          src={info.logo}
          alt={info.th}
          onError={() => setFailed(true)}
          className="relative"
          style={{ width: size * 0.74, height: size * 0.74, objectFit: "contain" }}
        />
      ) : (
        <span className="relative" style={{ fontSize: fs, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1 }}>
          {info.en}
        </span>
      )}
    </span>
  );
}
