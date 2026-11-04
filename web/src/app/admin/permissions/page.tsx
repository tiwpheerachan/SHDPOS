"use client";

import { useEffect, useRef, useState } from "react";
import { Users, Search, Pencil, Trash2, RotateCcw, ShieldCheck, UserPlus, Eye, EyeOff } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches } from "@/lib/data/repo";
import type { Branch, DataScope, EmployeeRole, PermissionEffect } from "@/lib/types";
import { ROLE_LABEL, ROLE_MATRIX, can, type PermissionKey } from "@/lib/permissions";
import { Button, Card, Input, Field, Select, Table, Th, Td, Badge, Modal, EmptyState } from "@/components/ui";

const ROLES: EmployeeRole[] = ["staff", "supervisor", "manager", "brand_admin", "hq", "auditor"];
const SCOPES: { v: DataScope; label: string }[] = [
  { v: "own", label: "เฉพาะตัวเอง" },
  { v: "branch", label: "สาขาที่ระบุ" },
  { v: "brand", label: "แบรนด์ที่ระบุ" },
  { v: "company", label: "ทั้งบริษัท" },
];

const PERM_LABEL: Record<string, string> = {
  "pos.sell": "ขายสินค้า", "pos.price_override": "แก้ราคา", "pos.void": "ยกเลิกบิล",
  "pos.reprint": "พิมพ์ซ้ำ", "pos.open_drawer": "เปิดลิ้นชัก", "pos.quotation": "ใบเสนอราคา",
  "return.create": "รับคืนสินค้า", "return.approve": "อนุมัติคืน",
  "inventory.view": "ดูสต็อก", "inventory.adjust": "ปรับสต็อก", "inventory.count": "นับสต็อก",
  "transfer.request": "ขอโอนย้าย", "transfer.approve": "อนุมัติโอน", "transfer.receive": "รับของโอน",
  "shift.open": "เปิดกะ", "shift.close": "ปิดกะ", "shift.force_close": "ปิดกะแทน", "cash.adjust": "ปรับเงินสด",
  "report.employee_perf": "ดู performance", "report.cost": "ดูต้นทุน", "report.gross_profit": "ดูกำไร",
  "admin.employee_manage": "จัดการพนักงาน", "admin.permission_manage": "กำหนดสิทธิ์ (แอดมิน)",
  "admin.product_manage": "จัดการสินค้า", "admin.branch_manage": "จัดการสาขา", "admin.settings": "ตั้งค่าระบบ",
  "audit.view": "ดู audit log", "customer.manage": "จัดการลูกค้า", "tax.issue_full": "ออกใบกำกับเต็มรูป",
};

const PERM_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  { title: "ขายหน้าร้าน", keys: ["pos.sell", "pos.price_override", "pos.void", "pos.reprint", "pos.open_drawer", "pos.quotation"] },
  { title: "คืนสินค้า", keys: ["return.create", "return.approve"] },
  { title: "สต็อก", keys: ["inventory.view", "inventory.adjust", "inventory.count"] },
  { title: "โอนย้าย", keys: ["transfer.request", "transfer.approve", "transfer.receive"] },
  { title: "กะ & เงินสด", keys: ["shift.open", "shift.close", "shift.force_close", "cash.adjust"] },
  { title: "รายงาน", keys: ["report.employee_perf", "report.cost", "report.gross_profit"] },
  { title: "แอดมิน", keys: ["admin.employee_manage", "admin.permission_manage", "admin.product_manage", "admin.branch_manage", "admin.settings", "audit.view"] },
  { title: "อื่นๆ", keys: ["customer.manage", "tax.issue_full"] },
];

