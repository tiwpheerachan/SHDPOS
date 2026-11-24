import {NextRequest,NextResponse} from 'next/server';
import {posContext,PosError} from '@/lib/server/pos-context';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {UUID} from '@/lib/server/sale-validation';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{
 const branch=req.nextUrl.searchParams.get('branch_id')??'',customer=req.nextUrl.searchParams.get('customer_id'),channel=req.nextUrl.searchParams.get('channel')??'offline';
 if(!UUID.test(branch)||(customer&&!UUID.test(customer))||!['offline','online_shopee','online_lazada','online_tiktok','online_website','event','b2b','other'].includes(channel))throw new PosError('ข้อมูลสาขาหรือช่องทางไม่ถูกต้อง');
 await posContext(req,'pos.sell',branch);
 const r=await supabaseAdmin().rpc('pos_available_gift_campaigns',{p_branch:branch,p_customer:customer||null,p_channel:channel});
 if(r.error)throw new PosError('อ่านสิทธิ์ของแถมไม่สำเร็จ',503);
 return NextResponse.json(r.data,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'อ่านสิทธิ์ไม่สำเร็จ'},{status:e instanceof PosError?e.status:503})}}
