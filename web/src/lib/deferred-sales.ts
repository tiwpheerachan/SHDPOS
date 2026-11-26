import type {PaymentEntry} from './types';
import {tr} from './i18n/tr';
export interface DeferredSale {id:string;branch_id:string;created_by:string;state:'pending'|'posted'|'cancelled';version:number;draft:any;agreed_total:number;occurred_at:string;delivered:boolean;reason:string;issues:{code:string;product_id:string}[];payments:PaymentEntry[];created_at:string;result:any;posted_at?:string}
export async function deferredRequest(action:string,id:string,branchId:string,extra:Record<string,unknown>={}){const r=await fetch('/api/pos/deferred-sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,branch_id:branchId,...extra}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok)throw Error(j.error||tr('บันทึกรายการไม่สำเร็จ','Failed to save item','保存项目失败'));return j}
export async function deferredList(branchId:string,history=false):Promise<{items:DeferredSale[];truncated:boolean}>{
 const items=new Map<string,DeferredSale>(),seen=new Set<string>();let cursor:string|null=null;
 for(let page=0;page<100;page++){
  const params=new URLSearchParams({branch_id:branchId,history:String(history)});if(cursor)params.set('cursor',cursor);
  const r=await fetch('/api/pos/deferred-sales?'+params,{cache:'no-store',signal:AbortSignal.timeout(20000)}),j=await r.json();if(!r.ok)throw Error(j.error||tr('อ่านรายการไม่สำเร็จ','Failed to load list','读取列表失败'));
  for(const row of j.items)items.set(row.id,row);
  if(!j.has_more)return {items:[...items.values()],truncated:false};
  if(!j.next_cursor||seen.has(j.next_cursor))throw Error(tr('จุดอ่านรายการซ้ำ กรุณาโหลดใหม่','Duplicate page cursor, please reload','读取位置重复，请重新加载'));seen.add(j.next_cursor);cursor=j.next_cursor;
 }
 return {items:[...items.values()],truncated:true};
}
export function paidTotal(d:DeferredSale){return Math.round(d.payments.reduce((s,p)=>s+Number(p.amount),0)*100)/100}
export const issueLabels=():Record<string,string>=>({inactive:tr('ยังไม่เปิดขาย','Not active for sale','未上架'),sn_missing:tr('SN ไม่ครบ','SN incomplete','SN 不全'),sn_policy_unknown:tr('ยังไม่ยืนยัน SN','SN not confirmed','SN 未确认'),price_override:tr('ราคาต่างจากราคากลาง','Price differs from list','价格与标准价不同'),master_data:tr('ข้อมูลสินค้าไม่ครบ','Product data incomplete','商品资料不全'),stock_uninitialized:tr('ยังไม่ตั้งยอดสาขา','Branch stock not set','门店库存未设置'),stock_short:tr('ยอดในระบบไม่พอ','Insufficient system stock','系统库存不足'),bundle:tr('รอ BOM','Awaiting BOM','等待 BOM')});
