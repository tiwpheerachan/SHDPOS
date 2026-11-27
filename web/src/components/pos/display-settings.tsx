"use client";
// =====================================================================
// ตั้งค่า → จอลูกค้า: ตัวอย่างจอจริง (ฝังหน้า /pos/display?preview=1) + จัดการรูป/วิดีโอบนจอ
//   ใช้ข้อมูลเดียวกับหลังบ้าน (/admin/display · ตาราง display_banners) — แก้ฝั่งไหนก็เห็นตรงกัน
//   แก้ได้เมื่อมีสิทธิ์ display.manage (เฉพาะแบรนด์ในขอบเขต) · ไม่มีสิทธิ์ = ดูอย่างเดียว
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Upload, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Loader2, Image as ImageIcon, Film, ExternalLink, Lock } from "lucide-react";
import { Button, Segmented, Select } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { openDisplayWindow, type DisplayPayload } from "@/lib/customer-display";
import { listBrands } from "@/lib/data/repo";
import { isLiveMode } from "@/lib/supabase/client";
import type { Branch } from "@/lib/types";

type Pick3 = (th: string, en: string, zh: string) => string;
type Banner = { id: string; brand_id: string | null; media_url: string; media_type: "image" | "video"; fit: "cover" | "contain"; pos_x: number; pos_y: number; duration_sec: number; sort_order: number; active?: boolean };
type Scene = "idle" | "cart" | "payment";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const W = 1280, H = 800; // ขนาดจอลูกค้าที่จำลอง (16:10)

