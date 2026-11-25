"use client";
// เครื่องมือรายงาน (ใช้ร่วมได้ทุกหน้ารายงาน): มุมมองที่บันทึก · แชร์ลิงก์ · ดาวน์โหลด PDF/รูปภาพ/Excel — แบบเดียวกับเอกสาร
//   • มุมมอง: บันทึกตัวกรอง+แท็บไว้บนเซิร์ฟเวอร์ (ของตัวเอง หรือแชร์ทั้งทีม) → เปิดซ้ำได้ทุกเครื่อง
//   • แชร์: ลิงก์ทีม (ต้องล็อกอิน เห็นตามสิทธิ์ตัวเอง) · ลิงก์ภาพนิ่ง (ไม่ต้องล็อกอิน ตัวเลขที่สรุปแล้ว ไม่มีข้อมูลลูกค้า หมดอายุ/ยกเลิกได้)
//   • ดาวน์โหลด: PDF / PNG ของหน้ารายงาน · Excel สรุปทุกส่วน
import { useEffect, useRef, useState } from "react";
import { Bookmark, Share2, Download, Check, Link2, Globe2, Trash2, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, Users, Lock, Save } from "lucide-react";
import { downloadExcel } from "@/lib/export";
import { useToast } from "@/components/toast-host";
import { Modal, Button, Input, Field } from "@/components/ui";

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}
function Menu({ icon, label, children, open, setOpen, wide }: { icon: React.ReactNode; label: string; children: React.ReactNode; open: boolean; setOpen: (v: boolean) => void; wide?: boolean }) {
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className={`h-9 px-3 rounded-xl border text-sm inline-flex items-center gap-1.5 transition-colors ${open ? "border-brand/50 bg-brand/5 text-brand" : "border-line bg-surface hover:bg-surface2"}`}>{icon}{label}</button>
      {open ? <div className={`absolute right-0 top-11 z-40 ${wide ? "w-80" : "w-64"} rounded-2xl border border-line bg-surface shadow-pop p-1.5 animate-slideUp`}>{children}</div> : null}
    </div>
  );
}
const Item = ({ icon, title, sub, onClick, danger, disabled }: { icon: React.ReactNode; title: string; sub?: string; onClick: () => void; danger?: boolean; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} className={`w-full text-left rounded-xl px-2.5 py-2 flex items-start gap-2.5 hover:bg-surface2 disabled:opacity-40 ${danger ? "text-danger" : ""}`}>
    <span className="mt-0.5 text-muted shrink-0">{icon}</span><span className="min-w-0"><span className="block text-[13px] font-medium">{title}</span>{sub ? <span className="block text-[11px] text-muted leading-snug">{sub}</span> : null}</span>
  </button>
);

export type ReportState = Record<string, unknown>;
type View = { id: string; name: string; state: ReportState; shared: boolean; mine: boolean; owner: string; updated_at: string };

