"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DeferredSalesPanel } from "@/components/pos/deferred-sales-panel";
import { workRead } from "@/lib/work";
export function DeferredWorkPage() {
  const sp = useSearchParams(),
    [branches, setBranches] = useState<any[]>([]),
    [branch, setBranch] = useState(sp.get("branch_id") ?? ""),
    [error, setError] = useState("");
  useEffect(() => {
    void workRead()
      .then((j) => {
        setBranches(j.branches);
        if (!branch) setBranch(j.branches[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="work-surface p-4 sm:p-6 space-y-5">
      <header className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <p className="work-caption uppercase tracking-wider">
            SHD OPERATIONS
          </p>
          <h1 className="text-2xl font-semibold mt-1">บิลรอปิด</h1>
          <p className="work-caption mt-1">
            ตรวจข้อมูล รับงานต่อ และปิดบิลจากเงินรับเดิม
          </p>
        </div>
        <select
          aria-label="สาขาของบิลรอปิด"
          className="work-field !w-52"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name_th || b.name}
            </option>
          ))}
        </select>
      </header>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {branch ? (
        <DeferredSalesPanel
          key={branch}
          branchId={branch}
          focusId={sp.get("deferred") ?? undefined}
        />
      ) : null}
    </div>
  );
}
