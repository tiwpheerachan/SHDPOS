"use client";
// =====================================================================
// ลูกค้า → แท็บ "ภาพรวม" (แดชบอร์ด CRM)
//   คำนวณจากรายชื่อลูกค้าที่หน้าโหลดมาแล้ว (/api/admin/customers — ตามแบรนด์/สาขาที่เลือกบนแถบบน)
//   + สรุปงานติดตามจาก /api/admin/tasks · คลิกส่วนต่าง ๆ = ไปแท็บรายชื่อพร้อมตัวกรอง / เปิดโปรไฟล์
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Users, Repeat, Wallet, Star, AlertTriangle, CalendarClock, ArrowUpRight, Crown, TrendingUp } from "lucide-react";
import { Avatar } from "@/components/ui";
import { formatTHB, formatCompact } from "@/lib/money";

export type CustSegment = "new" | "returning" | "vip" | "lost";
export interface CustRow {
  id: string; name: string; phone: string | null; member_code: string | null;
  points: number; store_credit: number; tier: string | null;
  orders: number; spend: number; last: string | null; recencyDays: number | null; segment: CustSegment;
}
type L3 = (th: string, en: string, zh: string) => string;

const SEG_META: Record<CustSegment, { th: string; en: string; zh: string; color: string }> = {
  new: { th: "ลูกค้าใหม่", en: "New", zh: "新客户", color: "#22B8A7" },
  returning: { th: "ซื้อซ้ำ", en: "Returning", zh: "回头客", color: "#3B82F6" },
  vip: { th: "VIP", en: "VIP", zh: "VIP", color: "rgb(var(--c-brand))" },
  lost: { th: "หายไป", en: "Lost", zh: "流失", color: "#94A3B8" },
};

