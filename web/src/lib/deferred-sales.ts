import type {PaymentEntry} from './types';
export interface DeferredSale {id:string;branch_id:string;created_by:string;state:'pending'|'posted'|'cancelled';version:number;draft:any;agreed_total:number;occurred_at:string;delivered:boolean;reason:string;issues:{code:string;product_id:string}[];payments:PaymentEntry[];created_at:string;result:any;posted_at?:string}
export async function deferredRequest(action:string,id:string,branchId:string,extra:Record<string,unknown>={}){const r=await fetch('/api/pos/deferred-sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,branch_id:branchId,...extra}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok)throw Error(j.error||'บันทึกรายการไม่สำเร็จ');return j}
export async function deferredList(branchId:string,history=false):Promise<{items:DeferredSale[];truncated:boolean}>{
 const items=new Map<string,DeferredSale>(),seen=new Set<string>();let cursor:string|null=null;
 for(let page=0;page<100;page++){
  const params=new URLSearchParams({branch_id:branchId,history:String(history)});if(cursor)params.set('cursor',cursor);
  const r=await fetch('/api/pos/deferred-sales?'+params,{cache:'no-store',signal:AbortSignal.timeout(20000)}),j=await r.json();if(!r.ok)throw Error(j.error||'อ่านรายการไม่สำเร็จ');
  for(const row of j.items)items.set(row.id,row);
  if(!j.has_more)return {items:[...items.values()],truncated:false};
  if(!j.next_cursor||seen.has(j.next_cursor))throw Error('จุดอ่านรายการซ้ำ กรุณาโหลดใหม่');seen.add(j.next_cursor);cursor=j.next_cursor;
 }
 return {items:[...items.values()],truncated:true};
}
export function paidTotal(d:DeferredSale){return Math.round(d.payments.reduce((s,p)=>s+Number(p.amount),0)*100)/100}
export const issueLabels:Record<string,string>={inactive:'ยังไม่เปิดขาย',sn_missing:'SN ไม่ครบ',sn_policy_unknown:'ยังไม่ยืนยัน SN',price_override:'ราคาต่างจากราคากลาง',master_data:'ข้อมูลสินค้าไม่ครบ',stock_uninitialized:'ยังไม่ตั้งยอดสาขา',stock_short:'ยอดในระบบไม่พอ',bundle:'รอ BOM'};
