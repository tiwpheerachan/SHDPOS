"use client";

// =====================================================================
// Admin → ลูกค้า (CRM)
//   • รายชื่อลูกค้า + ค้นหา + แบ่งกลุ่ม (ใหม่/ซื้อซ้ำ/VIP/หายไป)
//   • เปิดโปรไฟล์ → RFM + ประวัติการซื้อ "รวมทุกสาขา"
//   ดึงจาก /api/admin/customers (service-role) จึงเห็นข้ามสาขา/ข้ามเครื่อง
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Phone, Mail, Star, Wallet, Contact, ShoppingBag, CalendarClock,
  TrendingUp, Clock, Loader2, ChevronRight, MapPin, Combine, ShieldCheck,
} from "lucide-react";
import { listBranches } from "@/lib/data/repo";
import type { Branch } from "@/lib/types";
import { Drawer, EmptyState, Modal } from "@/components/ui";
import { formatTHB } from "@/lib/money";

type Segment = "new" | "returning" | "vip" | "lost";

interface Row {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  member_code: string | null;
  points: number;
  store_credit: number;
  tier: string | null;
  orders: number;
  spend: number;
  last: string | null;
  recencyDays: number | null;
  segment: Segment;
}

interface DupeMember {
  id: string; name: string; phone: string | null; email: string | null;
  member_code: string | null; orders: number; points: number; store_credit: number; created_at: string;
}
interface DupeGroup { phone: string; members: DupeMember[] }

interface OrderItemRow { sku: string; name: string; qty: number; unit_price: number; line_total: number }
interface OrderRow {
  id: string; order_no: string; created_at: string; branch_id: string;
  grand_total: number; status: string; channel: string; order_items: OrderItemRow[];
}
interface LedgerRow {
  id: string; kind: string; points_delta: number; credit_delta: number;
  balance_points: number | null; balance_credit: number | null; note: string | null; created_at: string;
}
interface TaskLite {
  id: string; kind: string; title: string; note: string | null; due_date: string | null;
  status: string; result: string | null; created_at: string;
}
interface Detail {
  customer: Record<string, unknown> & { id: string; name: string; phone?: string | null; email?: string | null; points?: number; store_credit?: number; tax_id?: string | null; note?: string | null; contact_consent?: boolean; consent_channels?: string[]; consent_at?: string | null };
  stat: { count: number; spend: number; avg: number; last: string | null; first: string | null; recencyDays: number | null; segment: Segment };
  orders: OrderRow[];
  ledger: LedgerRow[];
  tasks: TaskLite[];
}

const TASK_KIND_LABEL: Record<string, string> = {
  follow_up: "ติดตาม", quotation: "ใบเสนอราคา", warranty: "ประกัน", callback: "โทรกลับ", other: "อื่นๆ",
};

const LEDGER_LABEL: Record<string, string> = {
  earn: "ได้แต้ม", redeem: "ใช้แต้ม", reverse: "คืน (ยกเลิกบิล)",
  topup: "เติมเครดิต", spend: "ใช้เครดิต", adjust: "ปรับโดยแอดมิน", refund: "คืนเงิน",
  expire: "แต้มหมดอายุ",
};

const CONSENT_CHANNELS: { v: string; label: string }[] = [
  { v: "sms", label: "SMS" }, { v: "email", label: "อีเมล" },
  { v: "line", label: "LINE" }, { v: "call", label: "โทรศัพท์" },
];

