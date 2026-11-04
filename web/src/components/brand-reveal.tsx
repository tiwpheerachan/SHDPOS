"use client";

// โลโก้ระบบ SHD POS แบบ liquid glass reveal
// พื้นหลัง canvas กลืนกับสีหน้าเพจ (ไม่เห็นเป็นสี่เหลี่ยม) เหลือเฉพาะไทล์ขาวมุมมน
// เล่นครั้งเดียวตอนโหลดแล้วค้างไว้ (คลิกเพื่อเล่นซ้ำ)
import { useTheme } from "@/lib/theme";
import { GlassIconReveal } from "@/components/ui/liquid-glass-logo-reveal";

export function BrandReveal({
  className,
  tileSize = 220,
  loop = false,
  hold = 3,
}: {
  className?: string;
  tileSize?: number;
  loop?: boolean;
  hold?: number;
}) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  return (
    <GlassIconReveal
      logo="/logo.png"
      label="SHD POS"
      look="light"
      background={dark ? "#191a18" : "#ffffff"}
      plateColor="#ffffff"
      iconPlate
      keepPlate
      originalColors
      tileSize={tileSize}
      logoScale={0.6}
      finalScale={1}
      loop={loop}
      hold={hold}
      tuning={{ startZoom: 1.2, swell: 0.6, glide: 1.6 }}
      className={className}
    />
  );
}
