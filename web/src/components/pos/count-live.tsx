"use client";
// ตรวจนับสต๊อก (โหมดจริง · /api/pos/count · 0072) — ตาม UAT F055–F063
//   เปิดรอบ (ขอบเขต/โหมด Freeze หรือ Cut-off/Blind/เกณฑ์นับซ้ำ/ผู้รับผิดชอบ) → นับ (ช่องว่าง ≠ 0 · SN สแกนทีละชิ้น · ข้ามต้องมีเหตุผล)
//   → ส่งตรวจ (เกินเกณฑ์ = นับซ้ำโดยอีกคน) → ตรวจทานผลต่าง+มูลค่า → อนุมัติปรับสต๊อกครั้งเดียว (ผู้อนุมัติ ≠ ผู้นับ) · ยกเลิกได้พร้อมเหตุผล
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Plus, ArrowLeft, Send, CheckCircle2, XCircle, Lock, Clock, ScanLine, SkipForward, Save, RefreshCw, FileDown, Search, AlertTriangle, EyeOff, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listProducts } from "@/lib/data/repo";
import type { Product } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, EmptyState, Badge, Modal, Field, Skeleton, Segmented } from "@/components/ui";
import { PosPage, TablePanel, StatChip } from "@/components/pos/page-shell";
import { can } from "@/lib/permissions";
import { downloadExcel } from "@/lib/export";

type Status = "counting" | "recount" | "review" | "approved" | "cancelled";
type Sess = {
  id: string; count_no: string; branch_id: string; scope_type: string; scope: Record<string, unknown>; zone: string | null; mode: "freeze" | "cutoff"; blind: boolean;
  thr_qty: number; thr_pct: number; thr_value: number; recount_other: boolean; status: Status; ow_linked: boolean; posted: boolean; assignees: string[]; note: string | null;
  created_by: string; created_at: string; submitted_by: string | null; submitted_at: string | null; approved_by: string | null; approved_at: string | null;
  cancelled_by: string | null; cancelled_at: string | null; cancel_reason: string | null; result: Record<string, number | boolean | string | null> | null;
};
type Line = {
  product_id: string; sku: string; name: string; track_serial: boolean; unit_cost: number; snapshot_qty: number | null; expected_sns: string[];
  count1: number | null; count1_sns: string[] | null; count1_by: string | null; count1_at: string | null; sys1: number | null;
  count2: number | null; count2_sns: string[] | null; count2_by: string | null; count2_at: string | null; sys2: number | null;
  skipped: boolean; skip_reason: string | null; needs_recount: boolean; final_qty: number | null; final_sys: number | null;
  variance: number | null; variance_value: number | null; posted_delta: number | null; missing_sns: string[] | null; extra_sns: string[] | null;
  sn_check: SnCheck[] | null;
};
type SnVerdict = "match" | "missing" | "sold" | "other_branch" | "wrong_product" | "not_sellable" | "unknown";
type SnCheck = { sn: string; verdict: SnVerdict; status?: string; ref?: string; other_sku?: string };
type ListRow = Pick<Sess, "id" | "count_no" | "scope_type" | "scope" | "zone" | "mode" | "blind" | "status" | "ow_linked" | "posted" | "created_by" | "created_at" | "result">;
type Meta = { categories: { id: string; name: string }[]; brands: { id: string; name: string }[]; staff: { id: string; name: string }[]; ow_linked: boolean };
type Edit = { qty?: string; sns?: string[]; skip?: string };

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const n0 = (v: unknown) => Number(v ?? 0);