const SEG: Record<Segment, { label: string; cls: string }> = {
  new: { label: "ลูกค้าใหม่", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  returning: { label: "ซื้อซ้ำ", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  vip: { label: "VIP", cls: "bg-amber-500/18 text-amber-700 dark:text-amber-300" },
  lost: { label: "หายไป", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-300" },
};

const FILTERS: { v: "all" | Segment; label: string }[] = [
  { v: "all", label: "ทั้งหมด" },
  { v: "new", label: "ลูกค้าใหม่" },
  { v: "returning", label: "ซื้อซ้ำ" },
  { v: "vip", label: "VIP" },
  { v: "lost", label: "หายไป" },
];

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[1][0]).toUpperCase();
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}
function recencyLabel(d: number | null): string {
  if (d === null) return "ยังไม่เคยซื้อ";
  if (d === 0) return "วันนี้";
  if (d < 30) return `${d} วันก่อน`;
  if (d < 365) return `${Math.floor(d / 30)} เดือนก่อน`;
  return `${Math.floor(d / 365)} ปีก่อน`;
}

export default function AdminCustomersPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [seg, setSeg] = useState<"all" | Segment>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [adjustMode, setAdjustMode] = useState<null | "credit" | "points">(null);
  const [adjustAmt, setAdjustAmt] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [saving, setSaving] = useState(false);

  // รวมลูกค้าซ้ำ
  const [dupeOpen, setDupeOpen] = useState(false);
  const [dupeLoading, setDupeLoading] = useState(false);
  const [dupeGroups, setDupeGroups] = useState<DupeGroup[]>([]);
  const [primaryChoice, setPrimaryChoice] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);

  // quick-add งานติดตามในโปรไฟล์
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskSaving, setTaskSaving] = useState(false);

  async function addTask() {
    if (!openId || !taskTitle.trim()) return;
    setTaskSaving(true);
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: openId, title: taskTitle.trim(), due_date: taskDue || null, kind: "follow_up" }),
      });
      if (res.ok) { setTaskTitle(""); setTaskDue(""); await loadDetail(openId); }
    } finally {
      setTaskSaving(false);
    }
  }
  async function completeTask(id: string) {
    const res = await fetch("/api/admin/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    if (res.ok && openId) await loadDetail(openId);
  }

  // PDPA consent
  const [consentDraft, setConsentDraft] = useState<{ on: boolean; channels: string[] } | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  async function saveConsent() {
    if (!openId || !consentDraft) return;
    setConsentSaving(true);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: openId, consent: { contact_consent: consentDraft.on, consent_channels: consentDraft.channels } }),
      });
      if (res.ok) { setConsentDraft(null); await loadDetail(openId); }
    } finally {
      setConsentSaving(false);
    }
  }

  // แต้มหมดอายุ (maintenance)
  const [expiring, setExpiring] = useState(false);
  async function runExpire() {
    setExpiring(true);
    try {
      const j = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "expire_points" }),
      }).then((r) => r.json());
      alert(j.error ? `ผิดพลาด: ${j.error}` : `หมดอายุไปทั้งหมด ${j.expired ?? 0} แต้ม`);
      await loadList();
    } finally {
      setExpiring(false);
    }
  }

  const loadDetail = useCallback(async (cid: string) => {
    const j = await fetch(`/api/admin/customers?id=${cid}`).then((r) => r.json());
    if (!j.error) setDetail(j);
  }, []);

  async function submitAdjust() {
    if (!openId || !adjustMode) return;
    const n = Number(adjustAmt);
    if (!n || Number.isNaN(n)) return;
    setSaving(true);
    try {
      const body = adjustMode === "credit"
        ? { customer_id: openId, credit: n, kind: n > 0 ? "topup" : "adjust", note: adjustNote.trim() || undefined }
        : { customer_id: openId, points: Math.trunc(n), kind: "adjust", note: adjustNote.trim() || undefined };
      const res = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (res.ok) {
        setAdjustMode(null); setAdjustAmt(""); setAdjustNote("");
        await loadDetail(openId);
      }
    } finally {
      setSaving(false);
    }
  }

  async function openDupes() {
    setDupeOpen(true);
    setDupeLoading(true);
    try {
      const j = await fetch("/api/admin/customers?duplicates=1").then((r) => r.json());
      const groups: DupeGroup[] = Array.isArray(j.groups) ? j.groups : [];
      setDupeGroups(groups);
      const choice: Record<string, string> = {};
      for (const g of groups) choice[g.phone] = g.members[0]?.id;
      setPrimaryChoice(choice);
    } finally {
      setDupeLoading(false);
    }
  }

  async function doMerge(g: DupeGroup) {
    const primary = primaryChoice[g.phone];
    if (!primary) return;
    const losers = g.members.filter((m) => m.id !== primary).map((m) => m.id);
    if (!losers.length) return;
    setMerging(g.phone);
    try {
      const res = await fetch("/api/admin/customers/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_id: primary, merge_ids: losers }),
      });
      if (res.ok) {
        setDupeGroups((prev) => prev.filter((x) => x.phone !== g.phone));
        void loadList();
      }
    } finally {
      setMerging(null);
    }
  }

  useEffect(() => { void listBranches().then(setBranches); }, []);
  const branchName = useCallback(
    (id: string) => branches.find((b) => b.id === id)?.name ?? "—",
    [branches]
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers?q=${encodeURIComponent(q.trim())}`);
      const json = await res.json();
      setRows(Array.isArray(json.customers) ? json.customers : []);
    } finally {
      setLoading(false);
    }
  }, [q]);

  // โหลดรายชื่อ (debounce ตามคำค้น)
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => { if (alive) void loadList(); }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(id); };
  }, [q, loadList]);

  // โหลดโปรไฟล์
  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    setAdjustMode(null); setAdjustAmt(""); setAdjustNote("");
    setConsentDraft(null); setTaskTitle(""); setTaskDue("");
    void loadDetail(openId).finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [openId, loadDetail]);

  const filtered = useMemo(
    () => (seg === "all" ? rows : rows.filter((r) => r.segment === seg)),
    [rows, seg]
  );

  const kpi = useMemo(() => {
    const total = rows.length;
    const vip = rows.filter((r) => r.segment === "vip").length;
    const lost = rows.filter((r) => r.segment === "lost").length;
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    return { total, vip, lost, spend };
  }, [rows]);

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      {/* หัว + KPI */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Contact size={22} /> ลูกค้า</h1>
          <p className="text-sm text-muted mt-0.5">ฐานข้อมูลลูกค้า + ประวัติการซื้อรวมทุกสาขา</p>
        </div>
        <div className="flex gap-2">
          <Kpi label="ลูกค้าทั้งหมด" value={String(kpi.total)} icon={<Contact size={15} />} />
          <Kpi label="VIP" value={String(kpi.vip)} icon={<Star size={15} />} tone="amber" />
          <Kpi label="หายไป" value={String(kpi.lost)} icon={<Clock size={15} />} tone="rose" />
        </div>
      </div>

      {/* ค้นหา + ตรวจซ้ำ */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อ เบอร์โทร อีเมล หรือรหัสสมาชิก…"
            className="w-full h-11 pl-11 pr-4 rounded-2xl bg-surface2/70 border border-line focus:border-brand/40 focus:bg-surface outline-none text-sm transition-colors"
          />
        </div>
        <button
          onClick={() => void openDupes()}
          className="h-11 px-4 rounded-2xl border border-line bg-surface hover:bg-surface2 text-sm font-semibold inline-flex items-center gap-2 shrink-0"
        >
          <Combine size={16} /> <span className="hidden sm:inline">ตรวจลูกค้าซ้ำ</span>
        </button>
        <button
          onClick={() => void runExpire()} disabled={expiring}
          title="หักแต้มที่หมดอายุทั้งระบบ"
          className="h-11 px-4 rounded-2xl border border-line bg-surface hover:bg-surface2 text-sm font-semibold inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
        >
          {expiring ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />} <span className="hidden sm:inline">แต้มหมดอายุ</span>
        </button>
      </div>

      {/* ตัวกรองกลุ่ม */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setSeg(f.v)}
            className={`px-3.5 h-8 rounded-full text-xs font-semibold transition-colors ${
              seg === f.v ? "bg-brand text-brand-ink" : "bg-surface2 text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* รายชื่อ */}
      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> กำลังโหลด…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Contact size={26} />} title="ยังไม่มีลูกค้า" body="ลูกค้าจะปรากฏที่นี่เมื่อผูกกับบิลในหน้าขาย" />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className="group text-left flex items-center gap-3 p-3 rounded-2xl border border-line bg-surface hover:bg-surface2/60 hover:shadow-sm transition-all"
            >
              <span className="grid place-items-center w-11 h-11 rounded-full text-white text-sm font-bold shrink-0"
                style={{ background: "linear-gradient(145deg,#0a84ff,#5e5ce6)" }}>
                {initials(c.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{c.name}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEG[c.segment].cls}`}>{SEG[c.segment].label}</span>
                </span>
                <span className="flex items-center gap-3 text-[11.5px] text-muted mt-0.5">
                  {c.phone && <span className="inline-flex items-center gap-1 truncate"><Phone size={11} />{c.phone}</span>}
                  <span className="inline-flex items-center gap-1"><ShoppingBag size={11} />{c.orders} บิล</span>
                </span>
                <span className="flex items-center gap-3 text-[11.5px] mt-1">
                  <span className="font-semibold tnum">{formatTHB(c.spend, false)}</span>
                  <span className="text-muted">· ซื้อล่าสุด {recencyLabel(c.recencyDays)}</span>
                </span>
              </span>
              <ChevronRight size={16} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* โปรไฟล์ลูกค้า */}
      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        width="lg"
        title={detail?.customer.name ?? "โปรไฟล์ลูกค้า"}
        subtitle={detail?.customer.phone ?? undefined}
        badge={detail ? <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${SEG[detail.stat.segment].cls}`}>{SEG[detail.stat.segment].label}</span> : undefined}
      >
        {detailLoading || !detail ? (
          <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> กำลังโหลดประวัติ…</div>
        ) : (
          <div className="space-y-5">
            {/* ติดต่อ */}
            {(detail.customer.email || detail.customer.tax_id) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {detail.customer.email ? <Pill icon={<Mail size={13} />}>{String(detail.customer.email)}</Pill> : null}
                {detail.customer.tax_id ? <Pill icon={<span className="font-bold">#</span>}>{String(detail.customer.tax_id)}</Pill> : null}
              </div>
            )}

            {/* กระเป๋าเงิน — แต้ม + เครดิต พร้อมปุ่มจัดการ */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3.5 rounded-2xl border border-amber-500/25 bg-amber-500/5">
                <div className="flex items-center gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-300 font-medium"><Star size={13} /> แต้มสะสม</div>
                <div className="text-2xl font-bold tnum mt-0.5">{Number(detail.customer.points ?? 0).toLocaleString()}</div>
                <button onClick={() => { setAdjustMode("points"); setAdjustAmt(""); setAdjustNote(""); }}
                  className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline">ปรับแต้ม →</button>
              </div>
              <div className="p-3.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/5">
                <div className="flex items-center gap-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300 font-medium"><Wallet size={13} /> เครดิตร้าน</div>
                <div className="text-2xl font-bold tnum mt-0.5">{formatTHB(Number(detail.customer.store_credit ?? 0), false)}</div>
                <button onClick={() => { setAdjustMode("credit"); setAdjustAmt(""); setAdjustNote(""); }}
                  className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline">เติม / ปรับ →</button>
              </div>
            </div>

            {/* ฟอร์มปรับแต้ม/เครดิต */}
            {adjustMode && (
              <div className="p-3.5 rounded-2xl border border-line bg-surface2/50 space-y-2.5">
                <div className="text-sm font-semibold">
                  {adjustMode === "credit" ? "เติม / ปรับเครดิตร้าน" : "ปรับแต้มสะสม"}
                  <span className="text-muted font-normal"> — ใส่ค่าบวกเพื่อเพิ่ม, ลบเพื่อลด</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number" autoFocus value={adjustAmt} onChange={(e) => setAdjustAmt(e.target.value)}
                    placeholder={adjustMode === "credit" ? "จำนวนเงิน (บาท) เช่น 500 หรือ -100" : "จำนวนแต้ม เช่น 50 หรือ -10"}
                    className="flex-1 h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40"
                  />
                </div>
                <input
                  value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)"
                  className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40"
                />
                <div className="flex gap-2">
                  <button onClick={() => setAdjustMode(null)} className="flex-1 h-10 rounded-xl bg-surface2 text-sm font-semibold text-muted hover:text-ink">ยกเลิก</button>
                  <button onClick={() => void submitAdjust()} disabled={saving || !Number(adjustAmt)}
                    className="flex-1 h-10 rounded-xl bg-brand text-brand-ink text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : null} บันทึก
                  </button>
                </div>
              </div>
            )}

            {/* RFM */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Rfm icon={<CalendarClock size={16} />} label="ซื้อล่าสุด" value={recencyLabel(detail.stat.recencyDays)} sub={fmtDate(detail.stat.last)} />
              <Rfm icon={<ShoppingBag size={16} />} label="จำนวนครั้ง" value={`${detail.stat.count} บิล`} sub={`ตั้งแต่ ${fmtDate(detail.stat.first)}`} />
              <Rfm icon={<TrendingUp size={16} />} label="ยอดซื้อรวม" value={formatTHB(detail.stat.spend, false)} />
              <Rfm icon={<Wallet size={16} />} label="เฉลี่ย/บิล" value={formatTHB(detail.stat.avg, false)} />
            </div>

            {/* ประวัติการซื้อ */}
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Clock size={15} /> ประวัติการซื้อ ({detail.orders.length})</h3>
              {detail.orders.length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">ยังไม่มีบิล</p>
              ) : (
                <ul className="space-y-2">
                  {detail.orders.map((o) => (
                    <li key={o.id} className="rounded-xl border border-line overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-surface2/50">
                        <span className="font-mono text-xs font-semibold">{o.order_no}</span>
                        {o.status === "voided" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600">ยกเลิก</span>}
                        <span className="text-[11px] text-muted inline-flex items-center gap-1"><MapPin size={10} />{branchName(o.branch_id)}</span>
                        <span className="ml-auto text-[11px] text-muted">{fmtDate(o.created_at)}</span>
                        <span className="font-semibold text-sm tnum tabular-nums">{formatTHB(Number(o.grand_total), false)}</span>
                      </div>
                      {o.order_items?.length ? (
                        <ul className="px-3 py-1.5 divide-y divide-line/60">
                          {o.order_items.map((it, i) => (
                            <li key={i} className="flex items-center gap-2 py-1 text-xs">
                              <span className="flex-1 truncate">{it.name}</span>
                              <span className="text-muted">×{Number(it.qty)}</span>
                              <span className="tnum w-20 text-right">{formatTHB(Number(it.line_total), false)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ประวัติแต้ม/เครดิต (ledger) */}
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Star size={15} /> ประวัติแต้ม &amp; เครดิต ({detail.ledger.length})</h3>
              {detail.ledger.length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">ยังไม่มีการเคลื่อนไหว</p>
              ) : (
                <ul className="divide-y divide-line/60 rounded-xl border border-line overflow-hidden">
                  {detail.ledger.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{LEDGER_LABEL[l.kind] ?? l.kind}</span>
                        {l.note && <span className="block text-[11px] text-muted truncate">{l.note}</span>}
                      </span>
                      <span className="text-right shrink-0">
                        {l.points_delta !== 0 && (
                          <span className={`block text-xs font-bold tnum ${l.points_delta > 0 ? "text-amber-600 dark:text-amber-300" : "text-rose-600 dark:text-rose-300"}`}>
                            {l.points_delta > 0 ? "+" : ""}{l.points_delta} แต้ม
                          </span>
                        )}
                        {Number(l.credit_delta) !== 0 && (
                          <span className={`block text-xs font-bold tnum ${Number(l.credit_delta) > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
                            {Number(l.credit_delta) > 0 ? "+" : ""}{formatTHB(Number(l.credit_delta), false)}
                          </span>
                        )}
                      </span>
                      <span className="text-[10.5px] text-muted w-16 text-right shrink-0">{fmtDate(l.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* งานติดตาม / นัดหมาย */}
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><CalendarClock size={15} /> งานติดตาม</h3>
              <div className="flex gap-2 mb-2">
                <input
                  value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="เพิ่มงานติดตาม เช่น โทรเช็คความพอใจ"
                  onKeyDown={(e) => { if (e.key === "Enter") void addTask(); }}
                  className="flex-1 h-9 px-3 rounded-xl bg-surface2/60 border border-line outline-none text-sm focus:border-brand/40"
                />
                <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
                  className="h-9 px-2 rounded-xl bg-surface2/60 border border-line text-sm text-ink" />
                <button onClick={() => void addTask()} disabled={!taskTitle.trim() || taskSaving}
                  className="h-9 px-3 rounded-xl bg-brand text-brand-ink text-sm font-bold disabled:opacity-50">เพิ่ม</button>
              </div>
              {detail.tasks.length === 0 ? (
                <p className="text-xs text-muted py-2">ยังไม่มีงานติดตาม</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.tasks.map((tk) => {
                    const done = tk.status === "done";
                    const overdue = !done && !!tk.due_date && tk.due_date < new Date().toISOString().slice(0, 10);
                    return (
                      <li key={tk.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line">
                        {!done && (
                          <button onClick={() => void completeTask(tk.id)} title="ทำเสร็จ"
                            className="w-5 h-5 rounded-full border-2 border-emerald-500/50 hover:bg-emerald-500/20 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={`text-sm ${done ? "line-through text-muted" : "font-medium"}`}>{tk.title}</span>
                          <span className="block text-[11px] text-muted">
                            {TASK_KIND_LABEL[tk.kind] ?? tk.kind}
                            {tk.due_date && ` · ${fmtDate(tk.due_date)}`}
                            {tk.result && ` · ผล: ${tk.result}`}
                          </span>
                        </span>
                        {overdue && <span className="text-[10px] font-bold text-rose-600">เกินกำหนด</span>}
                        {done && <span className="text-[10px] font-bold text-emerald-600">เสร็จ</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* ความยินยอมติดต่อ (PDPA) */}
            {(() => {
              const cOn = consentDraft ? consentDraft.on : !!detail.customer.contact_consent;
              const cCh = consentDraft ? consentDraft.channels : (detail.customer.consent_channels ?? []);
              const toggle = (on: boolean, ch: string[]) => setConsentDraft({ on, channels: ch });
              return (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck size={15} /> การยินยอมติดต่อ (PDPA)</h3>
                  <div className="p-3.5 rounded-2xl border border-line bg-surface2/40 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={cOn} onChange={(e) => toggle(e.target.checked, cCh)} className="w-4 h-4 accent-current" />
                      <span className="text-sm font-medium">ยินยอมรับข่าวสาร/โปรโมชัน</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {CONSENT_CHANNELS.map((ch) => {
                        const on = cCh.includes(ch.v);
                        return (
                          <button key={ch.v} disabled={!cOn}
                            onClick={() => toggle(cOn, on ? cCh.filter((x) => x !== ch.v) : [...cCh, ch.v])}
                            className={`px-3 h-8 rounded-full text-xs font-semibold transition-colors disabled:opacity-40 ${on ? "bg-brand text-brand-ink" : "bg-surface border border-line text-muted"}`}>
                            {ch.label}
                          </button>
                        );
                      })}
                    </div>
                    {detail.customer.consent_at && (
                      <p className="text-[11px] text-muted">อัปเดตล่าสุด {fmtDate(String(detail.customer.consent_at))}</p>
                    )}
                    {consentDraft && (
                      <div className="flex gap-2">
                        <button onClick={() => setConsentDraft(null)} className="flex-1 h-9 rounded-xl bg-surface2 text-sm font-semibold text-muted">ยกเลิก</button>
                        <button onClick={() => void saveConsent()} disabled={consentSaving}
                          className="flex-1 h-9 rounded-xl bg-brand text-brand-ink text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                          {consentSaving ? <Loader2 size={14} className="animate-spin" /> : null} บันทึก
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Drawer>

      {/* รวมลูกค้าซ้ำ */}
      <Modal open={dupeOpen} onClose={() => setDupeOpen(false)} title="ตรวจ & รวมลูกค้าซ้ำ" size="lg">
        {dupeLoading ? (
          <div className="py-16 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> กำลังตรวจหาเบอร์โทรซ้ำ…</div>
        ) : dupeGroups.length === 0 ? (
          <EmptyState icon={<Combine size={26} />} title="ไม่พบลูกค้าซ้ำ" body="ไม่มีเบอร์โทรที่ซ้ำกันในระบบ" />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              พบ {dupeGroups.length} กลุ่มที่มีเบอร์โทรเดียวกัน — เลือกคนที่จะเก็บไว้ (หลัก) แล้วกดรวม ระบบจะย้ายบิล แต้ม เครดิต มารวมที่คนนั้น
            </p>
            {dupeGroups.map((g) => {
              const primary = primaryChoice[g.phone];
              const isMerging = merging === g.phone;
              return (
                <div key={g.phone} className="rounded-2xl border border-line overflow-hidden">
                  <div className="px-3 py-2 bg-surface2/50 flex items-center gap-2 text-xs">
                    <Phone size={12} /> <span className="font-mono font-semibold">{g.phone}</span>
                    <span className="text-muted">· {g.members.length} รายการ</span>
                  </div>
                  <div className="divide-y divide-line/60">
                    {g.members.map((m) => (
                      <label key={m.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer ${primary === m.id ? "bg-brand/5" : ""}`}>
                        <input
                          type="radio" name={`p-${g.phone}`} checked={primary === m.id}
                          onChange={() => setPrimaryChoice((c) => ({ ...c, [g.phone]: m.id }))}
                          className="accent-current"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-semibold truncate flex items-center gap-2">
                            {m.name}
                            {primary === m.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand text-brand-ink">เก็บไว้</span>}
                          </span>
                          <span className="flex items-center gap-3 text-[11px] text-muted mt-0.5">
                            <span className="inline-flex items-center gap-1"><ShoppingBag size={10} />{m.orders} บิล</span>
                            {!!m.points && <span className="inline-flex items-center gap-1"><Star size={10} />{m.points}</span>}
                            {!!m.store_credit && <span className="inline-flex items-center gap-1"><Wallet size={10} />{formatTHB(m.store_credit, false)}</span>}
                            {m.email && <span className="truncate">{m.email}</span>}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-t border-line">
                    <span className="text-[11px] text-muted">รวมอีก {g.members.length - 1} รายเข้าคนที่เลือก</span>
                    <button
                      onClick={() => void doMerge(g)} disabled={isMerging || !primary}
                      className="h-9 px-4 rounded-xl bg-brand text-brand-ink text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isMerging ? <Loader2 size={15} className="animate-spin" /> : <Combine size={15} />} รวมเป็นคนเดียว
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone?: "amber" | "rose" }) {
  const toneCls = tone === "amber" ? "text-amber-600 dark:text-amber-300" : tone === "rose" ? "text-rose-600 dark:text-rose-300" : "text-ink";
  return (
    <div className="px-3.5 py-2 rounded-2xl border border-line bg-surface min-w-[96px]">
      <div className="text-[11px] text-muted flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-bold leading-tight ${toneCls}`}>{value}</div>
    </div>
  );
}
function Pill({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface2 text-ink/80">{icon}{children}</span>;
}
function Rfm({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded-2xl border border-line bg-surface">
      <div className="text-muted flex items-center gap-1.5 text-[11px]">{icon}{label}</div>
      <div className="text-[15px] font-bold leading-tight mt-1">{value}</div>
      {sub && <div className="text-[10.5px] text-muted mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
