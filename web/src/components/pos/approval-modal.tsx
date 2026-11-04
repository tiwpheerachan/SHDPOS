"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Modal, Numpad, Select, Field, Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { employeesAtBranch, createApproval, writeAudit } from "@/lib/data/repo";
import { ROLE_LABEL } from "@/lib/permissions";
import type { ApprovalKind, Employee, EmployeeRole } from "@/lib/types";
import { nanoid } from "nanoid";
import { isLiveMode } from "@/lib/supabase/client";

const ROLE_RANK: Record<EmployeeRole, number> = {
  staff: 0, auditor: 0, supervisor: 1, manager: 2, brand_admin: 3, hq: 4,
};

export interface ApprovalRequestInput {
  kind: ApprovalKind;
  /** ระดับต่ำสุดที่อนุมัติได้ */
  minRole: EmployeeRole;
  branchId: string;
  requestedBy: string;
  amount?: number;
  reason?: string;
  payload?: Record<string, unknown>;
}

/**
 * กล่องขออนุมัติด้วย PIN ของหัวหน้า
 * ทุกครั้งที่อนุมัติจะถูกบันทึกลง audit log และตาราง approvals
 */
export function ApprovalModal({
  request,
  onClose,
  onApproved,
}: {
  request: ApprovalRequestInput | null;
  onClose: () => void;
  onApproved: (approver: Employee) => void;
}) {
  const { t, locale } = useI18n();
  const [candidates, setCandidates] = useState<Employee[]>([]);
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    void employeesAtBranch(request.branchId).then((list) => {
      const eligible = list.filter((e) => ROLE_RANK[e.role] >= ROLE_RANK[request.minRole] && e.id !== request.requestedBy);
      setCandidates(eligible);
      setApproverId(eligible[0]?.id ?? "");
      setPin("");
      setError(null);
    });
  }, [request]);

  async function confirm() {
    if (!request) return;
    const approver = candidates.find((c) => c.id === approverId);
    if (!approver) return;
    const ok = isLiveMode() ? pin.length >= 4 : pin === (approver.pin ?? "1234");
    if (!ok) {
      setError(t.login.wrongPin);
      setPin("");
      return;
    }
    const id = nanoid();
    await createApproval({
      id,
      kind: request.kind,
      status: "approved",
      branch_id: request.branchId,
      requested_by: request.requestedBy,
      approved_by: approver.id,
      payload: request.payload ?? {},
      requested_amount: request.amount ?? null,
      reason: request.reason ?? null,
      created_at: new Date().toISOString(),
      decided_at: new Date().toISOString(),
    });
    await writeAudit({
      action: request.kind === "discount" ? "discount" : request.kind,
      actor_id: approver.id,
      branch_id: request.branchId,
      ref_table: "approvals",
      ref_no: id,
      amount: request.amount ?? null,
      after_data: { requested_by: request.requestedBy, ...request.payload },
      is_offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    });
    onApproved(approver);
    onClose();
  }

  return (
    <Modal open={Boolean(request)} onClose={onClose} title={t.approval.title} size="sm">
      {request ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-warn/10 border border-warn/25 px-3.5 py-3">
            <ShieldCheck size={18} className="text-warn mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-ink">{t.approval.required}</p>
              {request.reason ? <p className="text-muted mt-0.5">{request.reason}</p> : null}
              <p className="text-muted mt-0.5">
                ต้องเป็นระดับ {ROLE_LABEL[request.minRole][locale]} ขึ้นไป
              </p>
            </div>
          </div>

          <Field label={t.approval.approvedBy}>
            <Select value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname ?? c.first_name} · {ROLE_LABEL[c.role][locale]}
                </option>
              ))}
            </Select>
          </Field>

          {!candidates.length ? (
            <p className="text-xs text-danger">ไม่มีผู้มีสิทธิ์อนุมัติอยู่ในสาขานี้ — ต้องติดต่อ HQ</p>
          ) : (
            <>
              <div className="flex justify-center gap-2.5 py-1">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < pin.length ? "bg-brand" : "bg-line"}`} />
                ))}
              </div>
              {error ? <p className="text-xs text-danger text-center">{error}</p> : null}
              <Numpad
                onDigit={(d) => d !== "." && setPin((p) => (p.length < 6 ? p + d : p))}
                onBackspace={() => setPin((p) => p.slice(0, -1))}
                onClear={() => setPin("")}
                onEnter={() => void confirm()}
                enterLabel={t.common.approve}
              />
              <Button variant="primary" className="w-full" disabled={pin.length < 4} onClick={() => void confirm()}>
                {t.common.approve}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
