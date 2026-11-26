"use client";
// ช่องค้นหาอัจฉริยะ (⌘K / Ctrl+K / ช่องค้นหาด้านบน) — ค้นทั้งระบบจากข้อมูลจริง แล้วพาไปดูรายละเอียดหรือเปิดเอกสารในหน้าเดิม
//   • พิมพ์อะไรก็ได้: เลขบิล/เบอร์ลูกค้า/ชื่อลูกค้า/SN/SKU/บาร์โค้ด/เลขใบโอน/ใบกำกับ/ใบลดหนี้/ใบรับคืน/รอบนับ/ชื่อพนักงาน/สาขา/ชื่อเมนู
//   • เป็นคำถาม (ยอดขาย…เท่าไร, ขายดี, เทียบ…) → ส่งต่อผู้ช่วย AI · เอกสาร → เปิดดู/PDF ทันที (ไม่เปิดแท็บใหม่)
//   • ข้อมูลจาก /api/admin/search (ตัดตามสิทธิ์+สาขา) · โหมดสาธิตค้นข้อมูลในเครื่อง
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ReceiptText, Package, User, Store, CornerDownLeft, ScanLine, ArrowLeftRight, FileText, Users, ClipboardList, Compass, Loader2, Clock, Eye, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { isLiveMode } from "@/lib/supabase/client";
import { listOrders, listProducts } from "@/lib/data/repo";
import { DocViewer } from "@/components/doc-viewer";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import type { OrderDocItem } from "@/lib/doc-types";
import { formatTHB } from "@/lib/money";
import { tr } from "@/lib/i18n/tr";

type Doc = { kind: string; url: string; title: string; doc_no: string };
type Item = { title: string; sub?: string; href?: string; doc?: Doc; badge?: string };
type Group = { kind: string; label: string; items: Item[] };
type Flat = Item & { group: string; kind: string; key: string };

