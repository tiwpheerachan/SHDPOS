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
  TrendingUp, Clock, Loader2, ChevronRight, MapPin,
} from "lucide-react";
import { listBranches } from "@/lib/data/repo";
import type { Branch } from "@/lib/types";
import { Drawer, EmptyState } from "@/components/ui";
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

interface OrderItemRow { sku: string; name: string; qty: number; unit_price: number; line_total: number }
interface OrderRow {
  id: string; order_no: string; created_at: string; branch_id: string;
  grand_total: number; status: string; channel: string; order_items: OrderItemRow[];
}
interface Detail {
  customer: Record<string, unknown> & { id: string; name: string; phone?: string | null; email?: string | null; points?: number; store_credit?: number; tax_id?: string | null; note?: string | null };
  stat: { count: number; spend: number; avg: number; last: string | null; first: string | null; recencyDays: number | null; segment: Segment };
  orders: OrderRow[];
}

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

  useEffect(() => { void listBranches().then(setBranches); }, []);
  const branchName = useCallback(
    (id: string) => branches.find((b) => b.id === id)?.name ?? "—",
    [branches]
  );

  // โหลดรายชื่อ (debounce ตามคำค้น)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/customers?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        if (alive) setRows(Array.isArray(json.customers) ? json.customers : []);
      } finally {
        if (alive) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(id); };
  }, [q]);

  // โหลดโปรไฟล์
  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    void fetch(`/api/admin/customers?id=${openId}`)
      .then((r) => r.json())
      .then((j) => { if (alive && !j.error) setDetail(j); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [openId]);

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

      {/* ค้นหา */}
      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อ เบอร์โทร อีเมล หรือรหัสสมาชิก…"
          className="w-full h-11 pl-11 pr-4 rounded-2xl bg-surface2/70 border border-line focus:border-brand/40 focus:bg-surface outline-none text-sm transition-colors"
        />
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
            {/* ติดต่อ + กระเป๋า */}
            <div className="flex flex-wrap gap-2 text-xs">
              {detail.customer.email ? <Pill icon={<Mail size={13} />}>{String(detail.customer.email)}</Pill> : null}
              {detail.customer.tax_id ? <Pill icon={<span className="font-bold">#</span>}>{String(detail.customer.tax_id)}</Pill> : null}
              <Pill icon={<Star size={13} className="text-amber-500" />}>{Number(detail.customer.points ?? 0)} แต้ม</Pill>
              <Pill icon={<Wallet size={13} className="text-emerald-500" />}>เครดิต {formatTHB(Number(detail.customer.store_credit ?? 0), false)}</Pill>
            </div>

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
          </div>
        )}
      </Drawer>
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
