import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { listGrants, upsertGrant, deleteGrant } from "@/lib/sso/grants";
import type { AppUserGrant } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const grants = await listGrants();
  return NextResponse.json({ grants });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Partial<AppUserGrant> | null;
  if (!body?.email) return NextResponse.json({ error: "email required" }, { status: 400 });
  try {
    const grant = await upsertGrant(body as Partial<AppUserGrant> & { email: string }, ctx.profile.email);
    return NextResponse.json({ grant });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "upsert failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  // กันลบ superadmin ตัวเอง
  await deleteGrant(email);
  return NextResponse.json({ ok: true });
}
