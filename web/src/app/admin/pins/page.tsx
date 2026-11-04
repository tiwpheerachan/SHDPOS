"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Eye, EyeOff, Pencil, Building2, ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches } from "@/lib/data/repo";
import type { Branch, EmployeeRole } from "@/lib/types";
import { ROLE_LABEL, can } from "@/lib/permissions";
import { Button, Card, Input, Field, Select, Table, Th, Td, Badge, Modal, EmptyState } from "@/components/ui";

interface PinEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
  nickname?: string | null;
  role: EmployeeRole;
  home_branch_id: string | null;
  branch_ids: string[];
  status: string;
  pin: string | null;
}

export default function AdminPinsPage() {
  const { employee: me } = useSession();
  const toast = useToast();
  const allowed = can(me, "admin.employee_manage");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("all");
  const [employees, setEmployees] = useState<PinEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [reveal, setReveal] = useState(false);

  const [edit, setEdit] = useState<PinEmployee | null>(null);
  const [newPin, setNewPin] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/pins", { cache: "no-store" });
      if (r.status === 403) { setForbidden(true); setEmployees([]); return; }
      if (r.ok) { setForbidden(false); setEmployees((await r.json()).employees ?? []); }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    void load();
    void listBranches().then((b) => setBranches(b.filter((x) => x.branch_type !== "warehouse")));
  }, [allowed]);

  const shown = useMemo(() => {
    const list = employees.filter((e) => e.status === "active");
    if (branchId === "all") return list;
    return list.filter((e) => e.home_branch_id === branchId || e.branch_ids.includes(branchId));
  }, [employees, branchId]);

  const branchName = (id: string | null) =>
    !id ? "—" : branches.find((b) => b.id === id)?.name_th ?? branches.find((b) => b.id === id)?.name ?? "—";

  async function savePin() {
    if (!edit) return;
    if (!/^\d{4,6}$/.test(newPin)) { toast.push({ tone: "warn", title: "PIN ต้องเป็นตัวเลข 4-6 หลัก" }); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: edit.id, pin: newPin }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast.push({ tone: "danger", title: "ตั้ง PIN ไม่สำเร็จ", body: e.error });
        return;
      }
      toast.push({ tone: "ok", title: `ตั้ง PIN ของ ${edit.nickname ?? edit.first_name} แล้ว` });
      setEdit(null); setNewPin("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 w-full">
        <EmptyState icon={<ShieldAlert size={28} />} title="ไม่มีสิทธิ์เข้าหน้านี้" body="ต้องมีสิทธิ์ 'จัดการพนักงาน' จึงจะดู/ตั้ง PIN ได้" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound size={18} className="text-muted" /> รหัส PIN พนักงาน
        </h1>
        <p className="text-xs text-muted mt-1">ดู/ตั้งรหัส PIN สำหรับล็อกอินหน้าขาย แยกตามสาขา</p>
      </div>

      {forbidden ? (
        <Card className="p-4">
          <p className="text-sm text-warn flex items-center gap-2">
            <ShieldAlert size={16} /> ต้องล็อกอินด้วยบัญชีกลาง (SSO) จึงจะจัดการ PIN ได้ (ระบบตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ผ่าน SSO)
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="pl-9 w-56">
                <option value="all">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>
                ))}
              </Select>
            </div>
            <button
              onClick={() => setReveal((v) => !v)}
              className="flex items-center gap-1.5 h-10 px-3 rounded-xl border border-line text-sm text-muted hover:text-ink hover:bg-surface2 transition-colors"
            >
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />} {reveal ? "ซ่อน PIN" : "แสดง PIN"}
            </button>
            <span className="text-xs text-muted ml-auto">{shown.length} คน</span>
          </Card>

          <Card className="p-0 overflow-hidden">
            {loading ? (
              <p className="text-sm text-muted p-6 text-center">กำลังโหลด…</p>
            ) : shown.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>พนักงาน</Th>
                    <Th>รหัสพนักงาน</Th>
                    <Th>บทบาท</Th>
                    <Th>สาขาหลัก</Th>
                    <Th align="center">PIN</Th>
                    <Th align="right">จัดการ</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-surface2 grid place-items-center text-xs font-semibold shrink-0">
                            {(e.nickname ?? e.first_name).slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium">{e.nickname ?? e.first_name} {e.last_name ?? ""}</span>
                        </div>
                      </Td>
                      <Td><span className="tnum text-xs text-muted">{e.employee_code}</span></Td>
                      <Td>{ROLE_LABEL[e.role]?.th ?? e.role}</Td>
                      <Td>{branchName(e.home_branch_id)}</Td>
                      <Td align="center">
                        <span className="tnum font-semibold tracking-widest">
                          {e.pin ? (reveal ? e.pin : "••••") : "—"}
                        </span>
                      </Td>
                      <Td align="right">
                        <button
                          onClick={() => { setEdit(e); setNewPin(""); }}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:bg-surface2 transition-colors"
                        >
                          <Pencil size={13} /> ตั้ง PIN
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon={<KeyRound size={26} />} title="ไม่มีพนักงานในสาขานี้" />
            )}
          </Card>
        </>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        size="sm"
        title={edit ? `ตั้ง PIN · ${edit.nickname ?? edit.first_name}` : ""}
        footer={
          edit ? (
            <div className="flex justify-end gap-2 w-full">
              <Button variant="ghost" onClick={() => setEdit(null)}>ยกเลิก</Button>
              <Button variant="primary" disabled={saving} onClick={() => void savePin()}>{saving ? "กำลังบันทึก…" : "บันทึก PIN"}</Button>
            </div>
          ) : null
        }
      >
        {edit ? (
          <div className="space-y-3">
            <Field label="PIN ใหม่ (ตัวเลข 4-6 หลัก)">
              <Input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="เช่น 1234"
                className="tracking-widest text-center text-lg"
              />
            </Field>
            <p className="text-[11px] text-muted">พนักงานจะใช้ PIN นี้ล็อกอินหน้าขายด้วยรหัสพนักงาน {edit.employee_code}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
