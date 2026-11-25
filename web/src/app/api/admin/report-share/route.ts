// /api/admin/report-share — ลิงก์แชร์รายงาน (ภาพนิ่งตัวเลขที่สรุปแล้ว ไม่มีข้อมูลส่วนตัวลูกค้า) ลงลายเซ็นเหมือนลิงก์เอกสาร (0079)
//   POST {title, payload, days(1–90)} → { url } · GET → ลิงก์ที่ตัวเองสร้าง · DELETE ?id= ยกเลิกลิงก์
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signDocToken } from "@/lib/server/doc-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
// ห้ามมีข้อมูลส่วนตัวในภาพนิ่ง — ตัดคีย์ที่อาจเป็น PII ทิ้งทั้งก้อน
const PII = /phone|customer_name|email|tax_id|address/i;
const scrub = (v: unknown): unknown => Array.isArray(v) ? v.map(scrub) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !PII.test(k)).map(([k, x]) => [k, scrub(x)])) : v;
async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id || !hasPerm(profile.email, authz, "sales.view")) return null;
  return { me: authz.employee_id, canShare: hasPerm(profile.email, authz, "report.share") };
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  if (!c.canShare) return reply({ error: "ไม่มีสิทธิ์แชร์รายงานออกภายนอก (report.share)" }, 403);
  const b = (await req.json().catch(() => null)) as { title?: string; payload?: unknown; days?: number } | null;
  const raw = JSON.stringify(b?.payload ?? null);
  if (!b?.payload || raw.length > 400_000) return reply({ error: "ข้อมูลรายงานไม่ถูกต้องหรือใหญ่เกินไป" }, 400);
  const days = Math.min(90, Math.max(1, Math.round(Number(b.days) || 30)));
  const r = await supabaseAdmin().from("pos_report_snapshots").insert({ report: "sales", title: String(b.title ?? "รายงานยอดขาย").slice(0, 120), payload: scrub(b.payload),
    created_by: c.me, expires_at: new Date(Date.now() + days * 86400_000).toISOString() }).select("id,expires_at").single();
  if (r.error) return reply({ error: r.error.message }, 400);
  return reply({ id: r.data.id, url: `/share/report/${signDocToken("report", r.data.id, days)}`, expires_at: r.data.expires_at });
}
export async function GET(req: NextRequest) {
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const r = await supabaseAdmin().from("pos_report_snapshots").select("id,title,created_at,expires_at,revoked_at,view_count").eq("created_by", c.me).order("created_at", { ascending: false }).limit(30);
  return reply({ links: r.data ?? [] });
}
export async function DELETE(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const r = await supabaseAdmin().from("pos_report_snapshots").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("created_by", c.me).select("id");
  return r.data?.length ? reply({ ok: true }) : reply({ error: "ยกเลิกได้เฉพาะลิงก์ที่ตัวเองสร้าง" }, 403);
}
