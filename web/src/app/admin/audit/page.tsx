"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText, Search, Download, WifiOff, FileText, ShieldCheck, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listAudit, listBranches } from "@/lib/data/repo";
import type { AuditEntry, Branch } from "@/lib/types";
import { Card, Table, Th, Td, Badge, Input, Button, EmptyState, Select, Segmented, Drawer, DetailRow, Avatar } from "@/components/ui";
import { Pager } from "@/components/pos/page-shell";
import { formatTHB } from "@/lib/money";
import { can, visibleBranchIds } from "@/lib/permissions";
import { exportCsv, stampFilename } from "@/lib/export";
import { printReport } from "@/lib/pdf";

const ACTIONS = [
  "login", "logout", "sale", "void", "refund", "exchange", "discount", "price_override",
  "cash_drawer", "cash_adjust", "adjustment", "receive", "transfer", "user_permission",
  "reprint", "shift_open", "shift_close", "stock_count",
];
const TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "info" | "brand"> = {
  sale: "ok", receive: "ok", void: "danger", refund: "warn", exchange: "warn", discount: "warn",
  price_override: "danger", cash_drawer: "warn", cash_adjust: "danger", adjustment: "warn", stock_adjust: "danger",
  transfer: "info", user_permission: "danger", reprint: "warn",
  shift_open: "info", shift_close: "info", stock_count: "info", login: "neutral", logout: "neutral",
};
type RangeK = "today" | "7d" | "30d" | "all";

