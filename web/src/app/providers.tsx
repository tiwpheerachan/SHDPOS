"use client";

import { useEffect, useState } from "react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme";
import { ToastHost } from "@/components/toast-host";
import { bootstrap } from "@/lib/data/repo";
import { startSyncWorker } from "@/lib/offline/sync";
import { Spinner } from "@/components/ui";
import { CommandPalette } from "@/components/command-palette";

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
        {ready ? (
          children
        ) : (
          <div className="min-h-screen grid place-items-center">
            <div className="flex items-center gap-3 text-sm text-muted">
              <Spinner />
              กำลังเตรียมข้อมูล...
            </div>
          </div>
        )}
        {error ? (
          <div className="fixed bottom-4 left-4 z-[70] text-xs text-danger bg-surface border border-danger/30 rounded-xl px-3 py-2">
            เตรียมข้อมูลไม่สำเร็จ: {error}
          </div>
        ) : null}
        {ready ? <CommandPalette /> : null}
        <ToastHost />
      </I18nProvider>
    </ThemeProvider>
  );
}
