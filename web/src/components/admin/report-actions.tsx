"use client";
// เครื่องมือรายงาน (ใช้ร่วมได้ทุกหน้ารายงาน): มุมมองที่บันทึก · แชร์ลิงก์ · ดาวน์โหลด PDF/รูปภาพ/Excel — แบบเดียวกับเอกสาร
//   • มุมมอง: บันทึกตัวกรอง+แท็บไว้บนเซิร์ฟเวอร์ (ของตัวเอง หรือแชร์ทั้งทีม) → เปิดซ้ำได้ทุกเครื่อง
//   • แชร์: ลิงก์ทีม (ต้องล็อกอิน เห็นตามสิทธิ์ตัวเอง) · ลิงก์ภาพนิ่ง (ไม่ต้องล็อกอิน ตัวเลขที่สรุปแล้ว ไม่มีข้อมูลลูกค้า หมดอายุ/ยกเลิกได้)
//   • ดาวน์โหลด: PDF / PNG ของหน้ารายงาน · Excel สรุปทุกส่วน
import { useEffect, useRef, useState } from "react";
import { Bookmark, Share2, Download, Check, Link2, Globe2, Trash2, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, Users, Lock, Save } from "lucide-react";
import { downloadExcel } from "@/lib/export";
import { tr } from "@/lib/i18n/tr";
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
    if (!r.ok) { toast.push({ tone: "danger", title: tr("บันทึกมุมมองไม่สำเร็จ", "Failed to save view", "保存视图失败"), body: j.error }); return; }
    toast.push({ tone: "ok", title: tr(`บันทึกมุมมอง “${name}” แล้ว`, `View “${name}” saved`, `已保存视图“${name}”`), body: shared ? tr("ทุกคนที่ดูรายงานได้จะเห็นมุมมองนี้", "Everyone who can view reports will see this view", "所有可查看报表的人都能看到此视图") : tr("เห็นเฉพาะคุณ", "Only you can see it", "仅您可见") });
    setSaveOpen(false); setName(""); setShared(false); await load();
  }
  async function del(v: View) { await fetch(`/api/admin/report-views?id=${v.id}`, { method: "DELETE" }); await load(); }
  const mine = (views ?? []).filter((v) => v.mine), team = (views ?? []).filter((v) => !v.mine);
  return (
    <>
      <Menu icon={<Bookmark size={15} />} label={tr("มุมมอง", "Views", "视图")} open={open} setOpen={setOpen} wide>
        <Item icon={<Save size={15} />} title={tr("บันทึกมุมมองนี้", "Save this view", "保存此视图")} sub={tr("เก็บตัวกรอง ช่วงวันที่ และแท็บที่เปิดอยู่", "Keeps filters, date range and open tab", "保存筛选、日期范围和当前标签页")} onClick={() => { setOpen(false); setSaveOpen(true); }} />
        <div className="border-t border-line my-1" />
        {views === null ? <p className="text-xs text-muted px-3 py-2 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />{tr("กำลังโหลด…", "Loading…", "加载中…")}</p> : !views.length ? <p className="text-xs text-muted px-3 py-2">{tr("ยังไม่มีมุมมองที่บันทึก", "No saved views yet", "暂无已保存的视图")}</p> : null}
        {[[tr("ของฉัน", "Mine", "我的"), mine], [tr("ทีมแชร์ให้", "Shared by team", "团队共享"), team]].map(([label, list]) => (list as View[]).length ? (
          <div key={label as string}>
            <p className="text-[10.5px] font-semibold text-muted px-2.5 pt-1.5 pb-1">{label as string}</p>
            {(list as View[]).map((v) => (
              <div key={v.id} className="group flex items-center rounded-xl hover:bg-surface2">
                <button onClick={() => { onApply(v.state); setOpen(false); toast.push({ tone: "info", title: tr(`เปิดมุมมอง “${v.name}”`, `Opened view “${v.name}”`, `已打开视图“${v.name}”`) }); }} className="flex-1 text-left px-2.5 py-2 min-w-0">
                  <span className="text-[13px] font-medium flex items-center gap-1.5 truncate">{v.shared ? <Users size={12} className="text-brand shrink-0" /> : <Lock size={12} className="text-muted shrink-0" />}{v.name}</span>
                  {!v.mine ? <span className="block text-[10.5px] text-muted">{tr("โดย", "by", "创建者")} <span translate="no">{v.owner}</span></span> : null}
                </button>
                {v.mine ? <button onClick={() => void del(v)} title={tr("ลบ", "Delete", "删除")} className="opacity-0 group-hover:opacity-100 p-2 text-muted hover:text-danger"><Trash2 size={13} /></button> : null}
              </div>
            ))}
          </div>
        ) : null)}
      </Menu>
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={tr("บันทึกมุมมอง", "Save view", "保存视图")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setSaveOpen(false)}>{tr("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>{tr("บันทึก", "Save", "保存")}</Button></>}>
        <div className="space-y-3">
          <Field label={tr("ชื่อมุมมอง", "View name", "视图名称")}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("เช่น ยอดเดือนนี้ · แบรนด์ Dreame", "e.g. This month · Dreame brand", "例如 本月销售 · Dreame 品牌")} /></Field>
          <label className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 accent-[rgb(var(--c-brand))]" />
            <span><span className="text-sm font-medium">{tr("แชร์ให้ทีม", "Share with team", "与团队共享")}</span><span className="block text-[11px] text-muted">{tr("ทุกคนที่มีสิทธิ์ดูรายงานเปิดมุมมองนี้ได้ (แต่ละคนเห็นข้อมูลตามสิทธิ์สาขาของตัวเอง)", "Anyone with report access can open this view (each sees data per their own branch access)", "有报表权限的人都可打开此视图（各自按门店权限查看数据）")}</span></span>
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
    if (!r.ok) { toast.push({ tone: "danger", title: tr("สร้างลิงก์ไม่สำเร็จ", "Failed to create link", "创建链接失败"), body: j.error }); return; }
    const url = new URL(j.url, window.location.origin).href; setMade(url); await copy(url, "public"); await loadLinks();
  }
  async function revoke(id: string) { await fetch(`/api/admin/report-share?id=${id}`, { method: "DELETE" }); await loadLinks(); }
  return (
    <>
      <Menu icon={<Share2 size={15} />} label={tr("แชร์", "Share", "分享")} open={open} setOpen={setOpen} wide>
        <Item icon={copied === "team" ? <Check size={15} className="text-ok" /> : <Link2 size={15} />} title={copied === "team" ? tr("คัดลอกลิงก์แล้ว", "Link copied", "链接已复制") : tr("คัดลอกลิงก์สำหรับทีม", "Copy team link", "复制团队链接")} sub={tr("เปิดมุมมองเดียวกันนี้ · ผู้เปิดต้องล็อกอินและเห็นข้อมูลตามสิทธิ์ตัวเอง", "Opens this same view · viewers must log in and see data per their access", "打开相同视图 · 需登录并按各自权限查看数据")} onClick={() => void copy(teamUrl(), "team")} />
        <Item disabled={!canPublic} icon={<Globe2 size={15} />} title={canPublic ? tr("สร้างลิงก์แชร์ภาพนิ่ง", "Create snapshot share link", "创建快照分享链接") : tr("สร้างลิงก์แชร์ภาพนิ่ง (ไม่มีสิทธิ์)", "Create snapshot share link (no permission)", "创建快照分享链接（无权限）")} sub={tr("เปิดได้โดยไม่ต้องล็อกอิน · ตัวเลข ณ ตอนนี้ · ไม่มีข้อมูลลูกค้า · ตั้งวันหมดอายุ/ยกเลิกได้", "No login needed · numbers as of now · no customer data · expiry/revoke available", "无需登录 · 当前数据 · 不含顾客信息 · 可设有效期/撤销")} onClick={() => { setOpen(false); setMade(null); setPublicOpen(true); void loadLinks(); }} />
      </Menu>
      <Modal open={publicOpen} onClose={() => setPublicOpen(false)} title={tr("ลิงก์แชร์รายงาน (ภาพนิ่ง)", "Report share link (snapshot)", "报表分享链接（快照）")} size="md"
        footer={<><Button variant="ghost" onClick={() => setPublicOpen(false)}>{tr("ปิด", "Close", "关闭")}</Button><Button variant="primary" loading={busy} onClick={() => void create()}><Globe2 size={15} /> {tr("สร้างลิงก์ + คัดลอก", "Create link + copy", "创建链接并复制")}</Button></>}>
        <div className="space-y-3 text-sm">
          <p className="text-muted text-[12.5px]">{tr("ระบบบันทึกตัวเลขที่สรุปแล้วของหน้านี้ (ไม่ใช่ข้อมูลสด) — ผู้รับเปิดดูได้ทันที ดาวน์โหลด PDF ได้ · ไม่มีชื่อ/เบอร์ลูกค้า", "Saves this page's summarized numbers (not live data) — recipients can view and download PDF instantly · no customer names/phones", "保存本页汇总数据（非实时）— 接收者可立即查看并下载 PDF · 不含顾客姓名/电话")}</p>
          <Field label={tr("อายุลิงก์", "Link expiry", "链接有效期")}><div className="flex gap-1.5">{[1, 7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`h-8 px-3 rounded-lg border text-xs ${days === d ? "border-brand bg-brand/8 text-brand" : "border-line"}`}>{tr(`${d} วัน`, `${d} days`, `${d} 天`)}</button>)}</div></Field>
          {made ? <div className="rounded-xl border border-ok/30 bg-ok/5 px-3 py-2.5 text-xs flex items-center gap-2"><Check size={14} className="text-ok shrink-0" /><span className="truncate font-mono flex-1">{made}</span><button onClick={() => void copy(made, "public")} className="text-brand shrink-0">{copied === "public" ? tr("คัดลอกแล้ว", "Copied", "已复制") : tr("คัดลอก", "Copy", "复制")}</button></div> : null}
          {links?.length ? <div>
            <p className="text-[11px] font-semibold text-muted mb-1">{tr("ลิงก์ที่ฉันสร้าง", "My links", "我创建的链接")}</p>
            <div className="max-h-48 overflow-auto rounded-xl border border-line divide-y divide-line">
              {links.map((l) => { const dead = !!l.revoked_at || new Date(l.expires_at) < new Date(); return (
                <div key={l.id} className="px-3 py-2 text-xs flex items-center gap-2">
                  <span className="min-w-0 flex-1"><span className={`block truncate ${dead ? "line-through text-muted" : ""}`}>{l.title}</span><span className="block text-[10.5px] text-muted">{new Date(l.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })} · {tr(`เปิด ${l.view_count} ครั้ง`, `${l.view_count} views`, `打开 ${l.view_count} 次`)} · {l.revoked_at ? tr("ยกเลิกแล้ว", "Revoked", "已撤销") : `${tr("หมด", "Expires", "到期")} ${new Date(l.expires_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`}</span></span>
                  {!dead ? <button onClick={() => void revoke(l.id)} className="text-danger text-[11px] shrink-0">{tr("ยกเลิกลิงก์", "Revoke link", "撤销链接")}</button> : null}
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
    <Menu icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} label={tr("ดาวน์โหลด", "Download", "下载")} open={open} setOpen={setOpen}>
      <Item icon={<FileText size={15} />} title="PDF" sub={tr("หน้ารายงานที่เห็นอยู่ (A4 แนวนอน)", "Current report page (A4 landscape)", "当前报表页（A4 横向）")} disabled={!!busy} onClick={() => void run("pdf")} />
      <Item icon={<ImageIcon size={15} />} title={tr("รูปภาพ PNG", "PNG image", "PNG 图片")} sub={tr("ส่งต่อในแชตได้ทันที", "Ready to share in chat", "可直接在聊天中转发")} disabled={!!busy} onClick={() => void run("png")} />
      {excel ? <Item icon={<FileSpreadsheet size={15} />} title={tr("Excel สรุป", "Excel summary", "Excel 汇总")} sub={tr("ทุกตัวเลขในหน้า แยกเป็นหมวด", "All numbers on the page, by section", "页面全部数据，按类别分组")} onClick={() => { const x = excel(); downloadExcel(`${filename()}.xls`, [{ key: "section", label: tr("หมวด", "Section", "类别") }, { key: "label", label: tr("รายการ", "Item", "项目") }, { key: "value", label: tr("ค่า", "Value", "数值") }], x.rows, x.title); setOpen(false); }} /> : null}
      {extra?.map((e) => <Item key={e.title} icon={<FileSpreadsheet size={15} />} title={e.title} sub={e.sub} onClick={() => { e.onClick(); setOpen(false); }} />)}
    </Menu>
  );
}
