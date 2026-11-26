"use client";
import { Suspense } from "react";
import { useL } from "@/lib/i18n/provider";
import { WorkWorkspace } from "@/components/work/workspace";
export default function WorkPage() {
  const L = useL();
  return (
    <Suspense
      fallback={
        <p className="p-6 text-sm text-muted">{L("กำลังเตรียมพื้นที่ทำงาน…", "Preparing workspace…", "正在准备工作区…")}</p>
      }
    >
      <WorkWorkspace admin={false} />
    </Suspense>
  );
}
