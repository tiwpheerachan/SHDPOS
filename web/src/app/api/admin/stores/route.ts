import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------------
// GET — รายการร้าน + สาขาในร้าน
// ---------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();

  const [{ data: stores, error }, { data: branches }] = await Promise.all([
    sb.from("stores").select("*").order("created_at", { ascending: false }),
    sb.from("branches").select("id,name,name_th,brand_id,store_id,branch_type"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byStore: Record<string, { id: string; name: string }[]> = {};
  for (const b of branches ?? []) {
    if (!b.store_id) continue;
    (byStore[b.store_id as string] ??= []).push({ id: b.id, name: (b.name_th as string) || (b.name as string) });
  }
  return NextResponse.json({
    stores: (stores ?? []).map((s) => ({ ...s, branches: byStore[s.id] ?? [] })),
    branches: (branches ?? []).map((b) => ({ id: b.id, name: (b.name_th as string) || (b.name as string), brand_id: b.brand_id, store_id: b.store_id })),
  });
}

// ---------------------------------------------------------------------
// POST — สร้าง/แก้ไขร้าน + ผูกสาขาเข้าร้าน
// ---------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const sb = supabaseAdmin();

  const row: Record<string, unknown> = {
    name: typeof b.name === "string" ? b.name.trim() : undefined,
    name_th: typeof b.name_th === "string" ? b.name_th.trim() || null : undefined,
    code: typeof b.code === "string" && b.code.trim() ? b.code.trim().toUpperCase() : null,
    brand_id: isUuid(b.brand_id) ? b.brand_id : null,
    store_type: typeof b.store_type === "string" ? b.store_type : "brand_shop",
    note: typeof b.note === "string" ? b.note.trim() || null : undefined,
    is_active: b.is_active === undefined ? true : !!b.is_active,
    updated_at: new Date().toISOString(),
  };

  let storeId: string;
  if (isUuid(b.id)) {
    const patch = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const { error } = await sb.from("stores").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    storeId = b.id as string;
  } else {
    if (!row.name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const { data, error } = await sb.from("stores").insert(row).select("id").single();
    if (error) {
      const msg = error.code === "23505" ? "รหัสร้านนี้ถูกใช้แล้ว" : error.message;
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    storeId = data.id;
  }

  // ผูกสาขาเข้าร้าน (ถ้าส่ง branch_ids มา): ปลดสาขาเดิมที่ไม่อยู่ในลิสต์ + ตั้งสาขาใหม่
  if (Array.isArray(b.branch_ids)) {
    const ids = (b.branch_ids as unknown[]).filter(isUuid) as string[];
    await sb.from("branches").update({ store_id: null }).eq("store_id", storeId);
    if (ids.length) await sb.from("branches").update({ store_id: storeId }).in("id", ids);
  }

  return NextResponse.json({ ok: true, id: storeId });
}

// ---------------------------------------------------------------------
// DELETE — ลบร้าน (สาขาจะถูกปลดออกจากร้านอัตโนมัติ: store_id → null)
// ---------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin().from("stores").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
