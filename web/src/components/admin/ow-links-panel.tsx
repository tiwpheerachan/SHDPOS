"use client";
// ผูกสาขา POS ↔ OneWarehouse: คลัง (ใช้กับใบโอน — ทั้งต้นทาง/ปลายทางผูกแล้ว = OW เป็นตัวจริง) + สาขาขาย (ใช้ส่งบิลขาย)
import { useEffect, useMemo, useState } from "react";
import { Search, Link2, Save, RefreshCw } from "lucide-react";
import { Button, Badge, Drawer } from "@/components/ui";

type B = { id: string; code: string; name: string; name_th: string | null; branch_type: string; is_active: boolean };
export function OwLinksPanel({ warehouses }: { warehouses: { warehouse_id: string; name_en?: string; name_th?: string | null }[] }) {
  const [branches, setBranches] = useState<B[]>([]);
  const [wl, setWl] = useState<Record<string, string>>({}), [sl, setSl] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, { wh: string; sale: string }>>({});
  const [q, setQ] = useState(""), [onlyLinked, setOnlyLinked] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(""), [saved, setSaved] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/admin/ow-outbox", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error);
      setBranches(j.branches); setWl(Object.fromEntries(j.warehouse_links.map((x: { branch_id: string; warehouse_id: string }) => [x.branch_id, x.warehouse_id])));
      setSl(Object.fromEntries(j.sale_links.map((x: { branch_id: string; ow_branch_id: string }) => [x.branch_id, x.ow_branch_id]))); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "อ่านการผูกไม่สำเร็จ"); }
  }
  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => branches.filter((b) => (!q || `${b.code} ${b.name} ${b.name_th ?? ""}`.toLowerCase().includes(q.toLowerCase())) && (!onlyLinked || wl[b.id] || sl[b.id])), [branches, q, onlyLinked, wl, sl]);
  const val = (b: B) => draft[b.id] ?? { wh: wl[b.id] ?? "", sale: sl[b.id] ?? "" };
  async function save(b: B) {
    const v = val(b); setBusy(b.id); setError(""); setSaved("");
    try {
      const r = await fetch("/api/admin/ow-outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "link", branch_id: b.id, warehouse_id: v.wh, ow_branch_id: v.sale }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      setDraft((d) => { const n = { ...d }; delete n[b.id]; return n; }); await load(); setSaved(b.name_th || b.name);
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); } finally { setBusy(null); }
  }
  // ปรับยอดสต๊อก/SN ให้ตรง OW
  type Report = { stock: { sku: string; ow_qty: number; pending_sales: number; target: number; delta: number | null; settling?: boolean }[]; not_in_ow: number; serials: { checked: number; updated: number; unknown: string[]; other_warehouse: string[]; skipped: string[] } };
  const [rc, setRc] = useState<B | null>(null), [rcSn, setRcSn] = useState(""), [rcBusy, setRcBusy] = useState(false), [rcErr, setRcErr] = useState(""), [rcRep, setRcRep] = useState<Report | null>(null);
  async function reconcile() {
    if (!rc) return;
    setRcBusy(true); setRcErr(""); setRcRep(null);
    try {
      const r = await fetch("/api/admin/ow-outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile", branch_id: rc.id, serials: rcSn.split(/[\s,]+/).filter(Boolean) }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setRcRep(j);
    } catch (e) { setRcErr(e instanceof Error ? e.message : "ปรับยอดไม่สำเร็จ"); } finally { setRcBusy(false); }
  }
  const whName = (id: string) => { const w = warehouses.find((x) => x.warehouse_id === id); return w ? `${id} · ${w.name_th || w.name_en || ""}` : id; };

  return (
    <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
      <div className="p-3 border-b border-line flex flex-wrap items-center gap-2">
        <Link2 size={15} className="text-brand" />
        <p className="text-sm font-semibold mr-2">ผูกสาขากับ OneWarehouse</p>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นสาขา" className="h-8 w-48 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none" />
        </div>
        <label className="text-[11px] text-muted inline-flex items-center gap-1.5"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} />เฉพาะที่ผูกแล้ว</label>
        <span className="text-[11px] text-muted ml-auto">ใบโอนวิ่งผ่าน OW เมื่อ <b>ทั้งต้นทางและปลายทาง</b> ผูกคลังแล้ว · บิลขายส่ง OW เมื่อผูกสาขาขาย</span>
      </div>
      {error ? <p role="alert" className="px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}
      {saved ? <p className="px-4 py-2 text-xs text-ok bg-ok/5">บันทึกการผูก {saved} แล้ว</p> : null}
      <div className="max-h-[calc(100vh-300px)] overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface2 text-muted sticky top-0"><tr>
            {["สาขา POS", "คลัง OW (ใบโอน)", "สาขาขาย OW (บิลขาย)", ""].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((b) => {
              const v = val(b), dirty = v.wh !== (wl[b.id] ?? "") || v.sale !== (sl[b.id] ?? "");
              return (
                <tr key={b.id} className={dirty ? "bg-brand/[0.04]" : ""}>
                  <td className="px-3 py-2"><p className="font-medium">{b.name_th || b.name}</p><p className="text-[10px] text-muted font-mono">{b.code}{!b.is_active ? " · ปิดใช้" : ""}</p></td>
                  <td className="px-3 py-2">
                    <select value={v.wh} onChange={(e) => setDraft((d) => ({ ...d, [b.id]: { ...v, wh: e.target.value } }))} className="h-8 px-2 rounded-lg border border-line bg-surface2/70 text-xs max-w-[220px]">
                      <option value="">— ไม่ผูก (ใช้แบบเดิม) —</option>
                      {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{whName(w.warehouse_id)}</option>)}
                      {v.wh && !warehouses.some((w) => w.warehouse_id === v.wh) ? <option value={v.wh}>{v.wh}</option> : null}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input value={v.sale} onChange={(e) => setDraft((d) => ({ ...d, [b.id]: { ...v, sale: e.target.value } }))} placeholder="เช่น UAT-TEST" className="h-8 w-40 px-2 rounded-lg border border-line bg-surface2/70 text-xs font-mono" />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {wl[b.id] && sl[b.id] ? <Badge tone="ok">ผูกครบ</Badge> : wl[b.id] || sl[b.id] ? <Badge tone="warn">ผูกบางส่วน</Badge> : null}
                    {wl[b.id] && !dirty ? <Button variant="ghost" className="ml-2" onClick={() => { setRc(b); setRcSn(""); setRcRep(null); setRcErr(""); }}><RefreshCw size={13} />ปรับยอดจาก OW</Button> : null}
                    {dirty ? <Button variant="primary" className="ml-2" loading={busy === b.id} onClick={() => void save(b)}><Save size={13} />บันทึก</Button> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Drawer open={!!rc} onClose={() => setRc(null)} title={rc ? `ปรับยอดจาก OneWarehouse · ${rc.name_th || rc.name}` : ""} subtitle={rc ? `คลัง ${whName(wl[rc.id] ?? "")} — ตั้งยอดในระบบ POS ให้ตรง OW (OW เป็นตัวจริง)` : ""}
        footer={<><span className="flex-1" /><Button variant="ghost" onClick={() => setRc(null)}>ปิด</Button><Button variant="primary" loading={rcBusy} onClick={() => void reconcile()}><RefreshCw size={14} />{rcRep ? "ปรับอีกรอบ" : "ปรับยอดตอนนี้"}</Button></>}>
        <div className="p-5 space-y-4 text-xs">
          <div className="rounded-xl bg-surface2/70 p-3 space-y-1 text-muted">
            <p>• ยอดคงคลัง = ยอด OW − บิลที่ขายใน POS แล้วแต่ JST ยังไม่ยืนยัน (กันขายซ้ำ)</p>
            <p>• SKU ที่ไม่มีใน OW จะไม่ถูกแตะ · ยอดพักตรวจไม่เปลี่ยน</p>
            <p>• สินค้าที่เพิ่งโอน/รับภายใน 10 นาที จะข้ามไว้ก่อน (ยอด JST อัปเดตช้ากว่าใบโอน) — กดปรับอีกครั้งภายหลัง</p>
            <p>• SN: OW ไม่มีรายการ SN ทั้งหมด ระบบจะตรวจ SN ที่ POS รู้จักของสาขานี้ + SN ที่ใส่ด้านล่าง</p>
          </div>
          <label className="block">
            <span className="text-muted">SN ที่ต้องการตรวจเพิ่ม (ไม่บังคับ · คั่นด้วยบรรทัด/คอมมา)</span>
            <textarea value={rcSn} onChange={(e) => setRcSn(e.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-surface2/70 p-2.5 font-mono min-h-[80px]" />
          </label>
          {rcErr ? <p role="alert" className="text-danger bg-danger/5 rounded-lg p-2.5">{rcErr}</p> : null}
          {rcRep ? (
            <div className="space-y-3">
              <table className="w-full">
                <thead className="text-muted"><tr>{["SKU", "OW", "รอ JST", "ตั้งเป็น", "ปรับ"].map((h) => <th key={h} className="text-left font-medium py-1">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line/60">
                  {rcRep.stock.map((r) => <tr key={r.sku}><td className="py-1 font-mono">{r.sku}</td><td className="tnum">{r.ow_qty}</td><td className="tnum">{r.pending_sales || "—"}</td><td className="tnum font-medium">{r.target}</td><td className={`tnum ${r.delta ? (r.delta > 0 ? "text-ok" : "text-danger") : "text-muted"}`}>{r.settling ? "รอ JST อัปเดต" : r.delta == null ? "ซ้ำ" : r.delta > 0 ? `+${r.delta}` : r.delta}</td></tr>)}
                </tbody>
              </table>
              {!rcRep.stock.length ? <p className="text-muted">ไม่มี SKU ของ POS อยู่ในคลังนี้ของ OW</p> : null}
              <p className="text-muted">SKU ที่ OW ไม่มี: {rcRep.not_in_ow} · SN ตรวจ {rcRep.serials.checked} · อัปเดต {rcRep.serials.updated}</p>
              {rcRep.serials.unknown.length ? <p className="text-warn">OW ไม่รู้จัก SN: {rcRep.serials.unknown.join(", ")}</p> : null}
              {rcRep.serials.other_warehouse.length ? <p className="text-warn">อยู่คลังที่ไม่ผูกสาขา: {rcRep.serials.other_warehouse.join(", ")}</p> : null}
              {rcRep.serials.skipped.length ? <p className="text-danger">ข้าม (อ่าน/บันทึกไม่ได้): {rcRep.serials.skipped.join(", ")}</p> : null}
            </div>
          ) : null}
        </div>
      </Drawer>
    </section>
  );
}
