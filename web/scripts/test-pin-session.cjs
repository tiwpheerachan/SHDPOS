const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, deps, extra={}) { const exports={};const context={exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name]},...extra};vm.createContext(context);vm.runInContext(ts.transpile(fs.readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),context);return exports; }
const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
let rpcError=false, allowed=true, disabled=false, signed, cookies, state, pending;
const sb={rpc:async(_n,p)=>({data:p.p_pin==='4321'?[{id,first_name:'PC',status:'active'}]:[],error:rpcError?{message:'unavailable'}:null}),from:()=>({select:()=>({in:async()=>({data:[{id,email:null,status:'active',app_access:!disabled}],error:null})})})};
const route=load('src/app/api/auth/pin/route.ts',{
 'next/server':{NextResponse:{json:(body,init)=>({body,status:init.status,cookies:{set:(...args)=>cookies=args}})}},
 '@/lib/supabase/admin':{supabaseAdmin:()=>sb},
 '@/lib/sso/grants':{resolveAuthz:async p=>({allowed,employee_id:p.pin_employee_id,permission_overrides:{}})},
 '@/lib/sso/session-cookie':{SSO_COOKIE:'shd_sso',signSession:p=>{signed=p;return {value:'signed',maxAge:100}}},
});
const req=(body,origin='http://localhost:3100')=>({headers:new Headers({'origin':origin,'content-type':'application/json'}),nextUrl:new URL('http://localhost:3100/api/auth/pin'),json:async()=>body});
(async()=>{
 assert.equal((await route.POST(req({pin:'4321'},'https://evil.example'))).status,403);
 assert.equal((await route.POST(req({pin:'x'}))).status,400);
 assert.equal((await route.POST(req({pin:'9999'}))).status,401);
 assert.equal((await route.POST(req({pin:'4321',employee_id:other}))).status,401);
 disabled=true;assert.equal((await route.POST(req({pin:'4321',employee_id:id}))).status,401);disabled=false;
 allowed=false;assert.equal((await route.POST(req({pin:'4321',employee_id:id}))).status,403);allowed=true;
 rpcError=true;assert.equal((await route.POST(req({pin:'4321'}))).status,503);rpcError=false;
 assert.equal((await route.POST(req({pin:'4321'}))).body.matches.length,1);assert.equal(signed,undefined);
 assert.equal((await route.POST(req({pin:'4321',employee_id:id})) ).status,200);
 assert.equal(signed.pin_employee_id,id);assert.equal(signed.email,'');assert.equal(cookies[2].httpOnly,true);assert.equal(cookies[2].secure,false);
 const refresh=load('src/lib/store/session.ts',{
  zustand:{create:()=>initializer=>{state=initializer(p=>Object.assign(state,p),()=>state);return state}},
  'zustand/middleware':{persist:x=>x},'../printing/bridge':{DEFAULT_PRINTER:{}},
  '../supabase/client':{isLiveMode:()=>true,supabase:()=>null},
 },{fetch:()=>new Promise(r=>pending=r)}).useSession;
 refresh.login({id},null,null);const old=refresh.refreshEmployee();refresh.login({id:other},null,null);
 pending({ok:true,json:async()=>({authenticated:false})});await old;assert.equal(state.employee.id,other);
 const denied=refresh.refreshEmployee();pending({ok:true,json:async()=>({authenticated:false})});await denied;assert.equal(state.employee,null);
 let lookedUpById=false, employeeError=false;
 const query={select(){return this},eq(k,v){if(k==='id'&&v===id)lookedUpById=true;return this},ilike(){throw Error('Email lookup must not be used for PIN')},maybeSingle:async()=>({data:{id,role:'staff',data_scope:'branch',status:'active',app_access:true},error:employeeError?{}:null}),then(resolve){return Promise.resolve({data:[]}).then(resolve)}};
 const grants=load('src/lib/sso/grants.ts',{'@/lib/supabase/admin':{supabaseAdmin:()=>({from:()=>query})},'@/lib/permissions':{isSuperadmin:()=>false}});
 assert.equal((await grants.resolveAuthz(signed)).employee_id,id);assert.equal(lookedUpById,true);
 employeeError=true;await assert.rejects(grants.resolveAuthz(signed),/Unable to verify/);
 const cookie=load('src/lib/sso/session-cookie.ts',{'node:crypto':{default:require('node:crypto')}},{Buffer,process:{env:{SSO_SESSION_SECRET:'test-only-ephemeral-secret'}}});
 const token=cookie.signSession(signed).value;assert.equal(cookie.readSession(token).pin_employee_id,id);
 assert.equal(cookie.readSession(token+'tamper'),null);
 console.log('PASS: PIN proof, origin, disabled access, unavailable service, signed cookie, and stale-session race');
})().catch(e=>{console.error(e);process.exitCode=1});
