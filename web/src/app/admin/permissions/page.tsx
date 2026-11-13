"use client";

import { useEffect, useRef, useState } from "react";
import { Users, Search, Pencil, Trash2, RotateCcw, ShieldCheck, UserPlus, Eye, EyeOff, Grid3x3, Network } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches } from "@/lib/data/repo";
import type { Branch, DataScope, EmployeeRole, PermissionEffect } from "@/lib/types";
import { ROLE_LABEL, ROLE_MATRIX, can, type PermissionKey } from "@/lib/permissions";
import { Button, Card, Input, Field, Select, Table, Th, Td, Badge, Modal, EmptyState } from "@/components/ui";

const ROLES: EmployeeRole[] = ["staff", "supervisor", "manager", "brand_admin", "hq", "auditor", "owner"];
// NOTE: th/en/zh labels rendered via L() at point of use (locale not available at module scope)
const SCOPES: { v: DataScope; th: string; en: string; zh: string }[] = [
  { v: "own", th: "เฉพาะตัวเอง", en: "Own only", zh: "仅本人" },
  { v: "branch", th: "สาขาที่ระบุ", en: "Specific branches", zh: "指定门店" },
  { v: "brand", th: "แบรนด์ที่ระบุ", en: "Specific brands", zh: "指定品牌" },
  { v: "company", th: "ทั้งบริษัท", en: "Whole company", zh: "整个公司" },
];

const PERM_LABEL: Record<string, { th: string; en: string; zh: string }> = {
  "pos.sell": { th: "ขายสินค้า", en: "Sell", zh: "销售" },
  "pos.price_override": { th: "แก้ราคา", en: "Override price", zh: "改价" },
  "pos.void": { th: "ยกเลิกบิล", en: "Void bill", zh: "作废单据" },
  "pos.reprint": { th: "พิมพ์ซ้ำ", en: "Reprint", zh: "重新打印" },
  "pos.open_drawer": { th: "เปิดลิ้นชัก", en: "Open drawer", zh: "打开钱箱" },
  "pos.quotation": { th: "ใบเสนอราคา", en: "Quotation", zh: "报价单" },
  "return.create": { th: "รับคืนสินค้า", en: "Accept return", zh: "受理退货" },
  "return.approve": { th: "อนุมัติคืน", en: "Approve return", zh: "审批退货" },
  "inventory.view": { th: "ดูสต็อก", en: "View stock", zh: "查看库存" },
  "inventory.adjust": { th: "ปรับสต็อก", en: "Adjust stock", zh: "库存调整" },
  "inventory.count": { th: "นับสต็อก", en: "Count stock", zh: "盘点" },
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
  "admin.permission_manage": { th: "กำหนดสิทธิ์ (แอดมิน)", en: "Manage permissions (admin)", zh: "权限管理（管理员）" },
  "admin.product_manage": { th: "จัดการสินค้า", en: "Manage products", zh: "管理商品" },
  "admin.branch_manage": { th: "จัดการสาขา", en: "Manage branches", zh: "管理门店" },
  "admin.settings": { th: "ตั้งค่าระบบ", en: "System settings", zh: "系统设置" },
  "audit.view": { th: "ดู audit log", en: "View audit log", zh: "查看审计日志" },
  "customer.manage": { th: "จัดการลูกค้า", en: "Manage customers", zh: "管理客户" },
  "tax.issue_full": { th: "ออกใบกำกับเต็มรูป", en: "Issue full tax invoice", zh: "开具增值税专用发票" },
};