export function DisplaySettings({ L, branch, sunmi }: { L: Pick3; branch: Branch | null; sunmi: { secondScreen: boolean } | null }) {
  const toast = useToast();
  const [brands, setBrands] = useState<{ id: string; name: string; logo: string | null }[]>([]);
  const [brandId, setBrandId] = useState<string>("");
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene>("idle");
  const frameRef = useRef<HTMLIFrameElement>(null), boxRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(0.5);

  // แบรนด์ของสาขานี้ (หลัก + สาขาหลายแบรนด์)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const all = (await listBrands()).filter((b) => UUID.test(b.id));
      let ids = branch?.brand_id ? [branch.brand_id] : [];
      try {
        const r = await fetch("/api/admin/branch-brands", { cache: "no-store" });
        if (r.ok && branch) { const j = await r.json(); ids = [...new Set([...ids, ...(j.map?.[branch.id] ?? [])])]; }
      } catch { /* ใช้แบรนด์หลัก */ }
      const list = (ids.length ? all.filter((b) => ids.includes(b.id)) : all).map((b) => ({ id: b.id, name: b.name, logo: b.logo_url ?? null }));
      if (!alive) return;
      setBrands(list);
      setBrandId((cur) => cur || list[0]?.id || "");
    })();
    return () => { alive = false; };
  }, [branch]);

  const load = useCallback(async () => {
    if (!brandId) { setBanners([]); return; }
    setBanners(null);
    try {
      const r = await fetch(`/api/admin/display-banners?brand=${brandId}`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setCanEdit(true); setBanners((j.banners as Banner[]).filter((b) => b.brand_id === brandId)); return; }
    } catch { /* ไม่มีสิทธิ์/ออฟไลน์ → อ่านอย่างเดียว */ }
    setCanEdit(false);
    const j = await fetch(`/api/display-banners?brand=${brandId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ banners: [] }));
    setBanners((j.banners as Banner[]).filter((b) => b.brand_id === brandId).map((b) => ({ ...b, active: true })));
  }, [brandId]);
  useEffect(() => { void load(); }, [load]);

  // ย่อจอ 1280×800 ให้พอดีกรอบ
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / W, el.clientHeight / H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ส่งข้อมูลตัวอย่างเข้าไปในจอจำลอง
  const brand = brands.find((b) => b.id === brandId);
  const payload = useCallback((): DisplayPayload => {
    const base = { brandName: brand?.name, brandLogo: brand?.logo ?? undefined, branchName: branch?.name_th || branch?.name, updatedAt: Date.now() };
    const active = (banners ?? []).filter((b) => b.active !== false);
    const lines = [
      { lineId: "a", name: L("สินค้าตัวอย่าง A", "Sample product A", "示例商品 A"), qty: 1, unit_price: 4990 },
      { lineId: "b", name: L("สินค้าตัวอย่าง B", "Sample product B", "示例商品 B"), qty: 2, unit_price: 495 },
    ];
    if (scene === "idle") return { ...base, state: "idle", lines: [], subtotal: 0, discount: 0, grandTotal: 0, banners: active };
    const sum = { lines, subtotal: 5980, discount: 300, vat: 371.59, grandTotal: 5680 };
    return scene === "cart" ? { ...base, state: "cart", ...sum }
      : { ...base, state: "payment", ...sum, payMethod: "qr_promptpay", payMethodLabel: "QR PromptPay", payQr: "00020101021229370016A000000677010111011300668000000005802TH53037645406568000630400000", amountDue: 5680 };
  }, [banners, brand, branch, scene, L]);
  const inject = useCallback(() => {
    const w = frameRef.current?.contentWindow as (Window & { __shdDisplay?: (p: DisplayPayload) => void }) | null | undefined;
    try { w?.__shdDisplay?.(payload()); } catch { /* ยังโหลดไม่เสร็จ */ }
  }, [payload]);
  useEffect(() => { inject(); }, [inject]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "shd-display-preview-ready") inject(); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [inject]);

  const changed = () => { try { localStorage.setItem("shdpos.banners-updated", String(Date.now())); } catch { /* ignore */ } };
  async function save(b: Partial<Banner> & { media_data?: string }, label: string) {
    setBusy(label);
    try {
      const r = await fetch("/api/admin/display-banners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_id: brandId, ...b }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error ?? `HTTP ${r.status}`);
      changed(); await load();
    } catch (e) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/display-banners?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      changed(); await load();
    } catch (e) { toast.push({ tone: "danger", title: L("ลบไม่สำเร็จ", "Delete failed", "删除失败"), body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      if (f.size > 30 * 1024 * 1024) { toast.push({ tone: "warn", title: L(`${f.name} ใหญ่เกิน 30MB`, `${f.name} is over 30MB`, `${f.name} 超过 30MB`) }); continue; }
      const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
      await save({ media_data: data, fit: "cover", pos_x: 50, pos_y: 50, duration_sec: 6, sort_order: (banners?.length ?? 0) * 10 + 10, active: true }, "upload");
    }
    toast.push({ tone: "ok", title: L("เพิ่มลงจอลูกค้าแล้ว", "Added to the customer display", "已添加到客显屏"), body: L("หน้าขายในเครื่องนี้อัปเดตทันที · เครื่องอื่นภายใน 5 นาที", "This device updates now · other devices within 5 minutes", "本机即时更新 · 其他设备 5 分钟内") });
  }
  async function move(i: number, dir: -1 | 1) {
    const list = [...(banners ?? [])];
    const j = i + dir;
    if (!list[j]) return;
    [list[i], list[j]] = [list[j], list[i]];
    setBusy("order");
    try {
      await Promise.all(list.map((b, k) => fetch("/api/admin/display-banners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, brand_id: brandId, sort_order: (k + 1) * 10 }) })));
      changed(); await load();
    } finally { setBusy(null); }
  }

  const activeCount = (banners ?? []).filter((b) => b.active !== false).length;

  return (
    <div className="h-full grid xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)] min-h-0">
      {/* ตัวอย่างจอ */}
      <div className="p-6 flex flex-col gap-4 min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented size="sm" value={scene} onChange={setScene} options={[
            { value: "idle" as Scene, label: L("ตอนว่าง (แบนเนอร์)", "Idle (banners)", "空闲（横幅）") },
            { value: "cart" as Scene, label: L("ตอนขาย", "Selling", "销售中") },
            { value: "payment" as Scene, label: L("ตอนชำระเงิน", "Payment", "付款") },
          ]} />
          {!sunmi ? <Button size="sm" variant="soft" onClick={openDisplayWindow}><ExternalLink size={14} />{L("เปิดจอลูกค้าจริง", "Open real display", "打开客显屏")}</Button>
            : <span className="text-xs text-muted">{sunmi.secondScreen ? L("จอที่สองของ Sunmi แสดงอัตโนมัติ", "Shown on the Sunmi second screen automatically", "Sunmi 副屏自动显示") : L("ไม่พบจอที่สอง", "No second screen", "未检测到副屏")}</span>}
        </div>
        {/* กรอบจอ */}
        <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center">
          <div ref={boxRef} className="w-full flex-1 min-h-0 flex items-center justify-center">
            <div className="rounded-[18px] bg-[#0e1116] p-[10px] shadow-[0_24px_60px_-28px_rgba(0,0,0,.55)]" style={{ width: W * scale + 20, height: H * scale + 20 }}>
              <div className="relative overflow-hidden rounded-[8px] bg-white" style={{ width: W * scale, height: H * scale }}>
                <iframe ref={frameRef} title={L("ตัวอย่างจอลูกค้า", "Customer display preview", "客显屏预览")} src="/pos/display?preview=1" onLoad={inject}
                  className="absolute top-0 left-0 border-0 origin-top-left pointer-events-none" style={{ width: W, height: H, transform: `scale(${scale})` }} />
              </div>
            </div>
          </div>
          <div className="h-3 w-24 bg-[#0e1116]/80 rounded-b-xl" />
          <div className="h-1.5 w-40 bg-[#0e1116]/30 rounded-full" />
        </div>
        <p className="text-[11.5px] text-muted text-center">{L("ตัวอย่างนี้ใช้ข้อมูลสมมุติ — ไม่กระทบจอลูกค้าจริงที่เปิดอยู่", "This preview uses sample data — it doesn't affect the live customer display", "此预览使用示例数据 — 不影响正在使用的客显屏")}</p>
      </div>

      {/* รูป/วิดีโอบนจอ */}
      <aside className="border-t xl:border-t-0 xl:border-l border-line/70 bg-surface2/50 flex flex-col min-h-0">
        <div className="px-5 pt-5 pb-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{L("รูป/วิดีโอบนจอลูกค้า", "Display images & videos", "客显屏图片与视频")}</h3>
              <p className="text-[11px] text-muted">{L(`หมุนแสดงตอนว่าง · เปิดอยู่ ${activeCount} รายการ`, `Rotates when idle · ${activeCount} active`, `空闲时轮播 · 启用 ${activeCount} 项`)}</p>
            </div>
            {canEdit ? (
              <>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.currentTarget.value = ""; }} />
                <Button size="sm" variant="primary" loading={busy === "upload"} disabled={!brandId} onClick={() => fileRef.current?.click()}><Upload size={14} />{L("เพิ่มรูป/วิดีโอ", "Add media", "添加媒体")}</Button>
              </>
            ) : null}
          </div>
          {brands.length > 1 ? (
            <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="!h-9 text-xs">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          ) : brand ? <p className="text-xs"><span className="text-muted">{L("แบรนด์", "Brand", "品牌")}: </span><b translate="no">{brand.name}</b></p> : null}
          {!canEdit && banners ? (
            <p className="text-[11.5px] rounded-xl border border-line bg-surface px-3 py-2 text-muted flex gap-2"><Lock size={13} className="shrink-0 mt-0.5" />
              {!isLiveMode() ? L("โหมดสาธิต — ดูอย่างเดียว", "Demo mode — view only", "演示模式 — 仅查看") : L("ดูอย่างเดียว — ต้องมีสิทธิ์ “จอลูกค้า / แบนเนอร์” จึงจะเพิ่มหรือแก้ได้", "View only — needs the “Customer display” permission to add or edit", "仅查看 — 需要“客显屏”权限才能添加或编辑")}</p>
          ) : null}
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-5 pb-5 space-y-2">
          {banners === null ? <div className="h-32 grid place-items-center text-muted"><Loader2 size={18} className="animate-spin" /></div>
            : !banners.length ? (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-muted">
                <Monitor size={22} className="mx-auto mb-2 opacity-60" />
                {L("ยังไม่มีรูป/วิดีโอ — จอว่างจะแสดงหน้าต้อนรับ", "No media yet — the idle screen shows a welcome page", "暂无媒体 — 空闲时显示欢迎页")}
              </div>
            ) : banners.map((b, i) => (
              <div key={b.id} className={`rounded-2xl border bg-surface p-2.5 flex gap-3 ${b.active === false ? "opacity-55 border-line" : "border-line"}`}>
                <div className="relative w-28 aspect-[16/10] rounded-lg overflow-hidden bg-surface2 shrink-0">
                  {b.media_type === "video"
                    ? <video src={b.media_url} muted playsInline preload="metadata" className="w-full h-full" style={{ objectFit: b.fit, objectPosition: `${b.pos_x}% ${b.pos_y}%` }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={b.media_url} alt="" loading="lazy" className="w-full h-full" style={{ objectFit: b.fit, objectPosition: `${b.pos_x}% ${b.pos_y}%` }} />}
                  <span className="absolute left-1 top-1 rounded bg-black/60 text-white text-[9px] px-1 inline-flex items-center gap-0.5">{b.media_type === "video" ? <Film size={9} /> : <ImageIcon size={9} />}{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="text-muted">{b.media_type === "video" ? L("วิดีโอ · เล่นจนจบ", "Video · plays to end", "视频 · 播放至结束") : L("แสดง", "Show", "显示")}</span>
                    {b.media_type === "image" ? (
                      canEdit ? (
                        <select value={b.duration_sec} disabled={!!busy} onChange={(e) => void save({ ...b, duration_sec: Number(e.target.value) }, b.id)} className="h-6 rounded-md border border-line bg-surface text-[11px] px-1">
                          {[3, 5, 6, 8, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s} {L("วินาที", "sec", "秒")}</option>)}
                        </select>
                      ) : <b>{b.duration_sec} {L("วินาที", "sec", "秒")}</b>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <IconBtn title={b.active === false ? L("เปิดแสดง", "Show", "显示") : L("ซ่อน", "Hide", "隐藏")} disabled={!!busy} onClick={() => void save({ ...b, active: b.active === false }, b.id)}>{b.active === false ? <EyeOff size={14} /> : <Eye size={14} />}</IconBtn>
                      <IconBtn title={L("เลื่อนขึ้น", "Move up", "上移")} disabled={!!busy || i === 0} onClick={() => void move(i, -1)}><ArrowUp size={14} /></IconBtn>
                      <IconBtn title={L("เลื่อนลง", "Move down", "下移")} disabled={!!busy || i === banners.length - 1} onClick={() => void move(i, 1)}><ArrowDown size={14} /></IconBtn>
                      <span className="flex-1" />
                      <IconBtn title={L("ลบ", "Delete", "删除")} danger disabled={!!busy} onClick={() => void remove(b.id)}>{busy === b.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</IconBtn>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
        </div>
        <div className="px-5 py-3 border-t border-line/70 text-[11px] text-muted flex items-center justify-between gap-2">
          <span>{L("ข้อมูลเดียวกับหลังบ้าน → จอลูกค้า", "Same data as Back office → Customer display", "与后台 → 客显屏相同的数据")}</span>
          <a href="/admin/display" target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 shrink-0">{L("จัดกรอบละเอียด", "Fine-tune framing", "精细调整")}<ExternalLink size={11} /></a>
        </div>
      </aside>
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`h-7 w-7 rounded-lg grid place-items-center border border-line disabled:opacity-40 ${danger ? "text-danger hover:bg-danger/10" : "text-muted hover:text-ink hover:bg-surface2"}`}>{children}</button>
  );
}