export function CountLive() {
  const { locale } = useI18n();
  const toast = useToast();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const STATUS: Record<Status, { label: string; tone: "info" | "warn" | "brand" | "ok" | "neutral" }> = {
    counting: { label: L("กำลังนับ", "Counting", "盘点中"), tone: "info" },
    recount: { label: L("ต้องนับซ้ำ", "Recount", "需复盘"), tone: "warn" },
    review: { label: L("รอตรวจทาน/อนุมัติ", "Review", "待审批"), tone: "brand" },
    approved: { label: L("อนุมัติแล้ว", "Approved", "已批准"), tone: "ok" },
    cancelled: { label: L("ยกเลิก", "Cancelled", "已取消"), tone: "neutral" },
  };
  const SCOPE: Record<string, string> = {
    full: L("ทั้งร้าน", "Whole branch", "全店"), opening: L("นับเปิดระบบ", "Opening", "开业盘点"), category: L("ตามหมวด", "Category", "按品类"),
    brand: L("ตามแบรนด์", "Brand", "按品牌"), products: L("เลือกสินค้า", "Selected SKUs", "指定商品"),
  };

  // ── รายการรอบนับ ──
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [progress, setProgress] = useState<Record<string, { total: number; done: number; recount: number }>>({});
  const [listNames, setListNames] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const loadList = useCallback(async () => {
    if (!branchId) return;
    try {
      const r = await fetch(`/api/pos/count?branch_id=${branchId}&meta=1`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      setRows(j.sessions); setProgress(j.progress); setListNames(j.names); setMeta(j.meta);
    } catch (e) { setRows([]); toast.push({ tone: "danger", title: L("โหลดรอบนับไม่สำเร็จ", "Load failed", "加载失败"), body: e instanceof Error ? e.message : String(e) }); }
  }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadList(); }, [loadList]);

  // ── รอบที่เปิดอยู่ ──
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<{ session: Sess; lines: Line[]; names: Record<string, string>; hidden: boolean; me: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState(""), [onlyTodo, setOnlyTodo] = useState(false);
  const loadOne = useCallback(async (id: string) => {
    const r = await fetch(`/api/pos/count?id=${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { toast.push({ tone: "danger", title: L("เปิดรอบนับไม่สำเร็จ", "Open failed", "打开失败"), body: j.error }); return; }
    setData(j);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEdits({}); if (openId) void loadOne(openId); else setData(null); }, [openId, loadOne]);

  const [formErr, setFormErr] = useState("");
  async function post(body: Record<string, unknown>, okTitle?: string) {
    const r = await fetch("/api/pos/count", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (body.action === "open") setFormErr(j.error ?? `HTTP ${r.status}`); toast.push({ tone: "danger", title: L("ทำรายการไม่สำเร็จ", "Failed", "失败"), body: j.error ?? `HTTP ${r.status}` }); return null; }
    if (okTitle) toast.push({ tone: "ok", title: okTitle });
    return j;
  }

  // ── เปิดรอบใหม่ ──
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ scope_type: "full", category_id: "", brand_id: "", zone: "", mode: "freeze" as "freeze" | "cutoff", blind: true, thr_qty: "0", thr_pct: "", thr_value: "", recount_other: true, note: "", assignees: [] as string[], product_ids: [] as string[] });
  const [products, setProducts] = useState<Product[]>([]);
  const [pq, setPq] = useState("");
  useEffect(() => { if (createOpen && !products.length) void listProducts().then((p) => setProducts(p.filter((x) => /^[0-9a-f-]{36}$/i.test(x.id)))); }, [createOpen, products.length]);
  const pickList = useMemo(() => { const s = pq.trim().toLowerCase(); return s ? products.filter((p) => p.sku.toLowerCase().includes(s) || p.name_th.toLowerCase().includes(s)).slice(0, 30) : []; }, [pq, products]);
  async function create() {
    setBusy("create"); setFormErr("");
    const num = (s: string) => (s.trim() === "" ? 0 : Math.max(0, Number(s)));
    const j = await post({
      action: "open", branch_id: branchId, scope_type: form.scope_type,
      scope: { category_id: form.category_id || undefined, brand_id: form.brand_id || undefined, product_ids: form.scope_type === "products" ? form.product_ids : undefined, zone: form.zone || undefined },
      mode: form.mode, blind: form.blind, thr: { qty: num(form.thr_qty), pct: num(form.thr_pct), value: num(form.thr_value), recount_other: form.recount_other },
      note: form.note, assignees: form.assignees,
    }, L("เปิดรอบนับแล้ว", "Count opened", "已开始盘点"));
    setBusy(null);
    if (j) { setCreateOpen(false); await loadList(); setOpenId(j.id); }
  }

  if (!employee || !branchId) return null;
  const canApprove = can(employee, "inventory.count_approve");

  // ═══════════════ หน้ารอบนับ ═══════════════
  if (openId) {
    if (!data) return <PosPage title={L("ตรวจนับสต๊อก", "Stock count", "盘点")} icon={<ClipboardList size={18} />}><div className="p-4 sm:p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div></PosPage>;
    return <SessionView key={data.session.id} data={data} edits={edits} setEdits={setEdits} busy={busy} setBusy={setBusy} q={q} setQ={setQ} onlyTodo={onlyTodo} setOnlyTodo={setOnlyTodo}
      canApprove={canApprove} L={L} fmtDate={fmtDate} STATUS={STATUS} SCOPE={SCOPE} post={post} reload={() => loadOne(data.session.id)} back={() => { setOpenId(null); void loadList(); }} toast={toast} />;
  }

  // ═══════════════ รายการรอบนับ ═══════════════
  const active = rows?.filter((r) => ["counting", "recount", "review"].includes(r.status)).length ?? 0;
  return (
    <PosPage title={L("ตรวจนับสต๊อก", "Stock count", "盘点")} icon={<ClipboardList size={18} />}
      actions={<>
        <Button variant="ghost" onClick={() => void loadList()} title={L("รีเฟรช", "Refresh", "刷新")}><RefreshCw size={15} /></Button>
        <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> {L("เปิดรอบนับ", "New count", "新建盘点")}</Button>
      </>}>
      <div className="p-4 sm:p-6 space-y-4">
        {meta?.ow_linked ? (
          <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-[12.5px] leading-relaxed">
            {L("สาขานี้ใช้สต๊อกจากคลังกลาง OneWarehouse — นับและอนุมัติได้ตามปกติ แต่ผลนับจะเป็น “รายงานผลต่าง” ให้ไปปรับยอดใน OneWarehouse (ระบบจะไม่แก้ยอดใน POS เอง)",
              "This branch uses OneWarehouse stock — approved counts become a variance report to adjust in OneWarehouse (POS stock is not changed).", "本门店使用中央仓库存 — 审批后仅生成差异报告")}
          </div>
        ) : null}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatChip label={L("รอบที่ยังไม่ปิด", "Open counts", "进行中")} value={active} accent="lavender" icon={<Clock size={16} />} />
          <StatChip label={L("รอตรวจทาน", "Awaiting review", "待审批")} value={rows?.filter((r) => r.status === "review").length ?? 0} accent="peach" icon={<CheckCircle2 size={16} />} />
          <StatChip label={L("ต้องนับซ้ำ", "Recount", "需复盘")} value={rows?.filter((r) => r.status === "recount").length ?? 0} accent="coral" icon={<RefreshCw size={16} />} />
          <StatChip label={L("อนุมัติแล้ว (60 รอบล่าสุด)", "Approved", "已批准")} value={rows?.filter((r) => r.status === "approved").length ?? 0} accent="mint" icon={<CheckCircle2 size={16} />} />
        </div>
        <TablePanel>
          {rows === null ? <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : rows.length ? (
            <Table>
              <thead><tr>
                <Th>{L("เลขรอบนับ", "Count no.", "单号")}</Th><Th>{L("ขอบเขต", "Scope", "范围")}</Th><Th>{L("โหมด", "Mode", "模式")}</Th>
                <Th align="right">{L("ความคืบหน้า", "Progress", "进度")}</Th><Th align="right">{L("ผลต่าง (บาท)", "Variance (฿)", "差异")}</Th>
                <Th align="center">{L("สถานะ", "Status", "状态")}</Th><Th>{L("เปิดโดย", "Opened by", "创建")}</Th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const p = progress[r.id]; const res = r.result;
                  return (
                    <tr key={r.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <Td className="font-mono text-xs">{r.count_no}</Td>
                      <Td className="text-xs">{SCOPE[r.scope_type] ?? r.scope_type}{r.zone ? <span className="text-muted"> · {r.zone}</span> : null}{r.blind ? <span className="ml-1 text-[10px] text-muted">· Blind</span> : null}</Td>
                      <Td className="text-xs">{r.mode === "freeze" ? <span className="inline-flex items-center gap-1"><Lock size={11} /> Freeze</span> : "Cut-off"}</Td>
                      <Td align="right" className="text-xs tnum">{p ? `${p.done}/${p.total}` : "—"}{p?.recount ? <span className="text-warn"> · {L("ซ้ำ", "re", "复")} {p.recount}</span> : null}</Td>
                      <Td align="right" className="text-xs tnum">{res ? <><span className="text-danger">−{baht(n0(res.value_minus))}</span> / <span className="text-ok">+{baht(n0(res.value_plus))}</span></> : "—"}</Td>
                      <Td align="center"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.status === "approved" && !r.posted ? <span className="block text-[10px] text-muted mt-0.5">{L("รายงาน OW", "OW report", "OW报告")}</span> : null}</Td>
                      <Td className="text-xs text-muted">{listNames[r.created_by] ?? "—"}<span className="block text-[10px]">{fmtDate(r.created_at)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={<ClipboardList size={26} />} title={L("ยังไม่มีรอบนับ", "No counts yet", "暂无盘点")} body={L("เปิดรอบนับเพื่อตรวจสต๊อกจริงเทียบกับระบบ — ผลต่างจะปรับเข้าสต๊อกหลังผู้มีสิทธิ์อนุมัติเท่านั้น", "Open a count to compare physical stock with the system.", "开始盘点")} />}
        </TablePanel>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={L("เปิดรอบนับใหม่", "New count", "新建盘点")} size="lg"
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy === "create"} disabled={form.scope_type === "products" && !form.product_ids.length} onClick={() => void create()}>{L("เริ่มนับ", "Start", "开始")}</Button></>}>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={L("ขอบเขตสินค้า", "Scope", "范围")}>
              <Select value={form.scope_type} onChange={(e) => setForm({ ...form, scope_type: e.target.value })}>
                {Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label={L("โซน / ตำแหน่ง (ไม่บังคับ)", "Zone (optional)", "区域")}><Input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder={L("เช่น หน้าร้าน, ห้องสต๊อก", "e.g. Display, Stock room", "例如 展示区")} /></Field>
          </div>
          {form.scope_type === "category" ? <Field label={L("หมวดหมู่", "Category", "品类")}><Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">—</option>{meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field> : null}
          {form.scope_type === "brand" ? <Field label={L("แบรนด์", "Brand", "品牌")}><Select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}><option value="">—</option>{meta?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field> : null}
          {form.scope_type === "products" ? (
            <div className="space-y-2">
              <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={pq} onChange={(e) => setPq(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อสินค้า", "Search SKU / name", "搜索")} className="pl-9" /></div>
              {pickList.length ? <div className="max-h-40 overflow-auto rounded-xl border border-line divide-y divide-line">{pickList.map((p) => {
                const on = form.product_ids.includes(p.id);
                return <button key={p.id} type="button" onClick={() => setForm({ ...form, product_ids: on ? form.product_ids.filter((x) => x !== p.id) : [...form.product_ids, p.id] })} className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${on ? "bg-brand/8" : "hover:bg-surface2"}`}><input type="checkbox" readOnly checked={on} className="accent-[rgb(var(--c-brand))]" /><span className="font-mono text-muted">{p.sku}</span><span className="truncate">{p.name_th}</span></button>;
              })}</div> : null}
              <p className="text-[11px] text-muted">{L(`เลือกแล้ว ${form.product_ids.length} รายการ`, `${form.product_ids.length} selected`, `已选 ${form.product_ids.length}`)}</p>
            </div>
          ) : null}
          {form.scope_type === "opening" ? <p className="rounded-xl bg-brand/5 border border-brand/25 px-3 py-2 text-[12px]">{L("นับเปิดระบบ = นับสินค้าทุกตัว (รวมที่ยอดในระบบเป็น 0) เพื่อตั้งยอดยกมา", "Opening count includes every product to set opening balances.", "开业盘点包含所有商品")}</p> : null}

          <div>
            <p className="text-xs font-medium mb-1.5">{L("ระหว่างนับ ทำอย่างไรกับการขาย/รับ/โอน", "Movements during the count", "盘点期间库存变动")}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {([["freeze", L("ล็อกสต๊อก (Freeze)", "Freeze", "冻结"), L("สินค้าในรอบนี้ห้ามขาย/รับ/โอน จนกว่าจะอนุมัติหรือยกเลิกรอบ — แม่นที่สุด แนะนำสำหรับสินค้า SN", "Block sales/receipts/transfers of these SKUs until approved or cancelled.", "冻结至审批")],
                ["cutoff", L("ขายต่อได้ (Cut-off)", "Cut-off (live)", "不冻结"), L("ระบบจำยอด ณ วินาทีที่นับแต่ละรายการ แล้วปรับเฉพาะส่วนต่าง — ไม่ทับการขาย/รับที่เกิดหลังนับ", "System qty is captured when each line is counted; only the variance is posted.", "按盘点时刻截取")]] as const).map(([k, t, d]) => (
                <button key={k} type="button" onClick={() => setForm({ ...form, mode: k })} className={`text-left rounded-xl border px-3 py-2.5 transition ${form.mode === k ? "border-brand bg-brand/6 ring-1 ring-brand/30" : "border-line hover:bg-surface2"}`}>
                  <p className="text-sm font-medium flex items-center gap-1.5">{k === "freeze" ? <Lock size={14} /> : <Clock size={14} />}{t}</p>
                  <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{d}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line p-3 space-y-2">
            <p className="text-xs font-medium">{L("เกณฑ์ต้องนับซ้ำ (ผลต่างเกินค่าใดค่าหนึ่ง)", "Recount when variance exceeds", "复盘阈值")}</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label={L("จำนวน (ชิ้น)", "Qty", "数量")}><Input inputMode="decimal" value={form.thr_qty} onChange={(e) => setForm({ ...form, thr_qty: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
              <Field label="%"><Input inputMode="decimal" value={form.thr_pct} placeholder={L("ไม่ใช้", "off", "关")} onChange={(e) => setForm({ ...form, thr_pct: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
              <Field label={L("มูลค่า (บาท)", "Value (฿)", "金额")}><Input inputMode="decimal" value={form.thr_value} placeholder={L("ไม่ใช้", "off", "关")} onChange={(e) => setForm({ ...form, thr_value: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
            </div>
            <p className="text-[11px] text-muted">{L("จำนวน 0 = ต่างแม้ชิ้นเดียวก็ต้องนับซ้ำ · สินค้า SN ที่ SN ไม่ตรงต้องนับซ้ำเสมอ", "Qty 0 = any difference triggers recount · SN mismatches always recount", "0 = 任何差异都复盘")}</p>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.recount_other} onChange={(e) => setForm({ ...form, recount_other: e.target.checked })} className="accent-[rgb(var(--c-brand))]" />{L("รอบนับซ้ำต้องเป็นพนักงานคนละคนกับผู้นับรอบแรก", "Recount must be done by a different person", "复盘须由他人执行")}</label>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={form.blind} onChange={(e) => setForm({ ...form, blind: e.target.checked })} className="mt-0.5 accent-[rgb(var(--c-brand))]" />
              <span><span className="text-sm font-medium flex items-center gap-1.5"><EyeOff size={14} /> Blind count</span><span className="block text-[11px] text-muted">{L("ผู้นับไม่เห็นยอดในระบบจนกว่าจะส่งตรวจ", "Counters can't see system qty", "盘点人看不到系统数")}</span></span>
            </label>
            <Field label={L("ผู้รับผิดชอบนับ (ไม่เลือก = ทุกคนที่มีสิทธิ์)", "Counters (optional)", "盘点人")}>
              <div className="max-h-28 overflow-auto rounded-xl border border-line p-1.5 space-y-0.5">
                {meta?.staff.length ? meta.staff.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded-lg hover:bg-surface2"><input type="checkbox" checked={form.assignees.includes(s.id)} onChange={(e) => setForm({ ...form, assignees: e.target.checked ? [...form.assignees, s.id] : form.assignees.filter((x) => x !== s.id) })} className="accent-[rgb(var(--c-brand))]" />{s.name}</label>
                )) : <p className="text-[11px] text-muted px-1.5 py-1">{L("ไม่มีรายชื่อพนักงานประจำสาขา", "No branch staff", "无员工")}</p>}
              </div>
            </Field>
          </div>
          <Field label={L("หมายเหตุ", "Note", "备注")}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          {formErr ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger flex items-start gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" />{formErr}</p> : null}
        </div>
      </Modal>
    </PosPage>
  );
}

// ════════════════════════════════════════════════════════════════
function SessionView({ data, edits, setEdits, busy, setBusy, q, setQ, onlyTodo, setOnlyTodo, canApprove, L, fmtDate, STATUS, SCOPE, post, reload, back, toast }: {
  data: { session: Sess; lines: Line[]; names: Record<string, string>; hidden: boolean; me: string };
  edits: Record<string, Edit>; setEdits: React.Dispatch<React.SetStateAction<Record<string, Edit>>>;
  busy: string | null; setBusy: (b: string | null) => void; q: string; setQ: (s: string) => void; onlyTodo: boolean; setOnlyTodo: (b: boolean) => void;
  canApprove: boolean; L: (th: string, en: string, zh: string) => string; fmtDate: (s: string | null) => string;
  STATUS: Record<Status, { label: string; tone: "info" | "warn" | "brand" | "ok" | "neutral" }>; SCOPE: Record<string, string>;
  post: (b: Record<string, unknown>, ok?: string) => Promise<Record<string, unknown> | null>; reload: () => Promise<void>; back: () => void;
  toast: Pick<ReturnType<typeof useToast.getState>, "push">;
}) {
  const { session: s, lines, names, hidden, me } = data;
  const VERDICT: Record<SnVerdict, { label: string; cls: string; hint: string }> = {
    match: { label: L("ตรง", "Match", "一致"), cls: "bg-ok/12 text-ok", hint: L("อยู่สาขานี้ พร้อมขาย", "In this branch, sellable", "在本店") },
    missing: { label: L("หาย", "Missing", "缺失"), cls: "bg-danger/12 text-danger", hint: L("ระบบว่าอยู่ แต่ไม่พบตอนนับ", "Expected but not found", "系统有但未找到") },
    sold: { label: L("ขายแล้วแต่ยังอยู่", "Sold but present", "已售仍在"), cls: "bg-danger text-white", hint: L("ระบบบันทึกว่าขายแล้ว แต่ยังอยู่ในร้าน — อาจส่งเครื่องผิดชิ้นให้ลูกค้า ตรวจบิลที่อ้าง", "Recorded as sold but still here — customer may have received a different unit", "可能发错货") },
    other_branch: { label: L("ของที่อื่น", "Other location", "他处"), cls: "bg-warn/15 text-warn", hint: L("ระบบว่าอยู่สาขา/คลังอื่น หรือระหว่างโอน", "Belongs to another branch/warehouse or in transit", "属于其他门店") },
    wrong_product: { label: L("สินค้าอื่น", "Wrong product", "非本商品"), cls: "bg-warn/15 text-warn", hint: L("SN นี้เป็นของสินค้าอื่น — วางผิดที่/ติดฉลากผิด", "SN belongs to another product", "SN属于其他商品") },
    not_sellable: { label: L("ชำรุด/ตัดแล้ว", "Not sellable", "不可售"), cls: "bg-surface2 text-muted", hint: L("ชำรุด/ตัดจำหน่าย/รับคืน ไม่ควรอยู่บนชั้นขาย", "Defective/written off", "损坏/已核销") },
    unknown: { label: L("ไม่รู้จัก", "Unknown", "未知"), cls: "bg-warn/15 text-warn", hint: L("ไม่มีในระบบ — ตรวจที่มา (รับเข้าไม่ได้บันทึก?)", "Not in system — check origin", "系统无此SN") },
  };
  const snAll = lines.flatMap((l) => (l.sn_check ?? []).map((c) => ({ ...c, sku: l.sku })));
  const snCount = (v: SnVerdict) => snAll.filter((c) => c.verdict === v).length;
  const soldPresent = snAll.filter((c) => c.verdict === "sold");
  const round2 = s.status === "recount";
  const editable = s.status === "counting" || s.status === "recount";
  const reviewing = s.status === "review" || s.status === "approved";
  const name = (id: string | null) => (id ? names[id] ?? "—" : "—");
  const [snFor, setSnFor] = useState<Line | null>(null);
  const [skipFor, setSkipFor] = useState<Line | null>(null), [skipReason, setSkipReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false), [cancelReason, setCancelReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);

  const mine = (l: Line) => (round2 ? l.needs_recount : true);
  const curQty = (l: Line) => (round2 ? l.count2 : l.count1);
  const curSns = (l: Line) => (round2 ? l.count2_sns : l.count1_sns);
  const isDone = (l: Line) => {
    const e = edits[l.product_id];
    if (e) return e.skip !== undefined || (e.sns ? true : e.qty !== undefined && e.qty !== "");
    return round2 ? !l.needs_recount || l.count2 !== null : l.skipped || l.count1 !== null;
  };
  const todo = lines.filter((l) => mine(l) && !isDone(l)).length;
  const dirty = Object.keys(edits).length;
  const myRecountBlocked = round2 && s.recount_other && lines.some((l) => l.needs_recount && l.count1_by === me);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lines.filter((l) => (!round2 || l.needs_recount || !onlyTodo) && (!onlyTodo || !isDone(l)) && (!t || l.sku.toLowerCase().includes(t) || l.name.toLowerCase().includes(t)));
  }, [lines, q, onlyTodo, round2, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    let minus = 0, plus = 0, vminus = 0, vplus = 0, diffLines = 0, skipped = 0;
    for (const l of lines) {
      if (l.skipped) { skipped++; continue; }
      const v = n0(l.variance); if (v) diffLines++;
      if (v < 0) { minus -= v; vminus -= n0(l.variance_value); } else if (v > 0) { plus += v; vplus += n0(l.variance_value); }
    }
    return { minus, plus, vminus, vplus, diffLines, skipped };
  }, [lines]);

  function payload() {
    return Object.entries(edits).map(([pid, e]) => {
      if (e.skip !== undefined) return { product_id: pid, skip: true, skip_reason: e.skip };
      if (e.sns) return { product_id: pid, sns: e.sns };
      return { product_id: pid, qty: e.qty === undefined || e.qty === "" ? null : Number(e.qty) };
    });
  }
  // บันทึก: ส่งเฉพาะที่แก้ · สำเร็จแล้วล้างเฉพาะช่องที่ส่งไปและยังไม่ถูกแก้ต่อ (พิมพ์ระหว่างบันทึกไม่หาย)
  const saving = useRef(false);
  async function save(silent = false) {
    if (!dirty) return true;
    if (saving.current) return false;
    saving.current = true;
    const sent = { ...edits };
    if (!silent) setBusy("save");
    const j = await post({ action: "record", id: s.id, lines: payload() }, silent ? undefined : L("บันทึกยอดนับแล้ว", "Saved", "已保存"));
    if (!silent) setBusy(null);
    saving.current = false;
    if (j) {
      await reload();
      setEdits((cur) => { const n: Record<string, Edit> = {}; for (const [k, v] of Object.entries(cur)) if (sent[k] !== v) n[k] = v; return n; });
      setSavedAt(new Date());
    }
    return !!j;
  }
  // บันทึกอัตโนมัติเมื่อหยุดกรอก 2 วินาที (เครื่องค้าง/รีเฟรช ยอดที่นับไม่หาย)
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!editable || !dirty) return;
    const t = setTimeout(() => { void save(true); }, 2000);
    return () => clearTimeout(t);
  }, [edits]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    if (!(await save(true))) return;
    setBusy("submit");
    const j = await post({ action: "submit", id: s.id });
    setBusy(null);
    if (j) {
      if (j.status === "recount") toast.push({ tone: "warn", title: L(`มี ${j.recount} รายการต้องนับซ้ำ`, `${j.recount} line(s) need recount`, "需复盘"), body: s.recount_other ? L("ให้พนักงานคนอื่นนับรายการที่ไฮไลต์อีกครั้ง", "Ask another staff member to recount highlighted lines", "请他人复盘") : undefined });
      else toast.push({ tone: "ok", title: L("ส่งตรวจทานแล้ว", "Submitted for review", "已提交") });
      const sold = Number((j.sn_summary as Record<string, number> | undefined)?.sold ?? 0);
      if (sold) toast.push({ tone: "danger", title: L(`พบ ${sold} SN ที่ขายแล้วแต่ยังอยู่ในร้าน`, `${sold} sold SN still in store`, "已售SN仍在店"), body: L("อาจส่งเครื่องผิดชิ้นให้ลูกค้า — ดูรายละเอียดในผลตรวจราย SN", "Customer may have received a different unit", "请核对") });
      await reload();
    }
  }
  async function approve() {
    setBusy("approve");
    const j = await post({ action: "approve", id: s.id }, s.ow_linked ? L("อนุมัติแล้ว — เป็นรายงานผลต่างสำหรับปรับใน OneWarehouse", "Approved as OW variance report", "已批准") : L("อนุมัติและปรับสต๊อกแล้ว", "Approved & posted", "已批准并过账"));
    setBusy(null); setApproveOpen(false);
    if (j) await reload();
  }
  async function cancel() {
    setBusy("cancel");
    const j = await post({ action: "cancel", id: s.id, reason: cancelReason }, L("ยกเลิกรอบนับแล้ว — ไม่มีการปรับสต๊อก", "Count cancelled", "已取消"));
    setBusy(null);
    if (j) { setCancelOpen(false); await reload(); }
  }
  function exportXls() {
    downloadExcel(`${s.count_no}.xls`, [
      { key: "sku", label: "SKU" }, { key: "name", label: L("สินค้า", "Product", "商品") },
      { key: "final_sys", label: L("ยอดระบบตอนนับ", "System at count", "系统数"), map: (l: Line) => (l.final_sys ?? "") as number },
      { key: "count1", label: L("นับรอบ 1", "Count 1", "初盘"), map: (l: Line) => (l.count1 ?? "") as number },
      { key: "count2", label: L("นับรอบ 2", "Count 2", "复盘"), map: (l: Line) => (l.count2 ?? "") as number },
      { key: "variance", label: L("ผลต่าง", "Variance", "差异"), map: (l: Line) => (l.skipped ? L("ข้าม", "skipped", "跳过") : l.variance ?? "") as string },
      { key: "variance_value", label: L("มูลค่าผลต่าง (บาท)", "Variance ฿", "差异金额"), map: (l: Line) => (l.variance_value ?? "") as number },
      { key: "sn_check", label: L("ผลตรวจราย SN", "Serial check", "序列号核对"), map: (l: Line) => (l.sn_check ?? []).map((c) => `${c.sn}=${VERDICT[c.verdict].label}${c.ref ? `(${c.ref})` : ""}${c.other_sku ? `→${c.other_sku}` : ""}`).join(" · ") },
      { key: "who", label: L("ผู้นับ", "Counter", "盘点人"), map: (l: Line) => [name(l.count1_by), l.count2_by ? name(l.count2_by) : ""].filter(Boolean).join(" / ") },
      { key: "skip_reason", label: L("เหตุผลข้าม", "Skip reason", "跳过原因"), map: (l: Line) => l.skip_reason ?? "" },
    ], lines, `${L("รายงานผลนับ", "Count report", "盘点报告")} ${s.count_no} · ${STATUS[s.status].label}`);
  }

  // ขั้นตอน + สิ่งที่ต้องทำตอนนี้
  const steps = [
    { k: "counting", label: L("นับรอบแรก", "Count", "初盘") }, { k: "recount", label: L("นับซ้ำ", "Recount", "复盘") },
    { k: "review", label: L("ตรวจทาน", "Review", "审核") }, { k: "approved", label: s.ow_linked ? L("อนุมัติ (รายงาน OW)", "Approve (OW)", "批准") : L("อนุมัติ + ปรับสต๊อก", "Approve & post", "批准过账") },
  ];
  const order = ["counting", "recount", "review", "approved"];
  const at = order.indexOf(s.status);
  const action: { tone: string; text: string } | null =
    s.status === "counting" ? { tone: "info", text: todo ? L(`นับให้ครบอีก ${todo} รายการ (ช่องว่าง = ยังไม่นับ ไม่ใช่ 0) แล้วกด “ส่งตรวจ”`, `${todo} line(s) left — blank is not 0`, `还剩 ${todo} 项`) : L("นับครบแล้ว — กด “ส่งตรวจ”", "All counted — submit", "已全部盘点 — 提交") }
    : s.status === "recount" ? { tone: "warn", text: myRecountBlocked ? L("รายการที่ต้องนับซ้ำต้องให้พนักงานคนอื่นนับ — ส่งต่อให้เพื่อนร่วมงาน", "Another staff member must recount", "需他人复盘") : L(`ผลต่างเกินเกณฑ์ — นับซ้ำ ${lines.filter((l) => l.needs_recount).length} รายการที่ไฮไลต์ แล้วกด “ส่งตรวจ”`, "Recount highlighted lines, then submit", "复盘后提交") }
    : s.status === "review" ? { tone: "brand", text: canApprove ? L("ตรวจผลต่างและมูลค่า แล้วกด “อนุมัติ” (ผู้นับอนุมัติเองไม่ได้)", "Review variance and approve (counters can't approve)", "审核并批准") : L("รอหัวหน้า/ผู้มีสิทธิ์อนุมัติผลนับ", "Waiting for an approver", "等待审批") }
    : null;

  return (
    <PosPage
      title={<span className="font-mono">{s.count_no}</span>}
      icon={<button onClick={back} className="p-1 rounded-lg hover:bg-surface2" aria-label={L("กลับ", "Back", "返回")}><ArrowLeft size={18} /></button>}
      actions={<>
        <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
        {s.mode === "freeze" ? <Badge tone="neutral"><Lock size={11} /> Freeze</Badge> : <Badge tone="neutral"><Clock size={11} /> Cut-off</Badge>}
        {hidden ? <Badge tone="neutral"><EyeOff size={11} /> Blind</Badge> : null}
        {reviewing ? <Button variant="ghost" onClick={exportXls}><FileDown size={15} /> Excel</Button> : null}
        {editable ? <span className="text-[11px] text-muted hidden sm:inline">{dirty ? L("กำลังบันทึกอัตโนมัติ…", "Autosaving…", "自动保存中…") : savedAt ? L(`บันทึกแล้ว ${savedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`, "Saved", "已保存") : ""}</span> : null}
        {editable ? <Button variant="soft" loading={busy === "save"} disabled={!dirty} onClick={() => void save()}><Save size={15} /> {L("บันทึก", "Save", "保存")}{dirty ? ` (${dirty})` : ""}</Button> : null}
        {editable ? <Button variant="primary" loading={busy === "submit"} disabled={myRecountBlocked && !dirty} onClick={() => void submit()}><Send size={15} /> {L("ส่งตรวจ", "Submit", "提交")}</Button> : null}
        {s.status === "review" && canApprove ? <Button variant="ok" onClick={() => setApproveOpen(true)}><CheckCircle2 size={15} /> {L("อนุมัติ", "Approve", "批准")}</Button> : null}
        {editable || s.status === "review" ? <Button variant="ghost" onClick={() => setCancelOpen(true)} title={L("ยกเลิกรอบนับ", "Cancel count", "取消")}><XCircle size={15} /></Button> : null}
      </>}
    >
      <div className="p-4 sm:p-6 space-y-4">
        {/* ขั้นตอน */}
        {s.status !== "cancelled" ? (
          <div className="card px-4 py-3 flex items-center gap-2 overflow-x-auto">
            {steps.map((st, i) => {
              const skipRecount = st.k === "recount" && at > 1 && !lines.some((l) => l.count2 !== null || l.needs_recount);
              const done = i < at || s.status === "approved";
              const cur = i === at && s.status !== "approved";
              return (
                <div key={st.k} className="flex items-center gap-2 shrink-0">
                  <span className={`h-7 w-7 rounded-full grid place-items-center text-xs font-semibold ${done ? "bg-ok text-white" : cur ? "bg-brand text-white" : "bg-surface2 text-muted"} ${skipRecount ? "opacity-40" : ""}`}>{done ? "✓" : i + 1}</span>
                  <span className={`text-xs ${cur ? "font-semibold" : "text-muted"} ${skipRecount ? "line-through" : ""}`}>{st.label}</span>
                  {i < steps.length - 1 ? <span className="w-8 h-px bg-line mx-1" /> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface2/60 px-4 py-3 text-sm">{L("ยกเลิกโดย", "Cancelled by", "取消人")} {name(s.cancelled_by)} · {fmtDate(s.cancelled_at)} — “{s.cancel_reason}” · {L("ไม่มีการปรับสต๊อก", "No stock change", "未调整库存")}</div>
        )}
        {action ? <div className={`rounded-xl border px-4 py-3 text-[13px] flex items-start gap-2 ${action.tone === "warn" ? "border-warn/40 bg-warn/8" : action.tone === "brand" ? "border-brand/30 bg-brand/5" : "border-info/30 bg-info/5"}`}><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span><b>{L("สิ่งที่ต้องทำตอนนี้: ", "Next: ", "下一步：")}</b>{action.text}</span></div> : null}
        {s.mode === "freeze" && ["counting", "recount", "review"].includes(s.status) ? <p className="text-[12px] text-muted flex items-center gap-1.5"><Lock size={12} /> {L("สินค้าในรอบนี้ถูกล็อก: ขาย / รับเข้า / โอน ไม่ได้ จนกว่าจะอนุมัติหรือยกเลิกรอบ", "SKUs in this count are locked for sale/receipt/transfer until approved or cancelled", "本盘点商品已冻结")}</p> : null}

        {/* สรุป */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatChip label={L("ขอบเขต", "Scope", "范围")} value={<span className="text-sm">{SCOPE[s.scope_type]}{s.zone ? ` · ${s.zone}` : ""} · {lines.length} {L("รายการ", "lines", "项")}</span>} accent="lavender" icon={<ClipboardList size={16} />} />
          {reviewing ? <>
            <StatChip label={L("นับขาด", "Short", "盘亏")} value={<span className="text-danger">−{baht(totals.minus)} · ฿{baht(totals.vminus)}</span>} accent="coral" icon={<AlertTriangle size={16} />} />
            <StatChip label={L("นับเกิน", "Over", "盘盈")} value={<span className="text-ok">+{baht(totals.plus)} · ฿{baht(totals.vplus)}</span>} accent="mint" icon={<Plus size={16} />} />
            <StatChip label={L("ข้าม / ต่าง", "Skipped / diff", "跳过/差异")} value={`${totals.skipped} / ${totals.diffLines}`} accent="peach" icon={<SkipForward size={16} />} />
          </> : <>
            <StatChip label={L("นับแล้ว", "Counted", "已盘")} value={`${lines.filter((l) => mine(l)).length - todo}/${lines.filter((l) => mine(l)).length}`} accent="mint" icon={<CheckCircle2 size={16} />} />
            <StatChip label={L("เปิดโดย", "Opened by", "创建")} value={<span className="text-sm">{name(s.created_by)}</span>} accent="peach" icon={<Users size={16} />} />
            <StatChip label={L("เกณฑ์นับซ้ำ", "Recount threshold", "复盘阈值")} value={<span className="text-sm">{`> ${s.thr_qty} ${L("ชิ้น", "pcs", "件")}`}{s.thr_pct ? ` · ${s.thr_pct}%` : ""}{s.thr_value ? ` · ฿${baht(s.thr_value)}` : ""}</span>} accent="neutral" icon={<RefreshCw size={16} />} />
          </>}
        </div>
        {s.status === "approved" ? (
          <div className="rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-[13px]">
            {L("อนุมัติโดย", "Approved by", "批准人")} <b>{name(s.approved_by)}</b> · {fmtDate(s.approved_at)} · {s.posted
              ? L(`ปรับสต๊อก ${n0(s.result?.adjusted_lines)} รายการ (บันทึกใน stock movement อ้างเลข ${s.count_no})`, `Posted ${n0(s.result?.adjusted_lines)} line(s)`, "已过账")
              : L("สาขาผูก OneWarehouse — ไม่ปรับยอดใน POS ให้ปรับใน OneWarehouse ตามรายงานนี้ (ส่งออก Excel ได้)", "OW branch — adjust in OneWarehouse using this report", "请在中央仓调整")}
            {n0(s.result?.extra_sns) ? <span className="block text-warn mt-1">{L(`พบ SN เกิน ${n0(s.result?.extra_sns)} ชิ้น — ระบบไม่เพิ่มสต๊อกเอง ต้องตรวจที่มา (โอน/รับเข้า) ก่อน`, "Extra SNs found — not auto-added; investigate their origin", "多出SN未自动入库")}</span> : null}
          </div>
        ) : null}

        {snAll.length ? (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold flex items-center gap-1.5"><ScanLine size={15} /> {L("ผลตรวจราย SN — SN ไหนยังอยู่ ตรงกับระบบไหม", "Serial reconciliation", "序列号核对")}</p>
              {s.ow_linked ? <span className="text-[11px] text-muted">{L("ตรวจกับคลังกลาง OneWarehouse ทีละ SN · SN ที่หายระบุเลขไม่ได้ (คลังกลางยังไม่มีรายการ SN ทั้งคลัง) — ดูจำนวนขาดที่คอลัมน์ผลต่าง", "Checked against OneWarehouse per SN; missing SNs can't be listed yet", "逐个向中央仓核对")}</span> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(VERDICT) as SnVerdict[]).filter((v) => snCount(v)).map((v) => (
                <span key={v} title={VERDICT[v].hint} className={`text-xs px-2.5 py-1 rounded-lg ${VERDICT[v].cls}`}>{VERDICT[v].label} <b className="tnum">{snCount(v)}</b></span>
              ))}
            </div>
            {soldPresent.length ? (
              <div role="alert" className="rounded-xl border border-danger/40 bg-danger/8 px-3 py-2.5 text-[12.5px] text-danger">
                <b>{L(`พบ ${soldPresent.length} SN ที่ระบบบันทึกว่าขายแล้ว แต่ยังอยู่ในร้าน`, `${soldPresent.length} SN recorded as sold are still in store`, "已售SN仍在店内")}</b>
                <span className="block mt-0.5 text-ink/80">{L("อาจส่งเครื่องผิดชิ้นให้ลูกค้า (บิลระบุ SN นี้แต่ลูกค้าได้อีกเครื่อง) — ตรวจบิลที่อ้าง ติดต่อลูกค้า และแก้ SN ในบิลให้ถูก", "The customer may have received a different unit — check the bill, contact the customer and correct the SN", "请核对订单")}:
                  {" "}{soldPresent.map((c) => `${c.sn}${c.ref ? ` (${c.ref})` : ""}`).join(", ")}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อ", "Search", "搜索")} className="pl-9 h-9" /></div>
          {editable ? <Segmented size="sm" value={onlyTodo ? "todo" : "all"} onChange={(v) => setOnlyTodo(v === "todo")} options={[{ value: "all", label: L("ทั้งหมด", "All", "全部") }, { value: "todo", label: L(round2 ? "ต้องนับซ้ำ" : "ยังไม่นับ", round2 ? "Recount" : "To count", "未盘") }]} /> : null}
        </div>

        <TablePanel>
          <Table>
            <thead><tr>
              <Th>SKU</Th><Th>{L("สินค้า", "Product", "商品")}</Th>
              {!hidden ? <Th align="right">{L("ระบบ (ตอนนับ)", "System @count", "系统数")}</Th> : null}
              {round2 || (reviewing && lines.some((l) => l.count2 !== null)) ? <Th align="center">{L("รอบ 1", "Count 1", "初盘")}</Th> : null}
              <Th align="center">{round2 ? L("นับซ้ำ", "Recount", "复盘") : reviewing ? L("นับได้", "Counted", "实盘") : L("นับได้", "Counted", "实盘")}</Th>
              {reviewing ? <><Th align="right">{L("ผลต่าง", "Var.", "差异")}</Th><Th align="right">{L("มูลค่า", "Value", "金额")}</Th></> : null}
              <Th>{L("ผู้นับ", "By", "盘点人")}</Th>
            </tr></thead>
            <tbody>
              {shown.map((l) => {
                const e = edits[l.product_id];
                const canEdit = editable && mine(l) && !(round2 && s.recount_other && l.count1_by === me);
                const skipped = e?.skip !== undefined || (!e && l.skipped && !round2);
                const v = n0(l.variance);
                const snCount = e?.sns?.length ?? curSns(l)?.length;
                return (
                  <tr key={l.product_id} className={`${round2 && l.needs_recount ? "bg-warn/8" : ""} ${reviewing && v ? (v < 0 ? "bg-danger/4" : "bg-ok/4") : ""}`}>
                    <Td className="font-mono text-[11px] text-muted">{l.sku}</Td>
                    <Td className="text-xs">{l.name}{l.track_serial ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted">SN</span> : null}
                      {skipped ? <span className="block text-[10px] text-muted">{L("ข้าม", "Skipped", "跳过")}: {e?.skip ?? l.skip_reason}</span> : null}
                      {l.sn_check?.some((c) => c.verdict !== "match") ? (
                        <span className="flex flex-wrap gap-1 mt-1">{l.sn_check.filter((c) => c.verdict !== "match").map((c) => (
                          <span key={c.sn} title={VERDICT[c.verdict].hint} className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${VERDICT[c.verdict].cls}`}>{c.sn} · {VERDICT[c.verdict].label}{c.ref ? ` (${c.ref})` : ""}{c.other_sku ? ` → ${c.other_sku}` : ""}</span>
                        ))}{l.sn_check.some((c) => c.verdict === "match") ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-ok/12 text-ok">{L("ตรง", "Match", "一致")} {l.sn_check.filter((c) => c.verdict === "match").length}</span> : null}</span>
                      ) : null}
                    </Td>
                    {!hidden ? <Td align="right" className="text-xs tnum">{(l.final_sys ?? l.sys2 ?? l.sys1 ?? l.snapshot_qty) ?? "—"}</Td> : null}
                    {round2 || (reviewing && lines.some((x) => x.count2 !== null)) ? <Td align="center" className="text-xs tnum text-muted">{l.skipped ? "—" : l.count1 ?? (hidden && l.needs_recount ? <EyeOff size={12} className="inline" /> : "—")}</Td> : null}
                    <Td align="center">
                      {canEdit ? (
                        l.track_serial ? (
                          <button onClick={() => setSnFor(l)} className={`h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 ${snCount !== undefined && snCount !== null ? "border-brand/40 text-brand" : "border-dashed border-line text-muted"}`}><ScanLine size={13} />{snCount !== undefined && snCount !== null ? `${snCount} SN` : L("สแกน SN", "Scan SN", "扫SN")}</button>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <Input value={e?.qty ?? (e?.skip !== undefined ? "" : curQty(l) ?? "")} inputMode="decimal" placeholder={L("ยังไม่นับ", "blank", "未盘")}
                              onChange={(ev) => { const val = ev.target.value.replace(/[^\d.]/g, ""); setEdits((x) => ({ ...x, [l.product_id]: { qty: val } })); }}
                              className={`h-8 w-24 text-center tnum ${(e?.qty ?? curQty(l)) === undefined || (e?.qty ?? curQty(l)) === null || e?.qty === "" ? "border-dashed" : ""}`} />
                          </div>
                        )
                      ) : <span className="text-xs tnum font-medium">{skipped ? "—" : (round2 ? l.count2 : l.final_qty ?? l.count1) ?? (l.track_serial && curSns(l) ? curSns(l)!.length : "—")}</span>}
                      {canEdit && !round2 ? <button onClick={() => { setSkipFor(l); setSkipReason(e?.skip ?? l.skip_reason ?? ""); }} title={L("ข้ามรายการ (ต้องมีเหตุผล)", "Skip (reason required)", "跳过")} className="ml-1 align-middle text-muted hover:text-ink"><SkipForward size={14} /></button> : null}
                    </Td>
                    {reviewing ? <>
                      <Td align="right" className={`tnum font-semibold text-xs ${l.skipped ? "text-muted" : v < 0 ? "text-danger" : v > 0 ? "text-ok" : "text-muted"}`}>{l.skipped ? L("ข้าม", "skip", "跳") : v > 0 ? `+${v}` : v}</Td>
                      <Td align="right" className="tnum text-xs">{l.skipped || !v ? "—" : `฿${baht(n0(l.variance_value))}`}</Td>
                    </> : null}
                    <Td className="text-[11px] text-muted">{l.count1_by ? name(l.count1_by) : "—"}{l.count2_by ? <span className="block">↻ {name(l.count2_by)}</span> : null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TablePanel>
        <p className="text-[11px] text-muted">{L("ยอดระบบ = ยอด ณ วินาทีที่นับรายการนั้น (Cut-off) · ผลต่างปรับเข้าสต๊อกเป็นส่วนต่างหลังอนุมัติ ไม่เขียนทับการขาย/รับที่เกิดหลังนับ · มูลค่าคิดจากต้นทุนมาตรฐานสินค้า",
          "System qty is captured at the moment each line is counted; only the variance is posted after approval. Value uses standard cost.", "系统数按盘点时刻截取")}</p>
      </div>

      {snFor ? <SerialScan line={snFor} initial={edits[snFor.product_id]?.sns ?? curSns(snFor) ?? []} L={L} onClose={() => setSnFor(null)}
        onSave={(sns) => { setEdits((x) => ({ ...x, [snFor.product_id]: { sns } })); setSnFor(null); }} /> : null}

      <Modal open={!!skipFor} onClose={() => setSkipFor(null)} title={L("ข้ามรายการนี้", "Skip this line", "跳过")} size="sm"
        footer={<><Button variant="ghost" onClick={() => { if (skipFor) setEdits((x) => { const n = { ...x }; delete n[skipFor.product_id]; return n; }); setSkipFor(null); }}>{L("ไม่ข้าม", "Don't skip", "不跳过")}</Button>
          <Button variant="primary" disabled={skipReason.trim().length < 3} onClick={() => { if (skipFor) setEdits((x) => ({ ...x, [skipFor.product_id]: { skip: skipReason.trim() } })); setSkipFor(null); }}>{L("ข้าม", "Skip", "跳过")}</Button></>}>
        <p className="text-xs text-muted mb-2">{skipFor?.sku} · {skipFor?.name}</p>
        <Field label={L("เหตุผล (บังคับ)", "Reason (required)", "原因")}><Input autoFocus value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder={L("เช่น ของอยู่ระหว่างซ่อม / เข้าถึงไม่ได้", "e.g. under repair", "例如 维修中")} /></Field>
        <p className="text-[11px] text-muted mt-2">{L("รายการที่ข้ามจะไม่ถูกปรับสต๊อก และแสดงในรายงานพร้อมเหตุผล", "Skipped lines are not adjusted and appear in the report", "跳过项不调整")}</p>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={L("ยกเลิกรอบนับ", "Cancel count", "取消盘点")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>{L("ปิด", "Close", "关闭")}</Button><Button variant="danger" loading={busy === "cancel"} disabled={cancelReason.trim().length < 3} onClick={() => void cancel()}>{L("ยืนยันยกเลิก", "Confirm", "确认")}</Button></>}>
        <p className="text-sm mb-3">{L("ยอดที่นับไว้จะไม่ถูกปรับเข้าสต๊อก", "Counted quantities will not be posted", "不会调整库存")}{s.mode === "freeze" ? L(" และปลดล็อกสินค้าให้ขายได้ทันที", " and the freeze is released", "并解除冻结") : ""}</p>
        <Field label={L("เหตุผล (บังคับ)", "Reason (required)", "原因")}><Input autoFocus value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </Modal>

      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title={L("ยืนยันอนุมัติผลนับ", "Approve count", "确认批准")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setApproveOpen(false)}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="ok" loading={busy === "approve"} onClick={() => void approve()}><CheckCircle2 size={15} /> {L("อนุมัติ", "Approve", "批准")}</Button></>}>
        <div className="space-y-2 text-sm">
          <p>{s.ow_linked ? L("สาขานี้ผูก OneWarehouse — การอนุมัติจะบันทึกเป็นรายงานผลต่าง ไม่แก้ยอดใน POS", "OW branch — approval records a report only", "仅记录报告") : L("ระบบจะปรับสต๊อกตามผลต่างด้านล่าง ครั้งเดียว (กดซ้ำไม่ปรับซ้ำ)", "Stock will be adjusted once by the variance below", "将按差异调整一次")}</p>
          <div className="rounded-xl bg-surface2 px-3 py-2 tnum text-[13px] space-y-0.5">
            <p>{L("นับขาด", "Short", "盘亏")}: <b className="text-danger">−{baht(totals.minus)}</b> {L("ชิ้น", "pcs", "件")} · ฿{baht(totals.vminus)}</p>
            <p>{L("นับเกิน", "Over", "盘盈")}: <b className="text-ok">+{baht(totals.plus)}</b> {L("ชิ้น", "pcs", "件")} · ฿{baht(totals.vplus)}</p>
            <p>{L("สุทธิ", "Net", "净额")}: <b>฿{baht(totals.vplus - totals.vminus)}</b> · {L("ข้าม", "Skipped", "跳过")} {totals.skipped}</p>
          </div>
        </div>
      </Modal>
    </PosPage>
  );
}

// ── สแกน SN ทีละชิ้น (กันซ้ำในรายการ) ──
function SerialScan({ line, initial, L, onClose, onSave }: { line: Line; initial: string[]; L: (th: string, en: string, zh: string) => string; onClose: () => void; onSave: (sns: string[]) => void }) {
  const [list, setList] = useState<string[]>(initial);
  const [v, setV] = useState(""), [err, setErr] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  // Modal ดึงโฟกัสไปที่ตัวกรอบตอนเปิด → โฟกัสช่องสแกนหลังเฟรมถัดไป ให้ยิงบาร์โค้ดได้ทันที
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 80); return () => clearTimeout(t); }, []);
  function add() {
    const sn = v.trim().toUpperCase();
    if (!sn) return;
    if (list.includes(sn)) { setErr(L(`สแกนซ้ำ: ${sn}`, `Duplicate: ${sn}`, `重复: ${sn}`)); setV(""); return; }
    setList([sn, ...list]); setV(""); setErr("");
  }
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><ScanLine size={16} /> {L("สแกน SN", "Scan SN", "扫描SN")} · {line.sku}</span>} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" onClick={() => onSave(list)}>{L(`บันทึก ${list.length} SN`, `Save ${list.length} SN`, `保存 ${list.length}`)}</Button></>}>
      <p className="text-xs text-muted mb-2">{line.name} — {L("สแกนทุกชิ้นที่เห็นจริง (ไม่ต้องดูว่าระบบมีอะไร) · พบ 0 ชิ้นให้กดบันทึกโดยไม่สแกน", "Scan every unit you physically find. Found none? Save with 0.", "扫描实物")}</p>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-2">
        <Input ref={ref} autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={L("ยิงบาร์โค้ด SN แล้วกด Enter", "Scan and press Enter", "扫描后回车")} className="font-mono" />
        <Button type="submit" variant="soft">{L("เพิ่ม", "Add", "添加")}</Button>
      </form>
      {err ? <p className="text-xs text-danger mt-1.5">{err}</p> : null}
      <div className="mt-3 max-h-60 overflow-auto rounded-xl border border-line divide-y divide-line">
        {list.length ? list.map((sn) => (
          <div key={sn} className="flex items-center justify-between px-3 py-1.5 text-xs font-mono">{sn}<button onClick={() => setList(list.filter((x) => x !== sn))} className="text-muted hover:text-danger"><XCircle size={14} /></button></div>
        )) : <p className="px-3 py-3 text-xs text-muted">{L("ยังไม่ได้สแกน", "Nothing scanned", "尚未扫描")}</p>}
      </div>
    </Modal>
  );
}
