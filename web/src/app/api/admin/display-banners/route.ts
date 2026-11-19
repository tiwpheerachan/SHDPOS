// =====================================================================
// /api/admin/display-banners — จัดการแบนเนอร์จอลูกค้า (รายแบรนด์)
//   GET ?brand=   → ทั้งหมดของแบรนด์ + global (รวม inactive)
//   POST          → สร้าง/แก้ (ใส่ media_data base64 เพื่ออัปโหลดรูป/วิดีโอ)
//   DELETE ?id=   → ลบ
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "display-media";
const MAX = 30 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const brand = req.nextUrl.searchParams.get("brand");
  const sb = supabaseAdmin();
  let q = sb.from("display_banners").select("*");
  q = brand ? q.or(`brand_id.eq.${brand},brand_id.is.null`) : q.is("brand_id", null);
  const { data, error } = await q.order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ banners: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const sb = supabaseAdmin();

  // อัปโหลดสื่อถ้าส่ง data URL มา
  let mediaUrl = typeof b.media_url === "string" ? b.media_url : undefined;
  let mediaType = b.media_type === "video" ? "video" : "image";
  if (typeof b.media_data === "string" && b.media_data.startsWith("data:")) {
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(b.media_data);
    if (!m) return NextResponse.json({ error: "รูปแบบไฟล์ไม่ถูกต้อง" }, { status: 400 });
    const mime = m[1].toLowerCase();
    const ext = EXT[mime];
    if (!ext) return NextResponse.json({ error: "รองรับ PNG/JPG/WEBP/GIF/MP4/WEBM" }, { status: 400 });
    const buf = Buffer.from(m[2], "base64");
    if (buf.byteLength > MAX) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 30MB" }, { status: 400 });
    const path = `${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    mediaUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    mediaType = mime.startsWith("video/") ? "video" : "image";
  }

  const row: Record<string, unknown> = {
    brand_id: isUuid(b.brand_id) ? b.brand_id : null,
    media_type: mediaType,
    fit: b.fit === "contain" ? "contain" : "cover",
    pos_x: Math.min(100, Math.max(0, Math.trunc(Number(b.pos_x ?? 50)))),
    pos_y: Math.min(100, Math.max(0, Math.trunc(Number(b.pos_y ?? 50)))),
    duration_sec: Math.min(60, Math.max(2, Math.trunc(Number(b.duration_sec ?? 6)))),
    active: b.active === undefined ? true : !!b.active,
    updated_at: new Date().toISOString(),
  };
  if (b.sort_order !== undefined) row.sort_order = Math.trunc(Number(b.sort_order));
  if (mediaUrl) row.media_url = mediaUrl;

  if (isUuid(b.id)) {
    const { error } = await sb.from("display_banners").update(row).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: b.id });
  }
  if (!row.media_url) return NextResponse.json({ error: "ต้องมีรูป/วิดีโอ" }, { status: 400 });
  const { data, error } = await sb.from("display_banners").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin().from("display_banners").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
