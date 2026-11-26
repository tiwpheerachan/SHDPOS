// =====================================================================
// การใช้คูปอง/แคมเปญส่วนลด — ดึงจาก orders จริง + seed demo ให้ dashboard มีข้อมูล
//   แต่ละ usage = 1 ออเดอร์ที่ใช้คูปอง (ใครใช้ วันไหน กี่โมง สินค้าไหน ลดเท่าไร)
// =====================================================================
import { db, kvGet, kvSet } from "../offline/db";
import { listPromoCampaigns, isDemoMode, type PromoCampaign } from "./repo";
import { tr } from "@/lib/i18n/tr";

export interface CouponUsage {
  id: string;
  order_no: string;
  order_id: string | null;
  at: string;                 // ISO datetime ที่ใช้
  branch_id: string;
  branch_name: string;
  customer_name: string | null;
  code: string;
  campaign_id: string | null;
  campaign_name: string;
  discount: number;           // ส่วนลดที่ใช้ (บาท)
  bill_total: number;         // ยอดบิลสุทธิ
  products: { sku: string; name: string; qty: number }[];
  cashier_name?: string | null;
  is_demo?: boolean;
}

// PRNG เสถียร (seed คงที่ → ข้อมูล demo เหมือนเดิมทุกครั้ง)
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_CUSTOMERS = ["ลูกค้าทั่วไป", "คุณสมชาย", "คุณมณี", "Jakub", "คุณเอก", "ร้านช่างโอ๋", "คุณแพรว", "Walk-in", "คุณต่าย", "บริษัท กรีนไดรฟ์"];
const DEMO_CASHIERS = ["Tiw", "Nun", "Mhom", "Safe", "Apple"];

/** สร้าง demo usages (คงที่) เก็บใน kv ครั้งเดียว */
async function seedDemoUsages(promos: PromoCampaign[]): Promise<CouponUsage[]> {
  const cached = await kvGet<CouponUsage[]>("coupon_usages_demo", []);
  if (cached.length) return cached;
  const branches = (await db().branches.toArray()).filter((b) => b.branch_type !== "warehouse" && b.is_active);
  const products = await db().products.toArray();
  const pBy = (sku: string) => products.find((p) => p.sku === sku);
  const rnd = mulberry32(20261119);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const usages: CouponUsage[] = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const c = pick(promos.filter((p) => p.active));
    if (!c) break;
    const br = pick(branches);
    // วัน-เวลาในช่วง 30 วันล่าสุด (ชั่วโมงขาย 9:00–20:00)
    const daysAgo = Math.floor(rnd() * 30);
    const hour = 9 + Math.floor(rnd() * 11);
    const min = Math.floor(rnd() * 60);
    const dt = new Date(); dt.setDate(dt.getDate() - daysAgo); dt.setHours(hour, min, Math.floor(rnd() * 60), 0);
    // สินค้า: ถ้าแคมเปญเจาะจง → สินค้านั้น · ถ้าไม่ → สุ่ม 1–3 ชิ้น
    const goods = products.filter((p) => p.is_stocked);
    let items: { sku: string; name: string; qty: number }[];
    let base: number;
    if (c.target_skus.length) {
      const p = pBy(c.target_skus[0]) ?? pick(goods);
      const qty = 1 + Math.floor(rnd() * 2);
      items = [{ sku: p.sku, name: p.name_th, qty }];
      base = p.price * qty;
    } else {
      const k = 1 + Math.floor(rnd() * 3);
      items = Array.from({ length: k }, () => { const p = pick(goods); return { sku: p.sku, name: p.name_th, qty: 1 + Math.floor(rnd() * 2) }; });
      base = items.reduce((s, it) => { const p = pBy(it.sku); return s + (p?.price ?? 0) * it.qty; }, 0);
    }
    const discount = c.type === "percent" ? Math.round((base * c.value) / 100) : Math.min(c.value, base);
    usages.push({
      id: `cu-demo-${i}`, order_no: `POS-${dt.toISOString().slice(2, 10).replace(/-/g, "")}-${String(1000 + i).slice(1)}`,
      order_id: null, at: dt.toISOString(), branch_id: br?.id ?? "", branch_name: br ? (br.name_th || br.name) : "—",
      customer_name: pick(DEMO_CUSTOMERS), code: c.code, campaign_id: c.id, campaign_name: c.name,
      discount, bill_total: Math.max(0, base - discount), products: items, cashier_name: pick(DEMO_CASHIERS), is_demo: true,
    });
  }
  await kvSet("coupon_usages_demo", usages);
  return usages;
}

/** การใช้คูปองทั้งหมด (orders จริง + demo) เรียงล่าสุดก่อน */
export async function listCouponUsages(): Promise<CouponUsage[]> {
  const [orders, promos, branches] = await Promise.all([db().orders.toArray(), listPromoCampaigns(), db().branches.toArray()]);
  const bName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? (b.name_th || b.name) : "—"; };
  const nameOf = (id: string | null, code: string | null) => promos.find((p) => p.id === id)?.name ?? code ?? tr("คูปอง", "Coupon", "优惠券");
  const real: CouponUsage[] = orders
    .filter((o) => o.status !== "voided")
    .map((o) => {
      const rec = o as unknown as Record<string, unknown>;
      const snap = (rec.promo_snapshot as { coupon?: { code?: string; discount?: number; campaign_id?: string } } | undefined)?.coupon;
      const code = (snap?.code ?? (rec.coupon_code as string | undefined)) || null;
      const campaign_id = (snap?.campaign_id ?? (rec.coupon_campaign_id as string | undefined)) || null;
      const discount = Number(snap?.discount ?? rec.coupon_discount ?? 0);
      if (!code && !campaign_id) return null;
      return {
        id: o.id, order_no: o.order_no, order_id: o.id, at: o.created_at, branch_id: o.branch_id, branch_name: bName(o.branch_id),
        customer_name: o.customer_name ?? null, code: code ?? "", campaign_id,
        campaign_name: nameOf(campaign_id, code), discount, bill_total: o.grand_total,
        products: (o.items ?? []).filter((it) => it.kind === "goods").map((it) => ({ sku: it.sku, name: it.name, qty: it.qty })),
      } as CouponUsage;
    })
    .filter((x): x is CouponUsage => x !== null);
  const demo = isDemoMode() ? await seedDemoUsages(promos) : [];
  return [...real, ...demo].sort((a, b) => (a.at < b.at ? 1 : -1));
}
