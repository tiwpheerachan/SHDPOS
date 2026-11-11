"use client";

import { useEffect, useState } from "react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme";
import { ToastHost } from "@/components/toast-host";
import { bootstrap } from "@/lib/data/repo";
import { startSyncWorker } from "@/lib/offline/sync";
import { AiLoader } from "@/components/ui/ai-loader";
import { CommandPalette } from "@/components/command-palette";

// แยกออกมาเป็นคอมโพเนนต์ลูกเพื่อให้เรียก useI18n ได้ (อยู่ภายใน I18nProvider แล้ว)
function BootGate({ ready, error, children }: { ready: boolean; error: string | null; children: React.ReactNode }) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  return (
    <>
      {ready ? (
        children
      ) : (
        <AiLoader text={L("กำลังเตรียมข้อมูล", "Preparing data", "正在准备数据")} />
      )}
      {error ? (
        <div className="fixed bottom-4 left-4 z-[70] text-xs text-danger bg-surface border border-danger/30 rounded-xl px-3 py-2">
          {L("เตรียมข้อมูลไม่สำเร็จ", "Failed to prepare data", "数据准备失败")}: {error}
        </div>
      ) : null}
      {ready ? <CommandPalette /> : null}
    </>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    bootstrap()
      .then(() => {
        if (!alive) return;
        startSyncWorker();
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ThemeProvider>
      <I18nProvider>
        <BootGate ready={ready} error={error}>{children}</BootGate>
        <ToastHost />
      </I18nProvider>
    </ThemeProvider>
  );
}
