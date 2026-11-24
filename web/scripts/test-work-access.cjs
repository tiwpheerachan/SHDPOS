const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003',task='00000000-0000-4000-8000-000000000004';let authenticated=true,allowed=true,writes=[],filters=[];
const auth=()=>({allowed,employee_id:actor,role:'staff',data_scope:'branch',branch_ids:[A],isSuperadmin:false,permission_overrides:{}});
const query=table=>{const q={select(){return q},order(){return q},limit(){return q},gt(){return q},or(){return q},in(k,v){filters.push([table,k,v]);return q},eq(k,v){filters.push([table,k,v]);return q},is(k,v){filters.push([table,k,v]);return q},update(v){writes.push([table,v]);return q},single:async()=>({data:{branch_id:B}}),then(resolve,reject){return Promise.resolve({data:table==='pos_work_items'?[{id:task,branch_id:B}]:[],count:0,error:null}).then(resolve,reject)}};return q};
const sb={from:query,rpc:async(name,args)=>{if(!['pos_work_visible'].includes(name))writes.push([name,args]);return{data:true,error:null}}};
const cache={},deps={
 'next/server':{NextResponse:{json:(data,options={})=>({data,status:options.status??200})}},
 '@/lib/sso/session-cookie':{SSO_COOKIE:'session',readSession:()=>authenticated?{email:'test@local',name:'Test'}:null},
 '@/lib/sso/grants':{resolveAuthz:async()=>auth()},'@/lib/sso/scope':{visibleBranchIds:async()=>[A]},
 '@/lib/sso/guard':{hasPerm:()=>true},'@/lib/supabase/admin':{supabaseAdmin:()=>sb},'@/lib/money':{round2:n=>Math.round(n*100)/100},
};
const files={'@/lib/server/work-context':'src/lib/server/work-context.ts','@/lib/server/pos-context':'src/lib/server/pos-context.ts','./pos-context':'src/lib/server/pos-context.ts','@/lib/server/sale-validation':'src/lib/server/sale-validation.ts'};
function load(path){if(cache[path])return cache[path];const context={exports:{},require:n=>deps[n]??(files[n]?load(files[n]):(()=>{throw Error(n)})()),URL,Date};vm.createContext(context);vm.runInContext(ts.transpile(fs.readFileSync(path,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),context);return cache[path]=context.exports}
const work=load('src/app/api/work/route.ts'),notifications=load('src/app/api/work/notifications/route.ts');
const req=(params={},body={},origin='http://localhost:3100')=>({cookies:{get:()=>({value:'signed'})},nextUrl:Object.assign(new URL('http://localhost:3100/api/work?'+new URLSearchParams(params)),{}),headers:{get:key=>key==='origin'?origin:null},json:async()=>body});
(async()=>{
 let r=await work.GET(req({id:task}));assert.equal(r.status,403,'Direct task ID bypassed effective branch scope');
 r=await work.POST(req({}, {action:'pin',id:task,pinned:true}));assert.equal(r.status,403);assert.equal(writes.length,0,'Unauthorized pin wrote data');
 r=await work.POST(req({}, {action:'save',id:task,version:1,patch:{title:'Bad'}}));assert.equal(r.status,403);assert.equal(writes.length,0);
 r=await work.GET(req({people:'true',branch_id:B}));assert.equal(r.status,403);
 await work.GET(req());assert(filters.some(([t,k,v])=>t==='pos_work_items'&&k==='branch_id'&&Array.isArray(v)&&v[0]===A),'Task list omitted effective scope');
 writes=[];filters=[];r=await notifications.POST(req({}, {id:task,recipient_id:B}));assert.equal(r.status,200);assert(filters.some(([t,k,v])=>t==='pos_work_notifications'&&k==='recipient_id'&&v===actor),'Notification update did not bind recipient to session');
 authenticated=false;assert.equal((await work.GET(req())).status,401);authenticated=true;allowed=false;assert.equal((await work.GET(req())).status,403);allowed=true;
 assert.equal((await work.POST(req({}, {id:task,action:'pin',pinned:true},'https://untrusted.example'))).status,403);
 console.log('PASS: work effective-scope checks on list/direct ID/pin/update/people; notification recipient binding; anonymous/revoked session and foreign origin');
})().catch(e=>{console.error(e);process.exitCode=1});
