"use client";
// เอกสารของบิล จัดตามขั้นของแผนภาพ — เปิด / PDF / คัดลอกลิงก์ / แชร์ · ออกใบกำกับภาษีเต็มรูปได้ (สิทธิ์ tax.issue_full)
import { useEffect, useState } from "react";
import { ReceiptText, FileText, ShieldCheck, RotateCcw, GitBranch, ExternalLink, Link2, Check, Loader2, Plus, Lock, Truck, PackageCheck, AlertTriangle, FileMinus } from "lucide-react";
import type { OrderDocItem } from "@/lib/doc-types";
import { DocViewer } from "@/components/doc-viewer";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

const ICON: Record<OrderDocItem["kind"], typeof FileText> = { receipt: ReceiptText, tax_invoice: FileText, credit_note: FileMinus, warranty: ShieldCheck, return: RotateCcw, trace: GitBranch, transfer_out: Truck, transfer_in: PackageCheck, transfer_diff: AlertTriangle };
const stageLabel = (k: string): string => ({ payment: tr("ชำระเงิน", "Payment", "付款"), stock: tr("สต๊อก / SN", "Stock / SN", "库存 / SN"), after: tr("หลังการขาย", "After-sales", "售后"), all: tr("ทั้งโฟลว์", "Full flow", "全流程"), ship: tr("ส่งสินค้า", "Ship", "发货"), receive: tr("รับสินค้า", "Receive", "收货") } as Record<string, string>)[k] ?? "";
type Buyer = { name: string; tax_id: string; branch_no: string; address: string; phone: string };

