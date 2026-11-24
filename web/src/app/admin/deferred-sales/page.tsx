import { Suspense } from "react";
import { DeferredWorkPage } from "@/components/work/deferred-page";
export default function DeferredPage() {
  return (
    <Suspense fallback={<p className="p-5 text-sm text-muted">กำลังโหลด…</p>}>
      <DeferredWorkPage />
    </Suspense>
  );
}
