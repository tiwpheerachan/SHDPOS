"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, Building2, Plus, Pencil, Trash2, UserPlus, Search, Check, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { Card, CardHeader, Avatar, Button, Select, Field, Modal, EmptyState, Badge } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";
import { ROLE_LABEL, visibleBranchIds } from "@/lib/permissions";
import { useToast } from "@/components/toast-host";
import { loadOrg, upsertOrg, deleteOrg, type OrgEmp, type OrgPos } from "@/lib/data/org";
import { positionLabel, searchPositions, type Locale } from "@/lib/positions";
import { TeamDirectory, type DirMember } from "@/components/admin/team-directory";
import type { EmployeeRole } from "@/lib/types";

const ROLE_TONE: Record<string, string> = {
  staff: "rgb(var(--c-lavender))",
  supervisor: "rgb(var(--c-aqua))",
  manager: "rgb(var(--c-mint))",
  brand_admin: "rgb(var(--c-peach))",
  hq: "rgb(var(--c-lavender))",
  auditor: "rgb(var(--c-surface-2))",
  owner: "rgb(var(--c-brand) / 0.22)",
};

interface TreeNode { emp: OrgEmp; pos: OrgPos | null; children: TreeNode[] }

export default function AdminOrgPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const toast = useToast();
  const { employee } = useSession();
  const { branches } = useAdminScope();

  const shopBranches = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return branches.filter((b) => ids.includes(b.id) && b.branch_type !== "warehouse");
  }, [branches, employee]);

  const [branchId, setBranchId] = useState<string>("");
  const [emps, setEmps] = useState<OrgEmp[]>([]);
  const [positions, setPositions] = useState<OrgPos[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);   // employee_id กำลังแก้
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { if (!branchId && shopBranches.length) setBranchId(shopBranches[0].id); }, [shopBranches, branchId]);

  const toastRef = useRef(toast);
  toastRef.current = toast;
  const load = useCallback(async (bid: string) => {
    if (!bid) return;
    setLoading(true);
    try {
      const { employees, positions } = await loadOrg(bid);
      setEmps(employees); setPositions(positions);
    } catch {
      toastRef.current.push({ tone: "danger", title: L("โหลดไม่สำเร็จ", "Load failed", "加载失败") });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (branchId) void load(branchId); }, [branchId, load]);

  const posByEmp = useMemo(() => new Map(positions.map((p) => [p.employee_id, p])), [positions]);
  const positioned = useMemo(() => emps.filter((e) => posByEmp.has(e.id)), [emps, posByEmp]);
  const unassigned = useMemo(() => emps.filter((e) => !posByEmp.has(e.id)), [emps, posByEmp]);

  // สร้างต้นไม้จาก reports_to (root = ไม่มีหัวหน้า หรือหัวหน้าไม่อยู่ในผัง)
  const roots = useMemo<TreeNode[]>(() => {
    const idSet = new Set(positioned.map((e) => e.id));
    const childrenOf = new Map<string, OrgEmp[]>();
    const rootEmps: OrgEmp[] = [];
    for (const e of positioned) {
      const p = posByEmp.get(e.id)!;
      if (p.reports_to && idSet.has(p.reports_to)) {
        (childrenOf.get(p.reports_to) ?? childrenOf.set(p.reports_to, []).get(p.reports_to)!).push(e);
      } else rootEmps.push(e);
    }
    const build = (e: OrgEmp): TreeNode => ({
      emp: e,
      pos: posByEmp.get(e.id) ?? null,
      children: (childrenOf.get(e.id) ?? [])
        .sort((a, b) => (posByEmp.get(a.id)?.sort_order ?? 0) - (posByEmp.get(b.id)?.sort_order ?? 0))
        .map(build),
    });
    return rootEmps
      .sort((a, b) => (posByEmp.get(a.id)?.sort_order ?? 0) - (posByEmp.get(b.id)?.sort_order ?? 0))
      .map(build);
  }, [positioned, posByEmp]);

  async function savePos(employee_id: string, patch: { title?: string; reports_to?: string | null }) {
    const cur = posByEmp.get(employee_id);
    try {
      await upsertOrg(branchId, employee_id, {
        title: patch.title ?? cur?.title ?? "",
        reports_to: patch.reports_to === undefined ? cur?.reports_to ?? null : patch.reports_to,
        sort_order: cur?.sort_order ?? 0,
      });
      await load(branchId);
    } catch { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败") }); }
  }

  async function removePos(employee_id: string) {
    try { await deleteOrg(branchId, employee_id); await load(branchId); }
    catch { toast.push({ tone: "danger", title: L("ลบไม่สำเร็จ", "Remove failed", "移除失败") }); }
  }

  const roleLabel = (role: string) => ROLE_LABEL[role as EmployeeRole]?.[locale] ?? role;
  const posLabel = (code: string | null | undefined) => positionLabel(code, locale as Locale);
  const branchLabel = (b: { name_th?: string | null; name: string }) => (locale === "th" ? b.name_th ?? b.name : b.name);
  const editEmp = editId ? emps.find((e) => e.id === editId) ?? null : null;

  // ── ข้อมูลการ์ดไดเรกทอรีทีม ──
  const toDir = (e: OrgEmp, inChart: boolean): DirMember => {
    const p = posByEmp.get(e.id);
    return {
      id: e.id,
      name: e.name,
      photo_url: e.photo_url,
      roleLabel: roleLabel(e.role),
      sub: inChart && p?.title ? posLabel(p.title) : (inChart ? L("อยู่ในผัง", "In chart", "在架构中") : L("ยังไม่จัดผัง", "Unassigned", "未安排")),
      tone: ROLE_TONE[e.role],
    };
  };
  const dirFeatured = positioned.map((e) => toDir(e, true));
  const dirAll = emps.map((e) => toDir(e, posByEmp.has(e.id)));
  async function handlePick(id: string) {
    if (posByEmp.has(id)) { setEditId(id); return; }
    await savePos(id, { title: "", reports_to: null });
    setEditId(id);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* หัว + เลือกสาขา */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand/12 grid place-items-center"><Network size={18} className="text-brand" /></span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("ผังองค์กร", "Org chart", "组织架构")}</h1>
            <p className="text-[11px] text-muted">{L("โครงสร้างทีมต่อสาขา · ตั้งตำแหน่งและสายบังคับบัญชา", "Team structure per branch · set positions & reporting line", "各门店团队结构 · 设置职位与汇报关系")}</p>
          </div>
        </div>
        {unassigned.length ? (
          <Button variant="primary" onClick={() => setAddOpen(true)}><UserPlus size={16} /> {L("เพิ่มคนเข้าผัง", "Add to chart", "添加成员")}</Button>
        ) : null}
      </div>

      {/* เลือกสาขา (ชิป) */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shopBranches.map((b) => (
          <button
            key={b.id}
            onClick={() => setBranchId(b.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-medium border transition-colors ${branchId === b.id ? "bg-brand text-brandInk border-brand" : "bg-surface border-line text-muted hover:text-ink hover:bg-surface2"}`}
          >
            <Building2 size={14} /> {branchLabel(b)}
          </button>
        ))}
        {!shopBranches.length ? <p className="text-sm text-muted">{L("ไม่มีสาขาที่คุณดูแล", "No branches in your scope", "没有您负责的门店")}</p> : null}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_440px] gap-4 items-start">
      <Card>
        <CardHeader
          title={L("โครงสร้างทีม", "Team structure", "团队结构")}
          subtitle={`${positioned.length} ${L("ตำแหน่ง", "positions", "个职位")}${unassigned.length ? ` · ${unassigned.length} ${L("ยังไม่จัดผัง", "unassigned", "未安排")}` : ""}`}
        />
        <div className="p-4 overflow-x-auto">
          {loading ? (
            <p className="text-sm text-muted py-10 text-center">{L("กำลังโหลด…", "Loading…", "加载中…")}</p>
          ) : roots.length ? (
            <div className="shd-org min-w-max mx-auto">
              <style>{`
                .shd-org ul { display:flex; justify-content:center; list-style:none; margin:0; padding:24px 0 0; position:relative; }
                .shd-org li { position:relative; padding:24px 10px 0; }
                .shd-org li::before, .shd-org li::after { content:''; position:absolute; top:0; right:50%; width:50%; height:24px; border-top:2px solid rgb(var(--c-line)); }
                .shd-org li::after { right:auto; left:50%; border-left:2px solid rgb(var(--c-line)); }
                .shd-org li:only-child::before, .shd-org li:only-child::after { display:none; }
                .shd-org li:first-child::before, .shd-org li:last-child::after { border:0; }
                .shd-org li:last-child::before { border-right:2px solid rgb(var(--c-line)); }
                .shd-org ul ul::before { content:''; position:absolute; top:0; left:50%; width:0; height:24px; border-left:2px solid rgb(var(--c-line)); }
                .shd-org > ul { padding-top:0; }
                .shd-org > ul > li:only-child { padding-top:0; }
              `}</style>
              <OrgLevel nodes={roots} onEdit={setEditId} roleLabel={roleLabel} posLabel={posLabel} />
            </div>
          ) : (
            <EmptyState
              title={L("ยังไม่มีผังสำหรับสาขานี้", "No chart for this branch yet", "此门店暂无架构")}
              body={unassigned.length ? L("กด ‘เพิ่มคนเข้าผัง’ เพื่อเริ่มสร้าง", "Click ‘Add to chart’ to start", "点击“添加成员”开始") : L("ยังไม่มีพนักงานในสาขานี้", "No staff at this branch", "此门店暂无员工")}
            />
          )}
        </div>
      </Card>

      {/* การ์ดไดเรกทอรีทีม (แอนิเมชัน) */}
      <TeamDirectory
        title={L("ในผังองค์กร", "In org chart", "架构内")}
        featured={dirFeatured}
        all={dirAll}
        featuredCount={positioned.length}
        directoryTitle={L("ไดเรกทอรีพนักงาน", "Staff directory", "员工目录")}
        directorySub={`${emps.length} ${L("คนในสาขานี้", "in this branch", "人")}`}
        searchPlaceholder={L("ค้นหาพนักงาน…", "Search staff…", "搜索员工…")}
        emptyFeatured={L("ยังไม่มีใครในผัง — แตะพนักงานด้านล่างเพื่อเพิ่ม", "No one in the chart — tap staff below to add", "架构中暂无人员 — 点击下方员工添加")}
        onPick={handlePick}
        onAdd={unassigned.length ? () => setAddOpen(true) : undefined}
      />
      </div>

      {/* Modal: เพิ่มคนเข้าผัง */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="sm" title={L("เพิ่มคนเข้าผัง", "Add to chart", "添加成员")}>
        <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
          {unassigned.map((e) => (
            <button
              key={e.id}
              onClick={async () => { await savePos(e.id, { title: "", reports_to: null }); setAddOpen(false); setEditId(e.id); }}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-line hover:bg-surface2 text-left transition-colors"
            >
              <Avatar name={e.name} src={e.photo_url} size={34} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{e.name}</p>
                <p className="text-[11px] text-muted truncate">{e.code} · {roleLabel(e.role)}</p>
              </div>
              <Plus size={16} className="text-brand shrink-0" />
            </button>
          ))}
          {!unassigned.length ? <p className="text-sm text-muted text-center py-6">{L("ทุกคนอยู่ในผังแล้ว", "Everyone is placed", "全部已安排")}</p> : null}
        </div>
      </Modal>

      {/* Modal: แก้ตำแหน่ง/หัวหน้า */}
      <Modal open={!!editId} onClose={() => setEditId(null)} size="sm" title={L("ตั้งตำแหน่ง / หัวหน้า", "Set position / manager", "设置职位 / 上级")}>
        {editEmp ? (
          <EditPanel
            key={editEmp.id}
            emp={editEmp}
            pos={posByEmp.get(editEmp.id) ?? null}
            others={positioned.filter((e) => e.id !== editEmp.id)}
            roleLabel={roleLabel}
            locale={locale as Locale}
            L={L}
            onSave={async (title, reports_to) => { await savePos(editEmp.id, { title, reports_to }); setEditId(null); }}
            onRemove={async () => { await removePos(editEmp.id); setEditId(null); }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

// ---- ระดับหนึ่งของผัง (recursive) ----
function OrgLevel({ nodes, onEdit, roleLabel, posLabel }: { nodes: TreeNode[]; onEdit: (id: string) => void; roleLabel: (r: string) => string; posLabel: (c: string | null | undefined) => string }) {
  return (
    <ul>
      {nodes.map((n) => {
        const title = posLabel(n.pos?.title);
        return (
          <li key={n.emp.id}>
            <button
              onClick={() => onEdit(n.emp.id)}
              className="group relative inline-flex flex-col items-center gap-1.5 w-44 rounded-2xl border border-line bg-surface hover:border-brand hover:shadow-pop px-3 py-3 transition-all"
            >
              <Avatar name={n.emp.name} src={n.emp.photo_url} size={44} />
              <p className="text-sm font-semibold leading-tight text-center line-clamp-1">{n.emp.name}</p>
              {title ? <p className="text-[11px] text-brand font-medium text-center line-clamp-2 leading-snug">{title}</p> : null}
              <Badge tone="brand">{roleLabel(n.emp.role)}</Badge>
              <Pencil size={12} className="absolute top-2 right-2 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            {n.children.length ? <OrgLevel nodes={n.children} onEdit={onEdit} roleLabel={roleLabel} posLabel={posLabel} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---- แผงแก้ไข ----
function EditPanel({
  emp, pos, others, roleLabel, locale, L, onSave, onRemove,
}: {
  emp: OrgEmp; pos: OrgPos | null; others: OrgEmp[];
  roleLabel: (r: string) => string;
  locale: Locale;
  L: (th: string, en: string, zh: string) => string;
  onSave: (title: string, reports_to: string | null) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [code, setCode] = useState(pos?.title ?? "");   // เก็บ code ของตำแหน่ง
  const [reportsTo, setReportsTo] = useState<string>(pos?.reports_to ?? "");
  const [busy, setBusy] = useState(false);
  // dropdown ตำแหน่ง (ค้นหาได้)
  const [posOpen, setPosOpen] = useState(false);
  const [posQuery, setPosQuery] = useState("");
  const posRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!posOpen) return;
    const onDown = (e: MouseEvent) => { if (posRef.current && !posRef.current.contains(e.target as Node)) setPosOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [posOpen]);
  const results = searchPositions(posQuery);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={emp.name} src={emp.photo_url} size={46} />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{emp.full_name || emp.name}</p>
          <p className="text-[11px] text-muted truncate">{emp.code} · {roleLabel(emp.role)}</p>
        </div>
      </div>

      <Field label={L("ตำแหน่ง", "Position", "职位")}>
        <div className="relative" ref={posRef}>
          <button type="button" onClick={() => setPosOpen((o) => !o)} className="input flex items-center justify-between w-full text-left">
            <span className={code ? "" : "text-muted"}>{code ? positionLabel(code, locale) : L("เลือกตำแหน่ง", "Select position", "选择职位")}</span>
            <ChevronDown size={15} className={clsx("text-muted shrink-0 transition-transform", posOpen && "rotate-180")} />
          </button>
          {posOpen ? (
            <div className="mt-1.5 w-full bg-surface2/40 border border-line rounded-xl p-1.5">
              <div className="relative mb-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input autoFocus value={posQuery} onChange={(e) => setPosQuery(e.target.value)} placeholder={L("พิมพ์ค้นหาตำแหน่ง…", "Search position…", "搜索职位…")} className="w-full h-8 pl-8 pr-2 rounded-lg bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {results.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => { setCode(p.code); setPosOpen(false); setPosQuery(""); }}
                    className={clsx("w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left hover:bg-surface2 transition-colors", code === p.code && "text-brand font-medium")}
                  >
                    <span className="truncate">{p[locale]}</span>
                    {code === p.code ? <Check size={14} className="text-brand shrink-0" /> : null}
                  </button>
                ))}
                {!results.length ? <p className="px-2.5 py-2 text-xs text-muted">{L("ไม่พบตำแหน่ง", "No match", "无结果")}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </Field>

      <Field label={L("หัวหน้า (รายงานตรงต่อ)", "Manager (reports to)", "上级（汇报对象）")}>
        <Select value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
          <option value="">{L("— ไม่มี (ระดับบนสุด) —", "— None (top level) —", "— 无（最高层）—")}</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" className="flex-1" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(code, reportsTo || null); } finally { setBusy(false); } }}>
          {L("บันทึก", "Save", "保存")}
        </Button>
        <Button variant="ghost" className="text-danger" disabled={busy} onClick={async () => { setBusy(true); try { await onRemove(); } finally { setBusy(false); } }}>
          <Trash2 size={15} /> {L("เอาออก", "Remove", "移除")}
        </Button>
      </div>
    </div>
  );
}
