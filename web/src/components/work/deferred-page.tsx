"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DeferredSalesPanel } from "@/components/pos/deferred-sales-panel";
import { workRead } from "@/lib/work";
import { useL } from "@/lib/i18n/provider";
export function DeferredWorkPage() {
  const L = useL();
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
          <h1 className="text-2xl font-semibold mt-1">{L("บิลรอปิด", "Pending bills", "待结单据")}</h1>
          <p className="work-caption mt-1">
            {L("ตรวจข้อมูล รับงานต่อ และปิดบิลจากเงินรับเดิม", "Review, take over and close bills from prior payments", "核对信息、接手并按已收款结单")}
          </p>
        </div>
        <select
          aria-label={L("สาขาของบิลรอปิด", "Pending bill branch", "待结单据门店")}
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
