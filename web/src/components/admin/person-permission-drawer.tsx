"use client";

// แผงขวา (Drawer) ตั้งสิทธิ์รายคนแบบละเอียด — ใช้ร่วมทั้งโฟลเดอร์ทีมและผังองค์กร
import { useEffect, useState, type ReactNode } from "react";
import { Building2, ExternalLink, TrendingUp } from "lucide-react";
import { Drawer, Avatar } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import type { Branch, Employee, PermissionEffect } from "@/lib/types";
import { ROLE_LABEL, type PermissionKey } from "@/lib/permissions";
import { PERM_GROUPS, PERM_LABEL, STATE_META, baseEffect, type FourState, saveUserGrant } from "@/lib/permissions-ui";

type Locale = "th" | "en" | "zh";

function fullName(e: Employee) {
  return [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || e.employee_code;
}
function displayFor(e: Employee) {
  return e.nickname ? `${fullName(e)} (${e.nickname})` : fullName(e);
}

export function PersonPermissionDrawer({
  person, onClose, canManage, locale, L, branches, footer,
}: {
  person: Employee | null;
  onClose: () => void;
  canManage: boolean;
  locale: Locale;
  L: (th: string, en: string, zh: string) => string;
  branches: Branch[];
  footer?: ReactNode;
}) {
  const toast = useToast();
  const [overrides, setOverrides] = useState<Record<string, PermissionEffect>>({});

  useEffect(() => {
    setOverrides({ ...(person?.permission_overrides ?? {}) });
  }, [person?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setState(key: PermissionKey, next: FourState) {
    if (!person || !canManage) return;
    const ov = { ...overrides };
    if (next === "inherit") delete ov[key]; else ov[key] = next;
    setOverrides(ov); // optimistic
    const r = await saveUserGrant({
      id: person.id,
      display_name: fullName(person),
      nickname: person.nickname ?? null,
      role: person.role,
      data_scope: person.data_scope,
      branch_ids: person.branch_ids ?? [],
      max_discount_percent: person.max_discount_percent,
      permission_overrides: ov,
      pin: "",
      is_active: person.status === "active",
    });
    if (!r || !r.ok) {
      toast.push({
        tone: "danger",
        title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"),
        body: r?.status === 403
          ? L("ต้องเข้าสู่ระบบด้วยบัญชีแอดมิน (SSO) จริง", "Needs a live SSO-admin session", "需要正式 SSO 管理员登录")
          : undefined,
      });
    }
  }

  const homeBranch = person?.home_branch_id
    ? (branches.find((b) => b.id === person.home_branch_id)?.name_th || branches.find((b) => b.id === person.home_branch_id)?.name || "—")
    : "—";

  return (
    <Drawer
      open={!!person}
      onClose={onClose}
      width="md"
      title={person ? displayFor(person) : ""}
      subtitle={person ? (ROLE_LABEL[person.role]?.[locale] ?? person.role) : undefined}
      badge={<a href="/admin/permissions" className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-brand"><ExternalLink size={12} /> {L("หน้ากำหนดสิทธิ์เต็ม", "Full permissions page", "完整权限页")}</a>}
      footer={footer}
    >
      {person ? (
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={person.photo_url ?? undefined} name={fullName(person)} size={56} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold truncate">{displayFor(person)}</p>
              <p className="text-xs text-muted truncate flex items-center gap-1.5">
                <Building2 size={12} /> {homeBranch}{person.employee_code ? ` · ${person.employee_code}` : ""}
              </p>
            </div>
            <a
              href={`/admin/employees?person=${encodeURIComponent(person.id)}`}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-xs font-medium text-muted hover:text-brand hover:bg-surface2 transition-colors"
            >
              <TrendingUp size={14} /> {L("ดู performance", "Performance", "业绩")}
            </a>
          </div>

          {!canManage ? (
            <p className="text-xs text-muted bg-surface2 rounded-lg p-2.5">{L("คุณไม่มีสิทธิ์แก้สิทธิ์ (ดูอย่างเดียว)", "You can't edit permissions (view only)", "您无权修改权限（仅查看）")}</p>
          ) : (
            <p className="text-[11px] text-muted">{L("ค่าเริ่มต้น “ตาม role” — ปรับเฉพาะข้อที่ต่าง", "Default “by role” — adjust only what differs", "默认“按角色”——仅调整不同项")}</p>
          )}

          <div className="space-y-4">
            {PERM_GROUPS.map((grp) => (
              <div key={grp.th}>
                <p className="eyebrow mb-1.5">{L(grp.th, grp.en, grp.zh)}</p>
                <div className="space-y-1">
                  {grp.keys.map((key) => {
                    const state: FourState = (overrides[key] as PermissionEffect) ?? "inherit";
                    const base = baseEffect(person.role, key);
                    const pl = PERM_LABEL[key];
                    return (
                      <div key={key} className="flex items-center gap-3 py-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{pl ? L(pl.th, pl.en, pl.zh) : key}</p>
                          <p className="text-[10px] text-muted">{L("ตาม role", "By role", "按角色")}: {L(STATE_META[base].th, STATE_META[base].en, STATE_META[base].zh)}</p>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {(["inherit", "allow", "approval", "deny"] as FourState[]).map((s) => (
                            <button
                              key={s}
                              disabled={!canManage}
                              onClick={() => setState(key, s)}
                              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${state === s ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:bg-line"}`}
                            >{L(STATE_META[s].th, STATE_META[s].en, STATE_META[s].zh)}</button>
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
      ) : null}
    </Drawer>
  );
}
