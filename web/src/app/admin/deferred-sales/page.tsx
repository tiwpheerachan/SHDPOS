"use client";
import { Suspense } from "react";
import { useL } from "@/lib/i18n/provider";
import { DeferredWorkPage } from "@/components/work/deferred-page";
export default function DeferredPage() {
  const L = useL();
  return (
    <Suspense fallback={<p className="p-5 text-sm text-muted">{L("กำลังโหลด…", "Loading…", "加载中…")}</p>}>
      <DeferredWorkPage />
    </Suspense>
  );
}
