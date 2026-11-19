"use client";
// =====================================================================
// Admin → บันทึกการแก้ไข (activity log) — ประวัติการเพิ่ม/แก้ไขหลังบ้านรายบุคคล
//   ใครแก้อะไร ฟิลด์ไหน จากค่าไหนเป็นค่าไหน เมื่อไร · เจ้าของดูได้ทุกคนอย่างละเอียด
//   อ่านจากตาราง audit (action="config") ที่ logActivity() บันทึกไว้
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { History, Plus, Pencil, Trash2, Search, ChevronRight, User, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card, Badge, Input, Select, EmptyState } from "@/components/ui";
import { ExportShareBar } from "@/components/admin/export-share";
import { listAudit } from "@/lib/data/repo";
import { useSession } from "@/lib/store/session";
import { can } from "@/lib/permissions";
import type { AuditEntry, FieldChange } from "@/lib/types";

interface Row {
  id: string; at: string; actorId: string | null; actor: string;
  op: string; entity: string; label: string; changes: FieldChange[];
}

export default function AdminActivityPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const me = useSession((s) => s.employee);
  const seeAll = can(me, "audit.view");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fActor, setFActor] = useState("");
  const [fEntity, setFEntity] = useState("");
  const [fOp, setFOp] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { void (async () => {
    const all: AuditEntry[] = await listAudit({ limit: 5000 });
    const mapped: Row[] = all.filter((a) => a.action === "config").map((a) => {
      const d = (a.after_data ?? {}) as Record<string, unknown>;
      return {
        id: a.id, at: a.occurred_at, actorId: a.actor_id ?? null,
        actor: a.actor_name || (d.actor_name as string) || L("ไม่ทราบ", "Unknown", "未知"),
        op: String(d.op ?? "update"), entity: String(d.entity ?? a.ref_table ?? ""),
        label: String(d.entityLabel ?? a.ref_no ?? ""), changes: (d.changes as FieldChange[]) ?? [],
      };
    });
    setRows(mapped); setLoading(false);
  })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const entityLabel = (e: string) => ({ branch: L("สาขา", "Branch", "门店"), employee: L("พนักงาน", "Employee", "员工"), permission: L("สิทธิ์", "Permission", "权限"), store: L("ร้าน", "Store", "店铺"), product: L("สินค้า", "Product", "商品"), brand: L("แบรนด์", "Brand", "品牌") }[e] ?? e);
  const opMeta = (op: string) => op === "create" ? { icon: <Plus size={13} />, label: L("เพิ่ม", "Created", "新增"), tone: "ok" as const } : op === "delete" ? { icon: <Trash2 size={13} />, label: L("ลบ", "Deleted", "删除"), tone: "danger" as const } : { icon: <Pencil size={13} />, label: L("แก้ไข", "Edited", "编辑"), tone: "brand" as const };

  const actors = useMemo(() => { const m = new Map<string, string>(); rows.forEach((r) => { if (r.actorId) m.set(r.actorId, r.actor); }); return [...m.entries()]; }, [rows]);
  const entities = useMemo(() => [...new Set(rows.map((r) => r.entity))].filter(Boolean), [rows]);

  const visible = useMemo(() => rows.filter((r) => {
    if (!seeAll && r.actorId !== me?.id) return false;
    if (fActor && r.actorId !== fActor) return false;
    if (fEntity && r.entity !== fEntity) return false;
    if (fOp && r.op !== fOp) return false;
    if (q) { const kw = q.toLowerCase(); if (!`${r.actor} ${r.label} ${r.changes.map((c) => `${c.label} ${c.before} ${c.after}`).join(" ")}`.toLowerCase().includes(kw)) return false; }
    return true;
  }), [rows, seeAll, me, fActor, fEntity, fOp, q]);

  const fmtDT = (s: string) => new Date(s).toLocaleString(locale === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const val = (v: unknown) => (v === "" || v === null || v === undefined ? "—" : String(v));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand/12 grid place-items-center"><History size={18} className="text-brand" /></span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("บันทึกการแก้ไข", "Activity log", "操作日志")}</h1>
            <p className="text-[11px] text-muted">{seeAll ? L("ประวัติการเพิ่ม/แก้ไขหลังบ้าน — ทุกคน", "Backend add/edit history — everyone", "后台增改历史 — 全部") : L("ประวัติการแก้ไขของคุณ", "Your edit history", "你的修改历史")}</p>
          </div>
        </div>
        <ExportShareBar<Row> filename="activity-log" title={L("บันทึกการแก้ไข", "Activity log", "操作日志")} rows={visible} size="sm"
          columns={[
            { key: "at", label: L("เวลา", "Time", "时间"), map: (r) => fmtDT(r.at) },
            { key: "actor", label: L("ผู้แก้ไข", "User", "操作人") },
            { key: "op", label: L("การกระทำ", "Action", "动作"), map: (r) => opMeta(r.op).label },
            { key: "entity", label: L("ประเภท", "Entity", "类型"), map: (r) => entityLabel(r.entity) },
            { key: "label", label: L("รายการ", "Item", "对象") },
            { key: "changes", label: L("การเปลี่ยนแปลง", "Changes", "变更"), map: (r) => r.changes.map((c) => `${c.label ?? c.field}: ${val(c.before)}→${val(c.after)}`).join(" · ") },
          ]} />
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา ชื่อ/ฟิลด์/ค่า…", "Search user/field/value…", "搜索…")} className="pl-9 h-10" />
        </div>
        {seeAll && (
          <Select value={fActor} onChange={(e) => setFActor(e.target.value)} className="h-10"><option value="">{L("ทุกคน", "Everyone", "所有人")}</option>{actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
        )}
        <Select value={fEntity} onChange={(e) => setFEntity(e.target.value)} className="h-10"><option value="">{L("ทุกประเภท", "All types", "全部类型")}</option>{entities.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}</Select>
        <Select value={fOp} onChange={(e) => setFOp(e.target.value)} className="h-10"><option value="">{L("ทุกการกระทำ", "All actions", "全部动作")}</option><option value="create">{L("เพิ่ม", "Created", "新增")}</option><option value="update">{L("แก้ไข", "Edited", "编辑")}</option><option value="delete">{L("ลบ", "Deleted", "删除")}</option></Select>
      </div>

      {loading ? <p className="text-center text-sm text-muted py-10">{L("กำลังโหลด…", "Loading…", "加载中…")}</p>
        : !visible.length ? <EmptyState icon={<History size={26} />} title={L("ยังไม่มีบันทึกการแก้ไข", "No activity yet", "暂无记录")} body={L("การเพิ่ม/แก้ไขหลังบ้านจะถูกบันทึกที่นี่", "Backend add/edit actions will appear here", "后台增改将记录于此")} />
          : (
            <Card className="divide-y divide-line">
              {visible.map((r) => {
                const om = opMeta(r.op); const open = expanded.has(r.id); const hasChanges = r.changes.length > 0;
                return (
                  <div key={r.id} className="p-3.5">
                    <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} className="w-full flex items-center gap-3 text-left">
                      <span className="w-8 h-8 rounded-lg bg-surface2 grid place-items-center shrink-0 text-muted"><User size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{r.actor}</span>
                          <Badge tone={om.tone}><span className="inline-flex items-center gap-1">{om.icon}{om.label}</span></Badge>
                          <span className="text-sm text-muted">{entityLabel(r.entity)}</span>
                          <span className="text-sm font-medium truncate">{r.label}</span>
                        </div>
                        <p className="text-[11px] text-muted mt-0.5">{fmtDT(r.at)}{hasChanges ? ` · ${r.changes.length} ${L("ฟิลด์", "fields", "字段")}` : ""}</p>
                      </div>
                      {hasChanges ? <ChevronRight size={16} className={`text-muted shrink-0 transition-transform ${open ? "rotate-90" : ""}`} /> : null}
                    </button>
                    {open && hasChanges && (
                      <div className="mt-2.5 ml-11 space-y-1.5">
                        {r.changes.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="text-muted min-w-[90px]">{c.label ?? c.field}</span>
                            {r.op === "create" ? (
                              <span className="font-medium">{val(c.after)}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-danger/10 text-danger line-through decoration-danger/40">{val(c.before)}</span>
                                <ArrowRight size={11} className="text-muted" />
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">{val(c.after)}</span>
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          )}
    </div>
  );
}
