"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import {
  LayoutDashboard, TrendingUp, Users, Package, Boxes, ArrowLeftRight, ScanLine,
  ShieldCheck, ScrollText, Settings2, Store, Sun, Moon, Languages, Menu, X, Bell,
  Search, PanelLeftClose, PanelLeftOpen, ChevronDown, Command, Home, Activity, FileText, LogOut, Contact, CalendarClock, Ticket, Network, Landmark, Wand2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { ROLE_LABEL, can, visibleBranchIds, type PermissionKey } from "@/lib/permissions";
import { listAllTransfers, listBranches } from "@/lib/data/repo";
import type { Transfer } from "@/lib/types";
import { Avatar, LiveDot } from "@/components/ui";
import { Clock } from "@/components/clock";
import { ScopeTopbar } from "@/components/admin/scope-topbar";
import { WorkspaceTabs } from "@/components/admin/workspace-tabs";
import { BrandReveal } from "@/components/brand-reveal";

type NavItem = { href: string; icon: typeof LayoutDashboard; key: string; perm?: PermissionKey };
type NavGroup = { section: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    section: "overview",
    items: [
      { href: "/admin", icon: LayoutDashboard, key: "dashboard" },
      { href: "/admin/insights", icon: Wand2, key: "insights", perm: "report.employee_perf" },
      { href: "/admin/finance", icon: Landmark, key: "finance", perm: "finance.view" },
    ],
  },
  {
    section: "sales",
    items: [
      { href: "/admin/sales", icon: TrendingUp, key: "sales" },
      { href: "/admin/customers", icon: Contact, key: "customers" },
      { href: "/admin/tasks", icon: CalendarClock, key: "tasks" },
      { href: "/admin/campaigns", icon: Ticket, key: "campaigns" },
      { href: "/admin/employees", icon: Users, key: "employees", perm: "report.employee_perf" },
      { href: "/admin/org", icon: Network, key: "org", perm: "admin.employee_manage" },
    ],
  },
  {
    section: "operations",
    items: [
      { href: "/admin/stores", icon: Store, key: "stores", perm: "admin.employee_manage" },
      { href: "/admin/inventory", icon: Boxes, key: "inventory", perm: "inventory.view" },
      { href: "/admin/movement", icon: Activity, key: "movement" },
      { href: "/admin/transfers", icon: ArrowLeftRight, key: "transfers", perm: "transfer.request" },
      { href: "/admin/serials", icon: ScanLine, key: "serials", perm: "inventory.view" },
      { href: "/admin/products", icon: Package, key: "products" },
    ],
  },
  {
    section: "documents",
    items: [
      { href: "/admin/documents", icon: FileText, key: "documents" },
    ],
  },
  {
    section: "control",
    items: [
      { href: "/admin/approvals", icon: ShieldCheck, key: "approvals" },
      { href: "/admin/permissions", icon: Users, key: "permissions", perm: "admin.employee_manage" },
      { href: "/admin/audit", icon: ScrollText, key: "audit", perm: "audit.view" },
    ],
  },
];

