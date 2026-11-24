"use client";
// =====================================================================
// รายละเอียดสต๊อกสินค้า 1 ตัว (Drawer ขวา จากหน้า /admin/inventory)
//   • รูปใหญ่ + ข้อมูลสินค้า · สต๊อกแยกสาขา (มีอยู่/พร้อมขาย/จอง/ระหว่างทาง/พักตรวจ)
//   • SN รายชิ้น: สถานะ · อยู่ที่ไหน · เอกสารล่าสุด · ไทม์ไลน์เต็ม (กดขยาย)
//     แหล่งข้อมูล = เอกสารโอน/ส่งคืน/ขาย (serialsForProduct) + ทะเบียน SN กลาง (/api/admin/serials)
//   • กรอง SN: สถานะ · สาขา · ค้นเลข SN
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Package, Search, ChevronDown, Truck, ShoppingBag, ShieldAlert, RotateCcw, Boxes, Ban, HelpCircle, AlertTriangle, Lock, ScanLine } from "lucide-react";
import { Drawer } from "@/components/ui";
import { serialsForProduct, type SerialInfo, type SerialEventKind } from "@/lib/data/serials";
import { listEmployees } from "@/lib/data/repo";
import { stockView } from "@/lib/stock";
import { formatTHB } from "@/lib/money";
import type { Branch, Product, StockLevel } from "@/lib/types";

type UStatus = "in_stock" | "reserved" | "in_transit" | "sold" | "returned" | "quarantined" | "defective" | "scrapped" | "unknown";
interface RegistryRow {
  serial_no: string; imei: string | null; branch_id: string | null; status: string;
  received_at: string | null; sold_at: string | null; warranty_start: string | null; warranty_end: string | null; note: string | null; updated_at: string;
}
interface Unit {
  sn: string; status: UStatus; branchId: string | null; lastAt: string | null; lastRef: string | null;
  events: SerialInfo["events"]; soldInfo: SerialInfo["soldInfo"]; registry: RegistryRow | null; source: "doc" | "registry" | "both";
}