// เมนู/หน้า — ค้นด้วยคำไทย/อังกฤษ/คำพ้อง
const PAGES: { title: string; href: string; kw: string }[] = [
  { get title() { return tr("ยอดขาย · ภาพรวม", "Sales · Overview", "销售 · 概览"); }, href: "/admin/sales", kw: "sales ยอดขาย รายได้ dashboard แดชบอร์ด" },
  { get title() { return tr("ยอดขายรายสาขา", "Sales by branch", "门店销售额"); }, href: "/admin/sales?tab=branch", kw: "branch สาขา เทียบสาขา" },
  { get title() { return tr("ยอดขายตามแบรนด์", "Sales by brand", "品牌销售额"); }, href: "/admin/sales?tab=brand", kw: "brand แบรนด์" },
  { get title() { return tr("ผลงานพนักงาน", "Staff performance", "员工业绩"); }, href: "/admin/sales?tab=staff", kw: "performance พนักงาน ผลงาน staff kpi ตำแหน่ง" },
  { get title() { return tr("รายการบิล", "Bills", "单据列表"); }, href: "/admin/sales?tab=bills", kw: "bills orders บิล ใบเสร็จ" },
  { get title() { return tr("การเงิน", "Finance", "财务"); }, href: "/admin/finance", kw: "finance เงิน กระแสเงิน" },
  { get title() { return tr("ปิดงวดบัญชี", "Period close", "会计期间结账"); }, href: "/admin/periods", kw: "period close ปิดงวด งบ ภาษีขาย" },
  { get title() { return tr("รับชำระ / EDC", "Payments / EDC", "收款 / EDC"); }, href: "/admin/payments", kw: "edc payment ชำระ บัตร" },
  { get title() { return tr("แคมเปญ", "Campaigns", "活动"); }, href: "/admin/campaigns", kw: "campaign แคมเปญ โปร promotion" },
  { get title() { return tr("ประวัติส่วนลด / คูปอง", "Discount / coupon history", "折扣 / 优惠券记录"); }, href: "/admin/discounts", kw: "discount ส่วนลด คูปอง coupon" },
  { get title() { return tr("ลูกค้า", "Customers", "顾客"); }, href: "/admin/customers", kw: "customer ลูกค้า crm สมาชิก" },
  { get title() { return tr("แต้มสะสม", "Loyalty points", "积分"); }, href: "/admin/loyalty", kw: "loyalty แต้ม point" },
  { get title() { return tr("สต๊อก", "Stock", "库存"); }, href: "/admin/inventory", kw: "stock สต๊อก คงเหลือ inventory" },
  { get title() { return tr("ความเคลื่อนไหวสต๊อก", "Stock movement", "库存变动"); }, href: "/admin/movement", kw: "movement เคลื่อนไหว stock card" },
  { get title() { return tr("ตามรอย SN", "SN tracking", "SN 追踪"); }, href: "/admin/serials", kw: "serial sn ตามรอย imei" },
  { get title() { return tr("โอนย้ายสินค้า", "Stock transfers", "商品调拨"); }, href: "/admin/transfers", kw: "transfer โอน ย้าย" },
  { get title() { return tr("สินค้า", "Products", "商品"); }, href: "/admin/products", kw: "product สินค้า sku ราคา" },
  { get title() { return tr("ศูนย์เอกสาร", "Document center", "单据中心"); }, href: "/admin/documents", kw: "document เอกสาร pdf" },
  { get title() { return tr("คำขออนุมัติ", "Approval requests", "审批申请"); }, href: "/admin/approvals", kw: "approval อนุมัติ" },
  { get title() { return tr("ผังสาขา / องค์กร", "Branch / org chart", "门店 / 组织架构"); }, href: "/admin/org", kw: "org ผัง องค์กร ทีม" },
  { get title() { return tr("ผู้ช่วย AI", "AI assistant", "AI 助手"); }, href: "/admin/insights", kw: "ai ผู้ช่วย ถาม วิเคราะห์ insight" },
  { get title() { return tr("สิทธิ์ผู้ใช้", "User permissions", "用户权限"); }, href: "/admin/permissions", kw: "permission สิทธิ์ user ผู้ใช้" },
  { get title() { return tr("เชื่อมคลังกลาง (OneWarehouse)", "Central warehouse (OneWarehouse)", "中央仓库对接 (OneWarehouse)"); }, href: "/admin/onewarehouse", kw: "onewarehouse jst คลังกลาง เชื่อม" },
  { get title() { return tr("หน้าร้าน · ขายสินค้า", "Store · Sell", "门店 · 销售"); }, href: "/pos/sell", kw: "pos sell ขาย หน้าร้าน" },
  { get title() { return tr("หน้าร้าน · ตรวจนับสต๊อก", "Store · Stock count", "门店 · 盘点"); }, href: "/pos/count", kw: "count นับ ตรวจนับ" },
  { get title() { return tr("หน้าร้าน · ปรับสต๊อก", "Store · Stock adjust", "门店 · 库存调整"); }, href: "/pos/adjust", kw: "adjust ปรับ ของเสีย" },
  { get title() { return tr("หน้าร้าน · รอลูกค้ารับของ", "Store · Pickups", "门店 · 待取货"); }, href: "/pos/pickups", kw: "pickup รับของ รอรับ" },
  { get title() { return tr("หน้าร้าน · คืน / เปลี่ยนสินค้า", "Store · Returns / exchanges", "门店 · 退换货"); }, href: "/pos/returns", kw: "return คืน เปลี่ยน refund" },
];
// ภาษาไทยไม่เว้นวรรค → จับคำบ่งชี้คำถาม/การวิเคราะห์ในประโยค
const QUESTION = /(เท่าไร|เท่าไหร่|กี่|ทำไม|ยังไง|อย่างไร|ขายดี|ขายไม่ดี|เทียบ|แนวโน้ม|สรุป|วิเคราะห์|ไหน|ใคร|ดีสุด|มากสุด|น้อยสุด|สูงสุด|ต่ำสุด|ตกลง|เพิ่มขึ้น|ลดลง|อันดับ|\?|how|what|why|which|who|compare|trend|top|best|worst)/i;
const SUGGEST = ["ยอดขายวันนี้เทียบเมื่อวาน", "สินค้าขายดี 7 วัน", "สาขาไหนยอดตกลง"];
const ICON: Record<string, typeof Search> = { order: ReceiptText, serial: ScanLine, product: Package, customer: User, transfer: ArrowLeftRight, doc: FileText, stockdoc: ClipboardList, employee: Users, branch: Store, page: Compass, ai: Search };
const RECENT_KEY = "shdpos.search.recent";

