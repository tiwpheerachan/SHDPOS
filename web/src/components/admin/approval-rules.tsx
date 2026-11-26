"use client";
// =====================================================================
// สายอนุมัติ (Approval Rules) — มุมมองในหน้าผังองค์กร
//   ตั้งว่าใครอนุมัติ "โอนย้ายสินค้า" ได้ แยกตามแบรนด์ (ครอบทุกสาขา) หรือรายสาขา
//   NOTE: ข้อมูล demo มีแบรนด์/สาขา id ซ้ำ (ชื่อเดียวกันหลาย id) → จัดกลุ่มตามชื่อ
//         และเวลาบันทึกจะเขียนกฎให้ทุก id ที่ชื่อเดียวกัน เพื่อให้ resolver เจอเสมอ
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Pencil, Search, Check, Building2, Store, Users, Info, X } from "lucide-react";
import { Card, Avatar, Button, Modal, Badge, EmptyState } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/permissions";
import type { Brand, Branch, Employee } from "@/lib/types";
import {
  listApprovalRules, setApproverRule, resolveApprovers, type ApprovalRule,
} from "@/lib/data/approval-rules";

type L = (th: string, en: string, zh: string) => string;

interface BrandGroup { key: string; label: string; color?: string | null; ids: string[]; branchCount: number }
interface BranchGroup { key: string; label: string; ids: string[]; sub: string }

