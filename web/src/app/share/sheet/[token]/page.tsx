"use client";
// =====================================================================
// ลิงก์สาธารณะของมุมมองตารางยอดขาย — ไม่ต้องล็อกอิน · เห็นเฉพาะตารางของมุมมองนี้ (ไม่มีเมนู/หน้าอื่น)
//   ข้อมูลสด ตามช่วงวันที่ของมุมมอง · ไม่มีต้นทุน/ข้อมูลลูกค้า · เรียง/กรองดูเองได้แต่ไม่บันทึก
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Table2, Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { SalesSheet } from "@/components/admin/sales-sheet";
import { expandLegacy, expandLegacyDaily, type LegacyCompact } from "@/lib/legacy-expand";
import { applyOrderFilters } from "@/lib/analytics";
import { EMPTY_FILTER, type AdminFilter } from "@/components/admin/filters";
import { useL } from "@/lib/i18n/provider";
import type { Branch, Brand, Employee, Order } from "@/lib/types";

type Payload = {
  view: { name: string; state: Record<string, unknown> }; mode?: "live" | "snapshot";
  range?: { from: string; to: string };
  data?: { orders: Order[]; branches: Branch[]; brands: Brand[]; employees: Employee[]; legacy: LegacyCompact | null; legacy_prev: unknown; truncated: boolean };
  snapshot_at?: string; snapshot?: { orders: Order[]; branches: Branch[]; brands: Brand[]; employees: Employee[] };
};

export default function SharedSheetPage({ params }: { params: { token: string } }) {
  const L = useL();
  const [p, setP] = useState<Payload | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/share/sheet?token=${encodeURIComponent(params.token)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? L("เปิดลิงก์ไม่ได้", "Can't open link", "无法打开链接")); else { setP(j); setErr(""); }
    } catch { setErr(L("เปิดลิงก์ไม่ได้", "Can't open link", "无法打开链接")); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [params.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const built = useMemo(() => {
    if (!p) return null;
    // ภาพนิ่ง: บิลที่มุมมองแสดง ณ เวลาที่แชร์ (กรองไว้แล้ว)
    if (p.mode === "snapshot" && p.snapshot) return { orders: p.snapshot.orders, branches: p.snapshot.branches, employees: p.snapshot.employees, brands: p.snapshot.brands };
    if (!p.data || !p.range) return null;
    const lk = p.data.legacy ? expandLegacy(p.data.legacy) : { orders: [], pseudoBranches: [], pseudoEmployees: [] };
    void expandLegacyDaily;
    const branches = [...p.data.branches, ...lk.pseudoBranches];
    const page = (p.view.state.page ?? {}) as { filter?: Partial<AdminFilter>; src?: "all" | "pos" | "lark" };
    let orders = [...p.data.orders, ...lk.orders];
    if (page.src === "lark") orders = orders.filter((o) => o.source === "lark"); else if (page.src === "pos") orders = orders.filter((o) => o.source !== "lark");
    // ตัวกรองระดับหน้าของมุมมอง (ช่วงวันที่เซิร์ฟเวอร์ตัดแล้ว)
    const f = { ...EMPTY_FILTER, ...(page.filter ?? {}), range: "custom", from: new Date(p.range.from), to: new Date(p.range.to) } as AdminFilter;
    orders = applyOrderFilters(orders, f, { branches, products: [] });
    return { orders, branches, employees: [...p.data.employees, ...lk.pseudoEmployees], brands: p.data.brands };
  }, [p]);

  if (err) return <div className="min-h-screen grid place-items-center p-6 bg-bg"><div className="card p-8 text-center max-w-sm"><Table2 size={28} className="mx-auto text-muted" /><p className="mt-3 font-semibold">{err}</p><p className="text-xs text-muted mt-1">{L("ขอลิงก์ใหม่จากผู้แชร์", "Ask the sharer for a new link", "请向分享者索取新链接")}</p></div></div>;
  if (!p || !built) return <div className="min-h-screen grid place-items-center bg-bg"><Loader2 className="animate-spin text-muted" /></div>;
  const d = (s: string) => new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 space-y-3">
        <header className="flex flex-wrap items-center gap-3">
          <span className="h-11 w-11 rounded-2xl bg-brand/10 text-brand grid place-items-center"><Table2 size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold truncate" translate="no">{p.view.name}</h1>
            <p className="text-xs text-muted">{L("ยอดขาย", "Sales", "销售")} · {p.mode === "snapshot"
              ? L(`ภาพนิ่ง ณ ${new Date(p.snapshot_at ?? "").toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} (ข้อมูลไม่เปลี่ยน)`, `Snapshot of ${new Date(p.snapshot_at ?? "").toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} (frozen)`, "快照（数据不变）")
              : <>{d(p.range!.from)} – {d(p.range!.to)} · {L("ข้อมูลสด", "Live data", "实时数据")}</>}</p>
          </div>
          {p.mode === "snapshot" ? null : <button onClick={() => void load()} disabled={busy} className="h-9 px-3 rounded-xl border border-line text-xs inline-flex items-center gap-1.5 hover:bg-surface2 disabled:opacity-60">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />{L("รีเฟรช", "Refresh", "刷新")}
          </button>}
        </header>
        <SalesSheet readOnly initialView={p.view.state} orders={built.orders} branches={built.branches} brands={built.brands} employees={built.employees}
          products={[]} catName={new Map()} showCost={false} owStatus={{}} />
        <p className="text-[11px] text-muted flex items-center gap-1.5"><ShieldCheck size={12} />{L("ลิงก์อ่านอย่างเดียว · เห็นเฉพาะมุมมองนี้ · ไม่มีต้นทุนและข้อมูลส่วนตัวลูกค้า · ผู้แชร์ยกเลิกลิงก์ได้ทุกเมื่อ", "Read-only link · this view only · no cost or customer personal data · the sharer can revoke it anytime", "只读链接 · 仅此视图 · 不含成本与顾客个人信息 · 分享者可随时撤销")}</p>
      </div>
    </div>
  );
}