const PERM_GROUPS: { th: string; en: string; zh: string; keys: PermissionKey[] }[] = [
  { th: "ขายหน้าร้าน", en: "Store sales", zh: "门店销售", keys: ["pos.sell", "pos.price_override", "pos.void", "pos.reprint", "pos.open_drawer", "pos.quotation"] },
  { th: "คืนสินค้า", en: "Returns", zh: "退货", keys: ["return.create", "return.approve"] },
  { th: "สต็อก", en: "Stock", zh: "库存", keys: ["inventory.view", "inventory.adjust", "inventory.count"] },
  { th: "โอนย้าย", en: "Transfers", zh: "调货", keys: ["transfer.request", "transfer.approve", "transfer.receive"] },
  { th: "กะ & เงินสด", en: "Shift & cash", zh: "班次与现金", keys: ["shift.open", "shift.close", "shift.force_close", "cash.adjust"] },
  { th: "รายงาน", en: "Reports", zh: "报表", keys: ["report.employee_perf", "report.cost", "report.gross_profit"] },
  { th: "แอดมิน", en: "Admin", zh: "管理", keys: ["admin.employee_manage", "admin.permission_manage", "admin.product_manage", "admin.branch_manage", "admin.settings", "audit.view"] },
  { th: "อื่นๆ", en: "Others", zh: "其他", keys: ["customer.manage", "tax.issue_full"] },
];

type FourState = "inherit" | PermissionEffect;
const STATE_META: Record<FourState, { th: string; en: string; zh: string }> = {
  inherit: { th: "ตาม role", en: "By role", zh: "按角色" },
  allow: { th: "อนุญาต", en: "Allow", zh: "允许" },
  approval: { th: "อนุมัติก่อน", en: "Needs approval", zh: "需审批" },
  deny: { th: "ห้าม", en: "Deny", zh: "禁止" },
};
function baseEffect(role: EmployeeRole, key: PermissionKey): PermissionEffect {
  return ROLE_MATRIX[role]?.[key]?.effect ?? "deny";
}

interface UserRow {
  id: string; employee_code: string; email: string | null; display_name: string; nickname: string | null;
  role: EmployeeRole; data_scope: DataScope; home_branch_id: string | null; branch_ids: string[];
  status: string; pin: string | null; permission_overrides: Record<string, PermissionEffect>;
  photo_url: string | null; max_discount_percent: number;
}
interface Draft {
  id?: string; email: string; display_name: string; avatar_url?: string | null;
  role: EmployeeRole; data_scope: DataScope; branch_ids: string[]; max_discount_percent: number;
  permission_overrides: Record<string, PermissionEffect>; pin: string; is_active: boolean;
}
interface CentralPersonLite { union_id: string; name: string; email: string; avatar_url?: string }

