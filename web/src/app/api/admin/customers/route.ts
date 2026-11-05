import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// เกณฑ์แบ่งกลุ่มลูกค้า (ปรับได้ภายหลัง)
const VIP_SPEND = 50_000; // บาท
const LOST_DAYS = 180; // ไม่ซื้อเกินกี่วัน = หายไป

type Segment = "new" | "returning" | "vip" | "lost";

function segmentOf(orders: number, spend: number, recencyDays: number | null): Segment {
  if (recencyDays !== null && recencyDays > LOST_DAYS && orders > 0) return "lost";
  if (spend >= VIP_SPEND || orders >= 5) return "vip";
  if (orders >= 2) return "returning";
  return "new";
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

interface OrderStat {
  count: number;
  spend: number;
  last: string | null;
  first: string | null;
}

// ---------------------------------------------------------------------
// GET — รายชื่อ (ค้นหา/ล่าสุด) พร้อมสถิติ หรือ ?id= → โปรไฟล์ + ประวัติ
// ---------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");

  // ---------- โปรไฟล์ลูกค้าคนเดียว + ประวัติทุกสาขา ----------
  if (id) {
    const [{ data: customer, error: cErr }, { data: orders, error: oErr }] = await Promise.all([
      sb.from("customers").select("*").eq("id", id).maybeSingle(),
      sb
        .from("orders")
        .select("id,order_no,created_at,branch_id,grand_total,status,channel,order_items(sku,name,qty,unit_price,line_total)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
    if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

    const valid = (orders ?? []).filter((o) => o.status !== "voided");
    const spend = valid.reduce((s, o) => s + Number(o.grand_total ?? 0), 0);
    const last = valid[0]?.created_at ?? null;
    const first = valid.length ? valid[valid.length - 1].created_at : null;
    const stat = { count: valid.length, spend, last, first };
    const recencyDays = daysSince(last);

    return NextResponse.json({
      customer,
      stat: {
        ...stat,
        avg: stat.count ? Math.round(spend / stat.count) : 0,
        recencyDays,
        segment: segmentOf(stat.count, spend, recencyDays),
      },
      orders: orders ?? [],
    });
  }

  // ---------- รายชื่อ (ค้น หรือ ล่าสุด) ----------
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  let cq = sb.from("customers").select("*");
  if (q) {
    const safe = q.replace(/[%,]/g, " ");
    cq = cq.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,member_code.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data: customers, error } = await cq.order("created_at", { ascending: false }).limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (customers ?? []).map((c) => c.id);
  const stats: Record<string, OrderStat> = {};
  if (ids.length) {
    const { data: orows } = await sb
      .from("orders")
      .select("customer_id,grand_total,created_at,status")
      .in("customer_id", ids)
      .neq("status", "voided");
    for (const o of orows ?? []) {
      const k = o.customer_id as string;
      const s = (stats[k] ??= { count: 0, spend: 0, last: null, first: null });
      s.count += 1;
      s.spend += Number(o.grand_total ?? 0);
      const t = o.created_at as string;
      if (!s.last || t > s.last) s.last = t;
      if (!s.first || t < s.first) s.first = t;
    }
  }

  const rows = (customers ?? []).map((c) => {
    const s = stats[c.id] ?? { count: 0, spend: 0, last: null, first: null };
    const recencyDays = daysSince(s.last);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      member_code: c.member_code,
      points: Number(c.points ?? 0),
      store_credit: Number(c.store_credit ?? 0),
      tier: c.tier,
      orders: s.count,
      spend: s.spend,
      last: s.last,
      recencyDays,
      segment: segmentOf(s.count, s.spend, recencyDays),
    };
  });

  return NextResponse.json({ customers: rows });
}
