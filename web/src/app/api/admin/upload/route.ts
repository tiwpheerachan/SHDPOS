import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "campaign-covers";
const MAX = 3 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
};

// อัปโหลดรูป (รับ data URL base64) → เก็บ Supabase Storage → คืน public URL
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => null)) as { data?: string } | null;
  const dataUrl = b?.data;
  if (!dataUrl || typeof dataUrl !== "string") return NextResponse.json({ error: "no data" }, { status: 400 });

  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return NextResponse.json({ error: "รูปแบบไฟล์ไม่ถูกต้อง" }, { status: 400 });
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return NextResponse.json({ error: "รองรับเฉพาะ PNG/JPG/WEBP/GIF" }, { status: 400 });

  const buf = Buffer.from(m[2], "base64");
  if (buf.byteLength > MAX) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 3MB" }, { status: 400 });

  const path = `${crypto.randomUUID()}.${ext}`;
  const sb = supabaseAdmin();
  const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
