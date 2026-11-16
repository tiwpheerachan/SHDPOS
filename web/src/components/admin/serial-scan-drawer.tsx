"use client";

// สแกน Serial แบบป๊อปอัปด้านขวา (slide-over) — ใช้ตอนสแกนออก / รับเข้า
//   โชว์รูป+ชื่อสินค้า, ตัวนับ N/qty, และ (โหมดรับเข้า) กระทบ SN สด ครบ/ขาด/เกิน/ซ้ำ
import { useEffect, useRef, useState } from "react";
import { ScanLine, Package, Plus, Trash2, Check } from "lucide-react";
import { Drawer, Button, Badge } from "@/components/ui";
import { reconcileSerials } from "@/lib/onewarehouse";

type Locale = "th" | "en" | "zh";

export function SerialScanDrawer({
  open, onClose, mode, product, qty, shipped = [], initial, onSave, locale,
}: {
  open: boolean;
  onClose: () => void;
  mode: "out" | "in";
  product: { name: string; sku?: string | null; image?: string | null };
  qty: number;
  shipped?: string[];           // รายการ SN ที่ส่งมา (โหมด in ใช้กระทบ)
  initial: string[];
  onSave: (serials: string[]) => void;
  locale: Locale;
}) {
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const openEnded = qty <= 0; // qty=0 → สแกนเท่าไหร่ก็ได้ (ตอนเปิดบิล จำนวน = จำนวน SN ที่ยิง)

  useEffect(() => { if (open) { setList(initial); setDraft(""); setTimeout(() => inputRef.current?.focus(), 50); } }, [open, initial]);

  function add(v0?: string) {
    const v = (v0 ?? draft).trim().toUpperCase();
    setDraft("");
    if (!v) return;
    if (list.includes(v)) { inputRef.current?.focus(); return; }
    setList((l) => [...l, v]);
    inputRef.current?.focus();
  }

  const rec = mode === "in" ? reconcileSerials(shipped, list) : null;
  const done = mode === "in" ? (rec?.ok ?? false) : openEnded ? list.length > 0 : list.length === qty;
  const countLabel = openEnded ? `${list.length}` : `${list.length}/${qty}`;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title={L("สแกน Serial", "Scan serials", "扫描序列号")}
      badge={<Badge tone={done ? "ok" : "warn"}>{countLabel}</Badge>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button>
          <Button variant="primary" className="ml-auto" onClick={() => onSave(list)}>
            <Check size={15} /> {L("บันทึก", "Save", "保存")} ({countLabel})
          </Button>
        </>
      }
    >
      <div className="p-4 space-y-4">
        {/* สินค้าที่กำลังสแกน */}
        <div className="flex items-center gap-3 bg-surface2 border border-line rounded-2xl p-3">
          <div className="w-14 h-14 rounded-xl border border-line bg-surface overflow-hidden grid place-items-center shrink-0">
            {product.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
              : <Package size={24} className="text-muted/40" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{product.name}</p>
            {product.sku ? <p className="text-[11px] text-muted font-mono truncate">{product.sku}</p> : null}
            <p className="text-[11px] text-muted mt-0.5">{mode === "in" ? L("สแกนรับเข้า", "Scan to receive", "扫描入库") : L("สแกนส่งออก", "Scan to ship", "扫描出库")}{openEnded ? ` · ${L("ยิงกี่ชิ้นก็ได้", "scan any qty", "任意数量")}` : ` · ${L("ต้องครบ", "need", "需")} ${qty}`}</p>
          </div>
        </div>

        {/* ช่องยิง */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              placeholder={L("ยิงบาร์โค้ด SN แล้วยิงต่อได้เลย", "Scan SN, then next…", "扫描 SN 后继续")}
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-surface2 border border-line text-sm font-mono outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <Button variant="soft" onClick={() => add()}><Plus size={16} /></Button>
        </div>

        {/* กระทบ SN (โหมดรับเข้า) */}
        {mode === "in" && rec ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge tone="ok">{L("ตรง", "Matched", "匹配")} {rec.matched.length}</Badge>
            {rec.missing.length ? <Badge tone="warn">{L("ขาด", "Missing", "缺")} {rec.missing.length}</Badge> : null}
            {rec.extra.length ? <Badge tone="danger">{L("ไม่ตรง/เกิน", "Not shipped", "多出")} {rec.extra.length}</Badge> : null}
            {rec.duplicates.length ? <Badge tone="danger">{L("ซ้ำ", "Dup", "重复")} {rec.duplicates.length}</Badge> : null}
            {rec.ok ? <Badge tone="brand">{L("ครบถูกต้อง ✓", "All correct ✓", "全部正确 ✓")}</Badge> : null}
          </div>
        ) : null}

        {/* รายการที่สแกนแล้ว */}
        <ul className="space-y-1.5 max-h-[46vh] overflow-y-auto">
          {list.length ? list.map((s, i) => {
            const bad = mode === "in" && rec && (rec.extra.includes(s) || (rec.duplicates.includes(s)));
            return (
              <li key={s + i} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${bad ? "bg-danger/5 border-danger/40" : "bg-surface2 border-line"}`}>
                <span className="text-[10px] text-muted w-5 tnum">{i + 1}</span>
                <span className="text-xs font-mono flex-1 truncate">{s}</span>
                {bad ? <Badge tone="danger">{rec!.duplicates.includes(s) ? L("ซ้ำ", "dup", "重复") : L("ไม่ตรง", "extra", "多")}</Badge> : <Check size={13} className="text-ok" />}
                <button onClick={() => setList((l) => l.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger shrink-0"><Trash2 size={13} /></button>
              </li>
            );
          }) : <li className="text-xs text-muted text-center py-8">{L("ยังไม่ได้สแกน — ยิงบาร์โค้ด SN เลย", "No serials yet — scan a SN", "尚未扫描")}</li>}
        </ul>
      </div>
    </Drawer>
  );
}
