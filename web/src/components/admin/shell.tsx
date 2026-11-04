"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, TrendingUp, Users, Package, Boxes, ArrowLeftRight,
  ShieldCheck, ScrollText, Settings2, Store, Sun, Moon, Languages, Menu, X, Bell,
  Search, PanelLeftClose, PanelLeftOpen, ChevronDown, Command, Home, Activity, FileText, KeyRound,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { ROLE_LABEL, can, type PermissionKey } from "@/lib/permissions";
import { Avatar, LiveDot } from "@/components/ui";
import { Clock } from "@/components/clock";
import { BrandReveal } from "@/components/brand-reveal";

type NavItem = { href: string; icon: typeof LayoutDashboard; key: string; perm?: PermissionKey };
type NavGroup = { section: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { section: "overview", items: [{ href: "/admin", icon: LayoutDashboard, key: "dashboard" }] },
  {
    section: "sales",
    items: [
      { href: "/admin/sales", icon: TrendingUp, key: "sales" },
      { href: "/admin/employees", icon: Users, key: "employees", perm: "report.employee_perf" },
    ],
  },
  {
    section: "operations",
    items: [
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
      { href: "/admin/permissions", icon: KeyRound, key: "permissions", perm: "admin.permission_manage" },
      { href: "/admin/audit", icon: ScrollText, key: "audit", perm: "audit.view" },
    ],
  },
];

const COLLAPSE_KEY = "shdpos.nav.collapsed";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const pathname = usePathname();
  const { employee } = useSession();
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
    permissions: locale === "en" ? "User Access" : "สิทธิ์ผู้ใช้",
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
                        "flex items-center gap-3 h-10 rounded-xl text-sm font-medium transition-colors",
                        collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3",
                        active ? "bg-brand text-brandInk" : "text-muted hover:text-ink hover:bg-surface2"
                      )}
                    >
                      <Icon size={18} className="shrink-0" />
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
              "flex items-center gap-3 h-10 rounded-xl text-sm font-medium text-muted hover:text-ink hover:bg-surface2 transition-colors",
              collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3",
              pathname === "/admin/settings" && "bg-brand text-brandInk hover:text-brandInk"
            )}
          >
            <Settings2 size={18} className="shrink-0" />
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
          <div className="h-14 rounded-2xl bg-surface/85 backdrop-blur-xl border border-line/70 shadow-card flex items-center gap-2 px-3">
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
              {/* brand / branch selectors (demo static) */}
              <button className="hidden xl:flex items-center gap-1.5 h-9 px-3 rounded-xl hover:bg-surface2 text-xs font-medium text-ink">
                {t.cmd.allBrands} <ChevronDown size={13} className="text-muted" />
              </button>
              <button className="hidden xl:flex items-center gap-1.5 h-9 px-3 rounded-xl hover:bg-surface2 text-xs font-medium text-ink">
                {t.cmd.allBranches} <ChevronDown size={13} className="text-muted" />
              </button>

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
                  <Avatar name={employee.nickname ?? employee.first_name} size={30} />
                  <div className="hidden lg:block leading-tight pr-1">
                    <p className="text-xs font-semibold truncate max-w-[110px]">{employee.nickname ?? employee.first_name}</p>
                    <p className="text-[10px] text-muted">{ROLE_LABEL[employee.role][locale]}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
