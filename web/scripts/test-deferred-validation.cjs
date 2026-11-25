const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict'),cache={};
function moduleAt(path){if(cache[path])return cache[path];const ctx={exports:{},require:n=>n==='./sale-validation'?moduleAt('src/lib/server/sale-validation.ts'):n==='@/lib/money'?moduleAt('src/lib/money.ts'):n==='./tax'?moduleAt('src/lib/tax.ts'):(()=>{throw Error(n)})()};vm.createContext(ctx);vm.runInContext(ts.transpile(fs.readFileSync(path,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),ctx);return cache[path]=ctx.exports}
const {deferredDraft}=moduleAt('src/lib/server/deferred-sale.ts'),p={id:'00000000-0000-4000-8000-000000000001',sku:'TEST',name_th:'Incomplete',kind:'goods',price:0,is_active:false,track_serial:true,serial_policy_confirmed:false,brand_id:null,category_id:null},raw={channel:'offline',items:[{product_id:p.id,qty:2,unit_price:107,serials:[]}],grand_total:214,discount_total:0};
const result=deferredDraft(raw,[p],'b','actor');assert.equal(result.draft.grand_total,214);assert(result.issues.some(i=>i.code==='sn_missing'));assert(result.issues.some(i=>i.code==='price_override'));assert.equal(result.draft.items[0].sku,'TEST');assert.equal(result.draft.items[0].serials.length,0);
assert.throws(()=>deferredDraft({...raw,grand_total:1},[p],'b','a'),/ยอดรวม/);
assert.throws(()=>deferredDraft({...raw,items:[{...raw.items[0],unit_price:0}]},[p],'b','a'),/ราคาขายจริง/);
assert.throws(()=>deferredDraft({...raw,coupon_code:'SAVE'},[p],'b','a'),/คูปอง/);
assert.throws(()=>deferredDraft({...raw,items:[{...raw.items[0],serials:['s','S']}]},[p],'b','a'),/SN ซ้ำ/);
assert.throws(()=>deferredDraft({...raw,items:[{...raw.items[0],qty:1.2}]},[p],'b','a'),/จำนวนเต็ม/);
assert.throws(()=>deferredDraft({...raw,items:[{...raw.items[0],product_id:'missing'}]},[p],'b','a'),/แคตตาล็อก/);
assert.throws(()=>deferredDraft({...raw,items:[{...raw.items[0],unit_price:1},raw.items[0]],grand_total:216},[p],'b','a'),/ราคาเดียวกัน/);
console.log('PASS: deferred factual pricing, incomplete master/SN, totals, missing price, promotion guard, duplicate SN, quantities and canonical product validation');
