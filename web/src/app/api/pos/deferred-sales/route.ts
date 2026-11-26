import {NextRequest,NextResponse} from 'next/server';
import {withEffectivePrices} from '@/lib/server/effective-prices';
import {posContext,PosError,requireSameOrigin} from '@/lib/server/pos-context';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {object,UUID,validatePayments,validateQuote} from '@/lib/server/sale-validation';
import {deferredDraft} from '@/lib/server/deferred-sale';
import {hasPerm} from '@/lib/sso/guard';
import {kickSaleOutbox} from '@/lib/server/ow-sales';
export const dynamic='force-dynamic';
const errors:Record<string,string>={deferred_version_conflict:'รายการถูกแก้จากอีกเครื่อง กรุณาโหลดใหม่',deferred_conflict:'เลขอ้างอิงนี้ถูกใช้แล้ว กรุณาเปิดรายการเดิมในพักบิล',deferred_not_pending:'รายการนี้ปิดบิลหรือยกเลิกแล้ว',deferred_reservation_changed:'ยอดกันสินค้าถูกเปลี่ยน ต้องให้ผู้ดูแลกระทบยอดก่อน',paid_deferred_requires_refund:'รับเงินแล้ว ต้องผ่านกระบวนการคืนเงิน ห้ามลบทิ้ง',delivered_deferred_requires_return:'ส่งมอบแล้ว ต้องรับสินค้าคืนก่อนยกเลิก',payment_total_mismatch:'ยอดรับชำระยังไม่ครบหรือไม่ตรงกับยอดขายจริง',serial_reserved_by_deferred_sale:'SN ถูกกันไว้ในรายการขายก่อนอีกใบ',serial_reserved:'SN ถูกจองในบิลอื่น',delivery_status_requires_review:'รายการที่ส่งมอบแล้วต้องผ่านกระบวนการคืนสินค้า ไม่สามารถเปลี่ยนเป็นยังไม่ส่งได้',invalid_serial_lines:'ข้อมูล SN ไม่ครบทุกบรรทัด',delivery_confirmation_required:'กรุณายืนยันว่าส่งมอบสินค้าแล้ว',insufficient_available_stock:'สต๊อกไม่พอปิดบิล ต้องกระทบยอดรับเข้าให้ถูกต้องก่อน',stock_not_initialized:'ยังไม่มียอดตั้งต้นของสินค้าที่สาขานี้',product_inactive:'ต้องตรวจและเปิดใช้งานสินค้าให้เรียบร้อยก่อนปิดบิล'};
const fail=(e:unknown)=>NextResponse.json({error:e instanceof Error?errors[e.message]||e.message:'ดำเนินการไม่สำเร็จ'},{status:e instanceof PosError?e.status:409});
async function rows(sb:any,branch:string,id?:string){let q=sb.from('pos_deferred_sales').select('*').eq('branch_id',branch);return id?q.eq('id',id).single():q.order('created_at',{ascending:false}).limit(300)}
function safe(row:any,cost:boolean){return {...row,draft:{...row.draft,items:row.draft.items.map((i:any)=>{const {unit_cost,cost_total,gross_profit,...rest}=i;return cost?i:rest})}}}
export async function GET(req:NextRequest){try{
 const branch=req.nextUrl.searchParams.get('branch_id')??'';if(!UUID.test(branch))throw new PosError('สาขาไม่ถูกต้อง');const ctx=await posContext(req,'pos.sell',branch),sb=supabaseAdmin();const id=req.nextUrl.searchParams.get('id');if(id){if(!UUID.test(id))throw new PosError('รหัสรายการไม่ถูกต้อง');const r=await rows(sb,branch,id);if(r.error||!r.data)throw new PosError('ไม่พบรายการในสาขานี้',404);return NextResponse.json({items:[safe(r.data,hasPerm(ctx.profile.email,ctx.authz,'report.cost'))],has_more:false},{headers:{'Cache-Control':'no-store'}})}
 const cursor=req.nextUrl.searchParams.get('cursor');if(cursor&&!UUID.test(cursor))throw new PosError('จุดอ่านต่อไม่ถูกต้อง');let q=sb.from('pos_deferred_sales').select('*').eq('branch_id',branch).order('id').limit(300);q=req.nextUrl.searchParams.get('history')==='true'?q.neq('state','pending'):q.eq('state','pending');if(cursor)q=q.gt('id',cursor);const r=await q;if(r.error)throw new PosError('อ่านรายการขายก่อนรอปิดบิลไม่สำเร็จ กรุณาตรวจ migration 0044',503);
 return NextResponse.json({items:r.data.map((r:any)=>safe(r,hasPerm(ctx.profile.email,ctx.authz,'report.cost'))),has_more:r.data.length===300,next_cursor:r.data.length===300?r.data[r.data.length-1].id:null},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return fail(e)}}
export async function POST(req:NextRequest){try{
 requireSameOrigin(req);const b=object(await req.json());if(!UUID.test(b.id)||!UUID.test(b.branch_id))throw new PosError('รหัสรายการไม่ถูกต้อง');const ctx=await posContext(req,'pos.sell',b.branch_id),sb=supabaseAdmin();let result:any;
 if(b.action==='create'){
  if(typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>2000||typeof b.delivered!=='boolean')throw new PosError('กรุณาระบุเหตุผลและสถานะส่งมอบ');
  const occurred=Date.parse(b.occurred_at);if(!Number.isFinite(occurred)||occurred>Date.now()+300000||occurred<Date.parse('2000-01-01'))throw new PosError('วันเวลาขายจริงไม่ถูกต้อง');
  const input=object(b.draft);if(!Array.isArray(input.items)||!input.items.length||input.items.length>200)throw new PosError('รายการสินค้าไม่ถูกต้อง');
  const ids=[...new Set(input.items.map((i:any)=>object(i).product_id))];if(ids.some(id=>!UUID.test(id)))throw new PosError('รหัสสินค้าไม่ถูกต้อง');
  const p=await sb.from('products').select('*').in('id',ids);if(p.error)throw new PosError('อ่านข้อมูลสินค้าไม่สำเร็จ',503);
  const pricedP=await withEffectivePrices(sb,b.branch_id,p.data??[],new Date(occurred).toISOString()); // ราคาช่วงเวลา ณ เวลาขายจริง (0081)
  const {draft,issues}=deferredDraft(input,pricedP,b.branch_id,ctx.actorId);
  if(draft.salesperson_id!==ctx.actorId){
   const [person,assignment]=await Promise.all([sb.from('employees').select('status,home_branch_id').eq('id',draft.salesperson_id).maybeSingle(),sb.from('employee_branches').select('branch_id').eq('employee_id',draft.salesperson_id).eq('branch_id',b.branch_id).maybeSingle()]);
   if(person.error||assignment.error)throw new PosError('ตรวจพนักงานขายไม่สำเร็จ',503);
   if(!person.data||person.data.status!=='active'||(person.data.home_branch_id!==b.branch_id&&!assignment.data))throw new PosError('พนักงานขายไม่ได้ประจำสาขานี้',403);
  }
  if(draft.customer_id){const c=await sb.from('customers').select('id').eq('id',draft.customer_id).maybeSingle();if(c.error||!c.data)throw new PosError('กรุณาซิงก์ข้อมูลสมาชิกก่อนบันทึก');}
  result=await sb.rpc('pos_create_deferred_sale',{p_id:b.id,p_actor:ctx.actorId,p_branch:b.branch_id,p_draft:draft,p_occurred:new Date(occurred).toISOString(),p_delivered:b.delivered,p_reason:b.reason.trim(),p_issues:issues});
 }else{
  if(!Number.isSafeInteger(b.version)||b.version<1)throw new PosError('เวอร์ชันรายการไม่ถูกต้อง');
  const r=await rows(sb,b.branch_id,b.id);if(r.error||!r.data)throw new PosError('ไม่พบรายการในสาขานี้',404);const d=r.data;
  if(b.action==='record'){
   const p=object(b.payment),payment=validatePayments([p],p.amount)[0];
   // This records already-received funds, rather than generating a new QR or charging a card.
   result=await sb.rpc('pos_record_deferred_payment',{p_id:b.id,p_actor:ctx.actorId,p_version:b.version,p_payment:payment});
  }else if(b.action==='cancel'){
   if(typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>2000)throw new PosError('กรุณาระบุเหตุผลการยกเลิก');
   result=await sb.rpc('pos_cancel_deferred_sale',{p_id:b.id,p_actor:ctx.actorId,p_version:b.version,p_reason:b.reason.trim()});
  }else if(b.action==='update'){
   if(typeof b.delivered!=='boolean'||!Array.isArray(b.serials)||b.serials.some((a:any)=>!Array.isArray(a)||a.some((sn:any)=>typeof sn!=='string'||!sn.trim()||sn.length>200)))throw new PosError('ข้อมูล SN หรือสถานะส่งมอบไม่ถูกต้อง');
   result=await sb.rpc('pos_update_deferred_serials',{p_id:b.id,p_actor:ctx.actorId,p_version:b.version,p_serials:b.serials,p_delivered:b.delivered});
  }else if(b.action==='post'){
   if(d.state==='posted')return NextResponse.json({result:d.result});
   if(b.delivered!==true)throw new PosError('กรุณายืนยันว่าส่งมอบสินค้าแล้ว');
   if(!Array.isArray(b.serials)||b.serials.length!==d.draft.items.length)throw new PosError('ข้อมูล SN ไม่ครบทุกบรรทัด');
   const products=await sb.from('products').select('*').in('id',d.draft.items.map((i:any)=>i.product_id));if(products.error)throw new PosError('อ่านข้อมูลสินค้าไม่สำเร็จ',503);
   const pricedData=await withEffectivePrices(sb,d.branch_id,products.data??[],d.occurred_at);
   const override=d.draft.items.some((i:any)=>Number(pricedData.find((p:any)=>p.id===i.product_id)?.price)!==i.unit_price);
   if(override&&!hasPerm(ctx.profile.email,ctx.authz,'pos.price_override'))throw new PosError('ราคาขายจริงต่างจากราคากลาง ต้องให้หัวหน้าที่มีสิทธิ์แก้ราคาปิดบิล',403);
   const catalog=pricedData.map((p:any)=>({...p,price:override?d.draft.items.find((i:any)=>i.product_id===p.id)?.unit_price:p.price}));
   const q=validateQuote({...d.draft,client_uuid:d.id,items:d.draft.items.map((i:any,index:number)=>({...i,serials:b.serials[index]}))},catalog,!ctx.authz.isSuperadmin&&["deny","approval"].includes(ctx.authz.permission_overrides?.["pos.discount"])?0:ctx.authz.max_discount_percent);
   q.cashier_id=ctx.actorId;q.note='ขายก่อนรอปิดบิล: '+d.reason+' · ขายจริง '+new Date(d.occurred_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});q.device_created_at=d.occurred_at;
   result=await sb.rpc('pos_post_deferred_sale',{p_id:b.id,p_actor:ctx.actorId,p_version:b.version,p_quote:q,p_delivered:true});
  }else throw new PosError('คำสั่งไม่ถูกต้อง');
 }
 if(result.error)throw Error(result.error.message);if(b.action==='post')kickSaleOutbox();/* บิลส่งภายหลังเข้าคิวแล้ว → ส่ง OW ทันที */return NextResponse.json(b.action==='post'?{result:result.data}:{item:safe(result.data,hasPerm(ctx.profile.email,ctx.authz,'report.cost'))});
 }catch(e){return fail(e)}}
