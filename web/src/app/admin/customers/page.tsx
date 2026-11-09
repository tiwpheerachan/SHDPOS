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
  TrendingUp, Clock, Loader2, MapPin, Combine, ShieldCheck, UserPlus,
} from "lucide-react";
import { listBranches } from "@/lib/data/repo";
import { useScopeFilter } from "@/lib/store/scope-filter";
import type { Branch } from "@/lib/types";
import { Drawer, EmptyState, Modal, Table, Th, Td, Avatar } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { useI18n } from "@/lib/i18n/provider";

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
  branch_name?: string; brand_names?: string[];
}
interface ScopeStat { name: string; spend: number; orders: number }
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
  origin?: { branch: string | null; brand: string | null } | null;
  byBrand?: ScopeStat[];
  byBranch?: ScopeStat[];
  brand_wallets?: { brand_id: string; brand_name: string; points: number; store_credit: number; tier: string }[];
  all_brands?: { id: string; name: string }[];
}

// ป้ายกำกับหลายภาษา (resolve ผ่าน L ตอนแสดงผล — key ยังเป็น enum เดิม)
type Tri = { th: string; en: string; zh: string };

const TASK_KIND_LABEL: Record<string, Tri> = {
  follow_up: { th: "ติดตาม", en: "Follow-up", zh: "跟进" },
  quotation: { th: "ใบเสนอราคา", en: "Quotation", zh: "报价单" },
  warranty: { th: "ประกัน", en: "Warranty", zh: "保修" },
  callback: { th: "โทรกลับ", en: "Callback", zh: "回电" },
  other: { th: "อื่นๆ", en: "Other", zh: "其他" },
};

const LEDGER_LABEL: Record<string, Tri> = {
  earn: { th: "ได้แต้ม", en: "Points earned", zh: "获得积分" },
  redeem: { th: "ใช้แต้ม", en: "Points redeemed", zh: "积分兑换" },
  reverse: { th: "คืน (ยกเลิกบิล)", en: "Reversed (voided)", zh: "冲正（作废）" },
  topup: { th: "เติมเครดิต", en: "Credit top-up", zh: "储值充值" },
  spend: { th: "ใช้เครดิต", en: "Credit used", zh: "使用储值" },
  adjust: { th: "ปรับโดยแอดมิน", en: "Admin adjustment", zh: "管理员调整" },
  refund: { th: "คืนเงิน", en: "Refund", zh: "退款" },
  expire: { th: "แต้มหมดอายุ", en: "Points expired", zh: "积分过期" },
  return: { th: "คืนแต้ม (คืนสินค้า)", en: "Points returned (return)", zh: "积分退回（退货）" },
};

const CONSENT_CHANNELS: { v: string; th: string; en: string; zh: string }[] = [
  { v: "sms", th: "SMS", en: "SMS", zh: "短信" },
  { v: "email", th: "อีเมล", en: "Email", zh: "邮箱" },
  { v: "line", th: "LINE", en: "LINE", zh: "LINE" },
  { v: "call", th: "โทรศัพท์", en: "Phone", zh: "电话" },
];

// โทนพาเลต iOS — accent tints (ไม่ใช้เหลืองแทนสถานะ)
const SEG: Record<Segment, { th: string; en: string; zh: string; cls: string }> = {
  new: { th: "ลูกค้าใหม่", en: "New", zh: "新客户", cls: "bg-aqua text-ink" },
  returning: { th: "ซื้อซ้ำ", en: "Returning", zh: "回头客", cls: "bg-mint text-ink" },
  vip: { th: "VIP", en: "VIP", zh: "VIP", cls: "bg-brand text-brandInk" },
  lost: { th: "หายไป", en: "Lost", zh: "流失", cls: "border border-line text-muted" },
};

