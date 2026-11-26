"use client";
// ผูกสาขา POS ↔ OneWarehouse: คลัง (ใช้กับใบโอน — ทั้งต้นทาง/ปลายทางผูกแล้ว = OW เป็นตัวจริง) + สาขาขาย (ใช้ส่งบิลขาย)
import { useEffect, useMemo, useState } from "react";
import { Search, Link2, Save, RefreshCw } from "lucide-react";
import { Button, Badge, Drawer } from "@/components/ui";
import { useL } from "@/lib/i18n/provider";

type B = { id: string; code: string; name: string; name_th: string | null; branch_type: string; is_active: boolean };
export function OwLinksPanel({ warehouses }: { warehouses: { warehouse_id: string; name_en?: string; name_th?: string | null }[] }) {
  const L = useL();
  const [branches, setBranches] = useState<B[]>([]);
  const [wl, setWl] = useState<Record<string, string>>({}), [sl, setSl] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, { wh: string; sale: string }>>({});
  const [q, setQ] = useState(""), [onlyLinked, setOnlyLinked] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(""), [saved, setSaved] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/admin/ow-outbox", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error);
      setBranches(j.branches); setWl(Object.fromEntries(j.warehouse_links.map((x: { branch_id: string; warehouse_id: string }) => [x.branch_id, x.warehouse_id])));
      setSl(Object.fromEntries(j.sale_links.map((x: { branch_id: string; ow_branch_id: string }) => [x.branch_id, x.ow_branch_id]))); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : L("อ่านการผูกไม่สำเร็จ", "Couldn't load links", "读取绑定失败")); }
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
    } catch (e) { setError(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败")); } finally { setBusy(null); }
  }
  // ปรับยอดสต๊อก/SN ให้ตรง OW
  type Report = { stock: { sku: string; ow_qty: number; pending_sales: number; target: number; delta: number | null; settling?: boolean }[]; not_in_ow: number; serials: { checked: number; updated: number; unknown: string[]; other_warehouse: string[]; skipped: string[]; held_sold?: string[] } };
  const [rc, setRc] = useState<B | null>(null), [rcSn, setRcSn] = useState(""), [rcBusy, setRcBusy] = useState(false), [rcErr, setRcErr] = useState(""), [rcRep, setRcRep] = useState<Report | null>(null);
  async function reconcile() {
    if (!rc) return;
    setRcBusy(true); setRcErr(""); setRcRep(null);
    try {
      const r = await fetch("/api/admin/ow-outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile", branch_id: rc.id, serials: rcSn.split(/[\s,]+/).filter(Boolean) }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error); setRcRep(j);
    } catch (e) { setRcErr(e instanceof Error ? e.message : L("ปรับยอดไม่สำเร็จ", "Reconcile failed", "调整库存失败")); } finally { setRcBusy(false); }
  }
  const whName = (id: string) => { const w = warehouses.find((x) => x.warehouse_id === id); return w ? `${id} · ${w.name_th || w.name_en || ""}` : id; };

  return (
    <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
      <div className="p-3 border-b border-line flex flex-wrap items-center gap-2">
        <Link2 size={15} className="text-brand" />
        <p className="text-sm font-semibold mr-2">{L("ผูกสาขากับ OneWarehouse", "Link branches to OneWarehouse", "门店绑定 OneWarehouse")}</p>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นสาขา", "Search branch", "搜索门店")} className="h-8 w-48 pl-8 pr-2 rounded-lg bg-surface2/70 border border-line text-xs outline-none" />
        </div>
        <label className="text-[11px] text-muted inline-flex items-center gap-1.5"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} />{L("เฉพาะที่ผูกแล้ว", "Linked only", "仅已绑定")}</label>
        <span className="text-[11px] text-muted ml-auto">{L("ใบโอนวิ่งผ่าน OW เมื่อ", "Transfers run through OW when", "当")} <b>{L("ทั้งต้นทางและปลายทาง", "both source and destination", "调出方和调入方")}</b> {L("ผูกคลังแล้ว · บิลขายส่ง OW เมื่อผูกสาขาขาย", "have linked warehouses · sales bills go to OW once a sales branch is linked", "均已绑定仓库时，调拨单经 OW 处理 · 绑定销售门店后销售单发送至 OW")}</span>
      </div>
      {error ? <p role="alert" className="px-4 py-2 text-xs text-danger bg-danger/5">{error}</p> : null}
      {saved ? <p className="px-4 py-2 text-xs text-ok bg-ok/5">{L(`บันทึกการผูก ${saved} แล้ว`, `Saved link for ${saved}`, `已保存 ${saved} 的绑定`)}</p> : null}
      <div className="max-h-[calc(100vh-300px)] overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface2 text-muted sticky top-0"><tr>
            {[L("สาขา POS", "POS branch", "POS 门店"), L("คลัง OW (ใบโอน)", "OW warehouse (transfers)", "OW 仓库（调拨）"), L("สาขาขาย OW (บิลขาย)", "OW sales branch (bills)", "OW 销售门店（销售单）"), ""].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((b) => {
              const v = val(b), dirty = v.wh !== (wl[b.id] ?? "") || v.sale !== (sl[b.id] ?? "");
              return (
                <tr key={b.id} className={dirty ? "bg-brand/[0.04]" : ""}>
                  <td className="px-3 py-2"><p className="font-medium">{b.name_th || b.name}</p><p className="text-[10px] text-muted font-mono">{b.code}{!b.is_active ? ` · ${L("ปิดใช้", "Inactive", "已停用")}` : ""}</p></td>
                  <td className="px-3 py-2">
                    <select value={v.wh} onChange={(e) => setDraft((d) => ({ ...d, [b.id]: { ...v, wh: e.target.value } }))} className="h-8 px-2 rounded-lg border border-line bg-surface2/70 text-xs max-w-[220px]">
                      <option value="">{L("— ไม่ผูก (ใช้แบบเดิม) —", "— Not linked (legacy mode) —", "— 不绑定（沿用原方式）—")}</option>
                      {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{whName(w.warehouse_id)}</option>)}
                      {v.wh && !warehouses.some((w) => w.warehouse_id === v.wh) ? <option value={v.wh}>{v.wh}</option> : null}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input value={v.sale} onChange={(e) => setDraft((d) => ({ ...d, [b.id]: { ...v, sale: e.target.value } }))} placeholder={L("เช่น UAT-TEST", "e.g. UAT-TEST", "例如 UAT-TEST")} className="h-8 w-40 px-2 rounded-lg border border-line bg-surface2/70 text-xs font-mono" />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {wl[b.id] && sl[b.id] ? <Badge tone="ok">{L("ผูกครบ", "Fully linked", "已完全绑定")}</Badge> : wl[b.id] || sl[b.id] ? <Badge tone="warn">{L("ผูกบางส่วน", "Partly linked", "部分绑定")}</Badge> : null}
                    {wl[b.id] && !dirty ? <Button variant="ghost" className="ml-2" onClick={() => { setRc(b); setRcSn(""); setRcRep(null); setRcErr(""); }}><RefreshCw size={13} />{L("ปรับยอดจาก OW", "Reconcile from OW", "按 OW 调整库存")}</Button> : null}
                    {dirty ? <Button variant="primary" className="ml-2" loading={busy === b.id} onClick={() => void save(b)}><Save size={13} />{L("บันทึก", "Save", "保存")}</Button> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Drawer open={!!rc} onClose={() => setRc(null)} title={rc ? `${L("ปรับยอดจาก OneWarehouse", "Reconcile from OneWarehouse", "按 OneWarehouse 调整库存")} · ${rc.name_th || rc.name}` : ""} subtitle={rc ? L(`คลัง ${whName(wl[rc.id] ?? "")} — ตั้งยอดในระบบ POS ให้ตรง OW (OW เป็นตัวจริง)`, `Warehouse ${whName(wl[rc.id] ?? "")} — set POS stock to match OW (OW is the source of truth)`, `仓库 ${whName(wl[rc.id] ?? "")} — 将 POS 库存调整为与 OW 一致（以 OW 为准）`) : ""}
        footer={<><span className="flex-1" /><Button variant="ghost" onClick={() => setRc(null)}>{L("ปิด", "Close", "关闭")}</Button><Button variant="primary" loading={rcBusy} onClick={() => void reconcile()}><RefreshCw size={14} />{rcRep ? L("ปรับอีกรอบ", "Reconcile again", "再次调整") : L("ปรับยอดตอนนี้", "Reconcile now", "立即调整")}</Button></>}>
        <div className="p-5 space-y-4 text-xs">
          <div className="rounded-xl bg-surface2/70 p-3 space-y-1 text-muted">
            <p>• {L("ยอดคงคลัง = ยอด OW − บิลที่ขายใน POS แล้วแต่ JST ยังไม่ยืนยัน (กันขายซ้ำ)", "On hand = OW qty − POS sales not yet confirmed by JST (prevents double-selling)", "在库 = OW 数量 − POS 已售但 JST 尚未确认的单据（防止重复销售）")}</p>
            <p>• {L("SKU ที่ไม่มีใน OW จะไม่ถูกแตะ · ยอดพักตรวจไม่เปลี่ยน", "SKUs not in OW are left untouched · quarantine qty is unchanged", "OW 中没有的 SKU 不会变动 · 待检数量不变")}</p>
            <p>• {L("สินค้าที่เพิ่งโอน/รับภายใน 10 นาที จะข้ามไว้ก่อน (ยอด JST อัปเดตช้ากว่าใบโอน) — กดปรับอีกครั้งภายหลัง", "Items transferred/received in the last 10 minutes are skipped (JST updates lag behind transfers) — reconcile again later", "10 分钟内刚调拨/收货的商品暂时跳过（JST 数量更新晚于调拨单）— 请稍后再调整")}</p>
            <p>• {L("SN: OW ไม่มีรายการ SN ทั้งหมด ระบบจะตรวจ SN ที่ POS รู้จักของสาขานี้ + SN ที่ใส่ด้านล่าง", "SN: OW has no full SN list; the system checks SNs POS knows for this branch + SNs entered below", "SN：OW 无完整序列号列表，系统将核对 POS 已知的本门店序列号 + 下方填写的序列号")}</p>
          </div>
          <label className="block">
            <span className="text-muted">{L("SN ที่ต้องการตรวจเพิ่ม (ไม่บังคับ · คั่นด้วยบรรทัด/คอมมา)", "Extra SNs to check (optional · separate by line/comma)", "需额外核对的序列号（可选 · 以换行/逗号分隔）")}</span>
            <textarea value={rcSn} onChange={(e) => setRcSn(e.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-surface2/70 p-2.5 font-mono min-h-[80px]" />
          </label>
          {rcErr ? <p role="alert" className="text-danger bg-danger/5 rounded-lg p-2.5">{rcErr}</p> : null}
          {rcRep ? (
            <div className="space-y-3">
              <table className="w-full">
                <thead className="text-muted"><tr>{["SKU", "OW", L("รอ JST", "Pending JST", "待 JST"), L("ตั้งเป็น", "Set to", "设为"), L("ปรับ", "Change", "调整")].map((h) => <th key={h} className="text-left font-medium py-1">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line/60">
                  {rcRep.stock.map((r) => <tr key={r.sku}><td className="py-1 font-mono" translate="no">{r.sku}</td><td className="tnum">{r.ow_qty}</td><td className="tnum">{r.pending_sales || "—"}</td><td className="tnum font-medium">{r.target}</td><td className={`tnum ${r.delta ? (r.delta > 0 ? "text-ok" : "text-danger") : "text-muted"}`}>{r.settling ? L("รอ JST อัปเดต", "Awaiting JST update", "等待 JST 更新") : r.delta == null ? L("ซ้ำ", "Duplicate", "重复") : r.delta > 0 ? `+${r.delta}` : r.delta}</td></tr>)}
                </tbody>
              </table>
              {!rcRep.stock.length ? <p className="text-muted">{L("ไม่มี SKU ของ POS อยู่ในคลังนี้ของ OW", "No POS SKUs in this OW warehouse", "此 OW 仓库中没有 POS 的 SKU")}</p> : null}
              <p className="text-muted">{L("SKU ที่ OW ไม่มี", "SKUs missing in OW", "OW 中缺少的 SKU")}: {rcRep.not_in_ow} · {L("SN ตรวจ", "SNs checked", "已核对序列号")} {rcRep.serials.checked} · {L("อัปเดต", "Updated", "已更新")} {rcRep.serials.updated}</p>
              {rcRep.serials.unknown.length ? <p className="text-warn" translate="no">{L("OW ไม่รู้จัก SN", "SNs unknown to OW", "OW 未识别的序列号")}: {rcRep.serials.unknown.join(", ")}</p> : null}
              {rcRep.serials.other_warehouse.length ? <p className="text-warn" translate="no">{L("อยู่คลังที่ไม่ผูกสาขา", "In warehouses not linked to this branch", "位于未绑定本门店的仓库")}: {rcRep.serials.other_warehouse.join(", ")}</p> : null}
              {rcRep.serials.held_sold?.length ? <p className="text-warn" translate="no">{L('คงสถานะ "ขายแล้ว" (บิลยังไม่เข้า JST — ไม่รีเซ็ตกันขายซ้ำ)', 'Kept as "sold" (bill not yet in JST — not reset to prevent double-selling)', '保持“已售”（单据尚未进入 JST — 不重置以防重复销售）')}: {rcRep.serials.held_sold.join(", ")}</p> : null}
              {rcRep.serials.skipped.length ? <p className="text-danger" translate="no">{L("ข้าม (อ่าน/บันทึกไม่ได้)", "Skipped (couldn't read/save)", "已跳过（无法读取/保存）")}: {rcRep.serials.skipped.join(", ")}</p> : null}
            </div>
          ) : null}
        </div>
      </Drawer>
    </section>
  );
}
