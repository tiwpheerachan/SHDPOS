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

const ROLES: EmployeeRole[] = ["staff", "supervisor", "manager", "brand_admin", "hq", "auditor", "owner"];
const SCOPES: DataScope[] = ["own", "branch", "brand", "company"];

// NOTE: th/en/zh labels rendered via L() at point of use (locale not available at module scope)
const PERM_LABEL: Record<string, { th: string; en: string; zh: string }> = {
  "pos.sell": { th: "ขายสินค้า", en: "Sell", zh: "销售" },
  "pos.discount": { th: "ให้ส่วนลด", en: "Give discount", zh: "折扣" },
  "pos.price_override": { th: "แก้ราคา", en: "Override price", zh: "改价" },
  "pos.void": { th: "ยกเลิกบิล", en: "Void bill", zh: "作废单据" },
  "pos.reprint": { th: "พิมพ์ซ้ำ", en: "Reprint", zh: "重新打印" },
  "pos.open_drawer": { th: "เปิดลิ้นชัก", en: "Open drawer", zh: "打开钱箱" },
  "pos.quotation": { th: "ใบเสนอราคา", en: "Quotation", zh: "报价单" },
  "return.create": { th: "รับคืนสินค้า", en: "Accept return", zh: "受理退货" },
  "return.approve": { th: "อนุมัติคืน", en: "Approve return", zh: "审批退货" },
  "inventory.view": { th: "ดูสต๊อก", en: "View stock", zh: "查看库存" },
  "inventory.adjust": { th: "ปรับสต๊อก", en: "Adjust stock", zh: "库存调整" },
  "inventory.count": { th: "นับสต๊อก", en: "Count stock", zh: "盘点" },
  "transfer.request": { th: "ขอโอนย้าย", en: "Request transfer", zh: "申请调货" },
  "transfer.approve": { th: "อนุมัติโอน", en: "Approve transfer", zh: "审批调货" },
  "transfer.receive": { th: "รับของโอน", en: "Receive transfer", zh: "接收调货" },
  "shift.open": { th: "เปิดกะ", en: "Open shift", zh: "开班" },
  "shift.close": { th: "ปิดกะ", en: "Close shift", zh: "交班" },
  "shift.force_close": { th: "ปิดกะแทน", en: "Force close shift", zh: "强制交班" },
  "cash.adjust": { th: "ปรับเงินสด", en: "Adjust cash", zh: "现金调整" },
  "report.employee_perf": { th: "ดู performance", en: "View performance", zh: "查看绩效" },
  "report.cost": { th: "ดูต้นทุน", en: "View cost", zh: "查看成本" },
  "report.gross_profit": { th: "ดูกำไร", en: "View profit", zh: "查看利润" },
  "admin.employee_manage": { th: "จัดการพนักงาน", en: "Manage employees", zh: "管理员工" },
  "admin.permission_manage": { th: "กำหนดสิทธิ์", en: "Manage permissions", zh: "权限管理" },
  "admin.product_manage": { th: "จัดการสินค้า", en: "Manage products", zh: "管理商品" },
  "admin.branch_manage": { th: "จัดการสาขา", en: "Manage branches", zh: "管理门店" },
  "admin.settings": { th: "ตั้งค่าระบบ", en: "System settings", zh: "系统设置" },
  "audit.view": { th: "ดู audit log", en: "View audit log", zh: "查看审计日志" },
  "customer.manage": { th: "จัดการลูกค้า", en: "Manage customers", zh: "管理客户" },
  "tax.issue_full": { th: "ออกใบกำกับเต็มรูป", en: "Issue full tax invoice", zh: "开具增值税专用发票" },
};

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
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
          <CardHeader title={t.admin.users} subtitle={L("กำหนดตำแหน่ง ขอบเขตข้อมูล สาขา และแบรนด์ที่เห็นได้", "Set role, data scope, branches, and visible brands", "设置角色、数据范围、门店和可见品牌")} />
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
                  <Th align="right">{L("ส่วนลดสูงสุด", "Max discount", "最大折扣")}</Th>
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
            subtitle={L("✓ = ทำได้ · A = ต้องขออนุมัติ · — = ไม่มีสิทธิ์ (บังคับจริงที่ Supabase RLS)", "✓ = allowed · A = needs approval · — = no permission (enforced by Supabase RLS)", "✓ = 可操作 · A = 需审批 · — = 无权限（由 Supabase RLS 强制执行）")}
            right={<Badge tone="info"><ShieldCheck size={10} /> RLS enforced</Badge>}
          />
          <Table>
            <thead>
              <tr>
                <Th>{L("ฟังก์ชัน", "Function", "功能")}</Th>
                {ROLES.map((r) => (
                  <Th key={r} align="center">{ROLE_LABEL[r][locale]}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_KEYS.map((k) => (
                <tr key={k} className="hover:bg-surface2/60">
                  <Td>
                    <p className="text-xs font-medium">{(() => { const pl = PERM_LABEL[k]; return pl ? L(pl.th, pl.en, pl.zh) : k; })()}</p>
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
              <Field label={L("ชื่อเล่น (ใช้ในรายงาน)", "Nickname (used in reports)", "昵称（用于报表）")}>
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
              <Field label={t.admin.dataAccess} hint={L("own = เห็นเฉพาะของตัวเอง · branch = ทั้งสาขา · brand = ทั้งแบรนด์ · company = ทั้งบริษัท", "own = see only own · branch = whole branch · brand = whole brand · company = whole company", "own = 仅看本人 · branch = 整个门店 · brand = 整个品牌 · company = 整个公司")}>
                <Select value={edit.data_scope} onChange={(e) => setEdit({ ...edit, data_scope: e.target.value as DataScope })}>
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label={L("ส่วนลดสูงสุด (%)", "Max discount (%)", "最大折扣 (%)")}>
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
