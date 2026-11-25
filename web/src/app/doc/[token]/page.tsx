"use client";
// หน้าเอกสาร (แชร์ได้) — A4 พร้อมพิมพ์ · ดาวน์โหลด PDF · คัดลอกลิงก์ · แชร์ · QR ตรวจสอบ
//   ข้อมูลจาก /api/doc/[token] (ลิงก์ลงลายเซ็น) · ไม่มีเมนูของระบบ
import { Fragment, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Printer, Download, Link2, Share2, Loader2, Check, Lock } from "lucide-react";
import type { DocPayload } from "@/lib/doc-types";

const TONE: Record<string, string> = { ok: "#059669", warn: "#d97706", error: "#dc2626", info: "#0284c7", none: "#9ca3af" };

export default function DocPage() {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<DocPayload | null>(null), [err, setErr] = useState<{ msg: string; login?: boolean } | null>(null);
  const [exp, setExp] = useState<string | null>(null), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch(`/api/doc/${token}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) setErr({ msg: j.error, login: j.login }); else { setDoc(j.doc); setExp(j.expires_at); document.title = `${j.doc.title} ${j.doc.doc_no}`; } })
      .catch(() => setErr({ msg: "โหลดเอกสารไม่สำเร็จ" }));
  }, [token]);
  const url = typeof window !== "undefined" ? window.location.href : "";

  async function pdf() {
    if (!paper.current || !doc) return;
    setBusy(true);
    const el = paper.current, prev = { minHeight: el.style.minHeight, boxShadow: el.style.boxShadow };
    // ความสูงขั้นต่ำ A4 บนจอ + การปัดเศษ px→mm ทำให้เกิดหน้าว่างท้าย PDF → ตอนสร้างใช้ความสูงตามเนื้อหา
    el.style.minHeight = "auto"; el.style.boxShadow = "none";
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf().set({ margin: 0, filename: `${doc.doc_no}-${doc.kind}.pdf`, image: { type: "jpeg", quality: 0.96 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }, pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".avoid-break"] } }).from(el).save();
    } finally { el.style.minHeight = prev.minHeight; el.style.boxShadow = prev.boxShadow; setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ } }
  async function share() { if (navigator.share && doc) { try { await navigator.share({ title: `${doc.title} ${doc.doc_no}`, url }); } catch { /* ยกเลิก */ } } else void copy(); }

  if (err) return (
    <main className="min-h-screen grid place-items-center bg-[#f3f4f6] p-6">
      <div className="max-w-sm text-center space-y-3 bg-white rounded-2xl shadow p-8">
        {err.login ? <Lock className="mx-auto text-gray-400" /> : null}
        <p className="text-sm text-gray-700">{err.msg}</p>
        {err.login ? <a href={`/sso/login?next=${encodeURIComponent(`/doc/${token}`)}`} className="inline-block text-sm font-medium text-white bg-gray-900 rounded-xl px-4 py-2">เข้าสู่ระบบ</a> : null}
      </div>
    </main>
  );
  if (!doc) return <main className="min-h-screen grid place-items-center bg-[#f3f4f6] text-gray-500 text-sm gap-2"><Loader2 className="animate-spin" />กำลังโหลดเอกสาร…</main>;

  return (
    <main className="min-h-screen bg-[#e5e7eb] print:bg-white">
      <style>{`@page { size: A4; margin: 0 } @media print { .no-print { display: none !important } .sheet { box-shadow: none !important; margin: 0 !important } }`}</style>
      <div className="no-print sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-[210mm] mx-auto px-4 py-2.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 mr-auto">{doc.title} <span className="font-mono text-gray-500 font-normal">{doc.doc_no}</span>{doc.internal ? <span className="ml-2 text-[11px] text-red-600">เอกสารภายใน</span> : null}</p>
          <Btn onClick={() => void pdf()} icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} label="ดาวน์โหลด PDF" primary />
          <Btn onClick={() => window.print()} icon={<Printer size={14} />} label="พิมพ์" />
          <Btn onClick={() => void copy()} icon={copied ? <Check size={14} /> : <Link2 size={14} />} label={copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"} />
          {!doc.internal ? <Btn onClick={() => void share()} icon={<Share2 size={14} />} label="แชร์" /> : null}
        </div>
      </div>

      <div className="py-6 print:py-0 px-2">
        <div ref={paper} className="sheet relative mx-auto bg-white text-gray-900 shadow-xl w-[210mm] min-h-[297mm] px-[16mm] py-[14mm] text-[11.5px] leading-relaxed" style={{ fontFamily: "'Sarabun','Noto Sans Thai','Prompt',system-ui,sans-serif" }}>
          {doc.watermark ? <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden"><span className="text-[110px] font-bold text-red-500/10 -rotate-[30deg] whitespace-nowrap">{doc.watermark}</span></div> : null}

          {/* หัวเอกสาร */}
          <header className="flex items-start gap-6 pb-4 border-b-2 border-gray-900">
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold">{doc.seller.name}</p>
              {doc.seller.name_en ? <p className="text-gray-600">{doc.seller.name_en}</p> : null}
              {doc.seller.address ? <p className="text-gray-600">{doc.seller.address}</p> : null}
              <p className="text-gray-600">{[doc.seller.tax_id ? `เลขประจำตัวผู้เสียภาษี ${doc.seller.tax_id}` : null, doc.seller.branch_label].filter(Boolean).join(" · ")}</p>
              {doc.seller.phone ? <p className="text-gray-600">โทร {doc.seller.phone}</p> : null}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[18px] font-bold leading-tight">{doc.title}</p>
              <p className="text-[11px] tracking-wider text-gray-500">{doc.title_en}</p>
              {doc.subtitle ? <p className="text-[10.5px] text-gray-500 mt-0.5">{doc.subtitle}</p> : null}
            </div>
          </header>

          {/* คู่ค้า + อ้างอิง */}
          <section className="grid grid-cols-[1fr_230px] gap-4 py-4">
            <div className="rounded-lg border border-gray-300 px-3 py-2.5 min-h-[70px]">
              {doc.party ? <>
                <p className="text-[10.5px] text-gray-500">{doc.party.label}</p>
                <p className="font-semibold">{doc.party.name}</p>
                {doc.party.tax_id ? <p>เลขประจำตัวผู้เสียภาษี {doc.party.tax_id}{doc.party.branch_label ? ` · ${doc.party.branch_label}` : ""}</p> : null}
                {doc.party.address ? <p className="text-gray-700">{doc.party.address}</p> : null}
                {doc.party.phone ? <p className="text-gray-700">โทร {doc.party.phone}</p> : null}
              </> : <p className="text-gray-400">ลูกค้าทั่วไป</p>}
            </div>
            <dl className="rounded-lg border border-gray-300 px-3 py-2 space-y-0.5">
              {doc.refs.map((r, i) => <div key={i} className="flex justify-between gap-2"><dt className="text-gray-500 shrink-0">{r.label}</dt><dd className="font-medium text-right break-all">{r.value}</dd></div>)}
            </dl>
          </section>

          {/* ส่วนรายละเอียด (รายงานภายใน) */}
          {doc.sections?.length ? (
            <section className="space-y-2.5 mb-4">
              {doc.sections.map((s, i) => (
                <div key={i} className="avoid-break rounded-lg border border-gray-300 overflow-hidden">
                  <p className="px-3 py-1.5 font-semibold text-[12px] flex items-center gap-2 bg-gray-50"><span className="h-2 w-2 rounded-full" style={{ background: TONE[s.tone ?? "none"] }} />{i + 1}. {s.title}</p>
                  {s.lines.length ? <dl className="px-3 py-1.5 grid grid-cols-[170px_1fr] gap-x-3 gap-y-0.5">{s.lines.map((l, j) => <Fragment key={j}><dt className="text-gray-500">{l.label}</dt><dd className="break-words">{l.value}</dd></Fragment>)}</dl> : null}
                </div>
              ))}
            </section>
          ) : null}

          {/* ตาราง */}
          {doc.table ? (
            <table className="w-full border-collapse mb-3">
              <thead><tr className="bg-gray-900 text-white">
                <th className="px-2 py-1.5 text-left font-semibold w-[34px]">#</th>
                {doc.table.columns.map((c, i) => <th key={i} className="px-2 py-1.5 font-semibold" style={{ textAlign: c.align ?? "left", width: c.width }}>{c.label}</th>)}
              </tr></thead>
              <tbody>{doc.table.rows.map((r, i) => (
                <tr key={i} className={`border-b border-gray-200 align-top ${r.muted ? "text-gray-400" : ""}`}>
                  <td className="px-2 py-1.5 text-gray-500">{i + 1}</td>
                  {r.cells.map((c, j) => <td key={j} className="px-2 py-1.5" style={{ textAlign: doc.table!.columns[j]?.align ?? "left" }}>{c}{j === 0 && r.sub ? <div className="text-[10px] text-gray-500 font-mono">{r.sub}</div> : null}</td>)}
                </tr>))}
                {!doc.table.rows.length ? <tr><td colSpan={doc.table.columns.length + 1} className="px-2 py-4 text-center text-gray-400">ไม่มีรายการ</td></tr> : null}
              </tbody>
            </table>
          ) : null}

          {/* ยอดเงิน + การชำระ */}
          {doc.totals?.length || doc.payments?.length ? (
            <section className="grid grid-cols-[1fr_260px] gap-4 avoid-break">
              <div>{doc.payments?.length ? <div className="rounded-lg border border-gray-300 px-3 py-2"><p className="text-[10.5px] text-gray-500 mb-0.5">การชำระเงิน</p>{doc.payments.map((p, i) => <p key={i} className="flex justify-between gap-2"><span>{p.label}</span><span className="tabular-nums">{p.value}</span></p>)}</div> : null}</div>
              <dl className="space-y-0.5">{(doc.totals ?? []).map((t, i) => <div key={i} className={`flex justify-between gap-2 px-2 ${t.strong ? "border-y-2 border-gray-900 py-1 text-[13px] font-bold" : ""}`}><dt>{t.label}</dt><dd className="tabular-nums">{t.value}</dd></div>)}</dl>
            </section>
          ) : null}

          {doc.notes?.length ? <ul className="mt-4 space-y-0.5 text-[10.5px] text-gray-600 list-disc pl-4">{doc.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}

          {doc.signatures?.length ? (
            <section className="mt-10 grid gap-10 avoid-break" style={{ gridTemplateColumns: `repeat(${doc.signatures.length}, 1fr)` }}>
              {doc.signatures.map((s, i) => <div key={i} className="text-center"><div className="border-b border-dotted border-gray-500 h-10" /><p className="mt-1">{s}</p><p className="text-gray-500 text-[10px]">วันที่ ......../......../........</p></div>)}
            </section>
          ) : null}

          <footer className="mt-8 pt-3 border-t border-gray-200 flex items-end gap-4 text-[10px] text-gray-500 avoid-break">
            <div className="flex-1">
              <p>เลขที่เอกสาร {doc.doc_no} · {doc.date}{doc.issued_by ? ` · ออกโดย ${doc.issued_by}` : ""}</p>
              <p>เอกสารนี้สร้างจากระบบ SHD POS · สแกน QR เพื่อเปิดต้นฉบับออนไลน์{exp ? ` (ลิงก์ใช้ได้ถึง ${new Date(exp).toLocaleDateString("th-TH", { dateStyle: "medium" })})` : ""}</p>
            </div>
            {!doc.internal && url ? <QRCodeSVG value={url} size={64} level="M" /> : null}
          </footer>
        </div>
      </div>
    </main>
  );
}

function Btn({ onClick, icon, label, primary }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean }) {
  return <button onClick={onClick} className={`h-9 px-3 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 ${primary ? "bg-gray-900 text-white hover:bg-gray-800" : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>{icon}{label}</button>;
}
