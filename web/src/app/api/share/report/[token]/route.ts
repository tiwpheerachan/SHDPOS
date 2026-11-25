// /api/share/report/[token] — เปิดภาพนิ่งรายงานผ่านลิงก์แชร์ (สาธารณะ อ่านอย่างเดียว) · ตรวจลายเซ็น + วันหมดอายุ + ยกเลิกแล้วหรือยัง
import { NextRequest, NextResponse } from "next/server";
import { verifyDocToken } from "@/lib/server/doc-token";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const t = verifyDocToken(params.token);
  if (!t || t.k !== "report") return NextResponse.json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุ" }, { status: 404 });
  const sb = supabaseAdmin();
  const r = await sb.from("pos_report_snapshots").select("id,title,payload,created_at,expires_at,revoked_at,view_count,created_by").eq("id", t.id).maybeSingle();
  if (!r.data || r.data.revoked_at || new Date(r.data.expires_at) < new Date()) return NextResponse.json({ error: "ลิงก์นี้ถูกยกเลิกหรือหมดอายุแล้ว" }, { status: 410 });
  await sb.from("pos_report_snapshots").update({ view_count: (r.data.view_count ?? 0) + 1 }).eq("id", t.id);
  const by = (await sb.from("employees").select("first_name,nickname").eq("id", r.data.created_by).maybeSingle()).data;
  return NextResponse.json({ title: r.data.title, payload: r.data.payload, created_at: r.data.created_at, expires_at: r.data.expires_at, by: by?.nickname || by?.first_name || "" }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
