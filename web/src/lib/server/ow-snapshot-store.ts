import { supabaseAdmin } from "@/lib/supabase/admin";
import type { OwSnapshot } from "@/lib/ow-sync/model";
const BUCKET="pos-ow-snapshots";
export async function ensureSnapshotStore(){
 const storage=supabaseAdmin().storage;
 const existing=await storage.getBucket(BUCKET);
 if(existing.data){if(existing.data.public)throw Error("คลังข้อมูลซิงก์ต้องเป็น private");return;}
 if(existing.error && !["404","400"].includes(String(existing.error.status)))throw Error("ตรวจคลังเก็บข้อมูลซิงก์ไม่สำเร็จ");
 const created=await storage.createBucket(BUCKET,{public:false,allowedMimeTypes:["application/json"],fileSizeLimit:52428800});
 if(created.error){const check=await storage.getBucket(BUCKET);if(check.error||check.data?.public)throw Error("สร้างคลัง private สำหรับข้อมูลซิงก์ไม่สำเร็จ");}
}
export async function saveSnapshot(snapshot:OwSnapshot){
 const storage=supabaseAdmin().storage.from(BUCKET),body=JSON.stringify(snapshot);
 const archive=await storage.upload(`${snapshot.source}/${snapshot.id}.json`,body,{contentType:"application/json",upsert:true});
 if(archive.error)throw Error("บันทึกรอบดึงข้อมูลไม่สำเร็จ");
 const latest=await storage.upload(`${snapshot.source}/latest.json`,body,{contentType:"application/json",upsert:true});
 if(latest.error)throw Error("บันทึกข้อมูลซิงก์ล่าสุดไม่สำเร็จ");
}
export async function loadSnapshot(source:string):Promise<OwSnapshot|null>{
 const r=await supabaseAdmin().storage.from(BUCKET).download(`${source}/latest.json`);
 if(r.error){if(["404","400"].includes(String(r.error.status)))return null;throw Error("อ่านข้อมูลซิงก์ที่เก็บไว้ไม่สำเร็จ");}
 const data=JSON.parse(await r.data.text()) as OwSnapshot;
 if(data.version!==1||data.source!==source)throw Error("แหล่งข้อมูลซิงก์ไม่ตรงกัน");return data;
}
