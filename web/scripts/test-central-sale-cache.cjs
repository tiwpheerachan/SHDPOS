// Execute the production post-commit cache path: central sales must never enqueue a second financial write.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('src/lib/data/repo.ts','utf8');
const start=source.indexOf('  if (!draft.central_committed) await enqueue("create_order"');
const end=source.indexOf('\n// ── ออเดอร์จอง',start);
assert(start>0&&end>start,'production cache section found');
let events,customer;
const context={enqueue:async(type,key,value)=>events.push({type,key,value}),db:()=>({customers:{get:async()=>customer,put:async v=>customer=v}}),round2:x=>Math.round(x*100)/100};
vm.createContext(context);
vm.runInContext(ts.transpile('async function persist(draft){const items=[],totals={subtotal:107,discountTotal:20,vatAmount:5.69,grandTotal:87},order={order_no:"O",is_offline_origin:false},now="2026-11-22";'+source.slice(start,end),{target:ts.ScriptTarget.ES2020}),context);
(async()=>{for(const central of [true,false]){events=[];customer={id:'c',points:194};await context.persist({central_committed:central,client_uuid:'sale',customer_id:'c',redeem_points:10,coupon_code:'TEST',coupon_discount:10,payments:[]});assert.deepEqual(events.map(e=>e.type),central?[]:['create_order','redeem_points','redeem_coupon']);assert.equal(customer.points,central?194:184);}console.log('PASS: central sale cache never resubmits order, coupon or points; legacy offline queue retained');})().catch(e=>{console.error(e);process.exitCode=1});
