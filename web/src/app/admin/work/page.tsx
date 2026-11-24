import { Suspense } from "react";
import { WorkWorkspace } from "@/components/work/workspace";
export default function WorkPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6 text-sm text-muted">กำลังเตรียมพื้นที่ทำงาน…</p>
      }
    >
      <WorkWorkspace admin={true} />
    </Suspense>
  );
}
