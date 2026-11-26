"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ScanLine, Package, ArrowDownLeft, ArrowUpRight, ShoppingCart, RotateCcw, MapPin, Search, X, ShieldCheck, Clock, Copy, Share2, Route, Store, History, ExternalLink, User, Printer, Check, Boxes, ShieldAlert, PackageX, CornerDownLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useAdminScope } from "@/components/admin/filters";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { resolveSerial, recentSerials, type SerialInfo, type SerialEventKind } from "@/lib/data/serials";
import { listEmployees } from "@/lib/data/repo";
import { owStatus, owSerial, type OwSerial } from "@/lib/onewarehouse/ow-client";
import { branchForWarehouseId } from "@/lib/onewarehouse/warehouse-map";
import type { Employee } from "@/lib/types";
import { coordOf } from "@/lib/geo";
import { formatTHB } from "@/lib/money";
import { AnimatedScan } from "@/components/animated-icons";

const KIND_META: Record<SerialEventKind, { icon: typeof ArrowDownLeft; th: string; en: string; zh: string; color: string }> = {
  received: { icon: ArrowDownLeft, th: "รับเข้า", en: "Received", zh: "入库", color: "rgb(var(--c-mint))" },
  shipped: { icon: ArrowUpRight, th: "ส่งออก", en: "Shipped", zh: "出库", color: "rgb(var(--c-aqua))" },
  sold: { icon: ShoppingCart, th: "ขายออก", en: "Sold", zh: "售出", color: "rgb(var(--c-brand))" },
  returned: { icon: RotateCcw, th: "ส่งคืน", en: "Return shipped", zh: "退回发出", color: "rgb(var(--c-peach))" },
  return_in: { icon: CornerDownLeft, th: "ต้นทางรับคืน", en: "Return received", zh: "退回收货", color: "rgb(var(--c-aqua))" },
  quarantined: { icon: PackageX, th: "พักตรวจ (นอกใบโอน)", en: "Quarantined", zh: "暂扣", color: "rgb(var(--c-peach))" },
  flagged: { icon: ShieldAlert, th: "ผลต่าง / ตรวจสอบ", en: "Discrepancy", zh: "差异", color: "#e11d48" },
};
const STATUS_META: Record<SerialInfo["status"], { th: string; en: string; zh: string; tone: "ok" | "info" | "brand" | "warn" | "neutral" | "danger" }> = {
  in_stock: { th: "อยู่ในคลัง", en: "In stock", zh: "在库", tone: "ok" },
  in_transit: { th: "กำลังส่ง (ระหว่างทาง)", en: "In transit", zh: "在途", tone: "info" },
  sold: { th: "ขายออกแล้ว", en: "Sold", zh: "已售", tone: "brand" },
  returned: { th: "รับคืนแล้ว", en: "Returned", zh: "已退货", tone: "warn" },
  quarantined: { th: "พักตรวจ (ขายไม่ได้)", en: "Quarantined", zh: "暂扣", tone: "danger" },
  unknown: { th: "ไม่พบในระบบ", en: "Not found", zh: "未找到", tone: "neutral" },
};

type Scanned = { serialNo: string; name: string; image: string | null; status: SerialInfo["status"]; at: number };

