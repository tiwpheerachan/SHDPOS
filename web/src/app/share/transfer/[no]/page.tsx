"use client";
// ─────────────────────────────────────────────────────────────
// หน้าแชร์ใบโอนย้าย (อ่านอย่างเดียว) — เห็นเฉพาะฟอร์มใบนี้เท่านั้น
// ลิงก์: /share/transfer/<transfer_no>  · ไม่มีเมนู/แถบนำทาง
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, ChevronLeft, ChevronRight, X, Download, FileText, ArrowRight, PackageCheck } from "lucide-react";
import { bootstrap, listAllTransfers, listBranches, listEmployees } from "@/lib/data/repo";
import type { Transfer, Branch, Employee, TransferAttachment } from "@/lib/types";

const fmtDT = (s?: string | null) => (s ? new Date(s).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "—");

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "ร่าง", cls: "bg-slate-100 text-slate-600" },
  pending_approval: { label: "รออนุมัติ", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "อนุมัติแล้ว", cls: "bg-sky-100 text-sky-700" },
  picking: { label: "กำลังจัด", cls: "bg-sky-100 text-sky-700" },
  packed: { label: "แพ็คแล้ว", cls: "bg-sky-100 text-sky-700" },
  shipped: { label: "จัดส่งแล้ว", cls: "bg-indigo-100 text-indigo-700" },
  in_transit: { label: "ระหว่างทาง", cls: "bg-indigo-100 text-indigo-700" },
  partial_received: { label: "รับบางส่วน", cls: "bg-amber-100 text-amber-700" },
  received: { label: "รับแล้ว", cls: "bg-emerald-100 text-emerald-700" },
  completed: { label: "เสร็จสิ้น", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "ยกเลิก", cls: "bg-slate-100 text-slate-500" },
  rejected: { label: "ปฏิเสธ", cls: "bg-rose-100 text-rose-700" },
};

