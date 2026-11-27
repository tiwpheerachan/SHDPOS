// =====================================================================
// /api/admin/sales-fields — ฟิลด์เพิ่มเองในตารางยอดขาย (แบบ Lark Base)
//   GET                                         → { fields, values: { [order_key]: { [field_id]: value } }, can_edit }  (sales.view)
//   POST { action: "field_create", name, type, options }                                                          (sales.annotate)
//        { action: "field_update", id, name?, options?, position? } · { action: "field_delete", id }
//        { action: "set", order_key, field_id, value }   ค่า null/"" = ลบ
//   ไม่แตะข้อมูลบิลจริง (ยอด/สินค้า/สาขา) — เก็บแยกตาราง sales_fields / sales_field_values
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const TYPES = ["text", "number", "select", "checkbox", "date"] as const;
type FieldType = (typeof TYPES)[number];
type Opt = { id: string; label: string; color: number };

async function who(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return null;
  return { profile, view: hasPerm(profile.email, authz, "sales.view"), edit: hasPerm(profile.email, authz, "sales.annotate") };
}

function cleanOptions(raw: unknown): Opt[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 100).flatMap((o) => {
    const label = String((o as Opt)?.label ?? "").trim().slice(0, 40);
    const id = String((o as Opt)?.id ?? "").slice(0, 40) || Math.random().toString(36).slice(2, 10);
    if (!label || seen.has(label)) return [];
    seen.add(label);
    return [{ id, label, color: Math.max(0, Math.min(8, Math.round(Number((o as Opt)?.color) || 0))) }];
  });
}

function cleanValue(type: FieldType, v: unknown, opts: Opt[]): unknown {
  if (v === null || v === undefined || v === "") return null;
  switch (type) {
    case "text": return String(v).slice(0, 2000);
    case "number": { const n = Number(v); if (!Number.isFinite(n)) throw Error("ต้องเป็นตัวเลข"); return n; }
    case "checkbox": return v === true || v === "true" ? true : null;
    case "date": { const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error("วันที่ไม่ถูกต้อง"); return s; }
    case "select": { const s = String(v); if (!opts.some((o) => o.id === s)) throw Error("ไม่มีตัวเลือกนี้"); return s; }
  }
}

export async function GET(req: NextRequest) {
  const w = await who(req);
  if (!w?.view) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const sb = supabaseAdmin();
  const f = await sb.from("sales_fields").select("id,name,type,options,position").order("position").order("created_at");
  if (f.error) return reply({ error: f.error.message }, 503);
  const values: Record<string, Record<string, unknown>> = {};
  for (let i = 0; ; i += 1000) {
    const r = await sb.from("sales_field_values").select("order_key,field_id,value").range(i, i + 999);
    if (r.error) return reply({ error: r.error.message }, 503);
    for (const v of r.data ?? []) (values[v.order_key] ??= {})[v.field_id] = v.value;
    if ((r.data ?? []).length < 1000 || i > 200_000) break;
  }
  return reply({ fields: f.data ?? [], values, can_edit: w.edit });
}

export async function POST(req: NextRequest) {
  const w = await who(req);
  if (!w?.edit) return reply({ error: "ไม่มีสิทธิ์แก้ไข (ต้องมีสิทธิ์ เพิ่มคอลัมน์/กรอกข้อมูลในตารางยอดขาย)" }, 403);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  const by = w.profile.email;
  try {
    if (b.action === "field_create") {
      const name = String(b.name ?? "").trim().slice(0, 60);
      const type = String(b.type) as FieldType;
      if (!name || !TYPES.includes(type)) return reply({ error: "ชื่อหรือประเภทไม่ถูกต้อง" }, 400);
      const max = await sb.from("sales_fields").select("position").order("position", { ascending: false }).limit(1);
      const r = await sb.from("sales_fields").insert({ name, type, options: type === "select" ? cleanOptions(b.options) : [], position: (max.data?.[0]?.position ?? 0) + 1, created_by: by }).select("id,name,type,options,position").single();
      if (r.error) throw Error(r.error.message);
      return reply({ ok: true, field: r.data });
    }
    if (b.action === "field_update") {
      const patch: Record<string, unknown> = {};
      if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 60);
      if (b.options !== undefined) patch.options = cleanOptions(b.options);
      if (typeof b.position === "number") patch.position = Math.round(b.position);
      const r = await sb.from("sales_fields").update(patch).eq("id", String(b.id)).select("id,name,type,options,position").single();
      if (r.error) throw Error(r.error.message);
      return reply({ ok: true, field: r.data });
    }
    if (b.action === "field_delete") {
      const r = await sb.from("sales_fields").delete().eq("id", String(b.id));
      if (r.error) throw Error(r.error.message);
      return reply({ ok: true });
    }
    if (b.action === "set") {
      const key = String(b.order_key ?? "").slice(0, 300);
      const f = await sb.from("sales_fields").select("id,type,options").eq("id", String(b.field_id)).maybeSingle();
      if (!key || !f.data) return reply({ error: "ไม่พบคอลัมน์" }, 404);
      const value = cleanValue(f.data.type as FieldType, b.value, (f.data.options ?? []) as Opt[]);
      const r = value === null
        ? await sb.from("sales_field_values").delete().eq("order_key", key).eq("field_id", f.data.id)
        : await sb.from("sales_field_values").upsert({ order_key: key, field_id: f.data.id, value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "order_key,field_id" });
      if (r.error) throw Error(r.error.message);
      return reply({ ok: true, value });
    }
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }, 400); }
  return reply({ error: "action ไม่ถูกต้อง" }, 400);
}
