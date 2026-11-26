import {NextRequest,NextResponse} from 'next/server';
import {posContext,PosError} from '@/lib/server/pos-context';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {UUID} from '@/lib/server/sale-validation';
import {hasPerm} from '@/lib/sso/guard';
import {brandsSoldAtBranches} from '@/lib/sso/scope';
export const dynamic='force-dynamic';
// คืน { campaigns, gift_products, branch_brand_ids }
//   gift_products = แถวสินค้าของแถมทุกตัว (ทุกแบรนด์) — ของแถมข้ามแบรนด์อาจไม่อยู่ในแคตตาล็อกเครื่องของแคชเชียร์ (brand scope)
//   branch_brand_ids = แบรนด์ที่สาขานี้ขาย (แบรนด์หลัก + branch_brands)
export async function GET(req:NextRequest){try{
 const branch=req.nextUrl.searchParams.get('branch_id')??'',customer=req.nextUrl.searchParams.get('customer_id'),channel=req.nextUrl.searchParams.get('channel')??'offline';
 if(!UUID.test(branch)||(customer&&!UUID.test(customer))||!['offline','online_shopee','online_lazada','online_tiktok','online_website','event','b2b','other'].includes(channel))throw new PosError('ข้อมูลสาขาหรือช่องทางไม่ถูกต้อง');
 const {profile,authz}=await posContext(req,'pos.sell',branch);
 const sb=supabaseAdmin();
 const r=await sb.rpc('pos_available_gift_campaigns',{p_branch:branch,p_customer:customer||null,p_channel:channel});
 if(r.error)throw new PosError('อ่านสิทธิ์ของแถมไม่สำเร็จ',503);
 const campaigns=(Array.isArray(r.data)?r.data:[]) as {gift_skus?:{sku:string}[]}[];
 const skus=[...new Set(campaigns.flatMap(c=>(c.gift_skus??[]).map(g=>g.sku)).filter(s=>typeof s==='string'&&s))];
 let giftProducts:Record<string,unknown>[]=[];
 if(skus.length){
  const p=await sb.from('products').select('*,product_barcodes(barcode)').in('sku',skus.slice(0,400));
  if(p.error)throw new PosError('อ่านสินค้าของแถมไม่สำเร็จ',503);
  const cost=hasPerm(profile.email,authz,'report.cost');
  giftProducts=(p.data??[]).map(row=>{const {product_barcodes,...product}=row as Record<string,unknown>&{product_barcodes:{barcode:string}[]|null};return {...product,...(!cost?{cost:0,review_note:null}:{}),barcodes:(product_barcodes??[]).map(b=>b.barcode)};});
 }
 let branchBrandIds:string[];
 try{branchBrandIds=await brandsSoldAtBranches([branch]);}catch{throw new PosError('อ่านแบรนด์ของสาขาไม่สำเร็จ',503);}
 return NextResponse.json({campaigns,gift_products:giftProducts,branch_brand_ids:branchBrandIds},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'อ่านสิทธิ์ไม่สำเร็จ'},{status:e instanceof PosError?e.status:503})}}