export default function ShareTransferPage() {
  const params = useParams();
  const no = decodeURIComponent(String(params?.no ?? ""));
  const [ready, setReady] = useState(false);
  const [tr, setTr] = useState<Transfer | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [lb, setLb] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await bootstrap();
        const [all, bs, es] = await Promise.all([listAllTransfers(), listBranches(), listEmployees()]);
        setTr(all.find((t) => t.transfer_no === no) ?? null);
        setBranches(bs); setEmps(es);
      } finally { setReady(true); }
    })();
  }, [no]);

  const bName = (id?: string | null) => branches.find((b) => b.id === id)?.name ?? id ?? "—";
  const eName = (id?: string | null) => { const e = emps.find((x) => x.id === id); return e ? (e.nickname || `${e.first_name}${e.last_name ? " " + e.last_name : ""}`) : "—"; };
  const st = tr ? (STATUS[tr.status] ?? { label: tr.status, cls: "bg-slate-100 text-slate-600" }) : null;
  const atts = useMemo(() => tr?.attachments ?? [], [tr]);

  if (!ready) return <Center>กำลังโหลด…</Center>;
  if (!tr) return <Center><div className="text-center"><p className="text-lg font-semibold">ไม่พบใบโอนย้าย</p><p className="text-sm text-slate-500 mt-1">เลขที่ {no}</p></div></Center>;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 py-6 px-4 print:bg-white print:py-0">
      <div className="mx-auto max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl print:shadow-none border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* หัวกระดาษ */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">SHD · Stock Transfer</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">ใบโอนย้ายสินค้า</h1>
            <p className="font-mono text-sm text-indigo-600 dark:text-indigo-400 mt-0.5">{tr.transfer_no}</p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st!.cls}`}>{st!.label}</span>
        </div>

        {/* เส้นทาง */}
        <div className="px-6 py-4 flex items-center gap-3 text-sm bg-slate-50 dark:bg-slate-800/40">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-400">ต้นทาง{tr.from_kind === "warehouse" ? " (คลัง)" : ""}</p>
            <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{bName(tr.from_branch_id)}</p>
          </div>
          <ArrowRight size={18} className="text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0 text-right">
            <p className="text-[11px] text-slate-400">ปลายทาง</p>
            <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{bName(tr.to_branch_id)}</p>
          </div>
        </div>

        {/* ข้อมูลใบ */}
        <div className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm border-b border-slate-200 dark:border-slate-800">
          <Field label="วันที่สร้าง" value={fmtDT(tr.created_at)} />
          <Field label="กำหนดรับ" value={fmtDT(tr.expected_date)} />
          <Field label="ผู้ขอ" value={eName(tr.requested_by)} />
          <Field label="ผู้อนุมัติ" value={tr.approved_by ? eName(tr.approved_by) : "—"} />
          {tr.carrier ? <Field label="ขนส่ง" value={tr.carrier} /> : null}
          {tr.tracking ? <Field label="เลขพัสดุ" value={tr.tracking} /> : null}
          {tr.reference_no ? <Field label="อ้างอิง" value={tr.reference_no} /> : null}
          {tr.jst_allocation_no ? <Field label="JST" value={tr.jst_allocation_no} /> : null}
        </div>

        {/* รายการสินค้า */}
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-slate-500 mb-2 inline-flex items-center gap-1.5"><PackageCheck size={14} /> รายการสินค้า ({tr.items.length})</p>
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs">
                <tr><th className="text-left font-medium px-3 py-2">สินค้า</th><th className="text-center font-medium px-2 py-2 w-16">ขอ</th><th className="text-center font-medium px-2 py-2 w-16">ส่ง</th><th className="text-center font-medium px-2 py-2 w-16">รับ</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tr.items.map((it) => (
                  <tr key={it.product_id} className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{it.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{it.sku}{it.isSerialized ? " · SN" : ""}</p>
                      {it.shippedSerials?.length ? <p className="text-[10px] text-slate-400 mt-0.5 break-all">SN: {it.shippedSerials.map((s) => s.serialNo).join(", ")}</p> : null}
                    </td>
                    <td className="text-center px-2 py-2 tabular-nums">{it.qty_requested}</td>
                    <td className="text-center px-2 py-2 tabular-nums">{it.qty_shipped || "—"}</td>
                    <td className="text-center px-2 py-2 tabular-nums font-semibold">{it.qty_received || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tr.note || tr.approval_note ? <p className="text-xs text-slate-500 mt-3"><span className="font-medium">หมายเหตุ:</span> {tr.approval_note || tr.note}</p> : null}
        </div>

        {/* รูปแนบ */}
        {atts.length ? (
          <div className="px-6 pb-4 print:hidden">
            <p className="text-xs font-semibold text-slate-500 mb-2">เอกสาร / รูปแนบ ({atts.length})</p>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {atts.map((a, i) => (
                <button key={a.id} onClick={() => setLb(i)} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-800 aspect-square">
                  {a.type?.startsWith("image/") ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><FileText size={20} className="text-slate-400" /></div>}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ท้ายกระดาษ */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 print:hidden">
          <span>แชร์แบบอ่านอย่างเดียว · SHD POS</span>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-indigo-600"><Printer size={13} /> พิมพ์ / บันทึก PDF</button>
        </div>
      </div>

      {/* lightbox รูปแนบ (เลื่อนซ้ายขวา + บันทึก) */}
      {lb !== null && atts.length ? <Lightbox atts={atts} idx={lb} setIdx={setLb} /> : null}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen grid place-items-center bg-slate-100 dark:bg-slate-950 text-slate-500 text-sm p-6">{children}</div>;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-[11px] text-slate-400">{label}</p><p className="text-slate-800 dark:text-slate-100">{value}</p></div>;
}

function Lightbox({ atts, idx, setIdx }: { atts: TransferAttachment[]; idx: number; setIdx: (n: number | null) => void }) {
  const i = Math.min(idx, atts.length - 1); const a = atts[i];
  const go = (d: number) => setIdx((i + d + atts.length) % atts.length);
  const isImg = a.type?.startsWith("image/");
  const dl = () => { try { const l = document.createElement("a"); l.href = a.url; l.download = a.name || "file"; l.target = "_blank"; document.body.appendChild(l); l.click(); l.remove(); } catch { /* ignore */ } };
  return (
    <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex flex-col" onClick={() => setIdx(null)}>
      <div className="flex items-center gap-2 p-3 text-white/90" onClick={(e) => e.stopPropagation()}>
        <span className="text-xs text-white/60 truncate">{a.name}</span>
        <span className="ml-auto text-xs tabular-nums text-white/60">{i + 1}/{atts.length}</span>
        <button onClick={() => setIdx(null)} className="w-9 h-9 rounded-full hover:bg-white/10 grid place-items-center text-white"><X size={18} /></button>
      </div>
      <div className="flex-1 relative flex items-center justify-center px-4 min-h-0" onClick={(e) => e.stopPropagation()}>
        {isImg ? <img src={a.url} alt={a.name} className="max-w-full max-h-full object-contain rounded-lg" /> : <div className="text-white/60 flex flex-col items-center gap-2"><FileText size={56} /><span className="text-sm">{a.name}</span></div>}
        {atts.length > 1 ? <>
          <button onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white grid place-items-center"><ChevronLeft size={22} /></button>
          <button onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white grid place-items-center"><ChevronRight size={22} /></button>
        </> : null}
      </div>
      <div className="p-3 flex justify-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={dl} className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm inline-flex items-center gap-1.5"><Download size={15} /> บันทึก</button>
      </div>
    </div>
  );
}
