"use client";
// ไฟล์แนบใบโอน (โหมดจริง) — อัปโหลดรูปสินค้า/เอกสารขึ้น Storage ส่วนตัว · ดูรูปในหน้าเดิม (ไม่เปิดแท็บใหม่) · ลบได้
//   ใช้ /api/pos/transfer-files (สิทธิ์ transfer.request + สาขาต้นทาง/ปลายทาง)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, Loader2, FileText, X, ChevronLeft, ChevronRight, Download, Camera } from "lucide-react";
import { useToast } from "@/components/toast-host";
import { useL } from "@/lib/i18n/provider";

type F = { id: string; name: string; type: string; size: number; url: string | null; at: string; by_name?: string | null; stage?: string | null };

export function TransferFiles({ transferId, stage }: { transferId: string; stage?: string }) {
  const toast = useToast();
  const L = useL();
  const [files, setFiles] = useState<F[] | null>(null), [busy, setBusy] = useState(false), [lb, setLb] = useState<number | null>(null);
  async function load() {
    try { const r = await fetch(`/api/pos/transfer-files?id=${encodeURIComponent(transferId)}`, { cache: "no-store" }); const j = await r.json(); setFiles(r.ok ? j.files : []); } catch { setFiles([]); }
  }
  useEffect(() => { void load(); }, [transferId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const fd = new FormData(); fd.set("id", transferId); if (stage) fd.set("stage", stage);
    [...list].slice(0, 20).forEach((f) => fd.append("file", f));
    setBusy(true);
    try {
      const r = await fetch("/api/pos/transfer-files", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (j.uploaded) toast.push({ tone: "ok", title: L(`แนบไฟล์แล้ว ${j.uploaded} ไฟล์`, `Attached ${j.uploaded} file(s)`, `已附加 ${j.uploaded} 个文件`) });
      if (j.skipped?.length) toast.push({ tone: "warn", title: L(`ข้าม ${j.skipped.length} ไฟล์`, `Skipped ${j.skipped.length} file(s)`, `已跳过 ${j.skipped.length} 个文件`), body: j.skipped.map((x: { name: string; reason: string }) => `${x.name}: ${x.reason}`).join("\n") });
      if (!r.ok && !j.skipped?.length) toast.push({ tone: "danger", title: L("แนบไฟล์ไม่สำเร็จ", "Attachment failed", "附件上传失败"), body: j.error ?? `HTTP ${r.status}` });
      await load();
    } catch (e) { toast.push({ tone: "danger", title: L("แนบไฟล์ไม่สำเร็จ", "Attachment failed", "附件上传失败"), body: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    const r = await fetch(`/api/pos/transfer-files?file_id=${id}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast.push({ tone: "danger", title: L("ลบไฟล์ไม่สำเร็จ", "Could not delete file", "删除文件失败"), body: j.error }); }
    setLb(null); await load();
  }
  const list = files ?? [];
  const imgs = list.filter((f) => f.type.startsWith("image/") && f.url);
  const cur = lb !== null ? imgs[lb] : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-sm font-medium">{L("เอกสาร / รูปแนบ", "Documents / photos", "单据 / 附图")} <span className="text-muted font-normal">({list.length})</span></p>
        <div className="flex gap-1.5">
          <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line text-xs font-medium hover:bg-surface2 cursor-pointer sm:hidden">
            <Camera size={14} /> {L("ถ่ายรูป", "Take photo", "拍照")}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void upload(e.target.files); e.currentTarget.value = ""; }} />
          </label>
          <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-brand/40 text-brand text-xs font-medium hover:bg-brand/10 cursor-pointer">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {busy ? L("กำลังอัปโหลด…", "Uploading…", "上传中…") : L("เพิ่มไฟล์", "Add files", "添加文件")}
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" className="hidden" disabled={busy} onChange={(e) => { void upload(e.target.files); e.currentTarget.value = ""; }} />
          </label>
        </div>
      </div>
      {files === null ? <p className="text-xs text-muted">{L("กำลังโหลด…", "Loading…", "加载中…")}</p> : list.length ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {list.map((f) => (
            <div key={f.id} className="relative group rounded-xl border border-line overflow-hidden bg-surface2">
              {f.type.startsWith("image/") && f.url
                ? <button onClick={() => setLb(imgs.findIndex((x) => x.id === f.id))} className="block w-full"><img src={f.url} alt={f.name} className="w-full h-20 object-cover" /></button>
                : <a href={f.url ?? "#"} download={f.name} className="flex flex-col items-center justify-center h-20 gap-1 p-2 text-center w-full"><FileText size={22} className="text-muted" /><span className="text-[9px] text-muted truncate w-full">{f.name}</span></a>}
              <button onClick={() => void remove(f.id)} title={L("ลบไฟล์", "Delete file", "删除文件")} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-muted">{L("ยังไม่มีไฟล์แนบ — แนบรูปสินค้า (เช่น ของชำรุด) หรือเอกสารได้ไม่จำกัด · ไฟล์ละไม่เกิน 15MB", "No attachments yet — attach unlimited product photos (e.g. damaged items) or documents · max 15MB per file", "暂无附件 — 可不限数量附加商品照片（如破损品）或单据 · 每个文件不超过 15MB")}</p>}

      {cur && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm flex flex-col" onClick={() => setLb(null)}>
          <div className="flex items-center gap-2 p-3 text-white/90" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm truncate">{cur.name}</span>
            <span className="text-white/50 text-xs hidden sm:inline">{cur.by_name ? `· ${cur.by_name}` : ""} · {new Date(cur.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="ml-auto text-xs tabular-nums text-white/60">{(lb ?? 0) + 1}/{imgs.length}</span>
            <a href={cur.url!} download={cur.name} className="w-9 h-9 rounded-full hover:bg-white/10 grid place-items-center" title={L("บันทึก", "Save", "保存")}><Download size={17} /></a>
            <button onClick={() => setLb(null)} className="w-9 h-9 rounded-full hover:bg-white/10 grid place-items-center"><X size={18} /></button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-2 pb-4" onClick={(e) => e.stopPropagation()}>
            <button disabled={!lb} onClick={() => setLb((lb ?? 0) - 1)} className="w-10 h-10 rounded-full bg-white/10 text-white grid place-items-center disabled:opacity-30"><ChevronLeft size={20} /></button>
            <img src={cur.url!} alt={cur.name} className="max-h-full max-w-[calc(100%-6rem)] object-contain rounded-lg" />
            <button disabled={(lb ?? 0) >= imgs.length - 1} onClick={() => setLb((lb ?? 0) + 1)} className="w-10 h-10 rounded-full bg-white/10 text-white grid place-items-center disabled:opacity-30"><ChevronRight size={20} /></button>
          </div>
        </div>, document.body,
      ) : null}
    </div>
  );
}