export default function AdminSerialsPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { branches } = useAdminScope();
  const pathname = usePathname();
  const snParam = useSearchParams().get("sn");
  const branch = (id: string | null) => (id ? branches.find((x) => x.id === id) ?? null : null);
  const branchName = (id: string | null) => { const b = branch(id); return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id ?? "—"; };

  const [q, setQ] = useState("");
  const [info, setInfo] = useState<SerialInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ serialNo: string; name: string }[]>([]);
  const [history, setHistory] = useState<Scanned[]>([]);
  const [copied, setCopied] = useState<"" | "sn" | "link">("");
  const [emps, setEmps] = useState<Employee[]>([]);
  const [owConn, setOwConn] = useState<boolean | null>(null);   // เชื่อม OneWarehouse แล้ว (มี token+sub)
  const [owInfo, setOwInfo] = useState<OwSerial | null>(null);  // ข้อมูล SN สดจาก OW
  const [owState, setOwState] = useState<"idle" | "loading" | "found" | "missing" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const empName = (id?: string | null) => { if (!id) return ""; const e = emps.find((x) => x.id === id); return e ? (e.nickname || `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || id) : ""; };

  useEffect(() => { void recentSerials(16).then(setRecent); void listEmployees().then(setEmps).catch(() => {}); void owStatus().then((s) => setOwConn(s.authConfigured)).catch(() => setOwConn(false)); inputRef.current?.focus(); }, []);
  useEffect(() => { if (snParam) { setQ(snParam); void lookup(snParam); } /* eslint-disable-next-line */ }, [snParam]);

  async function lookup(sn: string) {
    const v = sn.trim();
    if (!v) return;
    setBusy(true);
    setOwInfo(null);
    try {
      const r = await resolveSerial(v);
      setInfo(r);
      if (r.status !== "unknown") setHistory((h) => [{ serialNo: r.serialNo, name: r.product?.name ?? "", image: r.product?.image_url ?? null, status: r.status, at: Date.now() }, ...h.filter((x) => x.serialNo !== r.serialNo)].slice(0, 20));
    } finally { setBusy(false); inputRef.current?.select(); }
  }

  // ดึงสถานะสดจาก OneWarehouse เมื่อรู้ว่าเชื่อมแล้ว (เปิดจากลิงก์ ?sn= อาจค้นก่อนรู้สถานะการเชื่อม)
  useEffect(() => {
    if (!owConn || !info || info.status === "unknown") { setOwState("idle"); return; }
    let alive = true; setOwState("loading"); setOwInfo(null);
    void owSerial(info.serialNo).then((o) => { if (!alive) return; if (o.ok && o.data) { setOwInfo(o.data); setOwState("found"); } else setOwState(o.status === 404 ? "missing" : "error"); });
    return () => { alive = false; };
  }, [owConn, info]);

  const dt = (iso: string) => new Date(iso).toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const dateOnly = (iso: string | Date) => new Date(iso).toLocaleDateString(locale === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const fmtDur = (ms: number) => { const d = Math.floor(ms / 86400000); if (d >= 1) return `${d} ${L("วัน", "d", "天")}`; const h = Math.floor(ms / 3600000); if (h >= 1) return `${h} ${L("ชม.", "h", "时")}`; return `${Math.max(1, Math.floor(ms / 60000))} ${L("นาที", "m", "分")}`; };

  function copy(text: string, which: "sn" | "link") { try { void navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(""), 1500); } catch { /* ignore */ } }
  function shareLink() { if (typeof window !== "undefined" && info) copy(`${window.location.origin}${pathname}?sn=${encodeURIComponent(info.serialNo)}`, "link"); }
  function printLabel() {
    if (!info) return; const w = window.open("", "_blank", "width=460,height=320"); if (!w) return;
    w.document.write(`<!doctype html><meta charset=utf-8><title>SN ${info.serialNo}</title><body style="font-family:'Noto Sans Thai',Inter,sans-serif;margin:0;padding:22px;color:#161616"><div style="border:2px solid #161616;border-radius:12px;padding:18px 20px"><div style="font-size:10px;letter-spacing:.14em;color:#888;text-transform:uppercase">SHD POS · Serial</div><div style="font-size:17px;font-weight:800;margin:4px 0 2px">${(info.product?.name || "").replace(/</g, "&lt;")}</div><div style="font-size:11px;color:#777;font-family:monospace">${info.product?.sku ?? ""}</div><div style="margin-top:14px;font-family:monospace;font-size:26px;font-weight:700;letter-spacing:2px;border-top:1px dashed #ccc;padding-top:12px">${info.serialNo}</div></div><script>onload=function(){setTimeout(function(){print()},300)}</script></body>`);
    w.document.close();
  }

  const st = info ? STATUS_META[info.status] : null;

  // ── สมองกล: คำนวณประกัน + KPI การเดินทาง ──
  const insight = useMemo(() => {
    if (!info || info.status === "unknown" || !info.events.length) return null;
    const ev = info.events; const first = ev[0], last = ev[ev.length - 1];
    const branchesVisited = new Set(ev.map((e) => e.branchId)).size;
    const transfers = ev.filter((e) => e.kind === "shipped").length;
    const ageMs = Date.now() - new Date(first.at).getTime();
    const dwellMs = Date.now() - new Date(last.at).getTime();
    const months = info.product?.warranty_months ?? 0;
    let warranty: { months: number; started: boolean; start?: Date; expiry?: Date; daysLeft?: number; active?: boolean } | null = null;
    if (months > 0) {
      const saleAt = info.soldInfo?.at;
      if (saleAt) { const start = new Date(saleAt); const expiry = new Date(start); expiry.setMonth(expiry.getMonth() + months); const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000); warranty = { months, started: true, start, expiry, daysLeft, active: daysLeft > 0 }; }
      else warranty = { months, started: false };
    }
    return { branchesVisited, transfers, ageMs, dwellMs, warranty, first, last };
  }, [info]);

  const curBranch = info ? branch(info.currentBranchId) : null;
  const curCoord = coordOf(curBranch);

  const Tile = ({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: string }) => (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted mb-1">{icon} {label}</div>
      <div className={`text-lg font-bold leading-tight ${tone ?? ""}`}>{value}</div>
      {sub ? <div className="text-[11px] text-muted mt-0.5">{sub}</div> : null}
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-5 p-4 sm:p-6 items-start">
      {/* ───────── LEFT: สแกน + ประวัติ ───────── */}
      <aside className="w-full lg:w-[348px] lg:shrink-0 space-y-4 lg:sticky lg:top-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-brand/12 grid place-items-center"><AnimatedScan size={20} className="text-brand" /></span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("ตามรอย Serial (SN)", "Serial tracking", "序列追踪")}</h1>
            <p className="text-[11px] text-muted">{L("สแกน SN เพื่อรู้สินค้า + เส้นทาง + ประกัน", "Scan a SN for product, journey & warranty", "扫描 SN 查看商品、流转与保修")}</p>
            {owConn !== null ? (
              <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${owConn ? "bg-emerald-500/10 text-emerald-600" : "bg-surface2 text-muted"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${owConn ? "bg-emerald-500" : "bg-muted/40"}`} />
                {owConn ? L("เชื่อม OneWarehouse (สด)", "OneWarehouse live", "已连OneWarehouse") : L("ข้อมูลภายใน (ยังไม่เชื่อม OW)", "Internal data (OW off)", "内部数据")}
              </span>
            ) : null}
          </div>
        </div>

        <Card>
          <div className="p-4">
            <form onSubmit={(e) => { e.preventDefault(); void lookup(q); }} className="space-y-2">
              <div className="relative">
                <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={L("ยิงบาร์โค้ด / พิมพ์ SN แล้ว Enter", "Scan / type SN, then Enter", "扫码/输入后回车")}
                  className="w-full h-12 pl-10 pr-10 rounded-xl bg-surface2 border border-line text-base font-mono tracking-wide outline-none focus:ring-2 focus:ring-brand/30" />
                {q ? <button type="button" onClick={() => { setQ(""); setInfo(null); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={16} /></button> : null}
              </div>
              <Button variant="primary" loading={busy} type="submit" className="w-full h-10"><Search size={16} /> {L("ค้นหา", "Find", "查询")}</Button>
            </form>
          </div>
        </Card>

        {/* ประวัติสแกนรอบนี้ */}
        {history.length ? (
          <Card>
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-xs font-semibold inline-flex items-center gap-1.5"><History size={14} className="text-brand" /> {L("ประวัติสแกน", "Scan history", "扫描记录")}</span>
              <button onClick={() => setHistory([])} className="text-[11px] text-muted hover:text-brand">{L("ล้าง", "Clear", "清除")}</button>
            </div>
            <div className="max-h-[320px] overflow-auto divide-y divide-line/60">
              {history.map((h) => (
                <button key={h.serialNo} onClick={() => { setQ(h.serialNo); void lookup(h.serialNo); }} className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-brand/5 text-left">
                  {h.image ? <img src={h.image} alt="" className="w-8 h-8 rounded-lg object-cover border border-line bg-white shrink-0" /> : <div className="w-8 h-8 rounded-lg border border-line bg-surface grid place-items-center shrink-0 text-muted/40"><Boxes size={13} /></div>}
                  <div className="min-w-0 flex-1"><p className="font-mono text-[11px] truncate" translate="no">{h.serialNo}</p><p className="text-[10px] text-muted truncate">{h.name}</p></div>
                  <Badge tone={STATUS_META[h.status].tone}>{L(STATUS_META[h.status].th, STATUS_META[h.status].en, STATUS_META[h.status].zh)}</Badge>
                </button>
              ))}
            </div>
          </Card>
        ) : recent.length ? (
          <Card>
            <div className="px-4 pt-3 pb-2 text-xs font-semibold inline-flex items-center gap-1.5"><Clock size={14} className="text-brand" /> {L("ล่าสุดในระบบ", "Recent in system", "系统最近")}</div>
            <div className="px-4 pb-4 flex flex-wrap gap-1.5">
              {recent.map((r) => (
                <button key={r.serialNo} onClick={() => { setQ(r.serialNo); void lookup(r.serialNo); }} className="text-[11px] font-mono px-2 py-1 rounded-lg border border-line bg-surface hover:border-brand hover:text-brand transition-colors" title={r.name} translate="no">{r.serialNo}</button>
              ))}
            </div>
          </Card>
        ) : null}

        {/* legend */}
        <div className="flex flex-wrap gap-2 px-1">
          {(Object.keys(KIND_META) as SerialEventKind[]).map((k) => { const m = KIND_META[k]; return (
            <span key={k} className="inline-flex items-center gap-1 text-[11px] text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} /> {L(m.th, m.en, m.zh)}</span>
          ); })}
        </div>
      </aside>

      {/* ───────── RIGHT: ผลลัพธ์ ───────── */}
      <main className="flex-1 min-w-0 w-full">
        {!info ? (
          <div className="rounded-3xl border border-dashed border-line min-h-[60vh] grid place-items-center text-center p-8">
            <div>
              <div className="w-20 h-20 rounded-3xl bg-brand/10 grid place-items-center mx-auto mb-4"><AnimatedScan size={36} className="text-brand" /></div>
              <h2 className="text-xl font-semibold">{L("ยิงบาร์โค้ด SN เพื่อเริ่ม", "Scan a SN to start", "扫描 SN 开始")}</h2>
              <p className="text-sm text-muted mt-1 max-w-sm mx-auto">{L("ระบบจะบอกทันทีว่าเป็นสินค้าอะไร อยู่ที่ไหน เดินทางมายังไง และสถานะประกัน", "Instantly see the product, where it is, its journey and warranty", "立即查看商品、位置、流转与保修")}</p>
            </div>
          </div>
        ) : info.status === "unknown" ? (
          <Card><div className="p-10"><EmptyState icon={<ScanLine size={28} />} title={L("ไม่พบ Serial นี้ในระบบ", "Serial not found", "未找到该序列号")} body={info.serialNo} /></div></Card>
        ) : (
          <div className="space-y-4">
            {/* HERO */}
            <Card>
              <div className="p-5 flex flex-col sm:flex-row gap-5">
                <div className="w-28 h-28 rounded-2xl border border-line bg-white overflow-hidden grid place-items-center shrink-0">
                  {info.product?.image_url ? <img src={info.product.image_url} alt="" className="w-full h-full object-cover" /> : <Package size={40} className="text-muted/40" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {st ? <Badge tone={st.tone}>{L(st.th, st.en, st.zh)}</Badge> : null}
                    <span className="inline-flex items-center gap-1 text-xs text-muted"><MapPin size={13} /> {info.status === "in_transit" ? L("ระหว่างทาง", "In transit", "在途") : branchName(info.currentBranchId)}{curBranch?.province ? ` · ${curBranch.province}` : ""}</span>
                  </div>
                  <h2 className="text-xl font-bold leading-tight mt-1.5">{info.product?.name || L("ไม่ทราบสินค้า", "Unknown", "未知")}</h2>
                  <p className="text-xs text-muted font-mono">{info.product?.sku}{info.product?.price ? ` · ${formatTHB(info.product.price)}` : ""}</p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <code className="text-sm font-mono font-semibold bg-surface2 border border-line rounded-lg px-2.5 py-1" translate="no">{info.serialNo}</code>
                    <button onClick={() => copy(info.serialNo, "sn")} className="h-8 px-2.5 rounded-lg border border-line text-xs text-muted hover:text-brand hover:border-brand/40 inline-flex items-center gap-1">{copied === "sn" ? <Check size={13} className="text-ok" /> : <Copy size={13} />} {copied === "sn" ? L("คัดลอกแล้ว", "Copied", "已复制") : L("คัดลอก", "Copy", "复制")}</button>
                    <button onClick={shareLink} className="h-8 px-2.5 rounded-lg border border-line text-xs text-muted hover:text-brand hover:border-brand/40 inline-flex items-center gap-1">{copied === "link" ? <Check size={13} className="text-ok" /> : <Share2 size={13} />} {L("แชร์", "Share", "分享")}</button>
                    <button onClick={printLabel} className="h-8 px-2.5 rounded-lg border border-line text-xs text-muted hover:text-brand hover:border-brand/40 inline-flex items-center gap-1"><Printer size={13} /> {L("พิมพ์ป้าย", "Label", "标签")}</button>
                  </div>
                </div>
              </div>
            </Card>

            {/* KPI */}
            {insight ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile icon={<Clock size={12} />} label={L("อายุในระบบ", "Age in system", "系统时长")} value={fmtDur(insight.ageMs)} sub={`${L("ตั้งแต่", "since", "自")} ${dateOnly(insight.first.at)}`} />
                <Tile icon={<MapPin size={12} />} label={L("อยู่ที่นี่มา", "At current", "当前停留")} value={info.status === "in_transit" ? "—" : fmtDur(insight.dwellMs)} sub={info.status === "in_transit" ? L("กำลังส่ง", "in transit", "在途") : branchName(info.currentBranchId)} />
                <Tile icon={<Route size={12} />} label={L("ผ่านสาขา", "Branches", "经过门店")} value={`${insight.branchesVisited}`} sub={`${L("โอน", "transfers", "调拨")} ${insight.transfers} ${L("ครั้ง", "x", "次")}`} />
                <Tile icon={<ShieldCheck size={12} />} label={L("ประกัน", "Warranty", "保修")}
                  value={!insight.warranty ? "—" : !insight.warranty.started ? `${insight.warranty.months} ${L("ด.", "mo", "月")}` : insight.warranty.active ? `${insight.warranty.daysLeft} ${L("วัน", "d", "天")}` : L("หมดแล้ว", "Expired", "已过期")}
                  tone={insight.warranty?.started ? (insight.warranty.active ? "text-ok" : "text-rose-500") : ""}
                  sub={!insight.warranty ? L("ไม่มีข้อมูล", "n/a", "无") : !insight.warranty.started ? L("เริ่มเมื่อขาย", "starts at sale", "售出起") : insight.warranty.active ? `${L("ถึง", "until", "至")} ${dateOnly(insight.warranty.expiry!)}` : dateOnly(insight.warranty.expiry!)} />
              </div>
            ) : null}

            <div className="grid lg:grid-cols-5 gap-4">
              {/* TIMELINE */}
              <Card className="lg:col-span-3">
                <div className="px-5 pt-4 pb-1 text-sm font-semibold inline-flex items-center gap-1.5"><Route size={15} className="text-brand" /> {L("เส้นทางของชิ้นนี้", "This item's journey", "此件流转")} <span className="text-muted font-normal">· {info.events.length} {L("เหตุการณ์", "events", "事件")}</span></div>
                <div className="p-5 pt-3">
                  <ol className="relative border-l-2 border-line ml-2 space-y-5">
                    {info.events.map((ev, i) => {
                      const m = KIND_META[ev.kind]; const Icon = m.icon;
                      const next = info.events[i + 1];
                      const gap = (next ? new Date(next.at).getTime() : Date.now()) - new Date(ev.at).getTime();
                      return (
                        <li key={i} className="ml-5 relative">
                          <span className="absolute -left-[31px] top-0 w-6 h-6 rounded-full grid place-items-center ring-4 ring-surface" style={{ background: m.color }}><Icon size={13} className="text-white" /></span>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-sm font-semibold">{L(m.th, m.en, m.zh)} <span className="text-muted font-normal">· {branchName(ev.branchId)}</span></p>
                            <span className="text-[11px] text-muted tnum">{dt(ev.at)}</span>
                          </div>
                          <p className="text-[11px] text-muted font-mono mt-0.5">{ev.refNo}{ev.actor ? ` · ${empName(ev.actor)}` : ""}</p>
                          {ev.detail ? <p className="text-[11px] mt-0.5 inline-flex items-center gap-1" style={{ color: m.color }}>{ev.detail}</p> : null}
                          {gap > 60000 ? <p className="text-[10px] text-muted/70 mt-1.5 inline-flex items-center gap-1"><Clock size={10} /> {next ? L("อยู่", "stayed", "停留") : L("อยู่มาแล้ว", "here for", "至今")} {fmtDur(gap)}{next ? L(" ก่อนเดินทางต่อ", " before next", "后流转") : ""}</p> : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </Card>

              {/* SMART PANELS */}
              <div className="lg:col-span-2 space-y-4">
                {/* OneWarehouse — สถานะสด (เมื่อเชื่อมต่อ) */}
                {owConn && owInfo ? (() => {
                  const b = branchForWarehouseId(owInfo.warehouseId);
                  const OW_TH: Record<string, string> = { in_stock: L("อยู่ในสต๊อก", "In stock", "在库"), sold: L("ขายแล้ว", "Sold", "已售"), in_transit: L("ระหว่างโอน", "In transit", "在途"), reserved: L("ถูกจอง", "Reserved", "预留"), written_off: L("ตัดจำหน่าย", "Written off", "已核销"), shipped: L("ส่งออกแล้ว", "Shipped", "已出库") };
                  // เทียบ POS ↔ JST → อธิบายเหตุที่ไม่ตรงเป็นภาษาคน
                  const pos = info?.status;
                  const diff: string | null =
                    pos === "sold" && owInfo.status === "in_stock" ? L("POS ขายแล้ว แต่ JST ยังเห็นว่าอยู่ในสต๊อก — บิลขายยังไม่เข้า JST (ดูที่หน้ายอดขาย → ที่มาของบิล)", "Sold in POS but in stock in JST — sale not in JST yet", "")
                    : (pos === "returned" || pos === "in_stock") && owInfo.status === "sold" ? L("POS รับคืนแล้ว แต่ JST ยังเป็นขายแล้ว — รอทีมคลังกลางทำรับคืนใน JST", "Returned in POS, still sold in JST — awaiting JST return", "")
                    : pos === "in_stock" && owInfo.warehouseId && info?.currentBranchId && b && b !== info.currentBranchId ? L(`POS อยู่ ${branchName(info.currentBranchId)} แต่ JST อยู่ ${branchName(b)} — ตรวจใบโอน/กด "ปรับยอดจาก OW"`, "Branch differs between POS and JST", "")
                    : owInfo.stockType && owInfo.stockType !== "sellable" && pos !== "quarantined" ? L("JST บันทึกเป็นของชำรุด แต่ POS ยังขายได้ — ควรพักตรวจใน POS", "Damaged in JST but sellable in POS", "")
                    : null;
                  return (
                    <Card>
                      <div className="p-4 space-y-2">
                        <span className="text-sm font-semibold inline-flex items-center gap-1.5"><ShieldCheck size={15} className={diff ? "text-amber-500" : "text-emerald-600"} /> {L("คลังกลาง JST (สด)", "Central JST (live)", "中央仓 JST（实时）")}</span>
                        <div className="grid grid-cols-2 gap-2 text-[12px]">
                          <div className="rounded-xl bg-surface2/60 px-2.5 py-2"><p className="text-[10.5px] text-muted">{L("สถานะ", "Status", "状态")}</p><p className="font-semibold">{OW_TH[owInfo.status] ?? owInfo.status}</p></div>
                          <div className="rounded-xl bg-surface2/60 px-2.5 py-2"><p className="text-[10.5px] text-muted">{L("ประเภทสต๊อก", "Stock type", "库存类型")}</p><p className={`font-semibold ${owInfo.stockType && owInfo.stockType !== "sellable" ? "text-danger" : ""}`}>{owInfo.stockType === "damaged" ? L("ชำรุด", "Damaged", "损坏") : owInfo.stockType === "sellable" || !owInfo.stockType ? L("ขายได้", "Sellable", "可售") : owInfo.stockType}</p></div>
                          <div className="col-span-2 rounded-xl bg-surface2/60 px-2.5 py-2"><p className="text-[10.5px] text-muted">{L("คลัง", "Warehouse", "仓")}</p><p className="font-semibold">{owInfo.warehouseId ? (b ? `${branchName(b)} · ${owInfo.warehouseId}` : owInfo.warehouseId) : "—"}</p>{owInfo.sku ? <p className="text-muted font-mono text-[10.5px]" translate="no">{owInfo.sku}</p> : null}</div>
                        </div>
                        {diff ? <p className="rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11.5px] px-3 py-2 leading-snug">⚠ {diff}</p> : <p className="text-[11px] text-ok">{L("ตรงกับ POS", "Matches POS", "与 POS 一致")}</p>}
                        <p className="text-[10px] text-muted/70">{L("ข้อมูลจริงจากคลังกลาง (JST ผ่าน OneWarehouse)", "Authoritative from central WMS", "中央仓权威数据")}</p>
                      </div>
                    </Card>
                  );
                })() : owConn && info && owState === "loading" ? (
                  <Card><div className="p-3 text-[11px] text-muted">{L("กำลังถามคลังกลาง JST…", "Checking JST…", "查询中…")}</div></Card>
                ) : owConn && info && owState === "error" ? (
                  <Card><div className="p-3 text-[11px] text-muted">{L("ตอนนี้ถามคลังกลาง JST ไม่ได้ — ลองใหม่ภายหลัง", "Could not reach JST", "暂无法查询")}</div></Card>
                ) : owConn && info && owState === "missing" ? (
                  <Card><div className="p-3 text-[11px] text-muted inline-flex items-center gap-1.5"><ShieldCheck size={13} className="text-amber-500" /> {L("ไม่พบ SN นี้ในคลังกลาง JST — ถ้าเป็นสินค้าที่ต้องส่งเข้า JST บิลขายจะไม่ผ่าน ให้แจ้งทีมคลังกลางลงทะเบียน SN", "Serial not in central WMS", "中央仓无此序列号")}</div></Card>
                ) : null}
                {/* ประกัน */}
                {insight?.warranty?.started ? (
                  <Card>
                    <div className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold inline-flex items-center gap-1.5"><ShieldCheck size={15} className={insight.warranty.active ? "text-ok" : "text-rose-500"} /> {L("ประกันสินค้า", "Warranty", "保修")}</span>
                        <Badge tone={insight.warranty.active ? "ok" : "danger"}>{insight.warranty.active ? L("ยังอยู่ในประกัน", "Active", "保修中") : L("หมดประกันแล้ว", "Expired", "已过期")}</Badge>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-line/60 overflow-hidden">
                        <div className={`h-full ${insight.warranty.active ? "bg-emerald-500" : "bg-rose-400"}`} style={{ width: `${Math.max(2, Math.min(100, (insight.warranty.daysLeft! / (insight.warranty.months * 30)) * 100))}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted mt-1.5">
                        <span>{L("เริ่ม", "Start", "开始")} {dateOnly(insight.warranty.start!)}</span>
                        <span className={insight.warranty.active ? "text-ok font-medium" : "text-rose-500 font-medium"}>{insight.warranty.active ? `${L("เหลือ", "left", "剩")} ${insight.warranty.daysLeft} ${L("วัน", "d", "天")}` : L("หมดอายุ", "expired", "过期")} · {dateOnly(insight.warranty.expiry!)}</span>
                      </div>
                    </div>
                  </Card>
                ) : insight?.warranty && !insight.warranty.started ? (
                  <Card><div className="p-4 text-xs text-muted inline-flex items-center gap-2"><ShieldCheck size={15} className="text-muted/50" /> {L(`ประกัน ${insight.warranty.months} เดือน — เริ่มนับเมื่อขายออก`, `${insight.warranty.months}-month warranty — starts at sale`, "售出后开始保修")}</div></Card>
                ) : null}

                {/* ลูกค้าที่ซื้อ */}
                {info.soldInfo ? (
                  <Card>
                    <div className="p-4 space-y-2">
                      <span className="text-sm font-semibold inline-flex items-center gap-1.5"><User size={15} className="text-brand" /> {L("ขายให้", "Sold to", "售给")}</span>
                      <p className="text-base font-medium">{info.soldInfo.customerName || L("ลูกค้าทั่วไป", "Walk-in", "散客")}</p>
                      <div className="text-[11px] text-muted space-y-0.5">
                        <p className="font-mono">{info.soldInfo.orderNo}</p>
                        <p>{dt(info.soldInfo.at)} · {branchName(info.soldInfo.branchId)}</p>
                      </div>
                    </div>
                  </Card>
                ) : null}

                {/* ตำแหน่งปัจจุบัน */}
                {curBranch ? (
                  <Card>
                    <div className="p-4 space-y-2">
                      <span className="text-sm font-semibold inline-flex items-center gap-1.5"><Store size={15} className="text-brand" /> {L("ตำแหน่งปัจจุบัน", "Current location", "当前位置")}</span>
                      <p className="text-base font-medium">{curBranch.branch_type === "warehouse" ? "" : ""}{branchName(curBranch.id)}</p>
                      <p className="text-[11px] text-muted">{curBranch.province ?? ""}{curCoord ? ` · ${curCoord.lat.toFixed(3)}, ${curCoord.lng.toFixed(3)}` : ""}</p>
                      {curCoord ? <a href={`https://www.google.com/maps?q=${curCoord.lat},${curCoord.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline"><ExternalLink size={13} /> {L("เปิดบน Google Maps", "Open in Google Maps", "在地图中打开")}</a> : null}
                    </div>
                  </Card>
                ) : info.status === "in_transit" ? (
                  <Card><div className="p-4 text-sm inline-flex items-center gap-2"><ArrowUpRight size={16} className="text-sky-500" /> {L("กำลังเดินทางระหว่างสาขา — ยังไม่ถึงปลายทาง", "In transit between branches", "在店间流转中")}</div></Card>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