export default function AdminUsersUnifiedPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { employee: me } = useSession();
  const toast = useToast();
  const allowed = can(me, "admin.permission_manage") || can(me, "admin.employee_manage");

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reveal, setReveal] = useState(false);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<CentralPersonLite[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState<"list" | "matrix">("list");

  // บันทึก override ทีละช่องจากตาราง (ส่ง payload เต็มเพื่อคงค่าอื่น; pin ว่าง = คงเดิม)
  async function saveOverride(u: UserRow, key: PermissionKey, next: FourState) {
    const overrides = { ...(u.permission_overrides ?? {}) };
    if (next === "inherit") delete overrides[key]; else overrides[key] = next;
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, permission_overrides: overrides } : x))); // optimistic
    const r = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: u.id, display_name: u.display_name, nickname: u.nickname, role: u.role, data_scope: u.data_scope,
        branch_ids: u.branch_ids, max_discount_percent: u.max_discount_percent, permission_overrides: overrides,
        pin: "", is_active: u.status === "active",
      }),
    }).catch(() => null);
    if (!r || !r.ok) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败") }); await load(); }
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users", { cache: "no-store" });
      if (r.status === 403) { setForbidden(true); return; }
      if (r.ok) { setForbidden(false); setUsers((await r.json()).users ?? []); }
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!allowed) return;
    void load();
    void listBranches().then((b) => setBranches(b.filter((x) => x.branch_type !== "warehouse")));
  }, [allowed]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/directory?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
        setResults((await r.json()).items ?? []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 350);
  }, [q]);

  const branchName = (id: string | null) =>
    !id ? "—" : branches.find((b) => b.id === id)?.name_th ?? branches.find((b) => b.id === id)?.name ?? "—";

  function openFromCentral(p: CentralPersonLite) {
    const existing = users.find((u) => (u.email ?? "").toLowerCase() === p.email.toLowerCase());
    if (existing) { openEdit(existing); setQ(""); setResults([]); return; }
    setDraft({
      email: p.email, display_name: p.name, avatar_url: p.avatar_url ?? null,
      role: "staff", data_scope: "branch", branch_ids: [], max_discount_percent: 5,
      permission_overrides: {}, pin: "1234", is_active: true,
    });
    setQ(""); setResults([]);
  }
  function openEdit(u: UserRow) {
    setDraft({
      id: u.id, email: u.email ?? "", display_name: u.display_name, avatar_url: u.photo_url,
      role: u.role, data_scope: u.data_scope, branch_ids: u.branch_ids, max_discount_percent: u.max_discount_percent,
      permission_overrides: u.permission_overrides ?? {}, pin: "", is_active: u.status === "active",
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id, email: draft.email, display_name: draft.display_name, photo_url: draft.avatar_url,
          role: draft.role, data_scope: draft.data_scope, branch_ids: draft.branch_ids,
          max_discount_percent: draft.max_discount_percent, permission_overrides: draft.permission_overrides,
          pin: draft.pin || undefined, is_active: draft.is_active,
        }),
      });
      if (!r.ok) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: (await r.json().catch(() => ({}))).error }); return; }
      toast.push({ tone: "ok", title: L(`บันทึก ${draft.display_name} แล้ว`, `Saved ${draft.display_name}`, `已保存 ${draft.display_name}`) });
      setDraft(null); await load();
    } finally { setSaving(false); }
  }

  async function removeUser(u: UserRow) {
    if (!confirm(L(`ลบ ${u.display_name} ออกจากระบบ?`, `Remove ${u.display_name} from the system?`, `将 ${u.display_name} 从系统中删除？`))) return;
    const r = await fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
    if (r.ok) { toast.push({ tone: "ok", title: L(`ลบ ${u.display_name} แล้ว`, `Deleted ${u.display_name}`, `已删除 ${u.display_name}`) }); await load(); }
  }
  async function restoreUser(u: UserRow) {
    const r = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, is_active: true }),
    });
    if (r.ok) { toast.push({ tone: "ok", title: L(`กู้คืน ${u.display_name} แล้ว`, `Restored ${u.display_name}`, `已恢复 ${u.display_name}`) }); await load(); }
  }

  function setOverride(key: PermissionKey, s: FourState) {
    if (!draft) return;
    const next = { ...draft.permission_overrides };
    if (s === "inherit") delete next[key]; else next[key] = s;
    setDraft({ ...draft, permission_overrides: next });
  }
  function toggleBranch(id: string) {
    if (!draft) return;
    const has = draft.branch_ids.includes(id);
    setDraft({ ...draft, branch_ids: has ? draft.branch_ids.filter((x) => x !== id) : [...draft.branch_ids, id] });
  }

  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 w-full">
        <EmptyState icon={<ShieldCheck size={28} />} title={L("ไม่มีสิทธิ์เข้าหน้านี้", "No access to this page", "无权访问此页面")} body={L("ต้องมีสิทธิ์จัดการผู้ใช้/กำหนดสิทธิ์", "Requires user management / permission management rights", "需要用户管理/权限管理权限")} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Users size={18} className="text-muted" /> {L("ผู้ใช้ & สิทธิ์", "Users & Permissions", "用户与权限")}</h1>
          <p className="text-xs text-muted mt-1">{L("เพิ่มคน · ตั้งบทบาท + สิทธิ์ละเอียด + PIN + สาขา ที่เดียว · เข้าได้ทั้ง SSO และ PIN", "Add people · set role + detailed permissions + PIN + branches in one place · works with both SSO and PIN", "添加人员 · 一处设置角色 + 详细权限 + PIN + 门店 · 支持 SSO 和 PIN 登录")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href="/admin/org" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-xs text-muted hover:text-brand hover:bg-surface2 transition-colors"><Network size={14} />{L("ผังองค์กร", "Org chart", "组织架构")}</a>
          {!forbidden ? (
            <div className="flex rounded-xl border border-line overflow-hidden text-xs">
              <button onClick={() => setView("list")} className={`px-3 h-9 inline-flex items-center gap-1.5 ${view === "list" ? "bg-brand text-white" : "text-muted hover:bg-surface2"}`}><Users size={14} />{L("รายชื่อ", "List", "列表")}</button>
              <button onClick={() => setView("matrix")} className={`px-3 h-9 inline-flex items-center gap-1.5 ${view === "matrix" ? "bg-brand text-white" : "text-muted hover:bg-surface2"}`}><Grid3x3 size={14} />{L("ตารางสิทธิ", "Matrix", "权限表")}</button>
            </div>
          ) : null}
        </div>
      </div>

      {forbidden ? (
        <Card className="p-4"><p className="text-sm text-warn flex items-center gap-2"><ShieldCheck size={16} /> {L("ต้องล็อกอินด้วยบัญชีกลาง (SSO) จึงจะจัดการผู้ใช้ได้", "You must sign in with a central account (SSO) to manage users", "需使用中央账户（SSO）登录才能管理用户")}</p></Card>
      ) : (
        <>
          <Card className="p-4">
            <Field label={L("เพิ่มคน (ค้นหาจากระบบกลาง)", "Add person (search central directory)", "添加人员（从中央系统搜索）")} hint={L("พิมพ์ชื่อหรืออีเมลอย่างน้อย 2 ตัวอักษร", "Type at least 2 characters of name or email", "输入至少 2 个字符的姓名或邮箱")}>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("เช่น Tiw หรือ name@shd-technology.co.th", "e.g. Tiw or name@shd-technology.co.th", "例如 Tiw 或 name@shd-technology.co.th")} className="pl-9" />
                {searching ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">{L("กำลังค้นหา…", "Searching…", "搜索中…")}</span> : null}
              </div>
            </Field>
            {results.length ? (
              <div className="mt-2 border border-line rounded-xl divide-y divide-line overflow-hidden">
                {results.map((p) => {
                  const already = users.some((u) => (u.email ?? "").toLowerCase() === p.email.toLowerCase());
                  return (
                    <button key={p.union_id || p.email} onClick={() => openFromCentral(p)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface2 text-left">
                      {p.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : <div className="w-8 h-8 rounded-full bg-surface2 grid place-items-center shrink-0 text-xs">{p.name.slice(0, 2)}</div>}
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-[11px] text-muted truncate">{p.email}</p></div>
                      {already ? <Badge tone="ok">{L("มีแล้ว", "Added", "已添加")}</Badge> : <UserPlus size={15} className="text-brand" />}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </Card>

          {view === "list" ? (
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{users.filter((u) => u.status === "active").length} {L("คนใช้งาน", "active", "活跃")}</span>
                {users.some((u) => u.status !== "active") ? (
                  <button onClick={() => setShowInactive((v) => !v)} className="text-xs text-muted hover:text-ink underline-offset-2 hover:underline">
                    {showInactive ? L("ซ่อนที่ลบแล้ว", "Hide deleted", "隐藏已删除") : L(`แสดงที่ลบแล้ว (${users.filter((u) => u.status !== "active").length})`, `Show deleted (${users.filter((u) => u.status !== "active").length})`, `显示已删除 (${users.filter((u) => u.status !== "active").length})`)}
                  </button>
                ) : null}
              </div>
              <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />} {reveal ? L("ซ่อน PIN", "Hide PIN", "隐藏 PIN") : L("แสดง PIN", "Show PIN", "显示 PIN")}
              </button>
            </div>
            {(() => { const shown = users.filter((u) => showInactive || u.status === "active"); return (
            loading ? <p className="text-sm text-muted p-6 text-center">{L("กำลังโหลด…", "Loading…", "加载中…")}</p> : shown.length ? (
              <Table>
                <thead><tr>
                  <Th>{L("ผู้ใช้", "User", "用户")}</Th><Th>{L("บทบาท", "Role", "角色")}</Th><Th>{L("ขอบเขต", "Scope", "范围")}</Th><Th align="center">PIN</Th><Th align="center">{L("สิทธิ์เฉพาะ", "Custom perms", "特殊权限")}</Th><Th align="center">{L("สถานะ", "Status", "状态")}</Th><Th align="right">{L("จัดการ", "Actions", "操作")}</Th>
                </tr></thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className={u.status !== "active" ? "opacity-55" : ""}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          {u.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={u.photo_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : <div className="w-8 h-8 rounded-full bg-surface2 grid place-items-center text-xs font-semibold shrink-0">{u.display_name.slice(0, 2).toUpperCase()}</div>}
                          <div className="min-w-0"><p className="text-sm font-medium truncate">{u.display_name}</p><p className="text-[11px] text-muted truncate">{u.email ?? u.employee_code}</p></div>
                        </div>
                      </Td>
                      <Td>{ROLE_LABEL[u.role]?.[locale] ?? u.role}</Td>
                      <Td>{(() => { const sc = SCOPES.find((s) => s.v === u.data_scope); return sc ? L(sc.th, sc.en, sc.zh) : u.data_scope; })()}</Td>
                      <Td align="center"><span className="tnum font-semibold tracking-widest">{u.pin ? (reveal ? u.pin : "••••") : "—"}</span></Td>
                      <Td align="center">{Object.keys(u.permission_overrides ?? {}).length || "—"}</Td>
                      <Td align="center">{u.status === "active" ? <Badge tone="ok">{L("ใช้งาน", "Active", "启用")}</Badge> : <Badge tone="neutral">{L("ลบแล้ว", "Deleted", "已删除")}</Badge>}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          {u.status === "active" ? (
                            <>
                              <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-surface2 text-muted" title={L("แก้ไข", "Edit", "编辑")}><Pencil size={15} /></button>
                              <button onClick={() => void removeUser(u)} className="p-1.5 rounded-lg hover:bg-surface2 text-danger" title={L("ลบ", "Delete", "删除")}><Trash2 size={15} /></button>
                            </>
                          ) : (
                            <button onClick={() => void restoreUser(u)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:bg-surface2" title={L("กู้คืน", "Restore", "恢复")}><RotateCcw size={13} /> {L("กู้คืน", "Restore", "恢复")}</button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState icon={<Users size={26} />} title={showInactive ? L("ไม่มีผู้ใช้", "No users", "暂无用户") : L("ยังไม่มีผู้ใช้ที่ใช้งาน", "No active users yet", "暂无活跃用户")} body={L("ค้นหาคนด้านบนเพื่อเพิ่มคน", "Search above to add people", "在上方搜索以添加人员")} />
            ); })()}
          </Card>
          ) : (
            <PermissionMatrix users={users.filter((u) => u.status === "active")} locale={locale} L={L} onToggle={saveOverride} />
          )}
        </>
      )}

      <Modal
        open={!!draft} onClose={() => setDraft(null)} size="xl"
        title={draft ? `${L("ผู้ใช้", "User", "用户")} · ${draft.display_name}` : ""}
        footer={draft ? (
          <div className="flex items-center justify-between gap-2 w-full">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> {L("เปิดใช้งาน", "Active", "启用")}</label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>{L("ยกเลิก", "Cancel", "取消")}</Button>
              <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? L("กำลังบันทึก…", "Saving…", "保存中…") : L("บันทึก", "Save", "保存")}</Button>
            </div>
          </div>
        ) : null}
      >
        {draft ? (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={L("ชื่อที่แสดง", "Display name", "显示名称")}><Input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></Field>
              <Field label={L("อีเมล (ใช้ล็อกอิน SSO)", "Email (for SSO login)", "邮箱（用于 SSO 登录）")}><Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@shd-technology.co.th" /></Field>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label={L("บทบาท (role)", "Role", "角色")}><Select value={draft.role} onChange={(e) => { const role = e.target.value as EmployeeRole; setDraft({ ...draft, role, ...((role === "owner" || role === "hq") ? { data_scope: "company" as DataScope } : {}) }); }}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r][locale]}</option>)}</Select></Field>
              <Field label={L("ขอบเขตข้อมูล", "Data scope", "数据范围")}><Select value={draft.data_scope} onChange={(e) => setDraft({ ...draft, data_scope: e.target.value as DataScope })}>{SCOPES.map((s) => <option key={s.v} value={s.v}>{L(s.th, s.en, s.zh)}</option>)}</Select></Field>
              <Field label={L("เพดานส่วนลด (%)", "Max discount (%)", "最大折扣 (%)")}><Input type="number" min={0} max={100} value={draft.max_discount_percent} onChange={(e) => setDraft({ ...draft, max_discount_percent: Number(e.target.value) || 0 })} /></Field>
            </div>

            <Field label={draft.id ? L("ตั้ง PIN ใหม่ (เว้นว่าง = คงเดิม)", "Set new PIN (blank = keep current)", "设置新 PIN（留空 = 保持不变）") : L("PIN สำหรับล็อกอินหน้าขาย", "PIN for POS login", "POS 登录 PIN")}>
              <Input inputMode="numeric" maxLength={6} value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={draft.id ? L("เว้นว่างไว้ถ้าไม่เปลี่ยน", "Leave blank to keep", "不修改请留空") : L("เช่น 1234", "e.g. 1234", "例如 1234")} className="tracking-widest w-40" />
            </Field>

            {draft.data_scope === "branch" ? (
              <Field label={L("สาขาที่เข้าถึงได้", "Accessible branches", "可访问门店")} hint={L("ติ๊กสาขาที่คนนี้ดูแล (ใช้กับ PIN login ด้วย)", "Tick branches this person manages (also used for PIN login)", "勾选此人负责的门店（也用于 PIN 登录）")}>
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => {
                    const on = draft.branch_ids.includes(b.id);
                    return <button key={b.id} onClick={() => toggleBranch(b.id)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:bg-surface2"}`}>{b.name_th ?? b.name}</button>;
                  })}
                </div>
              </Field>
            ) : null}

            <div>
              <p className="text-sm font-medium mb-2">{L("สิทธิ์รายข้อ", "Per-item permissions", "逐项权限")} <span className="text-[11px] text-muted font-normal">{L("(ค่าเริ่มต้น “ตาม role” — ปรับเฉพาะข้อที่ต่าง)", "(default “by role” — adjust only what differs)", "（默认“按角色”——仅调整不同项）")}</span></p>
              <div className="space-y-4">
                {PERM_GROUPS.map((grp) => (
                  <div key={grp.th}>
                    <p className="eyebrow mb-1.5">{L(grp.th, grp.en, grp.zh)}</p>
                    <div className="space-y-1">
                      {grp.keys.map((key) => {
                        const state: FourState = (draft.permission_overrides[key] as PermissionEffect) ?? "inherit";
                        const base = baseEffect(draft.role, key);
                        return (
                          <div key={key} className="flex items-center gap-3 py-1">
                            <div className="min-w-0 flex-1"><p className="text-sm truncate">{(() => { const pl = PERM_LABEL[key]; return pl ? L(pl.th, pl.en, pl.zh) : key; })()}</p><p className="text-[10px] text-muted">{L("ตาม role", "By role", "按角色")}: {L(STATE_META[base].th, STATE_META[base].en, STATE_META[base].zh)}</p></div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {(["inherit", "allow", "approval", "deny"] as FourState[]).map((s) => (
                                <button key={s} onClick={() => setOverride(key, s)} className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${state === s ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:bg-line"}`}>{L(STATE_META[s].th, STATE_META[s].en, STATE_META[s].zh)}</button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

// ── ตารางสิทธิ (คน × สิทธิ) — คลิกช่องวน: ตาม role → อนุญาต → ห้าม → ตาม role ──
const ALL_KEYS: PermissionKey[] = PERM_GROUPS.flatMap((g) => g.keys);
const CYCLE: Record<FourState, FourState> = { inherit: "allow", allow: "deny", deny: "inherit", approval: "inherit" };

function PermissionMatrix({ users, locale, L, onToggle }: {
  users: UserRow[];
  locale: "th" | "en" | "zh";
  L: (th: string, en: string, zh: string) => string;
  onToggle: (u: UserRow, key: PermissionKey, next: FourState) => void;
}) {
  const kl = (k: PermissionKey) => { const m = PERM_LABEL[k]; return m ? (locale === "th" ? m.th : locale === "zh" ? m.zh : m.en) : k; };
  const gl = (g: { th: string; en: string; zh: string }) => (locale === "th" ? g.th : locale === "zh" ? g.zh : g.en);

  const glyph = (eff: PermissionEffect) => (eff === "allow" ? "✓" : eff === "deny" ? "✕" : eff === "approval" ? "~" : "–");
  const cellCls = (eff: PermissionEffect, strong: boolean) => {
    if (eff === "allow") return strong ? "bg-ok text-white" : "text-ok/45";
    if (eff === "deny") return strong ? "bg-danger text-white" : "text-danger/40";
    if (eff === "approval") return strong ? "bg-amber-500 text-white" : "text-amber-500/50";
    return "text-muted/30";
  };

  if (!users.length) return <Card className="p-6"><EmptyState icon={<Grid3x3 size={24} />} title={L("ยังไม่มีผู้ใช้", "No users yet", "暂无用户")} /></Card>;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-3 flex-wrap text-[11px] text-muted">
        <span className="font-medium text-ink">{L("คลิกช่องเพื่อกำหนด", "Click a cell to set", "点击单元格设置")}</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded bg-ok text-white grid place-items-center text-[10px]">✓</span>{L("อนุญาต", "Allow", "允许")}</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded bg-danger text-white grid place-items-center text-[10px]">✕</span>{L("ห้าม", "Deny", "禁止")}</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded grid place-items-center text-[10px] text-muted/40 border border-line">–</span>{L("ตาม role (จาง = ค่าปัจจุบัน)", "By role (faint = effective)", "按角色")}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 z-20 bg-surface2 border-b border-r border-line px-3 py-2 text-left min-w-[180px]">{L("ผู้ใช้", "User", "用户")}</th>
              {PERM_GROUPS.map((g, i) => (
                <th key={i} colSpan={g.keys.length} className="border-b border-l border-line px-2 py-1.5 text-center text-[10px] uppercase tracking-wide text-muted bg-surface2/60">{gl(g)}</th>
              ))}
            </tr>
            <tr>
              {ALL_KEYS.map((k) => (
                <th key={k} title={kl(k)} className="border-b border-line px-1 py-1.5 align-bottom bg-surface2/30" style={{ minWidth: 42, maxWidth: 52 }}>
                  <div className="text-[8.5px] leading-tight text-muted truncate">{kl(k)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-surface2/40">
                <td className="sticky left-0 z-10 bg-surface border-r border-b border-line px-3 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {u.photo_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={u.photo_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                      : <div className="w-6 h-6 rounded-full bg-surface2 grid place-items-center text-[9px] font-semibold shrink-0">{u.display_name.slice(0, 2).toUpperCase()}</div>}
                    <div className="min-w-0"><p className="text-xs font-medium truncate max-w-[130px]">{u.display_name}</p><p className="text-[9px] text-muted">{ROLE_LABEL[u.role][locale]}</p></div>
                  </div>
                </td>
                {ALL_KEYS.map((k) => {
                  const ov = u.permission_overrides?.[k] as PermissionEffect | undefined;
                  const state: FourState = ov ?? "inherit";
                  const eff: PermissionEffect = ov ?? baseEffect(u.role, k);
                  return (
                    <td key={k} className="border-b border-line/60 text-center p-0.5">
                      <button
                        onClick={() => onToggle(u, k, CYCLE[state])}
                        title={`${kl(k)} · ${L(STATE_META[state].th, STATE_META[state].en, STATE_META[state].zh)}`}
                        className={`w-7 h-7 rounded grid place-items-center mx-auto text-[11px] font-bold transition-colors hover:ring-2 hover:ring-brand/30 ${cellCls(eff, !!ov)}`}
                      >{glyph(eff)}</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
