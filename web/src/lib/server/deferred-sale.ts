import {object,UUID} from './sale-validation';
import {round2} from '@/lib/money';
export const deferredIssueLabels:Record<string,string>={inactive:'สินค้ายังปิดขาย',sn_missing:'SN ยังไม่ครบ',sn_policy_unknown:'ยังไม่ยืนยันนโยบาย SN',price_override:'ราคาขายจริงต่างจากราคากลาง',stock_uninitialized:'ยังไม่มียอดสต๊อกสาขา',stock_short:'สต๊อกในระบบไม่พอ',bundle:'รอส่วนประกอบสินค้าชุด',master_data:'รอแบรนด์หรือหมวดหมู่'};
/** A factual pending-sale record, never an approval to skip final stock/SN validation. */
export function deferredDraft(input:unknown,catalog:any[],branch:string,actor:string){
 const b=object(input),items=b.items;if(!Array.isArray(items)||!items.length||items.length>200)throw Error('รายการสินค้าไม่ถูกต้อง');
 if(b.coupon_code||b.redeem_points||items.some((i:any)=>i?.is_gift))throw Error('รายการขายก่อนยังไม่รองรับคูปอง แต้ม หรือของแถม กรุณาให้ผู้ดูแลตรวจสิทธิ์ก่อน');
 const products=new Map(catalog.map(p=>[p.id,p])),seen=new Set<string>(),issues:any[]=[];
 const lines=items.map(raw=>{const i=object(raw),p=products.get(i.product_id);if(!p)throw Error('ไม่พบสินค้าในแคตตาล็อก');
 const qty=i.qty,price=i.unit_price;if(!Number.isInteger(qty)||qty<=0||qty>10000||typeof price!=='number'||!Number.isFinite(price)||price<=0||price>1e9||round2(price)!==price)throw Error('กรุณาระบุจำนวนเต็มและราคาขายจริงที่มากกว่าศูนย์ทุกสินค้า');
 const gross=round2(qty*price),discount=i.discount_amount??round2(gross*(i.discount_percent??0)/100);
 if(typeof discount!=='number'||!Number.isFinite(discount)||discount<0||discount>gross)throw Error('ส่วนลดสินค้าไม่ถูกต้อง');
 const serials=(i.serials??[]);if(!Array.isArray(serials)||serials.length>qty)throw Error('จำนวน SN มากกว่าจำนวนสินค้า');
 const normalized=serials.map((sn:unknown)=>{if(typeof sn!=='string'||!sn.trim()||sn.length>200)throw Error('SN ไม่ถูกต้อง');const n=sn.trim().toUpperCase();if(seen.has(n))throw Error('SN ซ้ำในรายการ');seen.add(n);return n});
 const codes:string[]=[];if(!p.is_active)codes.push('inactive');if(p.serial_policy_confirmed===false)codes.push('sn_policy_unknown');if(p.track_serial&&normalized.length<qty)codes.push('sn_missing');if(Number(p.price)!==price)codes.push('price_override');if(!p.brand_id||!p.category_id)codes.push('master_data');if(p.kind==='bundle')codes.push('bundle');for(const code of codes)issues.push({product_id:p.id,code});
 return {product_id:p.id,sku:p.sku,name:p.name_th,kind:p.kind==='service'?'service':p.kind==='fee'?'fee':'goods',qty,unit_price:price,discount_amount:round2(discount),discount_percent:0,serials:normalized,track_serial:!!p.track_serial,is_gift:false};
 });
 const prices=new Map<string,number>();for(const i of lines){if(prices.has(i.product_id)&&prices.get(i.product_id)!==i.unit_price)throw Error('สินค้ารหัสเดียวกันต้องใช้ราคาเดียวกันในรายการขายก่อน กรุณาแยกบิลหากขายต่างราคา');prices.set(i.product_id,i.unit_price)}
 const subtotal=round2(lines.reduce((n,i)=>n+i.qty*i.unit_price,0)),lineDiscount=round2(lines.reduce((n,i)=>n+i.discount_amount,0)),discount=b.discount_total??lineDiscount;
 if(typeof discount!=='number'||!Number.isFinite(discount)||discount<lineDiscount||discount>=subtotal)throw Error('ส่วนลดรวมไม่ถูกต้อง');
 const total=round2(subtotal-discount);if(total!==b.grand_total)throw Error('ยอดรวมไม่ตรงกับราคาขายจริง กรุณาตรวจรายการ');
 const channels=['offline','online_shopee','online_lazada','online_tiktok','online_website','event','b2b','other'];if(!channels.includes(b.channel))throw Error('ช่องทางขายไม่ถูกต้อง');
 if(b.salesperson_id&&!UUID.test(b.salesperson_id))throw Error('รหัสพนักงานขายไม่ถูกต้อง');
 if(b.customer_id&&!UUID.test(b.customer_id))throw Error('รหัสลูกค้าไม่ถูกต้อง');
 for(const key of ['customer_name','customer_phone'])if(b[key]!=null&&(typeof b[key]!=='string'||b[key].length>300))throw Error('ข้อมูลลูกค้าไม่ถูกต้อง');
 return {draft:{branch_id:branch,cashier_id:actor,salesperson_id:b.salesperson_id||actor,customer_id:b.customer_id||null,customer_name:b.customer_name||null,customer_phone:b.customer_phone||null,channel:b.channel,items:lines,subtotal,discount_total:round2(discount),grand_total:total},issues};
}