export function CommandPalette() {
  const router = useRouter();
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]), [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [viewDoc, setViewDoc] = useState<OrderDocItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === "Escape" && !viewDoc) setOpen(false);
    };
    const onEvt = (e: Event) => { setOpen(true); const d = (e as CustomEvent).detail; if (d?.q) setQ(String(d.q)); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("shd:command", onEvt as EventListener);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("shd:command", onEvt as EventListener); };
  }, [viewDoc]);
  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 30); try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")); } catch { /* */ } }
    else { setQ(""); setGroups([]); setActive(0); }
  }, [open]);

  // ค้นจากระบบกลาง (หน่วง 250ms) · โหมดสาธิตค้นในเครื่อง
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setGroups([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        let g: Group[] = [];
        if (isLiveMode()) {
          const r = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
          const j = await r.json(); if (r.ok) g = j.groups ?? [];
        } else {
          const low = term.toLowerCase();
          const [o, p] = await Promise.all([listOrders({ limit: 800 }), listProducts()]);
          const oi = o.filter((x) => x.order_no.toLowerCase().includes(low) || (x.customer_name ?? "").toLowerCase().includes(low) || (x.customer_phone ?? "").includes(low) || x.items.some((it) => it.serials.some((s) => s.toLowerCase().includes(low)))).slice(0, 6)
            .map((x) => ({ title: x.order_no, sub: `${formatTHB(x.grand_total, false)}${x.customer_name ? ` · ${x.customer_name}` : ""}`, href: `/admin/sales?tab=bills&q=${encodeURIComponent(x.order_no)}` }));
          const pi = p.filter((x) => x.sku.toLowerCase().includes(low) || x.name_th.toLowerCase().includes(low) || x.barcodes.some((b) => b.includes(low))).slice(0, 6)
            .map((x) => ({ title: x.name_th, sub: x.sku, href: `/admin/products?q=${encodeURIComponent(x.sku)}` }));
          g = [...(oi.length ? [{ kind: "order", label: L("บิลขาย", "Sales bills", "销售单据"), items: oi }] : []), ...(pi.length ? [{ kind: "product", label: L("สินค้า", "Products", "商品"), items: pi }] : [])];
        }
        if (my === seq.current) { setGroups(g); setActive(0); }
      } finally { if (my === seq.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const flat = useMemo<Flat[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out: Flat[] = [];
    const isQ = QUESTION.test(term);
    if (isQ) out.push({ group: "ai", kind: "ai", key: "ai", title: L(`ถามผู้ช่วย AI: “${q.trim()}”`, `Ask AI assistant: “${q.trim()}”`, `询问 AI 助手：“${q.trim()}”`), sub: L("วิเคราะห์จากข้อมูลจริง สร้างกราฟ/สรุปให้", "Analyzes real data and builds charts/summaries", "基于真实数据分析，生成图表/摘要"), href: `/admin/insights?q=${encodeURIComponent(q.trim())}` });
    // เมนู: ให้คะแนนตามคำสำคัญที่อยู่ในประโยค (รองรับไทยไม่เว้นวรรค) — เช่น "ยอดขายสาขาไหนดีสุด" → ยอดขายรายสาขา
    const pages = PAGES.map((p) => {
      const tokens = `${p.title} ${p.kw}`.toLowerCase().split(/[\s·/()]+/).filter((x) => x.length >= 2);
      const score = tokens.reduce((n, tk) => n + (term.includes(tk) ? tk.length : tk.includes(term) ? term.length / 2 : 0), 0);
      return { p, score };
    }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.p);
    for (const p of pages) out.push({ group: "page", kind: "page", key: `page:${p.href}`, title: p.title, sub: L("ไปที่หน้า", "Go to page", "前往"), href: p.href });
    groups.forEach((g) => g.items.forEach((it, i) => out.push({ ...it, group: g.label, kind: g.kind, key: `${g.kind}:${i}:${it.title}` })));
    if (!isQ && term.length >= 3) out.push({ group: "ai", kind: "ai", key: "ai2", title: L(`ถามผู้ช่วย AI เรื่อง “${q.trim()}”`, `Ask AI assistant about “${q.trim()}”`, `就“${q.trim()}”询问 AI 助手`), sub: L("ถ้าไม่เจอสิ่งที่ต้องการ", "If you can't find what you need", "找不到想要的内容时"), href: `/admin/insights?q=${encodeURIComponent(q.trim())}` });
    return out;
  }, [q, groups, L]);

  function remember() {
    const term = q.trim(); if (term.length < 2) return;
    const next = [term, ...recent.filter((x) => x !== term)].slice(0, 8);
    setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* */ }
  }
  function openDoc(d: Doc) {
    remember();
    setViewDoc({ kind: d.kind as OrderDocItem["kind"], key: `search:${d.doc_no}`, title: d.title, doc_no: d.doc_no, stage: "all", available: true, url: d.url });
  }
  function go(it: Flat, preferDoc = false) {
    if ((preferDoc || !it.href) && it.doc) return openDoc(it.doc);
    if (!it.href) return;
    remember(); setOpen(false); router.push(it.href);
  }
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); go(flat[active], e.shiftKey); }
  };

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-2xl bg-surface border border-line rounded-2xl shadow-pop overflow-hidden animate-slideUp">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line">
          <span className="w-7 h-7 shrink-0"><VoicePoweredOrb active={loading} /></span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
            placeholder={L("ค้นหาอะไรก็ได้ — บิล · เบอร์ลูกค้า · SN · SKU · ใบโอน · ใบกำกับ · พนักงาน · สาขา · หรือพิมพ์เป็นคำถาม", "Search anything — bill, phone, SN, SKU, transfer, invoice, staff, branch, or ask a question", "搜索任何内容或提问")}
            className="flex-1 bg-transparent outline-none text-sm" />
          {loading ? <Loader2 size={15} className="animate-spin text-muted" /> : q ? <button onClick={() => setQ("")} className="text-muted hover:text-ink"><X size={15} /></button> : null}
          <kbd className="text-[10px] bg-surface2 border border-line rounded px-1.5 py-0.5 text-muted">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {!q.trim() ? (
            <div className="px-4 py-3 space-y-4">
              {recent.length ? <div><p className="text-[11px] font-semibold text-muted mb-1.5 flex items-center gap-1"><Clock size={11} /> {L("ค้นหาล่าสุด", "Recent", "最近")}</p>
                <div className="flex flex-wrap gap-1.5">{recent.map((r) => <button key={r} onClick={() => setQ(r)} className="h-7 px-2.5 rounded-full bg-surface2 border border-line text-xs hover:border-brand/40">{r}</button>)}</div></div> : null}
              <div><p className="text-[11px] font-semibold text-muted mb-1.5">{L("ลองถาม", "Try asking", "试试")}</p>
                <div className="flex flex-wrap gap-1.5">{SUGGEST.map((s) => <button key={s} onClick={() => setQ(s)} className="h-7 px-2.5 rounded-full bg-brand/8 text-brand text-xs hover:bg-brand/15">{s}</button>)}</div></div>
              <p className="text-[11px] text-muted leading-relaxed">{L("พิมพ์เลขบิล, เบอร์ลูกค้า, SN, SKU, เลขใบโอน/ใบกำกับ/ใบลดหนี้, ชื่อพนักงานหรือสาขา — Enter = เปิดรายละเอียด · Shift+Enter = เปิดเอกสาร", "Enter = open details · Shift+Enter = open document", "回车打开 · Shift+回车查看单据")}</p>
            </div>
          ) : flat.length ? flat.map((it, i) => {
            const I = ICON[it.kind] ?? Search;
            const header = it.group !== lastGroup ? (lastGroup = it.group, it.kind === "ai" ? null : <p key={`h:${it.group}`} className="px-4 pt-2 pb-1 text-[10.5px] font-semibold text-muted uppercase tracking-wide">{it.kind === "page" ? L("เมนู", "Pages", "页面") : it.group}</p>) : null;
            return (
              <div key={it.key}>
                {header}
                <div onMouseEnter={() => setActive(i)} className={`mx-2 rounded-xl flex items-center gap-3 px-2.5 py-2 ${i === active ? "bg-surface2" : ""}`}>
                  <button onClick={() => go(it)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${it.kind === "ai" ? "bg-brand/10 text-brand" : "bg-surface2 text-muted"}`}>{it.kind === "ai" ? <span className="w-5 h-5"><VoicePoweredOrb /></span> : <I size={15} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{it.title}</span>
                      {it.sub ? <span className="block text-[11px] text-muted truncate">{it.sub}</span> : null}
                    </span>
                  </button>
                  {it.badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface2 border border-line text-muted shrink-0">{it.badge}</span> : null}
                  {it.doc ? <button onClick={() => openDoc(it.doc!)} title={L("เปิดเอกสาร (Shift+Enter)", "Open document", "打开单据")} className="h-7 px-2 rounded-lg border border-line text-[11px] inline-flex items-center gap-1 text-muted hover:text-brand hover:border-brand/40 shrink-0"><Eye size={12} />{L("เอกสาร", "Doc", "单据")}</button> : null}
                  {i === active ? <CornerDownLeft size={13} className="text-muted shrink-0" /> : null}
                </div>
              </div>
            );
          }) : loading ? <p className="px-4 py-8 text-center text-xs text-muted">{L("กำลังค้นทั้งระบบ…", "Searching…", "搜索中…")}</p>
            : <p className="px-4 py-8 text-center text-xs text-muted">{L("ไม่พบผลลัพธ์", "No results", "无结果")}</p>}
        </div>
        <div className="flex items-center gap-3 px-4 h-9 border-t border-line text-[10px] text-muted">
          <span>{flat.filter((x) => x.kind !== "ai" && x.kind !== "page").length} {L("ผลลัพธ์จากระบบ", "results", "结果")}</span>
          <span className="ml-auto">↑↓ {L("เลือก", "navigate", "选择")} · ⏎ {L("เปิด", "open", "打开")} · ⇧⏎ {L("เอกสาร", "doc", "单据")} · ⌘K</span>
        </div>
      </div>
      {viewDoc ? <DocViewer docs={[viewDoc]} startKey={viewDoc.key} onClose={() => setViewDoc(null)} /> : null}
    </div>
  );
}
