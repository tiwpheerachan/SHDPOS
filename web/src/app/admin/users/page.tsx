"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { Users, Plus, Check, ShieldCheck, Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listEmployees, listBranches, listBrands, writeAudit } from "@/lib/data/repo";
import { db } from "@/lib/offline/db";
import type { Branch, Brand, DataScope, Employee, EmployeeRole } from "@/lib/types";
import { Button, Card, CardHeader, Input, Field, Select, Table, Th, Td, Badge, Modal, Segmented, EmptyState } from "@/components/ui";
import { ROLE_LABEL, ROLE_MATRIX, PERMISSION_KEYS, can, type PermissionKey } from "@/lib/permissions";

const ROLES: EmployeeRole[] = ["staff", "supervisor", "manager", "brand_admin", "hq", "auditor"];
const SCOPES: DataScope[] = ["own", "branch", "brand", "company"];

const PERM_LABEL: Record<string, string> = {
  "pos.sell": "ขายสินค้า", "pos.discount": "ให้ส่วนลด", "pos.price_override": "แก้ราคา",
  "pos.void": "ยกเลิกบิล", "pos.reprint": "พิมพ์ซ้ำ", "pos.open_drawer": "เปิดลิ้นชัก",
  "pos.quotation": "ใบเสนอราคา", "return.create": "รับคืนสินค้า", "return.approve": "อนุมัติคืน",
  "inventory.view": "ดูสต๊อก", "inventory.adjust": "ปรับสต๊อก", "inventory.count": "นับสต๊อก",
  "transfer.request": "ขอโอนย้าย", "transfer.approve": "อนุมัติโอน", "transfer.receive": "รับของโอน",
  "shift.open": "เปิดกะ", "shift.close": "ปิดกะ", "shift.force_close": "ปิดกะแทน", "cash.adjust": "ปรับเงินสด",
  "report.employee_perf": "ดู performance", "report.cost": "ดูต้นทุน", "report.gross_profit": "ดูกำไร",
  "admin.employee_manage": "จัดการพนักงาน", "admin.permission_manage": "กำหนดสิทธิ์",
  "admin.product_manage": "จัดการสินค้า", "admin.branch_manage": "จัดการสาขา",
  "admin.settings": "ตั้งค่าระบบ", "audit.view": "ดู audit log",
  "customer.manage": "จัดการลูกค้า", "tax.issue_full": "ออกใบกำกับเต็มรูป",
};

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { employee: me } = useSession();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tab, setTab] = useState<"people" | "matrix">("people");
  const [edit, setEdit] = useState<Employee | null>(null);

  async function reload() {
    const [e, b, br] = await Promise.all([listEmployees(), listBranches(), listBrands()]);
    setEmployees(e);
    setBranches(b);
    setBrands(br);
  }

  useEffect(() => {
    void reload();
  }, []);

  function blank(): Employee {
    return {
      id: nanoid(),
      employee_code: `EMP-${String(employees.length + 1).padStart(4, "0")}`,
      first_name: "",
      last_name: null,
      nickname: "",
      role: "staff",
      data_scope: "own",
      home_branch_id: branches[0]?.id ?? null,
      branch_ids: branches[0] ? [branches[0].id] : [],
      brand_ids: [],
      max_discount_percent: 5,
      can_open_drawer: false,
      status: "active",
      pin: "1234",
    };
  }

  async function save() {
    if (!edit || !me) return;
    await db().employees.put(edit);
    await writeAudit({
      action: "user_permission",
      actor_id: me.id,
      branch_id: edit.home_branch_id,
      ref_table: "employees",
      ref_no: edit.employee_code,
      amount: null,
      after_data: { role: edit.role, scope: edit.data_scope, branches: edit.branch_ids.length, brands: edit.brand_ids.length },
      is_offline: false,
    });
    setEdit(null);
    await reload();
    toast.push({ tone: "ok", title: t.common.save, body: edit.employee_code });
  }

  const canManage = can(me, "admin.employee_manage");

  const rows = useMemo(
    () => employees.slice().sort((a, b) => a.employee_code.localeCompare(b.employee_code)),
    [employees]
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "people" as const, label: t.admin.employees },
            { value: "matrix" as const, label: t.admin.permissions },
          ]}
        />
        {canManage && tab === "people" ? (
          <Button variant="primary" className="ml-auto h-9" onClick={() => setEdit(blank())}>
            <Plus size={15} /> {t.admin.addEmployee}
          </Button>
        ) : null}
      </div>

      {tab === "people" ? (
        <Card>
          <CardHeader title={t.admin.users} subtitle="กำหนดตำแหน่ง ขอบเขตข้อมูล สาขา และแบรนด์ที่เห็นได้" />
          {rows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t.admin.employeeCode}</Th>
                  <Th>{t.common.employee}</Th>
                  <Th>{t.admin.role}</Th>
                  <Th>{t.admin.dataAccess}</Th>
                  <Th align="center">{t.common.branch}</Th>
                  <Th align="center">{t.common.brand}</Th>
                  <Th align="right">ส่วนลดสูงสุด</Th>
                  <Th align="center">{t.common.status}</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-surface2/60">
                    <Td className="font-mono text-[11px] text-muted">{e.employee_code}</Td>
                    <Td className="text-xs font-medium">{e.nickname || e.first_name}</Td>
                    <Td><Badge tone="brand">{ROLE_LABEL[e.role][locale]}</Badge></Td>
                    <Td className="text-xs text-muted">{e.data_scope}</Td>
                    <Td align="center" className="text-xs">{e.branch_ids.length || (e.home_branch_id ? 1 : 0)}</Td>
                    <Td align="center" className="text-xs">{e.brand_ids.length || "—"}</Td>
                    <Td align="right" className="text-xs tnum">{e.max_discount_percent}%</Td>
                    <Td align="center">
                      <Badge tone={e.status === "active" ? "ok" : "danger"}>{e.status}</Badge>
                    </Td>
                    <Td align="right">
                      {canManage ? (
                        <button onClick={() => setEdit(e)} className="p-1.5 rounded-lg hover:bg-surface2 text-muted">
                          <Pencil size={14} />
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<Users size={26} />} title={t.common.empty} />
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={t.admin.permissions}
            subtitle="✓ = ทำได้ · A = ต้องขออนุมัติ · — = ไม่มีสิทธิ์ (บังคับจริงที่ Supabase RLS)"
            right={<Badge tone="info"><ShieldCheck size={10} /> RLS enforced</Badge>}
          />
          <Table>
            <thead>
              <tr>
                <Th>ฟังก์ชัน</Th>
                {ROLES.map((r) => (
                  <Th key={r} align="center">{ROLE_LABEL[r][locale]}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_KEYS.map((k) => (
                <tr key={k} className="hover:bg-surface2/60">
                  <Td>
                    <p className="text-xs font-medium">{PERM_LABEL[k] ?? k}</p>
                    <p className="text-[10px] font-mono text-muted">{k}</p>
                  </Td>
                  {ROLES.map((r) => {
                    const rule = ROLE_MATRIX[r][k as PermissionKey];
                    return (
                      <Td key={r} align="center">
                        {!rule || rule.effect === "deny" ? (
                          <span className="text-muted">—</span>
                        ) : rule.effect === "approval" ? (
                          <span className="text-warn font-semibold text-xs">A</span>
                        ) : (
                          <span className="text-ok">
                            <Check size={14} className="inline" />
                            {rule.limit != null && k === "pos.discount" ? (
                              <span className="text-[10px] ml-0.5 tnum">{rule.limit}%</span>
                            ) : null}
                          </span>
                        )}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* แก้ไขพนักงาน */}
      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={t.admin.addEmployee}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>{t.common.cancel}</Button>
            <Button variant="primary" disabled={!edit?.first_name} onClick={() => void save()}>{t.common.save}</Button>
          </>
        }
      >
        {edit ? (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label={t.admin.employeeCode}>
                <Input value={edit.employee_code} onChange={(e) => setEdit({ ...edit, employee_code: e.target.value })} />
              </Field>
              <Field label={t.common.employee}>
                <Input value={edit.first_name} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} />
              </Field>
              <Field label="ชื่อเล่น (ใช้ในรายงาน)">
                <Input value={edit.nickname ?? ""} onChange={(e) => setEdit({ ...edit, nickname: e.target.value })} />
              </Field>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <Field label={t.admin.role}>
                <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as EmployeeRole })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r][locale]}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t.admin.dataAccess} hint="own = เห็นเฉพาะของตัวเอง · branch = ทั้งสาขา · brand = ทั้งแบรนด์ · company = ทั้งบริษัท">
                <Select value={edit.data_scope} onChange={(e) => setEdit({ ...edit, data_scope: e.target.value as DataScope })}>
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="ส่วนลดสูงสุด (%)">
                <Input
                  value={edit.max_discount_percent}
                  inputMode="decimal"
                  onChange={(e) => setEdit({ ...edit, max_discount_percent: Number(e.target.value.replace(/[^\d.]/g, "") || 0) })}
                  className="text-right tnum"
                />
              </Field>
            </div>

            <div>
              <p className="label">{t.common.brand}</p>
              <div className="flex flex-wrap gap-2">
                {brands.map((b) => {
                  const on = edit.brand_ids.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() =>
                        setEdit({ ...edit, brand_ids: on ? edit.brand_ids.filter((x) => x !== b.id) : [...edit.brand_ids, b.id] })
                      }
                      className={`chip ${on ? "border-brand text-brand bg-brand/8" : ""}`}
                    >
                      {on ? <Check size={11} /> : null}
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="label">{t.common.branch}</p>
              <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
                {branches.map((b) => {
                  const on = edit.branch_ids.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() =>
                        setEdit({ ...edit, branch_ids: on ? edit.branch_ids.filter((x) => x !== b.id) : [...edit.branch_ids, b.id] })
                      }
                      className={`flex items-center gap-2 text-left rounded-lg border px-3 py-2 text-xs ${
                        on ? "border-brand bg-brand/6 text-brand" : "border-line hover:bg-surface2"
                      }`}
                    >
                      <span className={`w-4 h-4 rounded border grid place-items-center ${on ? "bg-brand border-brand text-brandInk" : "border-line"}`}>
                        {on ? <Check size={11} /> : null}
                      </span>
                      <span className="truncate">{locale === "th" ? b.name_th ?? b.name : b.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={edit.can_open_drawer}
                onChange={(e) => setEdit({ ...edit, can_open_drawer: e.target.checked })}
                className="w-4 h-4 accent-[rgb(var(--c-brand))]"
              />
              {t.pos.openDrawer}
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
