"use client";
// หน้าต่างดูเอกสารในระบบ (ไม่เปิดแท็บใหม่) — รายการเอกสารของบิลด้านซ้าย · กระดาษ A4 ตรงกลาง · PDF/พิมพ์/ลิงก์/เปิดแท็บใหม่
//   แสดงหน้า /doc/[token]?embed=1 ใน iframe (โดเมนเดียวกัน) แล้วสั่ง PDF/พิมพ์ผ่าน window.__docActions ของหน้านั้น
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, Printer, Link2, Check, ExternalLink, ChevronLeft, ChevronRight, Loader2, ReceiptText, FileText, ShieldCheck, RotateCcw, GitBranch, Lock, Truck, PackageCheck, AlertTriangle, FileMinus } from "lucide-react";
import type { OrderDocItem } from "@/lib/doc-types";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

const ICON: Record<OrderDocItem["kind"], typeof FileText> = { receipt: ReceiptText, tax_invoice: FileText, credit_note: FileMinus, warranty: ShieldCheck, return: RotateCcw, trace: GitBranch, transfer_out: Truck, transfer_in: PackageCheck, transfer_diff: AlertTriangle };
const TINT: Record<OrderDocItem["kind"], string> = { receipt: "bg-emerald-500/12 text-emerald-600", tax_invoice: "bg-sky-500/12 text-sky-600", credit_note: "bg-orange-500/12 text-orange-600", warranty: "bg-violet-500/12 text-violet-600", return: "bg-amber-500/14 text-amber-600", trace: "bg-slate-500/12 text-slate-600", transfer_out: "bg-indigo-500/12 text-indigo-600", transfer_in: "bg-emerald-500/12 text-emerald-600", transfer_diff: "bg-rose-500/12 text-rose-600" };
const stageLabel = (k: string): string => ({ payment: tr("ชำระเงิน", "Payment", "付款"), stock: tr("สต๊อก / SN", "Stock / SN", "库存 / SN"), after: tr("หลังการขาย", "After-sales", "售后"), all: tr("ทั้งโฟลว์", "Full flow", "全流程"), ship: tr("ส่งสินค้า", "Ship", "发货"), receive: tr("รับสินค้า", "Receive", "收货") } as Record<string, string>)[k] ?? "";

