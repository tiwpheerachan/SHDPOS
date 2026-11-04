"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listApprovals, decideApproval, listBranches, listEmployees } from "@/lib/data/repo";
import type { ApprovalRequest, Branch, Employee } from "@/lib/types";
import { Card, CardHeader, Table, Th, Td, Badge, EmptyState, Button, Segmented } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { visibleBranchIds } from "@/lib/permissions";

export default function AdminApprovalsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { employee } = useSession();
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [view, setView] = useState<"pending" | "all">("all");

  async function reload() {
    const [a, b, e] = await Promise.all([listApprovals(), listBranches(), listEmployees()]);
    setRows(a);
    setBranches(b);
    setEmployees(e);
  }

  useEffect(() => {
    void reload();
  }, []);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const visible = useMemo(
    () => rows.filter((r) => allowed.includes(r.branch_id)).filter((r) => (view === "pending" ? r.status === "pending" : true)),
    [rows, allowed, view]
  );

  const nameOf = (id?: string | null) => {
    const e = employees.find((x) => x.id === id);
    return e ? e.nickname ?? e.first_name : "—";
  };

  async function decide(id: string, ok: boolean) {
    if (!employee) return;
    await decideApproval(id, employee.id, ok);
    await reload();
    toast.push({ tone: ok ? "ok" : "warn", title: ok ? t.approval.approved : t.approval.rejected });
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Card>
        <CardHeader
          title={t.admin.approvals}
          subtitle="ส่วนลดเกินสิทธิ์ · ยกเลิกบิล · คืนสินค้า · ปรับสต๊อก · โอนย้าย"
          right={
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "all" as const, label: t.common.all },
                { value: "pending" as const, label: t.approval.pending },
              ]}
            />
          }
        />
        {visible.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.date}</Th>
                <Th>ประเภท</Th>
                <Th>{t.common.branch}</Th>
                <Th>ผู้ขอ</Th>
                <Th>{t.approval.approvedBy}</Th>
                <Th align="right">{t.common.amount}</Th>
                <Th align="center">{t.common.status}</Th>
                <Th align="right">{t.common.action}</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const b = branches.find((x) => x.id === r.branch_id);
                return (
                  <tr key={r.id} className="hover:bg-surface2/60">
                    <Td className="text-xs text-muted">
                      {new Date(r.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Td>
                    <Td>
                      <span className="text-xs font-medium">{r.kind}</span>
                      {r.reason ? <p className="text-[10px] text-muted truncate max-w-[220px]">{r.reason}</p> : null}
                    </Td>
                    <Td className="text-xs truncate max-w-[150px]">{b ? (locale === "th" ? b.name_th ?? b.name : b.name) : "—"}</Td>
                    <Td className="text-xs">{nameOf(r.requested_by)}</Td>
                    <Td className="text-xs">{nameOf(r.approved_by)}</Td>
                    <Td align="right" className="text-xs">{r.requested_amount ? formatTHB(r.requested_amount, false) : "—"}</Td>
                    <Td align="center">
                      <Badge tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "danger" : "warn"}>
                        {r.status === "approved" ? t.approval.approved : r.status === "rejected" ? t.approval.rejected : t.approval.pending}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {r.status === "pending" ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => void decide(r.id, true)} className="p-1.5 rounded-lg hover:bg-ok/10 text-ok">
                            <Check size={14} />
                          </button>
                          <button onClick={() => void decide(r.id, false)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger">
                            <X size={14} />
                          </button>
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<ShieldCheck size={26} />} title={t.common.empty} body="คำขออนุมัติจากหน้าร้านจะมาแสดงที่นี่" />
        )}
      </Card>
    </div>
  );
}
