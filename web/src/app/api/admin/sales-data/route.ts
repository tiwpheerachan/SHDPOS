// /api/admin/sales-data — บิลจริงจากระบบกลางสำหรับหน้ายอดขาย/ผลงานพนักงาน (แทนข้อมูลในเครื่อง)
//   GET ?from=ISO&to=ISO → { orders: Order[], branches, brands, employees, truncated }
//   สิทธิ์ sales.view · เห็นเฉพาะสาขาในขอบเขต · data_scope=own เห็นเฉพาะบิลตัวเอง · ต้นทุน/กำไรซ่อนถ้าไม่มี report.cost
//   ยอดขายระบบเดิม (Lark) ส่งแบบบีบอัดใน legacy (หน้าเว็บกางเป็นบิลเอง — lib/legacy-expand) · ?legacy=0 ปิด
//   ตัวกรองละเอียด (พนักงาน/หมวด/SKU/ชำระ/ช่องทาง/สถานะ ฯลฯ) คิดฝั่งหน้าเว็บด้วย applyOrderFilters (สูตรเดียวกับทุกหน้า)
import { NextRequest, NextResponse } from "next/server";
import { loadSalesData } from "@/lib/server/sales-data";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "sales.view")) return reply({ error: "ไม่มีสิทธิ์ดูยอดขาย" }, 403);
  const from = new Date(req.nextUrl.searchParams.get("from") ?? ""), to = new Date(req.nextUrl.searchParams.get("to") ?? "");
  if (Number.isNaN(+from) || Number.isNaN(+to) || to < from || +to - +from > 1200 * 86400_000) return reply({ error: "ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 1,200 วัน)" }, 400);
  const sb = supabaseAdmin();
  const allowed = await visibleBranchIds(authz);
  const showCost = hasPerm(profile.email, authz, "report.cost");
  const own = authz.data_scope === "own" ? authz.employee_id ?? null : null;
  try { return reply(await loadSalesData(sb, { from, to, allowed, showCost, own, legacy: req.nextUrl.searchParams.get("legacy") !== "0" })); }
  catch (e) { return reply({ error: e instanceof Error ? e.message : "อ่านข้อมูลไม่สำเร็จ" }, 503); }
}
