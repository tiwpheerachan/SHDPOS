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
    const [{ data: customer, error: cErr }, { data: orders, error: oErr }, { data: ledger }, { data: tasks }] = await Promise.all([
      sb.from("customers").select("*").eq("id", id).maybeSingle(),
      sb
        .from("orders")
        .select("id,order_no,created_at,branch_id,grand_total,status,channel,order_items(sku,name,qty,unit_price,line_total)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .limit(300),
      sb
        .from("loyalty_ledger")
        .select("id,kind,points_delta,credit_delta,balance_points,balance_credit,note,created_at")
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("customer_tasks")
        .select("id,kind,title,note,due_date,status,assigned_to,result,created_at,completed_at")
        .eq("customer_id", id)
        .order("status", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(50),
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
      ledger: ledger ?? [],
      tasks: tasks ?? [],
    });
  }

  // ---------- ตรวจลูกค้าซ้ำ (เบอร์โทรเดียวกัน) ----------
  if (req.nextUrl.searchParams.get("duplicates")) {
    const { data: all, error: dErr } = await sb
      .from("customers")
      .select("id,name,phone,email,member_code,points,store_credit,created_at")
      .not("phone", "is", null)
      .limit(5000);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

    const norm = (p: string | null) => (p ?? "").replace(/\D/g, "");
    const byPhone: Record<string, typeof all> = {};
    for (const c of all ?? []) {
      const k = norm(c.phone);
      if (k.length < 6) continue; // เบอร์สั้นเกินไป ข้าม
      (byPhone[k] ??= []).push(c);
    }
    const dupIds: string[] = [];
    const rawGroups = Object.entries(byPhone).filter(([, m]) => (m?.length ?? 0) > 1);
    for (const [, m] of rawGroups) for (const c of m ?? []) dupIds.push(c.id);

    // นับจำนวนบิลของแต่ละคนในกลุ่มซ้ำ (ไว้เลือก primary)
    const cnt: Record<string, number> = {};
    if (dupIds.length) {
      const { data: orows } = await sb.from("orders").select("customer_id").in("customer_id", dupIds).neq("status", "voided");
      for (const o of orows ?? []) cnt[o.customer_id as string] = (cnt[o.customer_id as string] ?? 0) + 1;
    }

    const groups = rawGroups
      .map(([phone, m]) => ({
        phone,
        members: (m ?? [])
          .map((c) => ({ ...c, orders: cnt[c.id] ?? 0, points: Number(c.points ?? 0), store_credit: Number(c.store_credit ?? 0) }))
          .sort((a, b) => b.orders - a.orders || (a.created_at < b.created_at ? -1 : 1)),
      }))
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 100);

    return NextResponse.json({ groups });
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

// ---------------------------------------------------------------------
// POST — เติมเครดิต / ปรับแต้ม (บันทึกลง ledger แบบ atomic)
//   body: { customer_id, points?, credit?, kind?, note? }
// ---------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as
    | {
        action?: string; customer_id?: string; points?: number; credit?: number; kind?: string; note?: string;
        consent?: { contact_consent?: boolean; consent_channels?: string[]; consent_note?: string };
      }
    | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });

  // รันแต้มหมดอายุทั้งระบบ
  if (b.action === "expire_points") {
    const { data, error } = await supabaseAdmin().rpc("expire_points", { p_customer_id: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, expired: data ?? 0 });
  }

  if (!b.customer_id) return NextResponse.json({ error: "customer_id required" }, { status: 400 });

  // อัปเดตความยินยอมติดต่อ (PDPA)
  if (b.consent) {
    const CH = ["sms", "email", "line", "call"];
    const channels = (b.consent.consent_channels ?? []).filter((c) => CH.includes(c));
    const { error } = await supabaseAdmin()
      .from("customers")
      .update({
        contact_consent: !!b.consent.contact_consent,
        consent_channels: channels,
        consent_note: b.consent.consent_note ?? null,
        consent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", b.customer_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const points = Math.trunc(Number(b.points ?? 0));
  const credit = Number(b.credit ?? 0);
  if (!points && !credit) return NextResponse.json({ error: "no change" }, { status: 400 });

  const kind = b.kind ?? (credit ? "topup" : "adjust");
  const actor = ctx.authz.employee_id;
  const actorId = typeof actor === "string" && /^[0-9a-f-]{36}$/i.test(actor) ? actor : null;
  const { data, error } = await supabaseAdmin().rpc("admin_loyalty_adjust", {
    p_customer_id: b.customer_id,
    p_points: points,
    p_credit: credit,
    p_kind: kind,
    p_note: b.note ?? null,
    p_actor: actorId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, balance: data });
}
