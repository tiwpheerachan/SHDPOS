"use client";
// =====================================================================
// Admin → รับชำระ / EDC (Phase 1) — ทะเบียนเครื่อง + ผู้รับชำระ + MID/TID + บริการ
//   ตั้งทะเบียน/manual ก่อน (ตรวจย้อนหลังได้) · ยังไม่เชื่อมธนาคารจริง
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Loader2, Check, X, ShieldCheck, ShieldAlert, Pencil, Search, Cpu } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useAdminScope } from "@/components/admin/filters";
import { Card, KpiTile, Table, Th, Td, Badge, Input, Select, EmptyState, Drawer } from "@/components/ui";
import { ExportShareBar } from "@/components/admin/export-share";
import { listAcquirers, listTerminals, upsertTerminal, EDC_SERVICE_LABEL } from "@/lib/data/payments";
import { logActivity } from "@/lib/data/repo";
import { can } from "@/lib/permissions";
import type { Acquirer, EdcTerminal, EdcService } from "@/lib/types";

const SERVICES: EdcService[] = ["card", "unionpay", "thaiqr", "qr_credit", "alipay", "wechat", "installment"];
const STATUS: { v: EdcTerminal["status"]; th: string; en: string; tone: "ok" | "neutral" | "warn" | "danger" }[] = [
  { v: "installed", th: "ใช้งาน", en: "Installed", tone: "ok" },
  { v: "spare", th: "สำรอง", en: "Spare", tone: "neutral" },
  { v: "repair", th: "ซ่อม", en: "Repair", tone: "warn" },
  { v: "retired", th: "ปลดระวาง", en: "Retired", tone: "danger" },
];
const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";

