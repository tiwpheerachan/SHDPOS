"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

/** นาฬิกาเรียลไทม์บนแถบบน — อัปเดตทุกวินาที */
export function Clock({ compact = false }: { compact?: boolean }) {
  const { locale } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  const loc = locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US";
  const time = now.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString(loc, { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="hidden md:flex flex-col items-end leading-tight tnum select-none" title={now.toLocaleString(loc)}>
      <span className={compact ? "text-xs font-semibold" : "text-sm font-semibold"}>{time}</span>
      {!compact ? <span className="text-[10px] text-muted">{date}</span> : null}
    </div>
  );
}
