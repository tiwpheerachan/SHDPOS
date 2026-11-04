import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { searchDirectory } from "@/lib/sso/central";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ค้นหาพนักงานจาก directory ระบบกลาง (proxy — API key อยู่ฝั่ง server เท่านั้น)
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ items: [] });
  try {
    const items = await searchDirectory(q.trim());
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "search failed", items: [] }, { status: 500 });
  }
}
