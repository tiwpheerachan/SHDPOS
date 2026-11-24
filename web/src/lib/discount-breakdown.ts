// =====================================================================
// แยกส่วนลดของบิลตามที่มา (ใช้ร่วม: หมายเหตุบิลที่ส่ง JST + ประวัติส่วนลดหลังบ้าน)
//   JST รับส่วนลดได้ 2 ระดับ: รายสินค้า (lineDiscount) · ทั้งบิล (billDiscount) — ไม่รู้จักแคมเปญ/คูปอง
//   ระบบเราคำนวณเอง แล้วส่ง "ผล" + บอกที่มาในหมายเหตุบิล
//   ที่มา: ส่วนลดรายการ (พนักงาน) · โปรรายสินค้า (แคมเปญผูก SKU) · ส่วนลดท้ายบิล (พนักงาน) · คูปอง/แคมเปญทั้งบิล · ใช้แต้ม · ของแถม
// =====================================================================
import { POINT_VALUE_THB } from "./loyalty";

export type BreakdownItem = { sku: string; name?: string | null; qty: number; unit_price: number; discount_amount: number; is_gift?: boolean | null; gift_source?: string | null; gift_campaign_id?: string | null };
export type BreakdownOrder = {
  grand_total: number; discount_total?: number | null;
  promo_snapshot?: { coupon?: { code?: string | null; discount?: number | null; campaign_id?: string | null } | null; redeem_points?: number | null; redeem_value?: number | null;
    line_campaigns?: { campaign_id?: string | null; code?: string | null; name?: string | null; sku?: string | null; discount?: number | null }[] | null } | null;
  items: BreakdownItem[];
};
export type DiscountBreakdown = {
  gross: number;
  /** ส่วนลดรายการที่พนักงานกดเอง */
  lines: { sku: string; amount: number }[]; lineTotal: number;
  /** โปรรายสินค้า (ลดที่บรรทัด) */
  lineCampaigns: { code: string; campaign: string | null; sku: string; amount: number }[]; lineCampaignTotal: number;
  billManual: number;
  coupon: { code: string; amount: number; campaign: string | null } | null;
  points: { points: number; value: number } | null;
  gifts: { sku: string; qty: number; campaign: string | null }[];
  total: number;
  /** ที่ส่ง JST จริง: lineDiscount = ส่วนลดรายการ + โปรรายสินค้า · billDiscount = ท้ายบิล + คูปอง + แต้ม */
  jst: { lineDiscount: number; billDiscount: number; freebieLines: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function discountBreakdown(o: BreakdownOrder, campaignName: (id: string | null | undefined) => string | null = () => null): DiscountBreakdown {
  const paid = o.items.filter((i) => !i.is_gift);
  const gross = r2(paid.reduce((a, i) => a + Number(i.unit_price) * Number(i.qty), 0));
  // โปรรายสินค้า: discount_amount ของบรรทัด = กดเอง + โปร → แยกส่วนโปรออกตาม SKU
  const lineCampaigns = (o.promo_snapshot?.line_campaigns ?? []).filter((x) => Number(x.discount) > 0)
    .map((x) => ({ code: String(x.code ?? ""), campaign: x.name ?? campaignName(x.campaign_id), sku: String(x.sku ?? ""), amount: r2(Number(x.discount)) }));
  const lineCampaignTotal = r2(lineCampaigns.reduce((a, x) => a + x.amount, 0));
  const promoLeft = new Map<string, number>();
  for (const x of lineCampaigns) promoLeft.set(x.sku, r2((promoLeft.get(x.sku) ?? 0) + x.amount));
  const lines = paid.map((i) => {
    const d = r2(Number(i.discount_amount));
    const promo = Math.min(d, promoLeft.get(i.sku) ?? 0);
    if (promo > 0) promoLeft.set(i.sku, r2((promoLeft.get(i.sku) ?? 0) - promo));
    return { sku: i.sku, amount: r2(d - promo) };
  }).filter((l) => l.amount > 0);
  const lineTotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const c = o.promo_snapshot?.coupon;
  const coupon = c?.code && Number(c.discount) > 0 ? { code: c.code, amount: r2(Number(c.discount)), campaign: campaignName(c.campaign_id) } : null;
  const pts = Number(o.promo_snapshot?.redeem_points ?? 0);
  const ptsValue = pts > 0 ? r2(Number(o.promo_snapshot?.redeem_value ?? pts * POINT_VALUE_THB)) : 0;
  const points = pts > 0 ? { points: pts, value: ptsValue } : null;
  // ส่วนลดท้ายบิลที่พนักงานใส่ = ส่วนที่เหลือหลังหักส่วนลดรายการ/คูปอง/แต้ม จากยอดก่อนลด
  const billManual = Math.max(0, r2(gross - lineTotal - lineCampaignTotal - (coupon?.amount ?? 0) - ptsValue - Number(o.grand_total)));
  const gifts = o.items.filter((i) => i.is_gift).map((i) => ({ sku: i.sku, qty: Number(i.qty), campaign: campaignName(i.gift_campaign_id) ?? (i.gift_source === "campaign" ? "แคมเปญ" : null) }));
  const billAll = r2(billManual + (coupon?.amount ?? 0) + ptsValue);
  return {
    gross, lines, lineTotal, lineCampaigns, lineCampaignTotal, billManual, coupon, points, gifts,
    total: r2(lineTotal + lineCampaignTotal + billAll),
    jst: { lineDiscount: r2(lineTotal + lineCampaignTotal), billDiscount: billAll, freebieLines: gifts.length },
  };
}

/** ข้อความสั้นสำหรับหมายเหตุบิลใน JST (บอกที่มาของส่วนลด) — ว่างถ้าไม่มีส่วนลด/ของแถม */
export function discountRemark(b: DiscountBreakdown): string {
  const parts: string[] = [];
  if (b.lineTotal > 0) parts.push(`ลดรายการ ${b.lineTotal}`);
  for (const x of b.lineCampaigns) parts.push(`โปรสินค้า ${x.code}${x.campaign ? ` (${x.campaign})` : ""} ${x.sku} ${x.amount}`);
  if (b.billManual > 0) parts.push(`ลดท้ายบิล ${b.billManual}`);
  if (b.coupon) parts.push(`คูปอง ${b.coupon.code}${b.coupon.campaign ? ` (${b.coupon.campaign})` : ""} ${b.coupon.amount}`);
  if (b.points) parts.push(`ใช้แต้ม ${b.points.points} = ${b.points.value}`);
  for (const g of b.gifts) parts.push(`ของแถม ${g.sku}×${g.qty}${g.campaign ? ` (${g.campaign})` : ""}`);
  return parts.join(" · ");
}
