"use client";
// =====================================================================
// Admin → รับชำระ / EDC (Phase 1) — ทะเบียนเครื่อง + ผู้รับชำระ + MID/TID + บริการ
//   ตั้งทะเบียน/manual ก่อน (ตรวจย้อนหลังได้) · ยังไม่เชื่อมธนาคารจริง
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Plus, Loader2, Check, X, ShieldCheck, ShieldAlert, Pencil, Search, Cpu, Clock, ListChecks, Ban, AlertTriangle, ChevronRight, User, Upload, Sparkles, Link2Off } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useAdminScope } from "@/components/admin/filters";
import { Card, KpiTile, Table, Th, Td, Badge, Input, Select, EmptyState, Drawer, Modal, Segmented } from "@/components/ui";
import { ExportShareBar } from "@/components/admin/export-share";
import { useToast } from "@/components/toast-host";
import { listAcquirers, listTerminals, upsertTerminal, listPaymentTxns, createPaymentTxn, resolvePaymentTxn, voidPaymentTxn, listStatementRows, importStatementRows, parseStatementCsv, generateSampleStatement, clearStatements, EDC_SERVICE_LABEL } from "@/lib/data/payments";
import { logActivity } from "@/lib/data/repo";
import { can } from "@/lib/permissions";
import { formatTHB } from "@/lib/money";
import type { Acquirer, EdcTerminal, EdcService, PaymentTxn, StatementRow } from "@/lib/types";

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
  const toast = useToast();
  const [view, setView] = useState<"devices" | "txns" | "recon">("devices");
  const [reconKey, setReconKey] = useState<string | null>(null);
  const [acquirers, setAcquirers] = useState<Acquirer[]>([]);
  const [terminals, setTerminals] = useState<EdcTerminal[]>([]);
  const [txns, setTxns] = useState<PaymentTxn[]>([]);
  const [stmtRows, setStmtRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  // ledger modals
  const [newOpen, setNewOpen] = useState(false);
  const [resolveT, setResolveT] = useState<PaymentTxn | null>(null);
  const [nf2, setNf2] = useState({ terminal_id: "", method: "card" as EdcService, amount: "", order_no: "", months: "" });
  const [rf, setRf] = useState({ status: "approved" as "approved" | "declined" | "error", approval_code: "", ref_no: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [fAcq, setFAcq] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EdcTerminal | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => { const [a, t, x, sr] = await Promise.all([listAcquirers(), listTerminals(), listPaymentTxns(), listStatementRows()]); setAcquirers(a); setTerminals(t); setTxns(x); setStmtRows(sr); setLoading(false); };
  useEffect(() => { void load(); }, []);

  const acqName = (id: string | null) => (id ? acquirers.find((a) => a.id === id)?.name ?? id : "—");
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

  // ── ledger (Phase 2) ──
  const termOf = (id: string | null) => terminals.find((t) => t.id === id) ?? null;
  const termLabel = (id: string | null) => termOf(id)?.asset_code ?? "—";
  const nf = (n: number) => formatTHB(n, false);
  const txnKpi = useMemo(() => {
    const ap = txns.filter((t) => t.status === "approved");
    return { approved: ap.length, approvedSum: ap.reduce((s, t) => s + t.amount, 0), recover: txns.filter((t) => t.status === "pending" || t.status === "error").length, declined: txns.filter((t) => t.status === "declined").length, voided: txns.filter((t) => t.status === "voided").length };
  }, [txns]);
  const TXN_STATUS: Record<string, { th: string; en: string; tone: "ok" | "neutral" | "warn" | "danger" | "brand" }> = {
    pending: { th: "รอผล", en: "Pending", tone: "warn" }, approved: { th: "อนุมัติ", en: "Approved", tone: "ok" },
    declined: { th: "ปฏิเสธ", en: "Declined", tone: "danger" }, error: { th: "ต้องตรวจสอบ", en: "Error", tone: "danger" }, voided: { th: "ยกเลิก", en: "Voided", tone: "neutral" },
  };
  const cashier = () => (actor ? (actor.nickname || actor.first_name || actor.email || null) : null);
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(locale === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  // ── สรุปรายวันรายสาขา (กระทบยอด) — ควรได้เท่าไหร่จาก EDC อนุมัติ, แยกเครื่อง/กะ ──
  interface ReconG { key: string; branchId: string | null; day: string; expected: number; count: number; terminals: Map<string, { amount: number; count: number }>; cashiers: Map<string, { amount: number; count: number; first: string; last: string }>; txns: PaymentTxn[] }
  const recon = useMemo(() => {
    const g = new Map<string, ReconG>();
    for (const t of txns) {
      if (t.status !== "approved") continue; // "ควรได้" = เฉพาะที่อนุมัติ (ไม่รวม void/declined/pending)
      const day = t.at.slice(0, 10); const key = `${t.branch_id ?? "—"}|${day}`;
      let r = g.get(key);
      if (!r) { r = { key, branchId: t.branch_id, day, expected: 0, count: 0, terminals: new Map(), cashiers: new Map(), txns: [] }; g.set(key, r); }
      r.expected += t.amount; r.count++; r.txns.push(t);
      const tid = t.terminal_id ?? "—"; const te = r.terminals.get(tid) ?? { amount: 0, count: 0 }; te.amount += t.amount; te.count++; r.terminals.set(tid, te);
      const cn = t.cashier_name ?? "—"; const ce = r.cashiers.get(cn) ?? { amount: 0, count: 0, first: t.at, last: t.at }; ce.amount += t.amount; ce.count++; if (t.at < ce.first) ce.first = t.at; if (t.at > ce.last) ce.last = t.at; r.cashiers.set(cn, ce);
    }
    return [...g.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.expected - a.expected));
  }, [txns]);
  const reconSel = recon.find((r) => r.key === reconKey) ?? null;

  // ── จับคู่ statement ↔ txn (โดย approval_code + ยอด) ──
  const match = useMemo(() => {
    const approved = txns.filter((t) => t.status === "approved");
    const byCode = new Map<string, PaymentTxn[]>();
    approved.forEach((t) => { if (t.approval_code) { const a = byCode.get(t.approval_code) ?? []; a.push(t); byCode.set(t.approval_code, a); } });
    const usedTxn = new Set<string>(); const usedStmt = new Set<string>(); const actualByTxn = new Map<string, number>();
    for (const s of stmtRows) {
      if (!s.approval_code) continue;
      const cands = byCode.get(s.approval_code) ?? [];
      const t = cands.find((c) => !usedTxn.has(c.id) && Math.abs(c.amount - s.amount) < 0.5) ?? cands.find((c) => !usedTxn.has(c.id));
      if (t) { usedTxn.add(t.id); usedStmt.add(s.id); actualByTxn.set(t.id, s.amount); }
    }
    return { actualByTxn, usedTxnIds: usedTxn, unmatchedStmt: stmtRows.filter((s) => !usedStmt.has(s.id)), unmatchedTxn: approved.filter((t) => !usedTxn.has(t.id)) };
  }, [txns, stmtRows]);
  const reconActual = (r: ReconG) => r.txns.reduce((s, t) => s + (match.actualByTxn.get(t.id) ?? 0), 0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onSample() { setBusy(true); try { const r = await generateSampleStatement(); toast.push({ tone: "ok", title: L("สร้าง statement ตัวอย่างแล้ว", "Sample created", "已创建示例"), body: `${r.added} ${L("แถว", "rows", "行")}` }); await load(); } finally { setBusy(false); } }
  async function onUploadCsv(file: File) {
    const text = await file.text(); const rows = parseStatementCsv(text);
    if (!rows.length) { toast.push({ tone: "danger", title: L("ไม่พบข้อมูลในไฟล์", "No rows found", "无数据") }); return; }
    const r = await importStatementRows(rows, { name: file.name });
    toast.push({ tone: "ok", title: L("นำเข้า statement แล้ว", "Statement imported", "已导入"), body: `${file.name} · ${r.added} ${L("แถว", "rows", "行")}` }); await load();
  }
  async function onClearStmt() { if (!confirm(L("ล้าง statement ที่นำเข้าทั้งหมด?", "Clear all statements?", "清除?"))) return; await clearStatements(); await load(); }
  async function submitNew() {
    const amt = Number(nf2.amount);
    if (!nf2.terminal_id) { toast.push({ tone: "danger", title: L("เลือกเครื่อง", "Select terminal", "选设备") }); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast.push({ tone: "danger", title: L("ใส่จำนวนเงิน", "Enter amount", "输入金额") }); return; }
    setBusy(true);
    try {
      const t = termOf(nf2.terminal_id);
      const { txn, duplicate } = await createPaymentTxn({ order_no: nf2.order_no.trim() || null, terminal_id: nf2.terminal_id, acquirer_id: t?.acquirer_id ?? null, method: nf2.method, amount: amt, installment_months: nf2.method === "installment" && nf2.months ? Number(nf2.months) : null, branch_id: t?.branch_id ?? null, cashier_name: cashier() });
      toast.push({ tone: duplicate ? "warn" : "ok", title: duplicate ? L("รายการซ้ำ (กันเก็บซ้ำ)", "Duplicate blocked", "已防重复") : L("สร้างรายการแล้ว (รอผล)", "Created · pending", "已创建"), body: `฿${nf(txn.amount)} · ${txn.op_key}` });
      setNewOpen(false); setNf2({ terminal_id: "", method: "card", amount: "", order_no: "", months: "" }); await load();
    } finally { setBusy(false); }
  }
  async function submitResolve() {
    if (!resolveT) return;
    setBusy(true);
    try {
      await resolvePaymentTxn(resolveT.id, rf.status, { approval_code: rf.approval_code.trim() || null, ref_no: rf.ref_no.trim() || null, note: rf.note.trim() || null });
      toast.push({ tone: "ok", title: L("บันทึกผลแล้ว", "Result saved", "已记录") });
      setResolveT(null); setRf({ status: "approved", approval_code: "", ref_no: "", note: "" }); await load();
    } finally { setBusy(false); }
  }
  async function doVoid(t: PaymentTxn) {
    if (!confirm(L(`ยกเลิกรายการ ฿${nf(t.amount)}? (void ก่อนปิดยอด)`, `Void ฿${nf(t.amount)}?`, "作废?"))) return;
    await voidPaymentTxn(t.id); await load();
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
          {view === "devices" ? (
            <ExportShareBar<EdcTerminal> filename="edc-terminals" title={L("ทะเบียนเครื่อง EDC", "EDC terminals", "EDC设备")} rows={filtered} size="sm"
              columns={[
                { key: "asset_code", label: L("รหัสเครื่อง", "Asset", "设备") }, { key: "acquirer", label: L("ผู้รับชำระ", "Acquirer", "收单"), map: (t) => acqName(t.acquirer_id) },
                { key: "mid", label: "MID", map: (t) => t.mid ?? "-" }, { key: "tid", label: "TID", map: (t) => t.tid ?? "-" },
                { key: "branch", label: L("สาขา", "Branch", "门店"), map: (t) => branchName(t.branch_id) },
                { key: "services", label: L("บริการ", "Services", "服务"), map: (t) => t.services.map(svcLabel).join(", ") },
                { key: "status", label: L("สถานะ", "Status", "状态"), map: (t) => statusMeta(t.status)[locale === "th" ? "th" : "en"] },
                { key: "verified", label: L("ยืนยัน", "Verified", "验证"), map: (t) => (t.verified ? L("ใช่", "Yes", "是") : L("ยัง", "No", "否")) },
              ]} />
          ) : (
            <ExportShareBar<PaymentTxn> filename="edc-txns" title={L("รายการชำระ EDC", "EDC transactions", "EDC交易")} rows={txns} size="sm"
              columns={[
                { key: "at", label: L("เวลา", "Time", "时间"), map: (t) => new Date(t.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) },
                { key: "order_no", label: L("บิล", "Bill", "单号"), map: (t) => t.order_no ?? "-" }, { key: "terminal", label: L("เครื่อง", "Terminal", "设备"), map: (t) => termLabel(t.terminal_id) },
                { key: "method", label: L("วิธี", "Method", "方式"), map: (t) => svcLabel(t.method) }, { key: "amount", label: L("ยอด", "Amount", "金额"), map: (t) => nf(t.amount) },
                { key: "status", label: L("สถานะ", "Status", "状态"), map: (t) => TXN_STATUS[t.status][locale === "th" ? "th" : "en"] },
                { key: "approval_code", label: L("รหัสอนุมัติ", "Approval", "批准码"), map: (t) => t.approval_code ?? "-" }, { key: "ref_no", label: "Ref", map: (t) => t.ref_no ?? "-" },
              ]} />
          )}
          {view === "devices"
            ? <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2 shrink-0"><Plus size={16} /> {L("เพิ่มเครื่อง", "Add terminal", "新增")}</button>
            : <button onClick={() => setNewOpen(true)} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2 shrink-0"><Plus size={16} /> {L("เริ่มรายการชำระ", "New charge", "新收款")}</button>}
        </div>
      </div>

      <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "devices", label: L("ทะเบียนเครื่อง", "Terminals", "设备") }, { value: "txns", label: `${L("รายการชำระ", "Transactions", "交易")}${txnKpi.recover ? ` · ${txnKpi.recover}⚠` : ""}` }, { value: "recon", label: L("สรุปรายวัน", "Daily close", "日结") }]} />

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

      {view === "devices" ? (<>
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
      </>) : view === "txns" ? (
      /* ───────── รายการชำระ EDC (ledger) ───────── */
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label={L("อนุมัติ", "Approved", "已批准")} value={String(txnKpi.approved)} sub={`฿${nf(txnKpi.approvedSum)}`} icon={<ListChecks size={16} />} accent="mint" />
          <KpiTile label={L("รอผล / ต้องกู้คืน", "Pending / recover", "待处理")} value={String(txnKpi.recover)} sub={L("pending + ต้องตรวจสอบ", "pending + error", "待+错误")} icon={<Clock size={16} />} accent={txnKpi.recover ? "coral" : "neutral"} />
          <KpiTile label={L("ปฏิเสธ", "Declined", "拒绝")} value={String(txnKpi.declined)} icon={<Ban size={16} />} accent="peach" />
          <KpiTile label={L("ยกเลิก (void)", "Voided", "作废")} value={String(txnKpi.voided)} icon={<AlertTriangle size={16} />} accent="neutral" />
        </div>
        {txnKpi.recover > 0 ? (
          <Card className="p-3.5 flex items-center gap-2.5 border-amber-500/30 bg-amber-500/8">
            <Clock size={16} className="text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 flex-1">{L(`มี ${txnKpi.recover} รายการค้าง (รอผล/ต้องตรวจสอบ) — ตรวจสลิปแล้วกด "บันทึกผล" เพื่อปิดรายการ`, `${txnKpi.recover} items pending — check slip and record result`, "有待处理")}</p>
          </Card>
        ) : null}
        <Card className="overflow-x-auto">
          <Table>
            <thead><tr><Th>{L("เวลา", "Time", "时间")}</Th><Th>{L("บิล", "Bill", "单号")}</Th><Th>{L("เครื่อง", "Terminal", "设备")}</Th><Th>{L("วิธี", "Method", "方式")}</Th><Th align="right">{L("ยอด", "Amount", "金额")}</Th><Th>{L("สถานะ", "Status", "状态")}</Th><Th>{L("รหัสอนุมัติ / Ref", "Approval / Ref", "批准/Ref")}</Th><Th></Th></tr></thead>
            <tbody>{txns.map((t) => { const sm = TXN_STATUS[t.status]; const canResolve = t.status === "pending" || t.status === "error"; return (
              <tr key={t.id} className={canResolve ? "bg-amber-500/5" : ""}>
                <Td className="text-xs whitespace-nowrap">{new Date(t.at).toLocaleString(locale === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
                <Td className="font-mono text-[11px] text-muted">{t.order_no ?? "—"}</Td>
                <Td className="text-xs"><span className="font-mono">{termLabel(t.terminal_id)}</span><span className="block text-[10px] text-muted">{acqName(t.acquirer_id)}</span></Td>
                <Td className="text-xs">{svcLabel(t.method)}{t.method === "installment" && t.installment_months ? ` ${t.installment_months}ด.` : ""}</Td>
                <Td align="right" className="tnum font-medium">{nf(t.amount)}</Td>
                <Td><Badge tone={sm.tone}>{L(sm.th, sm.en, sm.th)}</Badge></Td>
                <Td className="text-xs text-muted">{t.approval_code ? <span className="font-mono">{t.approval_code}</span> : "—"}{t.ref_no ? <span className="block text-[10px] font-mono">{t.ref_no}</span> : null}</Td>
                <Td align="right">
                  {canResolve ? <button onClick={() => { setResolveT(t); setRf({ status: "approved", approval_code: "", ref_no: "", note: "" }); }} className="h-7 px-2.5 rounded-lg bg-brand text-brandInk text-[11px] font-bold">{L("บันทึกผล", "Record", "记录")}</button>
                    : t.status === "approved" ? <button onClick={() => void doVoid(t)} className="h-7 px-2.5 rounded-lg border border-line text-[11px] text-muted hover:text-danger hover:border-danger/40">{L("ยกเลิก", "Void", "作废")}</button>
                      : <span className="text-[10px] text-muted">{t.resolved_at ? new Date(t.resolved_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" }) : ""}</span>}
                </Td>
              </tr>
            ); })}</tbody>
          </Table>
          {!txns.length ? <p className="py-10 text-center text-sm text-muted">{L("ยังไม่มีรายการชำระ", "No transactions", "无交易")}</p> : null}
        </Card>
      </>
      ) : (
      /* ───────── สรุปรายวันรายสาขา (กระทบยอด) ───────── */
      <>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUploadCsv(f); e.target.value = ""; }} />
        <Card className="p-3.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[11px] text-muted min-w-0"><ListChecks size={15} className="shrink-0" /> <span className="truncate">{stmtRows.length ? L(`นำเข้า statement ${stmtRows.length} แถว · จับคู่ได้ ${match.usedTxnIds.size} · ไม่ตรง ${match.unmatchedStmt.length + match.unmatchedTxn.length}`, `${stmtRows.length} rows · matched ${match.usedTxnIds.size} · unmatched ${match.unmatchedStmt.length + match.unmatchedTxn.length}`, "") : L("ยังไม่นำเข้า statement — “เงินเข้าจริง” เทียบได้เมื่ออัปโหลดรายงานธนาคาร (CSV: วันที่, ยอด, รหัสอนุมัติ, อ้างอิง)", "No statement yet — upload bank CSV to compare actual", "")}</span></div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => fileRef.current?.click()} className="h-9 px-3 rounded-xl border border-line text-sm inline-flex items-center gap-1.5 hover:bg-surface2"><Upload size={14} /> {L("อัปโหลด CSV", "Upload CSV", "上传")}</button>
            <button onClick={() => void onSample()} disabled={busy} className="h-9 px-3 rounded-xl border border-line text-sm inline-flex items-center gap-1.5 hover:bg-surface2 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {L("สร้างตัวอย่าง", "Sample", "示例")}</button>
            {stmtRows.length ? <button onClick={() => void onClearStmt()} className="h-9 px-3 rounded-xl border border-line text-sm text-muted hover:text-danger hover:border-danger/40">{L("ล้าง", "Clear", "清")}</button> : null}
          </div>
        </Card>
        {!recon.length ? <EmptyState icon={<ListChecks size={26} />} title={L("ยังไม่มีข้อมูลสรุป", "No data", "无数据")} /> : (
          <Card className="overflow-x-auto">
            <Table>
              <thead><tr><Th>{L("วันที่", "Date", "日期")}</Th><Th>{L("สาขา", "Branch", "门店")}</Th><Th align="right">{L("ควรได้", "Expected", "应收")}</Th><Th align="right">{L("เงินเข้าจริง", "Actual", "实收")}</Th><Th align="right">{L("ส่วนต่าง", "Diff", "差额")}</Th><Th>{L("เครื่อง / กะ", "Terminal / staff", "设备/班次")}</Th><Th align="center">{L("กระทบยอด", "Reconcile", "对账")}</Th><Th></Th></tr></thead>
              <tbody>{recon.map((r) => {
                const actual = reconActual(r); const diff = r.expected - actual;
                const st = !stmtRows.length ? "na" : actual === 0 ? "wait" : Math.abs(diff) < 1 ? "ok" : "diff";
                return (
                  <tr key={r.key} className="hover:bg-surface2/50 cursor-pointer" onClick={() => setReconKey(r.key)}>
                    <Td className="text-xs whitespace-nowrap">{r.day.slice(5)}</Td>
                    <Td className="text-sm font-medium">{branchName(r.branchId)}<span className="block text-[10px] text-muted font-normal">{r.count} {L("รายการ", "txns", "笔")}</span></Td>
                    <Td align="right" className="tnum font-bold">{nf(r.expected)}</Td>
                    <Td align="right" className="tnum">{st === "na" ? <span className="text-muted">—</span> : st === "wait" ? <span className="text-amber-500 text-xs">{L("รอเงินเข้า", "awaiting", "待")}</span> : nf(actual)}</Td>
                    <Td align="right" className="tnum text-xs">{st === "na" || st === "wait" ? "—" : Math.abs(diff) < 1 ? <span className="text-emerald-500">0</span> : <span className="text-danger">{diff > 0 ? "+" : ""}{nf(diff)}</span>}</Td>
                    <Td><div className="flex flex-wrap gap-1">{[...r.terminals.keys()].slice(0, 2).map((tid) => <span key={tid} className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 font-mono text-muted">{termLabel(tid)}</span>)}{[...r.cashiers.keys()].slice(0, 2).map((c) => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface2 text-muted">{c}</span>)}</div></Td>
                    <Td align="center">{st === "na" ? <Badge tone="neutral">{L("ยังไม่เชื่อม", "N/A", "未")}</Badge> : st === "ok" ? <Badge tone="ok">{L("ตรง", "Matched", "匹配")}</Badge> : st === "wait" ? <Badge tone="warn">{L("รอ", "Wait", "待")}</Badge> : <Badge tone="danger">{L("ไม่ตรง", "Diff", "不符")}</Badge>}</Td>
                    <Td align="right"><ChevronRight size={16} className="text-muted inline" /></Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          </Card>
        )}
        {stmtRows.length ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold mb-2"><Link2Off size={14} className="text-amber-500" /> {L("ในธนาคาร แต่ไม่พบใน POS", "In bank, not in POS", "银行有·POS无")} <Badge tone={match.unmatchedStmt.length ? "warn" : "neutral"}>{match.unmatchedStmt.length}</Badge></div>
              <div className="divide-y divide-line max-h-64 overflow-y-auto">{match.unmatchedStmt.length ? match.unmatchedStmt.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-xs"><span className="text-muted">{s.at.slice(5, 10)} · {s.approval_code ? <span className="font-mono">{s.approval_code}</span> : "—"}{s.ref_no ? ` · ${s.ref_no}` : ""}</span><span className="tnum font-medium">฿{nf(s.amount)}</span></div>
              )) : <p className="py-4 text-center text-xs text-muted">{L("ไม่มี — ตรงหมด", "None", "无")}</p>}</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold mb-2"><Clock size={14} className="text-amber-500" /> {L("POS อนุมัติ แต่ธนาคารยังไม่มา", "Approved in POS, not yet in bank", "POS已批·银行未到")} <Badge tone={match.unmatchedTxn.length ? "warn" : "neutral"}>{match.unmatchedTxn.length}</Badge></div>
              <div className="divide-y divide-line max-h-64 overflow-y-auto">{match.unmatchedTxn.length ? match.unmatchedTxn.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 py-2 text-xs"><span className="text-muted">{t.at.slice(5, 10)} · <span className="font-mono">{termLabel(t.terminal_id)}</span> · {t.approval_code ?? "—"}</span><span className="tnum font-medium">฿{nf(t.amount)}</span></div>
              )) : <p className="py-4 text-center text-xs text-muted">{L("ไม่มี — เข้าครบ", "None", "无")}</p>}</div>
            </Card>
          </div>
        ) : null}
      </>
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

      {/* Modal: เริ่มรายการชำระ (สร้าง pending ก่อน) */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={L("เริ่มรายการชำระ EDC", "New EDC charge", "新收款")} size="md"
        footer={<>
          <button onClick={() => setNewOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
          <button onClick={() => void submitNew()} disabled={busy} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {L("สร้าง (รอผล)", "Create · pending", "创建")}</button>
        </>}>
        <div className="space-y-3">
          <p className="text-[11px] text-muted bg-surface2 rounded-lg px-3 py-2">{L("สร้างรายการเป็น “รอผล” ก่อนเรียกเก็บ แล้วค่อยบันทึกผลจากเครื่อง · ระบบกันเรียกเก็บซ้ำด้วย op_key", "Create as pending before charging, then record the result · duplicate-safe via op_key", "先创建待处理")}</p>
          <label className="text-xs text-muted block">{L("เครื่อง EDC", "Terminal", "设备")}
            <select value={nf2.terminal_id} onChange={(e) => { const t = termOf(e.target.value); setNf2({ ...nf2, terminal_id: e.target.value, method: (t?.services[0] as EdcService) ?? "card" }); }} className={inp}>
              <option value="">{L("— เลือกเครื่อง —", "— Select —", "— 选 —")}</option>
              {terminals.filter((t) => t.status === "installed" && t.verified).map((t) => <option key={t.id} value={t.id}>{t.asset_code} · {acqName(t.acquirer_id)} · {branchName(t.branch_id)}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("วิธีชำระ", "Method", "方式")}
              <select value={nf2.method} onChange={(e) => setNf2({ ...nf2, method: e.target.value as EdcService })} className={inp}>{(termOf(nf2.terminal_id)?.services ?? ["card"]).map((s) => <option key={s} value={s}>{svcLabel(s)}</option>)}</select>
            </label>
            <label className="text-xs text-muted block">{L("จำนวนเงิน (บาท)", "Amount (฿)", "金额")}<input value={nf2.amount} onChange={(e) => setNf2({ ...nf2, amount: e.target.value })} className={`${inp} font-mono`} inputMode="decimal" placeholder="0.00" /></label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs text-muted block">{L("เลขบิล (ถ้ามี)", "Bill no.", "单号")}<input value={nf2.order_no} onChange={(e) => setNf2({ ...nf2, order_no: e.target.value })} className={`${inp} font-mono`} placeholder="POS-…" /></label>
            {nf2.method === "installment" ? <label className="text-xs text-muted block">{L("งวดผ่อน", "Months", "分期")}<input value={nf2.months} onChange={(e) => setNf2({ ...nf2, months: e.target.value })} className={`${inp} font-mono`} inputMode="numeric" placeholder="6" /></label> : null}
          </div>
        </div>
      </Modal>

      {/* Modal: บันทึกผล (resolve pending/error) */}
      <Modal open={!!resolveT} onClose={() => setResolveT(null)} title={L("บันทึกผลรายการ", "Record result", "记录结果")} size="md"
        footer={<>
          <button onClick={() => setResolveT(null)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
          <button onClick={() => void submitResolve()} disabled={busy} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {L("บันทึก", "Save", "保存")}</button>
        </>}>
        {resolveT && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm bg-surface2 rounded-lg px-3 py-2.5">
              <span className="text-muted">{termLabel(resolveT.terminal_id)} · {svcLabel(resolveT.method)}{resolveT.order_no ? ` · ${resolveT.order_no}` : ""}</span>
              <span className="tnum font-bold">฿{nf(resolveT.amount)}</span>
            </div>
            <div><div className="text-xs text-muted mb-1.5">{L("ผลลัพธ์", "Result", "结果")}</div>
              <Segmented value={rf.status} onChange={(v) => setRf({ ...rf, status: v as "approved" | "declined" | "error" })} options={[{ value: "approved", label: L("อนุมัติ", "Approved", "批准") }, { value: "declined", label: L("ปฏิเสธ", "Declined", "拒绝") }, { value: "error", label: L("ตรวจสอบ", "Error", "核查") }]} />
            </div>
            {rf.status === "approved" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <label className="text-xs text-muted block">{L("รหัสอนุมัติ", "Approval code", "批准码")}<input value={rf.approval_code} onChange={(e) => setRf({ ...rf, approval_code: e.target.value })} className={`${inp} font-mono`} placeholder="123456" /></label>
                <label className="text-xs text-muted block">{L("เลขอ้างอิง (Ref)", "Reference", "参考号")}<input value={rf.ref_no} onChange={(e) => setRf({ ...rf, ref_no: e.target.value })} className={`${inp} font-mono`} /></label>
              </div>
            ) : null}
            <label className="text-xs text-muted block">{L("หมายเหตุ", "Note", "备注")}<input value={rf.note} onChange={(e) => setRf({ ...rf, note: e.target.value })} className={inp} /></label>
          </div>
        )}
      </Modal>

      {/* Drawer: รายละเอียดสรุปรายวัน (แยกเครื่อง/กะ/รายการ) */}
      <Drawer open={!!reconSel} onClose={() => setReconKey(null)} width="md"
        title={reconSel ? <span className="inline-flex items-center gap-2"><ListChecks size={18} /> {branchName(reconSel.branchId)}</span> : ""}
        subtitle={reconSel ? `${reconSel.day} · ${L("ควรได้", "expected", "应收")} ฿${nf(reconSel.expected)} · ${reconSel.count} ${L("รายการ", "txns", "笔")}` : undefined}>
        {reconSel && (
          <div className="p-4 space-y-4">
            {/* สรุปเงิน */}
            {(() => { const actual = stmtRows.length ? reconActual(reconSel) : null; const diff = actual != null ? reconSel.expected - actual : null; return (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-surface2/60 p-2.5"><p className="text-[10px] text-muted">{L("ควรได้", "Expected", "应收")}</p><p className="tnum font-bold text-sm">฿{nf(reconSel.expected)}</p></div>
                <div className="rounded-xl bg-surface2/60 p-2.5"><p className="text-[10px] text-muted">{L("เงินเข้าจริง", "Actual", "实收")}</p>{actual == null ? <p className="text-xs text-muted pt-1">{L("ยังไม่เชื่อม", "N/A", "未接")}</p> : <p className="tnum font-bold text-sm">฿{nf(actual)}</p>}</div>
                <div className={`rounded-xl p-2.5 ${diff != null && Math.abs(diff) >= 1 ? "bg-danger/10" : "bg-surface2/60"}`}><p className="text-[10px] text-muted">{L("ส่วนต่าง", "Diff", "差额")}</p>{diff == null ? <p className="text-xs text-muted pt-1">—</p> : <p className={`tnum font-bold text-sm ${Math.abs(diff) < 1 ? "text-emerald-500" : "text-danger"}`}>{Math.abs(diff) < 1 ? "0" : `${diff > 0 ? "+" : ""}${nf(diff)}`}</p>}</div>
              </div>
            ); })()}

            {/* แยกตามเครื่อง EDC */}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted mb-2"><Cpu size={13} /> {L("แยกตามเครื่อง EDC", "By terminal", "按设备")}</div>
              <div className="divide-y divide-line">
                {[...reconSel.terminals.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([tid, v]) => { const tm = termOf(tid); return (
                  <div key={tid} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0"><p className="text-sm font-mono font-medium">{termLabel(tid)}</p><p className="text-[10px] text-muted truncate">{acqName(tm?.acquirer_id ?? null)}{tm?.mid ? ` · MID ${tm.mid}` : ""}</p></div>
                    <div className="text-right shrink-0"><p className="tnum text-sm font-semibold">฿{nf(v.amount)}</p><p className="text-[10px] text-muted">{v.count} {L("รายการ", "txns", "笔")}</p></div>
                  </div>
                ); })}
              </div>
            </div>

            {/* แยกตามกะ/พนักงาน */}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted mb-2"><User size={13} /> {L("แยกตามกะ / พนักงาน", "By shift / staff", "按班次")}</div>
              <div className="divide-y divide-line">
                {[...reconSel.cashiers.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([cn, v]) => (
                  <div key={cn} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0"><p className="text-sm font-medium">{cn}</p><p className="text-[10px] text-muted">{L("ช่วง", "shift", "时段")} {hhmm(v.first)}–{hhmm(v.last)}</p></div>
                    <div className="text-right shrink-0"><p className="tnum text-sm font-semibold">฿{nf(v.amount)}</p><p className="text-[10px] text-muted">{v.count} {L("รายการ", "txns", "笔")}</p></div>
                  </div>
                ))}
              </div>
            </div>

            {/* รายการทั้งหมด */}
            <div>
              <div className="text-xs font-semibold text-muted mb-2">{L("รายการทั้งหมด", "All transactions", "全部交易")}</div>
              <div className="divide-y divide-line">
                {reconSel.txns.sort((a, b) => (a.at < b.at ? -1 : 1)).map((t) => { const matched = match.usedTxnIds.has(t.id); return (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                    <span className="text-muted whitespace-nowrap">{hhmm(t.at)}</span>
                    <span className="flex-1 min-w-0 truncate">{svcLabel(t.method)} · <span className="font-mono text-muted">{termLabel(t.terminal_id)}</span> · {t.cashier_name}</span>
                    {stmtRows.length ? (matched ? <Check size={13} className="text-emerald-500 shrink-0" /> : <span className="text-[10px] text-amber-500 shrink-0">{L("รอ", "wait", "待")}</span>) : null}
                    <span className="tnum font-medium shrink-0">฿{nf(t.amount)}</span>
                  </div>
                ); })}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
