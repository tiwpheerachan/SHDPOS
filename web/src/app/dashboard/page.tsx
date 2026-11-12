"use client";

// หน้าแดชบอร์ดเดี่ยว (standalone) สำหรับลิงก์แชร์ — เหมือนเว็บหนึ่งหน้า
//   เปิดลิงก์ `#d=<spec>` → ถ้ายังไม่ล็อกอิน กดเข้าสู่ระบบได้ (กลับมาหน้าเดิมอัตโนมัติ)
//   แสดงเฉพาะแดชบอร์ด (ไม่มีแชต/เมนูแอดมิน) · ตัวเลขคำนวณในเครื่องตามสิทธิ์ผู้เปิด
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wand2, Download, Sun, Moon, LogIn, LayoutDashboard, PencilRuler } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { listOrders, listEmployees } from "@/lib/data/repo";
import type { Order, Employee } from "@/lib/types";
import { Badge, EmptyState, KpiTile } from "@/components/ui";
import { FilterBar, useAdminScope, useDefaultFilter } from "@/components/admin/filters";
import { filterOrders } from "@/lib/analytics";
import { visibleBranchIds, can } from "@/lib/permissions";
import { Sparkline } from "@/components/charts";
import { WidgetBody, fmtMetric } from "@/components/admin/widget-body";
import { computeWidget, METRIC_LABEL, type View, type WidgetData, type Ctx, type Metric } from "@/lib/ai/engine";
import { buildFactPack } from "@/lib/ai/facts";
import { dashboardFromHash, encodeDashboard } from "@/lib/ai/share";
import { exportExcel } from "@/lib/ai/export-excel";

