// POST /api/pos/ow-stock-check — เช็กยอด "ขายได้จริงใน JST" ก่อนรับเงิน (สาขาที่ผูกคลังกลางเท่านั้น)
//   body: { branch_id, items:[{product_id, qty}] }
//   ขายได้ = /v1/stock qty (JST: on-hand − OrderLock − pickLock, ERIS-255) − บิลของสาขาที่ยังไม่เข้า JST
//   คืน { linked, checked, short:[{product_id, sku, need, sellable}], sn_issues, sn_unchecked } · OW ล่ม/อ่านไม่ได้ = checked:false (ไม่บล็อกการขาย แค่เตือน)
//   items[].serials (ถ้ามี) → ถาม JST ทีละ SN ว่าอยู่คลังนี้/SKU ตรง/ยังขายได้/ไม่ชำรุด (กัน JST ปฏิเสธบิลหลังลูกค้าจ่าย)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owWarehouseOf } from "@/lib/server/ow-branch";
import { owConfig } from "@/lib/server/ow-gateway";
import { owCall } from "@/lib/server/ow-write";
import { pendingSaleQty } from "@/lib/server/ow-reconcile";
import { checkSaleSerials } from "@/lib/server/ow-serials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = (await req.json().catch(() => null)) as { branch_id?: string; items?: { product_id?: string; qty?: number; serials?: string[] }[] } | null;
  const branchId = b?.branch_id ?? "";
  if (!UUID.test(branchId)) return reply({ error: "สาขาไม่ถูกต้อง" }, 400);
  const allowed = await visibleBranchIds(authz);
  if (allowed !== null && !allowed.includes(branchId)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);

  // รวมจำนวนต่อสินค้า (ตะกร้าอาจมีสินค้าเดียวกันหลายบรรทัด)
  const need = new Map<string, number>();
  for (const it of b?.items ?? []) {
    if (!it.product_id || !UUID.test(it.product_id) || !(Number(it.qty) > 0)) continue;
    need.set(it.product_id, (need.get(it.product_id) ?? 0) + Number(it.qty));
  }
  if (!need.size || need.size > 50) return reply({ linked: false, checked: false, short: [] });

  let wh: string | null;
  try { wh = await owWarehouseOf(branchId); } catch { return reply({ linked: true, checked: false, short: [], reason: "อ่านการผูกคลังไม่ได้" }); }
  if (!wh) return reply({ linked: false, checked: false, short: [] });

  const sb = supabaseAdmin();
  const pr = await sb.from("products").select("id,sku").in("id", [...need.keys()]);
  if (pr.error) return reply({ linked: true, checked: false, short: [], reason: "อ่านสินค้าไม่ได้" });
  const skuOf = new Map((pr.data ?? []).map((p) => [p.id as string, p.sku as string]));
  const skus = [...new Set([...skuOf.values()].filter(Boolean))];
  if (!skus.length) return reply({ linked: true, checked: false, short: [] });

  const r = await owCall<{ sku: string; qty: number; onHandQty?: number; lockedQty?: number }[]>(
    "GET", `/stock?warehouseId=${encodeURIComponent(wh)}&skus=${encodeURIComponent(skus.join(","))}`, undefined, 8_000,
  );
  if (!r.ok || !Array.isArray(r.data)) return reply({ linked: true, checked: false, short: [], reason: r.error?.message ?? "คลังกลางไม่ตอบ" });
  const sellable = new Map(r.data.map((s) => [s.sku, Number(s.qty) || 0]));

  let pending = new Map<string, number>();
  try { pending = await pendingSaleQty(branchId, owConfig().source); } catch { /* อ่านไม่ได้ = ไม่หัก (ยังเช็กจาก JST ได้) */ }

  // SN: ตรวจกับ JST พร้อมกัน (ไม่รอผลสต๊อก)
  const snItems = (b?.items ?? []).filter((it) => it.product_id && Array.isArray(it.serials) && it.serials.length)
    .map((it) => ({ sku: skuOf.get(it.product_id!) ?? "", serials: (it.serials ?? []).map(String).filter(Boolean) })).filter((x) => x.sku);
  const snCheck = snItems.length ? checkSaleSerials(wh, snItems).catch(() => ({ issues: [], unchecked: snItems.flatMap((x) => x.serials) })) : Promise.resolve({ issues: [], unchecked: [] as string[] });

  const short: { product_id: string; sku: string; need: number; sellable: number }[] = [];
  for (const [pid, q] of need) {
    const sku = skuOf.get(pid);
    if (!sku) continue;
    const avail = Math.max(0, (sellable.get(sku) ?? 0) - (pending.get(pid) ?? 0));
    if (q > avail) short.push({ product_id: pid, sku, need: q, sellable: avail });
  }
  const sn = await snCheck;
  return reply({ linked: true, checked: true, short, sn_issues: sn.issues, sn_unchecked: sn.unchecked });
}
