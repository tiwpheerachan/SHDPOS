import {randomUUID} from "node:crypto";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {owConfig} from "./ow-gateway";
import {pullAllOwData} from "./ow-full-sync";
import {loadSnapshot,saveSnapshot,ensureSnapshotStore} from "./ow-snapshot-store";

/** A DB lease coordinates browser/manual and background refreshes across server instances. */
export async function runOwSync(actorId?:string){
 const sb=supabaseAdmin(),source=owConfig().source;
 if(actorId){
  const existing=await sb.from('pos_sync_settings').select('source').eq('source',source).maybeSingle();
  if(existing.error)throw Error('ยังไม่ได้ติดตั้ง migration 0041');
  const updated=existing.data?await sb.from('pos_sync_settings').update({actor_id:actorId}).eq('source',source):await sb.from('pos_sync_settings').insert({source,actor_id:actorId});
  if(updated.error)throw Error('ตั้งค่าผู้รับผิดชอบรอบซิงก์ไม่สำเร็จ');
 }
 const token=randomUUID();
 const claim=await sb.rpc('pos_claim_sync',{p_source:source,p_token:token,p_force:!!actorId});
 if(claim.error)throw Error('เริ่มรอบซิงก์ไม่สำเร็จ: '+claim.error.message);
 if(!claim.data)return {skipped:true};
 const job=claim.data;
 try{
  const previous=await loadSnapshot(source);
  const snapshot=await pullAllOwData(job.actor_id,undefined,async value=>{
   const lease=await sb.from('pos_sync_settings').select('lease_token,lease_until').eq('source',source).single();
   if(lease.error||lease.data.lease_token!==token||Date.parse(lease.data.lease_until)<Date.now())throw Error('รอบซิงก์หมดสิทธิ์บันทึก กรุณาดูรอบล่าสุด');
   await saveSnapshot(value);
  },ensureSnapshotStore,{previous,mode:actorId?'full':job.mode});
  const result=await sb.rpc('pos_finish_sync',{p_source:source,p_token:token,p_run:job.id,p_summary:snapshot.summary,p_error:null});
  if(result.error)throw Error('ดึงข้อมูลแล้วแต่ปิดรอบซิงก์ไม่สำเร็จ');
  return {skipped:false,snapshot};
 }catch(error){
  await sb.rpc('pos_finish_sync',{p_source:source,p_token:token,p_run:job.id,p_summary:null,p_error:error instanceof Error?error.message:'ซิงก์ไม่สำเร็จ'});
  throw error;
 }
}
