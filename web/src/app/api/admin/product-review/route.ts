import {NextRequest,NextResponse} from 'next/server';
import {catalogAccess} from '@/lib/server/catalog-access';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {PosError,requireSameOrigin} from '@/lib/server/pos-context';
import {UUID,object} from '@/lib/server/sale-validation';
export const dynamic='force-dynamic';
const messages:Record<string,string>={product_version_conflict:'สินค้าถูกแก้โดยผู้อื่น กรุณาโหลดใหม่',product_not_ready_price_brand_category_serial:'ต้องมีราคา แบรนด์ หมวดหมู่ และยืนยันนโยบาย SN ก่อนเปิดขาย',serial_policy_has_existing_inventory:'มีสต๊อก SN หรือยอดจองอยู่ ต้องกระทบยอดก่อนเปลี่ยนนโยบาย SN',bundle_requires_approved_bom_checkout:'การขายสินค้าชุดยังต้องผ่านการรับรอง BOM และ Checkout ก่อน',product_has_paid_checkout_review_required:'มีรายการที่บันทึกรับชำระแล้ว ต้องตรวจรายการก่อนปิดสินค้า',product_kind_not_confirmed:'กรุณายืนยันประเภทสินค้าก่อนเปิดขาย'};
const fail=(e:unknown)=>NextResponse.json({error:e instanceof Error?e.message:'ดำเนินการไม่สำเร็จ'},{status:e instanceof PosError?e.status:503});
export async function GET(req:NextRequest){try{
 await catalogAccess(req);const id=req.nextUrl.searchParams.get('product_id');if(!id||!UUID.test(id))throw new PosError('รหัสสินค้าไม่ถูกต้อง');const sb=supabaseAdmin();
 const [product,links,brands,categories,reviews]=await Promise.all([sb.from('products').select('*').eq('id',id).single(),sb.from('pos_catalog_links').select('source,source_detail,readiness').eq('product_id',id),sb.from('brands').select('id,code,name').order('name'),sb.from('categories').select('id,code,name_th').order('name_th'),sb.from('pos_product_reviews').select('id,actor_id,reason,created_at,before_data,after_data').eq('product_id',id).order('created_at',{ascending:false}).limit(20)]);
 if(product.error||links.error||brands.error||categories.error||reviews.error)throw Error('อ่านข้อมูลอนุมัติสินค้าไม่สำเร็จ กรุณาตรวจ migration 0041');
 return NextResponse.json({product:product.data,links:links.data,brands:brands.data,categories:categories.data,reviews:reviews.data},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return fail(e)}}
export async function PATCH(req:NextRequest){try{
 requireSameOrigin(req);const ctx=await catalogAccess(req),b=object(await req.json());if(!UUID.test(b.product_id)||!Number.isSafeInteger(b.version)||b.version<1)throw new PosError('รหัสหรือเวอร์ชันสินค้าไม่ถูกต้อง');
 if(typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>2000)throw new PosError('กรุณาระบุเหตุผลการตรวจและอนุมัติ');
 const input=object(b.patch),patch:Record<string,unknown>={};
 for(const key of ['name_th','unit'])if(key in input){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>300)throw new PosError('ชื่อหรือหน่วยสินค้าไม่ถูกต้อง');patch[key]=input[key].trim();}
 for(const key of ['price','cost'])if(key in input){const n=input[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e10||Math.abs(n*100-Math.round(n*100))>1e-6)throw new PosError('ราคาหรือต้นทุนไม่ถูกต้อง');patch[key]=n;}
 for(const key of ['brand_id','category_id'])if(key in input){if(input[key]!==null&&!UUID.test(input[key]))throw new PosError('แบรนด์หรือหมวดหมู่ไม่ถูกต้อง');patch[key]=input[key];}
 for(const key of ['track_serial','serial_policy_confirmed','kind_policy_confirmed','is_active'])if(key in input){if(typeof input[key]!=='boolean')throw new PosError('สถานะยืนยันสินค้าไม่ถูกต้อง');patch[key]=input[key];}
 if(Object.keys(input).some(key=>!(key in patch)))throw new PosError('มีฟิลด์ที่ไม่อนุญาตให้แก้ไข');
 const r=await supabaseAdmin().rpc('pos_review_product',{p_id:b.product_id,p_actor:ctx.actorId,p_version:b.version,p_patch:patch,p_reason:b.reason.trim()});
 if(r.error)throw new PosError(messages[r.error.message]||'บันทึกสินค้าไม่สำเร็จ: '+r.error.message,409);
 return NextResponse.json({product:r.data});
 }catch(e){return fail(e)}}