export function CustomerDashboard({
  rows, loading, L, onSegment, onOpen, onFollowups,
}: {
  rows: CustRow[];
  loading: boolean;
  L: L3;
  onSegment: (s: CustSegment | "all") => void;
  onOpen: (id: string) => void;
  onFollowups: () => void;
}) {
  const [tasks, setTasks] = useState<{ open: number; overdue: number; today: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/tasks?status=open").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!alive || !j) return;
      const t = (j.tasks ?? []) as { status: string; due_date: string | null }[];
      const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
      setTasks({ open: t.length, overdue: t.filter((x) => x.due_date && x.due_date < today).length, today: t.filter((x) => x.due_date === today).length });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const d = useMemo(() => {
    const buyers = rows.filter((r) => r.orders > 0);
    const repeat = buyers.filter((r) => r.orders >= 2);
    const spend = buyers.reduce((s, r) => s + r.spend, 0);
    const seg = (Object.keys(SEG_META) as CustSegment[]).map((k) => ({ k, n: rows.filter((r) => r.segment === k).length }));
    const recency = [
      { label: L("≤ 30 วัน", "≤ 30 d", "≤30天"), test: (x: number) => x <= 30 },
      { label: L("31–90 วัน", "31–90 d", "31–90天"), test: (x: number) => x > 30 && x <= 90 },
      { label: L("91–180 วัน", "91–180 d", "91–180天"), test: (x: number) => x > 90 && x <= 180 },
      { label: L("181–365 วัน", "181–365 d", "181–365天"), test: (x: number) => x > 180 && x <= 365 },
      { label: L("เกิน 1 ปี", "> 1 yr", ">1年"), test: (x: number) => x > 365 },
    ].map((b) => ({ label: b.label, n: buyers.filter((r) => r.recencyDays !== null && b.test(r.recencyDays)).length }));
    recency.push({ label: L("ยังไม่เคยซื้อ", "Never", "未购买"), n: rows.length - buyers.length });
    const spendBands = [
      { label: "< ฿1k", test: (x: number) => x < 1000 },
      { label: "฿1k–5k", test: (x: number) => x >= 1000 && x < 5000 },
      { label: "฿5k–20k", test: (x: number) => x >= 5000 && x < 20000 },
      { label: "฿20k–50k", test: (x: number) => x >= 20000 && x < 50000 },
      { label: "฿50k+", test: (x: number) => x >= 50000 },
    ].map((b) => ({ label: b.label, n: buyers.filter((r) => b.test(r.spend)).length, sum: buyers.filter((r) => b.test(r.spend)).reduce((s, r) => s + r.spend, 0) }));
    const top = [...buyers].sort((a, b) => b.spend - a.spend).slice(0, 8);
    // เสี่ยงหาย: เคยซื้อซ้ำ/VIP แต่ไม่กลับมา 60–180 วัน
    const atRisk = buyers.filter((r) => (r.segment === "vip" || r.orders >= 2) && r.recencyDays !== null && r.recencyDays >= 60 && r.recencyDays <= 180)
      .sort((a, b) => b.spend - a.spend).slice(0, 6);
    const top20 = [...buyers].sort((a, b) => b.spend - a.spend).slice(0, Math.max(1, Math.ceil(buyers.length * 0.2)));
    const top20Share = spend ? top20.reduce((s, r) => s + r.spend, 0) / spend : 0;
    return {
      total: rows.length, buyers: buyers.length, repeatRate: buyers.length ? repeat.length / buyers.length : 0,
      avgSpend: buyers.length ? spend / buyers.length : 0, avgOrders: buyers.length ? buyers.reduce((s, r) => s + r.orders, 0) / buyers.length : 0,
      points: rows.reduce((s, r) => s + r.points, 0), credit: rows.reduce((s, r) => s + r.store_credit, 0),
      seg, recency, spendBands, top, atRisk, top20Share, spend,
    };
  }, [rows, L]);

  if (loading) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 rounded-[22px] bg-surface2/60 animate-pulse" />)}</div>;

  const maxRec = Math.max(1, ...d.recency.map((b) => b.n));
  const maxBand = Math.max(1, ...d.spendBands.map((b) => b.n));
  const segTotal = Math.max(1, d.seg.reduce((s, x) => s + x.n, 0));

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi hero icon={<Users size={14} />} label={L("ลูกค้าทั้งหมด", "Customers", "客户总数")} value={d.total.toLocaleString("th-TH")} hint={L(`ซื้อแล้ว ${d.buyers.toLocaleString("th-TH")} คน`, `${d.buyers} purchased`, `已购 ${d.buyers}`)} />
        <Kpi icon={<Repeat size={14} />} label={L("อัตราซื้อซ้ำ", "Repeat rate", "复购率")} value={`${(d.repeatRate * 100).toFixed(1)}%`} hint={L(`เฉลี่ย ${d.avgOrders.toFixed(1)} บิล/คน`, `${d.avgOrders.toFixed(1)} bills/customer`, `人均 ${d.avgOrders.toFixed(1)} 单`)} />
        <Kpi icon={<TrendingUp size={14} />} label={L("ยอดซื้อเฉลี่ย/คน", "Avg spend / customer", "人均消费")} value={formatTHB(d.avgSpend)} hint={L(`ลูกค้า 20% แรกสร้างยอด ${(d.top20Share * 100).toFixed(0)}%`, `Top 20% = ${(d.top20Share * 100).toFixed(0)}% of spend`, `前20%贡献 ${(d.top20Share * 100).toFixed(0)}%`)} />
        <Kpi icon={<Wallet size={14} />} label={L("แต้ม / เครดิตคงค้าง", "Points / credit owed", "积分/储值余额")} value={formatCompact(d.points)} hint={L(`เครดิต ${formatTHB(d.credit)}`, `Credit ${formatTHB(d.credit)}`, `储值 ${formatTHB(d.credit)}`)} />
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        {/* กลุ่มลูกค้า */}
        <Card title={L("กลุ่มลูกค้า", "Segments", "客户分组")} hint={L("คลิกเพื่อดูรายชื่อ", "Click to view list", "点击查看")}>
          <div className="flex h-3 rounded-full overflow-hidden bg-surface2 mb-4">
            {d.seg.map((s) => s.n ? <div key={s.k} style={{ width: `${(s.n / segTotal) * 100}%`, background: SEG_META[s.k].color }} /> : null)}
          </div>
          <div className="space-y-1">
            {d.seg.map((s) => (
              <button key={s.k} onClick={() => onSegment(s.k)} className="w-full flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-surface2/60 text-left">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SEG_META[s.k].color }} />
                <span className="text-sm flex-1">{L(SEG_META[s.k].th, SEG_META[s.k].en, SEG_META[s.k].zh)}</span>
                <span className="text-sm font-semibold tnum">{s.n.toLocaleString("th-TH")}</span>
                <span className="text-[11px] text-muted tnum w-11 text-right">{((s.n / segTotal) * 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        </Card>

        {/* ซื้อล่าสุดเมื่อไร */}
        <Card title={L("ซื้อล่าสุดเมื่อไร", "Last purchase", "最近购买")} hint={L("จำนวนลูกค้าตามช่วงเวลา", "Customers by recency", "按时间")}>
          <div className="space-y-2.5">
            {d.recency.map((b, i) => (
              <div key={b.label} className="grid grid-cols-[88px_1fr_40px] items-center gap-2 text-xs">
                <span className="text-muted">{b.label}</span>
                <div className="h-2 rounded-full bg-surface2 overflow-hidden"><div className={`h-full rounded-full ${i >= 3 ? "bg-muted/40" : "bg-brand/70"}`} style={{ width: `${(b.n / maxRec) * 100}%` }} /></div>
                <span className="tnum text-right">{b.n}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ระดับยอดซื้อ */}
        <Card title={L("ระดับยอดซื้อสะสม", "Lifetime spend bands", "累计消费分布")} hint={L("ลูกค้าที่ซื้อแล้ว", "Purchasing customers", "已购客户")}>
          <div className="flex items-end gap-2 h-32">
            {d.spendBands.map((b) => (
              <div key={b.label} className="flex-1 h-full flex flex-col justify-end items-center gap-1" title={`${b.label} · ${b.n} คน · ${formatTHB(b.sum)}`}>
                <span className="text-[10px] tnum text-muted">{b.n}</span>
                <span className="w-full rounded-t-lg bg-brand/75" style={{ height: `${b.n ? Math.max(4, (b.n / maxBand) * 100) : 2}%` }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-1.5">{d.spendBands.map((b) => <span key={b.label} className="flex-1 text-center text-[9px] text-muted">{b.label}</span>)}</div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
        {/* ลูกค้าคนสำคัญ */}
        <Card title={L("ลูกค้ายอดซื้อสูงสุด", "Top customers", "高价值客户")} icon={<Crown size={14} />}>
          {d.top.length ? (
            <ol className="divide-y divide-line/60">
              {d.top.map((r, i) => (
                <li key={r.id}>
                  <button onClick={() => onOpen(r.id)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-surface2/40 rounded-lg px-1">
                    <span className="text-[11px] text-muted tnum w-5">{String(i + 1).padStart(2, "0")}</span>
                    <Avatar name={r.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <p className="text-[11px] text-muted">{r.orders} {L("บิล", "bills", "单")} · {r.recencyDays === null ? "—" : L(`ซื้อล่าสุด ${r.recencyDays} วันก่อน`, `${r.recencyDays} d ago`, `${r.recencyDays}天前`)}</p>
                    </div>
                    <span className="text-sm font-semibold tnum">{formatTHB(r.spend)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <Empty L={L} />}
        </Card>

        <div className="space-y-4">
          {/* งานติดตาม */}
          <button onClick={onFollowups} className="w-full text-left rounded-[22px] bg-brand text-brandInk p-5 group">
            <div className="flex items-center justify-between">
              <p className="text-[11px] opacity-70 flex items-center gap-1.5"><CalendarClock size={13} />{L("งานติดตามลูกค้า", "Follow-ups", "客户跟进")}</p>
              <ArrowUpRight size={15} className="opacity-70 group-hover:translate-x-0.5 transition" />
            </div>
            <p className="text-3xl font-semibold tnum mt-2">{tasks ? tasks.open : "—"}</p>
            <p className="text-[11px] opacity-70 mt-1">
              {L("ค้างอยู่", "open", "待办")}{tasks ? ` · ${L("วันนี้", "today", "今天")} ${tasks.today}` : ""}
              {tasks?.overdue ? <span className="text-red-200"> · {L("เกินกำหนด", "overdue", "逾期")} {tasks.overdue}</span> : null}
            </p>
          </button>

          {/* เสี่ยงหาย */}
          <Card title={L("ลูกค้าเสี่ยงหาย", "At-risk customers", "流失风险")} icon={<AlertTriangle size={14} className="text-warn" />} hint={L("เคยซื้อซ้ำ/VIP แต่ไม่กลับมา 60–180 วัน", "Repeat/VIP, inactive 60–180 days", "60–180天未回购")}>
            {d.atRisk.length ? (
              <ul className="space-y-1">
                {d.atRisk.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => onOpen(r.id)} className="w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface2/60 text-left">
                      <Avatar name={r.name} size={24} />
                      <span className="text-xs font-medium flex-1 truncate">{r.name}</span>
                      <span className="text-[11px] text-warn tnum">{r.recencyDays} {L("วัน", "d", "天")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted py-3">{L("ยังไม่มีลูกค้าในกลุ่มนี้", "None right now", "暂无")}</p>}
          </Card>

          <div className="rounded-[22px] border border-line/70 bg-surface p-4 flex items-center gap-3">
            <Star size={16} className="text-muted" />
            <p className="text-xs text-muted flex-1">{L("ยอดซื้อรวมของลูกค้าในมุมมองนี้", "Total spend in view", "当前视图总消费")}</p>
            <p className="text-sm font-semibold tnum">{formatTHB(d.spend)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint, hero }: { icon: React.ReactNode; label: string; value: string; hint: string; hero?: boolean }) {
  return (
    <div className={`p-4 sm:p-5 rounded-[22px] ${hero ? "bg-brand text-brandInk shadow-sm" : "bg-surface border border-line/70"}`}>
      <div className="flex items-center justify-between"><p className={`text-[11px] ${hero ? "opacity-70" : "text-muted"}`}>{label}</p><span className={hero ? "opacity-70" : "text-muted"}>{icon}</span></div>
      <p className="text-2xl sm:text-[26px] font-semibold tracking-tight mt-2 tnum">{value}</p>
      <p className={`text-[10px] mt-1.5 ${hero ? "opacity-60" : "text-muted"}`}>{hint}</p>
    </div>
  );
}
function Card({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] border border-line/70 bg-surface p-4 sm:p-5 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">{icon}{title}</h3>
        {hint ? <span className="text-[10px] text-muted text-right">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}
function Empty({ L }: { L: L3 }) {
  return <p className="text-xs text-muted text-center py-8">{L("ยังไม่มีข้อมูลการซื้อ", "No purchase data yet", "暂无购买数据")}</p>;
}
