"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Store, LayoutDashboard, Monitor } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import { BrandReveal } from "@/components/brand-reveal";
import { GlobeWeather } from "@/components/ui/cobe-globe-weather";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";
import DotGrid from "@/components/ui/dot-grid";
import { GLSLHills } from "@/components/ui/glsl-hills";

export default function Home() {
  const { t } = useI18n();
  const { resolved } = useTheme();

  // รีเฟรชเอฟเฟคโลโก้ + ข้อความทุก 5 วินาที (remount ข้อความให้เล่นใหม่)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="relative min-h-screen flex flex-col overflow-hidden">
      <style>{`
        @keyframes shd-wave {
          0%,60%,100% { transform: rotate(0deg); }
          10% { transform: rotate(14deg); }
          20% { transform: rotate(-8deg); }
          30% { transform: rotate(14deg); }
          40% { transform: rotate(-4deg); }
          50% { transform: rotate(10deg); }
        }
        .shd-wave { display:inline-block; transform-origin:70% 70%; animation: shd-wave 2.5s ease-in-out infinite; }
      `}</style>

      {/* พื้นหลังลายจุด */}
      <DotGrid theme={resolved} />
      {/* พื้นหลังเนินคลื่นเคลื่อนไหว ผสมกับลายจุด */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-50">
        <GLSLHills className="w-full h-full" speed={0.4} />
      </div>
      {/* ลูกโลกมุมล่างขวา */}
      <div className="absolute -bottom-24 -right-20 sm:-bottom-28 sm:-right-16 z-0">
        <GlobeWeather className="w-[min(76vw,440px)]" />
      </div>
      {/* ไล่เฉดบางๆ ช่วยให้ข้อความอ่านง่าย */}
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-bg/90 via-bg/55 to-transparent" />

      {/* แถบบน: โลโก้ liquid glass มุมซ้าย (รีเฟรชทุก 5 วินาที) */}
      <header className="relative z-20 flex items-center gap-2.5 px-5 sm:px-6 h-16">
        <BrandReveal className="w-9 h-9 rounded-xl" tileSize={72} loop hold={1} />
        <span className="text-[15px] font-semibold tracking-tight">SHD POS</span>
      </header>

      {/* เนื้อหาอยู่กึ่งกลางเสมอ ข้อความชิดซ้าย */}
      <div className="relative z-10 flex-1 grid place-items-center px-6 pb-16">
        <div className="w-full max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight flex items-center gap-2 text-coral">
            <VerticalCutReveal
              key={tick}
              splitBy="characters"
              staggerDuration={0.035}
              staggerFrom="first"
              transition={{ type: "spring", stiffness: 200, damping: 21 }}
            >
              ยินดีต้อนรับ
            </VerticalCutReveal>
            <span className="shd-wave text-3xl sm:text-4xl">👋</span>
          </h1>
          <p className="text-sm text-muted mt-2">ระบบขายหน้าร้านหลายสาขา · หลายแบรนด์ · ออฟไลน์ได้</p>

          <div className="grid sm:grid-cols-3 gap-4 mt-7">
            <Link href="/pos" className="card p-5 hover:border-brand transition-colors group">
              <Store className="text-brand mb-3" size={22} />
              <p className="font-semibold text-sm">{t.app.pos}</p>
              <p className="text-xs text-muted mt-1">ขายสินค้า เปิดกะ รับคืน พิมพ์สลิป</p>
            </Link>
            <Link href="/admin" className="card p-5 hover:border-brand transition-colors">
              <LayoutDashboard className="text-brand mb-3" size={22} />
              <p className="font-semibold text-sm">{t.app.admin}</p>
              <p className="text-xs text-muted mt-1">แดชบอร์ด สต๊อก พนักงาน สิทธิ์ audit</p>
            </Link>
            <Link href="/pos/display" className="card p-5 hover:border-brand transition-colors">
              <Monitor className="text-brand mb-3" size={22} />
              <p className="font-semibold text-sm">{t.settings.customerDisplay}</p>
              <p className="text-xs text-muted mt-1">จอฝั่งลูกค้า (เปิดบนจอที่สอง)</p>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
