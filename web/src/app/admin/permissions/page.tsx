"use client";
// =====================================================================
// ผู้ใช้ & สิทธิ์ — เพิ่มคน · บทบาท · สิทธิ์ละเอียด · PIN · สาขา (เข้าได้ทั้ง SSO และ PIN)
//   มุมมอง: รายชื่อ / ตารางสิทธิ์ · ตัวกรองร่วม: ค้นหา บทบาท สาขา ขอบเขต สถานะ วิธีเข้าใช้ สิทธิ์เฉพาะ
//   ตารางสิทธิ์กรองคอลัมน์ตามกลุ่ม/ค้นชื่อสิทธิ์/เฉพาะที่ตั้งเองได้
//   กฎ: ทุกฟีเจอร์ใหม่ต้องมีคีย์ใน permissions.ts + PERM_GROUPS (ตรวจด้วย scripts/check-permissions.cjs)
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Users, Search, Pencil, Trash2, RotateCcw, ShieldCheck, UserPlus, Eye, EyeOff, Grid3x3, Network, X, KeyRound,
  Mail, SlidersHorizontal, UserCheck, UserX, Filter,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches } from "@/lib/data/repo";
import type { Branch, DataScope, EmployeeRole, PermissionEffect } from "@/lib/types";
import { ROLE_LABEL, can, type PermissionKey } from "@/lib/permissions";
import { PERM_GROUPS, PERM_LABEL, STATE_META, baseEffect, CYCLE, type FourState } from "@/lib/permissions-ui";
import { Button, Input, Field, Select, Drawer, EmptyState } from "@/components/ui";

