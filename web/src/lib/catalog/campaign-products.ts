export interface CampaignProduct { id:string; sku:string; name_th:string; is_active:boolean }
export interface CampaignReference { product_id:string;sku:string;name:string;role:"eligible"|"gift";gift_qty:number }
/** Resolve campaign references to canonical IDs. Browser-supplied names/SKUs cannot replace product identity. */
export function campaignReferences(eligible: unknown, gifts: unknown, products: CampaignProduct[], active: boolean, selected: boolean): CampaignReference[] {
  const result: CampaignReference[]=[];
  for (const [input,role] of [[eligible,"eligible"],[gifts,"gift"]] as const) {
    if (!Array.isArray(input) || input.length>200) throw Error("รายการสินค้าแคมเปญไม่ถูกต้อง");
    for (const raw of input) {
      if (!raw || typeof raw!=="object") throw Error("รายการสินค้าแคมเปญไม่ถูกต้อง");
      const p=raw as {product_id?:unknown;sku?:unknown;gift_qty?:unknown};
      const matches=products.filter(v=>typeof p.product_id==="string" ? v.id===p.product_id : typeof p.sku==="string" && v.sku.toUpperCase()===p.sku.trim().toUpperCase());
      if (matches.length!==1) throw Error("ไม่พบสินค้าที่อ้างอิงในแคตตาล็อก POS กรุณาเลือกสินค้าใหม่");
      const product=matches[0];
      if (typeof p.sku==="string" && p.sku.trim().toUpperCase()!==product.sku.toUpperCase()) throw Error("รหัสสินค้าไม่ตรงกับ product_id กรุณาเลือกสินค้าใหม่");
      if (active && !product.is_active) throw Error(`${product.sku} ยังไม่เปิดใช้งาน กรุณาบันทึกแคมเปญเป็นแบบร่าง`);
      const qty=role==="gift" ? Number(p.gift_qty ?? 1) : 1;
      if (!Number.isSafeInteger(qty)||qty<1) throw Error("จำนวนของแถมต้องเป็นจำนวนเต็มมากกว่า 0");
      if (result.some(v=>v.role===role && v.product_id===product.id)) throw Error("สินค้าแคมเปญซ้ำ");
      result.push({product_id:product.id,sku:product.sku,name:product.name_th,role,gift_qty:qty});
    }
  }
  if (selected && !result.some(v=>v.role==="eligible")) throw Error("กรุณาเลือกสินค้าร่วมรายการอย่างน้อย 1 รายการ");
  return result;
}
