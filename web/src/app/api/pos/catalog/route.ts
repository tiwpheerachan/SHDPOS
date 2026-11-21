import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBrandIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
    if (!profile)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const authz = await resolveAuthz(profile);
    if (!authz.allowed || !hasPerm(profile.email, authz, "inventory.view"))
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const cursor = req.nextUrl.searchParams.get("cursor");
    if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor))
      return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    const sb = supabaseAdmin();
    let q = sb
      .from("products")
      .select("*,product_barcodes(barcode)")
      .order("id")
      .limit(500);
    if (cursor) q = q.gt("id", cursor);
    const brands = visibleBrandIds(authz);
    if (brands !== null && authz.data_scope === "brand") {
      if (!brands.length)
        return NextResponse.json({
          items: [],
          has_more: false,
          next_cursor: null,
          actor_id: authz.employee_id,
        });
      q = q.in("brand_id", brands);
    }
    const { data, error } = await q;
    if (error || !data)
      return NextResponse.json(
        { error: "อ่านแคตตาล็อกกลางไม่สำเร็จ" },
        { status: 503 },
      );
    const cost = hasPerm(profile.email, authz, "report.cost");
    return NextResponse.json({
      actor_id: authz.employee_id,
      items: data.map((p) => {
        const { product_barcodes, ...product } = p;
        return {
          ...product,
          ...(!cost ? { cost: 0 } : {}),
          barcodes: product_barcodes.map((b: { barcode: string }) => b.barcode),
        };
      }),
      has_more: data.length === 500,
      next_cursor: data.length === 500 ? data[data.length - 1].id : null,
    });
  } catch {
    return NextResponse.json(
      { error: "อ่านแคตตาล็อกกลางไม่สำเร็จ" },
      { status: 503 },
    );
  }
}