export default function AdminPaymentsPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const actor = useSession((s) => s.employee);
  const { branches } = useAdminScope();
  const [acquirers, setAcquirers] = useState<Acquirer[]>([]);
  const [terminals, setTerminals] = useState<EdcTerminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fAcq, setFAcq] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EdcTerminal | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => { const [a, t] = await Promise.all([listAcquirers(), listTerminals()]); setAcquirers(a); setTerminals(t); setLoading(false); };
  useEffect(() => { void load(); }, []);

  const acqName = (id: string) => acquirers.find((a) => a.id === id)?.name ?? id;
  const acqVerified = (id: string) => acquirers.find((a) => a.id === id)?.verified ?? false;
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name_th ?? branches.find((b) => b.id === id)?.name ?? id : "—");
  const svcLabel = (s: string) => (locale === "th" ? EDC_SERVICE_LABEL[s]?.th : EDC_SERVICE_LABEL[s]?.en) ?? s;
  const statusMeta = (v: string) => STATUS.find((s) => s.v === v) ?? STATUS[0];

  const filtered = useMemo(() => terminals.filter((t) => {
    if (fAcq && t.acquirer_id !== fAcq) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (q) { const kw = q.toLowerCase(); if (!`${t.asset_code} ${t.mid ?? ""} ${t.tid ?? ""} ${t.shop_name ?? ""} ${branchName(t.branch_id)}`.toLowerCase().includes(kw)) return false; }
    return true;
  }), [terminals, fAcq, fStatus, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => ({
    total: terminals.length,
    installed: terminals.filter((t) => t.status === "installed").length,
    verified: terminals.filter((t) => t.verified).length,
    unverified: terminals.filter((t) => !t.verified).length,
  }), [terminals]);

  function openNew() { setForm({ id: `edc-${Date.now().toString(36)}`, asset_code: "", acquirer_id: acquirers[0]?.id ?? "", mid: null, tid: null, mer_no: null, legal_entity: null, shop_name: null, branch_id: null, model: "PAX A920", services: ["card"], installment_months: [], status: "installed", verified: false, note: null }); setErr(""); setOpen(true); }
  function openEdit(t: EdcTerminal) { setForm({ ...t }); setErr(""); setOpen(true); }

  async function save() {
    if (!form) return;
    if (!form.asset_code.trim()) { setErr(L("ต้องใส่รหัสเครื่อง", "Asset code required", "需要设备编号")); return; }
    if (!form.acquirer_id) { setErr(L("เลือกผู้รับชำระ", "Select acquirer", "选择收单行")); return; }
    setSaving(true); setErr("");
    try {
      const prev = terminals.find((t) => t.id === form.id) ?? null;
      await upsertTerminal(form);
      const actorMeta = { actorId: actor?.id ?? null, actorName: actor ? (actor.nickname || actor.first_name || actor.email) : null };
      const svcTh = form.services.map(svcLabel).join(", ");
      await logActivity({ ...actorMeta, op: prev ? "update" : "create", entity: "edc_terminal", entityLabel: form.asset_code, entityId: form.id, branchId: form.branch_id, changes: [
        { field: "acquirer", label: L("ผู้รับชำระ", "Acquirer", "收单"), before: prev ? acqName(prev.acquirer_id) : undefined, after: acqName(form.acquirer_id) },
        { field: "branch", label: L("สาขา", "Branch", "门店"), before: prev ? branchName(prev.branch_id) : undefined, after: branchName(form.branch_id) },
        { field: "status", label: L("สถานะ", "Status", "状态"), before: prev ? statusMeta(prev.status)[locale === "th" ? "th" : "en"] : undefined, after: statusMeta(form.status)[locale === "th" ? "th" : "en"] },
        { field: "services", label: L("บริการ", "Services", "服务"), before: prev ? prev.services.map(svcLabel).join(", ") : undefined, after: svcTh },
        { field: "verified", label: L("ยืนยัน", "Verified", "验证"), before: prev ? (prev.verified ? "✓" : "✗") : undefined, after: form.verified ? "✓" : "✗" },
      ] });
      setOpen(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败")); }
    finally { setSaving(false); }
  }

  const allowed = can(actor, "finance.view") || can(actor, "admin.branch_manage");
  if (actor && !allowed) return <div className="p-6"><EmptyState icon={<CreditCard size={26} />} title={L("ไม่มีสิทธิ์", "No access", "无权限")} /></div>;

  const toggleSvc = (s: EdcService) => setForm((f) => f ? { ...f, services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] } : f);

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand/12 grid place-items-center"><CreditCard size={18} className="text-brand" /></span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("รับชำระ / EDC", "Payments / EDC", "收款/EDC")}</h1>
            <p className="text-[11px] text-muted">{L("ทะเบียนเครื่อง · ผู้รับชำระ · MID/TID · บริการ (ยังไม่เชื่อมธนาคารจริง)", "Device registry · acquirer · MID/TID · services (bank not connected)", "设备登记")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportShareBar<EdcTerminal> filename="edc-terminals" title={L("ทะเบียนเครื่อง EDC", "EDC terminals", "EDC设备")} rows={filtered} size="sm"
            columns={[
              { key: "asset_code", label: L("รหัสเครื่อง", "Asset", "设备") }, { key: "acquirer", label: L("ผู้รับชำระ", "Acquirer", "收单"), map: (t) => acqName(t.acquirer_id) },
              { key: "mid", label: "MID", map: (t) => t.mid ?? "-" }, { key: "tid", label: "TID", map: (t) => t.tid ?? "-" },
              { key: "branch", label: L("สาขา", "Branch", "门店"), map: (t) => branchName(t.branch_id) },
              { key: "services", label: L("บริการ", "Services", "服务"), map: (t) => t.services.map(svcLabel).join(", ") },
              { key: "status", label: L("สถานะ", "Status", "状态"), map: (t) => statusMeta(t.status)[locale === "th" ? "th" : "en"] },
              { key: "verified", label: L("ยืนยัน", "Verified", "验证"), map: (t) => (t.verified ? L("ใช่", "Yes", "是") : L("ยัง", "No", "否")) },
            ]} />
          <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2 shrink-0"><Plus size={16} /> {L("เพิ่มเครื่อง", "Add terminal", "新增")}</button>
        </div>
      </div>

      {/* ผู้รับชำระ */}
      <Card className="p-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted mr-1">{L("ผู้รับชำระ", "Acquirers", "收单行")}:</span>
          {acquirers.map((a) => (
            <span key={a.id} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-7 rounded-full border ${a.verified ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-600" : "border-amber-500/30 bg-amber-500/8 text-amber-600"}`}>
              {a.verified ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />} {a.code} · {a.verified ? L("ยืนยันแล้ว", "verified", "已验证") : L("ยังไม่ยืนยัน", "unverified", "未验证")}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("เครื่องทั้งหมด", "Terminals", "设备总数")} value={String(kpi.total)} icon={<Cpu size={16} />} accent="lavender" />
        <KpiTile label={L("ใช้งานอยู่", "Installed", "使用中")} value={String(kpi.installed)} icon={<CreditCard size={16} />} accent="mint" />
        <KpiTile label={L("ยืนยันแล้ว", "Verified", "已验证")} value={String(kpi.verified)} icon={<ShieldCheck size={16} />} accent="lime" />
        <KpiTile label={L("ยังไม่ยืนยัน", "Unverified", "未验证")} value={String(kpi.unverified)} icon={<ShieldAlert size={16} />} accent={kpi.unverified ? "peach" : "neutral"} />
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา รหัส/MID/TID/สาขา…", "Search asset/MID/TID…", "搜索…")} className="pl-9 h-9" /></div>
        <Select value={fAcq} onChange={(e) => setFAcq(e.target.value)} className="h-9 w-40"><option value="">{L("ทุกผู้รับชำระ", "All acquirers", "全部")}</option>{acquirers.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}</Select>
        <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-9 w-36"><option value="">{L("ทุกสถานะ", "All status", "全部状态")}</option>{STATUS.map((s) => <option key={s.v} value={s.v}>{L(s.th, s.en, s.th)}</option>)}</Select>
      </div>

      {loading ? <Card className="p-16 text-center text-muted"><Loader2 className="inline animate-spin" size={18} /></Card>
        : !filtered.length ? <EmptyState icon={<CreditCard size={26} />} title={L("ไม่พบเครื่อง", "No terminals", "无设备")} />
          : (
            <Card className="overflow-x-auto">
              <Table>
                <thead><tr><Th>{L("รหัสเครื่อง", "Asset", "设备")}</Th><Th>{L("ผู้รับชำระ", "Acquirer", "收单")}</Th><Th>MID</Th><Th>TID</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th>{L("บริการ", "Services", "服务")}</Th><Th>{L("สถานะ", "Status", "状态")}</Th><Th align="center">{L("ยืนยัน", "Verified", "验证")}</Th><Th></Th></tr></thead>
                <tbody>{filtered.map((t) => { const sm = statusMeta(t.status); return (
                  <tr key={t.id}>
                    <Td className="font-mono text-xs font-medium">{t.asset_code}{t.model ? <span className="block text-[10px] text-muted font-sans">{t.model}</span> : null}</Td>
                    <Td className="text-xs"><span className="inline-flex items-center gap-1">{acqName(t.acquirer_id)}{!acqVerified(t.acquirer_id) ? <ShieldAlert size={11} className="text-amber-500" /> : null}</span></Td>
                    <Td className="font-mono text-[11px] text-muted">{t.mid ?? "—"}</Td>
                    <Td className="font-mono text-[11px] text-muted">{t.tid ?? "—"}</Td>
                    <Td className="text-xs">{branchName(t.branch_id)}</Td>
                    <Td><div className="flex flex-wrap gap-1 max-w-[220px]">{t.services.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted">{svcLabel(s)}{s === "installment" && t.installment_months.length ? ` ${t.installment_months.join("/")}` : ""}</span>)}</div></Td>
                    <Td><Badge tone={sm.tone}>{L(sm.th, sm.en, sm.th)}</Badge></Td>
                    <Td align="center">{t.verified ? <ShieldCheck size={15} className="text-emerald-500 inline" /> : <ShieldAlert size={15} className="text-amber-500 inline" />}</Td>
                    <Td align="right"><button onClick={() => openEdit(t)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><Pencil size={14} /></button></Td>
                  </tr>
                ); })}</tbody>
              </Table>
            </Card>
          )}

      {/* drawer เพิ่ม/แก้เครื่อง */}
      <Drawer open={open} onClose={() => setOpen(false)} width="md" title={form && terminals.some((t) => t.id === form.id) ? L("แก้ไขเครื่อง EDC", "Edit terminal", "编辑设备") : L("เพิ่มเครื่อง EDC", "Add terminal", "新增设备")} subtitle={form?.asset_code || undefined}>
        {form && (
          <div className="p-4 space-y-3">
            {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2 flex items-center gap-1.5"><X size={13} /> {err}</p>}
            <div className="grid grid-cols-2 gap-2.5">
              <label className="text-xs text-muted block">{L("รหัสเครื่อง (ของเรา) *", "Asset code *", "设备编号 *")}<input value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="EDC-0001" /></label>
              <label className="text-xs text-muted block">{L("รุ่น", "Model", "型号")}<input value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inp} placeholder="PAX A920" /></label>
            </div>
            <label className="text-xs text-muted block">{L("ผู้รับชำระ *", "Acquirer *", "收单行 *")}
              <select value={form.acquirer_id} onChange={(e) => setForm({ ...form, acquirer_id: e.target.value })} className={inp}>{acquirers.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}{a.verified ? "" : " (ยังไม่ยืนยัน)"}</option>)}</select>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="text-xs text-muted block">MID<input value={form.mid ?? ""} onChange={(e) => setForm({ ...form, mid: e.target.value || null })} className={`${inp} font-mono`} placeholder="•••• 2187" /></label>
              <label className="text-xs text-muted block">TID<input value={form.tid ?? ""} onChange={(e) => setForm({ ...form, tid: e.target.value || null })} className={`${inp} font-mono`} placeholder="•••• 0453" /></label>
            </div>
            <label className="text-xs text-muted block">{L("ชื่อร้านบนระบบธนาคาร", "Shop name (bank)", "银行店名")}<input value={form.shop_name ?? ""} onChange={(e) => setForm({ ...form, shop_name: e.target.value || null })} className={inp} /></label>
            <label className="text-xs text-muted block">{L("สาขาที่ติดตั้ง", "Installed branch", "安装门店")}
              <select value={form.branch_id ?? ""} onChange={(e) => setForm({ ...form, branch_id: e.target.value || null })} className={inp}><option value="">{L("— ไม่ระบุ —", "— None —", "— 无 —")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name_th || b.name}</option>)}</select>
            </label>
            <div>
              <div className="text-xs text-muted mb-1.5">{L("บริการที่เปิดใช้", "Enabled services", "启用服务")}</div>
              <div className="flex flex-wrap gap-1.5">{SERVICES.map((s) => { const on = form.services.includes(s); return <button key={s} onClick={() => toggleSvc(s)} className={`px-2.5 h-7 rounded-full text-[11px] font-semibold ${on ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"}`}>{svcLabel(s)}</button>; })}</div>
            </div>
            {form.services.includes("installment") && (
              <label className="text-xs text-muted block">{L("งวดผ่อน (คั่นด้วย ,)", "Installment months (comma)", "分期月数")}<input value={form.installment_months.join(",")} onChange={(e) => setForm({ ...form, installment_months: e.target.value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n)) })} className={`${inp} font-mono`} placeholder="3,6,10" inputMode="numeric" /></label>
            )}
            <div className="grid grid-cols-2 gap-2.5 items-end">
              <label className="text-xs text-muted block">{L("สถานะ", "Status", "状态")}
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EdcTerminal["status"] })} className={inp}>{STATUS.map((s) => <option key={s.v} value={s.v}>{L(s.th, s.en, s.th)}</option>)}</select>
              </label>
              <label className="flex items-center gap-2 cursor-pointer h-10"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} className="w-4 h-4 accent-current" /><span className="text-sm font-medium">{L("ยืนยันแล้ว", "Verified", "已验证")}</span></label>
            </div>
            <label className="text-xs text-muted block">{L("หมายเหตุ", "Note", "备注")}<input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value || null })} className={inp} /></label>
            <div className="flex gap-2 pt-1 sticky bottom-0 bg-surface pb-1">
              <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted flex-1">{L("ยกเลิก", "Cancel", "取消")}</button>
              <button onClick={() => void save()} disabled={saving} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5 flex-1">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {L("บันทึก", "Save", "保存")}</button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
