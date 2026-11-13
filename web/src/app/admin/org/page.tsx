"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { Network, Plus, Pencil, Trash2, UserPlus, Search, Check, ChevronDown, RefreshCw, Sparkles, ShieldCheck, ChevronLeft, Users, GripVertical } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { Card, CardHeader, Avatar, Button, Select, Field, Modal, EmptyState, Badge } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";
import { ROLE_LABEL, visibleBranchIds, can } from "@/lib/permissions";
import { TeamFolders } from "@/components/admin/team-folders";
import { PersonPermissionDrawer } from "@/components/admin/person-permission-drawer";
import { listEmployees, listBrands } from "@/lib/data/repo";
import type { Employee, Brand } from "@/lib/types";
import { useToast } from "@/components/toast-host";
import { loadOrg, upsertOrg, deleteOrg, type OrgEmp, type OrgPos } from "@/lib/data/org";
import { refreshDirectory } from "@/lib/data/repo";
import { positionLabel, searchPositions, type Locale } from "@/lib/positions";
import { jobTitleToPositionCode } from "@/lib/sso/map-central";
import { BorderBeam } from "@/components/ui/border-beam";
import type { EmployeeRole } from "@/lib/types";

// สีพื้น pill ตำแหน่ง (ตาม role) — ใช้ในรายชื่อพนักงานในร้าน
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
  const [view, setView] = useState<"folders" | "chart">("folders"); // landing = โฟลเดอร์
  const [allEmps, setAllEmps] = useState<Employee[]>([]);
  const [brandList, setBrandList] = useState<Brand[]>([]);
  const [permPerson, setPermPerson] = useState<Employee | null>(null);
  const [pendingAdd, setPendingAdd] = useState<OrgEmp | null>(null); // คนที่สาขา Lark ไม่ตรง รอยืนยัน
  const canManage = can(employee, "admin.employee_manage");
  // ความกว้างคอลัมน์ซ้าย (ผังตำแหน่ง) — default ใหญ่กว่า, ลากปรับได้
  const [leftPct, setLeftPct] = useState(62);
  const splitRef = useRef<HTMLDivElement>(null);
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const pct = ((ev.clientX - r.left) / r.width) * 100;
      setLeftPct(Math.min(78, Math.max(32, pct)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  useEffect(() => {
    void listEmployees().then(setAllEmps);
    void listBrands().then(setBrandList);
  }, []);

  // คลิกโฟลเดอร์ (ร้าน) → เข้าผังองค์กรของร้านนั้น; ถ้าคลิกการ์ดคน → เปิดตั้งสิทธิ์เลย
  const openStore = useCallback((bid: string | null, person?: Employee) => {
    if (bid) setBranchId(bid);
    setView("chart");
    if (person) setPermPerson(person);
  }, []);
  // คลิกพนักงานในผัง → เปิดแผงตั้งสิทธิ์ (หาข้อมูลเต็มจาก allEmps)
  const pickPerson = useCallback((empId: string) => {
    const e = allEmps.find((x) => x.id === empId);
    if (e) setPermPerson(e);
  }, [allEmps]);

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

  // พนักงานในร้านที่เปิดอยู่ = ผูกสาขา (home_branch/branch_ids) หรืออยู่ในผังตำแหน่งของสาขานี้
  // รวมสองแบบให้ "คนในร้านนี้" ตรงกับผังองค์กร — โชว์ใน chart + คลิกตั้งสิทธิ์
  const storeStaff = useMemo(() => {
    const active = allEmps.filter((e) => e.status === "active");
    if (branchId) return active.filter((e) => e.home_branch_id === branchId || (e.branch_ids ?? []).includes(branchId) || posByEmp.has(e.id));
    // ทีมส่วนกลาง (ไม่ผูกร้านไหน)
    const assigned = new Set(
      shopBranches.flatMap((b) => active.filter((e) => e.home_branch_id === b.id || (e.branch_ids ?? []).includes(b.id)).map((e) => e.id))
    );
    return active.filter((e) => !assigned.has(e.id));
  }, [allEmps, branchId, shopBranches, posByEmp]);

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

  // ── เพิ่มคนเข้าผังของสาขานี้ + ตรวจสาขาที่ผูกใน Lark ──
  const curStoreName = useMemo(() => {
    const b = shopBranches.find((x) => x.id === branchId);
    return b ? branchLabel(b) : "";
  }, [shopBranches, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  // สาขาใน Lark (central_branch) ไม่ตรงกับสาขาที่กำลังจะเพิ่มเข้าไหม
  const larkBranchMismatch = (e: OrgEmp) => {
    const cb = (e.central_branch ?? "").trim();
    if (!cb || !curStoreName) return false;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
    const a = norm(cb), b = norm(curStoreName);
    return !(a.includes(b) || b.includes(a));
  };
  const doAddToChart = async (e: OrgEmp) => {
    await savePos(e.id, { title: "", reports_to: null });
    setPendingAdd(null);
    setAddOpen(false);
    setEditId(e.id); // เปิดแผงตั้งตำแหน่ง/หัวหน้า (เติมค่าจาก Lark อัตโนมัติ)
  };
  const tryAddToChart = (e: OrgEmp) => {
    if (larkBranchMismatch(e)) setPendingAdd(e); // ถาม "แน่ใจไหมว่าจะลงสาขานี้"
    else void doAddToChart(e);
  };

  // union_id → employee id (ไว้แปลงหัวหน้าจาก SSO)
  const unionToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of emps) if (e.union_id) m.set(e.union_id, e.id);
    return m;
  }, [emps]);

  // ค้นหา + เพิ่มคนจาก Lark directory (org-only)
  const [centralQ, setCentralQ] = useState("");
  const [centralRes, setCentralRes] = useState<{ union_id: string; name: string; email: string; job_title?: string; departments?: string[]; avatar_url?: string }[]>([]);
  const [centralBusy, setCentralBusy] = useState(false);
  async function searchCentral() {
    if (centralQ.trim().length < 2) { setCentralRes([]); return; }
    setCentralBusy(true);
    try {
      const r = await fetch(`/api/admin/directory?q=${encodeURIComponent(centralQ.trim())}`);
      const j = await r.json();
      if (r.ok) setCentralRes(j.items ?? []);
      else toast.push({ tone: "danger", title: j.error === "forbidden" ? L("ต้องเข้าสู่ระบบด้วย SSO", "SSO login required", "需用 SSO 登录") : (j.error ?? "search failed") });
    } catch { toast.push({ tone: "danger", title: L("ค้นหาไม่สำเร็จ", "Search failed", "搜索失败") }); }
    finally { setCentralBusy(false); }
  }
  async function addFromCentral(p: { email: string; union_id: string }) {
    if (!branchId) return;
    try {
      const r = await fetch("/api/admin/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch_id: branchId, email: p.email, union_id: p.union_id }) });
      const j = await r.json();
      if (r.ok) {
        await refreshDirectory();
        await load(branchId);
        setAddOpen(false); setCentralRes([]); setCentralQ("");
        toast.push({ tone: "ok", title: L("เพิ่มเข้าผังแล้ว", "Added to chart", "已加入架构") });
      } else toast.push({ tone: "danger", title: j.error ?? "add failed" });
    } catch { toast.push({ tone: "danger", title: L("เพิ่มไม่สำเร็จ", "Add failed", "添加失败") }); }
  }

  const [syncing, setSyncing] = useState(false);
  async function syncSSO() {
    setSyncing(true);
    try {
      const r = await fetch("/api/admin/sso-sync", { method: "POST" });
      const j = await r.json();
      if (r.ok) {
        toast.push({ tone: "ok", title: L("ดึงข้อมูล SSO สำเร็จ", "Synced from SSO", "已同步 SSO"), body: `${j.synced}/${j.total} · ${L("แมปสาขา", "branch matched", "匹配门店")} ${j.branchMatched}` });
        if (branchId) await load(branchId);
      } else {
        toast.push({ tone: "danger", title: j.error === "forbidden" ? L("ต้องเข้าสู่ระบบด้วย SSO", "SSO login required", "需用 SSO 登录") : (j.error ?? "sync failed") });
      }
    } catch { toast.push({ tone: "danger", title: L("ดึงข้อมูลไม่สำเร็จ", "Sync failed", "同步失败") }); }
    finally { setSyncing(false); }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* หัว + เลือกสาขา */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {view === "chart" ? (
            <button
              onClick={() => setView("folders")}
              className="inline-flex items-center gap-1 h-9 px-2.5 rounded-xl border border-line text-sm text-muted hover:text-brand hover:bg-surface2 transition-colors"
            >
              <ChevronLeft size={15} /> {L("โฟลเดอร์ทีม", "Team folders", "团队文件夹")}
            </button>
          ) : null}
          <span className="w-9 h-9 rounded-xl bg-brand/12 grid place-items-center"><Network size={18} className="text-brand" /></span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("ผังองค์กร", "Org chart", "组织架构")}</h1>
            <p className="text-[11px] text-muted">{L("โครงสร้างทีมต่อสาขา · ตั้งตำแหน่งและสายบังคับบัญชา", "Team structure per branch · set positions & reporting line", "各门店团队结构 · 设置职位与汇报关系")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/admin/permissions" className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-line text-sm text-muted hover:text-brand hover:bg-surface2 transition-colors">
            <ShieldCheck size={15} /> {L("กำหนดสิทธิ์", "Permissions", "权限")}
          </a>
          <Button variant="ghost" onClick={() => void syncSSO()} disabled={syncing}>
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {L("ดึงข้อมูลจาก SSO", "Sync from SSO", "同步 SSO")}
          </Button>
          {unassigned.length ? (
            <Button variant="primary" onClick={() => setAddOpen(true)}><UserPlus size={16} /> {L("เพิ่มคนเข้าผัง", "Add to chart", "添加成员")}</Button>
          ) : null}
        </div>
      </div>

      {view === "folders" ? (
        <TeamFolders branches={shopBranches} brands={brandList} employees={allEmps} locale={locale} L={L} onOpenStore={openStore} />
      ) : (<>
      {/* กล่องเนื้อหาร้าน — พื้นหลัง dot เหมือนหน้าโฟลเดอร์ */}
      <div
        className="rounded-2xl border border-line p-3 sm:p-4 space-y-3"
        style={{ backgroundImage: "radial-gradient(rgb(var(--c-muted) / 0.2) 1px, transparent 1.4px)", backgroundSize: "20px 20px" }}
      >
        {(() => {
          const hasTree = !loading && roots.length > 0;
          const storeName = (() => { const cb = shopBranches.find((b) => b.id === branchId); return cb ? branchLabel(cb) : L("ทีมส่วนกลาง", "Central team", "中央团队"); })();
          // การ์ดรายชื่อ + ตั้งสิทธิ์ (สไตล์ Access Manager)
          const roster = (
            <Card className="h-full">
              <div className="flex items-center justify-between gap-3 p-4 pb-3 border-b border-line/60">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-brand/12 grid place-items-center shrink-0"><ShieldCheck size={18} className="text-brand" /></span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold leading-tight truncate">{storeName}</h2>
                    <p className="text-xs text-muted truncate">{L("คลิกคนเพื่อกำหนดสิทธิ์การเข้าถึง", "Click a person to set access", "点击设置访问权限")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-muted shrink-0"><Users size={15} /><span className="text-xs whitespace-nowrap">{storeStaff.length} {L("คน", "members", "人")}</span></div>
              </div>
              <div className="px-4 pb-3 pt-2">
                {storeStaff.length ? (
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
                    className={`${hasTree ? "space-y-0.5" : "grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0.5"}`}
                  >
                    {storeStaff.map((e) => {
                      const nm = [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || e.employee_code;
                      const nOv = Object.keys(e.permission_overrides ?? {}).length;
                      const pos = posByEmp.get(e.id);
                      const sub = pos?.title ? posLabel(pos.title) : (ROLE_LABEL[e.role]?.[locale] ?? e.role);
                      return (
                        <motion.button
                          key={e.id}
                          type="button"
                          onClick={() => pickPerson(e.id)}
                          variants={{ hidden: { opacity: 0, x: 10, y: 15 }, visible: { opacity: 1, x: 0, y: 0 } }}
                          transition={{ type: "spring", stiffness: 400, damping: 35, mass: 0.5 }}
                          className="flex items-center w-full text-left group py-2.5 px-2 -mx-1 rounded-xl border-b border-line/40 last:border-0 hover:bg-surface2/60 transition-colors"
                        >
                          <Avatar name={nm} src={e.photo_url} size={44} className="mr-3 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate leading-tight">{nm}</p>
                            <p className="text-xs text-muted truncate mt-0.5 leading-tight">{sub}</p>
                          </div>
                          {nOv ? <Badge tone="brand" className="mr-1.5 shrink-0">{nOv}</Badge> : null}
                          <span
                            className="shrink-0 text-[10px] font-semibold tracking-wide px-2.5 py-1 rounded-full border border-line/60 text-ink/80 whitespace-nowrap max-w-[110px] truncate"
                            style={{ background: ROLE_TONE[e.role] }}
                          >
                            {ROLE_LABEL[e.role]?.[locale] ?? e.role}
                          </span>
                        </motion.button>
                      );
                    })}
                  </motion.div>
                ) : (
                  <EmptyState title={L("ยังไม่มีพนักงานผูกกับร้านนี้", "No staff linked to this store", "此门店暂无绑定员工")} />
                )}
              </div>
            </Card>
          );
          if (!hasTree) return roster;
          const tree = (
            <Card className="h-full">
              <CardHeader
                title={L("โครงสร้างทีม (ผังตำแหน่ง)", "Team structure", "团队结构")}
                subtitle={`${positioned.length} ${L("ตำแหน่ง", "positions", "个职位")}${unassigned.length ? ` · ${unassigned.length} ${L("ยังไม่จัดผัง", "unassigned", "未安排")}` : ""}`}
              />
              <div className="p-4 overflow-x-auto">
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
                  <OrgLevel nodes={roots} onEdit={setEditId} onPick={pickPerson} roleLabel={roleLabel} posLabel={posLabel} />
                </div>
              </div>
            </Card>
          );
          // สองกรอบแนวเดียวกัน (ผังตำแหน่งกว้างกว่า default) · ลากตัวคั่นปรับความกว้างได้
          return (
            <div ref={splitRef} className="flex flex-col lg:flex-row items-stretch gap-3 lg:gap-0" style={{ "--lw": `${leftPct}%` } as CSSProperties}>
              <div className="w-full lg:w-[var(--lw)] lg:shrink-0 min-w-0">{tree}</div>
              <div
                onPointerDown={startResize}
                role="separator"
                aria-orientation="vertical"
                title={L("ลากเพื่อปรับความกว้าง", "Drag to resize", "拖动调整宽度")}
                className="hidden lg:flex items-center justify-center w-4 shrink-0 cursor-col-resize group self-stretch"
              >
                <div className="w-5 h-12 rounded-full bg-line/50 group-hover:bg-brand/40 grid place-items-center transition-colors">
                  <GripVertical size={14} className="text-muted group-hover:text-brand transition-colors" />
                </div>
              </div>
              <div className="w-full lg:flex-1 min-w-0">{roster}</div>
            </div>
          );
        })()}
      </div>
      </>)}

      {/* แผงขวา: ตั้งสิทธิ์รายคน (จากผังองค์กร) */}
      <PersonPermissionDrawer
        person={permPerson}
        onClose={() => setPermPerson(null)}
        canManage={canManage}
        locale={locale}
        L={L}
        branches={branches}
        footer={permPerson ? (
          <Button variant="ghost" onClick={() => { const id = permPerson.id; setPermPerson(null); setEditId(id); }}>
            <Pencil size={14} /> {L("แก้ตำแหน่งในผัง", "Edit position", "编辑职位")}
          </Button>
        ) : undefined}
      />

      {/* Modal: เพิ่มคนเข้าผัง */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="sm" title={L("เพิ่มคนเข้าผัง", "Add to chart", "添加成员")}>
        <div className="space-y-4">
          {/* คนในระบบที่ยังไม่จัดผัง */}
          {unassigned.length ? (
            <div>
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">{L("ในระบบ", "In system", "系统内")}</p>
              <div className="grid gap-2 max-h-[32vh] overflow-y-auto">
                {unassigned.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => tryAddToChart(e)}
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-line hover:bg-surface2 text-left transition-colors"
                  >
                    <Avatar name={e.name} src={e.photo_url} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{e.name}</p>
                      <p className="text-[11px] text-muted truncate">{e.code} · {roleLabel(e.role)}{e.central_branch ? ` · ${e.central_branch}` : ""}</p>
                    </div>
                    {e.central_branch && larkBranchMismatch(e) ? <span className="text-[10px] text-warn shrink-0">{L("ต่างสาขา", "Diff. branch", "跨门店")}</span> : null}
                    <Plus size={16} className="text-brand shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* ค้นหาจากองค์กร (Lark directory) → เพิ่มแบบ org-only */}
          <div className="pt-1 border-t border-line">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5 mt-3">{L("ค้นจากองค์กร (Lark)", "From org directory (Lark)", "组织目录 (Lark)")}</p>
            <BorderBeam radius={12} duration={3.2} active={centralBusy || !!centralQ.trim()} className="mb-2 block">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted z-10" />
                <input
                  value={centralQ}
                  onChange={(e) => setCentralQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void searchCentral(); }}
                  placeholder={L("พิมพ์ชื่อ/อีเมล แล้วกด Enter", "Type name/email then Enter", "输入姓名/邮箱后回车")}
                  className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface2 border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </BorderBeam>
            {centralBusy ? <p className="text-xs text-muted py-2 text-center">{L("กำลังค้นหา…", "Searching…", "搜索中…")}</p> : null}
            <div className="grid gap-2 max-h-[32vh] overflow-y-auto">
              {centralRes.map((p) => (
                <button
                  key={p.union_id}
                  onClick={() => void addFromCentral({ email: p.email, union_id: p.union_id })}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-line hover:bg-surface2 text-left transition-colors"
                >
                  <Avatar name={p.name} src={p.avatar_url} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-muted truncate">{[p.job_title, p.departments?.[0]].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Plus size={16} className="text-brand shrink-0" />
                </button>
              ))}
              {!centralBusy && centralQ.trim().length >= 2 && !centralRes.length ? (
                <p className="text-xs text-muted text-center py-3">{L("ไม่พบในองค์กร", "Not found", "未找到")}</p>
              ) : null}
            </div>
          </div>

          {!unassigned.length && !centralRes.length && !centralQ ? (
            <p className="text-sm text-muted text-center py-2">{L("ทุกคนอยู่ในผังแล้ว · หรือค้นจากองค์กรด้านบน", "Everyone placed · or search the org above", "全部已安排 · 或从上方搜索")}</p>
          ) : null}
        </div>
      </Modal>

      {/* Modal: ยืนยันเมื่อสาขาใน Lark ไม่ตรงกับสาขาที่กำลังเพิ่มเข้า */}
      <Modal open={!!pendingAdd} onClose={() => setPendingAdd(null)} size="sm" title={L("ยืนยันสาขา", "Confirm branch", "确认门店")}>
        {pendingAdd ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={pendingAdd.name} src={pendingAdd.photo_url} size={44} />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{pendingAdd.name}</p>
                <p className="text-[11px] text-muted truncate">{pendingAdd.code} · {roleLabel(pendingAdd.role)}</p>
              </div>
            </div>
            <div className="text-sm bg-warn/10 border border-warn/30 rounded-xl p-3 space-y-1.5">
              <p className="text-muted">{L("สาขาที่ผูกใน Lark", "Branch linked in Lark", "Lark 绑定门店")}: <span className="text-ink font-medium">{pendingAdd.central_branch || "—"}</span></p>
              <p className="text-muted">{L("กำลังจะเพิ่มเข้า", "Adding into", "将加入")}: <span className="text-ink font-medium">{curStoreName || "—"}</span></p>
              <p className="text-ink pt-1">{L("สองสาขาไม่ตรงกัน แน่ใจไหมว่าจะให้ลงสาขานี้?", "The two branches differ — are you sure you want to place them here?", "两者不一致，确定要放到此门店吗？")}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setPendingAdd(null)}>{L("ยกเลิก", "Cancel", "取消")}</Button>
              <Button variant="primary" onClick={() => void doAddToChart(pendingAdd)}>{L("ยืนยัน ลงสาขานี้", "Confirm, add here", "确认加入")}</Button>
            </div>
          </div>
        ) : null}
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
            ssoTitle={editEmp.job_title ?? null}
            ssoBranch={editEmp.central_branch ?? null}
            ssoPositionCode={jobTitleToPositionCode(editEmp.job_title ?? undefined)}
            ssoManagerId={editEmp.manager_union_id ? unionToId.get(editEmp.manager_union_id) ?? null : null}
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
function OrgLevel({ nodes, onEdit, onPick, roleLabel, posLabel }: { nodes: TreeNode[]; onEdit: (id: string) => void; onPick: (id: string) => void; roleLabel: (r: string) => string; posLabel: (c: string | null | undefined) => string }) {
  return (
    <ul>
      {nodes.map((n) => {
        const title = posLabel(n.pos?.title);
        return (
          <li key={n.emp.id}>
            <div
              onClick={() => onPick(n.emp.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n.emp.id); } }}
              role="button"
              tabIndex={0}
              title={posLabel(n.pos?.title) || roleLabel(n.emp.role)}
              className="group relative inline-flex flex-col items-center gap-1.5 w-44 rounded-2xl border border-line bg-surface hover:border-brand hover:shadow-pop px-3 py-3 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Avatar name={n.emp.name} src={n.emp.photo_url} size={44} />
              <p className="text-sm font-semibold leading-tight text-center line-clamp-1">{n.emp.name}</p>
              {title ? <p className="text-[11px] text-brand font-medium text-center line-clamp-2 leading-snug">{title}</p> : null}
              <Badge tone="brand">{roleLabel(n.emp.role)}</Badge>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(n.emp.id); }}
                title="แก้ตำแหน่ง / สายบังคับบัญชา"
                className="absolute top-1.5 right-1.5 p-1 rounded-lg text-muted opacity-0 group-hover:opacity-100 hover:bg-surface2 hover:text-brand transition-all"
              >
                <Pencil size={13} />
              </button>
            </div>
            {n.children.length ? <OrgLevel nodes={n.children} onEdit={onEdit} onPick={onPick} roleLabel={roleLabel} posLabel={posLabel} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---- แผงแก้ไข ----
function EditPanel({
  emp, pos, others, roleLabel, locale, ssoTitle, ssoBranch, ssoPositionCode, ssoManagerId, L, onSave, onRemove,
}: {
  emp: OrgEmp; pos: OrgPos | null; others: OrgEmp[];
  roleLabel: (r: string) => string;
  locale: Locale;
  ssoTitle?: string | null;
  ssoBranch?: string | null;
  ssoPositionCode?: string | null;
  ssoManagerId?: string | null;
  L: (th: string, en: string, zh: string) => string;
  onSave: (title: string, reports_to: string | null) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [code, setCode] = useState(pos?.title || ssoPositionCode || "");   // เก็บ code ของตำแหน่ง (เติมจาก Lark ถ้ายังว่าง)
  const [reportsTo, setReportsTo] = useState<string>(pos?.reports_to || ssoManagerId || "");
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

      {ssoTitle || ssoBranch ? (
        <div className="rounded-xl border border-brand/25 bg-brand/5 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-brand font-semibold"><Sparkles size={13} /> {L("ข้อมูลจาก SSO / Lark", "From SSO / Lark", "来自 SSO / Lark")}</div>
          {ssoTitle ? <p className="text-muted">{L("ตำแหน่ง", "Position", "职位")}: <span className="text-ink font-medium">{ssoTitle}</span></p> : null}
          {ssoBranch ? <p className="text-muted">{L("สาขา (ส่วนกลาง)", "Branch (central)", "门店（中心）")}: <span className="text-ink font-medium">{ssoBranch}</span></p> : null}
          {ssoPositionCode || ssoManagerId ? (
            <button
              type="button"
              onClick={() => { if (ssoPositionCode) setCode(ssoPositionCode); if (ssoManagerId) setReportsTo(ssoManagerId); }}
              className="mt-1 inline-flex items-center gap-1 text-brand font-semibold hover:underline"
            >
              {L("ใช้ค่าจาก SSO", "Apply from SSO", "套用 SSO")} →
            </button>
          ) : null}
        </div>
      ) : null}

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
