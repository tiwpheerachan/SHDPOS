"use client";
// ปุ่ม "เอกสาร" ของใบโอน → เปิดหน้าต่างดูเอกสาร (ใบส่ง/ใบรับ/รายงานผลต่าง) ในระบบ ไม่ไปแท็บใหม่
import { useState } from "react";
import { FileStack, Loader2 } from "lucide-react";
import { DocViewer } from "@/components/doc-viewer";
import type { OrderDocItem } from "@/lib/doc-types";

export function TransferDocsButton({ transferId, className }: { transferId: string; className?: string }) {
  const [docs, setDocs] = useState<OrderDocItem[] | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  async function open() {
    setBusy(true); setNote("");
    try {
      const r = await fetch(`/api/pos/transfer-docs?id=${encodeURIComponent(transferId)}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      const list = (j.docs ?? []) as OrderDocItem[];
      if (!list.some((d) => d.available)) { setNote(j.reason ?? "ยังไม่มีเอกสาร"); return; }
      setDocs(list);
    } catch (e) { setNote(e instanceof Error ? e.message : "เปิดเอกสารไม่สำเร็จ"); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={() => void open()} disabled={busy} className={className ?? "btn-soft"} title="ใบส่งสินค้า · ใบรับสินค้า · รายงานผลต่าง">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <FileStack size={15} />} เอกสาร
      </button>
      {note ? <span className="text-[11px] text-muted max-w-[220px] truncate" title={note}>{note}</span> : null}
      {docs ? <DocViewer docs={docs} startKey={docs.find((d) => d.available)!.key} onClose={() => setDocs(null)} /> : null}
    </span>
  );
}
