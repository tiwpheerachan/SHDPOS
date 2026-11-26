import { Suspense } from "react";
import { WorkWorkspace, WorkLoading } from "@/components/work/workspace";
export default function WorkPage() {
  return (
    <Suspense
      fallback={<WorkLoading />}
    >
      <WorkWorkspace admin={true} />
    </Suspense>
  );
}