const FILTERS: { v: "all" | Segment; th: string; en: string; zh: string }[] = [
  { v: "all", th: "ทั้งหมด", en: "All", zh: "全部" },
  { v: "new", th: "ลูกค้าใหม่", en: "New", zh: "新客户" },
  { v: "returning", th: "ซื้อซ้ำ", en: "Returning", zh: "回头客" },
  { v: "vip", th: "VIP", en: "VIP", zh: "VIP" },
  { v: "lost", th: "หายไป", en: "Lost", zh: "流失" },
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
function recencyLabel(d: number | null, L: (th: string, en: string, zh: string) => string): string {
  if (d === null) return L("ยังไม่เคยซื้อ", "Never purchased", "从未购买");
  if (d === 0) return L("วันนี้", "Today", "今天");
  if (d < 30) return L(`${d} วันก่อน`, `${d} days ago`, `${d} 天前`);
  if (d < 365) { const m = Math.floor(d / 30); return L(`${m} เดือนก่อน`, `${m} months ago`, `${m} 个月前`); }
  const y = Math.floor(d / 365);
  return L(`${y} ปีก่อน`, `${y} years ago`, `${y} 年前`);
}

export default function AdminCustomersPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
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
  const [adjustBrand, setAdjustBrand] = useState("");
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

  // สร้างลูกค้าใหม่ (ไม่ต้องมีการซื้อ)
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", phone: "", email: "", tax_id: "" });
  const [creating, setCreating] = useState(false);
  async function submitCreate() {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_customer", ...createForm }),
      });
      const j = await res.json();
      if (res.ok) { setCreateOpen(false); setCreateForm({ name: "", phone: "", email: "", tax_id: "" }); await loadList(); if (j.id) setOpenId(j.id); }
    } finally { setCreating(false); }
  }

  // แต้มหมดอายุ (maintenance)
  const [expiring, setExpiring] = useState(false);
  async function runExpire() {
    if (!confirm(L(
      "ดำเนินการตัดแต้มที่หมดอายุทั้งระบบ?\nแต้มที่เลยกำหนด 12 เดือนจะถูกหักออกจากลูกค้าทุกคน (ย้อนกลับไม่ได้)",
      "Expire points across the whole system?\nPoints older than 12 months will be deducted from every customer (cannot be undone)",
      "对全系统执行过期积分清理？\n超过 12 个月的积分将从每位客户中扣除（无法撤销）"
    ))) return;
    setExpiring(true);
    try {
      const j = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "expire_points" }),
      }).then((r) => r.json());
      alert(j.error
        ? L(`ผิดพลาด: ${j.error}`, `Error: ${j.error}`, `错误：${j.error}`)
        : L(`หมดอายุไปทั้งหมด ${j.expired ?? 0} แต้ม`, `${j.expired ?? 0} points expired in total`, `共计 ${j.expired ?? 0} 积分已过期`));
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
        ? { customer_id: openId, credit: n, kind: n > 0 ? "topup" : "adjust", note: adjustNote.trim() || undefined, brand_id: adjustBrand || undefined }
        : { customer_id: openId, points: Math.trunc(n), kind: "adjust", note: adjustNote.trim() || undefined, brand_id: adjustBrand || undefined };
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

  const { brandId: fBrand, branchId: fBranch } = useScopeFilter();
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (fBrand) params.set("brand_id", fBrand);
      if (fBranch) params.set("branch_id", fBranch);
      const res = await fetch(`/api/admin/customers?${params.toString()}`);
      const json = await res.json();
      setRows(Array.isArray(json.customers) ? json.customers : []);
    } finally {
      setLoading(false);
    }
  }, [q, fBrand, fBranch]);

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
          <h1 className="text-xl font-bold flex items-center gap-2"><Contact size={22} /> {L("ลูกค้า", "Customers", "客户")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("ฐานข้อมูลลูกค้า + ประวัติการซื้อรวมทุกสาขา", "Customer database + purchase history across all branches", "客户数据库 + 全门店购买记录")}</p>
        </div>
        <div className="flex gap-2 items-stretch">
          <button onClick={() => setCreateOpen(true)} className="h-full px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2 self-stretch">
            <UserPlus size={16} /> {L("ลูกค้าใหม่", "New customer", "新客户")}
          </button>
          <Kpi label={L("ลูกค้าทั้งหมด", "All customers", "全部客户")} value={String(kpi.total)} icon={<Contact size={15} />} />
          <Kpi label="VIP" value={String(kpi.vip)} icon={<Star size={15} />} />
          <Kpi label={L("หายไป", "Lost", "流失")} value={String(kpi.lost)} icon={<Clock size={15} />} />
        </div>
      </div>

      {/* ค้นหา + ตรวจซ้ำ */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L("ค้นหาชื่อ เบอร์โทร อีเมล หรือรหัสสมาชิก…", "Search name, phone, email or member code…", "搜索姓名、电话、邮箱或会员码…")}
            className="w-full h-11 pl-11 pr-4 rounded-2xl bg-surface2/70 border border-line focus:border-brand/40 focus:bg-surface outline-none text-sm transition-colors"
          />
        </div>
        <button
          onClick={() => void openDupes()}
          className="h-11 px-4 rounded-2xl border border-line bg-surface hover:bg-surface2 text-sm font-semibold inline-flex items-center gap-2 shrink-0"
        >
          <Combine size={16} /> <span className="hidden sm:inline">{L("ตรวจลูกค้าซ้ำ", "Check duplicates", "检查重复客户")}</span>
        </button>
        <button
          onClick={() => void runExpire()} disabled={expiring}
          title={L("หักแต้มที่หมดอายุทั้งระบบ", "Deduct expired points system-wide", "全系统扣除过期积分")}
          className="h-11 px-4 rounded-2xl border border-line bg-surface hover:bg-surface2 text-sm font-semibold inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
        >
          {expiring ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />} <span className="hidden sm:inline">{L("ตัดแต้มหมดอายุ", "Expire points", "清理过期积分")}</span>
        </button>
      </div>

      {/* ตัวกรองกลุ่ม */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setSeg(f.v)}
            className={`px-3.5 h-8 rounded-full text-xs font-semibold transition-colors ${
              seg === f.v ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"
            }`}
          >
            {L(f.th, f.en, f.zh)}
          </button>
        ))}
      </div>

      {/* รายชื่อ (ตาราง) */}
      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลด…", "Loading…", "加载中…")}</div>
      ) : filtered.length === 0 ? (
        q.trim() || seg !== "all" ? (
          <div className="flex flex-col items-center">
            <EmptyState icon={<Search size={26} />} title={L("ไม่พบผลลัพธ์", "No results", "无结果")} body={L("ลองเปลี่ยนคำค้นหรือกลุ่มลูกค้า", "Try a different search or customer segment", "请尝试更换搜索词或客户分组")} />
            <button onClick={() => { setQ(""); setSeg("all"); }} className="-mt-6 text-sm text-brand font-semibold hover:underline">{L("ล้างตัวกรอง", "Clear filters", "清除筛选")}</button>
          </div>
        ) : (
          <EmptyState icon={<Contact size={26} />} title={L("ยังไม่มีลูกค้าในระบบ", "No customers yet", "系统中暂无客户")} body={L("ลูกค้าจะปรากฏที่นี่เมื่อผูกกับบิลในหน้าขาย", "Customers appear here once linked to a bill at the POS", "客户在销售页关联单据后将显示在此处")} />
        )
      ) : (
        <div className="rounded-2xl border border-line overflow-hidden bg-surface">
          <div className="px-3.5 py-2 text-xs text-muted border-b border-line">{L(`พบ ${filtered.length} ราย`, `Found ${filtered.length}`, `找到 ${filtered.length} 条`)}</div>
          <Table>
            <thead>
              <tr>
                <Th>{L("ลูกค้า", "Customer", "客户")}</Th>
                <Th>{L("เบอร์โทร", "Phone", "电话")}</Th>
                <Th>{L("กลุ่ม", "Segment", "分组")}</Th>
                <Th align="right">{L("บิล", "Bills", "单数")}</Th>
                <Th align="right">{L("ยอดซื้อรวม", "Total spend", "累计消费")}</Th>
                <Th>{L("ซื้อล่าสุด", "Last purchase", "最近购买")}</Th>
                <Th align="right">{L("แต้ม", "Points", "积分")}</Th>
                <Th align="right">{L("เครดิต", "Credit", "储值")}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer hover:bg-surface2/50 transition-colors">
                  <Td>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={c.name} size={32} />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate max-w-[200px]">{c.name}</div>
                        {c.member_code && <div className="text-[11px] text-muted font-mono">{c.member_code}</div>}
                      </div>
                    </div>
                  </Td>
                  <Td className="text-xs text-muted whitespace-nowrap">{c.phone || "—"}</Td>
                  <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SEG[c.segment].cls}`}>{L(SEG[c.segment].th, SEG[c.segment].en, SEG[c.segment].zh)}</span></Td>
                  <Td align="right" className="text-sm">{c.orders}</Td>
                  <Td align="right" className="text-sm font-semibold">{formatTHB(c.spend, false)}</Td>
                  <Td className="text-xs text-muted whitespace-nowrap">{recencyLabel(c.recencyDays, L)}</Td>
                  <Td align="right" className="text-sm">{c.points.toLocaleString()}</Td>
                  <Td align="right" className="text-sm">{c.store_credit ? formatTHB(c.store_credit, false) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {/* โปรไฟล์ลูกค้า */}
      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        width="lg"
        title={detail?.customer.name ?? L("โปรไฟล์ลูกค้า", "Customer profile", "客户档案")}
        subtitle={detail?.customer.phone ?? undefined}
        badge={detail ? <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${SEG[detail.stat.segment].cls}`}>{L(SEG[detail.stat.segment].th, SEG[detail.stat.segment].en, SEG[detail.stat.segment].zh)}</span> : undefined}
      >
        {detailLoading || !detail ? (
          <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลดประวัติ…", "Loading history…", "正在加载记录…")}</div>
        ) : (
          <div className="p-4 sm:p-5 space-y-6">
            {/* ติดต่อ */}
            {(detail.customer.email || detail.customer.tax_id) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {detail.customer.email ? <Pill icon={<Mail size={13} />}>{String(detail.customer.email)}</Pill> : null}
                {detail.customer.tax_id ? <Pill icon={<span className="font-bold">#</span>}>{String(detail.customer.tax_id)}</Pill> : null}
              </div>
            )}

            {/* กระเป๋าสิทธิ์แยกตามแบรนด์ */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Wallet size={15} /> {L("กระเป๋าสิทธิ์ (แยกแบรนด์)", "Wallets (by brand)", "权益钱包（按品牌）")}</h3>
                <button onClick={() => { setAdjustMode("points"); setAdjustAmt(""); setAdjustNote(""); setAdjustBrand(detail.brand_wallets?.[0]?.brand_id ?? detail.all_brands?.[0]?.id ?? ""); }}
                  className="text-xs font-semibold text-brand hover:underline">{L("+ เติม/ปรับ", "+ Top up / adjust", "+ 充值 / 调整")}</button>
              </div>
              {(detail.brand_wallets?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted">{L(
                  `ยังไม่มีแต้ม/เครดิตในแบรนด์ใด — รวมทุกแบรนด์: ${Number(detail.customer.points ?? 0).toLocaleString()} แต้ม · ${formatTHB(Number(detail.customer.store_credit ?? 0), false)}`,
                  `No points/credit in any brand yet — all brands combined: ${Number(detail.customer.points ?? 0).toLocaleString()} pts · ${formatTHB(Number(detail.customer.store_credit ?? 0), false)}`,
                  `尚无任何品牌的积分/储值 — 全品牌合计：${Number(detail.customer.points ?? 0).toLocaleString()} 积分 · ${formatTHB(Number(detail.customer.store_credit ?? 0), false)}`
                )}</p>
              ) : (
                <div className="space-y-1.5">
                  {detail.brand_wallets!.map((w) => (
                    <div key={w.brand_id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-surface2/40">
                      <span className="text-sm font-semibold flex-1 truncate">{w.brand_name}</span>
                      <span className="inline-flex items-center gap-1 text-xs"><Star size={12} className="text-muted" />{w.points.toLocaleString()}</span>
                      <span className="inline-flex items-center gap-1 text-xs"><Wallet size={12} className="text-muted" />{formatTHB(w.store_credit, false)}</span>
                      <button onClick={() => { setAdjustMode("points"); setAdjustAmt(""); setAdjustNote(""); setAdjustBrand(w.brand_id); }}
                        className="text-[11px] font-semibold text-brand hover:underline shrink-0">{L("ปรับ", "Adjust", "调整")}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ฟอร์มปรับแต้ม/เครดิต (รายแบรนด์) */}
            {adjustMode && (
              <div className="p-3.5 rounded-2xl border border-line bg-surface2/50 space-y-2.5">
                <div className="flex gap-2">
                  <button onClick={() => setAdjustMode("points")} className={`flex-1 h-9 rounded-lg text-sm font-semibold ${adjustMode === "points" ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>{L("แต้ม", "Points", "积分")}</button>
                  <button onClick={() => setAdjustMode("credit")} className={`flex-1 h-9 rounded-lg text-sm font-semibold ${adjustMode === "credit" ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>{L("เครดิต", "Credit", "储值")}</button>
                </div>
                <select value={adjustBrand} onChange={(e) => setAdjustBrand(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink">
                  <option value="">{L("— เลือกแบรนด์ —", "— Select brand —", "— 选择品牌 —")}</option>
                  {(detail.all_brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input type="number" value={adjustAmt} onChange={(e) => setAdjustAmt(e.target.value)}
                  placeholder={adjustMode === "credit" ? L("จำนวนเงิน เช่น 500 หรือ -100", "Amount, e.g. 500 or -100", "金额，例如 500 或 -100") : L("จำนวนแต้ม เช่น 50 หรือ -10", "Points, e.g. 50 or -10", "积分，例如 50 或 -10")}
                  className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40" />
                <input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder={L("หมายเหตุ (ไม่บังคับ)", "Note (optional)", "备注（选填）")}
                  className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40" />
                <div className="flex gap-2">
                  <button onClick={() => setAdjustMode(null)} className="flex-1 h-10 rounded-xl bg-surface2 text-sm font-semibold text-muted hover:text-ink">{L("ยกเลิก", "Cancel", "取消")}</button>
                  <button onClick={() => void submitAdjust()} disabled={saving || !Number(adjustAmt) || !adjustBrand}
                    className="flex-1 h-10 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : null} {L("บันทึก", "Save", "保存")}
                  </button>
                </div>
              </div>
            )}

            {/* RFM */}
            <div className="grid grid-cols-2 gap-2.5">
              <Rfm icon={<CalendarClock size={16} />} label={L("ซื้อล่าสุด", "Last purchase", "最近购买")} value={recencyLabel(detail.stat.recencyDays, L)} sub={detail.stat.last ? fmtDate(detail.stat.last) : undefined} />
              <Rfm icon={<ShoppingBag size={16} />} label={L("จำนวนครั้ง", "Visits", "购买次数")} value={L(`${detail.stat.count} บิล`, `${detail.stat.count} bills`, `${detail.stat.count} 单`)} sub={detail.stat.first ? L(`ตั้งแต่ ${fmtDate(detail.stat.first)}`, `since ${fmtDate(detail.stat.first)}`, `自 ${fmtDate(detail.stat.first)}`) : undefined} />
              <Rfm icon={<TrendingUp size={16} />} label={L("ยอดซื้อรวม", "Total spend", "累计消费")} value={formatTHB(detail.stat.spend, false)} />
              <Rfm icon={<Wallet size={16} />} label={L("เฉลี่ย/บิล", "Avg / bill", "单均")} value={formatTHB(detail.stat.avg, false)} />
            </div>

            {/* แหล่งลงทะเบียน + ยอดซื้อแยกแบรนด์/สาขา */}
            {(detail.origin?.branch || (detail.byBrand?.length ?? 0) > 0 || (detail.byBranch?.length ?? 0) > 0) && (
              <div className="rounded-2xl border border-line bg-surface2/40 p-3.5 space-y-3">
                {detail.origin?.branch && (
                  <div className="text-xs text-muted">
                    <MapPin size={12} className="inline mb-0.5" /> {L("ลงทะเบียนครั้งแรกที่", "First registered at", "首次注册于")} <span className="text-ink font-medium">{detail.origin.branch}</span>
                  </div>
                )}
                {(detail.byBrand?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[11px] text-muted mb-1.5">{L("ยอดซื้อแยกแบรนด์", "Spend by brand", "按品牌消费")}</div>
                    <div className="space-y-1">
                      {detail.byBrand!.slice(0, 6).map((b) => (
                        <div key={b.name} className="flex items-center gap-2 text-xs">
                          <span className="px-1.5 py-0.5 rounded bg-surface2 text-ink border border-line">{b.name}</span>
                          <span className="ml-auto tnum font-semibold">{formatTHB(b.spend, false)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(detail.byBranch?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[11px] text-muted mb-1.5">{L("ยอดซื้อแยกสาขา", "Spend by branch", "按门店消费")}</div>
                    <div className="space-y-1">
                      {detail.byBranch!.slice(0, 6).map((b) => (
                        <div key={b.name} className="flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 text-muted"><MapPin size={11} />{b.name}</span>
                          <span className="ml-auto tnum font-semibold">{formatTHB(b.spend, false)} · {L(`${b.orders} บิล`, `${b.orders} bills`, `${b.orders} 单`)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ประวัติการซื้อ */}
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Clock size={15} /> {L("ประวัติการซื้อ", "Purchase history", "购买记录")} ({detail.orders.length})</h3>
              {detail.orders.length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">{L("ยังไม่มีบิล", "No bills yet", "暂无单据")}</p>
              ) : (
                <ul className="space-y-2">
                  {detail.orders.map((o) => (
                    <li key={o.id} className="rounded-xl border border-line overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-surface2/50 flex-wrap">
                        <span className="font-mono text-xs font-semibold">{o.order_no}</span>
                        {o.status === "voided" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-danger border border-line">{L("ยกเลิก", "Voided", "已作废")}</span>}
                        <span className="text-[11px] text-muted inline-flex items-center gap-1"><MapPin size={10} />{o.branch_name ?? branchName(o.branch_id)}</span>
                        {(o.brand_names ?? []).map((bn) => (
                          <span key={bn} className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-ink border border-line">{bn}</span>
                        ))}
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
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Star size={15} /> {L("ประวัติแต้ม & เครดิต", "Points & credit history", "积分和储值记录")} ({detail.ledger.length})</h3>
              {detail.ledger.length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">{L("ยังไม่มีการเคลื่อนไหว", "No movements yet", "暂无变动")}</p>
              ) : (
                <ul className="divide-y divide-line/60 rounded-xl border border-line overflow-hidden">
                  {detail.ledger.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{LEDGER_LABEL[l.kind] ? L(LEDGER_LABEL[l.kind].th, LEDGER_LABEL[l.kind].en, LEDGER_LABEL[l.kind].zh) : l.kind}</span>
                        {l.note && <span className="block text-[11px] text-muted truncate">{l.note}</span>}
                      </span>
                      <span className="text-right shrink-0">
                        {l.points_delta !== 0 && (
                          <span className={`block text-xs font-bold tnum ${l.points_delta > 0 ? "text-ink" : "text-muted"}`}>
                            {l.points_delta > 0 ? "+" : ""}{l.points_delta} {L("แต้ม", "pts", "积分")}
                          </span>
                        )}
                        {Number(l.credit_delta) !== 0 && (
                          <span className={`block text-xs font-bold tnum ${Number(l.credit_delta) > 0 ? "text-ink" : "text-muted"}`}>
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
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><CalendarClock size={15} /> {L("งานติดตาม", "Follow-up tasks", "跟进任务")}</h3>
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-[11px] text-muted">{L("รายละเอียดงาน", "Task detail", "任务详情")}</label>
                  <input
                    value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={L("เช่น โทรเช็คความพอใจ", "e.g. call to check satisfaction", "例如：致电回访满意度")}
                    onKeyDown={(e) => { if (e.key === "Enter") void addTask(); }}
                    className="mt-1 w-full h-9 px-3 rounded-xl bg-surface2/60 border border-line outline-none text-sm focus:border-brand/40"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="text-[11px] text-muted">{L("วันนัดหมาย", "Due date", "约定日期")}</label>
                    <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
                      className="mt-1 w-full h-9 px-2 rounded-xl bg-surface2/60 border border-line text-sm text-ink" />
                  </div>
                  <button onClick={() => void addTask()} disabled={!taskTitle.trim() || taskSaving}
                    className="self-end h-9 px-4 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 shrink-0 whitespace-nowrap inline-flex items-center gap-1.5">
                    {taskSaving ? <><Loader2 size={13} className="animate-spin" /> {L("กำลังเพิ่ม…", "Adding…", "添加中…")}</> : L("เพิ่มงาน", "Add task", "添加任务")}
                  </button>
                </div>
              </div>
              {detail.tasks.length === 0 ? (
                <p className="text-xs text-muted py-2">{L("ยังไม่มีงานติดตาม", "No follow-up tasks yet", "暂无跟进任务")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.tasks.map((tk) => {
                    const done = tk.status === "done";
                    const overdue = !done && !!tk.due_date && tk.due_date < new Date().toISOString().slice(0, 10);
                    return (
                      <li key={tk.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line">
                        {!done && (
                          <button onClick={() => void completeTask(tk.id)} title={L("ทำเสร็จ", "Mark done", "标记完成")}
                            className="w-5 h-5 rounded-full border-2 border-ink/30 hover:bg-surface2 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={`text-sm ${done ? "line-through text-muted" : "font-medium"}`}>{tk.title}</span>
                          <span className="block text-[11px] text-muted">
                            {TASK_KIND_LABEL[tk.kind] ? L(TASK_KIND_LABEL[tk.kind].th, TASK_KIND_LABEL[tk.kind].en, TASK_KIND_LABEL[tk.kind].zh) : tk.kind}
                            {tk.due_date && ` · ${fmtDate(tk.due_date)}`}
                            {tk.result && ` · ${L("ผล", "Result", "结果")}: ${tk.result}`}
                          </span>
                        </span>
                        {overdue && <span className="text-[10px] font-bold text-danger">{L("เกินกำหนด", "Overdue", "逾期")}</span>}
                        {done && <span className="text-[10px] font-bold text-muted">{L("เสร็จ", "Done", "完成")}</span>}
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
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck size={15} /> {L("การยินยอมติดต่อ (PDPA)", "Contact consent (PDPA)", "联系同意（PDPA）")}</h3>
                  <div className="p-3.5 rounded-2xl border border-line bg-surface2/40 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={cOn} onChange={(e) => toggle(e.target.checked, cCh)} className="w-4 h-4 accent-current" />
                      <span className="text-sm font-medium">{L("ยินยอมรับข่าวสาร/โปรโมชัน", "Consent to receive news / promotions", "同意接收资讯 / 促销")}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {CONSENT_CHANNELS.map((ch) => {
                        const on = cCh.includes(ch.v);
                        return (
                          <button key={ch.v} disabled={!cOn}
                            onClick={() => toggle(cOn, on ? cCh.filter((x) => x !== ch.v) : [...cCh, ch.v])}
                            className={`px-3 h-8 rounded-full text-xs font-semibold transition-colors disabled:opacity-40 ${on ? "bg-brand text-brandInk" : "bg-surface border border-line text-muted"}`}>
                            {L(ch.th, ch.en, ch.zh)}
                          </button>
                        );
                      })}
                    </div>
                    {detail.customer.consent_at && (
                      <p className="text-[11px] text-muted">{L("อัปเดตล่าสุด", "Last updated", "最后更新")} {fmtDate(String(detail.customer.consent_at))}</p>
                    )}
                    {consentDraft && (
                      <div className="flex gap-2">
                        <button onClick={() => setConsentDraft(null)} className="flex-1 h-9 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
                        <button onClick={() => void saveConsent()} disabled={consentSaving}
                          className="flex-1 h-9 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                          {consentSaving ? <Loader2 size={14} className="animate-spin" /> : null} {L("บันทึก", "Save", "保存")}
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

      {/* สร้างลูกค้าใหม่ */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={L("สร้างลูกค้าใหม่", "New customer", "新建客户")} size="sm"
        footer={
          <>
            <button onClick={() => setCreateOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button onClick={() => void submitCreate()} disabled={creating || !createForm.name.trim()}
              className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {creating ? <Loader2 size={15} className="animate-spin" /> : null} {L("บันทึก", "Save", "保存")}
            </button>
          </>
        }
      >
        <div className="space-y-2.5">
          <input autoFocus value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder={L("ชื่อลูกค้า *", "Customer name *", "客户姓名 *")}
            className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40" />
          <input value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} placeholder={L("เบอร์โทร", "Phone", "电话")} inputMode="tel"
            className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40" />
          <input value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} placeholder={L("อีเมล (ไม่บังคับ)", "Email (optional)", "邮箱（选填）")} inputMode="email"
            className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40" />
          <input value={createForm.tax_id} onChange={(e) => setCreateForm({ ...createForm, tax_id: e.target.value })} placeholder={L("เลขผู้เสียภาษี (ไม่บังคับ)", "Tax ID (optional)", "纳税人识别号（选填）")} inputMode="numeric"
            className="w-full h-10 px-3 rounded-xl bg-surface border border-line outline-none text-sm focus:border-brand/40" />
        </div>
      </Modal>

      {/* รวมลูกค้าซ้ำ */}
      <Modal open={dupeOpen} onClose={() => setDupeOpen(false)} title={L("ตรวจ & รวมลูกค้าซ้ำ", "Check & merge duplicates", "检查并合并重复客户")} size="lg">
        {dupeLoading ? (
          <div className="py-16 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังตรวจหาเบอร์โทรซ้ำ…", "Checking for duplicate phones…", "正在检查重复电话…")}</div>
        ) : dupeGroups.length === 0 ? (
          <EmptyState icon={<Combine size={26} />} title={L("ไม่พบลูกค้าซ้ำ", "No duplicate customers", "未发现重复客户")} body={L("ไม่มีเบอร์โทรที่ซ้ำกันในระบบ", "No duplicate phone numbers in the system", "系统中没有重复的电话号码")} />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {L(
                `พบ ${dupeGroups.length} กลุ่มที่มีเบอร์โทรเดียวกัน — เลือกคนที่จะเก็บไว้ (หลัก) แล้วกดรวม ระบบจะย้ายบิล แต้ม เครดิต มารวมที่คนนั้น`,
                `Found ${dupeGroups.length} groups sharing a phone number — pick the record to keep (primary), then merge. Bills, points and credit move onto that person.`,
                `发现 ${dupeGroups.length} 组共用同一电话号码 — 选择要保留的记录（主记录）后合并。单据、积分和储值将归并到该客户。`
              )}
            </p>
            {dupeGroups.map((g) => {
              const primary = primaryChoice[g.phone];
              const isMerging = merging === g.phone;
              return (
                <div key={g.phone} className="rounded-2xl border border-line overflow-hidden">
                  <div className="px-3 py-2 bg-surface2/50 flex items-center gap-2 text-xs">
                    <Phone size={12} /> <span className="font-mono font-semibold">{g.phone}</span>
                    <span className="text-muted">· {L(`${g.members.length} รายการ`, `${g.members.length} records`, `${g.members.length} 条`)}</span>
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
                            {primary === m.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand text-brandInk">{L("เก็บไว้", "Keep", "保留")}</span>}
                          </span>
                          <span className="flex items-center gap-3 text-[11px] text-muted mt-0.5">
                            <span className="inline-flex items-center gap-1"><ShoppingBag size={10} />{L(`${m.orders} บิล`, `${m.orders} bills`, `${m.orders} 单`)}</span>
                            {!!m.points && <span className="inline-flex items-center gap-1"><Star size={10} />{m.points}</span>}
                            {!!m.store_credit && <span className="inline-flex items-center gap-1"><Wallet size={10} />{formatTHB(m.store_credit, false)}</span>}
                            {m.email && <span className="truncate">{m.email}</span>}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-t border-line">
                    <span className="text-[11px] text-muted">{L(`รวมอีก ${g.members.length - 1} รายเข้าคนที่เลือก`, `Merge ${g.members.length - 1} more into the selected record`, `将另外 ${g.members.length - 1} 条合并至所选记录`)}</span>
                    <button
                      onClick={() => void doMerge(g)} disabled={isMerging || !primary}
                      className="h-9 px-4 rounded-xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isMerging ? <Loader2 size={15} className="animate-spin" /> : <Combine size={15} />} {L("รวมเป็นคนเดียว", "Merge into one", "合并为一人")}
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

function Kpi({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="px-3.5 py-2 rounded-2xl border border-line bg-surface min-w-[96px]">
      <div className="text-[11px] text-muted flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-bold leading-tight text-ink">{value}</div>
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
