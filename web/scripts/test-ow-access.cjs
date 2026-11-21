const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const src=fs.readFileSync('src/app/api/ow/[...path]/route.ts','utf8');
let session=null,allowed=true,scope=null,cost=false;let upstream=[{sku:"SKU",cost_price:100}];
const ctx={exports:{},process:{env:{ONEWAREHOUSE_BASE:'https://test.invalid',ONEWAREHOUSE_SERVICE_TOKEN:'test',ONEWAREHOUSE_SUB:'5'}},AbortSignal,Set,
fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify(upstream)}),
require:n=>n==='next/server'?{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}}:
n.endsWith('session-cookie')?{SSO_COOKIE:'test',readSession:()=>session}:
n.endsWith('grants')?{resolveAuthz:async()=>({allowed})}:
n.endsWith('guard')?{hasPerm:(_e,_a,key)=>key==='inventory.view'||cost}:
n.endsWith('warehouse-links')?{warehouseLinks:async()=>[]}:
n.endsWith('scope')?{visibleBranchIds:async()=>scope}:
{branchForWarehouseId:()=>null,warehouseIdForBranch:()=>null}};
vm.createContext(ctx);vm.runInContext(ts.transpile(src,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),ctx);
const req={cookies:{get:()=>undefined},nextUrl:new URL('https://pos.invalid/api/ow/products')};
(async()=>{
 assert.equal((await ctx.exports.GET(req,{params:{path:['products']}})).status,401);
 session={email:'pc@test.invalid'};allowed=false;assert.equal((await ctx.exports.GET(req,{params:{path:['products']}})).status,403);
 allowed=true;const r=await ctx.exports.GET(req,{params:{path:['products']}});assert.equal(r.status,200);assert.equal(r.body[0].cost_price,null);
 upstream={items:[{sku:'SKU',cost_price:100}],has_more:true,next_cursor:'NEXT'};
 const page=await ctx.exports.GET(req,{params:{path:['products']}});assert.equal(page.body.items[0].cost_price,null);assert.equal(page.body.next_cursor,'NEXT');
 scope=['branch'];assert.equal((await ctx.exports.GET(req,{params:{path:['stock']}})).status,403);
 console.log('PASS: 4 OW access regressions (anonymous, revoked user, cost masking, unmapped warehouse)');
})().catch(e=>{console.error(e);process.exitCode=1});
