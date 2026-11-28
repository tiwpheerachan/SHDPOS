// /api/admin/report-views — มุมมองรายงานที่บันทึกไว้ (0079 + แชร์รายคน/ลิงก์สาธารณะ 0099)
//   GET ?report=sales_sheet → มุมมองของตัวเอง + ที่แชร์ให้ทีม + ที่แชร์ให้ฉันรายคน (พร้อม "ใครเห็นได้บ้าง")
//   GET ?people=1           → รายชื่อพนักงานที่เลือกแชร์ได้
//   POST {id?, name, state, shared, shared_with?}  สร้าง/แก้ (แก้ได้เฉพาะของตัวเอง)
//   POST {action:"link", id, days}  สร้างลิงก์สาธารณะ (สิทธิ์ report.share) · {action:"unlink", id} ยกเลิกลิงก์
//   DELETE ?id=  ลบ (ของตัวเอง)
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const sameOrigin = (req: NextRequest) => !req.headers.get("origin") || new URL(req.headers.get("origin")!).host === req.nextUrl.host;
const empName = (e: { first_name?: string | null; last_name?: string | null; nickname?: string | null }) => e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ");

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id || !hasPerm(profile.email, authz, "sales.view")) return null;
  return { me: authz.employee_id, authz, canLink: hasPerm(profile.email, authz, "report.share") };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const sb = supabaseAdmin();
  if (req.nextUrl.searchParams.get("people")) {
    const r = await sb.from("employees").select("id,first_name,last_name,nickname,photo_url,employee_code").eq("status", "active").order("first_name").limit(2000);
    return reply({ people: (r.data ?? []).filter((e) => e.id !== c.me).map((e) => ({ id: e.id, name: empName(e), photo: e.photo_url, code: e.employee_code })) });
  }
  const report = req.nextUrl.searchParams.get("report") ?? "sales";
  const r = await sb.from("pos_report_views").select("id,name,state,shared,owner_id,shared_with,link_token,link_expires_at,link_views,link_mode,link_snapshot_at,updated_at")
    .eq("report", report).or(`owner_id.eq.${c.me},shared.eq.true,shared_with.cs.{${c.me}}`).order("updated_at", { ascending: false }).limit(100);
  if (r.error) return reply({ error: "อ่านมุมมองไม่สำเร็จ — ตรวจ migration 0079/0099" }, 503);
  const ids = [...new Set((r.data ?? []).flatMap((v) => [v.owner_id, ...(v.shared_with ?? [])]))];
  const emps = ids.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname,photo_url").in("id", ids)).data ?? []) : [];
  const who = new Map(emps.map((e) => [e.id, { id: e.id, name: empName(e), photo: e.photo_url }]));
  return reply({
    can_link: c.canLink,
    views: (r.data ?? []).map((v) => {
      const mine = v.owner_id === c.me;
      return {
        id: v.id, name: v.name, state: v.state, shared: v.shared, updated_at: v.updated_at, mine,
        owner: who.get(v.owner_id)?.name ?? "", owner_person: who.get(v.owner_id) ?? null,
        shared_with: (v.shared_with ?? []).map((id: string) => who.get(id) ?? { id, name: "?", photo: null }),
        // ลิงก์สาธารณะ — เจ้าของเท่านั้นที่เห็น token
        link: mine && v.link_token ? { token: v.link_token, expires_at: v.link_expires_at, views: v.link_views, mode: v.link_mode, snapshot_at: v.link_snapshot_at } : v.link_token ? { active: true } : null,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as { id?: string; name?: string; state?: unknown; shared?: boolean; shared_with?: unknown; report?: string; action?: string; days?: number | null;
    mode?: "live" | "snapshot"; snapshot?: { orders?: Record<string, unknown>[]; branches?: unknown[]; brands?: unknown[]; employees?: unknown[]; state?: unknown } } | null;
  if (!b) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();

  if (b.action === "link" || b.action === "unlink") {
    if (!b.id || !UUID.test(b.id)) return reply({ error: "id" }, 400);
    if (b.action === "link" && !c.canLink) return reply({ error: "ไม่มีสิทธิ์สร้างลิงก์สาธารณะ (ต้องมีสิทธิ์แชร์รายงาน)" }, 403);
    // ภาพนิ่ง: เก็บบิลที่มุมมองแสดงอยู่ตอนนี้ (ตัดข้อมูลลูกค้า/ต้นทุนซ้ำที่เซิร์ฟเวอร์) · จำกัดขนาด
    let snap: Record<string, unknown> | null = null;
    if (b.action === "link" && b.mode === "snapshot") {
      const orders = Array.isArray(b.snapshot?.orders) ? b.snapshot!.orders : [];
      if (!orders.length) return reply({ error: "ไม่มีข้อมูลให้ทำภาพนิ่ง" }, 400);
      if (orders.length > 20000) return reply({ error: "ภาพนิ่งใหญ่เกิน 20,000 บิล — แคบช่วงวันที่/ตัวกรองลง หรือใช้แบบข้อมูลสด" }, 400);
      for (const o of orders) {
        Object.assign(o, { customer_id: null, customer_name: null, customer_phone: null, cost_total: 0, gross_profit: 0, client_uuid: null });
        for (const it of (o.items as Record<string, unknown>[] | undefined) ?? []) Object.assign(it, { unit_cost: 0, cost_total: 0, gross_profit: 0, serials: [] });
      }
      snap = { orders, branches: b.snapshot?.branches ?? [], brands: b.snapshot?.brands ?? [], employees: b.snapshot?.employees ?? [], state: b.snapshot?.state ?? null };
      if (JSON.stringify(snap).length > 12_000_000) return reply({ error: "ภาพนิ่งใหญ่เกินไป — แคบช่วงวันที่/ตัวกรองลง" }, 400);
    }
    const patch = b.action === "unlink"
      ? { link_token: null, link_expires_at: null, link_branches: null, link_created_by: null, link_mode: "live", link_snapshot: null, link_snapshot_at: null }
      : {
          link_mode: snap ? "snapshot" : "live", link_snapshot: snap, link_snapshot_at: snap ? new Date().toISOString() : null,
          link_token: randomBytes(24).toString("base64url"),
          link_expires_at: b.days ? new Date(Date.now() + Math.min(365, Math.max(1, Number(b.days))) * 86400_000).toISOString() : null,
          link_branches: await visibleBranchIds(c.authz), link_created_by: c.me, link_views: 0,
        };
    const r = await sb.from("pos_report_views").update(patch).eq("id", b.id).eq("owner_id", c.me).select("id,link_token,link_expires_at,link_mode,link_snapshot_at").maybeSingle();
    if (!r.data) return reply({ error: "จัดการลิงก์ได้เฉพาะมุมมองของตัวเอง" }, 403);
    return reply({ ok: true, link: r.data.link_token ? { token: r.data.link_token, expires_at: r.data.link_expires_at, mode: r.data.link_mode, snapshot_at: r.data.link_snapshot_at } : null });
  }

  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name || !b.state || typeof b.state !== "object" || JSON.stringify(b.state).length > 12000) return reply({ error: "ข้อมูลมุมมองไม่ถูกต้อง" }, 400);
  const sharedWith = Array.isArray(b.shared_with) ? [...new Set(b.shared_with.map(String).filter((x) => UUID.test(x) && x !== c.me))].slice(0, 200) : undefined;
  if (b.id && UUID.test(b.id)) {
    const r = await sb.from("pos_report_views").update({ name, state: b.state, shared: !!b.shared, ...(sharedWith ? { shared_with: sharedWith } : {}), updated_at: new Date().toISOString() })
      .eq("id", b.id).eq("owner_id", c.me).select("id").maybeSingle();
    if (!r.data) return reply({ error: "แก้ได้เฉพาะมุมมองของตัวเอง" }, 403);
    return reply({ id: r.data.id });
  }
  const r = await sb.from("pos_report_views").insert({ report: b.report ?? "sales", name, state: b.state, shared: !!b.shared, shared_with: sharedWith ?? [], owner_id: c.me }).select("id").single();
  if (r.error) return reply({ error: r.error.message }, 400);
  return reply({ id: r.data.id });
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return reply({ error: "id" }, 400);
  const r = await supabaseAdmin().from("pos_report_views").delete().eq("id", id).eq("owner_id", c.me).select("id");
  return r.data?.length ? reply({ ok: true }) : reply({ error: "ลบได้เฉพาะมุมมองของตัวเอง" }, 403);
}