type FourState = "inherit" | PermissionEffect;
const STATE_META: Record<FourState, { label: string }> = {
  inherit: { label: "ตาม role" }, allow: { label: "อนุญาต" }, approval: { label: "อนุมัติก่อน" }, deny: { label: "ห้าม" },
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
      if (!r.ok) { toast.push({ tone: "danger", title: "บันทึกไม่สำเร็จ", body: (await r.json().catch(() => ({}))).error }); return; }
      toast.push({ tone: "ok", title: `บันทึก ${draft.display_name} แล้ว` });
      setDraft(null); await load();
    } finally { setSaving(false); }
  }

  async function removeUser(u: UserRow) {
    if (!confirm(`ลบ ${u.display_name} ออกจากระบบ?`)) return;
    const r = await fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
    if (r.ok) { toast.push({ tone: "ok", title: `ลบ ${u.display_name} แล้ว` }); await load(); }
  }
  async function restoreUser(u: UserRow) {
    const r = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, is_active: true }),
    });
    if (r.ok) { toast.push({ tone: "ok", title: `กู้คืน ${u.display_name} แล้ว` }); await load(); }
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
        <EmptyState icon={<ShieldCheck size={28} />} title="ไม่มีสิทธิ์เข้าหน้านี้" body="ต้องมีสิทธิ์จัดการผู้ใช้/กำหนดสิทธิ์" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2"><Users size={18} className="text-muted" /> ผู้ใช้</h1>
        <p className="text-xs text-muted mt-1">เพิ่มคน · ตั้งบทบาท + สิทธิ์ละเอียด + PIN + สาขา ที่เดียว · เข้าได้ทั้ง SSO และ PIN</p>
      </div>

      {forbidden ? (
        <Card className="p-4"><p className="text-sm text-warn flex items-center gap-2"><ShieldCheck size={16} /> ต้องล็อกอินด้วยบัญชีกลาง (SSO) จึงจะจัดการผู้ใช้ได้</p></Card>
      ) : (
        <>
          <Card className="p-4">
            <Field label="เพิ่มคน (ค้นหาจากระบบกลาง)" hint="พิมพ์ชื่อหรืออีเมลอย่างน้อย 2 ตัวอักษร">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น Tiw หรือ name@shd-technology.co.th" className="pl-9" />
                {searching ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">กำลังค้นหา…</span> : null}
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
                      {already ? <Badge tone="ok">มีแล้ว</Badge> : <UserPlus size={15} className="text-brand" />}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{users.filter((u) => u.status === "active").length} คนใช้งาน</span>
                {users.some((u) => u.status !== "active") ? (
                  <button onClick={() => setShowInactive((v) => !v)} className="text-xs text-muted hover:text-ink underline-offset-2 hover:underline">
                    {showInactive ? "ซ่อนที่ลบแล้ว" : `แสดงที่ลบแล้ว (${users.filter((u) => u.status !== "active").length})`}
                  </button>
                ) : null}
              </div>
              <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />} {reveal ? "ซ่อน PIN" : "แสดง PIN"}
              </button>
            </div>
            {(() => { const shown = users.filter((u) => showInactive || u.status === "active"); return (
            loading ? <p className="text-sm text-muted p-6 text-center">กำลังโหลด…</p> : shown.length ? (
              <Table>
                <thead><tr>
                  <Th>ผู้ใช้</Th><Th>บทบาท</Th><Th>ขอบเขต</Th><Th align="center">PIN</Th><Th align="center">สิทธิ์เฉพาะ</Th><Th align="center">สถานะ</Th><Th align="right">จัดการ</Th>
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
                      <Td>{ROLE_LABEL[u.role]?.th ?? u.role}</Td>
                      <Td>{SCOPES.find((s) => s.v === u.data_scope)?.label ?? u.data_scope}</Td>
                      <Td align="center"><span className="tnum font-semibold tracking-widest">{u.pin ? (reveal ? u.pin : "••••") : "—"}</span></Td>
                      <Td align="center">{Object.keys(u.permission_overrides ?? {}).length || "—"}</Td>
                      <Td align="center">{u.status === "active" ? <Badge tone="ok">ใช้งาน</Badge> : <Badge tone="neutral">ลบแล้ว</Badge>}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          {u.status === "active" ? (
                            <>
                              <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-surface2 text-muted" title="แก้ไข"><Pencil size={15} /></button>
                              <button onClick={() => void removeUser(u)} className="p-1.5 rounded-lg hover:bg-surface2 text-danger" title="ลบ"><Trash2 size={15} /></button>
                            </>
                          ) : (
                            <button onClick={() => void restoreUser(u)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:bg-surface2" title="กู้คืน"><RotateCcw size={13} /> กู้คืน</button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState icon={<Users size={26} />} title={showInactive ? "ไม่มีผู้ใช้" : "ยังไม่มีผู้ใช้ที่ใช้งาน"} body="ค้นหาคนด้านบนเพื่อเพิ่มคน" />
            ); })()}
          </Card>
        </>
      )}

      <Modal
        open={!!draft} onClose={() => setDraft(null)} size="xl"
        title={draft ? `ผู้ใช้ · ${draft.display_name}` : ""}
        footer={draft ? (
          <div className="flex items-center justify-between gap-2 w-full">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> เปิดใช้งาน</label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>ยกเลิก</Button>
              <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึก"}</Button>
            </div>
          </div>
        ) : null}
      >
        {draft ? (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="ชื่อที่แสดง"><Input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></Field>
              <Field label="อีเมล (ใช้ล็อกอิน SSO)"><Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@shd-technology.co.th" /></Field>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="บทบาท (role)"><Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as EmployeeRole })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r].th}</option>)}</Select></Field>
              <Field label="ขอบเขตข้อมูล"><Select value={draft.data_scope} onChange={(e) => setDraft({ ...draft, data_scope: e.target.value as DataScope })}>{SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</Select></Field>
              <Field label="เพดานส่วนลด (%)"><Input type="number" min={0} max={100} value={draft.max_discount_percent} onChange={(e) => setDraft({ ...draft, max_discount_percent: Number(e.target.value) || 0 })} /></Field>
            </div>

            <Field label={draft.id ? "ตั้ง PIN ใหม่ (เว้นว่าง = คงเดิม)" : "PIN สำหรับล็อกอินหน้าขาย"}>
              <Input inputMode="numeric" maxLength={6} value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={draft.id ? "เว้นว่างไว้ถ้าไม่เปลี่ยน" : "เช่น 1234"} className="tracking-widest w-40" />
            </Field>

            {draft.data_scope === "branch" ? (
              <Field label="สาขาที่เข้าถึงได้" hint="ติ๊กสาขาที่คนนี้ดูแล (ใช้กับ PIN login ด้วย)">
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => {
                    const on = draft.branch_ids.includes(b.id);
                    return <button key={b.id} onClick={() => toggleBranch(b.id)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:bg-surface2"}`}>{b.name_th ?? b.name}</button>;
                  })}
                </div>
              </Field>
            ) : null}

            <div>
              <p className="text-sm font-medium mb-2">สิทธิ์รายข้อ <span className="text-[11px] text-muted font-normal">(ค่าเริ่มต้น “ตาม role” — ปรับเฉพาะข้อที่ต่าง)</span></p>
              <div className="space-y-4">
                {PERM_GROUPS.map((grp) => (
                  <div key={grp.title}>
                    <p className="eyebrow mb-1.5">{grp.title}</p>
                    <div className="space-y-1">
                      {grp.keys.map((key) => {
                        const state: FourState = (draft.permission_overrides[key] as PermissionEffect) ?? "inherit";
                        const base = baseEffect(draft.role, key);
                        return (
                          <div key={key} className="flex items-center gap-3 py-1">
                            <div className="min-w-0 flex-1"><p className="text-sm truncate">{PERM_LABEL[key] ?? key}</p><p className="text-[10px] text-muted">ตาม role: {STATE_META[base].label}</p></div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {(["inherit", "allow", "approval", "deny"] as FourState[]).map((s) => (
                                <button key={s} onClick={() => setOverride(key, s)} className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${state === s ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:bg-line"}`}>{STATE_META[s].label}</button>
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
