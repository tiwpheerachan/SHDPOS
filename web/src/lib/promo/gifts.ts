// =====================================================================
// Promo — ประเมินของแถมอัตโนมัติจากแคมเปญ (pure function)
//   รับบรรทัดสินค้าขาย (ไม่รวมของแถม) + แคมเปญ + ตัวค้นสินค้า
//   คืนบรรทัดของแถมที่ควรมีในตะกร้า + คำเตือน (ของหมด/ไม่พบสินค้า)
// =====================================================================
import type { CartLine, Product } from "../types";
import type { GiftCampaign } from "../data/repo";

export interface GiftResult {
  gifts: CartLine[];
  warnings: string[];
}

export function computeCampaignGifts(
  saleLines: CartLine[],
  campaigns: GiftCampaign[],
  productBySku: (sku: string) => Product | undefined,
  stockQty: (productId: string) => number,
): GiftResult {
  const gifts: CartLine[] = [];
  const warnings: string[] = [];

  for (const c of campaigns) {
    // บรรทัดที่ "ร่วมรายการ" กับแคมเปญนี้ (ไม่รวมของแถม)
    const eligibleLines = saleLines.filter((l) => {
      if (l.is_gift) return false;
      if (c.eligible_scope === "selected" && !c.eligible_skus.includes(l.sku)) return false;
      if (c.brand_ids.length) {
        const p = l.product_id ? productBySku(l.sku) : undefined;
        if (!p || !p.brand_id || !c.brand_ids.includes(p.brand_id)) return false;
      }
      return true;
    });
    if (eligibleLines.length === 0) continue;

    const totalQty = eligibleLines.reduce((s, l) => s + l.qty, 0);
    const maxSkuQty = Math.max(...eligibleLines.map((l) => l.qty));
    const baseQty = c.eligible_across_sku ? totalQty : maxSkuQty;
    const eligibleSpend = eligibleLines.reduce((s, l) => s + l.unit_price * l.qty, 0);

    const minQty = c.eligible_min_qty ?? 1;
    if (baseQty < minQty) continue;
    if (eligibleSpend < (c.min_spend ?? 0)) continue;

    // จำนวนชุดของแถม
    let sets = c.gift_mode === "per_item" ? Math.floor(baseQty / Math.max(c.gift_per_qty || 1, 1)) : 1;
    if (c.gift_cap != null) sets = Math.min(sets, c.gift_cap);
    if (sets <= 0) continue;

    for (const g of c.gift_skus) {
      const p = productBySku(g.sku);
      if (!p) { warnings.push(`ของแถม ${g.sku} ไม่พบในระบบ (${c.name})`); continue; }
      const qty = sets * (g.gift_qty || 1);
      if (p.is_stocked && stockQty(p.id) < qty) {
        warnings.push(`ของแถม ${p.name_th} คงเหลือไม่พอ (${c.name})`);
      }
      gifts.push({
        lineId: `gift:${c.id}:${p.id}`,
        product_id: p.id,
        sku: p.sku,
        name: p.name_th,
        kind: "goods",
        qty,
        unit_price: 0,
        list_price: p.price,
        discount_amount: 0,
        discount_percent: 0,
        unit_cost: p.cost,
        track_serial: p.track_serial,
        serials: [],
        salesperson_id: null,
        is_gift: true,
        gift_source: "campaign",
        gift_campaign_id: c.id,
      });
    }
  }
  return { gifts, warnings };
}

/** ลายเซ็นเทียบว่าเซ็ตของแถมเปลี่ยนไหม (กันลูปใน effect) */
export function giftSig(lines: CartLine[]): string {
  return lines
    .filter((l) => l.gift_source === "campaign")
    .map((l) => `${l.gift_campaign_id}:${l.sku}:${l.qty}`)
    .sort()
    .join("|");
}