export default function AdminAuditPage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [action, setAction] = useState("all");
  const [range, setRange] = useState<RangeK>("7d");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const PAGE = 60;

  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([listAudit({ limit: 3000 }), listBranches()]);
      setRows(a); setBranches(b);
    })();
  }, []);
  useEffect(() => { setPage(0); }, [q, action, range]);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const bName = (id?: string | null) => (id ? (locale === "th" ? branches.find((b) => b.id === id)?.name_th ?? branches.find((b) => b.id === id)?.name : branches.find((b) => b.id === id)?.name) ?? "—" : "—");
  const actionLabel = (a: string) => (t.audit as unknown as Record<string, string>)[a] ?? a;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const now = Date.now();
    const from = range === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : range === "7d" ? now - 7 * 864e5 : range === "30d" ? now - 30 * 864e5 : 0;
    return rows
      .filter((r) => !r.branch_id || allowed.includes(r.branch_id))
      .filter((r) => (action === "all" ? true : r.action === action))
      .filter((r) => (range === "all" ? true : new Date(r.occurred_at).getTime() >= from))
      .filter((r) => (!term ? true : (r.ref_no ?? "").toLowerCase().includes(term) || (r.actor_name ?? "").toLowerCase().includes(term) || r.action.toLowerCase().includes(term)));
  }, [rows, allowed, action, range, q]);

  const paged = visible.slice(page * PAGE, (page + 1) * PAGE);

  // สรุป after_data สั้น ๆ สำหรับคอลัมน์รายละเอียด
  const summarize = (r: AuditEntry): string => {
    const d = (r.after_data ?? {}) as Record<string, unknown>;
    if (d.before !== undefined && d.after !== undefined) return `${d.before} → ${d.after}${d.reason ? ` · ${d.reason}` : ""}`;
    if (d.reason) return String(d.reason);
    if (d.status) return String(d.status);
    if (d.supplier) return `${d.supplier}${d.qty ? ` · +${d.qty}` : ""}`;
    return Object.entries(d).slice(0, 2).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`).join(" · ");
  };

  const DATA_LABEL: Record<string, string> = {
    reason: L("เหตุผล", "Reason", "原因"), before: L("ก่อน", "Before", "之前"), after: L("หลัง", "After", "之后"),
    delta: L("ส่วนต่าง", "Delta", "差值"), sku: "SKU", supplier: L("ผู้จัดจำหน่าย", "Supplier", "供应商"),
    po_ref: "PO", qty: L("จำนวน", "Qty", "数量"), payment_reversed: L("คืนเงิน", "Payment reversed", "退款"),
    units_restocked: L("คืนสต๊อก", "Units restocked", "回库"), status: L("สถานะ", "Status", "状态"),
    channel: L("ช่องทาง", "Channel", "渠道"), discount: L("ส่วนลด", "Discount", "折扣"), methods: L("ช่องทางชำระ", "Methods", "支付方式"),
    to: L("ปลายทาง", "To", "目的"), shipped: L("ส่ง", "Shipped", "发货"), received: L("รับ", "Received", "收货"),
    was_paid: L("ชำระแล้ว", "Was paid", "已付"), note: L("หมายเหตุ", "Note", "备注"), items: L("จำนวนรายการ", "Items", "项数"),
  };
  const fmtVal = (v: unknown) => Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? L("ใช่", "Yes", "是") : L("ไม่", "No", "否")) : String(v);

  const onExport = () => exportCsv(stampFilename("audit"), visible.map((r) => ({
    time: r.occurred_at, action: r.action, actor: r.actor_name ?? "", branch: bName(r.branch_id), ref_no: r.ref_no ?? "",
    amount: r.amount ?? "", offline: r.is_offline ? "1" : "0", detail: r.after_data ? JSON.stringify(r.after_data) : "",
  })));
  const onPdf = () => printReport(t.audit.title,
    [t.common.time, t.common.action, t.common.employee, t.common.branch, "Ref", t.common.amount, L("รายละเอียด", "Detail", "详情")],
    visible.map((r) => [new Date(r.occurred_at).toLocaleString(), actionLabel(r.action), r.actor_name ?? "", bName(r.branch_id), r.ref_no ?? "—", r.amount != null ? formatTHB(r.amount, false) : "—", summarize(r)]),
    t.audit.title);

  if (!can(employee, "audit.view")) return <div className="p-8 text-center text-sm text-muted">{L("ไม่มีสิทธิ์ดู audit log", "No permission", "无权限")}</div>;

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold flex items-center gap-2"><ScrollText size={18} className="text-muted" /> {t.audit.title}</h1>
        <span className="text-[11px] text-muted hidden lg:inline">· {L("append-only แก้/ลบไม่ได้", "append-only, immutable", "只增不可改")}</span>
        <Segmented size="sm" value={range} onChange={setRange} options={[
          { value: "today", label: t.common.today }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "all", label: t.common.all },
        ]} />
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 w-44">
          <option value="all">{t.common.all}</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </Select>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t.common.search} Ref / ${t.common.employee}`} className="pl-9 h-9" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onExport} disabled={!visible.length}><Download size={14} /> CSV</Button>
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onPdf} disabled={!visible.length}><FileText size={14} /> PDF</Button>
        </div>
      </div>

      <Card className="overflow-hidden [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-surface [&_thead_th]:z-10">
        {visible.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.time}</Th><Th>{t.common.action}</Th><Th>{t.common.employee}</Th>
                <Th>{t.common.branch}</Th><Th>Ref</Th><Th align="right">{t.common.amount}</Th><Th>{L("รายละเอียด", "Detail", "详情")}</Th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id} className="hover:bg-surface2/60 cursor-pointer" onClick={() => setDetail(r)}>
                  <Td className="text-xs text-muted whitespace-nowrap">{new Date(r.occurred_at).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</Td>
                  <Td><Badge tone={TONE[r.action] ?? "neutral"}>{actionLabel(r.action)}</Badge></Td>
                  <Td className="text-xs">{r.actor_name ?? "—"}</Td>
                  <Td className="text-xs text-muted truncate max-w-[150px]">{bName(r.branch_id)}</Td>
                  <Td className="font-mono text-[11px] text-muted">{r.ref_no ?? "—"}</Td>
                  <Td align="right" className="text-xs">{r.amount != null ? formatTHB(r.amount, false) : "—"}</Td>
                  <Td className="text-[11px] text-muted max-w-[240px] truncate">{r.is_offline ? <WifiOff size={10} className="inline mr-1 text-warn" /> : null}{summarize(r)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState icon={<ScrollText size={26} />} title={t.common.empty} />}
      </Card>
      <Pager page={page} pageSize={PAGE} total={visible.length} onPage={setPage} />

      {/* audit detail drawer */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="md"
        title={detail ? actionLabel(detail.action) : ""}
        subtitle={detail ? new Date(detail.occurred_at).toLocaleString(locale === "th" ? "th-TH" : "en-US") : ""}
        badge={detail ? <Badge tone={TONE[detail.action] ?? "neutral"}>{detail.action}</Badge> : null}>
        {detail ? (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              {detail.actor_name ? <Avatar name={detail.actor_name} size={40} /> : null}
              <div>
                <p className="text-sm font-semibold">{detail.actor_name ?? "—"}</p>
                <p className="text-[11px] text-muted">{bName(detail.branch_id)}{detail.is_offline ? " · offline" : ""}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
              <DetailRow label={L("การกระทำ", "Action", "操作")}>{actionLabel(detail.action)}</DetailRow>
              <DetailRow label={L("เวลา", "Time", "时间")}>{new Date(detail.occurred_at).toLocaleString(locale === "th" ? "th-TH" : "en-US")}</DetailRow>
              <DetailRow label={t.common.branch}>{bName(detail.branch_id)}</DetailRow>
              <DetailRow label={L("อ้างอิง", "Reference", "参考")}><span className="font-mono">{detail.ref_no ?? "—"}</span></DetailRow>
              {detail.amount != null ? <DetailRow label={t.common.amount}>{formatTHB(detail.amount)}</DetailRow> : null}
            </div>
            {(() => {
              const d = (detail.after_data ?? {}) as Record<string, unknown>;
              const hasBA = d.before !== undefined && d.after !== undefined;
              return (
                <>
                  {hasBA ? (
                    <div className="rounded-xl bg-surface2 px-4 py-3 flex items-center justify-center gap-3 text-sm">
                      <span className="tnum text-muted">{fmtVal(d.before)}</span>
                      <ArrowRight size={15} className="text-muted" />
                      <span className="tnum font-semibold">{fmtVal(d.after)}</span>
                    </div>
                  ) : null}
                  {Object.keys(d).length ? (
                    <div className="rounded-2xl border border-line divide-y divide-line/60 px-4">
                      {Object.entries(d).map(([k, v]) => (
                        <DetailRow key={k} label={DATA_LABEL[k] ?? k}>{fmtVal(v)}</DetailRow>
                      ))}
                    </div>
                  ) : null}
                </>
              );
            })()}
            <p className="text-[10px] text-muted flex items-center gap-1.5"><ShieldCheck size={12} /> {L("บันทึกนี้แก้ไข/ลบไม่ได้ (append-only)", "This record is immutable (append-only)", "此记录不可更改")}</p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
