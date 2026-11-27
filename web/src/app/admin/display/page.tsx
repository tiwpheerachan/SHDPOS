"use client";
// =====================================================================
// Admin → แบนเนอร์จอลูกค้า (Customer Display) รายแบรนด์
//   อัปโหลดรูป/วิดีโอ · จัดกรอบ (เต็ม/พอดี + เลื่อนตำแหน่ง) · ตั้งเวลาเลื่อน · เรียงลำดับ
//   แสดงตอนจอลูกค้าว่าง (ยังไม่มีสินค้าในตะกร้า) เลื่อนวนอัตโนมัติ
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay, Upload, Trash2, ArrowUp, ArrowDown, Power, Loader2, ImagePlus, Film } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useAdminScope } from "@/components/admin/filters";
import { Card, Button, Input, Select, EmptyState } from "@/components/ui";
import { useToast } from "@/components/toast-host";

interface Banner {
  id: string; brand_id: string | null; media_url: string; media_type: "image" | "video";
  fit: "cover" | "contain"; pos_x: number; pos_y: number; duration_sec: number; sort_order: number; active: boolean;
}

export default function AdminDisplayPage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { brands: allBrands } = useAdminScope();
  // Dexie มีทั้ง demo id (b-000x) + UUID ซ้ำ → ใช้เฉพาะ UUID (ตรงกับ Supabase)
  const brands = allBrands.filter((b) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id));
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [brandId, setBrandId] = useState<string>("");
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [authErr, setAuthErr] = useState(false);

  // ตั้งค่าแบรนด์เริ่มต้น = แบรนด์แรก (Dreame ถ้ามี)
  useEffect(() => {
    if (brandId || !brands.length) return;
    setBrandId(brands.find((b) => b.name?.toLowerCase() === "dreame")?.id ?? brands[0].id);
  }, [brands, brandId]);

  const load = useCallback(async (bid: string) => {
    setLoading(true); setAuthErr(false);
    try {
      const r = await fetch(`/api/admin/display-banners?brand=${bid}`, { cache: "no-store" });
      if (r.status === 403) { setAuthErr(true); setBanners([]); return; }
      const j = await r.json();
      setBanners((j.banners ?? []).filter((b: Banner) => b.brand_id === bid));
    } catch { setAuthErr(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (brandId) void load(brandId); }, [brandId, load]);

  async function save(body: Record<string, unknown>) {
    const r = await fetch("/api/admin/display-banners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try { localStorage.setItem("shdpos.banners-updated", String(Date.now())); } catch { /* หน้าขายในเครื่องนี้โหลดแบนเนอร์ใหม่ */ }
    const j = await r.json();
    if (!r.ok) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "失败"), body: j.error }); return false; }
    return true;
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { toast.push({ tone: "danger", title: L("ไฟล์ใหญ่เกิน 30MB", "File over 30MB", "超30MB") }); return; }
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.onerror = rej; rd.readAsDataURL(file); });
      const ok = await save({ brand_id: brandId, media_data: dataUrl, media_type: file.type.startsWith("video/") ? "video" : "image", fit: "cover", duration_sec: 6, sort_order: banners.length + 1, active: true });
      if (ok) { toast.push({ tone: "ok", title: L("เพิ่มแบนเนอร์แล้ว", "Banner added", "已添加") }); await load(brandId); }
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  // แก้ไข + บันทึกทันที (optimistic)
  async function patch(b: Banner, changes: Partial<Banner>) {
    const next = { ...b, ...changes };
    setBanners((list) => list.map((x) => (x.id === b.id ? next : x)));
    await save({ id: b.id, brand_id: b.brand_id, media_url: b.media_url, media_type: b.media_type, fit: next.fit, pos_x: next.pos_x, pos_y: next.pos_y, duration_sec: next.duration_sec, active: next.active, sort_order: next.sort_order });
  }

  async function remove(b: Banner) {
    if (!confirm(L("ลบแบนเนอร์นี้?", "Delete this banner?", "删除?"))) return;
    setBanners((list) => list.filter((x) => x.id !== b.id));
    await fetch(`/api/admin/display-banners?id=${b.id}`, { method: "DELETE" });
    try { localStorage.setItem("shdpos.banners-updated", String(Date.now())); } catch { /* ignore */ }
  }

  async function move(b: Banner, dir: -1 | 1) {
    const i = banners.findIndex((x) => x.id === b.id);
    const j = i + dir;
    if (j < 0 || j >= banners.length) return;
    const a = banners[i], c = banners[j];
    await Promise.all([
      save({ id: a.id, brand_id: a.brand_id, media_url: a.media_url, media_type: a.media_type, fit: a.fit, pos_x: a.pos_x, pos_y: a.pos_y, duration_sec: a.duration_sec, active: a.active, sort_order: c.sort_order }),
      save({ id: c.id, brand_id: c.brand_id, media_url: c.media_url, media_type: c.media_type, fit: c.fit, pos_x: c.pos_x, pos_y: c.pos_y, duration_sec: c.duration_sec, active: c.active, sort_order: a.sort_order }),
    ]);
    await load(brandId);
  }

  const brandName = brands.find((b) => b.id === brandId)?.name ?? "";

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><MonitorPlay size={22} /> {L("แบนเนอร์จอลูกค้า", "Customer display banners", "客显横幅")}</h1>
          <p className="text-sm text-muted mt-0.5">{L("รูป/วิดีโอที่เลื่อนวนบนจอลูกค้าตอนว่าง — ตั้งแยกรายแบรนด์", "Images/videos rotating on the idle customer display — per brand", "空闲时轮播")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="h-10">
            {brands.map((b) => <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>)}
          </Select>
          <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />
          <Button variant="primary" className="h-10" disabled={uploading || !brandId} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {L("อัปโหลด", "Upload", "上传")}
          </Button>
        </div>
      </div>

      {authErr ? (
        <Card className="p-6"><EmptyState icon={<MonitorPlay size={26} />} title={L("เข้าถึงไม่ได้ (เซสชัน)", "Not authorized", "无权限")} body={L("เปิด /api/dev/login ก่อนในเครื่อง dev", "Open /api/dev/login (dev)", "")} /></Card>
      ) : loading ? (
        <div className="py-16 text-center text-muted"><Loader2 className="inline animate-spin" size={20} /></div>
      ) : !banners.length ? (
        <EmptyState icon={<ImagePlus size={28} />} title={L(`ยังไม่มีแบนเนอร์ของ ${brandName}`, `No banners for ${brandName}`, "暂无")} body={L("กด “อัปโหลด” เพื่อเพิ่มรูปหรือวิดีโอ", "Tap “Upload” to add image/video", "点上传")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {banners.map((b, i) => (
            <Card key={b.id} className={`p-3.5 ${b.active ? "" : "opacity-60"}`}>
              {/* พรีวิวกรอบจอ 16:9 */}
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-neutral-900 border border-line">
                {b.media_type === "video" ? (
                  <video src={b.media_url} className="w-full h-full" style={{ objectFit: b.fit, objectPosition: `${b.pos_x}% ${b.pos_y}%` }} muted loop autoPlay playsInline />
                ) : (
                  <img src={b.media_url} alt="" className="w-full h-full" style={{ objectFit: b.fit, objectPosition: `${b.pos_x}% ${b.pos_y}%` }} />
                )}
                <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/55 text-white inline-flex items-center gap-1">
                  {b.media_type === "video" ? <><Film size={10} /> {L("วิดีโอ", "Video", "视频")}</> : <><ImagePlus size={10} /> {L("รูป", "Image", "图片")}</>} · #{i + 1}
                </span>
              </div>

              {/* คอนโทรล */}
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs">
                    {(["cover", "contain"] as const).map((f) => (
                      <button key={f} onClick={() => void patch(b, { fit: f })} className={`px-2.5 h-8 font-medium ${b.fit === f ? "bg-brand text-brandInk" : "text-muted hover:bg-surface2"}`}>{f === "cover" ? L("เต็มกรอบ", "Fill", "填满") : L("พอดี", "Fit", "适应")}</button>
                    ))}
                  </div>
                  <label className="text-xs text-muted inline-flex items-center gap-1.5">{L("เลื่อนทุก", "Every", "每")}
                    <Input type="number" min={2} max={60} value={b.duration_sec} onChange={(e) => void patch(b, { duration_sec: Math.min(60, Math.max(2, Number(e.target.value) || 6)) })} className="h-8 w-16 text-center" /> {L("วิ", "s", "秒")}
                  </label>
                  {b.media_type === "video" ? <span className="text-[10px] text-muted">({L("วิดีโอเล่นจนจบคลิป", "video plays full clip", "")})</span> : null}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => void move(b, -1)} disabled={i === 0} className="h-8 w-8 grid place-items-center rounded-lg border border-line text-muted hover:bg-surface2 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => void move(b, 1)} disabled={i === banners.length - 1} className="h-8 w-8 grid place-items-center rounded-lg border border-line text-muted hover:bg-surface2 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button onClick={() => void patch(b, { active: !b.active })} title={b.active ? L("ปิด", "Off", "停") : L("เปิด", "On", "开")} className={`h-8 w-8 grid place-items-center rounded-lg border ${b.active ? "border-brand/30 text-brand bg-brand/8" : "border-line text-muted"}`}><Power size={14} /></button>
                    <button onClick={() => void remove(b)} className="h-8 w-8 grid place-items-center rounded-lg border border-line text-muted hover:text-danger hover:border-danger/40"><Trash2 size={14} /></button>
                  </div>
                </div>

                {/* จัดตำแหน่ง (เฉพาะเต็มกรอบ) */}
                {b.fit === "cover" ? (
                  <div className="grid grid-cols-2 gap-3 pt-0.5">
                    <label className="text-[11px] text-muted">{L("แนวนอน", "Horizontal", "水平")} {b.pos_x}%
                      <input type="range" min={0} max={100} value={b.pos_x} onChange={(e) => setBanners((l) => l.map((x) => x.id === b.id ? { ...x, pos_x: Number(e.target.value) } : x))} onMouseUp={(e) => void patch(b, { pos_x: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void patch(b, { pos_x: Number((e.target as HTMLInputElement).value) })} className="w-full accent-brand" />
                    </label>
                    <label className="text-[11px] text-muted">{L("แนวตั้ง", "Vertical", "垂直")} {b.pos_y}%
                      <input type="range" min={0} max={100} value={b.pos_y} onChange={(e) => setBanners((l) => l.map((x) => x.id === b.id ? { ...x, pos_y: Number(e.target.value) } : x))} onMouseUp={(e) => void patch(b, { pos_y: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void patch(b, { pos_y: Number((e.target as HTMLInputElement).value) })} className="w-full accent-brand" />
                    </label>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