// ── มุมมองที่บันทึก ──
export function ViewsMenu({ report, current, onApply }: { report: string; current: () => ReportState; onApply: (s: ReportState) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false), [views, setViews] = useState<View[] | null>(null), [saveOpen, setSaveOpen] = useState(false), [name, setName] = useState(""), [shared, setShared] = useState(false), [busy, setBusy] = useState(false);
  async function load() { const r = await fetch(`/api/admin/report-views?report=${report}`, { cache: "no-store" }); const j = await r.json(); setViews(r.ok ? j.views : []); }
  useEffect(() => { if (open && !views) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true);
    const r = await fetch("/api/admin/report-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report, name, shared, state: current() }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { toast.push({ tone: "danger", title: "บันทึกมุมมองไม่สำเร็จ", body: j.error }); return; }
    toast.push({ tone: "ok", title: `บันทึกมุมมอง “${name}” แล้ว`, body: shared ? "ทุกคนที่ดูรายงานได้จะเห็นมุมมองนี้" : "เห็นเฉพาะคุณ" });
    setSaveOpen(false); setName(""); setShared(false); await load();
  }
  async function del(v: View) { await fetch(`/api/admin/report-views?id=${v.id}`, { method: "DELETE" }); await load(); }
  const mine = (views ?? []).filter((v) => v.mine), team = (views ?? []).filter((v) => !v.mine);
  return (
    <>
      <Menu icon={<Bookmark size={15} />} label="มุมมอง" open={open} setOpen={setOpen} wide>
        <Item icon={<Save size={15} />} title="บันทึกมุมมองนี้" sub="เก็บตัวกรอง ช่วงวันที่ และแท็บที่เปิดอยู่" onClick={() => { setOpen(false); setSaveOpen(true); }} />
        <div className="border-t border-line my-1" />
        {views === null ? <p className="text-xs text-muted px-3 py-2 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />กำลังโหลด…</p> : !views.length ? <p className="text-xs text-muted px-3 py-2">ยังไม่มีมุมมองที่บันทึก</p> : null}
        {[["ของฉัน", mine], ["ทีมแชร์ให้", team]].map(([label, list]) => (list as View[]).length ? (
          <div key={label as string}>
            <p className="text-[10.5px] font-semibold text-muted px-2.5 pt-1.5 pb-1">{label as string}</p>
            {(list as View[]).map((v) => (
              <div key={v.id} className="group flex items-center rounded-xl hover:bg-surface2">
                <button onClick={() => { onApply(v.state); setOpen(false); toast.push({ tone: "info", title: `เปิดมุมมอง “${v.name}”` }); }} className="flex-1 text-left px-2.5 py-2 min-w-0">
                  <span className="text-[13px] font-medium flex items-center gap-1.5 truncate">{v.shared ? <Users size={12} className="text-brand shrink-0" /> : <Lock size={12} className="text-muted shrink-0" />}{v.name}</span>
                  {!v.mine ? <span className="block text-[10.5px] text-muted">โดย {v.owner}</span> : null}
                </button>
                {v.mine ? <button onClick={() => void del(v)} title="ลบ" className="opacity-0 group-hover:opacity-100 p-2 text-muted hover:text-danger"><Trash2 size={13} /></button> : null}
              </div>
            ))}
          </div>
        ) : null)}
      </Menu>
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="บันทึกมุมมอง" size="sm"
        footer={<><Button variant="ghost" onClick={() => setSaveOpen(false)}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>บันทึก</Button></>}>
        <div className="space-y-3">
          <Field label="ชื่อมุมมอง"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ยอดเดือนนี้ · แบรนด์ Dreame" /></Field>
          <label className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 accent-[rgb(var(--c-brand))]" />
            <span><span className="text-sm font-medium">แชร์ให้ทีม</span><span className="block text-[11px] text-muted">ทุกคนที่มีสิทธิ์ดูรายงานเปิดมุมมองนี้ได้ (แต่ละคนเห็นข้อมูลตามสิทธิ์สาขาของตัวเอง)</span></span>
          </label>
        </div>
      </Modal>
    </>
  );
}

// ── แชร์ ──
export function ShareMenu({ teamUrl, snapshot, title, canPublic = true }: { teamUrl: () => string; snapshot: () => unknown; title: () => string; canPublic?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(""), [publicOpen, setPublicOpen] = useState(false), [days, setDays] = useState(30), [busy, setBusy] = useState(false), [made, setMade] = useState<string | null>(null);
  const [links, setLinks] = useState<{ id: string; title: string; created_at: string; expires_at: string; revoked_at: string | null; view_count: number }[] | null>(null);
  const copy = async (t: string, key: string) => { try { await navigator.clipboard.writeText(t); setCopied(key); setTimeout(() => setCopied(""), 1800); } catch { /* */ } };
  async function loadLinks() { const r = await fetch("/api/admin/report-share", { cache: "no-store" }); const j = await r.json(); setLinks(r.ok ? j.links : []); }
  async function create() {
    setBusy(true);
    const r = await fetch("/api/admin/report-share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title(), payload: snapshot(), days }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { toast.push({ tone: "danger", title: "สร้างลิงก์ไม่สำเร็จ", body: j.error }); return; }
    const url = new URL(j.url, window.location.origin).href; setMade(url); await copy(url, "public"); await loadLinks();
  }
  async function revoke(id: string) { await fetch(`/api/admin/report-share?id=${id}`, { method: "DELETE" }); await loadLinks(); }
  return (
    <>
      <Menu icon={<Share2 size={15} />} label="แชร์" open={open} setOpen={setOpen} wide>
        <Item icon={copied === "team" ? <Check size={15} className="text-ok" /> : <Link2 size={15} />} title={copied === "team" ? "คัดลอกลิงก์แล้ว" : "คัดลอกลิงก์สำหรับทีม"} sub="เปิดมุมมองเดียวกันนี้ · ผู้เปิดต้องล็อกอินและเห็นข้อมูลตามสิทธิ์ตัวเอง" onClick={() => void copy(teamUrl(), "team")} />
        <Item disabled={!canPublic} icon={<Globe2 size={15} />} title={canPublic ? "สร้างลิงก์แชร์ภาพนิ่ง" : "สร้างลิงก์แชร์ภาพนิ่ง (ไม่มีสิทธิ์)"} sub="เปิดได้โดยไม่ต้องล็อกอิน · ตัวเลข ณ ตอนนี้ · ไม่มีข้อมูลลูกค้า · ตั้งวันหมดอายุ/ยกเลิกได้" onClick={() => { setOpen(false); setMade(null); setPublicOpen(true); void loadLinks(); }} />
      </Menu>
      <Modal open={publicOpen} onClose={() => setPublicOpen(false)} title="ลิงก์แชร์รายงาน (ภาพนิ่ง)" size="md"
        footer={<><Button variant="ghost" onClick={() => setPublicOpen(false)}>ปิด</Button><Button variant="primary" loading={busy} onClick={() => void create()}><Globe2 size={15} /> สร้างลิงก์ + คัดลอก</Button></>}>
        <div className="space-y-3 text-sm">
          <p className="text-muted text-[12.5px]">ระบบบันทึกตัวเลขที่สรุปแล้วของหน้านี้ (ไม่ใช่ข้อมูลสด) — ผู้รับเปิดดูได้ทันที ดาวน์โหลด PDF ได้ · ไม่มีชื่อ/เบอร์ลูกค้า</p>
          <Field label="อายุลิงก์"><div className="flex gap-1.5">{[1, 7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`h-8 px-3 rounded-lg border text-xs ${days === d ? "border-brand bg-brand/8 text-brand" : "border-line"}`}>{d} วัน</button>)}</div></Field>
          {made ? <div className="rounded-xl border border-ok/30 bg-ok/5 px-3 py-2.5 text-xs flex items-center gap-2"><Check size={14} className="text-ok shrink-0" /><span className="truncate font-mono flex-1">{made}</span><button onClick={() => void copy(made, "public")} className="text-brand shrink-0">{copied === "public" ? "คัดลอกแล้ว" : "คัดลอก"}</button></div> : null}
          {links?.length ? <div>
            <p className="text-[11px] font-semibold text-muted mb-1">ลิงก์ที่ฉันสร้าง</p>
            <div className="max-h-48 overflow-auto rounded-xl border border-line divide-y divide-line">
              {links.map((l) => { const dead = !!l.revoked_at || new Date(l.expires_at) < new Date(); return (
                <div key={l.id} className="px-3 py-2 text-xs flex items-center gap-2">
                  <span className="min-w-0 flex-1"><span className={`block truncate ${dead ? "line-through text-muted" : ""}`}>{l.title}</span><span className="block text-[10.5px] text-muted">{new Date(l.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })} · เปิด {l.view_count} ครั้ง · {l.revoked_at ? "ยกเลิกแล้ว" : `หมด ${new Date(l.expires_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`}</span></span>
                  {!dead ? <button onClick={() => void revoke(l.id)} className="text-danger text-[11px] shrink-0">ยกเลิกลิงก์</button> : null}
                </div>); })}
            </div></div> : null}
        </div>
      </Modal>
    </>
  );
}

// ── ดาวน์โหลด ──
export async function exportElement(el: HTMLElement, filename: string, kind: "pdf" | "png") {
  const prevBg = el.style.background; el.style.background = getComputedStyle(document.body).backgroundColor || "#ffffff";
  try {
    if (kind === "png") {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: el.style.background });
      const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = `${filename}.png`; a.click();
    } else {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf().set({ margin: 6, filename: `${filename}.pdf`, image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "landscape" }, pagebreak: { mode: ["css", "legacy"] } }).from(el).save();
    }
  } finally { el.style.background = prevBg; }
}
export function DownloadMenu({ target, filename, excel, extra }: { target: () => HTMLElement | null; filename: () => string; excel?: () => { title: string; rows: { section: string; label: string; value: string | number }[] }; extra?: { title: string; sub?: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<"" | "pdf" | "png">("");
  async function run(kind: "pdf" | "png") { const el = target(); if (!el) return; setBusy(kind); try { await exportElement(el, filename(), kind); } finally { setBusy(""); setOpen(false); } }
  return (
    <Menu icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} label="ดาวน์โหลด" open={open} setOpen={setOpen}>
      <Item icon={<FileText size={15} />} title="PDF" sub="หน้ารายงานที่เห็นอยู่ (A4 แนวนอน)" disabled={!!busy} onClick={() => void run("pdf")} />
      <Item icon={<ImageIcon size={15} />} title="รูปภาพ PNG" sub="ส่งต่อในแชตได้ทันที" disabled={!!busy} onClick={() => void run("png")} />
      {excel ? <Item icon={<FileSpreadsheet size={15} />} title="Excel สรุป" sub="ทุกตัวเลขในหน้า แยกเป็นหมวด" onClick={() => { const x = excel(); downloadExcel(`${filename()}.xls`, [{ key: "section", label: "หมวด" }, { key: "label", label: "รายการ" }, { key: "value", label: "ค่า" }], x.rows, x.title); setOpen(false); }} /> : null}
      {extra?.map((e) => <Item key={e.title} icon={<FileSpreadsheet size={15} />} title={e.title} sub={e.sub} onClick={() => { e.onClick(); setOpen(false); }} />)}
    </Menu>
  );
}
