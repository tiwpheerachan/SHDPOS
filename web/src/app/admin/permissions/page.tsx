"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Search, Pencil, Trash2, ShieldCheck, UserPlus, X } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listBrands } from "@/lib/data/repo";
import type { AppUserGrant, Branch, Brand, DataScope, EmployeeRole, PermissionEffect } from "@/lib/types";
import {
  ROLE_LABEL, ROLE_MATRIX, can, type PermissionKey,
} from "@/lib/permissions";
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

// กลุ่มสิทธิ์สำหรับ UI (ไม่รวม pos.discount — คุมด้วยเพดาน % แยก)
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
const STATE_META: Record<FourState, { label: string; cls: string }> = {
  inherit: { label: "ตาม role", cls: "text-muted" },
  allow: { label: "อนุญาต", cls: "text-ok" },
  approval: { label: "อนุมัติก่อน", cls: "text-warn" },
  deny: { label: "ห้าม", cls: "text-danger" },
};

interface CentralPersonLite {
  union_id: string; name: string; email: string; avatar_url?: string; job_title?: string; departments?: string[];
}

function baseEffect(role: EmployeeRole, key: PermissionKey): PermissionEffect {
  return ROLE_MATRIX[role]?.[key]?.effect ?? "deny";
}

export default function AdminPermissionsPage() {
  const { employee: me } = useSession();
  const toast = useToast();
  const allowed = can(me, "admin.permission_manage");

  const [grants, setGrants] = useState<AppUserGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  // ค้นหาคนจาก directory ระบบกลาง
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CentralPersonLite[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // editor
  const [draft, setDraft] = useState<AppUserGrant | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadGrants() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/grants", { cache: "no-store" });
      if (r.ok) setGrants((await r.json()).grants ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    void loadGrants();
    void (async () => {
      const [b, br] = await Promise.all([listBranches(), listBrands()]);
      setBranches(b);
      setBrands(br);
    })();
  }, [allowed]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/directory?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
        const data = await r.json();
        setResults(data.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [q]);

  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 max-w-[1500px] mx-auto w-full">
        <EmptyState
          icon={<ShieldCheck size={28} />}
          title="ไม่มีสิทธิ์เข้าหน้านี้"
          body="ต้องมีสิทธิ์ 'กำหนดสิทธิ์ (แอดมิน)' จึงจะจัดการสิทธิ์ผู้ใช้ได้"
        />
      </div>
    );
  }

  function openNew(p: CentralPersonLite) {
    const existing = grants.find((g) => g.email.toLowerCase() === p.email.toLowerCase());
    if (existing) {
      setDraft({ ...existing });
    } else {
      setDraft({
        email: p.email,
        union_id: p.union_id,
        display_name: p.name,
        avatar_url: p.avatar_url ?? null,
        role: "staff",
        data_scope: "branch",
        branch_ids: [],
        brand_ids: [],
        max_discount_percent: 0,
        permission_overrides: {},
        is_active: true,
      });
    }
    setQ("");
    setResults([]);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast.push({ tone: "danger", title: "บันทึกไม่สำเร็จ", body: e.error });
        return;
      }
      toast.push({ tone: "ok", title: `บันทึกสิทธิ์ของ ${draft.display_name ?? draft.email} แล้ว` });
      setDraft(null);
      await loadGrants();
    } finally {
      setSaving(false);
    }
  }

  async function remove(email: string) {
    if (!confirm(`ลบสิทธิ์ของ ${email}?`)) return;
    const r = await fetch(`/api/admin/grants?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    if (r.ok) {
      toast.push({ tone: "ok", title: "ลบแล้ว" });
      await loadGrants();
    }
  }

  function setOverride(key: PermissionKey, state: FourState) {
    if (!draft) return;
    const next = { ...draft.permission_overrides };
    if (state === "inherit") delete next[key];
    else next[key] = state;
    setDraft({ ...draft, permission_overrides: next });
  }

  function toggleBranch(id: string) {
    if (!draft) return;
    const has = draft.branch_ids.includes(id);
    setDraft({ ...draft, branch_ids: has ? draft.branch_ids.filter((x) => x !== id) : [...draft.branch_ids, id] });
  }
  function toggleBrand(id: string) {
    if (!draft) return;
    const has = draft.brand_ids.includes(id);
    setDraft({ ...draft, brand_ids: has ? draft.brand_ids.filter((x) => x !== id) : [...draft.brand_ids, id] });
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1500px] mx-auto w-full">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound size={18} className="text-muted" /> สิทธิ์ผู้ใช้
        </h1>
        <p className="text-xs text-muted mt-1">
          ค้นหาพนักงานจากระบบกลาง แล้วกำหนดสิทธิ์รายคนว่าเข้าอะไรได้บ้าง · ผู้ที่ไม่อยู่ในรายการนี้จะเข้าใช้งานไม่ได้
        </p>
      </div>

      {/* ค้นหาเพื่อเพิ่มคน */}
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
              const already = grants.some((g) => g.email.toLowerCase() === p.email.toLowerCase());
              return (
                <button
                  key={p.union_id || p.email}
                  onClick={() => openNew(p)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface2 text-left"
                >
                  {p.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-surface2 grid place-items-center shrink-0 text-xs">{p.name.slice(0, 2)}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-muted truncate">{p.email}</p>
                  </div>
                  {already ? <Badge tone="ok">มีสิทธิ์แล้ว</Badge> : <UserPlus size={15} className="text-brand" />}
                </button>
              );
            })}
          </div>
        ) : null}
      </Card>

      {/* รายชื่อที่มีสิทธิ์ */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="text-sm text-muted p-6 text-center">กำลังโหลด…</p>
        ) : grants.length ? (
          <Table>
            <thead>
              <tr>
                <Th>ผู้ใช้</Th>
                <Th>บทบาท</Th>
                <Th>ขอบเขต</Th>
                <Th align="center">สิทธิ์เฉพาะ</Th>
                <Th align="center">สถานะ</Th>
                <Th align="right">จัดการ</Th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.email}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      {g.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-surface2 grid place-items-center text-xs shrink-0">{(g.display_name ?? g.email).slice(0, 2)}</div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{g.display_name ?? g.email}</p>
                        <p className="text-[11px] text-muted truncate">{g.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{ROLE_LABEL[g.role]?.th ?? g.role}</Td>
                  <Td>{SCOPES.find((s) => s.v === g.data_scope)?.label ?? g.data_scope}</Td>
                  <Td align="center">{Object.keys(g.permission_overrides ?? {}).length || "—"}</Td>
                  <Td align="center">{g.is_active ? <Badge tone="ok">ใช้งาน</Badge> : <Badge tone="neutral">ปิด</Badge>}</Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setDraft({ ...g })} className="p-1.5 rounded-lg hover:bg-surface2 text-muted" title="แก้ไข">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => void remove(g.email)} className="p-1.5 rounded-lg hover:bg-surface2 text-danger" title="ลบ">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<KeyRound size={26} />} title="ยังไม่มีใครได้รับสิทธิ์" body="ค้นหาพนักงานด้านบนเพื่อเพิ่มสิทธิ์คนแรก" />
        )}
      </Card>

      {/* Editor */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        size="xl"
        title={draft ? `กำหนดสิทธิ์ · ${draft.display_name ?? draft.email}` : ""}
        footer={
          draft ? (
            <div className="flex items-center justify-between gap-2 w-full">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                เปิดใช้งานบัญชีนี้
              </label>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)}>ยกเลิก</Button>
                <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึกสิทธิ์"}</Button>
              </div>
            </div>
          ) : null
        }
      >
        {draft ? (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="บทบาทพื้นฐาน (role)">
                <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as EmployeeRole })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r].th}</option>)}
                </Select>
              </Field>
              <Field label="ขอบเขตข้อมูล">
                <Select value={draft.data_scope} onChange={(e) => setDraft({ ...draft, data_scope: e.target.value as DataScope })}>
                  {SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="เพดานส่วนลด (%)">
                <Input
                  type="number" min={0} max={100} value={draft.max_discount_percent}
                  onChange={(e) => setDraft({ ...draft, max_discount_percent: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>

            {draft.data_scope === "branch" ? (
              <Field label="สาขาที่เข้าถึงได้" hint="ติ๊กสาขาที่คนนี้ดูแล">
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => {
                    const on = draft.branch_ids.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => toggleBranch(b.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:bg-surface2"}`}
                      >
                        {b.name_th ?? b.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}

            {draft.data_scope === "brand" ? (
              <Field label="แบรนด์ที่เข้าถึงได้">
                <div className="flex flex-wrap gap-1.5">
                  {brands.map((b) => {
                    const on = draft.brand_ids.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => toggleBrand(b.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:bg-surface2"}`}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}

            {/* ตารางสิทธิ์รายข้อ */}
            <div>
              <p className="text-sm font-medium mb-2">สิทธิ์รายข้อ <span className="text-[11px] text-muted font-normal">(ปรับเฉพาะข้อที่ต่างจาก role — ค่าเริ่มต้นคือ “ตาม role”)</span></p>
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
                            <div className="min-w-0 flex-1">
                              <p className="text-sm truncate">{PERM_LABEL[key] ?? key}</p>
                              <p className="text-[10px] text-muted">ตาม role: {STATE_META[base].label}</p>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {(["inherit", "allow", "approval", "deny"] as FourState[]).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => setOverride(key, s)}
                                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                    state === s ? "bg-brand text-brandInk" : `bg-surface2 ${STATE_META[s].cls} hover:bg-line`
                                  }`}
                                >
                                  {STATE_META[s].label}
                                </button>
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