export default function SharedDashboardPage() {
  const { locale, setLocale } = useI18n();
  const { resolved, setMode } = useTheme();
  const { employee } = useSession();
  const router = useRouter();
  const { branches, brands } = useAdminScope();
  const [filter, setFilter] = useDefaultFilter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [ready, setReady] = useState(false);
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  // อ่านสเปกจาก hash (รองรับเปลี่ยน hash โดยไม่รีโหลด)
  useEffect(() => {
    const read = () => setView(dashboardFromHash(typeof window !== "undefined" ? window.location.hash : ""));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!employee) { setReady(true); return; }
    void listOrders().then(setOrders);
    void listEmployees().then(setEmployees);
    setReady(true);
  }, [employee]);

  const scoped = useMemo(() => {
    const ids = visibleBranchIds(employee, branches.map((b) => b.id));
    return orders.filter((o) => ids.includes(o.branch_id));
  }, [orders, employee, branches]);
  const ctx: Ctx = useMemo(() => ({ branches, employees, brands: brands.map((b) => ({ id: b.id, name: b.name })) }), [branches, employees, brands]);
  const rows = useMemo(() => filterOrders(scoped, { ...filter, branches }), [scoped, filter, branches]);
  const facts = useMemo(() => buildFactPack(scoped, ctx, { from: filter.from, to: filter.to }, locale), [scoped, ctx, filter.from, filter.to, locale]);
  const prevRows = useMemo(() => {
    const pf = new Date(facts.prevPeriod.from).getTime(), pt = new Date(facts.prevPeriod.to).getTime();
    return scoped.filter((o) => { const t = new Date(o.created_at).getTime(); return t >= pf && t <= pt; });
  }, [scoped, facts.prevPeriod.from, facts.prevPeriod.to]);
  const kpiDelta = (m: Metric): number | null => {
    const t = facts.totals;
    const map: Record<string, { deltaPct: number | null }> = { sales: t.sales, orders: t.orders, aov: t.aov, gp: t.gp, qty: t.units, discount: t.discount };
    return map[m]?.deltaPct ?? null;
  };

  const data = useMemo(() => {
    const m = new Map<string, WidgetData>();
    if (!view) return m;
    for (const w of view.widgets) {
      const wr = w.branchId ? rows.filter((o) => o.branch_id === w.branchId) : rows;
      const needPrev = w.compare || w.viz === "waterfall";
      const pw = needPrev ? (w.branchId ? prevRows.filter((o) => o.branch_id === w.branchId) : prevRows) : undefined;
      m.set(w.id, computeWidget(wr, ctx, w, locale, pw));
    }
    return m;
  }, [view, rows, prevRows, ctx, locale]);

  function goLogin() {
    try { sessionStorage.setItem("shdpos.returnTo", window.location.pathname + window.location.hash); } catch { /* ignore */ }
    router.push("/pos");
  }

  // ── สถานะต่าง ๆ ──
  if (!ready) return <Shell><div className="grid place-items-center min-h-[60vh] text-muted">…</div></Shell>;
  if (!view) return <Shell><Centered><EmptyState icon={<LayoutDashboard size={28} />} title={L("ไม่พบแดชบอร์ดในลิงก์นี้", "No dashboard in this link", "链接中无仪表盘")} body={L("ลิงก์อาจไม่สมบูรณ์", "The link may be incomplete", "链接可能不完整")} /></Centered></Shell>;

  // ยังไม่ล็อกอิน → การ์ดเข้าสู่ระบบ (กดเข้าระบบแล้วกลับมาหน้านี้)
  if (!employee) {
    return (
      <Shell>
        <Centered>
          <div className="card max-w-sm w-full p-7 text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand/12 text-brand grid place-items-center mx-auto mb-3"><Wand2 size={22} /></div>
            <p className="font-semibold text-lg">{view.name}</p>
            <p className="text-sm text-muted mt-1.5">{L("เข้าสู่ระบบเพื่อดูแดชบอร์ดที่แชร์ · ตัวเลขจะคำนวณตามสิทธิ์ของคุณ", "Sign in to view this shared dashboard · figures use your own access", "登录以查看分享的仪表盘 · 按您的权限计算")}</p>
            <button onClick={goLogin} className="mt-5 w-full h-11 rounded-xl bg-brand text-white font-medium inline-flex items-center justify-center gap-2 hover:bg-brandHover"><LogIn size={17} />{L("เข้าสู่ระบบ", "Sign in", "登录")}</button>
          </div>
        </Centered>
      </Shell>
    );
  }

  // ล็อกอินแล้วแต่ไม่มีสิทธิ์รายงาน
  if (!can(employee, "report.employee_perf")) {
    return <Shell><Centered><EmptyState icon={<Wand2 size={26} />} title={L("บัญชีของคุณยังไม่มีสิทธิ์ดูรายงาน", "Your account has no report access", "您的账号无报表权限")} body={L("ติดต่อผู้ดูแลเพื่อขอสิทธิ์", "Ask an admin to grant access", "请联系管理员")} /></Centered></Shell>;
  }

  const kpis = view.widgets.filter((w) => w.viz === "kpi");
  const charts = view.widgets.filter((w) => w.viz !== "kpi");
  const editUrl = `/admin/insights#d=${encodeDashboard(view.name, view.widgets)}`;

  return (
    <Shell>
      {/* แถบบน */}
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 sm:px-6 h-14 border-b border-line bg-surface/80 backdrop-blur-md">
        <span className="w-8 h-8 rounded-xl bg-brand/12 text-brand grid place-items-center shrink-0"><Wand2 size={17} /></span>
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate leading-tight">{view.name}</p>
          <p className="text-[10.5px] text-muted leading-tight">SHD POS · {L("แดชบอร์ดที่แชร์", "Shared dashboard", "分享仪表盘")}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => { exportExcel(view, data, locale); }} title="Excel" className="h-9 px-2.5 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand inline-flex items-center gap-1.5"><Download size={14} /><span className="hidden sm:inline">Excel</span></button>
          <Link href={editUrl} title={L("เปิดแก้ใน AI", "Open in AI", "在 AI 中打开")} className="h-9 px-2.5 rounded-xl border border-line text-sm hover:bg-surface2 hover:text-brand inline-flex items-center gap-1.5"><PencilRuler size={14} /><span className="hidden md:inline">{L("เปิดใน AI", "Open in AI", "AI")}</span></Link>
          <button onClick={() => setLocale(locale === "th" ? "en" : locale === "en" ? "zh" : "th")} className="h-9 w-9 rounded-xl border border-line grid place-items-center text-xs font-medium hover:bg-surface2 hover:text-brand">{locale.toUpperCase()}</button>
          <button onClick={() => setMode(resolved === "dark" ? "light" : "dark")} className="h-9 w-9 rounded-xl border border-line grid place-items-center hover:bg-surface2 hover:text-brand">{resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>

      <div className="p-4 sm:p-6 max-w-6xl mx-auto w-full" style={{ backgroundImage: "radial-gradient(rgb(var(--c-ink) / 0.05) 1px, transparent 1.3px)", backgroundSize: "22px 22px" }}>
        <div className="mb-4"><FilterBar value={filter} onChange={setFilter} branches={branches} brands={brands} /></div>

        <p className="text-[11px] text-muted mb-3">
          {L(
            `ขอบเขต ${facts.scope.branchesInScope} สาขา (มีขาย ${facts.scope.branchesWithSales}) · ล่าสุด ${facts.scope.latestOrder ? new Date(facts.scope.latestOrder).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—"} · เฉพาะข้อมูลที่ซิงก์ในเครื่อง`,
            `Scope ${facts.scope.branchesInScope} branches (${facts.scope.branchesWithSales} selling) · latest ${facts.scope.latestOrder ? new Date(facts.scope.latestOrder).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—"} · local synced data only`,
            `范围 ${facts.scope.branchesInScope} 门店 · 仅本地同步数据`,
          )}
        </p>

        {kpis.length ? (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            {kpis.map((w) => (
              <KpiTile key={w.id} label={w.title || METRIC_LABEL[w.metric][locale]} value={fmtMetric(w.metric, data.get(w.id)?.total ?? 0)} delta={kpiDelta(w.metric)} variant="ink"
                spark={(() => { const s = data.get(w.id)?.series; return s && s.length > 2 ? <Sparkline values={s} color="rgba(255,255,255,0.55)" height={28} /> : undefined; })()} />
            ))}
          </div>
        ) : null}

        {charts.length ? (
          <div className="grid xl:grid-cols-2 gap-4">
            {charts.map((w) => (
              <div key={w.id} className="card p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="font-semibold text-sm truncate">{w.title || METRIC_LABEL[w.metric][locale]}</p>
                  {w.compare ? <Badge tone="brand">{L("เทียบช่วงก่อน", "vs prev", "对比上期")}</Badge> : null}
                </div>
                <WidgetBody w={w} data={data.get(w.id)} locale={locale} L={L} />
              </div>
            ))}
          </div>
        ) : null}

        {!kpis.length && !charts.length ? <Centered><EmptyState title={L("แดชบอร์ดว่าง", "Empty dashboard", "空仪表盘")} /></Centered> : null}

        <p className="text-center text-[10.5px] text-muted mt-8 pb-6">SHD POS · {L("คำนวณในเครื่อง ไม่ส่งข้อมูลออกนอกระบบ", "Computed on-device, no data leaves the system", "本地计算，数据不外传")}</p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-bg text-ink">{children}</main>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center min-h-[72vh] px-4">{children}</div>;
}
