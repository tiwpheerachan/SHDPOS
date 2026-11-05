import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// รวมลูกค้าซ้ำ — body: { primary_id, merge_ids: string[] }
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => null)) as { primary_id?: string; merge_ids?: string[] } | null;
  const primary = b?.primary_id;
  const losers = (b?.merge_ids ?? []).filter((x) => x && x !== primary);
  if (!primary || losers.length === 0) {
    return NextResponse.json({ error: "primary_id และ merge_ids จำเป็น" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().rpc("admin_merge_customers", {
    p_primary: primary,
    p_losers: losers,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, customer: data });
}
