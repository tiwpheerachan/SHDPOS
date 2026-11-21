const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
let profile=null,authz={allowed:true,employee_id:'employee',data_scope:'company',isSuperadmin:false},cost=true,manage=true;
class PosError extends Error{constructor(message,status){super(message);this.status=status;}}
const context={exports:{},require:n=>n.endsWith('session-cookie')?{SSO_COOKIE:'sso',readSession:()=>profile}:n.endsWith('grants')?{resolveAuthz:async()=>authz}:n.endsWith('guard')?{hasPerm:(_p,_a,key)=>key==='admin.product_manage'?manage:cost}:{PosError}};
vm.createContext(context);vm.runInContext(ts.transpile(fs.readFileSync('src/lib/server/catalog-access.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),context);
const req={cookies:{get:()=>undefined}};
(async()=>{
 await assert.rejects(context.exports.catalogAccess(req),e=>e.status===401);
 profile={email:'admin@test.invalid'};cost=false;await assert.rejects(context.exports.catalogAccess(req),e=>e.status===403);
 cost=true;authz.data_scope='branch';await assert.rejects(context.exports.catalogAccess(req),e=>e.status===403);
 authz.data_scope='company';authz.allowed=false;await assert.rejects(context.exports.catalogAccess(req),e=>e.status===403);
 authz.allowed=true;assert.equal((await context.exports.catalogAccess(req)).actorId,'employee');
 console.log('PASS: catalog access requires active company-wide product/cost management');
})().catch(e=>{console.error(e);process.exitCode=1});
