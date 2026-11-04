"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ShoppingCart, ReceiptText, RotateCcw, Boxes, FileText, ClipboardList,
  Settings, LogOut, Wifi, WifiOff, RefreshCw, Sun, Moon, Monitor, Languages, Clock, Home,
  LayoutDashboard, PauseCircle, SlidersHorizontal, Search, ArrowLeftRight, PackagePlus,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { subscribeSync, flush, type SyncState } from "@/lib/offline/sync";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui";
import { Clock as LiveClock } from "@/components/clock";
import { BrandReveal } from "@/components/brand-reveal";
import { openDisplayWindow } from "@/lib/customer-display";
import { formatTHB } from "@/lib/money";

const NAV = [
  { href: "/pos/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { href: "/pos/sell", icon: ShoppingCart, key: "sell" },
  { href: "/pos/orders", icon: ReceiptText, key: "orders" },
  { href: "/pos/holds", icon: PauseCircle, key: "holds" },
  { href: "/pos/returns", icon: RotateCcw, key: "returns" },
  { href: "/pos/stock", icon: Boxes, key: "stock" },
  { href: "/pos/transfers", icon: ArrowLeftRight, key: "transfers" },
  { href: "/pos/receive", icon: PackagePlus, key: "receive" },
  { href: "/pos/quotations", icon: FileText, key: "quotation" },
  { href: "/pos/count", icon: ClipboardList, key: "count" },
  { href: "/pos/adjust", icon: SlidersHorizontal, key: "adjust" },
] as const;

export function PosTopBar({ branchName }: { branchName?: string }) {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { employee, shift, logout } = useSession();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => subscribeSync(setSync), []);

  // กรอบเลื่อน: ไฮไลต์เลื่อนไปหาเมนูที่เลือก (ไม่มีพื้นหลังแยกซ้อนแถบ)
  const navWrapRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = NAV.findIndex((n) => pathname === n.href);
  useLayoutEffect(() => {
    const el = linkRefs.current[activeIndex];
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [activeIndex, locale]);
  useEffect(() => {
    const onResize = () => {
      const el = linkRefs.current[activeIndex];
      setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeIndex]);

  const label: Record<string, string> = {
    dashboard: t.admin.dashboard,
    sell: t.pos.sell,
    orders: t.orders.title,
    holds: t.cmd.heldOrders,
    returns: t.returns.title,
    stock: t.inventory.title,
    transfers: t.transfer.title,
    receive: t.cmd.goodsReceipt,
    quotation: t.quotation.title,
    count: t.inventory.count,
    adjust: t.cmd.stockAdjust,
  };

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line no-print">
      <div className="flex items-center gap-3 px-3 sm:px-4 h-14">
        <Link href="/pos/sell" className="flex items-center gap-2 shrink-0">
          <BrandReveal className="w-8 h-8 rounded-lg" tileSize={64} />
          <div className="hidden md:block leading-tight">
            <p className="text-sm font-semibold">SHD POS</p>
            <p className="text-[10px] text-muted truncate max-w-[160px]">{branchName ?? "—"}</p>
          </div>
        </Link>

        <div ref={navWrapRef} className="relative flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
          {/* กรอบแก้ว (liquid glass) เลื่อนครอบเมนูที่เลือก — เอาแค่ animation เปลี่ยนแท็บ */}
          <style>{`
            .shd-tab-glass{
              background:linear-gradient(135deg,rgb(var(--c-surface) / .72),rgb(var(--c-surface) / .30));
              -webkit-backdrop-filter:blur(10px) saturate(1.6);
              backdrop-filter:blur(10px) saturate(1.6);
              box-shadow:inset 0 1px 1px rgb(255 255 255 / .6),inset 0 0 0 1px rgb(var(--c-brand) / .14),0 6px 16px -8px rgb(var(--c-brand) / .35);
            }
            :root[data-theme="dark"] .shd-tab-glass{
              background:linear-gradient(135deg,rgb(var(--c-surface) / .65),rgb(var(--c-surface) / .25));
              box-shadow:inset 0 1px 1px rgb(255 255 255 / .12),inset 0 0 0 1px rgb(var(--c-brand) / .22),0 6px 16px -8px rgb(0 0 0 / .6);
            }
          `}</style>
          {pill ? (
            <span
              aria-hidden
              className="shd-tab-glass absolute top-1/2 -translate-y-1/2 h-9 rounded-xl pointer-events-none transition-all duration-[380ms] ease-[cubic-bezier(.22,1,.36,1)]"
              style={{ left: pill.left, width: pill.width }}
            />
          ) : null}
          {NAV.map((n, i) => {
            const active = pathname === n.href;
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                ref={(el) => { linkRefs.current[i] = el; }}
                className={clsx(
                  "relative z-10 flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-xs whitespace-nowrap transition-colors duration-200",
                  active ? "text-ink font-semibold" : "text-muted font-medium hover:text-ink hover:bg-surface2/60"
                )}
              >
                <Icon size={15} />
                <span className="hidden lg:inline">{label[n.key]}</span>
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <LiveClock compact />

          {shift ? (
            <Link href="/pos/shift" className="hidden sm:flex">
              <Badge tone="ok">
                <Clock size={11} /> {formatTHB(shift.total_sales, false)} · {shift.total_orders}
              </Badge>
            </Link>
          ) : (
            <Link href="/pos/shift">
              <Badge tone="warn">{t.shift.noShift}</Badge>
            </Link>
          )}

          <button
            onClick={() => void flush()}
            className="flex items-center gap-1.5 px-2 h-9 rounded-lg hover:bg-surface2 text-xs"
            title={sync?.online ? t.offline.online : t.offline.offline}
          >
            {sync?.syncing ? (
              <RefreshCw size={15} className="animate-spin text-info" />
            ) : sync?.online ? (
              <Wifi size={15} className="text-ok" />
            ) : (
              <WifiOff size={15} className="text-warn" />
            )}
            {sync && sync.pending > 0 ? <span className="tnum text-warn">{sync.pending}</span> : null}
          </button>

          <button
            onClick={() => window.dispatchEvent(new Event("shd:command"))}
            className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg hover:bg-surface2 text-muted"
            title={`${t.common.search} (⌘K)`}
          >
            <Search size={16} />
            <kbd className="hidden xl:inline text-[10px] bg-surface2 border border-line rounded px-1 py-0.5">⌘K</kbd>
          </button>

          <Link
            href="/"
            className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg hover:bg-surface2 text-muted text-xs font-medium"
            title={t.app.home}
          >
            <Home size={16} />
            <span className="hidden xl:inline">{t.app.home}</span>
          </Link>

          <button onClick={openDisplayWindow} className="p-2 rounded-lg hover:bg-surface2 text-muted" title={t.settings.openDisplay}>
            <Monitor size={16} />
          </button>

          <div className="relative">
            <button onClick={() => setLangOpen((v) => !v)} className="p-2 rounded-lg hover:bg-surface2 text-muted" title={t.settings.language}>
              <Languages size={16} />
            </button>
            {langOpen ? (
              <div className="absolute right-0 mt-1 bg-surface border border-line rounded-xl shadow-pop py-1 w-28 z-50">
                {LOCALES.map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      setLocale(l);
                      setLangOpen(false);
                    }}
                    className={clsx(
                      "w-full text-left px-3 py-1.5 text-xs hover:bg-surface2",
                      locale === l && "text-brand font-medium"
                    )}
                  >
                    {LOCALE_LABEL[l]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            onClick={() => setMode(mode === "light" ? "dark" : "light")}
            className="p-2 rounded-lg hover:bg-surface2 text-muted"
            title={t.settings.theme}
          >
            {mode === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <Link href="/pos/settings" className="p-2 rounded-lg hover:bg-surface2 text-muted">
            <Settings size={16} />
          </Link>

          <div className="hidden sm:flex items-center gap-2 pl-2 ml-1 border-l border-line">
            <div className="text-right leading-tight">
              <p className="text-xs font-medium">{employee?.nickname ?? employee?.first_name}</p>
              <p className="text-[10px] text-muted">{employee?.employee_code}</p>
            </div>
            {employee?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={employee.photo_url} alt="" className="w-7 h-7 rounded-full object-cover ring-1 ring-line" />
            ) : null}
            <button
              onClick={() => {
                const wasSso = employee?.id?.startsWith("sso:");
                logout();
                if (wasSso) window.location.href = "/sso/logout";
                else router.push("/pos");
              }}
              className="p-2 rounded-lg hover:bg-surface2 text-muted"
              title={t.common.logout}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {sync && !sync.online ? (
        <div className="bg-warn/12 text-warn text-xs px-4 py-1.5 text-center border-t border-warn/20">
          {t.offline.banner}
          {sync.pending > 0 ? ` · ${sync.pending} ${t.offline.pending}` : ""}
        </div>
      ) : null}
    </header>
  );
}
