import {NextRequest,NextResponse} from 'next/server';
import {catalogAccess} from '@/lib/server/catalog-access';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {owConfig} from '@/lib/server/ow-gateway';
import {requireSameOrigin,PosError} from '@/lib/server/pos-context';
export const dynamic='force-dynamic';
const fail=(e:unknown)=>NextResponse.json({error:e instanceof Error?e.message:'อ่านสถานะไม่สำเร็จ'},{status:e instanceof PosError?e.status:503});
export async function GET(req:NextRequest){try{
 await catalogAccess(req);const sb=supabaseAdmin(),source=owConfig().source;
 const [settings,runs,events]=await Promise.all([sb.from('pos_sync_settings').select('*').eq('source',source).maybeSingle(),sb.from('pos_sync_runs').select('*').eq('source',source).order('started_at',{ascending:false}).limit(30),sb.from('pos_integration_events').select('id,event_type,aggregate_id,state,reason,attempts,created_at,updated_at').in('source',[source,'onewarehouse:unmapped']).order('created_at',{ascending:false}).limit(100)]);
 if(settings.error||runs.error||events.error)throw Error('ยังไม่ได้ติดตั้งทะเบียนซิงก์ migration 0041');
 const {lease_token,...safe}=settings.data??{};
 return NextResponse.json({settings:settings.data?safe:null,runs:runs.data,events:events.data,worker_configured:(process.env.OW_SYNC_CRON_SECRET??'').length>=32},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return fail(e)}}
export async function PATCH(req:NextRequest){try{
 requireSameOrigin(req);const ctx=await catalogAccess(req),b=await req.json();
 if(typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.version)||!Number.isSafeInteger(b.interval_seconds)||b.interval_seconds<30||b.interval_seconds>3600)throw new PosError('ค่ารอบซิงก์ไม่ถูกต้อง');
 if(b.enabled&&(process.env.OW_SYNC_CRON_SECRET??'').length<32)throw new PosError('ต้องตั้งค่า worker ก่อนเปิดอัตโนมัติ',409);
 const sb=supabaseAdmin(),source=owConfig().source;const current=await sb.from('pos_sync_settings').select('version').eq('source',source).maybeSingle();if(current.error)throw Error('ตรวจ migration 0041');
 if(current.data&&current.data.version!==b.version)throw new PosError('ตั้งค่าถูกแก้โดยผู้อื่น กรุณาโหลดใหม่',409);
 const value={source,enabled:b.enabled,interval_seconds:b.interval_seconds,catalog_interval_seconds:900,actor_id:ctx.actorId,updated_at:new Date().toISOString(),version:(current.data?.version??0)+1};
 const result=current.data?await sb.from('pos_sync_settings').update(value).eq('source',source).eq('version',b.version).select('source').single():await sb.from('pos_sync_settings').insert(value);
 if(result.error)throw new PosError('บันทึกการตั้งค่าซิงก์ไม่สำเร็จ',409);return NextResponse.json({ok:true});
 }catch(e){return fail(e)}}
