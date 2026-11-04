"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Search, Download, ReceiptText, RotateCcw, FileSpreadsheet, ArrowLeftRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { listOrders, listReturns } from "@/lib/data/repo";
import { db } from "@/lib/offline/db";
import type { Quotation, Transfer } from "@/lib/types";
import { Card, Input, Table, Th, Td, Badge, EmptyState, Segmented, Button, SkeletonTable } from "@/components/ui";
import { ColumnMenu, Pager } from "@/components/pos/page-shell";
import { FileText as FileIcon } from "lucide-react";
import { useAdminScope } from "@/components/admin/filters";
import { visibleBranchIds } from "@/lib/permissions";
import { useSession } from "@/lib/store/session";
import { formatTHB } from "@/lib/money";
import { exportCsv, stampFilename } from "@/lib/export";
import { printReport } from "@/lib/pdf";

type DocType = "receipt" | "credit" | "quotation" | "transfer";
interface Doc { id: string; type: DocType; docNo: string; date: string; branchId: string | null; party: string; amount: number | null; status: string }

export default function DocumentCenterPage() {
  const { t, locale } = useI18n();
  const { employee } = useSession();
  const { branches } = useAdminScope();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState<DocType | "all">("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const PAGE = 50;

  const scopedIds = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, locale === "th" ? b.name_th ?? b.name : b.name])), [branches, locale]);

  useEffect(() => {
    if (!scopedIds.length) return;
    setLoading(true);
    void (async () => {
      const from = new Date(); from.setDate(from.getDate() - 120);
      const [orders, returns, quotations, transfers] = await Promise.all([
        listOrders({ branchIds: scopedIds, from }),
        listReturns(scopedIds),
        db().quotations.reverse().sortBy("created_at") as Promise<Quotation[]>,
        db().transfers.reverse().sortBy("created_at") as Promise<Transfer[]>,
      ]);
      const set = new Set(scopedIds);
      const out: Doc[] = [];
      for (const o of orders) out.push({ id: o.id, type: "receipt", docNo: o.order_no, date: o.created_at, branchId: o.branch_id, party: o.customer_name || L("ลูกค้าทั่วไป", "Walk-in", "散客"), amount: o.grand_total, status: o.status });
      for (const r of returns) out.push({ id: r.id, type: "credit", docNo: r.return_no, date: r.created_at, branchId: r.branch_id, party: r.order_no ?? "", amount: r.refund_amount, status: r.status });
      for (const qd of quotations.filter((x) => set.has(x.branch_id))) out.push({ id: qd.id, type: "quotation", docNo: qd.quotation_no, date: qd.created_at, branchId: qd.branch_id, party: qd.customer_name ?? "", amount: qd.grand_total, status: qd.status });
      for (const tr of transfers.filter((x) => set.has(x.from_branch_id) || set.has(x.to_branch_id))) out.push({ id: tr.id, type: "transfer", docNo: tr.transfer_no, date: tr.created_at, branchId: tr.from_branch_id, party: branchName.get(tr.to_branch_id) ?? "", amount: null, status: tr.status });
      out.sort((a, b) => b.date.localeCompare(a.date));
      setDocs(out);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedIds, locale]);

  const meta: Record<DocType, { label: string; icon: React.ReactNode; tone: "ok" | "warn" | "info" | "neutral" }> = {
    receipt: { label: L("ใบเสร็จ / ใบกำกับภาษี", "Receipt / Tax Invoice", "小票/税票"), icon: <ReceiptText size={14} />, tone: "ok" },
    credit: { label: L("ใบลดหนี้ / คืนสินค้า", "Credit Note / Return", "贷记单/退货"), icon: <RotateCcw size={14} />, tone: "warn" },
    quotation: { label: t.quotation.title, icon: <FileSpreadsheet size={14} />, tone: "info" },
    transfer: { label: L("ใบโอนย้าย", "Transfer", "调拨单"), icon: <ArrowLeftRight size={14} />, tone: "neutral" },
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (type !== "all" && d.type !== type) return false;
      if (!term) return true;
      return d.docNo.toLowerCase().includes(term) || d.party.toLowerCase().includes(term);
    });
  }, [docs, type, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length };
    for (const d of docs) c[d.type] = (c[d.type] ?? 0) + 1;
    return c;
  }, [docs]);

  const COLS = [
    { key: "type", label: L("ประเภท", "Type", "类型") },
    { key: "docNo", label: L("เลขเอกสาร", "Document No.", "单号") },
    { key: "date", label: t.common.date },
    { key: "branch", label: t.common.branch },
    { key: "party", label: L("ลูกค้า / ปลายทาง", "Party", "客户/目的") },
    { key: "amount", label: t.common.amount },
    { key: "status", label: t.common.status },
  ];
  const show = (k: string) => !hidden.has(k);
  const toggleCol = (k: string) => setHidden((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  useEffect(() => { setPage(0); }, [q, type]);
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);

  const cell = (d: Doc, k: string): string | number =>
    k === "type" ? meta[d.type].label : k === "docNo" ? d.docNo
      : k === "date" ? new Date(d.date).toLocaleDateString(locale === "th" ? "th-TH" : "en-US")
      : k === "branch" ? (d.branchId ? branchName.get(d.branchId) ?? "" : "")
      : k === "party" ? d.party : k === "amount" ? (d.amount ?? "") : d.status;

  const visibleCols = COLS.filter((c) => show(c.key));
  const onExport = () => exportCsv(stampFilename("documents"), filtered.map((d) => Object.fromEntries(visibleCols.map((c) => [c.label, cell(d, c.key)]))));
  const onPdf = () => printReport(t.cmd.documentCenter, visibleCols.map((c) => c.label), filtered.map((d) => visibleCols.map((c) => cell(d, c.key))), t.cmd.documentCenter);

  if (!employee) return null;

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold flex items-center gap-2"><FileText size={18} className="text-muted" /> {t.cmd.documentCenter}</h1>
        <Segmented size="sm" value={type} onChange={setType} options={[
          { value: "all", label: `${t.cmd.allTypes} (${counts.all ?? 0})` },
          { value: "receipt", label: `${L("ใบเสร็จ", "Receipt", "小票")} (${counts.receipt ?? 0})` },
          { value: "credit", label: `${L("ลดหนี้", "Credit", "贷记")} (${counts.credit ?? 0})` },
          { value: "quotation", label: `${L("เสนอราคา", "Quote", "报价")} (${counts.quotation ?? 0})` },
          { value: "transfer", label: `${L("โอนย้าย", "Transfer", "调拨")} (${counts.transfer ?? 0})` },
        ]} />
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นเลขเอกสาร / ลูกค้า", "Search doc no / party", "搜索单号/客户")} className="pl-9 h-9" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ColumnMenu columns={COLS} hidden={hidden} onToggle={toggleCol} label={L("คอลัมน์", "Columns", "列")} />
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onExport} disabled={!filtered.length}><Download size={14} /> CSV</Button>
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onPdf} disabled={!filtered.length}><FileIcon size={14} /> PDF</Button>
        </div>
      </div>

      <Card className="overflow-hidden [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-surface [&_thead_th]:z-10">
        {loading ? <SkeletonTable rows={10} cols={6} /> : filtered.length ? (
          <Table>
            <thead>
              <tr>
                {show("type") ? <Th>{COLS[0].label}</Th> : null}
                {show("docNo") ? <Th>{COLS[1].label}</Th> : null}
                {show("date") ? <Th>{COLS[2].label}</Th> : null}
                {show("branch") ? <Th>{COLS[3].label}</Th> : null}
                {show("party") ? <Th>{COLS[4].label}</Th> : null}
                {show("amount") ? <Th align="right">{COLS[5].label}</Th> : null}
                {show("status") ? <Th align="center">{COLS[6].label}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {paged.map((d) => (
                <tr key={`${d.type}-${d.id}`} className="hover:bg-surface2/60">
                  {show("type") ? <Td><Badge tone={meta[d.type].tone}>{meta[d.type].icon} {meta[d.type].label}</Badge></Td> : null}
                  {show("docNo") ? <Td className="font-mono text-[11px]">{d.docNo}</Td> : null}
                  {show("date") ? <Td className="text-xs text-muted whitespace-nowrap">{new Date(d.date).toLocaleDateString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", year: "2-digit" })}</Td> : null}
                  {show("branch") ? <Td className="text-xs text-muted truncate max-w-[150px]">{d.branchId ? branchName.get(d.branchId) ?? "—" : "—"}</Td> : null}
                  {show("party") ? <Td className="text-xs truncate max-w-[160px]">{d.party || "—"}</Td> : null}
                  {show("amount") ? <Td align="right" className="text-xs font-medium">{d.amount != null ? formatTHB(d.amount, false) : "—"}</Td> : null}
                  {show("status") ? <Td align="center"><span className="text-[11px] text-muted">{d.status}</span></Td> : null}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState icon={<FileText size={26} />} title={t.common.empty} />}
      </Card>
      <Pager page={page} pageSize={PAGE} total={filtered.length} onPage={setPage} />
    </div>
  );
}