const COLLAPSE_KEY = "shdpos.nav.collapsed";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { mode, setMode } = useTheme();
  const pathname = usePathname();
  const { employee, logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // ── การแจ้งเตือนจริง (จากข้อมูลใบโอน): รอฉันทำ / เกินเวลา / ผลต่างรอปิด ──
  type Notif = { id: string; title: string; sub: string; href: string; at: string; tone: "brand" | "warn" | "danger"; mine: boolean };
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!employee) { setNotifs([]); return; }
    void (async () => {
      try {
        const [trs, brs] = await Promise.all([listAllTransfers(), listBranches()]);
        const allowed = visibleBranchIds(employee, brs.map((b) => b.id));
        const bn = (id: string) => { const b = brs.find((x) => x.id === id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id; };
        const cApprove = can(employee, "transfer.approve");
        const cOut = can(employee, "transfer.request") || cApprove;
        const cRecv = can(employee, "transfer.receive") || cApprove;
        const SLA: Record<string, number> = { pending_approval: 24, approved: 48, picking: 48, packed: 48, shipped: 72, in_transit: 72, partial_received: 72 };
        const out: Notif[] = [];
        for (const tr of trs) {
          const src = allowed.includes(tr.from_branch_id), dst = allowed.includes(tr.to_branch_id);
          if (!src && !dst) continue;
          const mine = tr.status === "pending_approval" ? (src && cApprove) : ["approved", "picking", "packed"].includes(tr.status) ? (src && cOut) : ["in_transit", "partial_received"].includes(tr.status) ? (dst && cRecv) : false;
          const limitH = SLA[tr.status]; const over = limitH !== undefined && (Date.now() - new Date(tr.created_at).getTime()) / 3600000 > limitH;
          const route = `${bn(tr.from_branch_id)} → ${bn(tr.to_branch_id)}`;
          const href = `/admin/transfers?doc=${tr.transfer_no}`;
          if (mine) {
            const act = tr.status === "pending_approval" ? L("รออนุมัติ", "Needs approval", "待审批") : ["approved", "picking"].includes(tr.status) ? L("รอสแกนออก", "Scan out", "待扫出") : tr.status === "packed" ? L("รอจัดส่ง", "Dispatch", "待发货") : L("รอรับเข้า", "Receive", "待入库");
            out.push({ id: tr.id + ":act", title: `${act} · ${tr.transfer_no}`, sub: route, href, at: tr.created_at, tone: over ? "danger" : "brand", mine: true });
          } else if (over) {
            out.push({ id: tr.id + ":sla", title: `${L("ค้างเกินเวลา", "Overdue", "逾期")} · ${tr.transfer_no}`, sub: route, href, at: tr.created_at, tone: "danger", mine: false });
          }
          if (cApprove) for (const dc of tr.discrepancies ?? []) if (dc.status === "open") out.push({ id: dc.id, title: `${L("ผลต่างรอปิด", "Discrepancy open", "差异待关")} · ${tr.transfer_no}`, sub: route, href, at: dc.at, tone: "warn", mine: false });
        }
        out.sort((a, b) => (a.at < b.at ? 1 : -1));
        if (!cancelled) setNotifs(out);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [employee, pathname, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setNotifOpen(false), [pathname]);
  const mineCount = notifs.filter((n) => n.mine).length;
  const queueCount = notifs.length;
  const badges: Record<string, number> = { transfers: mineCount };
  const timeAgo = (iso: string) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${Math.max(1, m)} ${L("นาที", "m", "分")}`;
    const h = Math.floor(m / 60); if (h < 24) return `${h} ${L("ชม.", "h", "时")}`;
    return `${Math.floor(h / 24)} ${L("วัน", "d", "天")}`;
  };

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const label: Record<string, string> = {
    dashboard: t.admin.dashboard, sales: t.admin.sales, employees: t.admin.employees,
    inventory: t.admin.inventory, transfers: t.admin.transfers, products: t.admin.products,
    approvals: t.admin.approvals, users: t.admin.users, audit: t.admin.audit, settings: t.admin.settings,
    movement: t.cmd.stockMovement, documents: t.cmd.documentCenter,
    serials: L("ตามรอย SN", "Serial tracking", "序列追踪"),
    permissions: L("ผู้ใช้", "Users", "用户"),
    customers: L("ลูกค้า", "Customers", "客户"),
    stores: L("ร้าน", "Stores", "店铺"),
    tasks: L("ติดตามลูกค้า", "Follow-ups", "跟进任务"),
    campaigns: L("แคมเปญ", "Campaigns", "活动"),
    org: L("ผังองค์กร", "Org chart", "组织架构"),
    finance: L("การเงิน", "Finance", "财务"),
    insights: L("ผู้ช่วย AI", "AI assistant", "AI 助手"),
  };
  const sectionLabel: Record<string, string> = {
    overview: t.cmd.secOverview, sales: t.cmd.secSales, operations: t.cmd.secOps,
    documents: t.cmd.secDocuments, control: t.cmd.secControl,
  };

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => !n.perm || !employee || can(employee, n.perm)),
  })).filter((g) => g.items.length);

  const currentItem = groups.flatMap((g) => g.items).find((n) => n.href === pathname);
  const currentKey = currentItem?.key ?? "dashboard";
  const currentSection = groups.find((g) => g.items.some((i) => i.href === pathname))?.section ?? "overview";

  const railW = collapsed ? "lg:w-[74px]" : "lg:w-64";

  return (
    <div className="min-h-screen flex bg-bg">
      {/* กรอบแก้ว (liquid glass) สำหรับเมนูที่เลือก — โทนเดียวกับ navbar ของ POS */}
      <style>{`
        .shd-nav-glass{
          background:rgb(var(--c-violet) / .2);
          box-shadow:inset 0 0 0 1px rgb(var(--c-violet) / .35);
        }
        :root[data-theme="dark"] .shd-nav-glass{
          background:rgb(var(--c-violet) / .2);
          box-shadow:inset 0 0 0 1px rgb(var(--c-violet) / .45);
        }
        /* ไอคอนเมนู "วาดเส้นเข้า" ตอนถูกเลือก (re-mount ด้วย key → เล่นใหม่ทุกครั้งที่จิ้ม) */
        @keyframes shdNavDraw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
        .shd-nav-draw path, .shd-nav-draw line, .shd-nav-draw polyline,
        .shd-nav-draw polygon, .shd-nav-draw circle, .shd-nav-draw rect, .shd-nav-draw ellipse {
          stroke-dasharray: 100;
          animation: shdNavDraw .5s cubic-bezier(.4,0,.2,1) forwards;
        }
      `}</style>
      {/* ============ Sidebar ============ */}
      <aside
        className={clsx(
          "fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-surface border-r border-line flex flex-col transition-all duration-300",
          railW,
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className={clsx("h-16 flex items-center gap-2.5 px-4 shrink-0", collapsed && "lg:px-0 lg:justify-center")}>
          <BrandReveal className="w-9 h-9 rounded-xl shrink-0" tileSize={72} />
          {!collapsed && (
            <div className="leading-tight lg:block">
              <p className="text-sm font-semibold">SHD POS</p>
              <p className="text-[10px] text-muted">{t.cmd.commandCenter}</p>
            </div>
          )}
          <button onClick={() => setOpen(false)} className="ml-auto lg:hidden text-muted p-1.5" aria-label="close">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
          {groups.map((g) => (
            <div key={g.section}>
              {!collapsed && <p className="eyebrow px-2.5 mb-1.5">{sectionLabel[g.section]}</p>}
              <div className="space-y-0.5">
                {g.items.map((n) => {
                  const active = pathname === n.href;
                  const Icon = n.icon;
                  const badge = badges[n.key] ?? 0;
                  return (
                    <motion.div key={n.href} whileTap={{ scale: 0.95 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                      <Link
                        href={n.href}
                        title={collapsed ? label[n.key] : undefined}
                        className={clsx(
                          "relative flex items-center gap-3 h-10 rounded-xl text-sm transition-colors",
                          collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3",
                          active ? "text-brand font-semibold" : "text-muted font-medium hover:text-ink hover:bg-surface2"
                        )}
                      >
                        {active && <motion.span layoutId="navActivePill" className="absolute inset-0 rounded-xl shd-nav-glass" transition={{ type: "spring", stiffness: 480, damping: 36 }} />}
                        <span className="relative z-10 shrink-0">
                          <Icon key={active ? "on" : "off"} size={18} className={clsx("shrink-0", active ? "text-brand shd-nav-draw" : "")} />
                        </span>
                        {!collapsed && <span className="relative z-10 truncate">{label[n.key]}</span>}
                        {badge > 0 ? (
                          <span className={clsx("relative z-10 inline-flex items-center justify-center", collapsed ? "lg:absolute lg:top-1 lg:right-1" : "ml-auto")}>
                            <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500/60 animate-ping" />
                            <span className="relative inline-flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold tabular-nums">{badge}</span>
                          </span>
                        ) : null}
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-line space-y-1 shrink-0">
          <Link
            href="/"
            title={collapsed ? t.app.home : undefined}
            className={clsx(
              "flex items-center gap-3 h-10 rounded-xl text-sm font-medium text-muted hover:text-ink hover:bg-surface2 transition-colors",
              collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3"
            )}
          >
            <Home size={18} className="shrink-0" />
            {!collapsed && t.app.home}
          </Link>
          <Link
            href="/admin/settings"
            title={collapsed ? t.admin.settings : undefined}
            className={clsx(
              "flex items-center gap-3 h-10 rounded-xl text-sm font-medium transition-colors",
              collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3",
              pathname === "/admin/settings"
                ? "shd-nav-glass text-brand font-semibold"
                : "text-muted hover:text-ink hover:bg-surface2"
            )}
          >
            <Settings2 key={pathname === "/admin/settings" ? "on" : "off"} size={18} className={clsx("shrink-0", pathname === "/admin/settings" && "text-brand shd-nav-draw")} />
            {!collapsed && t.admin.settings}
          </Link>
          <Link
            href="/pos/sell"
            title={collapsed ? t.app.pos : undefined}
            className={clsx(
              "flex items-center gap-3 h-10 rounded-xl text-sm text-muted hover:bg-surface2 transition-colors",
              collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3"
            )}
          >
            <Store size={18} className="shrink-0" />
            {!collapsed && t.app.pos}
          </Link>
          <button
            onClick={toggleCollapse}
            className="hidden lg:flex items-center gap-3 h-9 w-full rounded-xl px-3 text-[11px] text-muted hover:bg-surface2 transition-colors"
          >
            {collapsed ? <PanelLeftOpen size={16} className="mx-auto" /> : <><PanelLeftClose size={16} /> {t.cmd.collapse}</>}
          </button>
        </div>
      </aside>

      {open ? <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setOpen(false)} /> : null}

      {/* ============ Content ============ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* floating top header */}
        <header className="sticky top-0 z-30 px-3 sm:px-5 pt-3">
          <div className="glass h-14 rounded-2xl flex items-center gap-2 px-3">
            <button onClick={() => setOpen(true)} className="lg:hidden text-muted p-1.5" aria-label="menu">
              <Menu size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="hidden sm:inline">SHD</span>
                <span className="hidden sm:inline text-line">/</span>
                <span className="truncate">{sectionLabel[currentSection] ?? "SHD"}</span>
              </div>
              <h1 className="text-sm font-semibold leading-tight truncate">{label[currentKey] ?? t.admin.dashboard}</h1>
            </div>

            {/* global search */}
            <button onClick={() => window.dispatchEvent(new Event("shd:command"))} className="ml-3 hidden md:flex items-center gap-2 h-9 px-3 rounded-xl bg-surface2 border border-line/60 text-muted text-xs hover:text-ink transition-colors w-56 lg:w-72">
              <Search size={14} />
              <span className="flex-1 text-left">{t.common.search}…</span>
              <kbd className="flex items-center gap-0.5 text-[10px] bg-surface border border-line rounded px-1 py-0.5"><Command size={9} />K</kbd>
            </button>

            <div className="ml-auto flex items-center gap-1">
              {/* ตัวกรองแบรนด์/สาขา (ใช้งานจริง) */}
              <ScopeTopbar />

              <Clock />

              {/* live */}
              <span className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-xl bg-ok/10 text-ok text-[11px] font-semibold">
                <LiveDot /> LIVE
              </span>

              <Link href="/" className="p-2 rounded-xl hover:bg-surface2 text-muted" title={t.app.home}>
                <Home size={17} />
              </Link>

              <div className="relative">
                <button onClick={() => setNotifOpen((v) => !v)} className="relative p-2 rounded-xl hover:bg-surface2 text-muted" aria-label="notifications" title={L("การแจ้งเตือน", "Notifications", "通知")}>
                  <motion.span animate={queueCount > 0 && !notifOpen ? { rotate: [0, -12, 12, -8, 8, 0] } : {}} transition={{ duration: 0.6, repeat: queueCount > 0 && !notifOpen ? Infinity : 0, repeatDelay: 2.5 }} style={{ display: "inline-block", transformOrigin: "50% 10%" }}>
                    <Bell size={17} />
                  </motion.span>
                  {queueCount > 0 ? (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center">
                      {!notifOpen ? <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500/60 animate-ping" /> : null}
                      <span className="relative inline-flex min-w-[16px] h-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold tabular-nums">{queueCount}</span>
                    </span>
                  ) : null}
                </button>
                {notifOpen ? (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <div className="absolute right-0 mt-2 w-[340px] max-h-[72vh] overflow-auto rounded-2xl border border-line bg-surface shadow-xl z-50">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-surface z-10">
                        <span className="text-sm font-semibold inline-flex items-center gap-1.5"><Bell size={14} className="text-brand" /> {L("การแจ้งเตือน", "Notifications", "通知")}</span>
                        {queueCount > 0 ? <span className="text-[11px] text-muted">{queueCount} {L("รายการ", "items", "项")}</span> : null}
                      </div>
                      {notifs.length ? (
                        <div className="divide-y divide-line/60">
                          {notifs.slice(0, 40).map((n) => (
                            <Link key={n.id} href={n.href} onClick={() => setNotifOpen(false)} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-surface2 transition-colors">
                              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.tone === "danger" ? "bg-rose-500" : n.tone === "warn" ? "bg-amber-500" : "bg-brand"}`} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium leading-tight truncate">{n.title}</p>
                                <p className="text-[11px] text-muted truncate">{n.sub}</p>
                              </div>
                              <span className="text-[10px] text-muted shrink-0 mt-0.5">{timeAgo(n.at)}</span>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 py-12 text-center"><Bell size={26} className="mx-auto text-muted/30 mb-2" /><p className="text-sm text-muted">{L("ไม่มีการแจ้งเตือน", "No notifications", "暂无通知")}</p></div>
                      )}
                      <Link href="/admin/transfers" onClick={() => setNotifOpen(false)} className="block text-center text-xs text-brand font-medium py-2.5 border-t border-line hover:bg-surface2 sticky bottom-0 bg-surface">{L("ไปที่โอนย้ายทั้งหมด", "Go to transfers", "查看全部")}</Link>
                    </div>
                  </>
                ) : null}
              </div>
              <button
                onClick={() => setLocale(LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length])}
                className="hidden sm:flex px-2 h-9 rounded-xl hover:bg-surface2 text-muted text-xs items-center gap-1.5"
              >
                <Languages size={15} /> {LOCALE_LABEL[locale]}
              </button>
              <button onClick={() => setMode(mode === "light" ? "dark" : "light")} className="p-2 rounded-xl hover:bg-surface2 text-muted" aria-label="theme">
                {mode === "dark" ? <Moon size={17} /> : <Sun size={17} />}
              </button>

              {employee ? (
                <div className="flex items-center gap-2 pl-1.5 ml-1 border-l border-line">
                  {employee.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={employee.photo_url} alt="" className="w-[30px] h-[30px] rounded-full object-cover ring-1 ring-line" />
                  ) : (
                    <Avatar name={employee.nickname ?? employee.first_name} src={employee.photo_url} size={30} />
                  )}
                  <div className="hidden lg:block leading-tight pr-1">
                    <p className="text-xs font-semibold truncate max-w-[110px]">{employee.nickname ?? employee.first_name}</p>
                    <p className="text-[10px] text-muted">{ROLE_LABEL[employee.role][locale]}</p>
                  </div>
                  <button
                    onClick={() => {
                      const wasSso = employee?.id?.startsWith("sso:");
                      logout();
                      if (wasSso) window.location.href = "/sso/logout";
                      else router.push("/pos");
                    }}
                    className="p-2 rounded-xl hover:bg-surface2 text-muted hover:text-danger transition-colors"
                    title={t.common.logout}
                  >
                    <LogOut size={17} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <Suspense fallback={null}>
          <WorkspaceTabs baseLabel={label[currentKey] ?? t.admin.dashboard} />
        </Suspense>

        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