export function DocViewer({ docs, startKey, onClose }: { docs: OrderDocItem[]; startKey: string; onClose: () => void }) {
  const L = useL();
  const list = docs.filter((d) => d.available && d.url);
  const [i, setI] = useState(() => Math.max(0, list.findIndex((d) => d.key === startKey)));
  const [loading, setLoading] = useState(true), [pdfBusy, setPdfBusy] = useState(false), [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const d = list[i];
  useEffect(() => { setLoading(true); }, [i]);
  useEffect(() => {
    // capture: ทำก่อน Drawer ข้างล่าง แล้ว preventDefault ไม่ให้ Drawer ปิดตาม
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight") setI((x) => Math.min(list.length - 1, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", h, true);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h, true); document.body.style.overflow = prev; };
  }, [list.length, onClose]);
  if (!d || typeof document === "undefined") return null;

  const actions = () => (frame.current?.contentWindow as unknown as { __docActions?: { pdf: () => Promise<void>; print: () => void } } | null)?.__docActions;
  async function pdf() { const a = actions(); if (!a) return; setPdfBusy(true); try { await a.pdf(); } finally { setPdfBusy(false); } }
  async function copy() { try { await navigator.clipboard.writeText(new URL(d.url!, window.location.origin).href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* */ } }
  const I = ICON[d.kind];
  const groups = ["payment", "stock", "after", "all", "ship", "receive"].map((s) => [s, list.map((x, idx) => ({ x, idx })).filter(({ x }) => x.stage === s)] as const).filter(([, l]) => l.length);

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-2 sm:p-5" role="dialog" aria-modal="true" aria-label={d.title}>
      <div className="absolute inset-0 bg-[rgba(15,23,42,.55)] backdrop-blur-[3px] animate-[fadeIn_.15s_ease-out]" onClick={onClose} />
      <div className="relative w-full max-w-[1120px] h-full max-h-[94vh] rounded-[22px] bg-surface shadow-2xl border border-line/60 flex flex-col overflow-hidden animate-[popIn_.18s_ease-out]">
        <style>{`@keyframes popIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
        {/* แถบหัว */}
        <header className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-line bg-surface/95">
          <span className={`h-10 w-10 grid place-items-center rounded-xl shrink-0 ${TINT[d.kind]}`}><I size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate flex items-center gap-1.5">{d.title}{d.internal ? <Lock size={12} className="text-muted" /> : null}{d.status === "cancelled" ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">{L("ยกเลิกแล้ว", "Cancelled", "已取消")}</span> : null}</p>
            <p className="text-[11px] text-muted truncate"><span className="font-mono" translate="no">{d.doc_no}</span> · {stageLabel(d.stage)} · {L("เอกสาร", "Document", "单据")} {i + 1}/{list.length}</p>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <IconBtn title={L("ก่อนหน้า (←)", "Previous (←)", "上一个 (←)")} disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={16} /></IconBtn>
            <IconBtn title={L("ถัดไป (→)", "Next (→)", "下一个 (→)")} disabled={i === list.length - 1} onClick={() => setI(i + 1)}><ChevronRight size={16} /></IconBtn>
            <span className="w-px h-6 bg-line mx-1" />
          </div>
          <button onClick={() => void pdf()} disabled={loading || pdfBusy} className="h-9 px-3 rounded-xl bg-ink text-surface text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50">{pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}<span className="hidden sm:inline">PDF</span></button>
          <IconBtn title={L("พิมพ์", "Print", "打印")} disabled={loading} onClick={() => actions()?.print()}><Printer size={15} /></IconBtn>
          <IconBtn title={copied ? L("คัดลอกแล้ว", "Copied", "已复制") : L("คัดลอกลิงก์แชร์", "Copy share link", "复制分享链接")} onClick={() => void copy()}>{copied ? <Check size={15} className="text-ok" /> : <Link2 size={15} />}</IconBtn>
          <a href={d.url!} target="_blank" rel="noopener" title={L("เปิดในแท็บใหม่", "Open in new tab", "在新标签页打开")} className="h-9 w-9 grid place-items-center rounded-xl border border-line text-muted hover:text-ink hover:bg-surface2"><ExternalLink size={15} /></a>
          <IconBtn title={L("ปิด (Esc)", "Close (Esc)", "关闭 (Esc)")} onClick={onClose}><X size={17} /></IconBtn>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* รายการเอกสารของบิล */}
          {list.length > 1 ? (
            <nav className="hidden md:flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface2/40 p-3">
              {groups.map(([stage, items]) => (
                <div key={stage} className="space-y-1">
                  <p className="text-[10.5px] font-semibold text-muted px-1.5 uppercase tracking-wide">{stageLabel(stage)}</p>
                  {items.map(({ x, idx }) => {
                    const XI = ICON[x.kind];
                    return (
                      <button key={x.key} onClick={() => setI(idx)} className={`w-full text-left rounded-xl px-2.5 py-2 flex items-center gap-2.5 transition ${idx === i ? "bg-surface shadow-sm ring-1 ring-brand/25" : "hover:bg-surface/70"}`}>
                        <span className={`h-7 w-7 grid place-items-center rounded-lg shrink-0 ${TINT[x.kind]}`}><XI size={13} /></span>
                        <span className="min-w-0">
                          <span className={`block text-xs font-medium truncate ${x.status === "cancelled" ? "line-through text-muted" : ""}`}>{x.title}</span>
                          <span className="block text-[10px] text-muted font-mono truncate" translate="no">{x.doc_no}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          ) : null}
          {/* กระดาษ */}
          <div className="relative flex-1 min-w-0 bg-[#eef0f3]" translate="no">
            {loading ? <div className="absolute inset-0 grid place-items-center text-muted text-xs gap-2 z-[1]"><span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 shadow"><Loader2 size={14} className="animate-spin" />{L("กำลังเปิดเอกสาร…", "Opening document…", "正在打开单据…")}</span></div> : null}
            <iframe ref={frame} key={d.key} src={`${d.url}?embed=1`} title={d.title} onLoad={() => setLoading(false)} className={`w-full h-full border-0 transition-opacity ${loading ? "opacity-0" : "opacity-100"}`} />
          </div>
        </div>
        {/* มือถือ: เลื่อนเอกสาร */}
        {list.length > 1 ? (
          <footer className="sm:hidden flex items-center justify-between gap-2 px-3 py-2 border-t border-line">
            <IconBtn title={L("ก่อนหน้า", "Previous", "上一个")} disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={16} /></IconBtn>
            <span className="text-xs text-muted">{i + 1} / {list.length}</span>
            <IconBtn title={L("ถัดไป", "Next", "下一个")} disabled={i === list.length - 1} onClick={() => setI(i + 1)}><ChevronRight size={16} /></IconBtn>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} className="h-9 w-9 grid place-items-center rounded-xl border border-line text-muted hover:text-ink hover:bg-surface2 disabled:opacity-35 disabled:pointer-events-none">{children}</button>;
}