export function ApprovalRules({ brands, branches, employees, meId, L }: {
  brands: Brand[]; branches: Branch[]; employees: Employee[]; meId?: string | null; L: L;
}) {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [mode, setMode] = useState<"brand" | "branch">("brand");
  const [edit, setEdit] = useState<{ scope: "brand" | "branch"; ids: string[]; name: string; brandIds?: string[] } | null>(null);

  useEffect(() => { void listApprovalRules().then(setRules); }, []);

  const shopBranches = useMemo(() => branches.filter((b) => b.branch_type !== "warehouse" && b.is_active), [branches]);
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const empName = (id: string) => { const e = empById.get(id); return e ? (e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ") || e.employee_code) : "—"; };
  const bLabel = (b: Branch) => (b.name_th || b.name);
  const activeIds = useMemo(() => new Set(employees.filter((e) => e.status === "active").map((e) => e.id)), [employees]);

  // จัดกลุ่มแบรนด์ตามชื่อ (รวม id ซ้ำ) — เหลือเฉพาะที่มีสาขาจริง มากสุดก่อน
  const brandGroups = useMemo<BrandGroup[]>(() => {
    const byName = new Map<string, BrandGroup>();
    for (const b of brands) {
      const name = b.name_th || b.name;
      const g = byName.get(name) ?? { key: name, label: name, color: b.color, ids: [], branchCount: 0 };
      g.ids.push(b.id);
      g.branchCount += shopBranches.filter((x) => x.brand_id === b.id).length;
      if (!g.color) g.color = b.color;
      byName.set(name, g);
    }
    return [...byName.values()].filter((g) => g.branchCount > 0).sort((a, b) => b.branchCount - a.branchCount);
  }, [brands, shopBranches]);

  // สาขาในกลุ่มแบรนด์ → จัดกลุ่มตามชื่อสาขา (รวม id ซ้ำ)
  const branchGroupsOf = (g: BrandGroup): BranchGroup[] => {
    const inBrand = shopBranches.filter((x) => g.ids.includes(x.brand_id ?? ""));
    const byName = new Map<string, BranchGroup>();
    for (const br of inBrand) {
      const name = bLabel(br);
      const bg = byName.get(name) ?? { key: name, label: name, ids: [], sub: br.province || br.code };
      bg.ids.push(br.id);
      byName.set(name, bg);
    }
    return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label, "th"));
  };

  // อ่านกฎของกลุ่ม (id ใดก็ได้ที่มีกฎ — เขียนให้ตรงกันทุก id อยู่แล้ว)
  const groupRule = (scope: "brand" | "branch", ids: string[]) =>
    ids.map((id) => rules.find((r) => r.process === "transfer" && r.scope === scope && r.scope_id === id)).find(Boolean) ?? null;

  // เขียนกฎให้ทุก id ที่ชื่อเดียวกัน (sequential — แต่ละครั้งอ่าน/เขียน kv ต่อกัน)
  async function onSave(scope: "brand" | "branch", ids: string[], approverIds: string[], override?: boolean) {
    let next = rules;
    for (const id of ids) next = await setApproverRule({ process: "transfer", scope, scope_id: id, approver_ids: approverIds, override_brand: override, by: meId ?? null });
    setRules(next); setEdit(null);
  }

  const Chips = ({ ids, muted }: { ids: string[]; muted?: boolean }) => {
    const live = ids.filter((id) => activeIds.has(id));
    if (!live.length) return <span className="text-xs text-muted">{L("— ยังไม่ได้ตั้ง —", "— not set —", "— 未设置 —")}</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {live.map((id) => (
          <span key={id} className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-0.5 text-xs ${muted ? "border-line bg-surface2 text-muted" : "border-brand/25 bg-brand/5"}`}>
            <Avatar name={empName(id)} src={empById.get(id)?.photo_url ?? undefined} size={18} />
            {empName(id)}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-brand/12 grid place-items-center shrink-0"><ArrowLeftRight size={18} className="text-brand" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold">{L("สายอนุมัติ · โอนย้ายสินค้า", "Approval line · Stock transfer", "审批线 · 调货")}</h2>
              <Badge tone="brand">{L("1 กระบวนการ", "1 process", "1流程")}</Badge>
            </div>
            <p className="text-xs text-muted mt-0.5 flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" /> {L("ตั้งว่าใครกดอนุมัติใบโอนของสาขาต้นทางได้ · ตามแบรนด์ = ครอบทุกสาขาของแบรนด์ · ตามสาขา = เฉพาะสาขานั้น (ตั้งทับแบรนด์ได้) · ถ้าไม่ตั้ง ใช้สิทธิ์เดิม · เจ้าของกิจการ/ผู้ดูแลสูงสุด อนุมัติได้ทุกใบเสมอ", "Who can approve a transfer from the source branch. Brand = all branches; Branch = that branch (can override brand). If unset, permission-based. Owner/superadmin can always approve.", "设置谁可审批调出单。老板/超管始终可审批。")}</p>
          </div>
        </div>
        <div className="mt-3 inline-flex rounded-xl border border-line p-1 bg-surface2">
          {([["brand", L("ตามแบรนด์", "By brand", "按品牌"), Building2], ["branch", L("ตามสาขา", "By branch", "按门店"), Store]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => setMode(v)} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm transition-colors ${mode === v ? "bg-brand text-white" : "text-muted hover:text-brand"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </Card>

      {/* ตามแบรนด์ */}
      {mode === "brand" ? (
        brandGroups.length ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {brandGroups.map((g) => {
              const r = groupRule("brand", g.ids);
              return (
                <Card key={g.key} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-8 h-8 rounded-lg grid place-items-center text-white text-xs font-bold shrink-0" style={{ background: g.color || "rgb(var(--c-brand))" }}>{g.label.slice(0, 2)}</span>
                      <div className="min-w-0"><p className="font-medium truncate">{g.label}</p><p className="text-[11px] text-muted">{g.branchCount} {L("สาขา", "branches", "门店")}</p></div>
                    </div>
                    <Button variant="ghost" className="h-8" onClick={() => setEdit({ scope: "brand", ids: g.ids, name: g.label })}><Pencil size={14} /> {L("แก้ไข", "Edit", "编辑")}</Button>
                  </div>
                  <div><p className="text-[11px] text-muted mb-1.5">{L("ผู้อนุมัติของแบรนด์นี้", "Brand approvers", "品牌审批人")}</p><Chips ids={r?.approver_ids ?? []} /></div>
                </Card>
              );
            })}
          </div>
        ) : <EmptyState icon={<Building2 size={26} />} title={L("ยังไม่มีแบรนด์ที่มีสาขา", "No brands with branches", "无品牌")} />
      ) : null}

      {/* ตามสาขา (จัดกลุ่มใต้แบรนด์) */}
      {mode === "branch" ? (
        <div className="space-y-4">
          {brandGroups.map((g) => {
            const brandRule = groupRule("brand", g.ids);
            const list = branchGroupsOf(g);
            return (
              <div key={g.key} className="space-y-2">
                <div className="flex items-center gap-2 px-1 flex-wrap">
                  <span className="w-5 h-5 rounded grid place-items-center text-white text-[9px] font-bold" style={{ background: g.color || "rgb(var(--c-brand))" }}>{g.label.slice(0, 1)}</span>
                  <p className="text-sm font-semibold">{g.label}</p>
                  <span className="text-[11px] text-muted">· {L("ค่าเริ่มจากแบรนด์", "brand default", "品牌默认")}:</span>
                  <Chips ids={brandRule?.approver_ids ?? []} muted />
                </div>
                <div className="space-y-2">
                  {list.map((bg) => {
                    const r = groupRule("branch", bg.ids);
                    const effective = resolveApprovers(rules, { process: "transfer", branchId: bg.ids[0], brandId: g.ids.find((id) => rules.some((x) => x.scope === "brand" && x.scope_id === id)) ?? g.ids[0] });
                    return (
                      <Card key={bg.key} className="p-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex items-center gap-2">
                            <Store size={15} className="text-muted shrink-0" />
                            <div className="min-w-0"><p className="font-medium text-sm truncate">{bg.label}</p><p className="text-[11px] text-muted">{bg.sub}</p></div>
                          </div>
                          <div className="flex items-center gap-2">
                            {r?.override_brand ? <Badge tone="warn">{L("ไม่รวมแบรนด์", "Override", "覆盖")}</Badge> : null}
                            <Button variant="ghost" className="h-8" onClick={() => setEdit({ scope: "branch", ids: bg.ids, name: bg.label, brandIds: g.ids })}><Pencil size={14} /> {L("แก้ไข", "Edit", "编辑")}</Button>
                          </div>
                        </div>
                        <div className="mt-2 pl-7 space-y-1.5">
                          {r?.approver_ids?.length ? <div><p className="text-[11px] text-muted mb-1">{L("เฉพาะสาขานี้", "Branch-specific", "本店")}</p><Chips ids={r.approver_ids} /></div> : null}
                          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                            <Users size={12} className="text-brand" />
                            <span className="text-muted">{L("อนุมัติได้จริง", "Can approve", "实际可审批")}:</span>
                            {effective === null ? <span className="text-amber-600">{L("ยังไม่ตั้ง → ใช้สิทธิ์เดิม", "unset → permission-based", "未设置")}</span> : <Chips ids={effective} />}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {edit ? (
        <ApproverPicker
          title={edit.scope === "brand" ? L(`ผู้อนุมัติของแบรนด์ · ${edit.name}`, `Brand approvers · ${edit.name}`, `品牌审批人 · ${edit.name}`) : L(`ผู้อนุมัติของสาขา · ${edit.name}`, `Branch approvers · ${edit.name}`, `门店审批人 · ${edit.name}`)}
          scope={edit.scope}
          employees={employees}
          initial={groupRule(edit.scope, edit.ids)?.approver_ids ?? []}
          initialOverride={groupRule(edit.scope, edit.ids)?.override_brand ?? false}
          brandApprovers={edit.scope === "branch" && edit.brandIds ? (groupRule("brand", edit.brandIds)?.approver_ids ?? []) : []}
          empName={empName}
          branchLabel={(id) => { const x = branches.find((y) => y.id === id); return x ? bLabel(x) : "—"; }}
          onClose={() => setEdit(null)}
          onSave={(ids, override) => void onSave(edit.scope, edit.ids, ids, override)}
          L={L}
        />
      ) : null}
    </div>
  );
}

// ── ตัวเลือกผู้อนุมัติ (ค้นหา + ติ๊กหลายคน) ──
function ApproverPicker({ title, scope, employees, initial, initialOverride, brandApprovers, empName, branchLabel, onClose, onSave, L }: {
  title: string; scope: "brand" | "branch"; employees: Employee[];
  initial: string[]; initialOverride: boolean; brandApprovers: string[];
  empName: (id: string) => string; branchLabel: (id: string) => string;
  onClose: () => void; onSave: (ids: string[], override?: boolean) => void; L: L;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const [override, setOverride] = useState(initialOverride);
  const [q, setQ] = useState("");
  const roleText = (r: Employee["role"]) => { const x = ROLE_LABEL[r]; return x ? L(x.th, x.en, x.zh) : r; };
  const pool = useMemo(() => employees.filter((e) => e.status === "active"), [employees]);
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = kw ? pool.filter((e) => `${e.nickname ?? ""} ${e.first_name} ${e.last_name ?? ""} ${e.employee_code} ${roleText(e.role)}`.toLowerCase().includes(kw)) : pool;
    return [...list].sort((a, b) => Number(sel.includes(b.id)) - Number(sel.includes(a.id)));
  }, [pool, q, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-3">
        {scope === "branch" ? (
          <div className="rounded-xl border border-line p-3 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="w-4 h-4 accent-[rgb(var(--c-brand))]" />
              <span className="text-sm">{L("ใช้เฉพาะรายชื่อนี้ (ไม่รวมผู้อนุมัติของแบรนด์)", "Use only these (exclude brand approvers)", "仅用本名单")}</span>
            </label>
            {brandApprovers.length ? <p className="text-[11px] text-muted pl-7">{L("ผู้อนุมัติแบรนด์", "Brand approvers", "品牌审批")}: {brandApprovers.map(empName).join(", ")} {override ? L("(ถูกข้าม)", "(excluded)", "(已排除)") : L("(รวมอยู่ด้วย)", "(included)", "(含)")}</p> : null}
          </div>
        ) : null}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาชื่อ / ตำแหน่ง", "Search name / role", "搜索")} className="w-full h-10 pl-9 pr-3 rounded-xl border border-line bg-surface text-sm" />
        </div>
        <div className="max-h-[48vh] overflow-y-auto -mx-1 px-1 space-y-1">
          {shown.map((e) => {
            const on = sel.includes(e.id);
            return (
              <button key={e.id} onClick={() => toggle(e.id)} className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${on ? "border-brand/40 bg-brand/5" : "border-line hover:bg-surface2"}`}>
                <Avatar name={empName(e.id)} src={e.photo_url ?? undefined} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{empName(e.id)}</p>
                  <p className="text-[11px] text-muted truncate">{roleText(e.role)}{e.home_branch_id ? ` · ${branchLabel(e.home_branch_id)}` : ""}</p>
                </div>
                <span className={`w-5 h-5 rounded-md border grid place-items-center shrink-0 ${on ? "bg-brand border-brand text-white" : "border-line"}`}>{on ? <Check size={13} /> : null}</span>
              </button>
            );
          })}
          {!shown.length ? <p className="text-center text-sm text-muted py-6">{L("ไม่พบพนักงาน", "No employees", "无")}</p> : null}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted">{L("เลือกแล้ว", "Selected", "已选")} {sel.length}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}><X size={15} /> {L("ยกเลิก", "Cancel", "取消")}</Button>
            <Button variant="primary" onClick={() => onSave(sel, override)}><Check size={15} /> {L("บันทึก", "Save", "保存")}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
