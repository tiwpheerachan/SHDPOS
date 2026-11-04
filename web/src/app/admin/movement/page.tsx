"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Search, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listAudit } from "@/lib/data/repo";
import type { AuditEntry } from "@/lib/types";
import { Card, Input, Table, Th, Td, Badge, EmptyState, Segmented, Button, SkeletonTable } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";
import { visibleBranchIds } from "@/lib/permissions";
import { useSession } from "@/lib/store/session";
import { formatTHB } from "@/lib/money";
import { exportCsv, stampFilename } from "@/lib/export";
import { printReport } from "@/lib/pdf";
import { FileText } from "lucide-react";

type RangeK = "today" | "7d" | "30d" | "all";
const STOCK_ACTIONS = ["sale", "void", "refund", "exchange", "transfer", "stock_count", "adjustment", "receive"];

export default function StockMovementPage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const { branches } = useAdminScope();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [range, setRange] = useState<RangeK>("7d");
  const [scope, setScope] = useState<"stock" | "all">("stock");

  const scopedIds = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);

  useEffect(() => {
    setLoading(true);
    void listAudit({ branchIds: scopedIds.length ? scopedIds : undefined }).then((a) => { setRows(a); setLoading(false); });
  }, [scopedIds]);

  const actionLabel = (a: string) => (({
    sale: L("ขาย", "Sale", "销售"), void: L("ยกเลิกบิล", "Void", "作废"),
    refund: L("คืนเงิน", "Refund", "退款"), exchange: L("เปลี่ยนสินค้า", "Exchange", "换货"),
    transfer: L("โอนย้าย", "Transfer", "调拨"), stock_count: L("นับสต๊อก", "Stock Count", "盘点"),
    adjustment: L("ปรับสต๊อก", "Adjustment", "调整"), receive: L("รับสินค้าเข้า", "Goods Receipt", "入库"),
    shift_open: L("เปิดกะ", "Shift Open", "开班"), shift_close: L("ปิดกะ", "Shift Close", "关班"),
    login: L("เข้าระบบ", "Login", "登录"),
  } as Record<string, string>)[a] ?? a);
  const tone = (a: string): "ok" | "danger" | "warn" | "info" | "neutral" =>
    a === "sale" || a === "receive" ? "ok" : a === "void" ? "danger" : a === "refund" || a === "exchange" || a === "adjustment" ? "warn" : a === "transfer" || a === "stock_count" ? "info" : "neutral";

  const filtered = useMemo(() => {
    const now = Date.now();
    const span = range === "today" ? 0 : range === "7d" ? 7 : range === "30d" ? 30 : Infinity;
    const from = range === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : now - span * 86400000;
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (range !== "all" && new Date(r.occurred_at).getTime() < from) return false;
      if (scope === "stock" && !STOCK_ACTIONS.includes(r.action)) return false;
      if (!term) return true;
      return (r.ref_no ?? "").toLowerCase().includes(term) || (r.actor_name ?? "").toLowerCase().includes(term) || r.action.toLowerCase().includes(term);
    });
  }, [rows, range, scope, q]);

  const onExport = () => exportCsv(stampFilename("stock-movement"), filtered.map((r) => ({
    time: r.occurred_at, action: r.action, ref_no: r.ref_no ?? "", branch: r.branch_id ? branchName.get(r.branch_id) ?? r.branch_id : "",
    actor: r.actor_name ?? "", amount: r.amount ?? "", detail: r.after_data ? JSON.stringify(r.after_data) : "",
  })));
  const onPdf = () => printReport(t.cmd.stockMovement,
    [t.common.time, t.common.action, "Ref", t.common.branch, t.common.employee, t.common.amount],
    filtered.map((r) => [new Date(r.occurred_at).toLocaleString(), actionLabel(r.action), r.ref_no ?? "—", r.branch_id ? branchName.get(r.branch_id) ?? "" : "", r.actor_name ?? "", r.amount != null ? formatTHB(r.amount, false) : "—"]),
    t.cmd.stockMovement);

  if (!employee) return null;

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold flex items-center gap-2"><ArrowLeftRight size={18} className="text-muted" /> {t.cmd.stockMovement}</h1>
        <Segmented size="sm" value={scope} onChange={setScope} options={[
          { value: "stock", label: L("สต๊อก", "Stock", "库存") }, { value: "all", label: t.common.all },
        ]} />
        <Segmented size="sm" value={range} onChange={setRange} options={[
          { value: "today", label: t.common.today }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "all", label: t.common.all },
        ]} />
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นเลขเอกสาร / พนักงาน / Serial", "Search ref / staff / serial", "搜索单号/员工")} className="pl-9 h-9" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onExport} disabled={!filtered.length}><Download size={14} /> CSV</Button>
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onPdf} disabled={!filtered.length}><FileText size={14} /> PDF</Button>
        </div>
      </div>

      <Card className="overflow-hidden [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-surface [&_thead_th]:z-10">
        {loading ? <SkeletonTable rows={10} cols={6} /> : filtered.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.time}</Th>
                <Th>{t.common.action}</Th>
                <Th>{L("เอกสารอ้างอิง", "Reference", "参考单号")}</Th>
                <Th>{t.common.branch}</Th>
                <Th>{t.common.employee}</Th>
                <Th align="right">{t.common.amount}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((r) => (
                <tr key={r.id} className="hover:bg-surface2/60">
                  <Td className="text-xs text-muted whitespace-nowrap">{new Date(r.occurred_at).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
                  <Td><Badge tone={tone(r.action)}>{actionLabel(r.action)}</Badge></Td>
                  <Td className="font-mono text-[11px]">{r.ref_no ?? "—"}</Td>
                  <Td className="text-xs text-muted truncate max-w-[160px]">{r.branch_id ? branchName.get(r.branch_id) ?? "—" : "—"}</Td>
                  <Td className="text-xs">{r.actor_name ?? "—"}</Td>
                  <Td align="right" className="text-xs font-medium">{r.amount != null ? formatTHB(r.amount, false) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState icon={<ArrowLeftRight size={26} />} title={t.common.empty} />}
      </Card>
    </div>
  );
}
