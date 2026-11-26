const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,deps={}){const ctx={exports:{},require:name=>{if(/i18n\/tr$/.test(name))return {tr:(th)=>th,currentLocale:()=>'th',setCurrentLocale:()=>{}};if(!(name in deps))throw Error(name);return deps[name]},Error,URLSearchParams,Date};vm.createContext(ctx);vm.runInContext(ts.transpile(fs.readFileSync('src/'+file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),ctx);return ctx.exports;}
const model=load('lib/ow-sync/model.ts'),catalog=load('lib/catalog-sync/model.ts');
class GatewayError extends Error{constructor(message,status){super(message);this.status=status;}}
const source=load('lib/server/ow-full-sync.ts',{'node:crypto':{randomUUID:()=> 'test-run'},'@/lib/catalog-sync/model':catalog,'@/lib/ow-sync/model':model,'./ow-gateway':{owConfig:()=>({source:'onewarehouse:uat'}),GatewayError},'./ow-snapshot-store':{},'@/lib/supabase/admin':{supabaseAdmin:()=>({from:()=>({select(){return this},order(){return this},range:async()=>({data:[{id:'canonical',sku:'SKU-1'}],error:null})})})}});
let calls=[],saved,repeat=false,failStock=false;const p={sku:'SKU-1',name:'One',is_combined:false};
async function read(path){calls.push(path);if(path==='openapi.json')return {paths:{}};if(path==='warehouses')return [{warehouse_id:'W1'},{warehouse_id:'W2'}];if(path==='carriers')return [{id:'real'}];if(path==='stock')return [];
 if(path.startsWith('products?limit=')){const q=new URLSearchParams(path.split('?')[1]);return q.get('cursor')?{items:[{...p,sku:'SKU-2'}],has_more:false,next_cursor:null}:{items:[p],has_more:true,next_cursor:'next'};}
 if(path.startsWith('products?q=')){const sku=new URLSearchParams(path.split('?')[1]).get('q');return [{...p,sku}];}
 if(path.endsWith('/components'))throw new GatewayError('BOM pending',501);
 if(path.startsWith('stock?')){if(failStock)throw new GatewayError('stock down',502);const q=new URLSearchParams(path.split('?')[1]);return q.get('skus').split(',').map(sku=>({sku,warehouseId:q.get('warehouseId'),qty:sku==='SKU-1'?0:5}));}
 if(path.startsWith('dashboard?'))return {pendingReceive:0};
 if(path.startsWith('transfers?')){const q=new URLSearchParams(path.split('?')[1]);return {items:q.get('page')==='1'||repeat?[{id:'T1'}]:[{id:'T2'}],total:2,pageSize:1};}
 if(/^transfers\/T[12]$/.test(path))return {id:path.split('/')[1],lines:[{shippedSerials:[{serialNo:'REAL-SN'}]}]};
 if(path.endsWith('/timeline'))return [];
 if(path==='serials/REAL-SN')return {serialNo:'REAL-SN',sku:'SKU-1'};
 throw Error('Unexpected read '+path);
}
(async()=>{let snapshot=await source.pullAllOwData('actor',read,async s=>saved=s,async()=>{});
 assert.equal(snapshot.summary.products,2);assert.equal(snapshot.summary.warehouses,2);assert.equal(snapshot.summary.stock_rows,4);assert.equal(snapshot.summary.transfers,2);assert.equal(snapshot.summary.serials,1);assert.equal(snapshot.summary.errors,0);assert.equal(snapshot.summary.unavailable,1);assert.equal(saved.id,'test-run');assert.equal(snapshot.catalog.matches[0].product_id,'canonical');assert.equal(calls.filter(c=>c==='serials/REAL-SN').length,1);assert.equal(calls.filter(c=>c==='transfers/T1').length,1);assert.ok(snapshot.resources.some(r=>r.kind==='stock'&&r.data.some(row=>row.qty===0)));
 calls=[];const quick=await source.pullAllOwData('actor',read,async()=>{},async()=>{},{previous:saved,mode:'operational'});assert.equal(quick.mode,'operational');assert.ok(!calls.some(c=>c.startsWith('products?')||c==='warehouses'||c==='carriers'),'Operational polling reloaded master data');
 calls=[];repeat=true;failStock=true;snapshot=await source.pullAllOwData('actor',read,async()=>{},async()=>{});assert.ok(snapshot.summary.errors>=4);assert.ok(calls.filter(c=>c.startsWith('transfers?')).length<=4);assert.ok(snapshot.resources.filter(r=>r.kind==='stock').every(r=>r.state==='error'&&r.data===null));assert.equal(model.serialReferences([{serialNo:'ONE'},{nested:[{serialNo:'ONE'},{serialNo:'TWO'}]}]).join(','),'ONE,TWO');
 let allowed=false,readCount=0,syncCount=0,denyOrigin=false;
 class PosError extends Error{constructor(message,status){super(message);this.status=status;}}
 const route=load('app/api/admin/ow-data/route.ts',{'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@/lib/server/catalog-access':{catalogAccess:async()=>{if(!allowed)throw new PosError('forbidden',403);return {actorId:'actor'}}},'@/lib/server/pos-context':{PosError,requireSameOrigin:()=>{if(denyOrigin)throw new PosError('origin',403)}},'@/lib/server/ow-gateway':{owConfig:()=>({source:'onewarehouse:uat'})},'@/lib/server/ow-snapshot-store':{loadSnapshot:async()=>{readCount++;return saved}},'@/lib/server/ow-sync-service':{runOwSync:async()=>{syncCount++;return {skipped:false,snapshot:saved}}}});
 assert.equal((await route.GET({})).status,403);assert.equal(readCount,0);assert.equal((await route.POST({})).status,403);assert.equal(syncCount,0);allowed=true;denyOrigin=true;assert.equal((await route.POST({})).status,403);assert.equal(syncCount,0);denyOrigin=false;assert.equal((await route.GET({})).body.snapshot.id,'test-run');assert.equal((await route.POST({})).status,200);assert.equal(syncCount,1);
 let publicBucket=true,createdOptions;
 const storage=load('lib/server/ow-snapshot-store.ts',{'@/lib/supabase/admin':{supabaseAdmin:()=>({storage:{getBucket:async()=>publicBucket?{data:{public:true}}:{data:null,error:{status:404}},createBucket:async(_id,options)=>{createdOptions=options;return {error:null}}}})}});
 await assert.rejects(storage.ensureSnapshotStore(),/private/);publicBucket=false;await storage.ensureSnapshotStore();assert.equal(createdOptions.public,false);
 console.log('PASS: full pagination, stock coverage, zero vs unknown, referenced SNs, deduplication, canonical IDs, unsupported BOM, partial failures, authorization and private storage');})().catch(e=>{console.error(e);process.exitCode=1});