export function OrderDocsPanel({ clientUuid, orderNo }: { clientUuid?: string | null; orderNo?: string | null }) {
  const L = useL();
  const [data, setData] = useState<{ docs: OrderDocItem[]; can_issue_tax: boolean; buyer_prefill: Buyer | null; tax_request: { contact: string | null; created_at: string } | null; order: { client_uuid: string }; can_credit_note?: boolean; cn_remaining?: number; order_total?: number } | null>(null);
  const [cn, setCn] = useState<{ amount: string; reason: string; method: string; rid: string } | null>(null);
  const [err, setErr] = useState(""), [copied, setCopied] = useState(""), [issue, setIssue] = useState<{ buyer: Buyer; reason: string; replace: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [issueErr, setIssueErr] = useState("");
  const [viewKey, setViewKey] = useState<string | null>(null);
  async function load() {
    const q = clientUuid ? `client_uuid=${clientUuid}` : `order_no=${encodeURIComponent(orderNo ?? "")}`;
    try { const r = await fetch(`/api/pos/order-docs?${q}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(j.error); setData(j); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : L("โหลดไม่สำเร็จ", "Failed to load", "加载失败")); }
  }
  useEffect(() => { void load(); }, [clientUuid, orderNo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy(d: OrderDocItem) {
    if (!d.url) return;
    try { await navigator.clipboard.writeText(new URL(d.url, window.location.origin).href); setCopied(d.key); setTimeout(() => setCopied(""), 2000); } catch { /* */ }
  }
  async function submitIssue() {
    if (!issue || !data) return;
    setBusy(true); setIssueErr("");
    try {
      const r = await fetch("/api/pos/order-docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "issue_tax_invoice", client_uuid: data.order.client_uuid, buyer: issue.buyer, replace_reason: issue.replace ? issue.reason : null }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      setIssue(null); await load(); setViewKey(`ti:${j.id}`);
    } catch (e) { setIssueErr(e instanceof Error ? e.message : L("ออกใบกำกับไม่สำเร็จ", "Failed to issue tax invoice", "开具增值税发票失败")); } finally { setBusy(false); }
  }

  async function submitCn() {
    if (!cn || !data) return;
    setBusy(true); setIssueErr("");
    try {
      const r = await fetch("/api/pos/order-docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "issue_credit_note", client_uuid: data.order.client_uuid, request_id: cn.rid, amount: Number(cn.amount), reason: cn.reason, refund_method: cn.method }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      setCn(null); await load(); setViewKey(`cn:${j.id}`);
    } catch (e) { setIssueErr(e instanceof Error ? e.message : L("ออกใบลดหนี้ไม่สำเร็จ", "Failed to issue credit note", "开具贷项通知单失败")); } finally { setBusy(false); }
  }

  if (err) return <p className="rounded-xl bg-red-500/8 text-red-600 text-xs px-3 py-2">{err}</p>;
  if (!data) return <p className="text-xs text-muted py-6 text-center inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" />{L("กำลังโหลดเอกสาร…", "Loading documents…", "正在加载单据…")}</p>;
  const groups = ["payment", "stock", "after", "all", "ship", "receive"].map((s) => [s, data.docs.filter((d) => d.stage === s)] as const).filter(([, l]) => l.length);
  const activeTi = data.docs.some((d) => d.kind === "tax_invoice" && d.available && d.status === "issued");
  const blank: Buyer = { name: "", tax_id: "", branch_no: "", address: "", phone: "" };

  return (
    <div className="space-y-4">
      {data.tax_request ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs flex flex-wrap items-center gap-2">
          <span className="font-semibold text-amber-700 dark:text-amber-300">{L("ลูกค้าขอใบกำกับภาษีเต็มรูปผ่านลิงก์ใบเสร็จ", "Customer requested a full tax invoice via the receipt link", "客户通过收据链接申请完整增值税发票")}</span>
          <span className="text-muted">{new Date(data.tax_request.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{data.tax_request.contact ? ` · ${L("ติดต่อ", "Contact", "联系方式")}: ${data.tax_request.contact}` : ""}</span>
          {data.can_issue_tax && !issue ? <button onClick={() => { setIssue({ buyer: data.buyer_prefill ?? blank, reason: "", replace: false }); setIssueErr(""); }} className="ml-auto h-8 px-3 rounded-lg bg-brand text-brandInk font-medium">{L("ตรวจข้อมูลแล้วออกใบกำกับ", "Review & issue tax invoice", "核对信息并开具发票")}</button> : null}
        </div>
      ) : null}
      {groups.map(([stage, list]) => (
        <section key={stage} className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted px-0.5">{stageLabel(stage)}</p>
          {list.map((d) => {
            const I = ICON[d.kind];
            const cancelled = d.status === "cancelled";
            return (
              <div key={d.key} className={`rounded-xl border border-line px-3 py-2.5 flex items-center gap-3 ${!d.available || cancelled ? "bg-surface2/40" : "bg-surface"}`}>
                <span className={`h-9 w-9 grid place-items-center rounded-lg shrink-0 ${d.available && !cancelled ? "bg-brand/10 text-brand" : "bg-surface2 text-muted"}`}><I size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${cancelled ? "line-through text-muted" : ""}`}>{d.title}{d.internal ? <Lock size={11} className="inline ml-1.5 text-muted" /> : null}</p>
                  <p className="text-[11px] text-muted truncate">{d.doc_no ? <span className="font-mono" translate="no">{d.doc_no}</span> : null}{d.reason ? `${d.doc_no ? " · " : ""}${d.reason}` : ""}</p>
                </div>
                {d.available && d.url ? (
                  <span className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setViewKey(d.key)} className="h-8 px-2.5 rounded-lg border border-line text-xs inline-flex items-center gap-1 hover:border-brand/50 hover:bg-brand/5"><ExternalLink size={12} />{L("ดู / PDF", "View / PDF", "查看 / PDF")}</button>
                    <button onClick={() => void copy(d)} title={L("คัดลอกลิงก์แชร์", "Copy share link", "复制分享链接")} className="h-8 w-8 grid place-items-center rounded-lg border border-line text-muted hover:text-brand">{copied === d.key ? <Check size={13} className="text-ok" /> : <Link2 size={13} />}</button>
                  </span>
                ) : d.kind === "tax_invoice" && !d.doc_no && data.can_issue_tax && d.reason?.startsWith("ยังไม่ได้ออก") ? (
                  <button onClick={() => { setIssue({ buyer: data.buyer_prefill ?? blank, reason: "", replace: false }); setIssueErr(""); }} className="h-8 px-3 rounded-lg bg-brand text-brandInk text-xs font-medium inline-flex items-center gap-1 shrink-0"><Plus size={13} />{L("ออกใบกำกับ", "Issue tax invoice", "开具发票")}</button>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
      {activeTi && data.can_issue_tax && !issue ? <button onClick={() => { setIssue({ buyer: data.buyer_prefill ?? blank, reason: "", replace: true }); setIssueErr(""); }} className="text-[11px] text-muted hover:text-ink underline">{L("แก้ข้อมูลผู้ซื้อ (ยกเลิกใบกำกับเดิมแล้วออกใบใหม่)", "Edit buyer info (cancel the original tax invoice and issue a new one)", "修改购买方信息（作废原发票并重新开具）")}</button> : null}

      {data.can_credit_note && (data.cn_remaining ?? 0) > 0 && !cn && !issue ? (
        <button onClick={() => { setCn({ amount: "", reason: "", method: "bank_transfer", rid: crypto.randomUUID() }); setIssueErr(""); }} className="text-[11px] text-muted hover:text-ink underline ml-3">{L("ออกใบลดหนี้ (ลดราคา/ชดเชยหลังขาย โดยไม่รับคืนสินค้า)", "Issue credit note (post-sale discount/compensation without product return)", "开具贷项通知单（售后降价/补偿，不退货）")}</button>
      ) : null}
      {cn ? (
        <section className="rounded-2xl border border-orange-500/40 bg-orange-500/5 p-4 space-y-2.5 text-xs">
          <p className="text-sm font-semibold flex items-center gap-1.5"><FileMinus size={15} /> {L("ออกใบลดหนี้ — ลดราคาหลังขาย (ไม่มีสินค้าคืน)", "Issue credit note — post-sale discount (no product return)", "开具贷项通知单 — 售后降价（无退货）")}</p>
          <p className="text-muted">{L("สต๊อกไม่เปลี่ยน · คืนเงินลูกค้าตามช่องทางที่เลือก · ลดได้อีกไม่เกิน", "Stock unchanged · refund via the selected method · up to", "库存不变 · 按所选方式退款 · 最多还可减免")} <b className="text-ink">{(data.cn_remaining ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b> {L("บาท", "THB", "泰铢")} ({L("ยอดบิล", "bill total", "账单金额")} {(data.order_total ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })} {L("หักที่คืน/ลดไปแล้ว", "minus amounts already refunded/credited", "减去已退款/已减免金额")}) · {L("ถ้าลูกค้าคืนสินค้า ให้ทำที่หน้า “คืน / เปลี่ยนสินค้า” — ระบบออกใบลดหนี้ให้เอง", "If the customer returns products, use the “Return / Exchange” page — the credit note is issued automatically", "如客户退货，请在“退货 / 换货”页面操作 — 系统会自动开具贷项通知单")}</p>
          <div className="grid sm:grid-cols-3 gap-2">
            <Inp label={L("จำนวนเงินลดหนี้ (รวม VAT) *", "Credit amount (incl. VAT) *", "减免金额（含 VAT）*")} v={cn.amount} on={(v) => setCn({ ...cn, amount: v.replace(/[^\d.]/g, "") })} mono />
            <label className="block space-y-1"><span className="text-muted">{L("คืนเงินทาง *", "Refund via *", "退款方式 *")}</span>
              <select value={cn.method} onChange={(e) => setCn({ ...cn, method: e.target.value })} className="w-full h-9 px-2 rounded-lg border border-line bg-surface text-sm">
                <option value="bank_transfer">{L("โอนเงิน", "Bank transfer", "银行转账")}</option><option value="qr_promptpay">{L("พร้อมเพย์", "PromptPay", "PromptPay")}</option><option value="cash">{L("เงินสด (ออกจากลิ้นชักกะ)", "Cash (from shift drawer)", "现金（从班次钱箱支出）")}</option><option value="credit_card">{L("คืนเข้าบัตรเครดิต", "Refund to credit card", "退回信用卡")}</option><option value="debit_card">{L("คืนเข้าบัตรเดบิต", "Refund to debit card", "退回借记卡")}</option>
              </select></label>
            <Inp label={L("เหตุที่ลดหนี้ *", "Credit reason *", "减免原因 *")} v={cn.reason} on={(v) => setCn({ ...cn, reason: v })} />
          </div>
          {Number(cn.amount) > (data.cn_remaining ?? 0) ? <p className="text-danger">{L("เกินยอดที่ลดได้", "Exceeds the creditable amount", "超出可减免金额")}</p> : null}
          {issueErr ? <p role="alert" className="text-danger">{issueErr}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCn(null)} className="h-9 px-3 rounded-lg border border-line">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button disabled={busy || !(Number(cn.amount) > 0) || Number(cn.amount) > (data.cn_remaining ?? 0) || cn.reason.trim().length < 3} onClick={() => void submitCn()} className="h-9 px-4 rounded-lg bg-orange-600 text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <FileMinus size={13} />}{L("ออกใบลดหนี้และคืนเงิน", "Issue credit note & refund", "开具贷项通知单并退款")}</button>
          </div>
        </section>
      ) : null}

      {viewKey ? <DocViewer docs={data.docs} startKey={viewKey} onClose={() => setViewKey(null)} /> : null}
      {issue ? (
        <section className="rounded-2xl border border-brand/40 bg-brand/5 p-4 space-y-2.5 text-xs">
          <p className="text-sm font-semibold">{issue.replace ? L("ออกใบกำกับภาษีใหม่แทนใบเดิม", "Issue a replacement tax invoice", "开具新发票替换原发票") : L("ออกใบกำกับภาษีเต็มรูป", "Issue full tax invoice", "开具完整增值税发票")}</p>
          <p className="text-muted">{L("ข้อมูลผู้ซื้อจะถูกบันทึกเป็นภาพ ณ วันออก · เลขเอกสารรันต่อเนื่องรายสาขา ยกเลิกแล้วเลขไม่ถูกนำกลับมาใช้", "Buyer info is snapshotted at issue date · document numbers run sequentially per branch; cancelled numbers are never reused", "购买方信息按开具日快照保存 · 单据编号按门店连续编号，作废后编号不再复用")}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <Inp label={L("ชื่อผู้ซื้อ / บริษัท *", "Buyer / company name *", "购买方 / 公司名称 *")} v={issue.buyer.name} on={(v) => setIssue({ ...issue, buyer: { ...issue.buyer, name: v } })} />
            <Inp label={L("เลขประจำตัวผู้เสียภาษี (13 หลัก) *", "Tax ID (13 digits) *", "纳税人识别号（13 位）*")} v={issue.buyer.tax_id} on={(v) => setIssue({ ...issue, buyer: { ...issue.buyer, tax_id: v } })} mono />
            <Inp label={L("สาขา (ว่าง = สำนักงานใหญ่)", "Branch (blank = head office)", "分支机构（留空 = 总部）")} v={issue.buyer.branch_no} on={(v) => setIssue({ ...issue, buyer: { ...issue.buyer, branch_no: v } })} mono />
            <Inp label={L("โทรศัพท์", "Phone", "电话")} v={issue.buyer.phone} on={(v) => setIssue({ ...issue, buyer: { ...issue.buyer, phone: v } })} />
          </div>
          <label className="block space-y-1"><span className="text-muted">{L("ที่อยู่ตามทะเบียน *", "Registered address *", "注册地址 *")}</span>
            <textarea value={issue.buyer.address} onChange={(e) => setIssue({ ...issue, buyer: { ...issue.buyer, address: e.target.value } })} rows={2} className="w-full px-2.5 py-2 rounded-lg border border-line bg-surface text-sm" /></label>
          {issue.replace ? <Inp label={L("เหตุผลที่ยกเลิกใบเดิม *", "Reason for cancelling the original *", "作废原发票原因 *")} v={issue.reason} on={(v) => setIssue({ ...issue, reason: v })} /> : null}
          {issueErr ? <p role="alert" className="text-danger">{issueErr}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setIssue(null)} className="h-9 px-3 rounded-lg border border-line">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button disabled={busy} onClick={() => void submitIssue()} className="h-9 px-4 rounded-lg bg-brand text-brandInk font-medium inline-flex items-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}{L("ออกใบกำกับภาษี", "Issue tax invoice", "开具增值税发票")}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Inp({ label, v, on, mono }: { label: string; v: string; on: (v: string) => void; mono?: boolean }) {
  return <label className="block space-y-1"><span className="text-muted">{label}</span><input value={v} onChange={(e) => on(e.target.value)} className={`w-full h-9 px-2.5 rounded-lg border border-line bg-surface text-sm ${mono ? "font-mono" : ""}`} /></label>;
}

/** ดึงรายการเอกสารของบิล (ใช้ในแผนภาพ: แสดงเอกสารของแต่ละขั้น) */
export function useOrderDocs(clientUuid?: string | null, orderNo?: string | null) {
  const [docs, setDocs] = useState<OrderDocItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    const q = clientUuid ? `client_uuid=${clientUuid}` : `order_no=${encodeURIComponent(orderNo ?? "")}`;
    fetch(`/api/pos/order-docs?${q}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive && Array.isArray(j.docs)) setDocs(j.docs); }).catch(() => {});
    return () => { alive = false; };
  }, [clientUuid, orderNo]);
  return docs;
}

/** การ์ดเอกสารเล็ก ๆ ในรายละเอียดของขั้น */
export function StageDocs({ docs, stage, onOpen, onMore }: { docs: OrderDocItem[]; stage: string; onOpen: (key: string) => void; onMore?: () => void }) {
  const L = useL();
  const list = docs.filter((d) => d.stage === stage);
  if (!list.length) return null;
  return (
    <div className="px-4 py-3 border-t border-line/60 bg-surface2/30">
      <p className="text-[11px] font-semibold text-muted mb-2">{L("เอกสารของขั้นนี้", "Documents for this step", "本环节单据")}</p>
      <div className="flex flex-wrap gap-2">
        {list.map((d) => {
          const I = ICON[d.kind];
          const can = d.available && !!d.url;
          return (
            <button key={d.key} type="button" onClick={() => (can ? onOpen(d.key) : onMore?.())} title={d.reason ?? d.title}
              className={`group inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition ${can ? "border-line bg-surface hover:border-brand/50 hover:shadow-sm" : "border-dashed border-line bg-transparent text-muted"}`}>
              <span className={`h-7 w-7 grid place-items-center rounded-lg ${can ? "bg-brand/10 text-brand" : "bg-surface2"}`}><I size={13} /></span>
              <span className="min-w-0">
                <span className={`block text-xs font-medium ${d.status === "cancelled" ? "line-through text-muted" : ""}`}>{d.title}</span>
                <span className="block text-[10px] text-muted truncate max-w-[200px]">{d.doc_no ?? d.reason}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
