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
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

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
  in_stock: { get label() { return tr("อยู่ในสต๊อก", "In stock", "在库"); }, cls: "bg-ok/12 text-ok", icon: Boxes },
  reserved: { get label() { return tr("จองแล้ว", "Reserved", "已预留"); }, cls: "bg-violet-500/12 text-violet-600", icon: Lock },
  in_transit: { get label() { return tr("ระหว่างขนส่ง", "In transit", "在途"); }, cls: "bg-sky-500/12 text-sky-600", icon: Truck },
  sold: { get label() { return tr("ขายแล้ว", "Sold", "已售"); }, cls: "bg-brand/10 text-brand", icon: ShoppingBag },
  returned: { get label() { return tr("รับคืนแล้ว", "Returned", "已退回"); }, cls: "bg-teal-500/12 text-teal-600", icon: RotateCcw },
  quarantined: { get label() { return tr("พักตรวจ", "Quarantined", "待检"); }, cls: "bg-warn/15 text-warn", icon: ShieldAlert },
  defective: { get label() { return tr("ชำรุด", "Defective", "损坏"); }, cls: "bg-danger/12 text-danger", icon: AlertTriangle },
  scrapped: { get label() { return tr("ตัดจำหน่าย", "Written off", "已报废"); }, cls: "bg-surface2 text-muted", icon: Ban },
  unknown: { get label() { return tr("ไม่ทราบ", "Unknown", "未知"); }, cls: "bg-surface2 text-muted", icon: HelpCircle },
};
const EVENT = (): Record<SerialEventKind, string> => ({
  received: tr("รับเข้าสาขา", "Received at branch", "门店入库"), shipped: tr("ส่งออก (โอน)", "Shipped (transfer)", "发出（调拨）"), sold: tr("ขาย", "Sold", "销售"), returned: tr("ส่งคืน/ส่งซ่อม", "Returned / sent for repair", "退回/送修"),
  quarantined: tr("เข้าพักตรวจ", "Quarantined", "进入待检"), return_in: tr("ต้นทางรับคืน", "Return received at source", "源头已收回"), flagged: tr("เปิดเคสผลต่าง", "Discrepancy case opened", "开立差异单"),
});
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
  const L = useL();

  const bName = useMemo(() => new Map(branches.map((b) => [b.id, b.name_th ?? b.name])), [branches]);
  const branchLabel = (id: string | null) => (id ? bName.get(id) ?? L("สาขาอื่น (นอกสิทธิ์)", "Other branch (no access)", "其他门店（无权限）") : "—");

  useEffect(() => {
    if (!open || !product) return;
    let alive = true;
    setUnits(null); setRegNote(""); setFStatus("all"); setFBranch("all"); setQ(""); setOpenSn(null);
    void listEmployees().then((es) => alive && setPeople(new Map(es.map((e) => [e.id, e.nickname || e.first_name])))).catch(() => {});
    void (async () => {
      const [docs, reg] = await Promise.all([
        serialsForProduct(product.id).catch(() => [] as SerialInfo[]),
        fetch(`/api/admin/serials?product_id=${product.id}`, { cache: "no-store" })
          .then(async (r) => (r.ok ? ((await r.json()).serials as RegistryRow[]) : (setRegNote(r.status === 403 ? tr("ไม่มีสิทธิ์อ่านทะเบียน SN กลาง", "No permission to read the central SN registry", "无权读取中央序列号登记") : r.status === 401 ? tr("ทะเบียน SN กลางต้องล็อกอิน SSO", "Central SN registry requires SSO login", "中央序列号登记需 SSO 登录") : ""), [])))
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
    <Drawer open={open} onClose={onClose} width="xl" title={L("รายละเอียดสต๊อก", "Stock details", "库存详情")} subtitle={`${product.sku}${brandName ? ` · ${brandName}` : ""}`}>
      <div className="p-5 space-y-6">
        {/* หัวสินค้า */}
        <div className="flex items-center gap-4">
          <div className="h-32 w-32 rounded-2xl bg-surface2/70 grid place-items-center overflow-hidden shrink-0">
            {product.image_url ? <img src={product.image_url} alt={product.name_th} className="h-full w-full object-contain p-2" /> : <Package size={34} className="text-muted/40" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-snug" translate="no">{product.name_th}</p>
            <p className="text-xs text-muted tnum mt-1" translate="no">{product.sku}{brandName ? ` · ${brandName}` : ""}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
              <span className="text-muted">{L("ราคา", "Price", "价格")} <b className="text-ink tnum">{formatTHB(product.price)}</b></span>
              {showCost ? <span className="text-muted">{L("ทุน", "Cost", "成本")} <b className="text-ink tnum">{formatTHB(product.cost)}</b></span> : null}
              <span className="text-muted inline-flex items-center gap-1"><ScanLine size={12} />{product.track_serial ? L("ติดตาม SN รายชิ้น", "Per-unit SN tracking", "按件追踪序列号") : L("ไม่ใช้ SN", "No SN", "不使用序列号")}</span>
            </div>
            <div className="flex gap-6 mt-3">
              <Stat label={L("มีอยู่รวม", "Total on hand", "在库合计")} value={totals.onHand} />
              <Stat label={L("พร้อมขายรวม", "Total available", "可售合计")} value={totals.avail} tone={totals.avail > 0 ? "text-ok" : "text-danger"} />
              {product.track_serial ? <Stat label={L("SN ในสาขา", "SN at branches", "门店序列号")} value={totals.snIn} tone={totals.snIn !== totals.onHand ? "text-warn" : undefined} /> : null}
            </div>
          </div>
        </div>
        {product.track_serial && units && totals.snIn !== totals.onHand ? (
          <p className="text-xs rounded-xl bg-warn/10 text-warn px-3 py-2 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {L(`จำนวน SN ที่ระบบรู้ตำแหน่ง (${totals.snIn}) ไม่เท่ากับยอดสต๊อก (${totals.onHand}) — SN ที่รับเข้าก่อนเปิดระบบ/จากการนับเปิดระบบ ยังไม่มีในเอกสาร ควรสแกนเข้าทะเบียน`, `SNs with a known location (${totals.snIn}) don't match stock (${totals.onHand}) — SNs received before go-live / from the opening count aren't in any document yet; scan them into the registry`, `已知位置的序列号数（${totals.snIn}）与库存（${totals.onHand}）不一致 — 上线前入库/期初盘点的序列号尚未在单据中，请扫描登记`)}
          </p>
        ) : null}

        {/* สต๊อกแยกสาขา */}
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">{L("สต๊อกแยกสาขา", "Stock by branch", "按门店库存")}</h4>
          {perBranch.length ? (
            <div className="rounded-xl border border-line/70 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="text-muted bg-surface2/50 text-left">
                  <th className="px-3 py-2 font-medium">{L("สาขา", "Branch", "门店")}</th><th className="px-2 py-2 font-medium text-right">{L("มีอยู่", "On hand", "在库")}</th><th className="px-2 py-2 font-medium text-right">{L("พร้อมขาย", "Available", "可售")}</th>
                  <th className="px-2 py-2 font-medium text-right">{L("จอง", "Reserved", "预留")}</th><th className="px-2 py-2 font-medium text-right">{L("ระหว่างทาง", "In transit", "在途")}</th><th className="px-2 py-2 font-medium text-right">{L("พักตรวจ", "Quarantine", "待检")}</th>
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
          ) : <p className="text-xs text-muted">{L("ยังไม่มีสต๊อกในสาขาที่คุณเห็น", "No stock in branches you can see", "您可见的门店暂无库存")}</p>}
        </section>

        {/* SN รายชิ้น */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted mr-auto">{L("SN รายชิ้น", "Units by SN", "按件序列号")} {units ? `(${units.length})` : ""}</h4>
            <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className={`h-8 px-2 rounded-lg border text-xs outline-none ${fBranch !== "all" ? "border-brand/40 bg-brand/5" : "border-line bg-surface2/70 text-muted"}`}>
              <option value="all">{L("ทุกสาขา", "All branches", "全部门店")}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นเลข SN / IMEI", "Search SN / IMEI", "搜索序列号 / IMEI")} className="h-8 w-40 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none tnum" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "in_stock", "in_transit", "reserved", "quarantined", "returned", "sold", "defective", "scrapped", "unknown"] as const)
              .filter((k) => k === "all" || counts[k])
              .map((k) => (
                <button key={k} onClick={() => setFStatus(k)} className={`h-7 px-2.5 rounded-full text-[11px] inline-flex items-center gap-1.5 ${fStatus === k ? "bg-brand text-brandInk" : "bg-surface2/80 text-muted hover:text-ink"}`}>
                  {k === "all" ? L("ทั้งหมด", "All", "全部") : STATUS[k].label}<span className="tnum opacity-70">{counts[k] ?? 0}</span>
                </button>
              ))}
          </div>

          {!units ? (
            <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-12 rounded-xl bg-surface2/60 animate-pulse" />)}</div>
          ) : !units.length ? (
            <div className="rounded-xl border border-dashed border-line py-10 text-center">
              <ScanLine size={22} className="mx-auto text-muted/40" />
              <p className="text-xs text-muted mt-2">{product.track_serial ? L("ยังไม่มี SN ของสินค้านี้ในเอกสารหรือทะเบียนกลาง", "No SNs for this product in documents or the central registry yet", "单据或中央登记中暂无该商品的序列号") : L("สินค้านี้ไม่ได้ติดตาม SN รายชิ้น", "This product isn't tracked by SN", "该商品未按件追踪序列号")}</p>
              {regNote ? <p className="text-[10px] text-muted mt-1">{regNote}</p> : null}
            </div>
          ) : (
            <ul className="rounded-xl border border-line/70 divide-y divide-line/50 overflow-hidden">
              {shown.slice(0, 500).map((u) => {
                const st = STATUS[u.status]; const Icon = st.icon; const expanded = openSn === u.sn;
                const where = u.status === "in_transit" ? L("ระหว่างขนส่ง", "In transit", "在途") : u.status === "sold" ? L(`ขายที่ ${branchLabel(u.soldInfo?.branchId ?? u.branchId)}`, `Sold at ${branchLabel(u.soldInfo?.branchId ?? u.branchId)}`, `售于 ${branchLabel(u.soldInfo?.branchId ?? u.branchId)}`) : branchLabel(u.branchId);
                return (
                  <li key={u.sn}>
                    <button onClick={() => setOpenSn(expanded ? null : u.sn)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface2/40">
                      <span className={`h-7 w-7 rounded-lg grid place-items-center shrink-0 ${st.cls}`}><Icon size={14} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono font-medium truncate" translate="no">{u.sn}</p>
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
                            <span>{L("ทะเบียนกลาง", "Central registry", "中央登记")}: <b className="text-ink">{STATUS[fromRegistry(u.registry.status)].label}</b></span>
                            {u.registry.imei ? <span>IMEI <b className="text-ink font-mono" translate="no">{u.registry.imei}</b></span> : null}
                            {u.registry.received_at ? <span>{L("รับเข้า", "Received", "入库")} {dt(u.registry.received_at)}</span> : null}
                            {u.registry.warranty_end ? <span>{L("ประกันถึง", "Warranty until", "保修至")} {new Date(u.registry.warranty_end).toLocaleDateString("th-TH")}</span> : null}
                            {u.registry.note ? <span>{L("หมายเหตุ", "Note", "备注")}: {u.registry.note}</span> : null}
                          </div>
                        ) : null}
                        {u.events.length ? (
                          <ol className="relative border-l border-line ml-1.5 space-y-2.5">
                            {u.events.map((e, i) => (
                              <li key={i} className="pl-4 relative">
                                <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${i === u.events.length - 1 ? "bg-brand" : "bg-line"}`} />
                                <p className="text-xs"><b>{EVENT()[e.kind]}</b> · {branchLabel(e.branchId)}</p>
                                <p className="text-[10px] text-muted">{dt(e.at)} · {e.refNo}{e.detail ? ` · ${e.detail}` : ""}{e.actor ? ` · ${L("โดย", "by", "由")} ${people.get(e.actor) ?? L("พนักงาน", "Staff", "员工")}` : ""}</p>
                              </li>
                            ))}
                          </ol>
                        ) : <p className="text-[11px] text-muted">{L("ยังไม่มีเอกสารเคลื่อนไหวของ SN นี้ในระบบ POS (ข้อมูลจากทะเบียนกลางเท่านั้น)", "No POS movement documents for this SN yet (central registry data only)", "POS 中暂无该序列号的流转单据（仅中央登记数据）")}</p>}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {!shown.length ? <li className="py-8 text-center text-xs text-muted">{L("ไม่พบ SN ตามตัวกรอง", "No SNs match the filters", "没有符合筛选的序列号")}</li> : null}
            </ul>
          )}
          <p className="text-[10px] text-muted">{L('ที่มา: เอกสารโอน/ส่งคืน/ขายในระบบ POS + ทะเบียน SN กลาง · ตามรอย SN แบบละเอียดได้ที่หน้า "ตามรอย SN"', 'Source: POS transfer/return/sale documents + central SN registry · full trace on the "SN trace" page', '来源：POS 调拨/退回/销售单据 + 中央序列号登记 · 详细追踪请见“序列号追踪”页')}</p>
        </section>
      </div>
    </Drawer>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div><p className="text-[10px] text-muted">{label}</p><p className={`text-xl font-semibold tnum ${tone ?? ""}`}>{value.toLocaleString("th-TH")}</p></div>;
}
