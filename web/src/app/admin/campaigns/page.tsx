"use client";

// =====================================================================
// Admin → แคมเปญ / คูปอง (v2)
//   • ขอบเขต: แบรนด์ / สาขา / ช่องทาง / ช่วงเวลา
//   • เลือกสินค้าร่วมรายการ (หลาย SKU) + เงื่อนไขจำนวน/ยอดขั้นต่ำ
//   • สิทธิ์: ลดบาท / ลด% / ของแถม (ซื้อ A แถม B)
//   • วัดผล: ใช้กี่ครั้ง, ส่วนลดรวม, ยอดขายที่เกิด, ลูกค้ากี่คน
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import {
  Ticket, Plus, Trash2, Loader2, Pencil, TrendingUp, Users, Tag, Power, Gift, Search, X, Store, Layers, BarChart3, MapPin,
} from "lucide-react";
import { Modal, EmptyState, Drawer } from "@/components/ui";
import { useAdminScope } from "@/components/admin/filters";
import { useI18n } from "@/lib/i18n/provider";
import { useScopeFilter } from "@/lib/store/scope-filter";
import { SearchSelect } from "@/components/admin/search-select";
import { formatTHB } from "@/lib/money";
import { Maximize2, Minimize2, ImagePlus } from "lucide-react";

interface ProdRef { product_id: string | null; sku: string; name: string | null; gift_qty?: number }
interface CampaignReport {
  campaign: { name: string; promo_type: string };
  summary: { uses: number; customers: number; discountTotal: number; revenue: number; giftQty: number; giftCost: number };
  byBranch: { name: string; gift_qty: number; gift_cost: number }[];
}
interface Campaign {
  id: string; name: string; description: string | null; code: string | null;
  discount_type: string; discount_value: number; max_discount: number | null; min_spend: number;
  target_segment: string; starts_at: string | null; ends_at: string | null;
  usage_limit: number | null; per_customer_limit: number | null; active: boolean;
  brand_ids: string[]; branch_ids: string[]; channels: string[]; is_automatic: boolean;
  promo_type: string; eligible_scope: string; eligible_min_qty: number | null; eligible_across_sku: boolean;
  gift_mode: string | null; gift_per_qty: number | null; gift_cap: number | null;
  eligible_products: ProdRef[]; gift_products: ProdRef[]; cover_url: string | null;
  uses: number; discount_total: number; revenue: number; customers: number;
}

const SEG_LABEL: Record<string, string> = { all: "ทุกคน", new: "ลูกค้าใหม่", returning: "ซื้อซ้ำ", vip: "VIP", lost: "หายไป" };
const SEG_OPTS = Object.entries(SEG_LABEL).map(([v, label]) => ({ v, label }));
const CHANNELS: { v: string; label: string }[] = [
  { v: "offline", label: "หน้าร้าน" }, { v: "online_shopee", label: "Shopee" }, { v: "online_lazada", label: "Lazada" },
  { v: "online_tiktok", label: "TikTok" }, { v: "online_website", label: "เว็บไซต์" }, { v: "event", label: "อีเวนต์" },
  { v: "b2b", label: "ขายส่ง" }, { v: "other", label: "อื่นๆ" },
];

const EMPTY = {
  id: "", name: "", description: "", code: "", discount_type: "amount", discount_value: "",
  max_discount: "", min_spend: "", target_segment: "all", starts_at: "", ends_at: "",
  usage_limit: "", per_customer_limit: "1", active: true,
  brand_ids: [] as string[], branch_ids: [] as string[], channels: [] as string[], is_automatic: false,
  promo_type: "discount", eligible_scope: "all", eligible_min_qty: "", eligible_across_sku: true,
  gift_mode: "per_bill", gift_per_qty: "1", gift_cap: "",
  eligible: [] as ProdRef[], gifts: [] as ProdRef[],
  cover_url: "",
};
type FormState = typeof EMPTY;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

