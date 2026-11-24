import {randomUUID} from "node:crypto";
import {decodePage,decodeProduct,skuKey} from "@/lib/catalog-sync/model";
import {pool,serialReferences,type OwResource,type OwSnapshot} from "@/lib/ow-sync/model";
import {gatewayRead,owConfig,GatewayError} from "./ow-gateway";
import {ensureSnapshotStore,saveSnapshot} from "./ow-snapshot-store";
import {supabaseAdmin} from "@/lib/supabase/admin";

/** Reads OW only. Snapshots never post stock, receive documents or modify OW statuses. */
export async function pullAllOwData(actorId:string,read=gatewayRead,persist=saveSnapshot,ensure=ensureSnapshotStore,options?:{previous:OwSnapshot|null;mode:"full"|"operational"}):Promise<OwSnapshot>{
 await ensure();
 const snapshot:OwSnapshot={version:1,id:randomUUID(),source:owConfig().source,started_at:new Date().toISOString(),completed_at:null,actor_id:actorId,resources:[],summary:{products:0,warehouses:0,stock_rows:0,carriers:0,transfers:0,serials:0,errors:0,unavailable:0}};
 async function capture(kind:string,scope:string|null,path:string,count:(data:any)=>number,validate:(data:any)=>boolean=()=>true):Promise<OwResource>{
   const resource:OwResource={key:[kind,scope].filter(Boolean).join(":"),kind,scope,state:"ok",count:0,fetched_at:new Date().toISOString(),data:null};
   try{const data=await read(path);resource.data=data;if(!validate(data))throw Error("รูปแบบข้อมูลต้นทางไม่ถูกต้องหรือคืนรายการไม่ครบ");resource.count=count(data);if(resource.count===0)resource.state="empty";}
   catch(error){resource.state=error instanceof GatewayError&&error.status===501?"unavailable":"error";resource.error=error&&typeof error==="object"&&"message" in error?String(error.message):"อ่านไม่สำเร็จ";}
   snapshot.resources.push(resource);return resource;
 }
 const products:ReturnType<typeof decodeProduct>[]=[];
 let warehouses:OwResource;
 const previous=options?.mode==="operational"&&options.previous?.source===snapshot.source?options.previous:null;
 if(previous&&previous.resources.some(r=>r.kind==="warehouses"&&r.state==="ok")&&previous.resources.some(r=>r.kind==="product_page"&&r.state!=="error")){
  snapshot.mode="operational";
  const kinds=["contract","warehouses","carriers","inventory_raw","product_page","product","bom"];
  snapshot.resources.push(...previous.resources.filter(r=>kinds.includes(r.kind)).map(r=>({...r})));
  warehouses=snapshot.resources.find(r=>r.kind==="warehouses")!;
  const seen=new Set<string>();
  for(const resource of snapshot.resources.filter(r=>r.kind==="product_page"&&r.state!=="error")){for(const p of decodePage(resource.data,null).items){if(!seen.has(skuKey(p.sku))){products.push(p);seen.add(skuKey(p.sku));}}}
 }else{
  snapshot.mode="full";
 await capture("contract",null,"openapi.json",()=>1,d=>!!d?.paths);
 warehouses=await capture("warehouses",null,"warehouses",d=>d.length,d=>Array.isArray(d)&&d.every(w=>typeof w?.warehouse_id==="string"&&w.warehouse_id.length>0));
 await capture("carriers",null,"carriers",d=>d.length,Array.isArray);
 await capture("inventory_raw",null,"stock",d=>d.length,Array.isArray);
 const seenSkus=new Map<string,string>();
 let cursor:string|null=null;const cursors=new Set<string>();let page=0;
 for(;;){
  const query=new URLSearchParams({limit:"200"});if(cursor)query.set("cursor",cursor);
  const resource=await capture("product_page",String(++page),`products?${query}`,d=>d.items.length,d=>Array.isArray(d?.items));
  if(resource.state==="error")break;
  try{const result=decodePage(resource.data,cursor);for(const product of result.items){const key=skuKey(product.sku),previous=seenSkus.get(key);if(previous&&previous!==product.sku)throw Error("พบ SKU ที่ต่างกันเฉพาะตัวพิมพ์ กรุณาตรวจต้นทาง");if(!previous){products.push(product);seenSkus.set(key,product.sku);}}if(!result.has_more)break;if(!result.next_cursor||cursors.has(result.next_cursor))throw Error("cursor ซ้ำ");cursors.add(result.next_cursor);cursor=result.next_cursor;}
  catch(error){resource.state="error";resource.error=error instanceof Error?error.message:"อ่านหน้าไม่สำเร็จ";break;}
  if(page>=1000){resource.state="error";resource.error="เกินขอบเขต 1000 หน้า ต้องตรวจแบ่งงานก่อนทำต่อ";break;}
 }
 await pool(products,async product=>{
  const detail=await capture("product",product.sku,`products?q=${encodeURIComponent(product.sku)}`,d=>d.length,Array.isArray);
  if(detail.state==="ok"){
   try{const matching=(detail.data as unknown[]).map(decodeProduct).filter(p=>skuKey(p.sku)===skuKey(product.sku));if(matching.length!==1)throw Error("exact SKU ไม่ตรงหรือซ้ำ");detail.data=matching[0];detail.count=1;
    if(matching[0].is_combined===true)await capture("bom",product.sku,`products/${encodeURIComponent(product.sku)}/components`,d=>d.components?.length??0,d=>d?.available===true&&Array.isArray(d.components));
   }catch(error){detail.state="error";detail.error=error instanceof Error?error.message:"รายละเอียดไม่ถูกต้อง";}
  }else if(detail.state==="empty"){detail.state="error";detail.error="พบใน list แต่ exact lookup ไม่พบ";}
 });
 // Probe the documented BOM capability once if there are no known bundles.
 if(products.length&&!snapshot.resources.some(r=>r.kind==="bom"))await capture("bom",products[0].sku,`products/${encodeURIComponent(products[0].sku)}/components`,d=>d.components?.length??0,d=>typeof d?.available==="boolean");
 }
 const transferIds=new Set<string>();
 if(warehouses.state==="ok")await pool(warehouses.data as any[],async warehouse=>{
  const id=warehouse.warehouse_id;
  if(typeof id!=="string"||!id)return;
  for(let offset=0;offset<products.length;offset+=50){const skus=products.slice(offset,offset+50).map(p=>p.sku);await capture("stock",`${id}/${offset/50+1}`,`stock?${new URLSearchParams({warehouseId:id,skus:skus.join(',')})}`,d=>d.length,d=>Array.isArray(d)&&new Set(d.map(row=>row.sku)).size===skus.length&&d.length===skus.length&&d.every((row:any)=>row.warehouseId===id&&skus.includes(row.sku)&&Number.isFinite(row.qty)));}
  await capture("dashboard",id,`dashboard?${new URLSearchParams({warehouseId:id})}`,()=>1,d=>d&&typeof d==="object"&&!Array.isArray(d));
  const ids=new Set<string>();let total=Infinity;
  for(let p=1;p<=1000;p++){
   const resource=await capture("transfer_page",`${id}/${p}`,`transfers?${new URLSearchParams({warehouseId:id,status:'all',page:String(p)})}`,d=>d.items.length,d=>Array.isArray(d?.items)&&Number.isSafeInteger(d.total)&&d.total>=0);
   if(resource.state==="error")break;
   const data=resource.data as {items:{id:string}[];total:number};total=data.total;
   if(!data.items.length){if(ids.size<total){resource.state="error";resource.error="ใบโอนยังไม่ครบแต่ต้นทางคืนหน้าว่าง";}break;}
   let added=0;for(const item of data.items){if(typeof item.id!=="string"||!item.id){resource.state="error";resource.error="ใบโอนไม่มี ID";continue;}if(!ids.has(item.id)){ids.add(item.id);transferIds.add(item.id);added++;}}
   if(ids.size>=total)break;
   if(!added||p===1000){resource.state="error";resource.error="ใบโอนซ้ำหรือเกินขอบเขตการแบ่งหน้า";break;}
  }
 });
 await pool([...transferIds],async id=>{await capture("transfer",id,`transfers/${encodeURIComponent(id)}`,()=>1,d=>d?.id===id);await capture("timeline",id,`transfers/${encodeURIComponent(id)}/timeline`,d=>Array.isArray(d)?d.length:Array.isArray(d?.items)?d.items.length:0,d=>Array.isArray(d)||Array.isArray(d?.items));});
 const serials=serialReferences(snapshot.resources.filter(r=>["transfer","timeline","inventory_raw"].includes(r.kind)).map(r=>r.data));
 await pool(serials,async sn=>{await capture("serial",sn,`serials/${encodeURIComponent(sn)}`,()=>1,d=>d?.serialNo===sn);});
 if(!serials.length)snapshot.resources.push({key:"serials",kind:"serial",scope:null,state:"unavailable",count:0,fetched_at:new Date().toISOString(),data:null,error:"ยังไม่มีเลข SN ในใบโอน/ประวัติที่อ่านได้ API ไม่มีรายการ SN ทั้งหมด"});
 const sum=(kind:string)=>snapshot.resources.filter(r=>r.kind===kind&&["ok","empty"].includes(r.state)).reduce((n,r)=>n+r.count,0);
 snapshot.summary={products:sum("product"),warehouses:sum("warehouses"),stock_rows:sum("stock"),carriers:sum("carriers"),transfers:sum("transfer"),serials:sum("serial"),errors:snapshot.resources.filter(r=>r.state==="error").length,unavailable:snapshot.resources.filter(r=>r.state==="unavailable").length};
 const canonical:{id:string;sku:string}[]=[];
 for(let offset=0;;offset+=1000){const result=await supabaseAdmin().from("products").select("id,sku").order("id").range(offset,offset+999);if(result.error){snapshot.catalog={error:"อ่านผลจับคู่สินค้า POS ไม่สำเร็จ"};snapshot.summary.errors++;break;}canonical.push(...(result.data ?? []));if(!result.data||result.data.length<1000)break;}
 if(!snapshot.catalog)snapshot.catalog={matches:products.map(p=>{const found=canonical.filter(c=>skuKey(c.sku)===skuKey(p.sku));return {sku:p.sku,product_id:found.length===1?found[0].id:null,state:found.length===1?"linked":found.length?"conflict":"not_imported"};})};
 snapshot.completed_at=new Date().toISOString();await persist(snapshot);return snapshot;
}
