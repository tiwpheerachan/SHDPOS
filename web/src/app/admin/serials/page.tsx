"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, Package, ArrowDownLeft, ArrowUpRight, ShoppingCart, RotateCcw, MapPin, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useAdminScope } from "@/components/admin/filters";
import { Card, CardHeader, Badge, Button, EmptyState } from "@/components/ui";
import { resolveSerial, recentSerials, type SerialInfo, type SerialEventKind } from "@/lib/data/serials";

const KIND_META: Record<SerialEventKind, { icon: typeof ArrowDownLeft; th: string; en: string; zh: string; color: string }> = {
  received: { icon: ArrowDownLeft, th: "รับเข้า", en: "Received", zh: "入库", color: "rgb(var(--c-mint))" },
  shipped: { icon: ArrowUpRight, th: "ส่งออก", en: "Shipped", zh: "出库", color: "rgb(var(--c-aqua))" },
  sold: { icon: ShoppingCart, th: "ขายออก", en: "Sold", zh: "售出", color: "rgb(var(--c-brand))" },
  returned: { icon: RotateCcw, th: "รับคืน", en: "Returned", zh: "退货", color: "rgb(var(--c-peach))" },
};
const STATUS_META: Record<SerialInfo["status"], { th: string; en: string; zh: string; tone: "ok" | "info" | "brand" | "warn" | "neutral" }> = {
  in_stock: { th: "อยู่ในคลัง", en: "In stock", zh: "在库", tone: "ok" },
  in_transit: { th: "กำลังส่ง (ระหว่างทาง)", en: "In transit", zh: "在途", tone: "info" },
  sold: { th: "ขายออกแล้ว", en: "Sold", zh: "已售", tone: "brand" },
  returned: { th: "รับคืน", en: "Returned", zh: "已退货", tone: "warn" },
  unknown: { th: "ไม่พบในระบบ", en: "Not found", zh: "未找到", tone: "neutral" },
};

export default function AdminSerialsPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { branches } = useAdminScope();
  const branchName = (id: string | null) => {
    if (!id) return "—";
    const b = branches.find((x) => x.id === id);
    return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id;
  };

  const [q, setQ] = useState("");
  const [info, setInfo] = useState<SerialInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ serialNo: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void recentSerials(12).then(setRecent); inputRef.current?.focus(); }, []);

  async function lookup(sn: string) {
    const v = sn.trim();
    if (!v) return;
    setBusy(true);
    try { setInfo(await resolveSerial(v)); } finally { setBusy(false); }
  }

  const dt = (iso: string) => new Date(iso).toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

  const st = info ? STATUS_META[info.status] : null;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
      {/* หัว */}
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-brand/12 grid place-items-center"><ScanLine size={18} className="text-brand" /></span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{L("ตามรอย Serial (SN)", "Serial tracking", "序列追踪")}</h1>
          <p className="text-[11px] text-muted">{L("สแกน/พิมพ์ SN แล้วดูว่าเป็นสินค้าอะไร + เดินทางมายังไง", "Scan/type a SN to see the product & its journey", "扫描/输入 SN 查看商品与流转")}</p>
        </div>
      </div>

      {/* ช่องสแกน */}
      <Card>
        <div className="p-4">
          <form onSubmit={(e) => { e.preventDefault(); void lookup(q); }} className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                ref={inputRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={L("ยิงบาร์โค้ด/พิมพ์ Serial แล้วกด Enter", "Scan barcode / type Serial, then Enter", "扫码/输入序列号后回车")}
                className="w-full h-12 pl-10 pr-10 rounded-xl bg-surface2 border border-line text-base font-mono tracking-wide outline-none focus:ring-2 focus:ring-brand/30"
              />
              {q ? <button type="button" onClick={() => { setQ(""); setInfo(null); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={16} /></button> : null}
            </div>
            <Button variant="primary" loading={busy} type="submit"><Search size={16} /> {L("ค้นหา", "Find", "查询")}</Button>
          </form>
          {recent.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted self-center">{L("ล่าสุด", "Recent", "最近")}:</span>
              {recent.map((r) => (
                <button key={r.serialNo} onClick={() => { setQ(r.serialNo); void lookup(r.serialNo); }} className="text-[11px] font-mono px-2 py-1 rounded-lg border border-line bg-surface hover:border-brand hover:text-brand transition-colors" title={r.name}>{r.serialNo}</button>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {/* ผลลัพธ์ */}
      {info ? (
        info.status === "unknown" ? (
          <Card><div className="p-6"><EmptyState icon={<ScanLine size={26} />} title={L("ไม่พบ Serial นี้ในระบบ", "Serial not found", "未找到该序列号")} body={info.serialNo} /></div></Card>
        ) : (
          <>
            {/* การ์ดสินค้า */}
            <Card>
              <div className="p-4 flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl border border-line bg-surface2 overflow-hidden grid place-items-center shrink-0">
                  {info.product?.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={info.product.image_url} alt={info.product.name} className="w-full h-full object-cover" />
                    : <Package size={30} className="text-muted/40" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-muted">{info.serialNo}</p>
                  <p className="text-lg font-bold leading-tight truncate">{info.product?.name || L("ไม่ทราบสินค้า", "Unknown product", "未知商品")}</p>
                  <p className="text-xs text-muted font-mono mt-0.5">{info.product?.sku}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {st ? <Badge tone={st.tone}>{L(st.th, st.en, st.zh)}</Badge> : null}
                    <span className="inline-flex items-center gap-1 text-xs text-muted"><MapPin size={13} /> {info.status === "in_transit" ? L("ระหว่างทาง", "In transit", "在途") : branchName(info.currentBranchId)}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* ไทม์ไลน์การเดินทาง */}
            <Card>
              <CardHeader title={L("เส้นทางของชิ้นนี้", "This item's journey", "此件流转")} subtitle={`${info.events.length} ${L("เหตุการณ์", "events", "个事件")}`} />
              <div className="p-5 pt-3">
                <ol className="relative border-l-2 border-line ml-2 space-y-5">
                  {info.events.map((ev, i) => {
                    const m = KIND_META[ev.kind];
                    const Icon = m.icon;
                    return (
                      <li key={i} className="ml-5 relative">
                        <span className="absolute -left-[31px] top-0 w-6 h-6 rounded-full grid place-items-center ring-4 ring-surface" style={{ background: m.color }}>
                          <Icon size={13} className="text-white" />
                        </span>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{L(m.th, m.en, m.zh)} <span className="text-muted font-normal">· {branchName(ev.branchId)}</span></p>
                          <span className="text-[11px] text-muted tnum">{dt(ev.at)}</span>
                        </div>
                        <p className="text-[11px] text-muted font-mono mt-0.5">{ev.refNo}</p>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </Card>
          </>
        )
      ) : (
        <Card><div className="p-8"><EmptyState icon={<ScanLine size={26} />} title={L("ยังไม่ได้สแกน", "Scan a serial to start", "请先扫描序列号")} body={L("ยิงบาร์โค้ด SN หรือกดจากรายการล่าสุด", "Scan a SN barcode or tap a recent one", "扫描 SN 条码或点击最近项")} /></div></Card>
      )}
    </div>
  );
}
