"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, TrendingUp, Users, Package, Boxes, ArrowLeftRight,
  ShieldCheck, ScrollText, Settings2, Store, Sun, Moon, Languages, Menu, X, Bell,
  Search, PanelLeftClose, PanelLeftOpen, ChevronDown, Command, Home, Activity, FileText, LogOut, Contact, CalendarClock, Ticket, Network, Landmark, Wand2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { ROLE_LABEL, can, type PermissionKey } from "@/lib/permissions";
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
          background:rgb(var(--c-lavender));
          box-shadow:inset 0 0 0 1px rgb(var(--c-brand) / .14);
        }
        :root[data-theme="dark"] .shd-nav-glass{
          background:rgb(var(--c-lavender));
          box-shadow:inset 0 0 0 1px rgb(var(--c-brand) / .35);
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
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      title={collapsed ? label[n.key] : undefined}
                      className={clsx(
                        "flex items-center gap-3 h-10 rounded-xl text-sm transition-colors",
                        collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3",
                        active ? "shd-nav-glass text-brand font-semibold" : "text-muted font-medium hover:text-ink hover:bg-surface2"
                      )}
                    >
                      <Icon size={18} className={clsx("shrink-0", active && "text-brand")} />
                      {!collapsed && <span className="truncate">{label[n.key]}</span>}
                    </Link>
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
            <Settings2 size={18} className={clsx("shrink-0", pathname === "/admin/settings" && "text-brand")} />
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

              <Link href="/admin/approvals" className="relative p-2 rounded-xl hover:bg-surface2 text-muted">
                <Bell size={17} />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-coral" />
              </Link>
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