const STATUS: Record<UStatus, { label: string; cls: string; icon: typeof Boxes }> = {
  in_stock: { label: "อยู่ในสต๊อก", cls: "bg-ok/12 text-ok", icon: Boxes },
  reserved: { label: "จองแล้ว", cls: "bg-violet-500/12 text-violet-600", icon: Lock },
  in_transit: { label: "ระหว่างขนส่ง", cls: "bg-sky-500/12 text-sky-600", icon: Truck },
  sold: { label: "ขายแล้ว", cls: "bg-brand/10 text-brand", icon: ShoppingBag },
  returned: { label: "รับคืนแล้ว", cls: "bg-teal-500/12 text-teal-600", icon: RotateCcw },
  quarantined: { label: "พักตรวจ", cls: "bg-warn/15 text-warn", icon: ShieldAlert },
  defective: { label: "ชำรุด", cls: "bg-danger/12 text-danger", icon: AlertTriangle },
  scrapped: { label: "ตัดจำหน่าย", cls: "bg-surface2 text-muted", icon: Ban },
  unknown: { label: "ไม่ทราบ", cls: "bg-surface2 text-muted", icon: HelpCircle },
};
const EVENT: Record<SerialEventKind, string> = {
  received: "รับเข้าสาขา", shipped: "ส่งออก (โอน)", sold: "ขาย", returned: "ส่งคืน/ส่งซ่อม",
  quarantined: "เข้าพักตรวจ", return_in: "ต้นทางรับคืน", flagged: "เปิดเคสผลต่าง",
};
const fromRegistry = (s: string): UStatus =>
  s === "in_stock" || s === "reserved" || s === "sold" || s === "returned" || s === "defective" || s === "scrapped" ? s : s === "transferred" ? "in_transit" : "unknown";
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export function ProductStockDrawer({
  product, open, onClose, branches, stock, brandName, showCost,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  branches: Branch[];                       // เฉพาะสาขาที่เห็นได้
  stock: (StockLevel & { key: string })[];  // สต๊อกทุกสาขา (จะกรองตามสินค้า)
  brandName: string | null;
  showCost: boolean;
}) {
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [regNote, setRegNote] = useState("");
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [fStatus, setFStatus] = useState<"all" | UStatus>("all");
  const [fBranch, setFBranch] = useState("all");
  const [q, setQ] = useState("");
  const [openSn, setOpenSn] = useState<string | null>(null);

  const bName = useMemo(() => new Map(branches.map((b) => [b.id, b.name_th ?? b.name])), [branches]);
  const branchLabel = (id: string | null) => (id ? bName.get(id) ?? "สาขาอื่น (นอกสิทธิ์)" : "—");

  useEffect(() => {
    if (!open || !product) return;
    let alive = true;
    setUnits(null); setRegNote(""); setFStatus("all"); setFBranch("all"); setQ(""); setOpenSn(null);
    void listEmployees().then((es) => alive && setPeople(new Map(es.map((e) => [e.id, e.nickname || e.first_name])))).catch(() => {});
    void (async () => {
      const [docs, reg] = await Promise.all([
        serialsForProduct(product.id).catch(() => [] as SerialInfo[]),
        fetch(`/api/admin/serials?product_id=${product.id}`, { cache: "no-store" })
          .then(async (r) => (r.ok ? ((await r.json()).serials as RegistryRow[]) : (setRegNote(r.status === 403 ? "ไม่มีสิทธิ์อ่านทะเบียน SN กลาง" : r.status === 401 ? "ทะเบียน SN กลางต้องล็อกอิน SSO" : ""), [])))
          .catch(() => [] as RegistryRow[]),
      ]);
      const map = new Map<string, Unit>();
      for (const d of docs) {
        const last = d.events[d.events.length - 1];
        map.set(d.serialNo, { sn: d.serialNo, status: d.status, branchId: d.currentBranchId, lastAt: last?.at ?? null, lastRef: last?.refNo ?? null, events: d.events, soldInfo: d.soldInfo ?? null, registry: null, source: "doc" });
      }
      for (const r of reg) {
        const sn = r.serial_no.trim().toUpperCase();
        const cur = map.get(sn);
        if (cur) { cur.registry = r; cur.source = "both"; if (cur.status === "unknown") { cur.status = fromRegistry(r.status); cur.branchId = r.branch_id; } }
        else map.set(sn, { sn, status: fromRegistry(r.status), branchId: r.branch_id, lastAt: r.updated_at, lastRef: null, events: [], soldInfo: null, registry: r, source: "registry" });
      }
      if (alive) setUnits([...map.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")));
    })();
    return () => { alive = false; };
  }, [open, product]);

  const perBranch = useMemo(() => {
    if (!product) return [];
    return branches.map((b) => {
      const row = stock.find((s) => s.branch_id === b.id && s.product_id === product.id);
      const v = row ? stockView(row) : null;
      const snIn = (units ?? []).filter((u) => u.branchId === b.id && (u.status === "in_stock" || u.status === "quarantined" || u.status === "returned")).length;
      return { b, v, snIn };
    }).filter((r) => (r.v && (r.v.onHand || r.v.otwo || r.v.stock)) || r.snIn);
  }, [product, branches, stock, units]);
  const totals = perBranch.reduce((t, r) => ({ onHand: t.onHand + (r.v?.onHand ?? 0), avail: t.avail + (r.v?.available ?? 0), snIn: t.snIn + r.snIn }), { onHand: 0, avail: 0, snIn: 0 });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: units?.length ?? 0 };
    for (const u of units ?? []) c[u.status] = (c[u.status] ?? 0) + 1;
    return c;
  }, [units]);
  const shown = useMemo(() => (units ?? []).filter((u) =>
    (fStatus === "all" || u.status === fStatus) &&
    (fBranch === "all" || u.branchId === fBranch) &&
    (!q.trim() || u.sn.includes(q.trim().toUpperCase()) || (u.registry?.imei ?? "").includes(q.trim()))), [units, fStatus, fBranch, q]);

  if (!product) return null;
  return (
    <Drawer open={open} onClose={onClose} width="xl" title="รายละเอียดสต๊อก" subtitle={`${product.sku}${brandName ? ` · ${brandName}` : ""}`}>
      <div className="p-5 space-y-6">
        {/* หัวสินค้า */}
        <div className="flex items-center gap-4">
          <div className="h-32 w-32 rounded-2xl bg-surface2/70 grid place-items-center overflow-hidden shrink-0">
            {product.image_url ? <img src={product.image_url} alt={product.name_th} className="h-full w-full object-contain p-2" /> : <Package size={34} className="text-muted/40" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-snug">{product.name_th}</p>
            <p className="text-xs text-muted tnum mt-1">{product.sku}{brandName ? ` · ${brandName}` : ""}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
              <span className="text-muted">ราคา <b className="text-ink tnum">{formatTHB(product.price)}</b></span>
              {showCost ? <span className="text-muted">ทุน <b className="text-ink tnum">{formatTHB(product.cost)}</b></span> : null}
              <span className="text-muted inline-flex items-center gap-1"><ScanLine size={12} />{product.track_serial ? "ติดตาม SN รายชิ้น" : "ไม่ใช้ SN"}</span>
            </div>
            <div className="flex gap-6 mt-3">
              <Stat label="มีอยู่รวม" value={totals.onHand} />
              <Stat label="พร้อมขายรวม" value={totals.avail} tone={totals.avail > 0 ? "text-ok" : "text-danger"} />
              {product.track_serial ? <Stat label="SN ในสาขา" value={totals.snIn} tone={totals.snIn !== totals.onHand ? "text-warn" : undefined} /> : null}
            </div>
          </div>
        </div>
        {product.track_serial && units && totals.snIn !== totals.onHand ? (
          <p className="text-xs rounded-xl bg-warn/10 text-warn px-3 py-2 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            จำนวน SN ที่ระบบรู้ตำแหน่ง ({totals.snIn}) ไม่เท่ากับยอดสต๊อก ({totals.onHand}) — SN ที่รับเข้าก่อนเปิดระบบ/จากการนับเปิดระบบ ยังไม่มีในเอกสาร ควรสแกนเข้าทะเบียน
          </p>
        ) : null}

        {/* สต๊อกแยกสาขา */}
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">สต๊อกแยกสาขา</h4>
          {perBranch.length ? (
            <div className="rounded-xl border border-line/70 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="text-muted bg-surface2/50 text-left">
                  <th className="px-3 py-2 font-medium">สาขา</th><th className="px-2 py-2 font-medium text-right">มีอยู่</th><th className="px-2 py-2 font-medium text-right">พร้อมขาย</th>
                  <th className="px-2 py-2 font-medium text-right">จอง</th><th className="px-2 py-2 font-medium text-right">ระหว่างทาง</th><th className="px-2 py-2 font-medium text-right">พักตรวจ</th>
                  {product.track_serial ? <th className="px-3 py-2 font-medium text-right">SN</th> : null}
                </tr></thead>
                <tbody>
                  {perBranch.map(({ b, v, snIn }) => (
                    <tr key={b.id} className="border-t border-line/50 hover:bg-surface2/40 cursor-pointer" onClick={() => setFBranch(fBranch === b.id ? "all" : b.id)}>
                      <td className={`px-3 py-2 ${fBranch === b.id ? "font-semibold text-brand" : ""}`}>{b.name_th ?? b.name}</td>
                      <td className="px-2 py-2 text-right tnum">{v?.onHand ?? 0}</td>
                      <td className={`px-2 py-2 text-right tnum font-semibold ${(v?.available ?? 0) > 0 ? "text-ok" : "text-muted"}`}>{v?.available ?? 0}</td>
                      <td className="px-2 py-2 text-right tnum text-muted">{(v?.reservedOut ?? 0) + (v?.reservedOrder ?? 0) || "—"}</td>
                      <td className="px-2 py-2 text-right tnum text-muted">{v?.otwo || "—"}</td>
                      <td className={`px-2 py-2 text-right tnum ${v?.quarantine ? "text-warn font-medium" : "text-muted"}`}>{v?.quarantine || "—"}</td>
                      {product.track_serial ? <td className="px-3 py-2 text-right tnum">{snIn}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-muted">ยังไม่มีสต๊อกในสาขาที่คุณเห็น</p>}
        </section>

        {/* SN รายชิ้น */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted mr-auto">SN รายชิ้น {units ? `(${units.length})` : ""}</h4>
            <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className={`h-8 px-2 rounded-lg border text-xs outline-none ${fBranch !== "all" ? "border-brand/40 bg-brand/5" : "border-line bg-surface2/70 text-muted"}`}>
              <option value="all">ทุกสาขา</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นเลข SN / IMEI" className="h-8 w-40 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none tnum" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "in_stock", "in_transit", "reserved", "quarantined", "returned", "sold", "defective", "scrapped", "unknown"] as const)
              .filter((k) => k === "all" || counts[k])
              .map((k) => (
                <button key={k} onClick={() => setFStatus(k)} className={`h-7 px-2.5 rounded-full text-[11px] inline-flex items-center gap-1.5 ${fStatus === k ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>
                  {k === "all" ? "ทั้งหมด" : STATUS[k].label}<span className="tnum opacity-70">{counts[k] ?? 0}</span>
                </button>
              ))}
          </div>

          {!units ? (
            <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-12 rounded-xl bg-surface2/60 animate-pulse" />)}</div>
          ) : !units.length ? (
            <div className="rounded-xl border border-dashed border-line py-10 text-center">
              <ScanLine size={22} className="mx-auto text-muted/40" />
              <p className="text-xs text-muted mt-2">{product.track_serial ? "ยังไม่มี SN ของสินค้านี้ในเอกสารหรือทะเบียนกลาง" : "สินค้านี้ไม่ได้ติดตาม SN รายชิ้น"}</p>
              {regNote ? <p className="text-[10px] text-muted mt-1">{regNote}</p> : null}
            </div>
          ) : (
            <ul className="rounded-xl border border-line/70 divide-y divide-line/50 overflow-hidden">
              {shown.slice(0, 500).map((u) => {
                const st = STATUS[u.status]; const Icon = st.icon; const expanded = openSn === u.sn;
                const where = u.status === "in_transit" ? "ระหว่างขนส่ง" : u.status === "sold" ? `ขายที่ ${branchLabel(u.soldInfo?.branchId ?? u.branchId)}` : branchLabel(u.branchId);
                return (
                  <li key={u.sn}>
                    <button onClick={() => setOpenSn(expanded ? null : u.sn)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface2/40">
                      <span className={`h-7 w-7 rounded-lg grid place-items-center shrink-0 ${st.cls}`}><Icon size={14} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono font-medium truncate">{u.sn}</p>
                        <p className="text-[11px] text-muted truncate">{where}{u.lastRef ? ` · ${u.lastRef}` : ""}{u.soldInfo?.customerName ? ` · ${u.soldInfo.customerName}` : ""}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
                      <span className="text-[10px] text-muted w-24 text-right hidden sm:block">{dt(u.lastAt)}</span>
                      <ChevronDown size={14} className={`text-muted transition ${expanded ? "rotate-180" : ""}`} />
                    </button>
                    {expanded ? (
                      <div className="px-4 pb-3 pt-1 bg-surface2/30">
                        {u.registry ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted mb-2">
                            <span>ทะเบียนกลาง: <b className="text-ink">{STATUS[fromRegistry(u.registry.status)].label}</b></span>
                            {u.registry.imei ? <span>IMEI <b className="text-ink font-mono">{u.registry.imei}</b></span> : null}
                            {u.registry.received_at ? <span>รับเข้า {dt(u.registry.received_at)}</span> : null}
                            {u.registry.warranty_end ? <span>ประกันถึง {new Date(u.registry.warranty_end).toLocaleDateString("th-TH")}</span> : null}
                            {u.registry.note ? <span>หมายเหตุ: {u.registry.note}</span> : null}
                          </div>
                        ) : null}
                        {u.events.length ? (
                          <ol className="relative border-l border-line ml-1.5 space-y-2.5">
                            {u.events.map((e, i) => (
                              <li key={i} className="pl-4 relative">
                                <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${i === u.events.length - 1 ? "bg-brand" : "bg-line"}`} />
                                <p className="text-xs"><b>{EVENT[e.kind]}</b> · {branchLabel(e.branchId)}</p>
                                <p className="text-[10px] text-muted">{dt(e.at)} · {e.refNo}{e.detail ? ` · ${e.detail}` : ""}{e.actor ? ` · โดย ${people.get(e.actor) ?? "พนักงาน"}` : ""}</p>
                              </li>
                            ))}
                          </ol>
                        ) : <p className="text-[11px] text-muted">ยังไม่มีเอกสารเคลื่อนไหวของ SN นี้ในระบบ POS (ข้อมูลจากทะเบียนกลางเท่านั้น)</p>}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {!shown.length ? <li className="py-8 text-center text-xs text-muted">ไม่พบ SN ตามตัวกรอง</li> : null}
            </ul>
          )}
          <p className="text-[10px] text-muted">ที่มา: เอกสารโอน/ส่งคืน/ขายในระบบ POS + ทะเบียน SN กลาง · ตามรอย SN แบบละเอียดได้ที่หน้า "ตามรอย SN"</p>
        </section>
      </div>
    </Drawer>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div><p className="text-[10px] text-muted">{label}</p><p className={`text-xl font-semibold tnum ${tone ?? ""}`}>{value.toLocaleString("th-TH")}</p></div>;
}
