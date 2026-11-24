import {NextRequest,NextResponse} from "next/server";
import {catalogAccess} from "@/lib/server/catalog-access";
import {requireSameOrigin,PosError} from "@/lib/server/pos-context";
import {owConfig} from "@/lib/server/ow-gateway";
import {loadSnapshot} from "@/lib/server/ow-snapshot-store";
import {runOwSync} from "@/lib/server/ow-sync-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
let running=false;
function fail(e:unknown){return NextResponse.json({error:e instanceof Error?e.message:"อ่านข้อมูลไม่สำเร็จ"},{status:e instanceof PosError?e.status:503});}
export async function GET(req:NextRequest){try{await catalogAccess(req);return NextResponse.json({snapshot:await loadSnapshot(owConfig().source)},{headers:{"Cache-Control":"no-store"}});}catch(e){return fail(e);}}
export async function POST(req:NextRequest){try{requireSameOrigin(req);const actor=await catalogAccess(req);const result=await runOwSync(actor.actorId);if(result.skipped)throw new PosError("กำลังซิงก์อยู่ กรุณารอรอบเดิม",409);return NextResponse.json({snapshot:result.snapshot},{headers:{"Cache-Control":"no-store"}});}catch(e){return fail(e);}}
