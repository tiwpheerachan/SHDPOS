const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(path,deps={},extra={}) { const ctx={exports:{},require:n=>{if(!deps[n])throw Error(n);return deps[n]},...extra};vm.createContext(ctx);vm.runInContext(ts.transpile(fs.readFileSync('src/'+path,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),ctx);return ctx.exports; }
const refs=load('lib/catalog/campaign-products.ts');const search=load('lib/catalog/search.ts');
const id='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222';
const product={id,sku:'70mai essential-35%',name_th:'Canonical product',is_active:false};
const input={product_id:id,sku:product.sku,name:'Untrusted name'};
const row=refs.campaignReferences([input],[],[product],false,true)[0];assert.equal(row.name,product.name_th);assert.equal(row.product_id,id);
assert.throws(()=>refs.campaignReferences([input],[],[product],true,true),/แบบร่าง/);
assert.throws(()=>refs.campaignReferences([{...input,sku:'WRONG'}],[],[product],false,true),/product_id/);
assert.throws(()=>refs.campaignReferences([{...input,product_id:cid}],[],[product],false,true),/ไม่พบสินค้า/);
assert.throws(()=>refs.campaignReferences([],[],[],false,true),/อย่างน้อย/);
assert.throws(()=>refs.campaignReferences([input,input],[],[product],false,true),/ซ้ำ/);
assert.throws(()=>refs.campaignReferences([],[{...input,gift_qty:NaN}],[product],false,false),/จำนวน/);
for (const value of ['70mai essential-35%','ABC_1','A,(B)','a"b\\c','ไทย']) {
 const filter=search.catalogSearchFilter(value);const encoded=filter.slice('sku.ilike.'.length,filter.indexOf(',name_th.ilike.'));
 assert.equal(JSON.parse(encoded),'%'+value.replace(/[\\%_]/g,c=>'\\'+c)+'%');
}
let writes=[],readError=false;
const builder=table=>({select(){return this},in(){return Promise.resolve({data:[product],error:readError?{}:null})},eq(){return Promise.resolve({data:[],error:null})},insert(data){writes.push({table,data});return {select:()=>({single:async()=>({data:{id:cid},error:null})}),then(resolve){return Promise.resolve({error:null}).then(resolve)}}},delete(){return this}});
const route=load('app/api/admin/campaigns/route.ts',{
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
 '@/lib/sso/guard':{requireAdmin:async()=>({authz:{employee_id:id}})},
 '@/lib/supabase/admin':{supabaseAdmin:()=>({from:builder,rpc:async(name,args)=>{writes.push({table:'campaign_products',data:args.p_refs,rpc:name});return {data:{id:cid,version:1},error:null}}})},
 '@/lib/sso/scope':{},'@/lib/catalog/campaign-products':refs,
});
(async()=>{
 const body={name:'Draft',active:false,eligible_scope:'selected',eligible_products:[input],gift_products:[]};
 assert.equal((await route.POST({json:async()=>({...body,active:true})})).status,422);assert.equal(writes.length,0);
 assert.equal((await route.POST({json:async()=>body})).status,200);
 const relations=writes.find(w=>w.table==='campaign_products').data;assert.equal(relations[0].product_id,id);assert.equal(relations[0].sku,product.sku);assert.equal(relations[0].name,product.name_th);
 writes=[];readError=true;assert.equal((await route.POST({json:async()=>body})).status,422);assert.equal(writes.length,0);
 // The OW refresh must preserve unsynced operations, not reset the local database.
 const source=fs.readFileSync('src/lib/data/repo.ts','utf8');const start=source.indexOf('async function doBootstrap()');const end=source.indexOf('/** โหมดจำลอง',start);
 const kv=new Map();let catalogLoads=0;
 const ctx={isLiveMode:()=>true,isDemoMode:()=>false,OW_RESET_TOKEN:'new',CATALOG_VERSION:'v',kvGet:async(k,f)=>kv.get(k)??f,kvSet:async(k,v)=>kv.set(k,v),db:()=>({products:{count:async()=>33}}),loadCatalogFromSupabase:async()=>{catalogLoads++},refreshDirectory:async()=>{},purgeDemoDataOnce:async()=>{},resetLocalData:()=>{throw Error('Destructive reset called')}};
 vm.createContext(ctx);vm.runInContext(ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2020}),ctx);await ctx.doBootstrap();assert.equal(catalogLoads,1);assert.equal(kv.get('ow_reset_token'),'new');
 let scope=null, analyticsError=false;
 const analyticsRows={campaigns:[{id:cid,name:'Real campaign',branch_ids:[]}],coupon_redemptions:[{id:'redemption',campaign_id:cid,order_id:'order',order_total:200,discount_amount:20,created_at:'2026-11-22'}],branches:[{id:'branch',name:'Real branch',brand_id:'brand'}],brands:[{id:'brand',name:'Real brand'}],employees:[{id:'cashier',nickname:'Real cashier'}],orders:[{id:'order',order_no:'POS-REAL',branch_id:'branch',cashier_id:'cashier',customer_name:'Real customer'}],order_items:[{order_id:'order',sku:product.sku,name:'Sale snapshot',qty:2}]};
 const analyticsDb={from:table=>({select(){return this},order(){return this},limit(){return this},in(){return this},then(resolve){return Promise.resolve({data:analyticsRows[table],error:analyticsError?{}:null}).then(resolve)}})};
 const analytics=load('app/api/admin/coupons/route.ts',{'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@/lib/sso/guard':{requireAdmin:async()=>({authz:{}})},'@/lib/supabase/admin':{supabaseAdmin:()=>analyticsDb},'@/lib/sso/scope':{visibleBranchIds:async()=>scope}});
 let usage=(await analytics.GET({})).body.usages[0];assert.equal(usage.order_no,'POS-REAL');assert.equal(usage.customer_name,'Real customer');assert.equal(usage.products[0].name,'Sale snapshot');
 scope=['other'];assert.equal((await analytics.GET({})).body.usages.length,0);scope=null;analyticsRows.orders=[];analyticsRows.order_items=[];
 usage=(await analytics.GET({})).body.usages[0];assert.equal(usage.order_no,'—');assert.equal(usage.customer_name,null);assert.equal(usage.products.length,0);assert.equal(usage.details_unavailable,true);
 analyticsError=true;assert.equal((await analytics.GET({})).status,503);
 console.log('PASS: literal SKU search; canonical campaign IDs; draft imports; activation rejection; failed reads before writes; safe catalog bootstrap');
})().catch(e=>{console.error(e);process.exitCode=1});
