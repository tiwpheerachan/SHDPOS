"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ReceiptText, Package, User, Store, Hash, CornerDownLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listOrders, listProducts, listEmployees, listBranches } from "@/lib/data/repo";
import type { Branch, Employee, Order, Product } from "@/lib/types";
import { formatTHB } from "@/lib/money";

type Result = { kind: "order" | "product" | "employee" | "branch"; id: string; key: string; title: string; sub: string; href: string };

export function CommandPalette() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // เปิดด้วย ⌘K / Ctrl+K หรือ event จากปุ่มค้นหา
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === "Escape") setOpen(false);
    };
    const onEvt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("shd:command", onEvt as EventListener);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("shd:command", onEvt as EventListener); };
  }, []);

  // โหลดข้อมูลครั้งแรกที่เปิด
  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      const [o, p, e, b] = await Promise.all([listOrders({ limit: 800 }), listProducts(), listEmployees(), listBranches()]);
      setOrders(o); setProducts(p); setEmployees(e); setBranches(b); setLoaded(true);
    })();
  }, [open, loaded]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); else { setQ(""); setActive(0); } }, [open]);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out: Result[] = [];
    const bName = new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name]));

    for (const o of orders) {
      const serialHit = o.items.some((it) => it.serials.some((sn) => sn.toLowerCase().includes(term)));
      const skuHit = o.items.some((it) => it.sku.toLowerCase().includes(term));
      if (o.order_no.toLowerCase().includes(term) || (o.customer_name ?? "").toLowerCase().includes(term) || (o.customer_phone ?? "").includes(term) || serialHit || skuHit) {
        out.push({ kind: "order", id: o.id, key: o.order_no, title: o.order_no, sub: `${bName.get(o.branch_id) ?? ""} · ${formatTHB(o.grand_total, false)}${serialHit ? " · SN✓" : ""}`, href: `/pos/orders?focus=${encodeURIComponent(o.order_no)}` });
      }
      if (out.filter((r) => r.kind === "order").length >= 6) break;
    }
    for (const p of products) {
      if (p.sku.toLowerCase().includes(term) || p.name_th.toLowerCase().includes(term) || (p.name_en ?? "").toLowerCase().includes(term) || p.barcodes.some((bc) => bc.toLowerCase().includes(term))) {
        out.push({ kind: "product", id: p.id, key: p.sku, title: locale === "th" ? p.name_th : p.name_en ?? p.name_th, sub: p.sku, href: `/pos/stock?focus=${encodeURIComponent(p.sku)}` });
      }
      if (out.filter((r) => r.kind === "product").length >= 6) break;
    }
    for (const e of employees) {
      if (e.employee_code.toLowerCase().includes(term) || (e.nickname ?? "").toLowerCase().includes(term) || e.first_name.toLowerCase().includes(term)) {
        out.push({ kind: "employee", id: e.id, key: e.employee_code, title: `${e.nickname ?? e.first_name}`, sub: e.employee_code, href: `/admin/employees?q=${encodeURIComponent(e.employee_code)}` });
      }
      if (out.filter((r) => r.kind === "employee").length >= 5) break;
    }
    for (const b of branches) {
      if (b.code.toLowerCase().includes(term) || (b.name_th ?? "").toLowerCase().includes(term) || b.name.toLowerCase().includes(term)) {
        out.push({ kind: "branch", id: b.id, key: b.code, title: bName.get(b.id) ?? b.name, sub: b.code, href: `/admin/sales` });
      }
      if (out.filter((r) => r.kind === "branch").length >= 4) break;
    }
    return out;
  }, [q, orders, products, employees, branches, locale]);

  useEffect(() => { setActive(0); }, [q]);

  const go = (r: Result) => { setOpen(false); router.push(r.href); setTimeout(() => window.dispatchEvent(new CustomEvent("shd:focus", { detail: { kind: r.kind, key: r.key } })), 60); };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
  };

  const meta: Record<Result["kind"], { icon: React.ReactNode; label: string }> = {
    order: { icon: <ReceiptText size={15} />, label: t.orders.title },
    product: { icon: <Package size={15} />, label: t.admin.products },
    employee: { icon: <User size={15} />, label: t.admin.employees },
    branch: { icon: <Store size={15} />, label: t.common.branch },
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl bg-surface border border-line rounded-2xl shadow-pop overflow-hidden animate-slideUp">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line">
          <Search size={18} className="text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
            placeholder={L("ค้นบิล · SKU · Serial · บาร์โค้ด · พนักงาน · สาขา", "Search invoice · SKU · serial · barcode · staff · branch", "搜索单据·SKU·序列号·员工·门店")}
            className="flex-1 bg-transparent outline-none text-sm" />
          <kbd className="text-[10px] bg-surface2 border border-line rounded px-1.5 py-0.5 text-muted">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-2">
          {!q ? (
            <p className="px-4 py-8 text-center text-xs text-muted">{L("พิมพ์เพื่อค้นหาทั้งระบบ — บิล, สินค้า, Serial, พนักงาน, สาขา", "Type to search everything", "输入以搜索")}</p>
          ) : results.length ? (
            results.map((r, i) => (
              <button key={`${r.kind}-${r.id}`} onMouseEnter={() => setActive(i)} onClick={() => go(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === active ? "bg-surface2" : ""}`}>
                <span className="w-8 h-8 rounded-lg bg-surface2 grid place-items-center text-muted shrink-0">{meta[r.kind].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  <p className="text-[11px] text-muted truncate">{r.sub}</p>
                </div>
                <span className="text-[10px] text-muted shrink-0">{meta[r.kind].label}</span>
                {i === active ? <CornerDownLeft size={13} className="text-muted shrink-0" /> : null}
              </button>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-xs text-muted">{L("ไม่พบผลลัพธ์", "No results", "无结果")}</p>
          )}
        </div>
        <div className="flex items-center gap-3 px-4 h-9 border-t border-line text-[10px] text-muted">
          <span className="flex items-center gap-1"><Hash size={11} /> {results.length} {L("ผลลัพธ์", "results", "结果")}</span>
          <span className="ml-auto flex items-center gap-2">↑↓ {L("เลือก", "navigate", "选择")} · ⏎ {L("เปิด", "open", "打开")} · ⌘K</span>
        </div>
      </div>
    </div>
  );
}