export default function AdminCampaignsPage() {
  const { brands, branches } = useAdminScope();
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const segLabel = (v: string) =>
    v === "all" ? L("ทุกคน", "Everyone", "所有人")
      : v === "new" ? L("ลูกค้าใหม่", "New customers", "新客户")
        : v === "returning" ? L("ซื้อซ้ำ", "Returning", "复购")
          : v === "vip" ? "VIP"
            : v === "lost" ? L("หายไป", "Lost", "流失")
              : (SEG_LABEL[v] ?? v);
  const channelLabel = (v: string) =>
    v === "offline" ? L("หน้าร้าน", "Store front", "门店")
      : v === "online_website" ? L("เว็บไซต์", "Website", "网站")
        : v === "event" ? L("อีเวนต์", "Event", "活动")
          : v === "b2b" ? L("ขายส่ง", "Wholesale", "批发")
            : v === "other" ? L("อื่นๆ", "Other", "其他")
              : (CHANNELS.find((c) => c.v === v)?.label ?? v);
  const { brandId: fBrand, branchId: fBranch } = useScopeFilter();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (!reportId) { setReport(null); return; }
    let alive = true; setReportLoading(true); setReport(null);
    void fetch(`/api/admin/campaigns?id=${reportId}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setReport(j); }).finally(() => { if (alive) setReportLoading(false); });
    return () => { alive = false; };
  }, [reportId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/admin/campaigns").then((r) => r.json());
      setItems(Array.isArray(j.campaigns) ? j.campaigns : []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openNew() { setForm(EMPTY); setErr(""); setExpanded(false); setOpen(true); }
  function openEdit(c: Campaign) {
    setExpanded(false);
    setForm({
      id: c.id, name: c.name, description: c.description ?? "", code: c.code ?? "",
      discount_type: c.discount_type, discount_value: String(c.discount_value ?? ""),
      max_discount: c.max_discount != null ? String(c.max_discount) : "",
      min_spend: String(c.min_spend ?? ""), target_segment: c.target_segment,
      starts_at: c.starts_at ?? "", ends_at: c.ends_at ?? "",
      usage_limit: c.usage_limit != null ? String(c.usage_limit) : "",
      per_customer_limit: c.per_customer_limit != null ? String(c.per_customer_limit) : "",
      active: c.active,
      brand_ids: c.brand_ids ?? [], branch_ids: c.branch_ids ?? [], channels: c.channels ?? [],
      is_automatic: !!c.is_automatic, promo_type: c.promo_type ?? "discount",
      eligible_scope: c.eligible_scope ?? "all",
      eligible_min_qty: c.eligible_min_qty != null ? String(c.eligible_min_qty) : "",
      eligible_across_sku: c.eligible_across_sku ?? true,
      gift_mode: c.gift_mode ?? "per_bill", gift_per_qty: String(c.gift_per_qty ?? 1),
      gift_cap: c.gift_cap != null ? String(c.gift_cap) : "",
      eligible: c.eligible_products ?? [], gifts: c.gift_products ?? [],
      cover_url: c.cover_url ?? "",
    });
    setErr(""); setOpen(true);
  }

  async function onPickCover(file: File | undefined) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr(L("รูปใหญ่เกิน 3MB", "Image exceeds 3MB", "图片超过3MB")); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, cover_url: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!form.name.trim()) { setErr(L("ต้องใส่ชื่อแคมเปญ", "Please enter a campaign name", "请输入活动名称")); return; }
    if (form.promo_type === "gift" && form.gifts.length === 0) { setErr(L("แคมเปญของแถม ต้องเลือกสินค้าของแถมอย่างน้อย 1 รายการ", "Gift campaign requires at least 1 gift product", "赠品活动至少需选择1件赠品")); return; }
    setSaving(true); setErr("");
    try {
      // อัปโหลดรูปปกก่อน ถ้าเป็นรูปใหม่ (data URL)
      let coverUrl = form.cover_url;
      if (coverUrl.startsWith("data:")) {
        setUploading(true);
        const up = await fetch("/api/admin/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: coverUrl }) }).then((r) => r.json());
        setUploading(false);
        if (up.url) coverUrl = up.url; else { setErr(up.error ?? L("อัปโหลดรูปไม่สำเร็จ", "Image upload failed", "图片上传失败")); setSaving(false); return; }
      }
      const body = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, description: form.description, code: form.code,
        discount_type: form.discount_type, discount_value: Number(form.discount_value || 0),
        max_discount: form.max_discount, min_spend: Number(form.min_spend || 0),
        target_segment: form.target_segment, starts_at: form.starts_at || null, ends_at: form.ends_at || null,
        usage_limit: form.usage_limit, per_customer_limit: form.per_customer_limit, active: form.active,
        brand_ids: form.brand_ids, branch_ids: form.branch_ids, channels: form.channels, is_automatic: form.is_automatic,
        promo_type: form.promo_type, eligible_scope: form.eligible_scope,
        eligible_min_qty: form.eligible_min_qty, eligible_across_sku: form.eligible_across_sku,
        gift_mode: form.gift_mode, gift_per_qty: form.gift_per_qty, gift_cap: form.gift_cap,
        eligible_products: form.eligible, gift_products: form.gifts,
        cover_url: coverUrl || null,
      };
      const res = await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (res.ok) { setOpen(false); await load(); } else setErr(j.error ?? L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"));
    } finally { setSaving(false); }
  }

  async function toggleActive(c: Campaign) {
    await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, active: !c.active }) });
    await load();
  }
  async function remove(c: Campaign) {
    if (!confirm(L(`ลบแคมเปญ "${c.name}"?`, `Delete campaign "${c.name}"?`, `删除活动 "${c.name}"？`))) return;
    await fetch(`/api/admin/campaigns?id=${c.id}`, { method: "DELETE" });
    setItems((p) => p.filter((x) => x.id !== c.id));
  }

  const discLabel = (c: Campaign) => {
    const n = c.gift_products?.length ?? 0;
    if (c.promo_type === "gift") return L(`ของแถม ${n} รายการ`, `${n} gift items`, `${n} 件赠品`);
    if (c.discount_type === "percent") {
      const cap = c.max_discount
        ? L(` (สูงสุด ${formatTHB(c.max_discount, false)})`, ` (max ${formatTHB(c.max_discount, false)})`, `（最高 ${formatTHB(c.max_discount, false)}）`)
        : "";
      return L(`ลด ${c.discount_value}%`, `${c.discount_value}% off`, `减 ${c.discount_value}%`) + cap;
    }
    return L(`ลด ${formatTHB(c.discount_value, false)}`, `${formatTHB(c.discount_value, false)} off`, `减 ${formatTHB(c.discount_value, false)}`);
  };
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? id;
  const branchName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (b.name_th ?? b.name) : id; };

  // กรองตามตัวกรองแบรนด์/สาขาบน topbar (แคมเปญส่วนกลาง = array ว่าง แสดงเสมอ)
  const shownItems = items.filter((c) => {
    const brs = c.brand_ids ?? []; const bchs = c.branch_ids ?? [];
    if (fBrand && brs.length > 0 && !brs.includes(fBrand)) return false;
    if (fBranch && bchs.length > 0 && !bchs.includes(fBranch)) return false;
    return true;
  });

  function toggleArr(key: "brand_ids" | "branch_ids" | "channels", v: string) {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  }
  function addProd(list: "eligible" | "gifts", p: ProdRef) {
    setForm((f) => (f[list].some((x) => x.sku === p.sku) ? f : { ...f, [list]: [...f[list], { ...p, gift_qty: list === "gifts" ? 1 : undefined }] }));
  }
  function rmProd(list: "eligible" | "gifts", sku: string) {
    setForm((f) => ({ ...f, [list]: f[list].filter((x) => x.sku !== sku) }));
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Ticket size={22} /> {L("แคมเปญ / คูปอง", "Campaigns / Coupons", "活动 / 优惠券")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("ตั้งเงื่อนไขละเอียด — ขอบเขตแบรนด์/สาขา เลือก SKU และของแถม แล้ววัดผล", "Set detailed conditions — brand/branch scope, choose SKUs and gifts, then measure results", "设置详细条件 — 品牌/门店范围，选择SKU和赠品，然后衡量效果")}</p>
        </div>
        <button onClick={openNew} className="h-10 px-4 rounded-2xl bg-brand text-brandInk text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> {L("สร้างแคมเปญ", "Create campaign", "创建活动")}
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลด…", "Loading…", "加载中…")}</div>
      ) : shownItems.length === 0 ? (
        <EmptyState icon={<Ticket size={26} />} title={items.length ? L("ไม่ตรงกับตัวกรอง", "No match for filter", "无匹配筛选") : L("ยังไม่มีแคมเปญ", "No campaigns yet", "暂无活动")} body={items.length ? L("ลองเปลี่ยนแบรนด์/สาขาบนแถบบน", "Try changing the brand/branch on the top bar", "请尝试更改顶栏的品牌/门店") : L("กด “สร้างแคมเปญ” เพื่อเริ่ม", "Tap “Create campaign” to start", "点击“创建活动”开始")} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shownItems.map((c) => (
            <div key={c.id} className={`p-4 rounded-2xl border bg-surface ${c.active ? "border-line" : "border-line opacity-60"}`}>
              <div className="flex items-start gap-3">
                {c.cover_url && (
                  <img src={c.cover_url} alt={c.name} className="w-16 h-16 rounded-xl object-cover border border-line shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{c.name}</span>
                    {c.promo_type === "gift" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brandInk inline-flex items-center gap-1"><Gift size={10} />{L("ของแถม", "Gift", "赠品")}</span>}
                    {c.is_automatic ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-muted">{L("อัตโนมัติ", "Automatic", "自动")}</span>
                      : c.code ? <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-brand/10 text-brand">{c.code}</span> : null}
                    {!c.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-danger border border-line">{L("ปิดอยู่", "Disabled", "已停用")}</span>}
                  </div>
                  <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink/80"><Tag size={11} />{discLabel(c)}</span>
                    {c.min_spend > 0 && <span>{L("ซื้อขั้นต่ำ", "Min spend", "最低消费")} {formatTHB(c.min_spend, false)}</span>}
                    {(c.starts_at || c.ends_at) && <span>{fmtDate(c.starts_at)}–{fmtDate(c.ends_at)}</span>}
                    <span>{segLabel(c.target_segment)}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    {(c.brand_ids?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1"><Layers size={10} />{c.brand_ids.map(brandName).join(", ")}</span>}
                    {(c.branch_ids?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1"><Store size={10} />{c.branch_ids.length} {L("สาขา", "branches", "门店")}</span>}
                    {(c.eligible_products?.length ?? 0) > 0 && <span>· {L("สินค้าร่วม", "Eligible", "参与商品")} {c.eligible_products.length} SKU</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setReportId(c.id)} title={L("รายงาน", "Report", "报表")} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><BarChart3 size={15} /></button>
                  <button onClick={() => void toggleActive(c)} title={c.active ? L("ปิด", "Disable", "停用") : L("เปิด", "Enable", "启用")} className={`h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2 ${c.active ? "text-ink" : "text-muted"}`}><Power size={15} /></button>
                  <button onClick={() => openEdit(c)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><Pencil size={15} /></button>
                  <button onClick={() => void remove(c)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-surface2"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-line">
                <Stat label={L("ใช้", "Uses", "使用")} value={String(c.uses)} />
                <Stat label={L("ลูกค้า", "Customers", "客户")} value={String(c.customers)} icon={<Users size={12} />} />
                <Stat label={L("ส่วนลดรวม", "Total discount", "折扣合计")} value={formatTHB(c.discount_total, false)} />
                <Stat label={L("ยอดขายที่เกิด", "Revenue", "销售额")} value={formatTHB(c.revenue, false)} icon={<TrendingUp size={12} />} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size={expanded ? "xl" : "lg"}
        title={
          <span className="flex items-center gap-2">
            {form.id ? L("แก้ไขแคมเปญ", "Edit campaign", "编辑活动") : L("สร้างแคมเปญ", "Create campaign", "创建活动")}
            <button type="button" onClick={() => setExpanded((e) => !e)} title={expanded ? L("ย่อ", "Collapse", "收起") : L("ขยาย", "Expand", "展开")}
              className="h-7 w-7 grid place-items-center rounded-lg text-muted hover:bg-surface2">
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </span>
        }
        footer={
          <>
            <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl bg-surface2 text-sm font-semibold text-muted">{L("ยกเลิก", "Cancel", "取消")}</button>
            <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="h-10 px-5 rounded-xl bg-brand text-brandInk text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} {uploading ? L("กำลังอัปโหลด…", "Uploading…", "上传中…") : L("บันทึก", "Save", "保存")}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {err && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>}

          {/* ข้อมูลหลัก */}
          <Section title={L("ข้อมูลหลัก", "Main info", "基本信息")}>
            {/* รูปปกแคมเปญ */}
            <div>
              <div className="text-xs text-muted mb-1.5">{L("รูปปกแคมเปญ (พนักงานหน้าร้านเห็นตอนเลือก)", "Campaign cover image (shown to store staff when selecting)", "活动封面图（门店员工选择时可见）")}</div>
              <div className="flex items-center gap-3">
                <div className="w-28 h-20 rounded-xl border border-line bg-surface2/60 overflow-hidden grid place-items-center shrink-0">
                  {form.cover_url
                    ? <img src={form.cover_url} alt={L("ปก", "Cover", "封面")} className="w-full h-full object-cover" />
                    : <ImagePlus size={22} className="text-muted" />}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="h-9 px-3 rounded-lg bg-surface2 text-sm font-semibold text-ink inline-flex items-center gap-1.5 cursor-pointer hover:brightness-95 w-fit">
                    <ImagePlus size={14} /> {form.cover_url ? L("เปลี่ยนรูป", "Change image", "更换图片") : L("เลือกรูป", "Select image", "选择图片")}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                      onChange={(e) => void onPickCover(e.target.files?.[0])} />
                  </label>
                  {form.cover_url && <button type="button" onClick={() => setForm({ ...form, cover_url: "" })} className="text-xs text-danger hover:underline w-fit">{L("ลบรูป", "Remove image", "删除图片")}</button>}
                  <span className="text-[11px] text-muted">PNG/JPG/WEBP ≤ 3MB</span>
                </div>
              </div>
            </div>
            <Field label={L("ชื่อแคมเปญ *", "Campaign name *", "活动名称 *")}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder={L("เช่น ซื้อกล้อง 70mai แถมเมม", "e.g. Buy a 70mai camera, get a memory card", "例如：购买70mai摄像头赠送存储卡")} /></Field>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-5">
                <input type="checkbox" checked={form.is_automatic} onChange={(e) => setForm({ ...form, is_automatic: e.target.checked })} className="w-4 h-4 accent-current" />
                {L("โปรอัตโนมัติ (ไม่ต้องกรอกรหัส)", "Automatic promo (no code needed)", "自动优惠（无需输入代码）")}
              </label>
              {!form.is_automatic && <Field label={L("รหัสคูปอง", "Coupon code", "优惠券代码")}><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inp} font-mono`} placeholder="NEW100" /></Field>}
            </div>
          </Section>

          {/* ขอบเขต */}
          <Section title={L("ขอบเขต", "Scope", "范围")}>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <div>
                <div className="text-xs text-muted mb-1.5">{L("แบรนด์", "Brand", "品牌")}</div>
                <SearchSelect allLabel={L("ทุกแบรนด์", "All brands", "全部品牌")} placeholder={L("ค้นหาแบรนด์…", "Search brands…", "搜索品牌…")}
                  options={brands.map((b) => ({ v: b.id, label: b.name }))}
                  selected={form.brand_ids} onChange={(next) => setForm((f) => ({ ...f, brand_ids: next }))} />
              </div>
              <div>
                <div className="text-xs text-muted mb-1.5">{L("สาขา", "Branch", "门店")}</div>
                <SearchSelect allLabel={L("ทุกสาขา", "All branches", "全部门店")} placeholder={L("ค้นหาสาขา…", "Search branches…", "搜索门店…")}
                  options={branches.map((b) => ({ v: b.id, label: b.name_th ?? b.name, sub: b.code }))}
                  selected={form.branch_ids} onChange={(next) => setForm((f) => ({ ...f, branch_ids: next }))} />
              </div>
            </div>
            <MultiChips label={L("ช่องทาง (ว่าง = ทุกช่องทาง)", "Channels (empty = all channels)", "渠道（留空 = 全部渠道）")} opts={CHANNELS.map((ch) => ({ v: ch.v, label: channelLabel(ch.v) }))} sel={form.channels} onToggle={(v) => toggleArr("channels", v)} />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={L("เริ่ม", "Start", "开始")}><input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inp} /></Field>
              <Field label={L("สิ้นสุด", "End", "结束")}><input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inp} /></Field>
            </div>
          </Section>

          {/* สินค้าร่วมรายการ */}
          <Section title={L("สินค้าร่วมรายการ", "Eligible products", "参与商品")}>
            <div className="flex gap-2">
              {(["all", "selected"] as const).map((v) => (
                <button key={v} onClick={() => setForm({ ...form, eligible_scope: v })} className={`px-3 h-8 rounded-full text-xs font-semibold ${form.eligible_scope === v ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>
                  {v === "all" ? L("ทุกสินค้า", "All products", "全部商品") : L("เลือก SKU", "Select SKU", "选择SKU")}
                </button>
              ))}
            </div>
            {form.eligible_scope === "selected" && (
              <>
                <ProductPicker onPick={(p) => addProd("eligible", p)} />
                <ProdList list={form.eligible} onRemove={(sku) => rmProd("eligible", sku)} />
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={L("จำนวนขั้นต่ำ (สินค้าร่วม)", "Min quantity (eligible)", "最低数量（参与商品）")}><input type="number" value={form.eligible_min_qty} onChange={(e) => setForm({ ...form, eligible_min_qty: e.target.value })} className={inp} placeholder={L("ไม่กำหนด", "Not set", "不限")} /></Field>
                  <label className="flex items-center gap-2 text-sm cursor-pointer pt-5">
                    <input type="checkbox" checked={form.eligible_across_sku} onChange={(e) => setForm({ ...form, eligible_across_sku: e.target.checked })} className="w-4 h-4 accent-current" />
                    {L("นับรวมข้าม SKU ได้", "Can count across SKUs", "可跨SKU累计")}
                  </label>
                </div>
              </>
            )}
          </Section>

          {/* สิทธิ์ประโยชน์ */}
          <Section title={L("สิทธิ์ประโยชน์", "Benefits", "优惠")}>
            <div className="flex gap-2">
              {(["discount", "gift"] as const).map((v) => (
                <button key={v} onClick={() => setForm({ ...form, promo_type: v })} className={`px-3 h-8 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${form.promo_type === v ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>
                  {v === "gift" ? <><Gift size={12} /> {L("ของแถม", "Gift", "赠品")}</> : <><Tag size={12} /> {L("ส่วนลด", "Discount", "折扣")}</>}
                </button>
              ))}
            </div>

            {form.promo_type === "discount" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Field label={L("ประเภทส่วนลด", "Discount type", "折扣类型")}>
                  <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} className={inp}>
                    <option value="amount">{L("จำนวนเงิน (บาท)", "Amount (THB)", "金额（泰铢）")}</option><option value="percent">{L("เปอร์เซ็นต์ (%)", "Percent (%)", "百分比（%）")}</option>
                  </select>
                </Field>
                <Field label={form.discount_type === "percent" ? L("ลดกี่ %", "Percent off", "折扣百分比") : L("ลดกี่บาท", "Amount off (THB)", "折扣金额")}><input type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} className={inp} /></Field>
                {form.discount_type === "percent" && <Field label={L("ส่วนลดสูงสุด (บาท)", "Max discount (THB)", "最高折扣（泰铢）")}><input type="number" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} className={inp} placeholder={L("ไม่จำกัด", "Unlimited", "不限")} /></Field>}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted">{L("เลือกสินค้าของแถม (จะถูกเพิ่มในบิลราคา ฿0 แต่ตัดสต๊อก + คิดต้นทุน)", "Select gift products (added to the bill at ฿0 but deducts stock + counts cost)", "选择赠品（以￥0加入单据但扣减库存并计入成本）")}</div>
                <ProductPicker onPick={(p) => addProd("gifts", p)} />
                <ProdList list={form.gifts} gift onRemove={(sku) => rmProd("gifts", sku)} onQty={(sku, q) => setForm((f) => ({ ...f, gifts: f.gifts.map((x) => x.sku === sku ? { ...x, gift_qty: q } : x) }))} />
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label={L("รูปแบบแถม", "Gift mode", "赠送方式")}>
                    <select value={form.gift_mode} onChange={(e) => setForm({ ...form, gift_mode: e.target.value })} className={inp}>
                      <option value="per_bill">{L("แถม 1 ชุด/บิล", "1 set per bill", "每单赠1套")}</option><option value="per_item">{L("ทุกจำนวนที่ซื้อ", "Per quantity bought", "按购买数量")}</option>
                    </select>
                  </Field>
                  {form.gift_mode === "per_item" && <Field label={L("ซื้อร่วมทุกกี่ชิ้น", "Buy every N pieces", "每购买几件")}><input type="number" value={form.gift_per_qty} onChange={(e) => setForm({ ...form, gift_per_qty: e.target.value })} className={inp} /></Field>}
                  <Field label={L("เพดานของแถม/บิล", "Gift cap per bill", "每单赠品上限")}><input type="number" value={form.gift_cap} onChange={(e) => setForm({ ...form, gift_cap: e.target.value })} className={inp} placeholder={L("ไม่จำกัด", "Unlimited", "不限")} /></Field>
                </div>
              </div>
            )}
          </Section>

          {/* ข้อจำกัด */}
          <Section title={L("ข้อจำกัด", "Limits", "限制")}>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={L("ยอดซื้อขั้นต่ำ (บาท)", "Min spend (THB)", "最低消费（泰铢）")}><input type="number" value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: e.target.value })} className={inp} placeholder="0" /></Field>
              <Field label={L("กลุ่มลูกค้า", "Customer segment", "客户群")}><select value={form.target_segment} onChange={(e) => setForm({ ...form, target_segment: e.target.value })} className={inp}>{SEG_OPTS.map((o) => <option key={o.v} value={o.v}>{segLabel(o.v)}</option>)}</select></Field>
              <Field label={L("ใช้ได้รวม (ครั้ง)", "Total uses", "可用总次数")}><input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} className={inp} placeholder={L("ไม่จำกัด", "Unlimited", "不限")} /></Field>
              <Field label={L("ต่อคน (ครั้ง)", "Per customer (uses)", "每人（次数）")}><input type="number" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })} className={inp} placeholder={L("ไม่จำกัด", "Unlimited", "不限")} /></Field>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer pt-1">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-current" />
              <span className="text-sm font-medium">{L("เปิดใช้งาน", "Active", "启用")}</span>
            </label>
          </Section>
        </div>
      </Modal>

      {/* รายงานแคมเปญ */}
      <Drawer open={Boolean(reportId)} onClose={() => setReportId(null)} width="md" title={report?.campaign.name ?? L("รายงานแคมเปญ", "Campaign report", "活动报表")} subtitle={L("ผลการใช้งาน", "Usage results", "使用结果")}>
        {reportLoading || !report ? (
          <div className="py-16 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /> {L("กำลังโหลด…", "Loading…", "加载中…")}</div>
        ) : (
          <div className="p-4 sm:p-5 space-y-5">
            <div className="grid grid-cols-2 gap-2.5">
              <RTile label={L("จำนวนครั้งที่ใช้", "Uses", "使用次数")} value={String(report.summary.uses)} icon={<Tag size={14} />} />
              <RTile label={L("ลูกค้า", "Customers", "客户")} value={String(report.summary.customers)} icon={<Users size={14} />} />
              <RTile label={L("ส่วนลดรวม", "Total discount", "折扣合计")} value={formatTHB(report.summary.discountTotal, false)} />
              <RTile label={L("ยอดขายที่เกิด", "Revenue", "销售额")} value={formatTHB(report.summary.revenue, false)} icon={<TrendingUp size={14} />} />
            </div>

            {report.summary.giftQty > 0 && (
              <div className="rounded-2xl border border-line bg-surface2/40 p-3.5">
                <div className="text-sm font-bold mb-2 flex items-center gap-1.5"><Gift size={14} /> {L("ของแถมที่จ่ายไป", "Gifts given out", "已发放赠品")}</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <RTile label={L("จำนวนของแถม", "Gift quantity", "赠品数量")} value={`${report.summary.giftQty} ${L("ชิ้น", "pcs", "件")}`} />
                  <RTile label={L("ต้นทุนของแถมรวม", "Total gift cost", "赠品成本合计")} value={formatTHB(report.summary.giftCost, false)} />
                </div>
                <p className="text-[11px] text-muted mt-2">{L("กำไรหลังหักส่วนลด+ต้นทุนของแถม = ยอดขาย − ส่วนลด − ต้นทุนของแถม (ต้นทุนสินค้าหลักแยกในรายงานกำไร)", "Profit after discount + gift cost = Revenue − Discount − Gift cost (main product cost is separate in the profit report)", "扣除折扣+赠品成本后的利润 = 销售额 − 折扣 − 赠品成本（主商品成本在利润报表中单列）")}</p>
              </div>
            )}

            {report.byBranch.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2 flex items-center gap-1.5"><MapPin size={14} /> {L("ของแถมแยกสาขา", "Gifts by branch", "各门店赠品")}</div>
                <ul className="space-y-1.5">
                  {report.byBranch.map((b) => (
                    <li key={b.name} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line text-sm">
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="text-muted text-xs">{b.gift_qty} {L("ชิ้น", "pcs", "件")}</span>
                      <span className="tnum font-semibold">{formatTHB(b.gift_cost, false)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.summary.uses === 0 && report.summary.giftQty === 0 && (
              <p className="text-sm text-muted text-center py-6">{L("ยังไม่มีการใช้งานแคมเปญนี้", "This campaign has not been used yet", "该活动尚未被使用")}</p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function RTile({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="p-3 rounded-2xl border border-line bg-surface">
      <div className="text-[11px] text-muted flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-bold tnum text-ink mt-0.5">{value}</div>
    </div>
  );
}

const inp = "mt-1 w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm text-ink outline-none focus:border-brand/40";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-3.5 space-y-3">
      <div className="text-sm font-bold text-ink">{title}</div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs text-muted block">{label}{children}</label>;
}
function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] text-muted flex items-center gap-1">{icon}{label}</div>
      <div className="text-sm font-bold tnum text-ink">{value}</div>
    </div>
  );
}
function MultiChips({ label, opts, sel, onToggle }: { label: string; opts: { v: string; label: string }[]; sel: string[]; onToggle: (v: string) => void }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {opts.length === 0 ? <span className="text-xs text-muted">—</span> : opts.map((o) => (
          <button key={o.v} onClick={() => onToggle(o.v)} className={`px-2.5 h-7 rounded-full text-[11px] font-semibold ${sel.includes(o.v) ? "bg-brand text-brandInk" : "bg-surface2 text-muted hover:text-ink"}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function ProductPicker({ onPick }: { onPick: (p: ProdRef) => void }) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    let alive = true; setLoading(true);
    const id = setTimeout(async () => {
      try {
        const j = await fetch(`/api/admin/products?q=${encodeURIComponent(q.trim())}`).then((r) => r.json());
        if (alive) setHits((j.products ?? []).map((p: { id: string; sku: string; name: string }) => ({ id: p.id, sku: p.sku, name: p.name })));
      } finally { if (alive) setLoading(false); }
    }, 280);
    return () => { alive = false; clearTimeout(id); };
  }, [q]);
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-2.5 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหาสินค้า (ชื่อ/SKU)…", "Search products (name/SKU)…", "搜索商品（名称/SKU）…")} className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface2/60 border border-line outline-none text-sm focus:border-brand/40" />
      {loading && <Loader2 size={14} className="absolute right-3 top-2.5 animate-spin text-muted" />}
      {hits.length > 0 && (
        <ul className="mt-1 border border-line rounded-xl overflow-hidden divide-y divide-line/60 max-h-52 overflow-y-auto bg-surface">
          {hits.map((p) => (
            <li key={p.id}>
              <button onClick={() => { onPick({ product_id: p.id, sku: p.sku, name: p.name }); setQ(""); setHits([]); }} className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{p.name}</span>
                <span className="text-[11px] font-mono text-muted">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProdList({ list, gift, onRemove, onQty }: { list: ProdRef[]; gift?: boolean; onRemove: (sku: string) => void; onQty?: (sku: string, q: number) => void }) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  if (list.length === 0) return <p className="text-xs text-muted">{L("ยังไม่เลือกสินค้า", "No products selected", "未选择商品")}</p>;
  return (
    <ul className="space-y-1.5">
      {list.map((p) => (
        <li key={p.sku} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line">
          <span className="min-w-0 flex-1">
            <span className="text-sm truncate block">{p.name ?? p.sku}</span>
            <span className="text-[11px] font-mono text-muted">{p.sku}</span>
          </span>
          {gift && onQty && (
            <input type="number" min={1} value={p.gift_qty ?? 1} onChange={(e) => onQty(p.sku, Math.max(1, Number(e.target.value) || 1))}
              className="w-14 h-8 px-2 rounded-lg bg-surface2/60 border border-line text-sm text-center" title={L("จำนวน/ชุด", "Qty/set", "数量/套")} />
          )}
          <button onClick={() => onRemove(p.sku)} className="text-muted hover:text-danger"><X size={15} /></button>
        </li>
      ))}
    </ul>
  );
}