const ROLES: EmployeeRole[] = ["owner", "hq", "brand_admin", "manager", "supervisor", "staff", "auditor"];
const SCOPES: { v: DataScope; th: string; en: string; zh: string }[] = [
  { v: "own", th: "เฉพาะตัวเอง", en: "Own only", zh: "仅本人" },
  { v: "branch", th: "สาขาที่ระบุ", en: "Specific branches", zh: "指定门店" },
  { v: "brand", th: "แบรนด์ที่ระบุ", en: "Specific brands", zh: "指定品牌" },
  { v: "company", th: "ทั้งบริษัท", en: "Whole company", zh: "整个公司" },
];
const ROLE_TONE: Record<string, string> = {
  owner: "bg-brand text-brandInk", hq: "bg-brand/80 text-brandInk", brand_admin: "bg-violet-500/12 text-violet-600",
  manager: "bg-sky-500/12 text-sky-600", supervisor: "bg-teal-500/12 text-teal-600", staff: "bg-surface2 text-ink", auditor: "bg-amber-500/12 text-amber-600",
};

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
type Status = "active" | "inactive" | "all";
type Login = "all" | "sso" | "pin_only" | "no_pin";

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
  const [view, setView] = useState<"list" | "matrix">("list");

  // เพิ่มคนจากระบบกลาง
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CentralPersonLite[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ตัวกรอง (ใช้ร่วมทั้งรายชื่อและตารางสิทธิ์)
  const [fq, setFq] = useState("");
  const [fRoles, setFRoles] = useState<EmployeeRole[]>([]);
  const [fBranch, setFBranch] = useState("all");
  const [fScope, setFScope] = useState<"all" | DataScope>("all");
  const [fStatus, setFStatus] = useState<Status>("active");
  const [fLogin, setFLogin] = useState<Login>("all");
  const [fCustom, setFCustom] = useState(false);
  const [sort, setSort] = useState<"name" | "role" | "branch" | "custom">("role");
  // ตัวกรองคอลัมน์ตารางสิทธิ์
  const [mGroup, setMGroup] = useState("all");
  const [mQ, setMQ] = useState("");
  const [mOnlySet, setMOnlySet] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dGroup, setDGroup] = useState("all");
  const [dQ, setDQ] = useState("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const branchName = (id: string | null) => (!id ? "—" : branchById.get(id)?.name_th ?? branchById.get(id)?.name ?? "—");
  const roleLabel = (r: EmployeeRole) => ROLE_LABEL[r]?.[locale] ?? r;
  const permLabel = (k: PermissionKey) => { const m = PERM_LABEL[k]; return m ? L(m.th, m.en, m.zh) : k; };
  const customCount = (u: UserRow) => Object.keys(u.permission_overrides ?? {}).length;

  // ── คัดกรองผู้ใช้ ──
  const filtered = useMemo(() => {
    const needle = fq.trim().toLowerCase();
    const rank = (r: EmployeeRole) => ROLES.indexOf(r);
    return users.filter((u) => {
      if (fStatus === "active" && u.status !== "active") return false;
      if (fStatus === "inactive" && u.status === "active") return false;
      if (fRoles.length && !fRoles.includes(u.role)) return false;
      if (fScope !== "all" && u.data_scope !== fScope) return false;
      if (fBranch !== "all" && !(u.branch_ids ?? []).includes(fBranch) && u.home_branch_id !== fBranch) return false;
      if (fLogin === "sso" && !u.email) return false;
      if (fLogin === "pin_only" && (u.email || !u.pin)) return false;
      if (fLogin === "no_pin" && u.pin) return false;
      if (fCustom && !customCount(u)) return false;
      if (needle && !`${u.display_name} ${u.nickname ?? ""} ${u.email ?? ""} ${u.employee_code}`.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a, b) =>
      sort === "name" ? a.display_name.localeCompare(b.display_name, "th")
        : sort === "branch" ? branchName(a.branch_ids?.[0] ?? a.home_branch_id).localeCompare(branchName(b.branch_ids?.[0] ?? b.home_branch_id), "th")
          : sort === "custom" ? customCount(b) - customCount(a)
            : rank(a.role) - rank(b.role) || a.display_name.localeCompare(b.display_name, "th"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, fq, fRoles, fBranch, fScope, fStatus, fLogin, fCustom, sort, branchById]);

  const stats = useMemo(() => {
    const active = users.filter((u) => u.status === "active");
    return {
      total: users.length, active: active.length, inactive: users.length - active.length,
      sso: active.filter((u) => u.email).length, pin: active.filter((u) => u.pin).length,
      custom: active.filter((u) => customCount(u)).length,
      byRole: ROLES.map((r) => [r, active.filter((u) => u.role === r).length] as const),
    };
  }, [users]);
  const activeFilters = (fq ? 1 : 0) + fRoles.length + (fBranch !== "all" ? 1 : 0) + (fScope !== "all" ? 1 : 0) + (fStatus !== "active" ? 1 : 0) + (fLogin !== "all" ? 1 : 0) + (fCustom ? 1 : 0);
  const clearFilters = () => { setFq(""); setFRoles([]); setFBranch("all"); setFScope("all"); setFStatus("active"); setFLogin("all"); setFCustom(false); };

  // ── คอลัมน์ตารางสิทธิ์ ──
  const matrixGroups = useMemo(() => {
    const needle = mQ.trim().toLowerCase();
    return PERM_GROUPS
      .filter((g) => mGroup === "all" || g.th === mGroup)
      .map((g) => ({
        ...g,
        keys: g.keys.filter((k) =>
          (!needle || `${permLabel(k)} ${k}`.toLowerCase().includes(needle)) &&
          (!mOnlySet || filtered.some((u) => u.permission_overrides?.[k]))),
      }))
      .filter((g) => g.keys.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mGroup, mQ, mOnlySet, filtered, locale]);

  // ── action ──
  async function saveOverride(u: UserRow, key: PermissionKey, next: FourState) {
    const overrides = { ...(u.permission_overrides ?? {}) };
    if (next === "inherit") delete overrides[key]; else overrides[key] = next;
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, permission_overrides: overrides } : x)));
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
  function openFromCentral(p: CentralPersonLite) {
    const existing = users.find((u) => (u.email ?? "").toLowerCase() === p.email.toLowerCase());
    setQ(""); setResults([]); setAddOpen(false);
    if (existing) { openEdit(existing); return; }
    setDraft({
      email: p.email, display_name: p.name, avatar_url: p.avatar_url ?? null,
      role: "staff", data_scope: "branch", branch_ids: [], max_discount_percent: 5,
      permission_overrides: {}, pin: "1234", is_active: true,
    });
  }
  function openEdit(u: UserRow) {
    setDGroup("all"); setDQ("");
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
    if (!confirm(L(`ปิดใช้งาน ${u.display_name}? (กู้คืนได้ภายหลัง)`, `Deactivate ${u.display_name}? (restorable)`, `停用 ${u.display_name}？`))) return;
    const r = await fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
    if (r.ok) { toast.push({ tone: "ok", title: L(`ปิดใช้งาน ${u.display_name} แล้ว`, `Deactivated ${u.display_name}`, `已停用 ${u.display_name}`) }); await load(); }
  }
  async function restoreUser(u: UserRow) {
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, is_active: true }) });
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
        <EmptyState icon={<ShieldCheck size={28} />} title={L("ไม่มีสิทธิ์เข้าหน้านี้", "No access to this page", "无权访问此页面")} body={L("ต้องมีสิทธิ์จัดการผู้ใช้/กำหนดสิทธิ์", "Requires user / permission management", "需要用户/权限管理权限")} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      {/* ── หัวเรื่อง + มุมมอง + ปุ่ม (แถวเดียว) ── */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2"><Users size={18} className="text-muted" />{L("ผู้ใช้ & สิทธิ์", "Users & Permissions", "用户与权限")}</h1>
          <p className="text-xs text-muted mt-0.5">{L("บทบาท · สิทธิ์ละเอียด · PIN · สาขา ในที่เดียว · เข้าได้ทั้ง SSO และ PIN", "Role · permissions · PIN · branches · SSO or PIN login", "角色·权限·PIN·门店")}</p>
        </div>
        {!forbidden ? (
          <div className="flex rounded-2xl bg-surface/65 border border-line/70 p-1 gap-0.5">
            {([["list", Users, L("รายชื่อ", "List", "列表")], ["matrix", Grid3x3, L("ตารางสิทธิ์", "Matrix", "权限表")]] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)} className={`h-8 px-3 rounded-xl text-xs inline-flex items-center gap-1.5 ${view === v ? "bg-brand text-brandInk shadow-sm" : "text-muted hover:bg-surface"}`}><Icon size={13} />{label}</button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2 ml-auto">
          <a href="/admin/org" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-xs text-muted hover:text-brand hover:bg-surface2 transition-colors"><Network size={14} />{L("ผังองค์กร", "Org chart", "组织架构")}</a>
          {!forbidden ? <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><UserPlus size={14} />{L("เพิ่มคน", "Add person", "添加人员")}</Button> : null}
        </div>
      </header>

      {forbidden ? (
        <div className="rounded-2xl border border-warn/30 bg-warn/8 p-4 text-sm text-warn flex items-center gap-2"><ShieldCheck size={16} /> {L("ต้องล็อกอินด้วยบัญชีกลาง (SSO) จึงจะจัดการผู้ใช้ได้", "Sign in with SSO to manage users", "需使用 SSO 登录")}</div>
      ) : (
        <>
          {/* ── สรุป (คลิกเพื่อกรอง) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {([
              [L("ใช้งานอยู่", "Active", "启用"), stats.active, UserCheck, () => { clearFilters(); }],
              [L("เข้าด้วย SSO", "SSO login", "SSO"), stats.sso, Mail, () => { clearFilters(); setFLogin("sso"); }],
              [L("มี PIN", "Has PIN", "有 PIN"), stats.pin, KeyRound, () => { clearFilters(); setFLogin("all"); }],
              [L("มีสิทธิ์เฉพาะคน", "Custom perms", "特殊权限"), stats.custom, SlidersHorizontal, () => { clearFilters(); setFCustom(true); }],
              [L("ปิดใช้งาน", "Deactivated", "已停用"), stats.inactive, UserX, () => { clearFilters(); setFStatus("inactive"); }],
            ] as const).map(([label, value, Icon, go], i) => (
              <button key={label} onClick={go} className={`text-left rounded-[20px] p-4 transition hover:-translate-y-0.5 ${i === 0 ? "bg-brand text-brandInk shadow-sm" : "bg-surface border border-line/70"}`}>
                <div className="flex items-center justify-between"><p className={`text-[11px] ${i === 0 ? "opacity-70" : "text-muted"}`}>{label}</p><Icon size={14} className={i === 0 ? "opacity-70" : "text-muted"} /></div>
                <p className="text-2xl font-semibold tnum mt-1.5">{loading ? "—" : value}</p>
              </button>
            ))}
          </div>

          {/* ── ตัวกรอง ── */}
          <section className="rounded-2xl border border-line/70 bg-surface p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={fq} onChange={(e) => setFq(e.target.value)} placeholder={L("ค้นชื่อ / อีเมล / รหัสพนักงาน", "Search name / email / code", "搜索")} className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface2/70 border border-line text-sm outline-none focus:ring-2 focus:ring-brand/25" />
              </div>
              <FSelect value={fBranch} onChange={setFBranch} label={L("สาขา", "Branch", "门店")}>
                <option value="all">{L("ทุกสาขา", "All branches", "全部门店")}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}
              </FSelect>
              <FSelect value={fScope} onChange={(v) => setFScope(v as typeof fScope)} label={L("ขอบเขต", "Scope", "范围")}>
                <option value="all">{L("ทุกขอบเขต", "All scopes", "全部范围")}</option>
                {SCOPES.map((s) => <option key={s.v} value={s.v}>{L(s.th, s.en, s.zh)}</option>)}
              </FSelect>
              <FSelect value={fLogin} onChange={(v) => setFLogin(v as Login)} label={L("วิธีเข้าใช้", "Login", "登录")}>
                <option value="all">{L("ทุกวิธีเข้าใช้", "Any login", "全部")}</option>
                <option value="sso">{L("มี SSO (อีเมล)", "Has SSO", "有 SSO")}</option>
                <option value="pin_only">{L("PIN อย่างเดียว", "PIN only", "仅 PIN")}</option>
                <option value="no_pin">{L("ยังไม่มี PIN", "No PIN", "无 PIN")}</option>
              </FSelect>
              <FSelect value={fStatus} onChange={(v) => setFStatus(v as Status)} label={L("สถานะ", "Status", "状态")}>
                <option value="active">{L("ใช้งานอยู่", "Active", "启用")}</option>
                <option value="inactive">{L("ปิดใช้งาน", "Deactivated", "已停用")}</option>
                <option value="all">{L("ทุกสถานะ", "All", "全部")}</option>
              </FSelect>
              <FSelect value={sort} onChange={(v) => setSort(v as typeof sort)} label={L("เรียง", "Sort", "排序")}>
                <option value="role">{L("เรียง: บทบาท", "Sort: role", "按角色")}</option>
                <option value="name">{L("เรียง: ชื่อ", "Sort: name", "按姓名")}</option>
                <option value="branch">{L("เรียง: สาขา", "Sort: branch", "按门店")}</option>
                <option value="custom">{L("เรียง: สิทธิ์เฉพาะมากสุด", "Sort: most custom", "按特殊权限")}</option>
              </FSelect>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter size={13} className="text-muted mr-0.5" />
              {stats.byRole.map(([r, n]) => {
                const on = fRoles.includes(r);
                return (
                  <button key={r} onClick={() => setFRoles((rs) => (on ? rs.filter((x) => x !== r) : [...rs, r]))}
                    className={`h-7 px-2.5 rounded-full text-[11px] inline-flex items-center gap-1.5 transition ${on ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>
                    {roleLabel(r)}<span className="tnum opacity-70">{n}</span>
                  </button>
                );
              })}
              <label className="h-7 px-2.5 rounded-full text-[11px] inline-flex items-center gap-1.5 bg-surface2/80 text-muted cursor-pointer">
                <input type="checkbox" checked={fCustom} onChange={(e) => setFCustom(e.target.checked)} className="accent-current" />{L("มีสิทธิ์เฉพาะคน", "Has custom perms", "有特殊权限")}
              </label>
              <span className="ml-auto text-[11px] text-muted">
                {L(`แสดง ${filtered.length} จาก ${users.length} คน`, `${filtered.length} of ${users.length}`, `${filtered.length}/${users.length}`)}
                {activeFilters ? <button onClick={clearFilters} className="ml-2 text-brand hover:underline">{L("ล้างตัวกรอง", "Clear", "清除")}</button> : null}
              </span>
            </div>
          </section>

          {view === "list" ? (
            <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
                <span className="text-xs text-muted">{L("คลิกแถวเพื่อแก้ไข", "Click a row to edit", "点击行编辑")}</span>
                <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">
                  {reveal ? <EyeOff size={14} /> : <Eye size={14} />} {reveal ? L("ซ่อน PIN", "Hide PIN", "隐藏 PIN") : L("แสดง PIN", "Show PIN", "显示 PIN")}
                </button>
              </div>
              {loading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 rounded-xl bg-surface2/60 animate-pulse" />)}</div>
              ) : filtered.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-muted text-left border-b border-line">
                        <th className="px-4 py-2 font-medium">{L("ผู้ใช้", "User", "用户")}</th>
                        <th className="px-3 py-2 font-medium">{L("บทบาท", "Role", "角色")}</th>
                        <th className="px-3 py-2 font-medium">{L("ขอบเขต / สาขา", "Scope / branches", "范围/门店")}</th>
                        <th className="px-3 py-2 font-medium text-center">{L("เข้าใช้", "Login", "登录")}</th>
                        <th className="px-3 py-2 font-medium text-center">{L("สิทธิ์เฉพาะ", "Custom", "特殊")}</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((u) => {
                        const sc = SCOPES.find((s) => s.v === u.data_scope);
                        const bs = (u.branch_ids?.length ? u.branch_ids : u.home_branch_id ? [u.home_branch_id] : []);
                        const n = customCount(u);
                        return (
                          <tr key={u.id} onClick={() => u.status === "active" && openEdit(u)}
                            className={`border-b border-line/50 last:border-0 hover:bg-surface2/40 cursor-pointer ${u.status !== "active" ? "opacity-55" : ""}`}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <Face src={u.photo_url} name={u.display_name} />
                                <div className="min-w-0"><p className="font-medium truncate max-w-[220px]">{u.display_name}</p><p className="text-[11px] text-muted truncate max-w-[220px]">{u.email ?? u.employee_code}</p></div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${ROLE_TONE[u.role] ?? "bg-surface2"}`}>{roleLabel(u.role)}</span></td>
                            <td className="px-3 py-2.5">
                              <p className="text-xs">{sc ? L(sc.th, sc.en, sc.zh) : u.data_scope}</p>
                              {u.data_scope === "branch" || u.data_scope === "own" ? (
                                <p className="text-[11px] text-muted truncate max-w-[240px]" title={bs.map(branchName).join(", ")}>
                                  {bs.length ? `${branchName(bs[0])}${bs.length > 1 ? ` +${bs.length - 1}` : ""}` : L("ยังไม่ผูกสาขา", "No branch", "未绑定门店")}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="inline-flex items-center gap-1">
                                {u.email ? <span title="SSO" className="h-6 px-1.5 rounded-md bg-sky-500/10 text-sky-600 text-[10px] inline-flex items-center gap-0.5"><Mail size={11} />SSO</span> : null}
                                {u.pin ? <span title="PIN" className="h-6 px-1.5 rounded-md bg-surface2 text-[10px] inline-flex items-center gap-0.5 tnum"><KeyRound size={11} />{reveal ? u.pin : "••••"}</span> : null}
                                {!u.email && !u.pin ? <span className="text-[10px] text-danger">{L("เข้าไม่ได้", "No login", "无法登录")}</span> : null}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">{n ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand tnum">{n}</span> : <span className="text-muted/50">—</span>}</td>
                            <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              {u.status === "active" ? (
                                <div className="inline-flex gap-0.5">
                                  <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-surface2 text-muted" title={L("แก้ไข", "Edit", "编辑")}><Pencil size={15} /></button>
                                  <button onClick={() => void removeUser(u)} className="p-1.5 rounded-lg hover:bg-surface2 text-danger" title={L("ปิดใช้งาน", "Deactivate", "停用")}><Trash2 size={15} /></button>
                                </div>
                              ) : (
                                <button onClick={() => void restoreUser(u)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:bg-surface2"><RotateCcw size={13} />{L("กู้คืน", "Restore", "恢复")}</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-14"><EmptyState icon={<Users size={26} />} title={L("ไม่พบผู้ใช้ตามตัวกรอง", "No users match", "无匹配用户")} body={activeFilters ? L("ลองล้างตัวกรอง", "Try clearing filters", "请清除筛选") : L("กด “เพิ่มคน” เพื่อเริ่ม", "Tap “Add person”", "点击添加人员")} /></div>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
              {/* ตัวกรองคอลัมน์ */}
              <div className="px-4 py-2.5 border-b border-line flex flex-wrap items-center gap-2">
                <div className="flex overflow-x-auto gap-1 no-scrollbar">
                  {[{ th: "all", label: L("ทุกกลุ่ม", "All groups", "全部") }, ...PERM_GROUPS.map((g) => ({ th: g.th, label: L(g.th, g.en, g.zh) }))].map((g) => (
                    <button key={g.th} onClick={() => setMGroup(g.th)} className={`shrink-0 h-7 px-2.5 rounded-full text-[11px] ${mGroup === g.th ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>{g.label}</button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={mQ} onChange={(e) => setMQ(e.target.value)} placeholder={L("ค้นชื่อสิทธิ์", "Search permission", "搜索权限")} className="h-8 w-44 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none" />
                </div>
                <label className="text-[11px] text-muted inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={mOnlySet} onChange={(e) => setMOnlySet(e.target.checked)} />{L("เฉพาะสิทธิ์ที่ตั้งเอง", "Only customised", "仅自定义")}</label>
              </div>
              <div className="px-4 py-2 border-b border-line flex items-center gap-3 flex-wrap text-[11px] text-muted">
                <span className="font-medium text-ink">{L("คลิกช่องเพื่อกำหนด", "Click a cell", "点击设置")}</span>
                <Legend cls="bg-ok text-white" g="✓" t={L("อนุญาต", "Allow", "允许")} />
                <Legend cls="bg-danger text-white" g="✕" t={L("ห้าม", "Deny", "禁止")} />
                <Legend cls="bg-amber-500 text-white" g="~" t={L("ต้องอนุมัติ", "Approval", "需审批")} />
                <Legend cls="text-muted/50 border border-line" g="✓" t={L("จาง = ตามบทบาท (ค่าปัจจุบัน)", "Faint = by role", "淡色=按角色")} />
              </div>
              {filtered.length && matrixGroups.length ? (
                <div className="overflow-auto max-h-[70vh]">
                  <table className="border-collapse text-xs">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th rowSpan={2} className="sticky left-0 z-30 bg-surface2 border-b border-r border-line px-3 py-2 text-left min-w-[200px]">{L("ผู้ใช้", "User", "用户")} <span className="text-muted font-normal">({filtered.length})</span></th>
                        {matrixGroups.map((g) => (
                          <th key={g.th} colSpan={g.keys.length} className="border-b border-l border-line px-2 py-1.5 text-center text-[10px] uppercase tracking-wide text-muted bg-surface2">{L(g.th, g.en, g.zh)}</th>
                        ))}
                      </tr>
                      <tr>
                        {matrixGroups.flatMap((g) => g.keys).map((k) => (
                          <th key={k} title={`${permLabel(k)} (${k})`} className="border-b border-line px-1 py-1.5 align-bottom bg-surface2/95" style={{ minWidth: 52, maxWidth: 64 }}>
                            <div className="text-[9px] leading-tight text-muted line-clamp-3">{permLabel(k)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((u) => (
                        <tr key={u.id} className="hover:bg-surface2/40">
                          <td className="sticky left-0 z-10 bg-surface border-r border-b border-line px-3 py-1.5">
                            <button onClick={() => openEdit(u)} className="flex items-center gap-2 min-w-0 text-left">
                              <Face src={u.photo_url} name={u.display_name} size={24} />
                              <div className="min-w-0"><p className="text-xs font-medium truncate max-w-[140px]">{u.display_name}</p><p className="text-[9px] text-muted">{roleLabel(u.role)}</p></div>
                            </button>
                          </td>
                          {matrixGroups.flatMap((g) => g.keys).map((k) => {
                            const ov = u.permission_overrides?.[k] as PermissionEffect | undefined;
                            const state: FourState = ov ?? "inherit";
                            const eff: PermissionEffect = ov ?? baseEffect(u.role, k);
                            return (
                              <td key={k} className="border-b border-line/60 text-center p-0.5">
                                <button onClick={() => void saveOverride(u, k, CYCLE[state])}
                                  title={`${u.display_name} · ${permLabel(k)} · ${L(STATE_META[state].th, STATE_META[state].en, STATE_META[state].zh)}`}
                                  className={`w-7 h-7 rounded grid place-items-center mx-auto text-[11px] font-bold transition-colors hover:ring-2 hover:ring-brand/30 ${cellCls(eff, !!ov)}`}>
                                  {eff === "allow" ? "✓" : eff === "deny" ? "✕" : "~"}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="py-14"><EmptyState icon={<Grid3x3 size={24} />} title={L("ไม่มีข้อมูลตามตัวกรอง", "Nothing matches", "无匹配")} /></div>}
            </section>
          )}
        </>
      )}

      {/* ── เพิ่มคนจากระบบกลาง ── */}
      <Drawer open={addOpen} onClose={() => { setAddOpen(false); setQ(""); }} width="md" title={L("เพิ่มคน", "Add person", "添加人员")} subtitle={L("ค้นหาจากระบบกลาง (SSO / Lark)", "Search central directory", "从中央系统搜索")}>
        <div className="p-5 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("เช่น Tiw หรือ name@shd-technology.co.th", "e.g. Tiw or name@…", "例如 Tiw")} className="pl-9" />
            {searching ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">{L("กำลังค้นหา…", "Searching…", "搜索中…")}</span> : null}
          </div>
          <p className="text-[11px] text-muted">{L("พิมพ์ชื่อหรืออีเมลอย่างน้อย 2 ตัวอักษร · คนที่มีอยู่แล้วกดเพื่อแก้ไขได้เลย", "Type 2+ characters · existing people open for editing", "至少 2 个字符")}</p>
          <div className="space-y-1.5">
            {results.map((p) => {
              const already = users.some((u) => (u.email ?? "").toLowerCase() === p.email.toLowerCase());
              return (
                <button key={p.union_id || p.email} onClick={() => openFromCentral(p)} className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-line hover:bg-surface2 text-left">
                  <Face src={p.avatar_url ?? null} name={p.name} />
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-[11px] text-muted truncate">{p.email}</p></div>
                  {already ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-ok/12 text-ok">{L("มีแล้ว · แก้ไข", "Exists · edit", "已有")}</span> : <UserPlus size={15} className="text-brand" />}
                </button>
              );
            })}
            {!searching && q.trim().length >= 2 && !results.length ? <p className="text-xs text-muted text-center py-6">{L("ไม่พบในระบบกลาง", "Not found", "未找到")}</p> : null}
          </div>
        </div>
      </Drawer>

      {/* ── แก้ไขผู้ใช้ (Drawer ขวา) ── */}
      <Drawer
        open={!!draft} onClose={() => setDraft(null)} width="lg"
        title={draft ? draft.display_name : ""}
        subtitle={draft ? (draft.email || L("ไม่มีอีเมล (เข้าด้วย PIN)", "No email (PIN only)", "无邮箱")) : undefined}
        footer={draft ? (
          <>
            <label className="flex items-center gap-2 text-sm mr-auto"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> {L("เปิดใช้งาน", "Active", "启用")}</label>
            <Button variant="ghost" onClick={() => setDraft(null)}>{L("ยกเลิก", "Cancel", "取消")}</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? L("กำลังบันทึก…", "Saving…", "保存中…") : L("บันทึก", "Save", "保存")}</Button>
          </>
        ) : undefined}
      >
        {draft ? (
          <div className="p-5 space-y-6">
            <section className="space-y-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{L("ข้อมูลผู้ใช้", "Profile", "资料")}</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label={L("ชื่อที่แสดง", "Display name", "显示名称")}><Input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></Field>
                <Field label={L("อีเมล (ใช้ล็อกอิน SSO)", "Email (SSO)", "邮箱")}><Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@shd-technology.co.th" /></Field>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label={L("บทบาท", "Role", "角色")}><Select value={draft.role} onChange={(e) => { const role = e.target.value as EmployeeRole; setDraft({ ...draft, role, ...((role === "owner" || role === "hq") ? { data_scope: "company" as DataScope } : {}) }); }}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select></Field>
                <Field label={L("ขอบเขตข้อมูล", "Data scope", "数据范围")}><Select value={draft.data_scope} onChange={(e) => setDraft({ ...draft, data_scope: e.target.value as DataScope })}>{SCOPES.map((s) => <option key={s.v} value={s.v}>{L(s.th, s.en, s.zh)}</option>)}</Select></Field>
                <Field label={L("เพดานส่วนลด (%)", "Max discount (%)", "最大折扣")}><Input type="number" min={0} max={100} value={draft.max_discount_percent} onChange={(e) => setDraft({ ...draft, max_discount_percent: Number(e.target.value) || 0 })} /></Field>
              </div>
              <Field label={draft.id ? L("ตั้ง PIN ใหม่ (เว้นว่าง = คงเดิม)", "New PIN (blank = keep)", "新 PIN") : L("PIN สำหรับล็อกอินหน้าขาย", "POS PIN", "POS PIN")}>
                <Input inputMode="numeric" maxLength={6} value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={draft.id ? L("เว้นว่างไว้ถ้าไม่เปลี่ยน", "Leave blank to keep", "留空不改") : "1234"} className="tracking-widest w-40" />
              </Field>
            </section>

            {draft.data_scope === "branch" || draft.data_scope === "own" ? (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{L("สาขาที่เข้าถึงได้", "Branches", "门店")} <span className="normal-case font-normal">({draft.branch_ids.length})</span></h4>
                  {draft.branch_ids.length ? <button onClick={() => setDraft({ ...draft, branch_ids: [] })} className="text-[11px] text-muted hover:text-ink">{L("ล้าง", "Clear", "清除")}</button> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => {
                    const on = draft.branch_ids.includes(b.id);
                    return <button key={b.id} onClick={() => toggleBranch(b.id)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:bg-surface2"}`}>{b.name_th ?? b.name}</button>;
                  })}
                </div>
              </section>
            ) : null}

            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted mr-auto">
                  {L("สิทธิ์รายข้อ", "Permissions", "权限")} <span className="normal-case font-normal">· {L("ตั้งเอง", "custom", "自定义")} {Object.keys(draft.permission_overrides).length}</span>
                </h4>
                {Object.keys(draft.permission_overrides).length ? <button onClick={() => setDraft({ ...draft, permission_overrides: {} })} className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1"><RotateCcw size={12} />{L("กลับเป็นตามบทบาททั้งหมด", "Reset all to role", "全部重置")}</button> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[{ th: "all", label: L("ทั้งหมด", "All", "全部") }, ...PERM_GROUPS.map((g) => ({ th: g.th, label: L(g.th, g.en, g.zh) }))].map((g) => (
                  <button key={g.th} onClick={() => setDGroup(g.th)} className={`h-7 px-2.5 rounded-full text-[11px] ${dGroup === g.th ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>{g.label}</button>
                ))}
                <div className="relative ml-auto">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={dQ} onChange={(e) => setDQ(e.target.value)} placeholder={L("ค้นสิทธิ์", "Search", "搜索")} className="h-7 w-36 pl-7 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none" />
                </div>
              </div>
              <div className="space-y-4">
                {PERM_GROUPS.filter((g) => dGroup === "all" || g.th === dGroup).map((grp) => {
                  const keys = grp.keys.filter((k) => !dQ.trim() || `${permLabel(k)} ${k}`.toLowerCase().includes(dQ.trim().toLowerCase()));
                  if (!keys.length) return null;
                  return (
                    <div key={grp.th} className="rounded-xl border border-line/70 overflow-hidden">
                      <p className="px-3 py-2 text-[11px] font-semibold bg-surface2/50">{L(grp.th, grp.en, grp.zh)}</p>
                      <div className="divide-y divide-line/50">
                        {keys.map((key) => {
                          const state: FourState = (draft.permission_overrides[key] as PermissionEffect) ?? "inherit";
                          const base = baseEffect(draft.role, key);
                          return (
                            <div key={key} className={`flex items-center gap-3 px-3 py-2 ${draft.permission_overrides[key] ? "bg-brand/[0.03]" : ""}`}>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm truncate">{permLabel(key)}</p>
                                <p className="text-[10px] text-muted">{L("ตามบทบาท", "By role", "按角色")}: {L(STATE_META[base].th, STATE_META[base].en, STATE_META[base].zh)}</p>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0 rounded-lg bg-surface2/70 p-0.5">
                                {(["inherit", "allow", "approval", "deny"] as FourState[]).map((s) => (
                                  <button key={s} onClick={() => setOverride(key, s)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${state === s ? (s === "allow" ? "bg-ok text-white" : s === "deny" ? "bg-danger text-white" : s === "approval" ? "bg-amber-500 text-white" : "bg-surface text-ink shadow-sm") : "text-muted hover:text-ink"}`}>
                                    {L(STATE_META[s].th, STATE_META[s].en, STATE_META[s].zh)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function cellCls(eff: PermissionEffect, strong: boolean) {
  if (eff === "allow") return strong ? "bg-ok text-white" : "text-ok/45";
  if (eff === "deny") return strong ? "bg-danger text-white" : "text-danger/35";
  if (eff === "approval") return strong ? "bg-amber-500 text-white" : "text-amber-500/50";
  return "text-muted/30";
}
function Legend({ cls, g, t }: { cls: string; g: string; t: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`w-4 h-4 rounded grid place-items-center text-[10px] ${cls}`}>{g}</span>{t}</span>;
}
function Face({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-surface2 grid place-items-center text-[10px] font-semibold shrink-0" style={{ width: size, height: size }}>{name.slice(0, 2).toUpperCase()}</div>;
}
function FSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className={`h-9 px-2.5 rounded-xl border text-xs outline-none ${value !== "all" && value !== "active" && value !== "role" ? "border-brand/40 bg-brand/5 text-ink" : "border-line bg-surface2/70 text-muted"}`}>
      {children}
    </select>
  );
}
