import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {supabaseAdmin} from '@/lib/supabase/admin';
import {owConfig} from '@/lib/server/ow-gateway';
import {runOwSync} from "@/lib/server/ow-sync-service";
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=240;
export async function POST(req:NextRequest){
 const key=process.env.OW_SYNC_CRON_SECRET??'',provided=req.headers.get('authorization')??'';
 if(key.length<32||Buffer.byteLength(provided)!==Buffer.byteLength('Bearer '+key)||!timingSafeEqual(Buffer.from(provided),Buffer.from('Bearer '+key)))return NextResponse.json({error:'unauthorized'},{status:401});
 try{await supabaseAdmin().from("pos_sync_settings").update({worker_seen_at:new Date().toISOString()}).eq("source",owConfig().source);const result=await runOwSync();return NextResponse.json({skipped:result.skipped,summary:result.snapshot?.summary});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'sync_failed'},{status:503});}
}
