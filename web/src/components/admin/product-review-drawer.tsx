"use client";
// =====================================================================
// ตรวจและอนุมัติสินค้า (Drawer ขวา)
//   แก้ชื่อ/ราคา/ต้นทุน/แบรนด์/หมวด/หน่วย + ยืนยันนโยบาย SN + ประเภท + เปิดขาย
//   ต้องใส่เหตุผล ≥3 ตัวอักษร · ไม่เปลี่ยน SKU/product_id · ไม่เพิ่มสต๊อก
// =====================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { ScanLine, Ban, ShieldCheck, History, ChevronDown, Info, Package } from "lucide-react";
import { Drawer, Button } from "@/components/ui";
import { refreshCatalogCache } from "@/lib/offline/catalog";
import { formatTHB } from "@/lib/money";

const KIND_LABEL: Record<string, string> = { goods: "สินค้าปกติ", service: "บริการ", bundle: "สินค้าชุด", fee: "ค่าธรรมเนียม" };
const inp = "w-full h-10 rounded-xl border border-line bg-surface2/70 px-3 text-sm outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand/40 transition";

export function ProductReviewDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setForm(null); setError("");
    if (id) void fetch("/api/admin/product-review?product_id=" + encodeURIComponent(id), { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw Error(j.error);
        if (!alive) return;
        setData(j);
        setForm({
          name_th: j.product.name_th, unit: j.product.unit, price: String(j.product.price), cost: String(j.product.cost),
          brand_id: j.product.brand_id ?? "", category_id: j.product.category_id ?? "",
          sn: j.product.serial_policy_confirmed ? (j.product.track_serial ? "yes" : "no") : "",
          kind: j.product.kind_policy_confirmed, is_active: j.product.is_active, reason: "",
        });
      })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/product-review", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: id, version: data.product.review_version, reason: form.reason,
          patch: {
            name_th: form.name_th, unit: form.unit, price: Number(form.price), cost: Number(form.cost),
            brand_id: form.brand_id || null, category_id: form.category_id || null,
            ...(form.sn !== "" ? { track_serial: form.sn === "yes", serial_policy_confirmed: true } : { serial_policy_confirmed: false }),
            kind_policy_confirmed: !!form.kind, is_active: !!form.is_active,
          },
        }),
      });
      const j = await response.json();
      if (!response.ok) throw Error(j.error);
      await refreshCatalogCache(true);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  const change = (key: string, value: unknown) => setForm((f: any) => ({ ...f, [key]: value }));
  const price = Number(form?.price) || 0, cost = Number(form?.cost) || 0;
  const margin = price > 0 ? ((price / 1.07 - cost) / (price / 1.07)) * 100 : null;
  const ready = form && form.sn !== "" && form.kind && price > 0 && form.name_th?.trim();
  const reasonOk = (form?.reason ?? "").trim().length >= 3;

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={data ? "ตรวจและอนุมัติสินค้า" : "ตรวจสินค้า"}
      subtitle={data ? `${data.product.sku} · เวอร์ชัน ${data.product.review_version}` : undefined}
      footer={data && form ? (
        <>
          <p className="text-[11px] text-muted self-center mr-auto">
            {reasonOk ? (ready ? "ข้อมูลครบ พร้อมบันทึก" : "บันทึกได้ แต่ยังยืนยันไม่ครบ") : "ใส่เหตุผลอย่างน้อย 3 ตัวอักษร"}
          </p>
          <Button variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} disabled={busy || !reasonOk} onClick={() => void save()}>
            <ShieldCheck size={15} /> บันทึกผลตรวจ
          </Button>
        </>
      ) : undefined}
    >
      <div className="p-5 space-y-5">
        {error ? <p role="alert" className="text-sm text-danger rounded-xl bg-danger/10 p-3">{error}</p> : null}
        {!data && !error ? (
          <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-12 rounded-xl bg-surface2/70 animate-pulse" />)}</div>
        ) : null}

        {data && form ? (
          <>
            {/* หัวสินค้า — เรียบ ๆ รูปใหญ่ */}
            <div className="flex items-center gap-4">
              <div className="h-28 w-28 rounded-2xl bg-surface2/70 grid place-items-center shrink-0 overflow-hidden">
                {data.product.image_url
                  ? <img src={data.product.image_url} alt={form.name_th || data.product.name_th} className="h-full w-full object-contain p-1.5" />
                  : <Package size={30} className="text-muted/50" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold leading-snug">{form.name_th || data.product.name_th}</p>
                {data.product.sku !== (form.name_th || data.product.name_th)
                  ? <p className="text-xs text-muted tnum mt-1">{data.product.sku}</p> : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 text-[11px] text-muted">
                  <Dot ok={form.sn !== ""}>{form.sn === "yes" ? "ใช้ SN" : form.sn === "no" ? "ไม่ใช้ SN" : "ยังไม่ยืนยัน SN"}</Dot>
                  <Dot ok={!!form.kind}>{form.kind ? KIND_LABEL[data.product.kind] ?? data.product.kind : "ยังไม่ยืนยันประเภท"}</Dot>
                  <Dot ok={!!form.is_active}>{form.is_active ? "เปิดขาย" : "ปิดขาย"}</Dot>
                </div>
              </div>
            </div>
            <p className="flex gap-2 text-[11px] text-muted leading-relaxed">
              <Info size={13} className="shrink-0 mt-0.5" />
              การแก้ไขไม่เปลี่ยน SKU หรือ product_id และไม่เพิ่มยอดสต๊อก · การเปิดขายต้องยืนยันข้อมูลจริงก่อน
            </p>

            {/* ข้อมูลสินค้า */}
            <Section title="ข้อมูลสินค้า">
              <Field label="ชื่อสินค้า"><input className={inp} value={form.name_th} onChange={(e) => change("name_th", e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="แบรนด์">
                  <select className={inp} value={form.brand_id} onChange={(e) => change("brand_id", e.target.value)}>
                    <option value="">ยังไม่ระบุ</option>
                    {data.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="หมวดหมู่">
                  <select className={inp} value={form.category_id} onChange={(e) => change("category_id", e.target.value)}>
                    <option value="">ยังไม่ระบุ</option>
                    {data.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name_th}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="หน่วยสินค้า"><input className={inp} value={form.unit} onChange={(e) => change("unit", e.target.value)} /></Field>
            </Section>

            {/* ราคา */}
            <Section title="ราคาและต้นทุน">
              <div className="grid grid-cols-2 gap-3">
                <Field label="ราคาขาย (รวม VAT)"><Money value={form.price} onChange={(v) => change("price", v)} /></Field>
                <Field label="ต้นทุน (ก่อน VAT)"><Money value={form.cost} onChange={(v) => change("cost", v)} /></Field>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted rounded-xl bg-surface2/50 px-3 py-2">
                <span>ก่อน VAT <b className="text-ink tnum">{formatTHB(price / 1.07)}</b></span>
                <span>กำไรขั้นต้น <b className={`tnum ${margin !== null && margin < 0 ? "text-danger" : "text-ink"}`}>{margin === null ? "—" : `${margin.toFixed(1)}%`}</b></span>
                {price <= 0 ? <span className="text-warn">ราคา 0 — ยังเปิดขายไม่ได้</span> : null}
              </div>
            </Section>

            {/* ยืนยันนโยบาย */}
            <Section title="ยืนยันจากข้อมูลที่ตรวจจริง">
              <p className="text-xs text-muted -mt-1">นโยบาย Serial Number</p>
              <div className="grid grid-cols-2 gap-2">
                {([["yes", "ต้องสแกน SN ทุกชิ้น", ScanLine], ["no", "ไม่ใช้ SN", Ban]] as const).map(([v, label, Icon]) => (
                  <button key={v} type="button" onClick={() => change("sn", v)}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm transition ${form.sn === v ? "border-brand bg-brand/5 ring-1 ring-brand/30 font-semibold" : "border-line hover:bg-surface2/60"}`}>
                    <Icon size={16} className={form.sn === v ? "text-brand" : "text-muted"} />{label}
                  </button>
                ))}
              </div>
              <Toggle checked={!!form.kind} onChange={(v) => change("kind", v)}
                label={`ยืนยันประเภทสินค้า: ${KIND_LABEL[data.product.kind] ?? data.product.kind}`} hint="ตรวจแล้วว่าเป็นสินค้าประเภทนี้จริง" />
              <Toggle checked={!!form.is_active} onChange={(v) => change("is_active", v)}
                label="เปิดใช้งานสำหรับการขาย" hint="หน้าร้านจะเห็นและขายสินค้านี้ได้" />
            </Section>

            {/* เหตุผล */}
            <Section title="เหตุผลและหลักฐาน">
              <textarea className={`${inp} h-auto py-2.5 min-h-[88px] resize-y`} rows={3} value={form.reason}
                onChange={(e) => change("reason", e.target.value)} placeholder="อ้างอิงรายการราคา นโยบาย SN หรือเอกสารอนุมัติ" />
            </Section>

            {/* ประวัติ */}
            <details className="group rounded-2xl border border-line">
              <summary className="flex items-center gap-2 px-4 py-3 text-sm cursor-pointer list-none">
                <History size={15} className="text-muted" /> ข้อมูลต้นทางและประวัติการตรวจ
                <span className="text-[11px] text-muted">({data.reviews.length})</span>
                <ChevronDown size={15} className="ml-auto text-muted transition group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4">
                {data.links.map((link: any) => (
                  <pre key={link.source} className="text-[11px] whitespace-pre-wrap break-all bg-surface2 rounded-xl p-3 max-h-56 overflow-auto">{JSON.stringify({ source: link.source, data: link.source_detail }, null, 2)}</pre>
                ))}
                {data.reviews.map((review: any) => (
                  <details key={review.id} className="text-xs border-b border-line/60 py-2">
                    <summary className="cursor-pointer">{new Date(review.created_at).toLocaleString("th-TH")} · {review.reason}</summary>
                    <dl className="grid grid-cols-1 gap-1 mt-2 text-muted">
                      {Object.keys(review.after_data ?? {})
                        .filter((key) => !["updated_at", "reviewed_at", "review_note"].includes(key) && JSON.stringify(review.before_data?.[key]) !== JSON.stringify(review.after_data[key]))
                        .map((key) => (
                          <div key={key}><dt className="font-medium inline">{key}: </dt><dd className="inline break-all">{String(review.before_data?.[key] ?? "—")} → {String(review.after_data[key] ?? "—")}</dd></div>
                        ))}
                    </dl>
                  </details>
                ))}
                {!data.links.length && !data.reviews.length ? <p className="text-xs text-muted">ยังไม่มีประวัติ</p> : null}
              </div>
            </details>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h4>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="block text-xs text-muted mb-1.5">{label}</span>{children}</label>;
}
function Money({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">฿</span>
      <input type="number" min="0" step="0.01" className={`${inp} pl-7 tnum`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} role="switch" aria-checked={checked}
      className="w-full flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-surface2/50 transition">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted">{hint}</p>
      </div>
      <span className={`relative h-6 w-10 rounded-full transition shrink-0 ${checked ? "bg-brand" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
function Dot({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-ok" : "bg-line"}`} />{children}</span>;
}
