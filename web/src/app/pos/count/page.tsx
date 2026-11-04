"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Search, Plus, ArrowLeft, Send, CheckCircle2, XCircle, EyeOff, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import {
  listCategories, listBrands, createCountSession, listCountSessions, saveCountSession, approveCountSession,
} from "@/lib/data/repo";
import type { Brand, Category, CountType, StockCountSession } from "@/lib/types";
import { Button, Input, Select, Table, Th, Td, EmptyState, Badge, Modal, Field, Skeleton } from "@/components/ui";
import { PosPage, TablePanel } from "@/components/pos/page-shell";
import { can } from "@/lib/permissions";

const ZONES = ["Display Area", "Stock Room", "Counter", "Vending", "All"];

export default function StockCountPage() {
  const { t, locale, pick } = useI18n();
  const toast = useToast();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [active, setActive] = useState<StockCountSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [zone, setZone] = useState(ZONES[0]);
  const [type, setType] = useState<CountType>("full");
  const [blind, setBlind] = useState(true);
  const [catId, setCatId] = useState("");
  const [brandId, setBrandId] = useState("");

  const typeLabel: Record<CountType, string> = {
    full: L("นับทั้งหมด", "Full Count", "全盘"), cycle: L("นับหมุนเวียน", "Cycle Count", "循环盘点"),
    category: L("ตามหมวด", "Category", "按品类"), brand: L("ตามแบรนด์", "Brand", "按品牌"),
    random: L("สุ่มนับ", "Random", "随机"), serial: L("นับ Serial", "Serial", "序列号"),
  };
  const statusMeta: Record<StockCountSession["status"], { label: string; tone: "neutral" | "info" | "warn" | "ok" | "danger" }> = {
    counting: { label: L("กำลังนับ", "Counting", "盘点中"), tone: "info" },
    submitted: { label: L("รอตรวจ/อนุมัติ", "Submitted", "待审"), tone: "warn" },
    completed: { label: L("เสร็จ + ปรับแล้ว", "Completed", "已完成"), tone: "ok" },
    cancelled: { label: L("ยกเลิก", "Cancelled", "已取消"), tone: "neutral" },
  };

  async function reload() {
    if (!branchId) return;
    setLoading(true);
    const [s, c, b] = await Promise.all([listCountSessions(branchId), listCategories(), listBrands()]);
    setSessions(s); setCategories(c); setBrands(b); setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [branchId]);

  async function create() {
    if (!branchId || !employee) return;
    setBusy(true);
    try {
      const s = await createCountSession(branchId, employee.id, { zone, type, blind, categoryId: catId || undefined, brandId: brandId || undefined });
      setCreateOpen(false);
      await reload();
      setActive(s);
    } finally { setBusy(false); }
  }

  const canApprove = employee ? can(employee, "inventory.count") : false;

  function setCounted(pid: string, v: string) {
    if (!active) return;
    const counted = v === "" ? null : Number(v.replace(/[^\d]/g, ""));
    setActive({ ...active, lines: active.lines.map((l) => (l.product_id === pid ? { ...l, counted } : l)) });
  }

  const diffLines = useMemo(() => active?.lines.filter((l) => l.counted != null && l.counted !== l.expected) ?? [], [active]);
  const countedN = useMemo(() => active?.lines.filter((l) => l.counted != null).length ?? 0, [active]);

  async function submit() {
    if (!active) return;
    setBusy(true);
    try {
      const next = { ...active, status: "submitted" as const, submitted_at: new Date().toISOString() };
      await saveCountSession(next); setActive(next); await reload();
      toast.push({ tone: "ok", title: t.inventory.submitCount, body: `${next.count_no} · ${diffLines.length} ${L("รายการต่าง", "diffs", "差异")}` });
    } finally { setBusy(false); }
  }
  async function approve() {
    if (!active || !employee) return;
    setBusy(true);
    try {
      await approveCountSession(active, employee.id);
      const next = { ...active, status: "completed" as const, approved_by: employee.id };
      setActive(next); await reload();
      toast.push({ tone: "ok", title: statusMeta.completed.label, body: `${L("ปรับ", "adjusted", "调整")} ${diffLines.length} ${L("รายการ", "items", "项")}` });
    } finally { setBusy(false); }
  }
  async function cancel() {
    if (!active) return;
    const next = { ...active, status: "cancelled" as const };
    await saveCountSession(next); setActive(null); await reload();
  }

  if (!employee) return null;
  if (!can(employee, "inventory.count")) return <div className="p-8 text-center text-sm text-muted">{L("ไม่มีสิทธิ์นับสต๊อก", "No permission", "无权限")}</div>;

  // ===== active session view =====
  if (active) {
    const s = active;
    const hideExpected = s.blind && s.status === "counting";
    const rows = q.trim() ? s.lines.filter((l) => l.sku.toLowerCase().includes(q.toLowerCase()) || l.name.toLowerCase().includes(q.toLowerCase())) : s.lines;
    return (
      <PosPage
        title={<span className="font-mono">{s.count_no}</span>}
        icon={<button onClick={() => setActive(null)} className="p-1 rounded-lg hover:bg-surface2"><ArrowLeft size={18} /></button>}
        actions={
          <>
            <Badge tone={statusMeta[s.status].tone}>{statusMeta[s.status].label}</Badge>
            {s.blind ? <Badge tone="neutral">{hideExpected ? <><EyeOff size={11} /> Blind</> : <><Eye size={11} /> Blind</>}</Badge> : null}
            <span className="text-xs text-muted tnum">{countedN}/{s.lines.length}</span>
            <div className="relative w-full sm:w-52">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="pl-9 h-9" />
            </div>
            {s.status === "counting" ? <Button variant="primary" loading={busy} onClick={() => void submit()}><Send size={15} /> {t.inventory.submitCount}</Button> : null}
            {s.status === "submitted" && canApprove ? <Button variant="ok" loading={busy} onClick={() => void approve()}><CheckCircle2 size={15} /> {L("อนุมัติ & ปรับสต๊อก", "Approve & Adjust", "批准并调整")}</Button> : null}
            {s.status !== "completed" && s.status !== "cancelled" ? <Button variant="ghost" onClick={() => void cancel()}><XCircle size={15} /></Button> : null}
          </>
        }
      >
        <div className="p-4 sm:p-6">
          <div className="mb-3 text-xs text-muted">{typeLabel[s.type]} · {L("โซน", "Zone", "区域")} {s.zone} · {L("ต่าง", "Diff", "差异")} {diffLines.length}</div>
          <TablePanel>
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th><Th>{t.admin.products}</Th>
                  {!hideExpected ? <Th align="right">{t.inventory.expected}</Th> : null}
                  <Th align="center">{t.inventory.counted}</Th>
                  {!hideExpected ? <Th align="right">{t.inventory.difference}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const diff = l.counted == null ? null : l.counted - l.expected;
                  const editable = s.status === "counting";
                  return (
                    <tr key={l.product_id} className={diff ? "bg-warn/5" : ""}>
                      <Td className="font-mono text-[11px] text-muted">{l.sku}</Td>
                      <Td className="text-xs">{l.name}</Td>
                      {!hideExpected ? <Td align="right" className="text-xs tnum">{l.expected}</Td> : null}
                      <Td align="center">
                        {editable ? (
                          <Input value={l.counted ?? ""} inputMode="numeric" onChange={(e) => setCounted(l.product_id, e.target.value)} className="h-8 w-20 text-center tnum" />
                        ) : <span className="text-xs tnum font-medium">{l.counted ?? "—"}</span>}
                      </Td>
                      {!hideExpected ? (
                        <Td align="right" className={`tnum font-semibold ${diff == null ? "text-muted" : diff === 0 ? "text-ok" : diff < 0 ? "text-danger" : "text-warn"}`}>
                          {diff == null ? "—" : diff > 0 ? `+${diff}` : diff}
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TablePanel>
        </div>
      </PosPage>
    );
  }

  // ===== session list view =====
  return (
    <PosPage
      title={t.inventory.count}
      icon={<ClipboardList size={18} />}
      actions={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> {L("สร้างรอบนับ", "New count", "新建盘点")}</Button>}
    >
      <div className="p-4 sm:p-6">
        <TablePanel>
          {loading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : sessions.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>{L("เลขรอบนับ", "Count No.", "盘点单号")}</Th><Th>{L("ประเภท", "Type", "类型")}</Th>
                  <Th>{L("โซน", "Zone", "区域")}</Th><Th align="right">{L("รายการ", "Lines", "行数")}</Th>
                  <Th align="center">{t.common.status}</Th><Th>{t.common.date}</Th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const diffs = s.lines.filter((l) => l.counted != null && l.counted !== l.expected).length;
                  return (
                    <tr key={s.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setActive(s)}>
                      <Td className="font-mono text-xs">{s.count_no}</Td>
                      <Td className="text-xs">{typeLabel[s.type]}{s.blind ? <span className="ml-1.5 text-[10px] text-muted">· Blind</span> : null}</Td>
                      <Td className="text-xs text-muted">{s.zone}</Td>
                      <Td align="right" className="text-xs tnum">{s.lines.length}{diffs ? <span className="text-warn"> · {diffs}⚠</span> : null}</Td>
                      <Td align="center"><Badge tone={statusMeta[s.status].tone}>{statusMeta[s.status].label}</Badge></Td>
                      <Td className="text-xs text-muted">{new Date(s.created_at).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<ClipboardList size={26} />} title={L("ยังไม่มีรอบนับ", "No count sessions", "暂无盘点")} body={L("สร้างรอบนับเพื่อควบคุมสต๊อกภายใน (รองรับ Blind Count)", "Create a count session for internal control (Blind Count supported)", "创建盘点会话")} />
          )}
        </TablePanel>
      </div>

      {/* create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={L("สร้างรอบนับ", "New Count Session", "新建盘点")} size="md"
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>{t.common.cancel}</Button><Button variant="primary" loading={busy} onClick={() => void create()}>{L("เริ่มนับ", "Start", "开始")}</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={L("โซน", "Zone", "区域")}><Select value={zone} onChange={(e) => setZone(e.target.value)}>{ZONES.map((z) => <option key={z}>{z}</option>)}</Select></Field>
            <Field label={L("ประเภท", "Type", "类型")}><Select value={type} onChange={(e) => setType(e.target.value as CountType)}>{(Object.keys(typeLabel) as CountType[]).map((k) => <option key={k} value={k}>{typeLabel[k]}</option>)}</Select></Field>
          </div>
          {type === "category" ? (
            <Field label={L("หมวดหมู่", "Category", "品类")}><Select value={catId} onChange={(e) => setCatId(e.target.value)}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{pick({ th: c.name_th, en: c.name_en, zh: c.name_zh })}</option>)}</Select></Field>
          ) : null}
          {type === "brand" ? (
            <Field label={t.common.brand}><Select value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          ) : null}
          <label className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="w-4 h-4 accent-[rgb(var(--c-brand))]" />
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5"><EyeOff size={14} /> Blind Count</p>
              <p className="text-[11px] text-muted">{L("ซ่อนจำนวนในระบบระหว่างนับ กันนับตามตัวเลข", "Hide expected qty while counting", "盘点时隐藏系统数量")}</p>
            </div>
          </label>
        </div>
      </Modal>
    </PosPage>
  );
}
